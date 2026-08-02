import { Hono } from 'hono';
import type { AppEnv } from '../lib/tipos';
import { ErroGoogleAds, consultar, dataValida, deMicros, janelaAnterior, num } from '../lib/googleAds';

const ads = new Hono<AppEnv>();

/**
 * "Resultados" é a soma de TODAS as conversões que a plataforma reporta — sem
 * allowlist de ação e sem usar a flag `primary_for_goal` do Google, que na
 * conta da IDE marca como primária coisa como inscrição em canal do YouTube e
 * clique em rota do Maps, e como secundária o "Concluiu Inscrição".
 *
 * A métrica nasce agregável por plataforma: quando o Meta Ads entrar, ele soma
 * aqui em vez de virar um card separado.
 */
type Totais = {
  investimento: number;
  resultados: number;
  impressoes: number;
  cliques: number;
  custo_por_resultado: number | null;
  cpc_medio: number | null;
  ctr: number | null;
  taxa_conversao: number | null;
};

function totalizar(metricas: Array<Record<string, unknown>>): Totais {
  let investimento = 0, resultados = 0, impressoes = 0, cliques = 0;
  for (const m of metricas) {
    investimento += deMicros(m.costMicros);
    resultados += num(m.conversions);
    impressoes += num(m.impressions);
    cliques += num(m.clicks);
  }
  return {
    investimento,
    resultados,
    impressoes,
    cliques,
    custo_por_resultado: resultados > 0 ? investimento / resultados : null,
    cpc_medio: cliques > 0 ? investimento / cliques : null,
    ctr: impressoes > 0 ? (cliques / impressoes) * 100 : null,
    taxa_conversao: cliques > 0 ? (resultados / cliques) * 100 : null,
  };
}

/** Variação percentual; `null` quando não há base de comparação. */
function delta(atual: number | null, anterior: number | null): number | null {
  if (atual === null || anterior === null || !anterior) return null;
  return Number((((atual - anterior) / anterior) * 100).toFixed(1));
}

function deltas(a: Totais, b: Totais): Record<string, number | null> {
  return {
    investimento: delta(a.investimento, b.investimento),
    resultados: delta(a.resultados, b.resultados),
    impressoes: delta(a.impressoes, b.impressoes),
    cliques: delta(a.cliques, b.cliques),
    custo_por_resultado: delta(a.custo_por_resultado, b.custo_por_resultado),
    cpc_medio: delta(a.cpc_medio, b.cpc_medio),
    ctr: delta(a.ctr, b.ctr),
    taxa_conversao: delta(a.taxa_conversao, b.taxa_conversao),
  };
}

/** Lê e valida o intervalo pedido. Default: últimos 30 dias encerrando ontem. */
function intervalo(c: { req: { query: (k: string) => string | undefined } }) {
  const hoje = new Date();
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const padraoAte = iso(hoje.getTime() - 86_400_000);
  const padraoDe = iso(hoje.getTime() - 30 * 86_400_000);

  const de = c.req.query('de');
  const ate = c.req.query('ate');
  return {
    de: dataValida(de) ? de : padraoDe,
    ate: dataValida(ate) ? ate : padraoAte,
    comparar: c.req.query('comparar') === '1',
  };
}

const ondeData = (de: string, ate: string) => `segments.date BETWEEN '${de}' AND '${ate}'`;

/**
 * GET /api/ads/overview — cards + séries diárias.
 *
 * Uma consulta traz o agregado da conta e outra a série por dia; a segunda já
 * serve as duas coisas, mas manter o agregado separado evita depender de somar
 * no Worker quando o Google já entrega o total consistente.
 */
ads.get('/overview', async (c) => {
  const { de, ate, comparar } = intervalo(c);

  const qTotais = (d1: string, d2: string) =>
    `SELECT metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
     FROM customer WHERE ${ondeData(d1, d2)}`;

  const qDiario =
    `SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
     FROM customer WHERE ${ondeData(de, ate)} ORDER BY segments.date`;

  const anterior = comparar ? janelaAnterior(de, ate) : null;

  const [linhasTotais, linhasDiario, linhasAnterior] = await Promise.all([
    consultar<{ metrics: Record<string, unknown> }>(c.env, qTotais(de, ate)),
    consultar<{ segments: { date: string }; metrics: Record<string, unknown> }>(c.env, qDiario),
    anterior
      ? consultar<{ metrics: Record<string, unknown> }>(c.env, qTotais(anterior.de, anterior.ate))
      : Promise.resolve([]),
  ]);

  const totais = totalizar(linhasTotais.map((l) => l.metrics));

  const serie = linhasDiario.map((l) => ({
    data: l.segments.date,
    investimento: deMicros(l.metrics.costMicros),
    resultados: num(l.metrics.conversions),
    cliques: num(l.metrics.clicks),
    impressoes: num(l.metrics.impressions),
  }));

  return c.json({
    periodo: { de, ate },
    plataforma: 'google_ads',
    totais,
    // Comparação com a janela anterior de mesmo tamanho.
    comparacao: anterior
      ? { periodo: anterior, totais: totalizar(linhasAnterior.map((l) => l.metrics)), deltas: deltas(totais, totalizar(linhasAnterior.map((l) => l.metrics))) }
      : null,
    serie_diaria: serie,
  });
});

