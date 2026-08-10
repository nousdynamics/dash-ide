import { Hono } from 'hono';
import { ehAdmin, exigirAdmin } from '../lib/access';
import { intervaloDeQuery } from '../lib/periodo';
import { funilMarketing } from '../lib/rdstation';
import {
  ErroRubeus,
  sincronizarCursos,
  sincronizarEtapasDeOportunidades,
} from '../lib/rubeus';
import {
  funilQuerySchema,
  macroQuerySchema,
  paginacaoQuerySchema,
  periodoQuerySchema,
} from '../lib/schemas';
import type { AppEnv } from '../lib/tipos';

/**
 * Agregados do D1 — funil Rubeus / Macro (planilha) e conversas Evolution.
 * Investimento e Ads ficam em /api/ads.
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

const MACRO_ORDEM = [
  'visitantes',
  'leads',
  'qualificados',
  'oportunidade',
  'inscricao',
  'matricula',
] as const;

const MACRO_ROTULOS: Record<(typeof MACRO_ORDEM)[number], string> = {
  visitantes: 'Visitantes',
  leads: 'Leads',
  qualificados: 'Leads qualificados',
  oportunidade: 'Oportunidades',
  inscricao: 'Inscrições',
  matricula: 'Matrículas',
};

const CATEGORIA_ROTULOS: Record<string, string> = {
  pos_presencial: 'Pós presencial',
  pos_ead: 'Pós EAD',
  pos_medicina: 'Pós Medicina',
  grad_rh_ead: 'Graduação RH EAD',
  grad_psicologia: 'Graduação Psicologia',
  grad_estetica: 'Graduação Estética',
  curta_duracao: 'Curta duração',
};

type FonteEtapa = 'rd_marketing' | 'rubeus' | 'misto' | 'indisponivel';

/**
 * Filtros compartilhados de curso/categoria/modalidade sobre `leads_etapa`.
 * Categoria resolve por código cadastrado ou padrão LIKE no nome do curso.
 */
function clausulasFiltroCurso(opts: {
  curso_codigo?: string;
  categoria?: string;
  modalidade?: string;
  alias?: string;
}): { sql: string; binds: unknown[] } {
  const a = opts.alias ? `${opts.alias}.` : '';
  const binds: unknown[] = [];
  const partes: string[] = [];

  if (opts.curso_codigo) {
    partes.push(`(${a}curso_codigo = ? OR ${a}curso_id = ?)`);
    binds.push(opts.curso_codigo, opts.curso_codigo);
  }
  if (opts.modalidade) {
    partes.push(`lower(${a}modalidade) = lower(?)`);
    binds.push(opts.modalidade);
  }
  if (opts.categoria) {
    partes.push(`(
      EXISTS (
        SELECT 1 FROM curso_categorias cc
        WHERE cc.categoria = ?
          AND cc.curso_codigo IS NOT NULL
          AND cc.curso_codigo = ${a}curso_codigo
      )
      OR EXISTS (
        SELECT 1 FROM curso_categorias cc
        LEFT JOIN cursos cu ON cu.codigo = ${a}curso_codigo OR cu.id = ${a}curso_id
        WHERE cc.categoria = ?
          AND cc.padrao_nome IS NOT NULL
          AND lower(COALESCE(cu.nome, ${a}curso_codigo, '')) LIKE lower(cc.padrao_nome)
      )
    )`);
    binds.push(opts.categoria, opts.categoria);
  }

  return { sql: partes.length ? ` AND ${partes.join(' AND ')}` : '', binds };
}

api.get('/me', (c) => c.json({
  email: c.get('usuarioEmail') ?? null,
  admin: ehAdmin(c.env, c.get('usuarioEmail')),
}));

