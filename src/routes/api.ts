import { Hono } from 'hono';
import { funilQuerySchema, paginacaoQuerySchema, periodoQuerySchema } from '../lib/schemas';
import type { AppEnv } from '../lib/tipos';

/**
 * Agregados do D1 — ou seja, só o que não existe em outra fonte: o funil do
 * Rubeus e as conversas da Evolution API. Investimento, cliques e resultados
 * vêm da consulta ao vivo em /api/ads.
 */
const api = new Hono<AppEnv>();

function janelas(dias: number) {
  const agora = new Date();
  const inicio = new Date(agora.getTime() - dias * 86_400_000);
  const inicioAnterior = new Date(agora.getTime() - 2 * dias * 86_400_000);
  return {
    inicio: inicio.toISOString(),
    fim: agora.toISOString(),
    inicioAnterior: inicioAnterior.toISOString(),
  };
}

/** Variação percentual entre dois períodos. `null` quando não há base. */
function delta(atual: number, anterior: number): number | null {
  if (!anterior) return null;
  return Number((((atual - anterior) / anterior) * 100).toFixed(1));
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0);

/**
 * GET /api/me — quem está logado, segundo o header que o Cloudflare Access
 * injeta. Sem Access (dev local) volta `null`.
 */
api.get('/me', (c) => c.json({ email: c.get('usuarioEmail') ?? null }));

