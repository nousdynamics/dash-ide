import { Hono } from 'hono';
import type { AppEnv } from '../lib/tipos';
import { dataValida, janelaAnterior } from '../lib/googleAds';
import {
  ACOES_CONVERSAO,
  ACOES_EXIBIDAS,
  type AcaoMeta,
  ErroMetaAds,
  consultarMeta,
  contaMeta,
  intervaloMeta,
  somaAcoes,
} from '../lib/metaAds';
import { delta, num } from '../lib/metricas';

/**
 * Meta Ads, em canal próprio.
 *
 * Não soma com o Google: a tela de cada plataforma responde por ela, e o
 * investimento de uma nunca aparece misturado no custo da outra. A forma das
 * respostas é a mesma de /api/ads para a interface reaproveitar cartões,
 * gráficos e tabela.
 *
 * "Cliques" aqui são cliques NO LINK (`inline_link_clicks`), não `clicks`, que
 * no Meta inclui curtida, expandir texto e abrir perfil. Clique no link é o
 * que leva alguém à página — o equivalente ao clique do Google.
 */
const meta = new Hono<AppEnv>();

type LinhaInsight = {
  date_start?: string;
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  inline_link_clicks?: string;
  actions?: AcaoMeta[];
};

type Totais = {
  investimento: number;
  resultados: number;
  resultados_primarios: number;
  resultados_secundarios: number;
  impressoes: number;
  alcance: number | null;
  cliques: number;
  custo_por_resultado: number | null;
  cpc_medio: number | null;
  cpm: number | null;
  ctr: number | null;
  taxa_conversao: number | null;
};

const CAMPOS = 'spend,impressions,reach,inline_link_clicks,actions';
const SECUNDARIAS = Object.keys(ACOES_EXIBIDAS).filter((k) => ACOES_EXIBIDAS[k]?.tipo === 'secundaria');

/** Métricas de uma linha de insight, com a definição de conversão do painel. */
function metricas(l: LinhaInsight) {
  const investimento = num(l.spend);
  const primarias = somaAcoes(l.actions, ACOES_CONVERSAO);
  // Secundária = o evento que os conjuntos otimizam (click_cta). Ver ACOES_EXIBIDAS.
  const secundarias = somaAcoes(l.actions, SECUNDARIAS);
  return {
    investimento,
    resultados_primarios: primarias,
    resultados_secundarios: secundarias,
    resultados: primarias + secundarias,
    impressoes: num(l.impressions),
    cliques: num(l.inline_link_clicks),
  };
}

function totalizar(l: LinhaInsight | undefined): Totais {
  const m = metricas(l ?? {});
  return {
    ...m,
    // Alcance não se soma entre dias — só vale o que o Meta calculou para a janela inteira.
    alcance: l?.reach != null ? num(l.reach) : null,
    custo_por_resultado: m.resultados_primarios > 0 ? m.investimento / m.resultados_primarios : null,
    cpc_medio: m.cliques > 0 ? m.investimento / m.cliques : null,
    cpm: m.impressoes > 0 ? (m.investimento / m.impressoes) * 1000 : null,
    ctr: m.impressoes > 0 ? (m.cliques / m.impressoes) * 100 : null,
    taxa_conversao: m.cliques > 0 ? (m.resultados_primarios / m.cliques) * 100 : null,
  };
}

function deltas(a: Totais, b: Totais): Record<string, number | null> {
  const chaves = [
    'investimento', 'resultados', 'resultados_primarios', 'resultados_secundarios', 'impressoes',
    'alcance', 'cliques', 'custo_por_resultado', 'cpc_medio', 'cpm', 'ctr', 'taxa_conversao',
  ] as const;
  return Object.fromEntries(chaves.map((k) => [k, delta(a[k], b[k])]));
}

/** Mesmo intervalo padrão de /api/ads: últimos 30 dias encerrando ontem. */
function intervalo(c: { req: { query: (k: string) => string | undefined } }) {
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const agora = Date.now();
  const de = c.req.query('de');
  const ate = c.req.query('ate');
  return {
    de: dataValida(de) ? de : iso(agora - 30 * 86_400_000),
    ate: dataValida(ate) ? ate : iso(agora - 86_400_000),
    comparar: c.req.query('comparar') === '1',
  };
}

const insights = (env: Env, de: string, ate: string, extra: Record<string, string> = {}) =>
  consultarMeta<LinhaInsight>(env, `${contaMeta(env)}/insights`, {
    fields: CAMPOS,
    time_range: intervaloMeta(de, ate),
    ...extra,
  });

/** GET /api/meta/overview — cards + série diária. */
meta.get('/overview', async (c) => {
  const { de, ate, comparar } = intervalo(c);
  const anterior = comparar ? janelaAnterior(de, ate) : null;

  const [linhasTotais, linhasDiario, linhasAnterior] = await Promise.all([
    insights(c.env, de, ate),
    insights(c.env, de, ate, { time_increment: '1' }),
    anterior ? insights(c.env, anterior.de, anterior.ate) : Promise.resolve([]),
  ]);

  const totais = totalizar(linhasTotais[0]);
  const totaisAnterior = anterior ? totalizar(linhasAnterior[0]) : null;

  return c.json({
    periodo: { de, ate },
    plataforma: 'meta_ads',
    totais,
    comparacao: anterior && totaisAnterior
      ? { periodo: anterior, totais: totaisAnterior, deltas: deltas(totais, totaisAnterior) }
      : null,
    serie_diaria: linhasDiario.map((l) => ({ data: l.date_start, ...metricas(l) })),
  });
});