/** GET /api/overview?dias=30 — leads captados e conversas, direto do D1. */
api.get('/overview', async (c) => {
  const q = periodoQuerySchema.safeParse(c.req.query());
  if (!q.success) return c.json({ erro: 'parametros_invalidos', detalhe: q.error.issues }, 400);
  const { dias } = q.data;
  const j = janelas(dias);

  const DIA_BR = "date(registrado_em, '-3 hours')";

  const [leads, leadsAnterior, conversas, conversasRecentes, serieLeads, origens, porHora] =
    await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT COALESCE(email, telefone, contato_id)) AS total FROM leads_etapa WHERE registrado_em >= ?`,
    ).bind(j.inicio).first(),

    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT COALESCE(email, telefone, contato_id)) AS total
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

    c.env.DB.prepare(
      `SELECT dia, COUNT(*) AS leads FROM (
         SELECT COALESCE(email, telefone, contato_id) AS quem, MIN(${DIA_BR}) AS dia
         FROM leads_etapa WHERE registrado_em >= ?
         GROUP BY quem
       ) GROUP BY dia ORDER BY dia`,
    ).bind(j.inicio).all(),

    c.env.DB.prepare(
      `SELECT COALESCE(origem, '(sem origem)') AS origem,
              COUNT(DISTINCT COALESCE(email, telefone, contato_id)) AS total
       FROM leads_etapa WHERE registrado_em >= ?
       GROUP BY origem ORDER BY total DESC LIMIT 8`,
    ).bind(j.inicio).all(),

    c.env.DB.prepare(
      `SELECT CAST(strftime('%H', registrado_em, '-3 hours') AS INTEGER) AS hora,
              COUNT(DISTINCT COALESCE(email, telefone, contato_id)) AS total
       FROM leads_etapa WHERE registrado_em >= ?
       GROUP BY hora ORDER BY hora`,
    ).bind(j.inicio).all(),
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
    serie_leads: serieLeads.results,
    origens: origens.results,
    por_hora: Array.from({ length: 24 }, (_, h) => ({
      hora: h,
      total: num((porHora.results as Array<{ hora: number; total: number }>).find((r) => r.hora === h)?.total),
    })),
  });
});

async function contarDistinct(
  db: D1Database,
  inicio: string,
  fim: string,
  extraSql: string,
  binds: unknown[],
): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(DISTINCT COALESCE(email, telefone, contato_id)) AS total
     FROM leads_etapa
     WHERE registrado_em >= ? AND registrado_em <= ?${extraSql}`,
  ).bind(inicio, fim, ...binds).first();
  return num(row?.total);
}

/**
 * GET /api/funil/macro — visão principal da planilha.
 * Visitantes/Leads: RD Marketing. Qualificados+: Rubeus.
 */
