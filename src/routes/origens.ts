import { Hono } from 'hono';
import { cacheDeBorda } from '../lib/cacheBorda';
import { dataValida } from '../lib/googleAds';
import { NOME_CANAL, type Canal } from '../lib/origens';
import type { AppEnv } from '../lib/tipos';

/**
 * GET /api/origens — de que canal vieram as pessoas que preencheram formulário.
 *
 * Fonte: `origens_capturadas`, gravada pelo script do site (via GTM). Cada
 * pessoa conta UMA vez, no canal da sua captura mais recente do período —
 * último toque. Sem isso, quem chegou por um link orgânico e voltou por um
 * anúncio apareceria nos dois canais, e a soma dos canais passaria do total.
 *
 * "Viraram lead" é a pessoa existir no Rubeus (mesmo e-mail ou telefone). É o
 * que diz se o link trouxe gente para o processo, e não só formulário enviado.
 */
const origens = new Hono<AppEnv>();

origens.get('/', cacheDeBorda(300), async (c) => {
  const hoje = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
  const de = dataValida(c.req.query('de')) ? c.req.query('de')! : hoje.slice(0, 8) + '01';
  const ate = dataValida(c.req.query('ate')) ? c.req.query('ate')! : hoje;

  /*
   * Uma CTE só, reaproveitada pelas três leituras: a última captura de cada
   * pessoa no período (data em Brasília) e se ela existe no Rubeus.
   */
  const base = `
    WITH periodo AS (
      SELECT o.*, COALESCE(o.email, o.telefone) AS pessoa,
             ROW_NUMBER() OVER (PARTITION BY COALESCE(o.email, o.telefone) ORDER BY o.capturado_em DESC) AS ordem
        FROM origens_capturadas o
       WHERE date(o.capturado_em, '-3 hours') BETWEEN ?1 AND ?2
    ),
    ultima AS (
      SELECT p.*,
             (EXISTS (SELECT 1 FROM leads_etapa l WHERE p.email IS NOT NULL AND l.email = p.email)
              OR EXISTS (SELECT 1 FROM leads_etapa l WHERE p.telefone IS NOT NULL AND l.telefone = p.telefone)) AS virou_lead
        FROM periodo p WHERE p.ordem = 1
    )`;

  const [porCanal, porUtm, porReferencia, porDia] = await Promise.all([
    c.env.DB.prepare(`${base}
      SELECT canal, COUNT(*) AS pessoas, SUM(virou_lead) AS leads FROM ultima GROUP BY canal`)
      .bind(de, ate).all<{ canal: Canal; pessoas: number; leads: number }>(),
    c.env.DB.prepare(`${base}
      SELECT canal, COALESCE(utm_source, '') AS fonte, COALESCE(utm_medium, '') AS meio,
             COALESCE(utm_campaign, '') AS campanha, COUNT(*) AS pessoas, SUM(virou_lead) AS leads
        FROM ultima WHERE canal IN ('utm', 'google_ads', 'meta_ads')
       GROUP BY 1, 2, 3, 4 ORDER BY pessoas DESC LIMIT 300`)
      .bind(de, ate).all<{ canal: Canal; fonte: string; meio: string; campanha: string; pessoas: number; leads: number }>(),
    c.env.DB.prepare(`${base}
      SELECT canal, COALESCE(referencia, '(direto)') AS referencia, COUNT(*) AS pessoas, SUM(virou_lead) AS leads
        FROM ultima WHERE canal IN ('busca', 'social', 'referencia', 'direto')
       GROUP BY 1, 2 ORDER BY pessoas DESC LIMIT 100`)
      .bind(de, ate).all<{ canal: Canal; referencia: string; pessoas: number; leads: number }>(),
    c.env.DB.prepare(`${base}
      SELECT date(capturado_em, '-3 hours') AS data, canal, COUNT(*) AS pessoas FROM ultima GROUP BY 1, 2 ORDER BY 1`)
      .bind(de, ate).all<{ data: string; canal: Canal; pessoas: number }>(),
  ]);

  // Todos os canais aparecem, mesmo zerados: canal que some da tela parece
  // canal que não existe, não canal que não trouxe ninguém.
  const contagem = new Map(porCanal.results.map((r) => [r.canal, r]));
  const canais = (Object.keys(NOME_CANAL) as Canal[]).map((id) => ({
    id,
    nome: NOME_CANAL[id],
    pessoas: contagem.get(id)?.pessoas ?? 0,
    leads: contagem.get(id)?.leads ?? 0,
  }));

  // Série por dia com uma coluna por canal, no formato que os gráficos já usam.
  const dias = new Map<string, Record<string, number | string>>();
  for (const r of porDia.results) {
    const d = dias.get(r.data) ?? { data: r.data, ...Object.fromEntries(canais.map((k) => [k.id, 0])) };
    d[r.canal] = r.pessoas;
    dias.set(r.data, d);
  }

  return c.json({
    periodo: { de, ate },
    total: canais.reduce((s, k) => s + k.pessoas, 0),
    canais,
    utms: porUtm.results,
    referencias: porReferencia.results,
    serie_diaria: [...dias.values()],
  });
});

export default origens;
