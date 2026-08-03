import { Hono } from 'hono';
import type { ZodTypeAny, output as ZodOutput } from 'zod';
import { CorpoInvalido, lerCorpoJson } from '../lib/corpo';
import { conversaSchema, etapaSchema, normalizarEtapa } from '../lib/schemas';
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
/** Marcador de etapa ausente — visível na tela, em vez de sumir. */
const ETAPA_DESCONHECIDA = '(etapa não informada)';

const webhooks = new Hono<AppEnv>();

/**
 * Duas formas de autenticar, por rota:
 *
 * - `/webhook/<canal>/<slug>?t=<token>` — token por funil × canal, emitido pelo
 *   painel. É o caminho novo: cada origem tem a própria credencial, então dá
 *   para revogar uma sem derrubar as outras, e o evento já chega sabendo a qual
 *   funil pertence.
 * O caminho antigo, com `X-Webhook-Secret` no header, foi removido: era um
 * segredo único para todas as origens e todos os funis, sem como revogar um
 * sem derrubar os outros, e sem dizer de qual funil o evento vinha. Manter os
 * dois esquemas só preservaria o elo mais fraco.
 */
/**
 * Extrai o token de onde a origem conseguir mandar.
 *
 * O Rubeus, na tela de webhook, oferece "Autenticação: Bearer" com campo de
 * token — ou seja, header. O fluxo de automação manda a URL crua. A Evolution
 * usa outro formato ainda. Aceitar as três formas evita que a integração
 * dependa de qual tela do CRM foi usada para configurá-la.
 */
function extrairToken(c: any): string | null {
  const auth = c.req.header('Authorization') || '';
  const bearer = auth.match(/^Bearer\s+(.+)$/i);
  if (bearer) return bearer[1].trim();
  return (
    c.req.header('X-Webhook-Token') ||
    c.req.header('apikey') ||
    c.req.query('t') ||
    null
  );
}

async function resolverToken(c: any): Promise<{ funilId: number; slug: string } | null> {
  const token = extrairToken(c);
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

/**
 * Registra o que chegou, aceito ou não.
 *
 * Fora do caminho crítico (waitUntil): diagnóstico não pode atrasar nem
 * derrubar a gravação do lead.
 */
function registrarEvento(
  c: any,
  status: string,
  corpo: string | null,
  detalhe?: string,
) {
  const canal = c.req.path.split('/')[2] ?? null;
  const slug = c.req.param('slug') ?? null;
  c.executionCtx?.waitUntil(
    (async () => {
      try {
        await c.env.DB.prepare(
          `INSERT INTO eventos_recebidos (webhook_id, canal, funil_slug, status, detalhe, corpo)
           VALUES ((SELECT w.id FROM webhooks w JOIN funis f ON f.id = w.funil_id
                    WHERE w.canal = ? AND f.slug = ?), ?, ?, ?, ?, ?)`,
        )
          .bind(canal, slug, canal, slug, status, detalhe ?? null, corpo?.slice(0, 4000) ?? null)
          .run();
        // Mantém só as 50 últimas por webhook: o corpo tem dado de lead e não
        // precisa viver além do tempo de diagnosticar a integração.
        await c.env.DB.prepare(
          `DELETE FROM eventos_recebidos WHERE id IN (
             SELECT id FROM eventos_recebidos
             WHERE canal = ? AND funil_slug = ?
             ORDER BY recebido_em DESC LIMIT -1 OFFSET 50)`,
        )
          .bind(canal, slug)
          .run();
      } catch {
        /* diagnóstico nunca derruba o webhook */
      }
    })(),
  );
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
  normalizar?: (b: unknown) => unknown,
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

  const r = schema.safeParse(normalizar ? normalizar(bruto) : bruto);
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

/** Grava um evento de etapa, com ou sem funil associado. */
async function gravarEtapa(c: any, funilId: number | null, jaValidado?: any) {
  let d = jaValidado;
  if (!d) {
    const cru = await c.req.raw.clone().text().catch(() => null);
    /*
     * A query completa o payload.
     *
     * O fluxo de automação do Rubeus dispara a partir de um gatilho de etapa
     * ("entrou na etapa Oportunidade"), mas o corpo que ele monta não carrega
     * qual etapa é — a informação está no fluxo, não no dado. Como cada fluxo
     * tem a própria URL, a etapa vai nela: ?etapa=Oportunidade. Quem configura
     * cola um link por ação, que é exatamente o modelo de "um webhook por
     * etapa" que se quer monitorar.
     *
     * O corpo vence a query quando os dois trazem o campo: dado real do evento
     * é mais confiável que valor fixo na URL.
     */
    const daQuery = {
      etapa: c.req.query('etapa'),
      processo_nome: c.req.query('processo'),
      status: c.req.query('status'),
    };
    let semEtapa = false;
    const r = await validarCorpo(c.req.raw, etapaSchema, c.req.path, (b) => {
      const norm = normalizarEtapa(b) as Record<string, unknown>;
      for (const [k, v] of Object.entries(daQuery)) {
        if (v && (norm[k] === undefined || norm[k] === null || norm[k] === '')) norm[k] = v;
      }
      /*
       * Evento real nunca é descartado.
       *
       * Se a etapa não veio nem no corpo nem na query, gravar marcado é melhor
       * que devolver 400: o lead existe, o CRM não vai reenviar, e um 400 às 8h
       * da manhã vira buraco permanente no histórico. Fica visível no diário
       * como "sem etapa" para o mapeamento ser corrigido, e o evento continua
       * lá para ser reprocessado.
       */
      if (!norm.etapa) {
        norm.etapa = ETAPA_DESCONHECIDA;
        semEtapa = true;
      }
      return norm;
    });
    if (!r.ok) {
      registrarEvento(c, r.erro, cru, JSON.stringify(r.detalhe).slice(0, 500));
      return c.json({ erro: r.erro, detalhe: r.detalhe }, 400);
    }
    registrarEvento(
      c,
      semEtapa ? 'aceito_sem_etapa' : 'aceito',
      cru,
      semEtapa
        ? 'Gravado, mas sem etapa: mapeie um campo de etapa nos parâmetros do fluxo do Rubeus.'
        : undefined,
    );
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
  const etapa = await validarCorpo(clone, etapaSchema, '/webhook/n8n', normalizarEtapa);
  if (etapa.ok) return gravarEtapa(c, funilId, etapa.dados);
  return gravarConversa(c, funilId);
});

export default webhooks;