api.get('/funil/macro', async (c) => {
  const q = macroQuerySchema.safeParse(c.req.query());
  if (!q.success) return c.json({ erro: 'parametros_invalidos', detalhe: q.error.issues }, 400);

  const iv = intervaloDeQuery({ de: q.data.de, ate: q.data.ate, dias: q.data.dias ?? 30 });
  if ('erro' in iv) return c.json({ erro: iv.erro }, 400);

  const filtros = clausulasFiltroCurso({
    curso_codigo: q.data.curso_codigo,
    categoria: q.data.categoria,
    modalidade: q.data.modalidade,
  });

  const rd = await funilMarketing(c.env, c.env.DB, iv.de, iv.ate);
  const rdAnt = q.data.comparar
    ? await funilMarketing(
        c.env,
        c.env.DB,
        iv.inicioAnteriorIso.slice(0, 10),
        iv.fimAnteriorIso.slice(0, 10),
      )
    : null;

  // Qualificados: tem curso. Filtros de curso/categoria já restringem.
  const qualSql = `${filtros.sql} AND (curso_id IS NOT NULL OR (curso_codigo IS NOT NULL AND curso_codigo != ''))`;
  const qualBinds = [...filtros.binds];

  const filtrosL = clausulasFiltroCurso({
    curso_codigo: q.data.curso_codigo,
    categoria: q.data.categoria,
    modalidade: q.data.modalidade,
    alias: 'l',
  });

  const contarMacro = async (macro: string, inicio: string, fim: string) => {
    const row = await c.env.DB.prepare(
      `SELECT COUNT(DISTINCT COALESCE(l.email, l.telefone, l.contato_id)) AS total
       FROM leads_etapa l
       WHERE l.registrado_em >= ? AND l.registrado_em <= ?
         AND (
           EXISTS (
             SELECT 1 FROM processo_etapas pe
             WHERE pe.etapa_nome = l.etapa
               AND pe.macro_etapa = ?
               AND (l.processo_id IS NULL OR pe.processo_id = l.processo_id)
           )
           OR (? = 'oportunidade' AND lower(l.etapa) LIKE '%oportunidade%')
           OR (? = 'inscricao' AND (lower(l.etapa) LIKE '%inscrit%' OR lower(l.etapa) LIKE '%inscri%'))
           OR (? = 'matricula' AND lower(l.etapa) LIKE '%matricula%')
         )
         ${filtrosL.sql}`,
    ).bind(inicio, fim, macro, macro, macro, macro, ...filtrosL.binds).first();
    return num(row?.total);
  };

  const [
    qualificados,
    oportunidades,
    inscricoes,
    matriculas,
    qualAnt,
    oppAnt,
    inscAnt,
    matAnt,
  ] = await Promise.all([
    contarDistinct(c.env.DB, iv.inicioIso, iv.fimIso, qualSql, qualBinds),
    contarMacro('oportunidade', iv.inicioIso, iv.fimIso),
    contarMacro('inscricao', iv.inicioIso, iv.fimIso),
    contarMacro('matricula', iv.inicioIso, iv.fimIso),
    q.data.comparar
      ? contarDistinct(c.env.DB, iv.inicioAnteriorIso, iv.fimAnteriorIso, qualSql, qualBinds)
      : Promise.resolve(0),
    q.data.comparar ? contarMacro('oportunidade', iv.inicioAnteriorIso, iv.fimAnteriorIso) : Promise.resolve(0),
    q.data.comparar ? contarMacro('inscricao', iv.inicioAnteriorIso, iv.fimAnteriorIso) : Promise.resolve(0),
    q.data.comparar ? contarMacro('matricula', iv.inicioAnteriorIso, iv.fimAnteriorIso) : Promise.resolve(0),
  ]);

  const visitantes = rd.ok ? num(rd.dados.visitors) : null;
  const leadsRd = rd.ok ? num(rd.dados.leads) : null;
  const visitantesAnt = rdAnt?.ok ? num(rdAnt.dados.visitors) : null;
  const leadsRdAnt = rdAnt?.ok ? num(rdAnt.dados.leads) : null;

  type Passo = {
    chave: (typeof MACRO_ORDEM)[number];
    etapa: string;
    total: number | null;
    fonte: FonteEtapa;
    taxa_desde_anterior_pct: number | null;
    periodo_anterior: number | null;
    delta_pct: number | null;
    delta_abs: number | null;
    indisponivel?: string;
  };

  const bruto: Array<{
    chave: (typeof MACRO_ORDEM)[number];
    total: number | null;
    anterior: number | null;
    fonte: FonteEtapa;
    indisponivel?: string;
  }> = [
    {
      chave: 'visitantes',
      total: visitantes,
      anterior: visitantesAnt,
      fonte: rd.ok ? 'rd_marketing' : 'indisponivel',
      indisponivel: rd.ok ? undefined : rd.motivo,
    },
    {
      chave: 'leads',
      total: leadsRd,
      anterior: leadsRdAnt,
      fonte: rd.ok ? 'rd_marketing' : 'indisponivel',
      indisponivel: rd.ok ? undefined : rd.motivo,
    },
    { chave: 'qualificados', total: qualificados, anterior: qualAnt, fonte: 'rubeus' },
    { chave: 'oportunidade', total: oportunidades, anterior: oppAnt, fonte: 'rubeus' },
    { chave: 'inscricao', total: inscricoes, anterior: inscAnt, fonte: 'rubeus' },
    { chave: 'matricula', total: matriculas, anterior: matAnt, fonte: 'rubeus' },
  ];

  const etapas: Passo[] = bruto.map((b, i) => {
    const ant = i === 0 ? null : bruto[i - 1];
    const taxa =
      ant && ant.total != null && ant.total > 0 && b.total != null
        ? Number(((b.total / ant.total) * 100).toFixed(1))
        : null;
    return {
      chave: b.chave,
      etapa: MACRO_ROTULOS[b.chave],
      total: b.total,
      fonte: b.fonte,
      taxa_desde_anterior_pct: taxa,
      periodo_anterior: b.anterior,
      delta_pct: b.total != null && b.anterior != null ? delta(b.total, b.anterior) : null,
      delta_abs: b.total != null && b.anterior != null ? b.total - b.anterior : null,
      indisponivel: b.indisponivel,
    };
  });

  // Breakdown por categoria: Inscrições e Matrículas (como na planilha).
  const categoriasLista = Object.keys(CATEGORIA_ROTULOS);
  const porCategoria = [];
  for (const cat of categoriasLista) {
    const fCat = clausulasFiltroCurso({
      categoria: cat,
      curso_codigo: q.data.curso_codigo,
      modalidade: q.data.modalidade,
      alias: 'l',
    });
    const [insc, mat] = await Promise.all([
      c.env.DB.prepare(
        `SELECT COUNT(DISTINCT COALESCE(l.email, l.telefone, l.contato_id)) AS total
         FROM leads_etapa l
         WHERE l.registrado_em >= ? AND l.registrado_em <= ?
           AND (
             EXISTS (SELECT 1 FROM processo_etapas pe
               WHERE pe.etapa_nome = l.etapa AND pe.macro_etapa = 'inscricao'
                 AND (l.processo_id IS NULL OR pe.processo_id = l.processo_id))
             OR lower(l.etapa) LIKE '%inscrit%' OR lower(l.etapa) LIKE '%inscri%'
           )
           ${fCat.sql}`,
      ).bind(iv.inicioIso, iv.fimIso, ...fCat.binds).first(),
      c.env.DB.prepare(
        `SELECT COUNT(DISTINCT COALESCE(l.email, l.telefone, l.contato_id)) AS total
         FROM leads_etapa l
         WHERE l.registrado_em >= ? AND l.registrado_em <= ?
           AND (
             EXISTS (SELECT 1 FROM processo_etapas pe
               WHERE pe.etapa_nome = l.etapa AND pe.macro_etapa = 'matricula'
                 AND (l.processo_id IS NULL OR pe.processo_id = l.processo_id))
             OR lower(l.etapa) LIKE '%matricula%'
           )
           ${fCat.sql}`,
      ).bind(iv.inicioIso, iv.fimIso, ...fCat.binds).first(),
    ]);
    porCategoria.push({
      categoria: cat,
      rotulo: CATEGORIA_ROTULOS[cat],
      inscricoes: num(insc?.total),
      matriculas: num(mat?.total),
    });
  }

  // Evolução mensal (ano corrente no intervalo).
  const evolucao = await c.env.DB.prepare(
    `SELECT strftime('%Y-%m', registrado_em, '-3 hours') AS mes,
            COUNT(DISTINCT CASE WHEN curso_id IS NOT NULL OR (curso_codigo IS NOT NULL AND curso_codigo != '')
              THEN COALESCE(email, telefone, contato_id) END) AS qualificados,
            COUNT(DISTINCT CASE WHEN lower(etapa) LIKE '%oportunidade%'
              THEN COALESCE(email, telefone, contato_id) END) AS oportunidades,
            COUNT(DISTINCT CASE WHEN lower(etapa) LIKE '%inscrit%' OR lower(etapa) LIKE '%inscri%'
              THEN COALESCE(email, telefone, contato_id) END) AS inscricoes,
            COUNT(DISTINCT CASE WHEN lower(etapa) LIKE '%matricula%'
              THEN COALESCE(email, telefone, contato_id) END) AS matriculas
     FROM leads_etapa
     WHERE registrado_em >= ? AND registrado_em <= ?
     GROUP BY mes ORDER BY mes`,
  ).bind(iv.inicioIso, iv.fimIso).all();

  return c.json({
    periodo: { de: iv.de, ate: iv.ate, dias: iv.dias },
    filtros: {
      curso_codigo: q.data.curso_codigo ?? null,
      categoria: q.data.categoria ?? null,
      modalidade: q.data.modalidade ?? null,
    },
    etapas,
    por_categoria: porCategoria,
    evolucao: evolucao.results,
    rd: rd.ok
      ? { ok: true as const }
      : { ok: false as const, motivo: rd.motivo },
  });
});