/** GET /api/ads/campanhas — tabela de campanhas do período. */
ads.get('/campanhas', async (c) => {
  const { de, ate } = intervalo(c);

  const linhas = await consultar<{
    campaign: { id: string; name: string; status: string; advertisingChannelType?: string };
    metrics: Record<string, unknown>;
  }>(
    c.env,
    `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
            metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
     FROM campaign
     WHERE ${ondeData(de, ate)} AND campaign.status != 'REMOVED'
     ORDER BY metrics.cost_micros DESC`,
  );

  const itens = linhas.map((l) => {
    const investimento = deMicros(l.metrics.costMicros);
    const resultados = num(l.metrics.conversions);
    const cliques = num(l.metrics.clicks);
    const impressoes = num(l.metrics.impressions);
    return {
      id: l.campaign.id,
      nome: l.campaign.name,
      status: l.campaign.status,
      tipo: l.campaign.advertisingChannelType ?? null,
      investimento,
      resultados,
      cliques,
      impressoes,
      custo_por_resultado: resultados > 0 ? investimento / resultados : null,
      cpc_medio: cliques > 0 ? investimento / cliques : null,
      ctr: impressoes > 0 ? (cliques / impressoes) * 100 : null,
    };
  });

  return c.json({ periodo: { de, ate }, total: itens.length, itens });
});

/**
 * GET /api/ads/resultados-por-acao — de onde vêm os resultados.
 *
 * `conversion_action.*` não pode ser selecionado a partir de `campaign`; o
 * recorte por ação exige o segmento `segments.conversion_action_name`.
 */
ads.get('/resultados-por-acao', async (c) => {
  const { de, ate } = intervalo(c);

  const linhas = await consultar<{
    segments: { conversionActionName?: string; conversionActionCategory?: string };
    metrics: Record<string, unknown>;
  }>(
    c.env,
    `SELECT segments.conversion_action_name, segments.conversion_action_category,
            metrics.all_conversions, metrics.conversions
     FROM customer WHERE ${ondeData(de, ate)}`,
  );

  const porAcao = new Map<string, { acao: string; categoria: string | null; resultados: number }>();
  for (const l of linhas) {
    const acao = l.segments.conversionActionName ?? '(sem nome)';
    const atual = porAcao.get(acao) ?? {
      acao,
      categoria: l.segments.conversionActionCategory ?? null,
      resultados: 0,
    };
    atual.resultados += num(l.metrics.conversions);
    porAcao.set(acao, atual);
  }

  const itens = [...porAcao.values()].filter((i) => i.resultados > 0).sort((a, b) => b.resultados - a.resultados);
  const total = itens.reduce((s, i) => s + i.resultados, 0);

  return c.json({
    periodo: { de, ate },
    total,
    itens: itens.map((i) => ({ ...i, participacao_pct: total > 0 ? (i.resultados / total) * 100 : 0 })),
  });
});

/** GET /api/ads/anuncios — desempenho por anúncio. */
ads.get('/anuncios', async (c) => {
  const { de, ate } = intervalo(c);

  const linhas = await consultar<{
    adGroupAd: { ad: { id: string; name?: string; type?: string }; status: string };
    adGroup: { name: string };
    campaign: { name: string };
    metrics: Record<string, unknown>;
  }>(
    c.env,
    `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.status,
            ad_group.name, campaign.name,
            metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
     FROM ad_group_ad
     WHERE ${ondeData(de, ate)} AND ad_group_ad.status != 'REMOVED'
     ORDER BY metrics.cost_micros DESC LIMIT 500`,
  );

  return c.json({
    periodo: { de, ate },
    itens: linhas.map((l) => ({
      id: l.adGroupAd.ad.id,
      // Anúncio responsivo normalmente não tem nome; o tipo é o rótulo útil.
      nome: l.adGroupAd.ad.name || `${l.adGroupAd.ad.type ?? 'Anúncio'} ${l.adGroupAd.ad.id}`,
      tipo: l.adGroupAd.ad.type ?? null,
      status: l.adGroupAd.status,
      grupo: l.adGroup.name,
      campanha: l.campaign.name,
      investimento: deMicros(l.metrics.costMicros),
      resultados: num(l.metrics.conversions),
      cliques: num(l.metrics.clicks),
      impressoes: num(l.metrics.impressions),
    })),
  });
});

/** GET /api/ads/palavras-chave — termos que a conta compra. */
ads.get('/palavras-chave', async (c) => {
  const { de, ate } = intervalo(c);

  const linhas = await consultar<{
    adGroupCriterion: { keyword: { text: string; matchType: string }; status: string };
    campaign: { name: string };
    metrics: Record<string, unknown>;
  }>(
    c.env,
    `SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
            ad_group_criterion.status, campaign.name,
            metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
     FROM keyword_view
     WHERE ${ondeData(de, ate)} AND ad_group_criterion.status != 'REMOVED'
     ORDER BY metrics.cost_micros DESC LIMIT 500`,
  );

  return c.json({
    periodo: { de, ate },
    itens: linhas.map((l) => ({
      termo: l.adGroupCriterion.keyword.text,
      correspondencia: l.adGroupCriterion.keyword.matchType,
      campanha: l.campaign.name,
      investimento: deMicros(l.metrics.costMicros),
      resultados: num(l.metrics.conversions),
      cliques: num(l.metrics.clicks),
      impressoes: num(l.metrics.impressions),
    })),
  });
});

/** Erro do Google Ads não deve virar 500 genérico — o painel precisa distinguir. */
ads.onError((err, c) => {
  if (err instanceof ErroGoogleAds) {
    return c.json({ erro: 'google_ads_indisponivel', detalhe: err.message }, err.status as 500 | 502);
  }
  throw err;
});

export default ads;
