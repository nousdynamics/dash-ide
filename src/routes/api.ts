import { Hono } from 'hono';
import type { AppEnv } from '../lib/tipos';
import { ETAPAS_FUNIL } from '../lib/etapas';
import { funilQuerySchema, paginacaoQuerySchema, periodoQuerySchema } from '../lib/schemas';

const api = new Hono<AppEnv>();

/**
 * Janela do período pedido + a janela imediatamente anterior de mesmo tamanho,
 * que é o que alimenta o delta percentual dos cards ("↑ 8,2%" nos mockups).
 */
function janelas(dias: number) {
  const agora = new Date();
  const inicio = new Date(agora.getTime() - dias * 86_400_000);
  const inicioAnterior = new Date(agora.getTime() - 2 * dias * 86_400_000);
  const dia = (d: Date) => d.toISOString().slice(0, 10);
  return {
    inicio: inicio.toISOString(),
    fim: agora.toISOString(),
    inicioAnterior: inicioAnterior.toISOString(),
    diaInicio: dia(inicio),
    diaFim: dia(agora),
    diaInicioAnterior: dia(inicioAnterior),
  };
}

/** Variação percentual entre dois períodos. `null` quando não há base de comparação. */
function delta(atual: number, anterior: number): number | null {
  if (!anterior) return null;
  return Number((((atual - anterior) / anterior) * 100).toFixed(1));
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0);

/**
 * GET /api/overview?dias=30 — cards, séries e listas curtas da Visão Geral.
 *
 * Investimento e conversões de Ads vêm de `metricas_anuncio` (agregado por dia
 * do Google Ads). "Leads no período" vem de `leads_etapa` e conta contatos
 * distintos, não eventos — o mesmo lead avançando de etapa não vira dois leads.
 */
api.get('/overview', async (c) => {
  const q = periodoQuerySchema.safeParse(c.req.query());
  if (!q.success) return c.json({ erro: 'parametros_invalidos', detalhe: q.error.issues }, 400);
  const { dias } = q.data;
  const j = janelas(dias);

  const [ads, adsAnterior, leads, leadsAnterior, serieInvest, serieConv, conversoes, conversas] =
    await Promise.all([
      c.env.DB.prepare(
        `SELECT COALESCE(SUM(investimento),0) AS investimento,
                COALESCE(SUM(conversoes_primarias),0) AS primarias,
                COALESCE(SUM(conversoes_secundarias),0) AS secundarias,
                COALESCE(SUM(cliques),0) AS cliques,
                COALESCE(SUM(impressoes),0) AS impressoes
         FROM metricas_anuncio WHERE data >= ? AND data <= ?`,
      ).bind(j.diaInicio, j.diaFim).first(),

      c.env.DB.prepare(
        `SELECT COALESCE(SUM(investimento),0) AS investimento,
                COALESCE(SUM(conversoes_primarias),0) AS primarias,
                COALESCE(SUM(conversoes_secundarias),0) AS secundarias
         FROM metricas_anuncio WHERE data >= ? AND data < ?`,
      ).bind(j.diaInicioAnterior, j.diaInicio).first(),

      c.env.DB.prepare(
        `SELECT COUNT(DISTINCT contato_id) AS total FROM leads_etapa WHERE registrado_em >= ?`,
      ).bind(j.inicio).first(),

      c.env.DB.prepare(
        `SELECT COUNT(DISTINCT contato_id) AS total
         FROM leads_etapa WHERE registrado_em >= ? AND registrado_em < ?`,
      ).bind(j.inicioAnterior, j.inicio).first(),

      c.env.DB.prepare(
        `SELECT data, COALESCE(SUM(investimento),0) AS valor
         FROM metricas_anuncio WHERE data >= ? AND data <= ?
         GROUP BY data ORDER BY data`,
      ).bind(j.diaInicio, j.diaFim).all(),

      c.env.DB.prepare(
        `SELECT substr(COALESCE(enviado_em, criado_em), 1, 10) AS data, COUNT(*) AS total
         FROM conversoes_ads
         WHERE status = 'enviada' AND COALESCE(enviado_em, criado_em) >= ?
         GROUP BY data ORDER BY data`,
      ).bind(j.inicio).all(),

      c.env.DB.prepare(
        `SELECT contato_id, contato_nome, etapa, gclid, status, enviado_em, criado_em
         FROM conversoes_ads ORDER BY id DESC LIMIT 10`,
      ).all(),

      c.env.DB.prepare(
        `SELECT contato_id, contato_nome, atendente, iniciada_em, respondida, tempo_resposta_min
         FROM conversas_whatsapp ORDER BY iniciada_em DESC LIMIT 10`,
      ).all(),
    ]);

  const investimento = num(ads?.investimento);
  const primarias = num(ads?.primarias);
  const secundarias = num(ads?.secundarias);
  const investimentoAnt = num(adsAnterior?.investimento);
  const primariasAnt = num(adsAnterior?.primarias);
  const secundariasAnt = num(adsAnterior?.secundarias);

  const custoPorConversao = primarias > 0 ? investimento / primarias : null;
  const custoPorConversaoAnt = primariasAnt > 0 ? investimentoAnt / primariasAnt : 0;

  return c.json({
    periodo: { dias, de: j.inicio, ate: j.fim },
    cards: {
      investimento_total: {
        valor: investimento,
        delta_pct: delta(investimento, investimentoAnt),
      },
      conversoes_primarias: { valor: primarias, delta_pct: delta(primarias, primariasAnt) },
      conversoes_secundarias: { valor: secundarias, delta_pct: delta(secundarias, secundariasAnt) },
      custo_por_conversao: {
        valor: custoPorConversao,
        delta_pct: custoPorConversao === null ? null : delta(custoPorConversao, custoPorConversaoAnt),
      },
      leads_periodo: { valor: num(leads?.total), delta_pct: delta(num(leads?.total), num(leadsAnterior?.total)) },
    },
    series: {
      investimento_diario: serieInvest.results,
      conversoes_diarias: serieConv.results,
    },
    conversoes_recentes: conversoes.results,
    conversas_recentes: conversas.results,
  });
});