/**
 * GET /api/funil — detalhe por processo Rubeus (secundário).
 * Aceita de/ate ou dias; ordena por processo_etapas.ordem quando houver.
 */
api.get('/funil', async (c) => {
  const q = funilQuerySchema.safeParse(c.req.query());
  if (!q.success) return c.json({ erro: 'parametros_invalidos', detalhe: q.error.issues }, 400);

  const iv = intervaloDeQuery({
    de: q.data.de,
    ate: q.data.ate,
    dias: q.data.dias ?? 90,
  });
  if ('erro' in iv) return c.json({ erro: iv.erro }, 400);

  const fid = q.data.funil_id ? Number(q.data.funil_id) : null;
  const processoId = q.data.processo_id ?? null;
  const filtros = clausulasFiltroCurso({
    curso_codigo: q.data.curso_codigo,
    categoria: q.data.categoria,
    modalidade: q.data.modalidade,
  });

  const baseWhere = `
    registrado_em >= ? AND registrado_em <= ?
    AND (? IS NULL OR funil_id = ?)
    AND (? IS NULL OR processo_id = ?)
    ${filtros.sql}`;
  const baseBinds = [
    iv.inicioIso, iv.fimIso, fid, fid, processoId, processoId, ...filtros.binds,
  ];
  const antBinds = [
    iv.inicioAnteriorIso, iv.fimAnteriorIso, fid, fid, processoId, processoId, ...filtros.binds,
  ];

  const [contagens, anteriores, funis, ordens] = await Promise.all([
    c.env.DB.prepare(
      `SELECT etapa, COUNT(DISTINCT COALESCE(email, telefone, contato_id)) AS total
       FROM leads_etapa
       WHERE ${baseWhere}
       GROUP BY etapa`,
    ).bind(...baseBinds).all(),

    c.env.DB.prepare(
      `SELECT etapa, COUNT(DISTINCT COALESCE(email, telefone, contato_id)) AS total
       FROM leads_etapa
       WHERE ${baseWhere}
       GROUP BY etapa`,
    ).bind(...antBinds).all(),

    c.env.DB.prepare(
      `SELECT f.id, f.nome, f.processo_id,
              (SELECT COUNT(DISTINCT COALESCE(l.email, l.telefone, l.contato_id))
               FROM leads_etapa l WHERE l.funil_id = f.id) AS leads
       FROM funis f WHERE f.ativo = 1 ORDER BY leads DESC, f.id`,
    ).all(),

    c.env.DB.prepare(
      `SELECT etapa_nome, MIN(ordem) AS ordem, macro_etapa
       FROM processo_etapas
       GROUP BY etapa_nome`,
    ).all(),
  ]);

  const ordemPorNome = new Map<string, { ordem: number; macro: string | null }>(
    (ordens.results as Array<{ etapa_nome: string; ordem: number; macro_etapa: string | null }>)
      .map((r) => [r.etapa_nome, { ordem: num(r.ordem), macro: r.macro_etapa }]),
  );

  const antesPorEtapa = new Map<string, number>(
    (anteriores.results as Array<{ etapa: string; total: number }>).map((l) => [l.etapa, num(l.total)]),
  );

  const etapas = (contagens.results as Array<{ etapa: string; total: number }>)
    .map((l) => ({
      etapa: l.etapa,
      total: num(l.total),
      ordem: ordemPorNome.get(l.etapa)?.ordem ?? 10_000 - num(l.total),
      macro_etapa: ordemPorNome.get(l.etapa)?.macro ?? null,
    }))
    .sort((a, b) => a.ordem - b.ordem || b.total - a.total);

  const passos = etapas.map((atual, i) => {
    const anterior = i === 0 ? null : etapas[i - 1];
    const taxa =
      anterior && anterior.total > 0
        ? Number(((atual.total / anterior.total) * 100).toFixed(1))
        : null;
    const antes = antesPorEtapa.get(atual.etapa) ?? 0;
    return {
      etapa: atual.etapa,
      total: atual.total,
      macro_etapa: atual.macro_etapa,
      taxa_desde_anterior_pct: taxa,
      periodo_anterior: antes,
      delta_pct: delta(atual.total, antes),
      delta_abs: atual.total - antes,
      fonte: 'rubeus' as const,
    };
  });

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
    processo_id: processoId,
    periodo: { dias: iv.dias, de: iv.de, ate: iv.ate },
    etapas: passos,
    etapa_maior_queda: maiorQueda,
    funis_disponiveis: funis.results,
  });
});

