import { Hono } from 'hono';
import type { AppEnv } from '../lib/tipos';
import type { ZodTypeAny, output as ZodOutput } from 'zod';
import { exigirSegredoDeWebhook } from '../lib/auth';
import { CorpoInvalido, lerCorpoJson } from '../lib/corpo';
import { conversaSchema, conversaoSchema, etapaSchema, metricasSchema } from '../lib/schemas';

const webhooks = new Hono<AppEnv>();

// Nenhuma escrita acontece antes do segredo ser conferido.
webhooks.use('*', exigirSegredoDeWebhook);

/**
 * Lê + valida o corpo. Devolve `{ ok: false, resposta }` já pronto pro handler
 * retornar, pra que campo faltante vire 400 explícito em vez de linha parcial.
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

/** POST /webhook/rubeus/etapa — fluxo de automação do Rubeus. */
webhooks.post('/rubeus/etapa', async (c) => {
  const r = await validarCorpo(c.req.raw, etapaSchema, '/webhook/rubeus/etapa');
  if (!r.ok) return c.json({ erro: r.erro, detalhe: r.detalhe }, 400);
  const d = r.dados;

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO leads_etapa (
       contato_id, contato_nome, registro_processo_id, processo_id, processo_nome, etapa, status,
       curso_id, curso_codigo, origem, modalidade, unidade, responsavel_comercial, registrado_em
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    )
    .run();

  console.log(JSON.stringify({
    evento: 'etapa_gravada',
    contato_id: d.contato_id,
    etapa: d.etapa,
    processo: d.processo_nome,
  }));

  return c.json({ ok: true, id: meta.last_row_id }, 201);
});

/**
 * POST /webhook/evolution/conversa — Evolution API (somente leitura de conversa;
 * nenhum disparo de mensagem sai daqui, conforme decisão do plano).
 *
 * Upsert por (contato_id, iniciada_em): a Evolution reemite eventos da mesma
 * conversa conforme ela avança, e cada reemissão deve atualizar a linha — o
 * tempo de resposta só é conhecido depois da primeira resposta do atendente.
 */
webhooks.post('/evolution/conversa', async (c) => {
  const r = await validarCorpo(c.req.raw, conversaSchema, '/webhook/evolution/conversa');
  if (!r.ok) return c.json({ erro: r.erro, detalhe: r.detalhe }, 400);
  const d = r.dados;

  await c.env.DB.prepare(
    `INSERT INTO conversas_whatsapp
       (contato_id, contato_nome, atendente, iniciada_em, respondida, tempo_resposta_min)
     VALUES (?, ?, ?, ?, ?, ?)
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
    )
    .run();

  return c.json({ ok: true }, 201);
});

/** POST /webhook/n8n/conversao — resultado do envio ao Google Ads, reportado pelo n8n. */
webhooks.post('/n8n/conversao', async (c) => {
  const r = await validarCorpo(c.req.raw, conversaoSchema, '/webhook/n8n/conversao');
  if (!r.ok) return c.json({ erro: r.erro, detalhe: r.detalhe }, 400);
  const d = r.dados;

  const { meta } = await c.env.DB.prepare(
    `INSERT INTO conversoes_ads
       (contato_id, contato_nome, etapa, gclid, conversion_action, valor, status, erro_detalhe, enviado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      d.contato_id,
      d.contato_nome ?? null,
      d.etapa,
      d.gclid ?? null,
      d.conversion_action ?? null,
      d.valor ?? null,
      d.status,
      d.erro_detalhe ?? null,
      d.enviado_em ?? null,
    )
    .run();

  console.log(JSON.stringify({
    evento: 'conversao_registrada',
    contato_id: d.contato_id,
    etapa: d.etapa,
    status: d.status,
    tem_gclid: Boolean(d.gclid),
  }));

  return c.json({ ok: true, id: meta.last_row_id }, 201);
});

/** POST /webhook/n8n/metricas — polling agendado do Google Ads; upsert por (data, campanha_id). */
webhooks.post('/n8n/metricas', async (c) => {
  const r = await validarCorpo(c.req.raw, metricasSchema, '/webhook/n8n/metricas');
  if (!r.ok) return c.json({ erro: r.erro, detalhe: r.detalhe }, 400);
  const linhas = r.dados;

  const stmt = c.env.DB.prepare(
    `INSERT INTO metricas_anuncio
       (data, campanha_id, campanha_nome, investimento, impressoes, cliques,
        cpc_medio, ctr, conversoes_primarias, conversoes_secundarias)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (data, campanha_id) DO UPDATE SET
       campanha_nome          = excluded.campanha_nome,
       investimento           = excluded.investimento,
       impressoes             = excluded.impressoes,
       cliques                = excluded.cliques,
       cpc_medio              = excluded.cpc_medio,
       ctr                    = excluded.ctr,
       conversoes_primarias   = excluded.conversoes_primarias,
       conversoes_secundarias = excluded.conversoes_secundarias`,
  );

  // Lote numa transação implícita: ou o dia inteiro entra, ou nada entra.
  await c.env.DB.batch(
    linhas.map((m) =>
      stmt.bind(
        m.data,
        m.campanha_id,
        m.campanha_nome ?? null,
        m.investimento ?? null,
        m.impressoes ?? null,
        m.cliques ?? null,
        m.cpc_medio ?? null,
        m.ctr ?? null,
        m.conversoes_primarias ?? null,
        m.conversoes_secundarias ?? null,
      ),
    ),
  );

  console.log(JSON.stringify({ evento: 'metricas_upsert', linhas: linhas.length }));

  return c.json({ ok: true, linhas: linhas.length }, 200);
});

export default webhooks;