/** GET /api/overview?dias=30 — leads captados e conversas, direto do D1. */
api.get('/overview', async (c) => {
  const q = periodoQuerySchema.safeParse(c.req.query());
  if (!q.success) return c.json({ erro: 'parametros_invalidos', detalhe: q.error.issues }, 400);
  const { dias } = q.data;
  const j = janelas(dias);

  const [leads, leadsAnterior, conversas, conversasRecentes] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT contato_id) AS total FROM leads_etapa WHERE registrado_em >= ?`,
    ).bind(j.inicio).first(),

    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT contato_id) AS total
       FROM leads_etapa WHERE registrado_em >= ? AND registrado_em < ?`,
    ).bind(j.inicioAnterior, j.inicio).first(),

    c.env.DB.prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(AVG(tempo_resposta_min), 0) AS tempo_medio_min,
              COALESCE(SUM(respondida), 0) AS respondidas
       FROM conversas_whatsapp WHERE iniciada_em >= ?`,
    ).bind(j.inicio).first(),

    c.env.DB.prepare(
      `SELECT contato_id, contato_nome, atendente, iniciada_em, respondida, tempo_resposta_min
       FROM conversas_whatsapp ORDER BY iniciada_em DESC LIMIT 10`,
    ).all(),
  ]);

  const totalLeads = num(leads?.total);

  return c.json({
    periodo: { dias, de: j.inicio, ate: j.fim },
    cards: {
      leads_periodo: { valor: totalLeads, delta_pct: delta(totalLeads, num(leadsAnterior?.total)) },
      conversas_periodo: { valor: num(conversas?.total), delta_pct: null },
    },
    conversas: {
      total: num(conversas?.total),
      respondidas: num(conversas?.respondidas),
      tempo_medio_min: Number(num(conversas?.tempo_medio_min).toFixed(1)),
    },
    conversas_recentes: conversasRecentes.results,
  });
});

/**
 * GET /api/funil?funil_id=&dias=90 — contagem por etapa.
 *
 * As etapas vêm do DADO, não de uma lista fixa no código. Cada funil do Rubeus
 * usa um conjunto diferente — a lista canônica de oito nomes que existia aqui
 * estava errada para três dos quatro funis reais, e qualquer rename feito lá
 * quebraria em silêncio.
 *
 * A ordem sai da contagem de contatos distintos em ordem decrescente, que é a
 * própria semântica de funil: etapa anterior tem mais gente que a seguinte.
 * Isso se autocorrige conforme o dado chega, sem ninguém manter ordem à mão.
 *
 * Semântica: quantos contatos DISTINTOS já passaram por cada etapa na janela.
 * Não é "quantos estão parados na etapa agora" — um lead que avançou continua
 * contando nas etapas anteriores, que é o que faz a taxa entre etapas ter
 * sentido e o funil decrescer de forma consistente.
 */
api.get('/funil', async (c) => {
  const q = funilQuerySchema.safeParse(c.req.query());
  if (!q.success) return c.json({ erro: 'parametros_invalidos', detalhe: q.error.issues }, 400);
  const { funil_id, dias } = q.data;
  const j = janelas(dias);
  const fid = funil_id ? Number(funil_id) : null;

  const [contagens, funis] = await Promise.all([
    c.env.DB.prepare(
      `SELECT etapa, COUNT(DISTINCT contato_id) AS total
       FROM leads_etapa
       WHERE registrado_em >= ? AND (? IS NULL OR funil_id = ?)
       GROUP BY etapa
       ORDER BY total DESC`,
    ).bind(j.inicio, fid, fid).all(),

    // Todos os funis cadastrados aparecem no seletor, mesmo os que ainda não
    // receberam evento — senão um funil recém-criado some da tela e parece que
    // o cadastro não funcionou.
    c.env.DB.prepare(
      `SELECT f.id, f.nome,
              (SELECT COUNT(DISTINCT l.contato_id) FROM leads_etapa l WHERE l.funil_id = f.id) AS leads
       FROM funis f WHERE f.ativo = 1 ORDER BY leads DESC, f.id`,
    ).all(),
  ]);

  const etapas = (contagens.results as Array<{ etapa: string; total: number }>).map((l) => ({
    etapa: l.etapa,
    total: num(l.total),
  }));

  const passos = etapas.map((atual, i) => {
    const anterior = i === 0 ? null : etapas[i - 1];
    const taxa =
      anterior && anterior.total > 0
        ? Number(((atual.total / anterior.total) * 100).toFixed(1))
        : null;
    return { ...atual, taxa_desde_anterior_pct: taxa };
  });

  // Só etapas com movimento entram no alerta de gargalo: nem todo processo usa
  // as oito etapas, e uma etapa não utilizada apareceria como 0% e roubaria o
  // destaque de uma queda real.
  let maiorQueda: string | null = null;
  let piorTaxa = Infinity;
  for (const p of passos) {
    if (p.total > 0 && p.taxa_desde_anterior_pct !== null && p.taxa_desde_anterior_pct < piorTaxa) {
      piorTaxa = p.taxa_desde_anterior_pct;
      maiorQueda = p.etapa;
    }
  }

  return c.json({
    funil_id: fid,
    periodo: { dias, de: j.inicio, ate: j.fim },
    etapas: passos,
    etapa_maior_queda: maiorQueda,
    funis_disponiveis: funis.results,
  });
});

/** GET /api/conversas?limite=&offset= — lista paginada de conversas do WhatsApp. */
api.get('/conversas', async (c) => {
  const q = paginacaoQuerySchema.safeParse(c.req.query());
  if (!q.success) return c.json({ erro: 'parametros_invalidos', detalhe: q.error.issues }, 400);
  const { limite, offset } = q.data;

  const [linhas, agregado] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, contato_id, contato_nome, atendente, iniciada_em,
              respondida, tempo_resposta_min, criado_em
       FROM conversas_whatsapp ORDER BY iniciada_em DESC LIMIT ? OFFSET ?`,
    ).bind(limite, offset).all(),

    c.env.DB.prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(AVG(tempo_resposta_min), 0) AS tempo_medio_min,
              COALESCE(SUM(respondida), 0) AS respondidas
       FROM conversas_whatsapp`,
    ).first(),
  ]);

  return c.json({
    itens: linhas.results,
    resumo: {
      total: num(agregado?.total),
      respondidas: num(agregado?.respondidas),
      tempo_medio_min: Number(num(agregado?.tempo_medio_min).toFixed(1)),
    },
    paginacao: { limite, offset, total: num(agregado?.total) },
  });
});

export default api;