api.get('/funil/serie', async (c) => {
  const q = funilQuerySchema.safeParse(c.req.query());
  if (!q.success) return c.json({ erro: 'parametros_invalidos', detalhe: q.error.issues }, 400);

  const iv = intervaloDeQuery({
    de: q.data.de,
    ate: q.data.ate,
    dias: q.data.dias ?? 30,
  });
  if ('erro' in iv) return c.json({ erro: iv.erro }, 400);

  const fid = q.data.funil_id ? Number(q.data.funil_id) : null;
  const etapa = c.req.query('etapa') || null;
  const filtros = clausulasFiltroCurso({
    curso_codigo: q.data.curso_codigo,
    categoria: q.data.categoria,
    modalidade: q.data.modalidade,
  });

  const DIA = 86_400_000;
  const BRASILIA = -3 * 3_600_000;
  const diaDe = (ms: number) => new Date(ms + BRASILIA).toISOString().slice(0, 10);

  const inicioAtual = new Date(iv.de + 'T00:00:00.000Z').getTime();
  const dias = iv.dias;
  const inicioAnterior = inicioAtual - dias * DIA;

  const { results } = await c.env.DB.prepare(
    `SELECT dia, COUNT(*) AS total FROM (
       SELECT COALESCE(email, telefone, contato_id) AS quem,
              date(MIN(registrado_em), '-3 hours') AS dia
       FROM leads_etapa
       WHERE registrado_em >= ?
         AND (? IS NULL OR funil_id = ?)
         AND (? IS NULL OR etapa = ?)
         ${filtros.sql}
       GROUP BY quem
     ) GROUP BY dia`,
  )
    .bind(new Date(inicioAnterior).toISOString(), fid, fid, etapa, etapa, ...filtros.binds)
    .all();

  const porDia = new Map<string, number>(
    (results as Array<{ dia: string; total: number }>).map((l) => [l.dia, num(l.total)]),
  );

  const serie = [];
  let acAtual = 0;
  let acAnterior = 0;
  for (let i = 0; i < dias; i++) {
    const dAtual = diaDe(inicioAtual + i * DIA);
    const dAnterior = diaDe(inicioAnterior + i * DIA);
    acAtual += porDia.get(dAtual) ?? 0;
    acAnterior += porDia.get(dAnterior) ?? 0;
    serie.push({
      data: dAtual,
      data_anterior: dAnterior,
      novos: porDia.get(dAtual) ?? 0,
      atual: acAtual,
      anterior: acAnterior,
    });
  }

  return c.json({
    funil_id: fid,
    etapa,
    dias,
    serie,
    total_atual: acAtual,
    total_anterior: acAnterior,
    delta_pct: delta(acAtual, acAnterior),
  });
});

