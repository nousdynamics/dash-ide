import { Hono } from 'hono';
import type { ZodTypeAny, output as ZodOutput } from 'zod';
import { exigirSegredoDeWebhook } from '../lib/auth';
import { CorpoInvalido, lerCorpoJson } from '../lib/corpo';
import { conversaSchema, etapaSchema } from '../lib/schemas';
import type { AppEnv } from '../lib/tipos';

/**
 * Webhooks de entrada.
 *
 * Três canais, cada um com URL e token próprios por funil: Rubeus (mudança de
 * etapa), Evolution API (conversa de WhatsApp) e n8n (genérico). Separar por
 * canal E por funil deixa revogar uma credencial sem derrubar as outras, e faz
 * o evento já chegar sabendo a qual funil pertence.
 *
 * As métricas de mídia não passam por aqui — vêm da consulta ao vivo em
 * /api/ads.
 */
const webhooks = new Hono<AppEnv>();

/**
 * Duas formas de autenticar, por rota:
 *
 * - `/webhook/<canal>/<slug>?t=<token>` — token por funil × canal, emitido pelo
 *   painel. É o caminho novo: cada origem tem a própria credencial, então dá
 *   para revogar uma sem derrubar as outras, e o evento já chega sabendo a qual
 *   funil pertence.
 * - `/webhook/rubeus/etapa` com header `X-Webhook-Secret` — caminho antigo,
 *   mantido para não quebrar integração já configurada.
 */
async function resolverToken(c: any): Promise<{ funilId: number; slug: string } | null> {
  const token = c.req.query('t');
  const canal = c.req.path.split('/')[2];
  const slug = c.req.param('slug');
  if (!token || !slug) return null;

  const linha = await c.env.DB.prepare(
    `SELECT w.id, w.funil_id FROM webhooks w JOIN funis f ON f.id = w.funil_id
     WHERE w.token = ? AND w.canal = ? AND f.slug = ? AND f.ativo = 1`,
  )
    .bind(token, canal, slug)
    .first() as { id: number; funil_id: number } | null;

  if (!linha) return null;

  // Alimenta o "recebeu evento?" da tela de webhooks.
  c.executionCtx?.waitUntil(
    c.env.DB.prepare(
      `UPDATE webhooks SET ultimo_uso_em = datetime('now'), total_recebido = total_recebido + 1 WHERE id = ?`,
    )
      .bind(linha.id)
      .run(),
  );

  return { funilId: linha.funil_id, slug };
}

/** Middleware das rotas com token no lugar do header. */
const exigirToken = async (c: any, next: any) => {
  const r = await resolverToken(c);
  if (!r) {
    console.warn(JSON.stringify({ evento: 'token_invalido', rota: c.req.path }));
    return c.json({ erro: 'nao_autorizado' }, 401);
  }
  c.set('funilId', r.funilId);
  await next();
};

/**
 * Lê + valida o corpo, para que campo faltante vire 400 explícito em vez de
 * linha parcial gravada em silêncio.
 */
async function validarCorpo<S extends ZodTypeAny>(
  req: Request,
  schema: S,
  rota: string,
): Promise<
  { ok: true; dados: ZodOutput<S> } | { ok: false; erro: string; detalhe: unknown }
