import { Hono } from 'hono';
import type { AppEnv } from '../lib/tipos';
import { ErroGoogleAds, consultar, dataValida, deMicros, janelaAnterior, num } from '../lib/googleAds';

const ads = new Hono<AppEnv>();

/**
 * Conversão é a PRIMÁRIA. É a definição do gerenciador, e é a que mede campanha.
 *
 * Nesta conta as primárias são CTWA, "Conversation started" e LeadForm — 302 no
 * período de referência. As secundárias são ações locais: rota no Maps, visita
 * à loja, visita ao site pelo perfil — 232,9. Somar as duas e chamar de
 * resultado inflava o numerador e barateava o custo pela metade: R$ 7,46 no
 * painel contra R$ 13,21 no Google, mesma conta, mesmo período.
 *
 * `resultados` continua sendo o total (todas as conversões) porque é dado útil —
 * mostra engajamento —, mas não é o que decide orçamento.
 *
 * A métrica nasce agregável por plataforma: quando o Meta Ads entrar, ele soma
 * aqui em vez de virar um card separado.
 */
type Totais = {
  investimento: number;
  resultados: number;
  resultados_primarios: number;
  resultados_secundarios: number;
  impressoes: number;
  cliques: number;
  custo_por_resultado: number | null;
  cpc_medio: number | null;
  cpm: number | null;
  ctr: number | null;
  taxa_conversao: number | null;
};

/*
 * Primária x secundária, no vocabulário do Google Ads:
 *   metrics.conversions      -> só ações com primary_for_goal = true
 *   metrics.all_conversions  -> TODAS as ações, primárias e secundárias
 *
 * `resultados` guarda o total; `resultados_primarios` é o que a tela chama de
 * "Conversões" e o que entra no custo por conversão.
 */