/**
 * GET /api/funil?processo_id=&dias=90 — contagem por etapa.
 *
 * Semântica: quantos contatos DISTINTOS já passaram por cada etapa na janela.
 * Não é "quantos estão parados na etapa agora" — um lead que avançou continua
 * contando nas etapas anteriores, que é o que faz a taxa entre etapas ter
 * sentido e o funil ser monotonicamente decrescente.
 */
api.get('/funil', async (c) => {
  const q = funilQuerySchema.safeParse(c.req.query());
  if (!q.success) return c.json({ erro: 'parametros_invalidos', detalhe: q.error.issues }, 400);
  const { processo_id, dias } = q.data;
  const j = janelas(dias);

  const [contagens, processos] = await Promise.all([
    c.env.DB.prepare(
      `SELECT etapa, COUNT(DISTINCT contato_id) AS total
       FROM leads_etapa
       WHERE registrado_em >= ? AND (? IS NULL OR processo_id = ?)
       GROUP BY etapa`,
    ).bind(j.inicio, processo_id ?? null, processo_id ?? null).all(),

    // Agrupa só por processo_id: agrupar também pelo nome duplicaria o processo
    // no seletor sempre que um evento chegasse sem `processo_nome`. MAX() ignora
    // NULL, então o nome preenchido vence o ausente.
    c.env.DB.prepare(
      `SELECT processo_id, MAX(processo_nome) AS processo_nome,
              COUNT(DISTINCT contato_id) AS leads
       FROM leads_etapa
       WHERE processo_id IS NOT NULL
       GROUP BY processo_id
       ORDER BY leads DESC`,
    ).all(),
  ]);

  const porEtapa = new Map<string, number>();
  for (const linha of contagens.results as Array<{ etapa: string; total: number }>) {
    porEtapa.set(linha.etapa, num(linha.total));
  }

  // Monta na ordem canônica do Rubeus, incluindo etapas com zero.
  const etapas = ETAPAS_FUNIL.map((etapa) => ({ etapa, total: porEtapa.get(etapa) ?? 0 }));

  const passos = etapas.map((atual, i) => {
    const anterior = i === 0 ? null : etapas[i - 1];
    const taxa =
      anterior && anterior.total > 0
        ? Number(((atual.total / anterior.total) * 100).toFixed(1))
        : null;
    return { ...atual, taxa_desde_anterior_pct: taxa };
  });

  // Maior queda percentual entre etapas — o mockup contorna esse bloco em --warning.
  //
  // Só entram etapas com movimento (total > 0). Nem todo processo usa as oito
  // etapas da lista canônica; sem esse filtro, uma etapa que o processo
  // simplesmente não utiliza aparece como 0% e sequestra o alerta de uma queda
  // de verdade. O destaque é pra chamar atenção pra gargalo, não pra buraco de
  // dado.
  let maiorQueda: string | null = null;
  let piorTaxa = Infinity;
  for (const p of passos) {
    if (p.total > 0 && p.taxa_desde_anterior_pct !== null && p.taxa_desde_anterior_pct < piorTaxa) {
      piorTaxa = p.taxa_desde_anterior_pct;
      maiorQueda = p.etapa;
    }
  }

  return c.json({
    processo_id: processo_id ?? null,
    periodo: { dias, de: j.inicio, ate: j.fim },
    etapas: passos,
    etapa_maior_queda: maiorQueda,
    processos_disponiveis: processos.results,
  });
});

/** GET /api/conversoes?limite=&offset=&status= — lista paginada. */
api.get('/conversoes', async (c) => {
  const q = paginacaoQuerySchema.safeParse(c.req.query());
  if (!q.success) return c.json({ erro: 'parametros_invalidos', detalhe: q.error.issues }, 400);
  const { limite, offset } = q.data;
  const status = c.req.query('status') ?? null;

  const [linhas, total] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, contato_id, contato_nome, etapa, gclid, conversion_action, valor,
              status, erro_detalhe, enviado_em, criado_em
       FROM conversoes_ads
       WHERE (? IS NULL OR status = ?)
       ORDER BY id DESC LIMIT ? OFFSET ?`,
    ).bind(status, status, limite, offset).all(),

    c.env.DB.prepare(
      `SELECT COUNT(*) AS total FROM conversoes_ads WHERE (? IS NULL OR status = ?)`,
    ).bind(status, status).first(),
  ]);

  return c.json({
    itens: linhas.results,
    paginacao: { limite, offset, total: num(total?.total) },
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