> {
  let bruto: unknown;
  try {
    bruto = await lerCorpoJson(req);
  } catch (e) {
    const msg = e instanceof CorpoInvalido ? e.message : 'falha ao ler corpo';
    console.warn(JSON.stringify({ evento: 'corpo_ilegivel', rota, msg }));
    return { ok: false, erro: 'corpo_invalido', detalhe: msg };
  }

  const r = schema.safeParse(bruto);
  if (!r.success) {
    console.warn(JSON.stringify({
      evento: 'schema_invalido',
      rota,
      problemas: r.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`),
    }));
    return {
      ok: false,
      erro: 'schema_invalido',
      detalhe: r.error.issues.map((i) => ({ campo: i.path.join('.'), msg: i.message })),
    };
  }

  return { ok: true, dados: r.data };
}

/** POST /webhook/rubeus/etapa — caminho antigo, autenticado por header. */
webhooks.post('/rubeus/etapa', exigirSegredoDeWebhook, (c) => gravarEtapa(c, null));

/** Grava um evento de etapa, com ou sem funil associado. */
async function gravarEtapa(c: any, funilId: number | null, jaValidado?: any) {
  let d = jaValidado;
  if (!d) {
    const r = await validarCorpo(c.req.raw, etapaSchema, c.req.path);
    if (!r.ok) return c.json({ erro: r.erro, detalhe: r.detalhe }, 400);
    d = r.dados;
  }

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO leads_etapa (
       contato_id, contato_nome, registro_processo_id, processo_id, processo_nome, etapa, status,
       curso_id, curso_codigo, origem, modalidade, unidade, responsavel_comercial, registrado_em,
       funil_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      d.contato_id,
      d.contato_nome ?? null,
      d.registro_processo_id ?? null,
      d.processo_id ?? null,
      d.processo_nome ?? null,
      d.etapa,
      d.status ?? null,
      d.curso_id ?? null,
      d.curso_codigo ?? null,
      d.origem ?? null,
      d.modalidade ?? null,
      d.unidade ?? null,
      d.responsavel_comercial ?? null,
      d.registrado_em,
      funilId,
    )
    .run();

  console.log(JSON.stringify({
    evento: 'etapa_gravada',
    contato_id: d.contato_id,
    etapa: d.etapa,
    processo: d.processo_nome,
  }));

  return c.json({ ok: true, id: meta.last_row_id }, 201);
}

/**
 * POST /webhook/evolution/conversa — Evolution API (somente leitura de conversa;
 * nenhum disparo de mensagem sai daqui, conforme decisão do plano).
 *
 * Upsert por (contato_id, iniciada_em): a Evolution reemite eventos da mesma
 * conversa conforme ela avança, e cada reemissão deve atualizar a linha — o
 * tempo de resposta só é conhecido depois da primeira resposta do atendente.
 */
webhooks.post('/evolution/conversa', exigirSegredoDeWebhook, (c) => gravarConversa(c, null));

/** Grava/atualiza uma conversa, com ou sem funil associado. */
async function gravarConversa(c: any, funilId: number | null) {
  const r = await validarCorpo(c.req.raw, conversaSchema, c.req.path);
  if (!r.ok) return c.json({ erro: r.erro, detalhe: r.detalhe }, 400);
  const d = r.dados;

  await c.env.DB.prepare(
    `INSERT INTO conversas_whatsapp
       (contato_id, contato_nome, atendente, iniciada_em, respondida, tempo_resposta_min, funil_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (contato_id, iniciada_em) DO UPDATE SET
       contato_nome       = COALESCE(excluded.contato_nome, contato_nome),
       atendente          = COALESCE(excluded.atendente, atendente),
       respondida         = MAX(excluded.respondida, respondida),
       tempo_resposta_min = COALESCE(tempo_resposta_min, excluded.tempo_resposta_min)`,
  )
    .bind(
      d.contato_id ?? null,
      d.contato_nome ?? null,
      d.atendente ?? null,
      d.iniciada_em,
      d.respondida ? 1 : 0,
      d.tempo_resposta_min ?? null,
      funilId,
    )
    .run();

  return c.json({ ok: true }, 201);
}

/*
 * Rotas por funil. Declaradas DEPOIS das fixas: o Hono casa na ordem, e
 * `/rubeus/:slug` engoliria `/rubeus/etapa` se viesse antes.
 */
webhooks.post('/rubeus/:slug', exigirToken, async (c) => gravarEtapa(c, c.get('funilId') ?? null));
webhooks.post('/evolution/:slug', exigirToken, async (c) => gravarConversa(c, c.get('funilId') ?? null));

/**
 * POST /webhook/n8n/:slug — canal de contingência.
 *
 * Não é uma integração de rotina: existe para reenviar evento que se perdeu e
 * para injetar dado à mão quando algo quebra do lado do Rubeus ou da Evolution.
 * Por isso aceita tanto payload de etapa quanto de conversa e decide pelo
 * formato — num canal usado enquanto se apaga incêndio, obrigar a escolher a
 * rota certa só transfere a chance de errar para o pior momento possível.
 *
 * Reenviar o mesmo evento é seguro: o funil conta contatos DISTINTOS por etapa,
 * então linha duplicada não infla número, e conversa é upsert por
 * (contato_id, iniciada_em).
 */
webhooks.post('/n8n/:slug', exigirToken, async (c) => {
  const funilId = c.get('funilId') ?? null;
  const clone = c.req.raw.clone();
  const etapa = await validarCorpo(clone, etapaSchema, '/webhook/n8n');
  if (etapa.ok) return gravarEtapa(c, funilId, etapa.dados);
  return gravarConversa(c, funilId);
});

export default webhooks;