function totalizar(metricas: Array<Record<string, unknown>>): Totais {
  let investimento = 0, todas = 0, primarias = 0, impressoes = 0, cliques = 0;
  for (const m of metricas) {
    investimento += deMicros(m.costMicros);
    todas += num(m.allConversions);
    primarias += num(m.conversions);
    impressoes += num(m.impressions);
    cliques += num(m.clicks);
  }
  // Secundária é derivada: o Google não expõe uma métrica só delas.
  const secundarias = Math.max(0, todas - primarias);
  /*
   * Custo por conversão e taxa de conversão saem das PRIMÁRIAS, não do total.
   *
   * É o que o gerenciador faz, e a diferença não é acadêmica: dividir por
   * "todas" incluía rota no Maps e visita ao perfil no denominador e barateava
   * o custo pela metade — R$ 7,46 no painel contra R$ 13,21 no Google, para a
   * mesma conta e o mesmo período. Quem decide orçamento com o número errado
   * decide errado.
   *
   * Secundária continua somando em `resultados` (todas as conversões), que é
   * onde ela pertence: serve para ver engajamento, não para medir campanha.
   */
  return {
    investimento,
    resultados: todas,
    resultados_primarios: primarias,
    resultados_secundarios: secundarias,
    impressoes,
    cliques,
    custo_por_resultado: primarias > 0 ? investimento / primarias : null,
    cpc_medio: cliques > 0 ? investimento / cliques : null,
    // CPM é por MIL impressões — daí o ×1000. Sem isso vira um número
    // microscópico que ninguém reconhece.
    cpm: impressoes > 0 ? (investimento / impressoes) * 1000 : null,
    ctr: impressoes > 0 ? (cliques / impressoes) * 100 : null,
    taxa_conversao: cliques > 0 ? (primarias / cliques) * 100 : null,
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
    resultados_primarios: delta(a.resultados_primarios, b.resultados_primarios),
    resultados_secundarios: delta(a.resultados_secundarios, b.resultados_secundarios),
    impressoes: delta(a.impressoes, b.impressoes),
    cliques: delta(a.cliques, b.cliques),
    custo_por_resultado: delta(a.custo_por_resultado, b.custo_por_resultado),
    cpc_medio: delta(a.cpc_medio, b.cpc_medio),
    cpm: delta(a.cpm, b.cpm),
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
    `SELECT metrics.cost_micros, metrics.impressions, metrics.clicks,
            metrics.conversions, metrics.all_conversions
     FROM customer WHERE ${ondeData(d1, d2)}`;

  const qDiario =
    `SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks,
            metrics.conversions, metrics.all_conversions
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
    resultados: num(l.metrics.allConversions),
    resultados_primarios: num(l.metrics.conversions),
    resultados_secundarios: Math.max(0, num(l.metrics.allConversions) - num(l.metrics.conversions)),
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

/**
 * Traduz o filtro de status da UI em cláusula GAQL.
 *
 * `REMOVED` só entra quando pedido explicitamente: campanha excluída costuma
 * ser a maioria das linhas numa conta antiga e enterraria as ativas.
 */
function ondeStatus(filtro: string | undefined): string {
  switch (filtro) {
    case 'ativas': return "AND campaign.status = 'ENABLED'";
    case 'pausadas': return "AND campaign.status = 'PAUSED'";
    case 'removidas': return "AND campaign.status = 'REMOVED'";
    case 'todas': return '';
    default: return "AND campaign.status != 'REMOVED'";
  }
}

/** GET /api/ads/campanhas — tabela de campanhas do período. */
ads.get('/campanhas', async (c) => {
  const { de, ate } = intervalo(c);
  const filtroStatus = c.req.query('status') ?? undefined;

  const linhas = await consultar<{
    campaign: { id: string; name: string; status: string; advertisingChannelType?: string };
    metrics: Record<string, unknown>;
  }>(
    c.env,
    `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
            metrics.cost_micros, metrics.impressions, metrics.clicks,
            metrics.conversions, metrics.all_conversions
     FROM campaign
     WHERE ${ondeData(de, ate)} ${ondeStatus(filtroStatus)}
     ORDER BY metrics.cost_micros DESC`,
  );

  const itens = linhas.map((l) => {
    const investimento = deMicros(l.metrics.costMicros);
    // Mesma definição do card "Resultados": todas as conversões da plataforma.
    const resultados = num(l.metrics.allConversions);
    const primarios = num(l.metrics.conversions);
    const cliques = num(l.metrics.clicks);
    const impressoes = num(l.metrics.impressions);
    return {
      id: l.campaign.id,
      nome: l.campaign.name,
      status: l.campaign.status,
      tipo: l.campaign.advertisingChannelType ?? null,
      investimento,
      resultados,
      resultados_primarios: primarios,
      resultados_secundarios: Math.max(0, resultados - primarios),
      cliques,
      impressoes,
      // Mesma regra dos totais: o denominador é a conversão primária, como no
      // gerenciador. Ver totalizar().
      custo_por_resultado: primarios > 0 ? investimento / primarios : null,
      cpc_medio: cliques > 0 ? investimento / cliques : null,
      ctr: impressoes > 0 ? (cliques / impressoes) * 100 : null,
    };
  });

  return c.json({ periodo: { de, ate }, filtro_status: filtroStatus ?? 'nao_removidas', total: itens.length, itens });
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

  const porAcao = new Map<string, {
    acao: string; categoria: string | null; resultados: number; primarios: number;
  }>();
  for (const l of linhas) {
    const acao = l.segments.conversionActionName ?? '(sem nome)';
    const atual = porAcao.get(acao) ?? {
      acao,
      categoria: l.segments.conversionActionCategory ?? null,
      resultados: 0,
      primarios: 0,
    };
    atual.resultados += num(l.metrics.allConversions);
    atual.primarios += num(l.metrics.conversions);
    porAcao.set(acao, atual);
  }

  const itens = [...porAcao.values()].filter((i) => i.resultados > 0).sort((a, b) => b.resultados - a.resultados);
  const total = itens.reduce((s, i) => s + i.resultados, 0);

  return c.json({
    periodo: { de, ate },
    total,
    total_primarios: itens.reduce((s2, i) => s2 + i.primarios, 0),
    total_secundarios: itens.reduce((s2, i) => s2 + (i.resultados - i.primarios), 0),
    itens: itens.map((i) => ({
      acao: i.acao,
      categoria: i.categoria,
      resultados: i.resultados,
      // Uma ação sem nenhuma conversão contada em `conversions` é secundária —
      // é assim que o Google separa as duas, sem expor a flag no segmento.
      tipo: i.primarios > 0 ? 'primaria' : 'secundaria',
      participacao_pct: total > 0 ? (i.resultados / total) * 100 : 0,
    })),
  });
});

/**
 * GET /api/ads/campanha/:id — o que existe dentro de uma campanha.
 *
 * Três consultas independentes em paralelo. Se uma falhar (um tipo de campanha
 * que não tem palavra-chave, por exemplo, como Performance Max), as outras
 * seguem: devolver o anúncio sem a lista de termos é melhor que devolver erro.
 */
ads.get('/campanha/:id', async (c) => {
  const { de, ate } = intervalo(c);
  const id = (c.req.param('id') || '').replace(/\D/g, '');
  if (!id) return c.json({ erro: 'id_invalido' }, 400);

  type Texto = { text?: string; pinnedField?: string };

  const qCampanha =
    // Sem campaign.start_date / end_date: a v24 não reconhece esses campos.
    `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
            campaign_budget.amount_micros,
            metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.all_conversions
     FROM campaign WHERE campaign.id = ${id} AND ${ondeData(de, ate)}`;

  const qAnuncios =
    `SELECT ad_group.id, ad_group.name, ad_group.status,
            ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.status,
            ad_group_ad.ad.final_urls,
            ad_group_ad.ad.responsive_search_ad.headlines,
            ad_group_ad.ad.responsive_search_ad.descriptions,
            metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.all_conversions
     FROM ad_group_ad
     WHERE campaign.id = ${id} AND ${ondeData(de, ate)} AND ad_group_ad.status != 'REMOVED'`;

  const qPalavras =
    `SELECT ad_group.name, ad_group_criterion.keyword.text,
            ad_group_criterion.keyword.match_type, ad_group_criterion.status,
            metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.all_conversions
     FROM keyword_view
     WHERE campaign.id = ${id} AND ${ondeData(de, ate)}
       AND ad_group_criterion.status != 'REMOVED'
     ORDER BY metrics.cost_micros DESC`;

  /*
   * Recursos existem em três níveis no Google Ads: conta, campanha e conjunto.
   * O anúncio serve com a soma dos que valem para ele, então mostrar só o da
   * campanha esconde metade do que aparece na SERP.
   */
  const qRecursosConjunto =
    // `campaign.id` obrigatório no SELECT por aparecer no WHERE, igual em
    // campaign_asset — o Google devolve EXPECTED_REFERENCED_FIELD_IN_SELECT_CLAUSE.
    `SELECT campaign.id, ad_group.id, ad_group.name, ad_group_asset.field_type, ad_group_asset.status,
            asset.type, asset.name,
            asset.sitelink_asset.link_text, asset.callout_asset.callout_text,
            asset.structured_snippet_asset.header, asset.text_asset.text
     FROM ad_group_asset WHERE campaign.id = ${id}`;

  const qRecursos =
    // `campaign.id` é obrigatório no SELECT quando ele aparece no WHERE de
    // campaign_asset — o Google devolve EXPECTED_REFERENCED_FIELD_IN_SELECT_CLAUSE.
    `SELECT campaign.id, campaign_asset.field_type, campaign_asset.status,
            asset.type, asset.name,
            asset.sitelink_asset.link_text, asset.callout_asset.callout_text,
            asset.structured_snippet_asset.header, asset.text_asset.text
     FROM campaign_asset WHERE campaign.id = ${id}`;

  // `allSettled`: um tipo de campanha sem palavra-chave não pode derrubar a tela.
  const [rCamp, rAds, rKw, rAsset, rAssetGrupo] = await Promise.allSettled([
    consultar<{ campaign: Record<string, unknown>; campaignBudget?: Record<string, unknown>; metrics: Record<string, unknown> }>(c.env, qCampanha),
    consultar<{
      adGroup: { id: string; name: string; status: string };
      adGroupAd: { ad: { id: string; type?: string; finalUrls?: string[]; responsiveSearchAd?: { headlines?: Texto[]; descriptions?: Texto[] } }; status: string };
      metrics: Record<string, unknown>;
    }>(c.env, qAnuncios),
    consultar<{
      adGroup: { name: string };
      adGroupCriterion: { keyword: { text: string; matchType: string }; status: string };
      metrics: Record<string, unknown>;
    }>(c.env, qPalavras),
    consultar<{ campaignAsset: { fieldType?: string; status?: string }; asset: Record<string, any> }>(c.env, qRecursos),
    consultar<{ adGroup: { name: string }; adGroupAsset: { fieldType?: string; status?: string }; asset: Record<string, any> }>(c.env, qRecursosConjunto),
  ]);

  const ok = <T>(r: PromiseSettledResult<T[]>): T[] => (r.status === 'fulfilled' ? r.value : []);
  const falhou = (r: PromiseSettledResult<unknown>) => r.status === 'rejected';

  const camp = ok(rCamp)[0];
  const met = (m: Record<string, unknown> | undefined) => ({
    investimento: deMicros(m?.costMicros),
    resultados: num(m?.allConversions),
    cliques: num(m?.clicks),
    impressoes: num(m?.impressions),
  });

  const anuncios = ok(rAds).map((l) => {
    const rsa = l.adGroupAd.ad.responsiveSearchAd;
    return {
      id: l.adGroupAd.ad.id,
      tipo: l.adGroupAd.ad.type ?? null,
      status: l.adGroupAd.status,
      grupo: l.adGroup.name,
      grupo_status: l.adGroup.status,
      urls: l.adGroupAd.ad.finalUrls ?? [],
      // `pinnedField` diz que o texto está travado numa posição — informação que
      // explica por que um título aparece sempre no mesmo lugar.
      titulos: (rsa?.headlines ?? []).map((h) => ({ texto: h.text ?? '', fixado: h.pinnedField ?? null })),
      descricoes: (rsa?.descriptions ?? []).map((d) => ({ texto: d.text ?? '', fixado: d.pinnedField ?? null })),
      ...met(l.metrics),
    };
  });

  const palavras = ok(rKw).map((l) => ({
    termo: l.adGroupCriterion.keyword.text,
    correspondencia: l.adGroupCriterion.keyword.matchType,
    status: l.adGroupCriterion.status,
    grupo: l.adGroup.name,
    ...met(l.metrics),
  }));

  /** Extrai o texto visível de um asset, qualquer que seja o tipo. */
  const textoAsset = (a: Record<string, any>): string | null =>
    a?.sitelinkAsset?.linkText ??
    a?.calloutAsset?.calloutText ??
    a?.structuredSnippetAsset?.header ??
    a?.textAsset?.text ??
    a?.name ??
    null;

  const recursosPorConjunto = ok(rAssetGrupo).map((l) => ({
    grupo: l.adGroup.name,
    tipo: l.adGroupAsset.fieldType ?? l.asset?.type ?? null,
    status: l.adGroupAsset.status ?? null,
    texto: textoAsset(l.asset),
  }));

  const recursos = ok(rAsset).map((l) => ({
    tipo: l.campaignAsset.fieldType ?? l.asset?.type ?? null,
    status: l.campaignAsset.status ?? null,
    texto:
      l.asset?.sitelinkAsset?.linkText ??
      l.asset?.calloutAsset?.calloutText ??
      l.asset?.structuredSnippetAsset?.header ??
      l.asset?.textAsset?.text ??
      l.asset?.name ??
      null,
  }));

  return c.json({
    periodo: { de, ate },
    campanha: camp
      ? {
          id: camp.campaign.id,
          nome: camp.campaign.name,
          status: camp.campaign.status,
          tipo: camp.campaign.advertisingChannelType ?? null,
          orcamento_diario: camp.campaignBudget ? deMicros(camp.campaignBudget.amountMicros) : null,
          ...met(camp.metrics),
        }
      : null,
    anuncios,
    palavras,
    recursos,
    recursos_por_conjunto: recursosPorConjunto,
    // Transparência sobre o que não veio, em vez de simplesmente mostrar vazio.
    indisponivel: {
      anuncios: falhou(rAds),
      palavras: falhou(rKw),
      recursos: falhou(rAsset),
      recursos_por_conjunto: falhou(rAssetGrupo),
    },
  });
});

/**
 * GET /api/ads/anuncios — desempenho por anúncio.
 *
 * Filtra `cost_micros > 0` na origem em vez de cortar as 500 primeiras linhas.
 * Medido nesta conta em 30 dias: 1.032 anúncios têm alguma linha, mas só 17
 * gastaram. O `LIMIT 500` anterior estourava o teto de verdade e o excedente
 * sumia em silêncio — a busca respondia "nenhum resultado" para um anúncio que
 * existia, só estava fora do corte.
 */
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
            metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.all_conversions
     FROM ad_group_ad
     WHERE ${ondeData(de, ate)} AND ad_group_ad.status != 'REMOVED'
       AND metrics.cost_micros > 0
     ORDER BY metrics.cost_micros DESC`,
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
      resultados: num(l.metrics.allConversions),
      cliques: num(l.metrics.clicks),
      impressoes: num(l.metrics.impressions),
    })),
  });
});

/**
 * GET /api/ads/palavras-chave — termos que a conta compra.
 *
 * Mesmo motivo do endpoint de anúncios: 3.721 palavras-chave têm alguma linha
 * em 30 dias, e 50 gastaram. Filtrar na origem derruba o payload e elimina a
 * truncagem silenciosa; o `LIMIT` some junto.
 */
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
            metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.all_conversions
     FROM keyword_view
     WHERE ${ondeData(de, ate)} AND ad_group_criterion.status != 'REMOVED'
       AND metrics.cost_micros > 0
     ORDER BY metrics.cost_micros DESC`,
  );

  return c.json({
    periodo: { de, ate },
    itens: linhas.map((l) => ({
      termo: l.adGroupCriterion.keyword.text,
      correspondencia: l.adGroupCriterion.keyword.matchType,
      campanha: l.campaign.name,
      investimento: deMicros(l.metrics.costMicros),
      resultados: num(l.metrics.allConversions),
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