api.get('/funil/leads', async (c) => {
  const fid = c.req.query('funil_id') ? Number(c.req.query('funil_id')) : null;
  const limite = Math.min(Number(c.req.query('limite') ?? 200) || 200, 500);

  /*
   * Um card por PESSOA, não por contato_id.
   *
   * O Rubeus emite id de contato diferente conforme o gatilho: RAFAEL DE PAULA
   * DA SILVA chegou como 1670626, 44176, 1670628 e 1670629 — a lista mostrava
   * quatro cards da mesma pessoa. A identidade é o e-mail (depois telefone,
   * depois o id), a mesma que o funil usa para contar.
   *
   * Processo repetido NÃO é duplicata: a mesma pessoa pode se inscrever em dois
   * cursos, e isso é jornada legítima. Por isso o card conta os registros de
   * processo distintos em vez de escondê-los — some a pessoa duplicada, fica o
   * processo repetido, que é o que a operação precisa enxergar.
   */
  const { results } = await c.env.DB.prepare(
    `WITH base AS (
       SELECT COALESCE(email, telefone, contato_id) AS quem, *
       FROM leads_etapa WHERE (? IS NULL OR funil_id = ?)
     ),
     agg AS (
       SELECT quem,
              COUNT(*)                               AS eventos,
              COUNT(DISTINCT contato_id)             AS ids_no_crm,
              COUNT(DISTINCT registro_processo_id)   AS processos,
              COUNT(DISTINCT curso_codigo)           AS cursos,
              MAX(registrado_em)                     AS ult
       FROM base GROUP BY quem
     ),
     ultimo AS (
       SELECT b.* FROM base b
        JOIN agg a ON a.quem = b.quem AND a.ult = b.registrado_em
        GROUP BY b.quem
     )
     SELECT a.quem, a.eventos, a.ids_no_crm, a.processos, a.cursos,
            a.ult AS registrado_em,
            u.etapa, u.curso_codigo, u.processo_nome, u.origem,
            u.contato_id, u.email, u.telefone,
            -- O evento mais recente às vezes vem sem nome; qualquer um serve.
            COALESCE(u.contato_nome,
                     (SELECT MAX(b2.contato_nome) FROM base b2 WHERE b2.quem = a.quem)) AS contato_nome
     FROM agg a JOIN ultimo u ON u.quem = a.quem
     ORDER BY a.ult DESC LIMIT ?`,
  )
    .bind(fid, fid, limite)
    .all();

  return c.json({ funil_id: fid, total: results.length, itens: results });
});