/**
 * Status do Meta no vocabulário que a interface já entende (o do Google).
 *
 * `effective_status` em vez de `status`: campanha ligada com todos os conjuntos
 * pausados não está entregando, e é isso que a pessoa quer ver.
 */
function statusPainel(s: string | undefined): string {
  switch (s) {
    case 'ACTIVE': return 'ENABLED';
    case 'PAUSED':
    case 'CAMPAIGN_PAUSED':
    case 'ADSET_PAUSED': return 'PAUSED';
    case 'DELETED':
    case 'ARCHIVED': return 'REMOVED';
    default: return s ?? 'REMOVED';
  }
}

/** GET /api/meta/campanhas — tabela de campanhas do período. */
meta.get('/campanhas', async (c) => {
  const { de, ate } = intervalo(c);

  /*
   * Duas leituras: o catálogo (nome, status, objetivo) e o desempenho.
   *
   * Insights só devolve campanha que teve entrega no período; sem o catálogo,
   * a campanha ativa que ainda não gastou some da lista em vez de aparecer com
   * zero — e "só com investimento" deixa de ser uma escolha da pessoa.
   */
  const [catalogo, desempenho] = await Promise.all([
    consultarMeta<{ id: string; name: string; effective_status?: string; objective?: string }>(
      c.env,
      `${contaMeta(c.env)}/campaigns`,
      { fields: 'id,name,effective_status,objective' },
    ),
    insights(c.env, de, ate, { level: 'campaign', fields: `campaign_id,campaign_name,${CAMPOS}` }),
  ]);

  const porId = new Map(desempenho.map((l) => [l.campaign_id ?? '', l]));
  const ids = new Set([...catalogo.map((x) => x.id), ...porId.keys()].filter(Boolean));
  const doCatalogo = new Map(catalogo.map((x) => [x.id, x]));

  const filtroStatus = c.req.query('status') ?? 'nao_removidas';
  const itens = [...ids]
    .map((id) => {
      const cat = doCatalogo.get(id);
      const l = porId.get(id) ?? {};
      const m = metricas(l);
      return {
        id,
        nome: cat?.name ?? l.campaign_name ?? id,
        // Fora do catálogo e com gasto no período = campanha já excluída.
        status: statusPainel(cat?.effective_status ?? 'DELETED'),
        tipo: cat?.objective ?? null,
        ...m,
        custo_por_resultado: m.resultados_primarios > 0 ? m.investimento / m.resultados_primarios : null,
        cpc_medio: m.cliques > 0 ? m.investimento / m.cliques : null,
        ctr: m.impressoes > 0 ? (m.cliques / m.impressoes) * 100 : null,
      };
    })
    .filter((i) => {
      switch (filtroStatus) {
        case 'ativas': return i.status === 'ENABLED';
        case 'pausadas': return i.status === 'PAUSED';
        case 'removidas': return i.status === 'REMOVED';
        case 'todas': return true;
        default: return i.status !== 'REMOVED';
      }
    })
    .sort((a, b) => b.investimento - a.investimento);

  return c.json({ periodo: { de, ate }, filtro_status: filtroStatus, total: itens.length, itens });
});

/** GET /api/meta/resultados-por-acao — de onde vêm as conversões. */
meta.get('/resultados-por-acao', async (c) => {
  const { de, ate } = intervalo(c);
  const [linha] = await insights(c.env, de, ate, { fields: 'actions' });

  const itens = Object.entries(ACOES_EXIBIDAS)
    .map(([tipoAcao, def]) => ({
      acao: def.nome,
      codigo: tipoAcao,
      tipo: def.tipo,
      resultados: somaAcoes(linha?.actions, [tipoAcao]),
    }))
    .filter((i) => i.resultados > 0);

  const total_primarios = itens.filter((i) => i.tipo === 'primaria').reduce((s, i) => s + i.resultados, 0);
  const total_secundarios = itens.filter((i) => i.tipo === 'secundaria').reduce((s, i) => s + i.resultados, 0);
  const total = total_primarios + total_secundarios;

  return c.json({
    periodo: { de, ate },
    total,
    total_primarios,
    total_secundarios,
    itens: itens.map((i) => ({ ...i, participacao_pct: total > 0 ? (i.resultados / total) * 100 : 0 })),
  });
});

/** Erro do Meta vira resposta própria — a tela distingue "Meta fora" de "painel quebrado". */
meta.onError((err, c) => {
  if (err instanceof ErroMetaAds) {
    return c.json({ erro: 'meta_ads_indisponivel', detalhe: err.message }, err.status as 500 | 502);
  }
  throw err;
});

export default meta;