api.get('/funil/lead/:contato_id', async (c) => {
  const id = c.req.param('contato_id');
  if (!id) return c.json({ erro: 'id_invalido' }, 400);

  /*
   * O id da URL é uma porta de entrada, não a chave.
   *
   * A lista já mostra uma pessoa por card, mas essa pessoa pode ter vários
   * contato_id no Rubeus. Abrir por um só mostraria um pedaço da jornada e
   * esconderia justamente as outras inscrições — que é o que a operação precisa
   * ver quando alguém se candidata a dois cursos.
   */
  const identidade = await c.env.DB.prepare(
    `SELECT COALESCE(email, telefone, contato_id) AS quem FROM leads_etapa
      WHERE contato_id = ? ORDER BY registrado_em DESC LIMIT 1`,
  ).bind(id).first<{ quem: string }>();
  const quem = identidade?.quem ?? id;

  const [etapas, payloads] = await Promise.all([
    c.env.DB.prepare(
      `SELECT l.etapa, l.registrado_em, l.origem, l.processo_nome, l.status, l.unidade,
              l.curso_codigo, l.responsavel_comercial, l.contato_nome, l.contato_id,
              l.registro_processo_id, l.email, l.telefone,
              l.funil_id, COALESCE(f.nome, l.processo_nome, 'Sem funil') AS funil_nome
       FROM leads_etapa l LEFT JOIN funis f ON f.id = l.funil_id
       WHERE COALESCE(l.email, l.telefone, l.contato_id) = ?
       ORDER BY l.registrado_em ASC, l.id ASC`,
    ).bind(quem).all(),

    c.env.DB.prepare(
      `SELECT etapa, canal, status, detalhe, corpo, recebido_em
       FROM eventos_recebidos
       WHERE contato_id IN (
         SELECT DISTINCT contato_id FROM leads_etapa
          WHERE COALESCE(email, telefone, contato_id) = ?
       )
       ORDER BY recebido_em ASC, id ASC`,
    ).bind(quem).all(),
  ]);

  const linhas = etapas.results as Array<Record<string, any>>;
  const primeiro = linhas[0] ?? {};
  const ultimo = linhas[linhas.length - 1] ?? {};

  const porFunil = new Map<string, any>();
  for (const l of linhas) {
    const k = l.funil_nome;
    if (!porFunil.has(k)) {
      porFunil.set(k, { funil: k, funil_id: l.funil_id ?? null, passos: [] });
    }
    porFunil.get(k).passos.push(l);
  }
  const funis = [...porFunil.values()].map((f) => ({
    ...f,
    etapa_atual: f.passos[f.passos.length - 1]?.etapa ?? null,
    ultimo_em: f.passos[f.passos.length - 1]?.registrado_em ?? null,
  }));

  return c.json({
    contato_id: id,
    contato_nome: ultimo.contato_nome || primeiro.contato_nome || null,
    funis,
    origem: primeiro.origem ?? null,
    processo_nome: ultimo.processo_nome ?? primeiro.processo_nome ?? null,
    unidade: ultimo.unidade ?? null,
    curso_codigo: ultimo.curso_codigo ?? null,
    responsavel_comercial: ultimo.responsavel_comercial ?? null,
    etapa_atual: ultimo.etapa ?? null,
    primeiro_em: primeiro.registrado_em ?? null,
    ultimo_em: ultimo.registrado_em ?? null,
    jornada: linhas,
    payloads: payloads.results,
  });
});

api.get('/catalogo/cursos', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT c.id, c.codigo, c.nome, c.nivel_ensino, c.modalidade,
            (SELECT cc.categoria FROM curso_categorias cc
             WHERE cc.curso_codigo = c.codigo LIMIT 1) AS categoria
     FROM cursos c
     ORDER BY c.nome COLLATE NOCASE
     LIMIT 500`,
  ).all();

  const categorias = Object.entries(CATEGORIA_ROTULOS).map(([id, rotulo]) => ({ id, rotulo }));
  return c.json({ itens: results, categorias });
});

api.get('/catalogo/etapas', async (c) => {
  const processoId = c.req.query('processo_id') || null;
  const { results } = await c.env.DB.prepare(
    `SELECT processo_id, etapa_id, etapa_nome, ordem, macro_etapa
     FROM processo_etapas
     WHERE (? IS NULL OR processo_id = ?)
     ORDER BY ordem ASC, etapa_nome ASC`,
  ).bind(processoId, processoId).all();
  return c.json({ processo_id: processoId, itens: results });
});

/** Sync manual Rubeus — admin. */
api.post('/admin/rubeus/sync', exigirAdmin, async (c) => {
  try {
    const cursos = await sincronizarCursos(c.env, c.env.DB);
    const etapas = await sincronizarEtapasDeOportunidades(c.env, c.env.DB, 40);
    return c.json({ ok: true, cursos, etapas });
  } catch (e) {
    const status = e instanceof ErroRubeus ? e.status : 502;
    return c.json({ erro: 'sync_falhou', detalhe: String(e instanceof Error ? e.message : e) }, status as any);
  }
});

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
