import { Hono } from 'hono';
import { ehAdmin, exigirAdmin } from '../lib/access';
import { intervaloDeQuery } from '../lib/periodo';
import { funilMarketing } from '../lib/rdstation';
import {
  ErroRubeus,
  enriquecerCursoDosLeads,
  listarOportunidades,
  sincronizarCursos,
  sincronizarEtapasDeOportunidades,
} from '../lib/rubeus';
import {
  funilQuerySchema,
  macroQuerySchema,
  paginacaoQuerySchema,
  patchEtapaSchema,
  periodoQuerySchema,
  pessoasDaEtapaQuerySchema,
  reordenarEtapasSchema,
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

type FonteEtapa = 'rd_marketing' | 'rubeus' | 'planilha' | 'misto' | 'indisponivel';

/** Aceita valor único ou lista CSV (`a,b,c`) — multi-seleção dos filtros do funil. */
function listaCsv(v?: string | null): string[] {
  if (!v) return [];
  return [...new Set(v.split(',').map((s) => s.trim()).filter(Boolean))];
}

function inSql(expr: string, n: number): string {
  return `${expr} IN (${Array.from({ length: n }, () => '?').join(',')})`;
}

/**
 * Filtros CRM sobre `leads_etapa` (curso, categoria, modalidade, unidade, origem, funil/processo).
 * Cada campo aceita um ou vários valores (CSV). Categoria resolve via view `curso_categoria`.
 */
function clausulasFiltroCurso(opts: {
  curso_codigo?: string | string[];
  oferta_codigo?: string | string[];
  categoria?: string | string[];
  modalidade?: string | string[];
  unidade?: string | string[];
  origem?: string | string[];
  funil_id?: number | number[] | null;
  processo_id?: string | string[] | null;
  alias?: string;
}): { sql: string; binds: unknown[] } {
  const a = opts.alias ? `${opts.alias}.` : '';
  const binds: unknown[] = [];
  const partes: string[] = [];
  const asList = (v?: string | string[] | null): string[] =>
    Array.isArray(v) ? v.filter(Boolean) : listaCsv(v ?? undefined);

  /*
   * Oferta do Rubeus (turma/campus/semestre), não o curso-pai.
   * Aceita código da oferta ou id interno da tabela curso_ofertas.
   */
  const ofertas = asList(opts.oferta_codigo);
  if (ofertas.length === 1) {
    const v = ofertas[0];
    partes.push(`(
      ${a}oferta_codigo = ?
      OR ${a}curso_id = ?
      OR ${a}curso_id IN (SELECT id FROM curso_ofertas WHERE oferta_codigo = ?)
      OR ${a}oferta_codigo IN (SELECT oferta_codigo FROM curso_ofertas WHERE id = ?)
    )`);
    binds.push(v, v, v, v);
  } else if (ofertas.length > 1) {
    const ph = ofertas.map(() => '?').join(',');
    partes.push(`(
      ${inSql(`${a}oferta_codigo`, ofertas.length)}
      OR ${inSql(`${a}curso_id`, ofertas.length)}
      OR ${a}curso_id IN (SELECT id FROM curso_ofertas WHERE oferta_codigo IN (${ph}) OR id IN (${ph}))
      OR ${a}oferta_codigo IN (SELECT oferta_codigo FROM curso_ofertas WHERE id IN (${ph}))
    )`);
    binds.push(...ofertas, ...ofertas, ...ofertas, ...ofertas, ...ofertas);
  }

  const cursos = asList(opts.curso_codigo);
  if (cursos.length === 1) {
    partes.push(`(${a}curso_codigo = ? OR ${a}curso_id = ?)`);
    binds.push(cursos[0], cursos[0]);
  } else if (cursos.length > 1) {
    partes.push(`(${inSql(`${a}curso_codigo`, cursos.length)} OR ${inSql(`${a}curso_id`, cursos.length)})`);
    binds.push(...cursos, ...cursos);
  }

  const modalidades = asList(opts.modalidade);
  if (modalidades.length === 1) {
    partes.push(`lower(${a}modalidade) = lower(?)`);
    binds.push(modalidades[0]);
  } else if (modalidades.length > 1) {
    partes.push(`(${modalidades.map(() => `lower(${a}modalidade) = lower(?)`).join(' OR ')})`);
    binds.push(...modalidades);
  }

  const unidades = asList(opts.unidade);
  if (unidades.length === 1) {
    partes.push(`lower(${a}unidade) = lower(?)`);
    binds.push(unidades[0]);
  } else if (unidades.length > 1) {
    partes.push(`(${unidades.map(() => `lower(${a}unidade) = lower(?)`).join(' OR ')})`);
    binds.push(...unidades);
  }

  const origens = asList(opts.origem);
  if (origens.length === 1) {
    partes.push(`lower(${a}origem) = lower(?)`);
    binds.push(origens[0]);
  } else if (origens.length > 1) {
    partes.push(`(${origens.map(() => `lower(${a}origem) = lower(?)`).join(' OR ')})`);
    binds.push(...origens);
  }

  const funilIds = (Array.isArray(opts.funil_id)
    ? opts.funil_id
    : opts.funil_id != null
      ? [opts.funil_id]
      : []
  ).filter((n) => n != null && !Number.isNaN(n));
  if (funilIds.length === 1) {
    partes.push(`${a}funil_id = ?`);
    binds.push(funilIds[0]);
  } else if (funilIds.length > 1) {
    partes.push(inSql(`${a}funil_id`, funilIds.length));
    binds.push(...funilIds);
  }

  const processos = asList(opts.processo_id);
  if (processos.length === 1) {
    partes.push(`${a}processo_id = ?`);
    binds.push(processos[0]);
  } else if (processos.length > 1) {
    partes.push(inSql(`${a}processo_id`, processos.length));
    binds.push(...processos);
  }

  /*
   * Categoria vem da view `curso_categoria`, que já resolveu nível, nome e
   * desempate. Antes o critério estava escrito aqui também, e em outra versão:
   * casava `padrao_nome` contra `cursos.nome` e ignorava as ofertas — onde mora
   * a graduação inteira, que só existe por semestre. Filtrar por "Graduação
   * Psicologia" não devolvia nada mesmo havendo inscrição.
   */
  const categorias = asList(opts.categoria);
  if (categorias.length === 1) {
    partes.push(`EXISTS (
      SELECT 1 FROM curso_categoria cc
      WHERE cc.categoria = ?
        AND ((${a}curso_codigo IS NOT NULL AND cc.curso_codigo = ${a}curso_codigo)
          OR (${a}curso_id     IS NOT NULL AND cc.curso_id     = ${a}curso_id))
    )`);
    binds.push(categorias[0]);
  } else if (categorias.length > 1) {
    partes.push(`EXISTS (
      SELECT 1 FROM curso_categoria cc
      WHERE ${inSql('cc.categoria', categorias.length)}
        AND ((${a}curso_codigo IS NOT NULL AND cc.curso_codigo = ${a}curso_codigo)
          OR (${a}curso_id     IS NOT NULL AND cc.curso_id     = ${a}curso_id))
    )`);
    binds.push(...categorias);
  }

  return { sql: partes.length ? ` AND ${partes.join(' AND ')}` : '', binds };
}

function filtrosDaQuery(q: {
  curso_codigo?: string;
  oferta_codigo?: string;
  categoria?: string;
  modalidade?: string;
  unidade?: string;
  origem?: string;
  funil_id?: string;
  processo_id?: string;
}, alias?: string) {
  const funilIds = listaCsv(q.funil_id)
    .map(Number)
    .filter((n) => !Number.isNaN(n));
  return clausulasFiltroCurso({
    curso_codigo: listaCsv(q.curso_codigo),
    oferta_codigo: listaCsv(q.oferta_codigo),
    categoria: listaCsv(q.categoria),
    modalidade: listaCsv(q.modalidade),
    unidade: listaCsv(q.unidade),
    origem: listaCsv(q.origem),
    funil_id: funilIds.length ? funilIds : null,
    processo_id: listaCsv(q.processo_id),
    alias,
  });
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
      `SELECT COUNT(DISTINCT pessoa_id) AS total FROM leads_etapa WHERE registrado_em >= ?`,
    ).bind(j.inicio).first(),

    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT pessoa_id) AS total
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
         SELECT pessoa_id AS quem, MIN(${DIA_BR}) AS dia
         FROM leads_etapa WHERE registrado_em >= ?
         GROUP BY quem
       ) GROUP BY dia ORDER BY dia`,
    ).bind(j.inicio).all(),

    c.env.DB.prepare(
      `SELECT COALESCE(origem, '(sem origem)') AS origem,
              COUNT(DISTINCT pessoa_id) AS total
       FROM leads_etapa WHERE registrado_em >= ?
       GROUP BY origem ORDER BY total DESC LIMIT 8`,
    ).bind(j.inicio).all(),

    c.env.DB.prepare(
      `SELECT CAST(strftime('%H', registrado_em, '-3 hours') AS INTEGER) AS hora,
              COUNT(DISTINCT pessoa_id) AS total
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

/*
 * De onde a pessoa veio: último curso e último funil que ela demonstrou.
 *
 * Fica num lugar só porque a tabela por categoria e a gaveta que abre a lista
 * PRECISAM concordar. Se cada uma resolvesse a categoria do seu jeito, a soma
 * da tabela e a contagem da gaveta divergiriam, e aí não dá para conferir
 * número nenhum — que é justamente para o que a gaveta serve.
 */
const CTE_ORIGEM_DA_PESSOA = `
  pessoa_curso AS (
    SELECT l.pessoa_id AS pessoa,
           l.curso_codigo, l.curso_id, l.oferta_codigo, l.oferta_nome,
           ROW_NUMBER() OVER (
             PARTITION BY l.pessoa_id
             ORDER BY l.registrado_em DESC
           ) AS recencia
      FROM leads_etapa l
     WHERE (l.curso_codigo IS NOT NULL AND l.curso_codigo != '')
        OR (l.curso_id IS NOT NULL AND l.curso_id != '')
        OR (l.oferta_codigo IS NOT NULL AND l.oferta_codigo != '')
        OR (l.oferta_nome IS NOT NULL AND l.oferta_nome != '')
  ),
  curso_da_pessoa AS (
    SELECT pessoa, curso_codigo, curso_id, oferta_codigo, oferta_nome
      FROM pessoa_curso WHERE recencia = 1
  ),
  pessoa_funil AS (
    SELECT l.pessoa_id AS pessoa,
           l.funil_id,
           ROW_NUMBER() OVER (
             PARTITION BY l.pessoa_id
             ORDER BY l.registrado_em DESC
           ) AS recencia
      FROM leads_etapa l
     WHERE l.funil_id IS NOT NULL
  ),
  funil_da_pessoa AS (
    SELECT pessoa, funil_id FROM pessoa_funil WHERE recencia = 1
  )`;

/*
 * Curso primeiro, funil depois.
 *
 * O curso é preciso — diz pós EAD contra pós presencial. O funil é grosso, mas
 * é a configuração que o próprio time fez no Rubeus (um webhook por funil) e
 * vale quando o curso não veio no payload. Só entra onde determina UMA
 * categoria: `categoria_fallback` é nulo para "Pós-Graduação", que não separa
 * presencial de EAD de medicina.
 */
const SQL_CATEGORIA_RESOLVIDA = `COALESCE(
  (SELECT cc.categoria FROM curso_categoria cc
    WHERE cc.categoria IS NOT NULL
      AND ((cd.oferta_codigo IS NOT NULL AND cc.oferta_codigo = cd.oferta_codigo)
        OR (cd.curso_codigo  IS NOT NULL AND cc.curso_codigo  = cd.curso_codigo)
        OR (cd.curso_id      IS NOT NULL AND cc.curso_id      = cd.curso_id)
        OR (cd.oferta_nome   IS NOT NULL AND cd.oferta_nome != ''
            AND cc.nome = cd.oferta_nome))
    LIMIT 1),
  (SELECT f.categoria_fallback FROM funis f WHERE f.id = fd.funil_id),
  ''
)`;

/**
 * GET /api/funil/macro — visão principal da planilha.
 * Visitantes/Leads: RD Marketing. Qualificados+: Rubeus.
 */
api.get('/funil/macro', async (c) => {
  const q = macroQuerySchema.safeParse(c.req.query());
  if (!q.success) return c.json({ erro: 'parametros_invalidos', detalhe: q.error.issues }, 400);

  const iv = intervaloDeQuery({
    mes: q.data.mes,
    ano: q.data.ano,
    de: q.data.de,
    ate: q.data.ate,
    dias: q.data.dias ?? 30,
  });
  if ('erro' in iv) return c.json({ erro: iv.erro }, 400);

  const filtros = filtrosDaQuery(q.data);
  const filtrosL = filtrosDaQuery(q.data, 'l');

  const rd = await funilMarketing(c.env, c.env.DB, iv.de, iv.ate);
  const rdAnt = q.data.comparar
    ? await funilMarketing(
        c.env,
        c.env.DB,
        iv.inicioAnteriorIso.slice(0, 10),
        iv.fimAnteriorIso.slice(0, 10),
      )
    : null;

  /*
   * Um funil conta acumulado: quem se matriculou também é inscrito, também é
   * oportunidade, também é qualificado.
   *
   * Antes cada etapa contava só quem estava PARADO nela no período, e por isso
   * o painel exibia 78 inscrições contra 66 oportunidades — não porque alguém
   * pulasse etapa, mas porque quem seguiu adiante saía da contagem de trás.
   * Assim as taxas também passam a significar o que a planilha diz que
   * significam: "de cada 100 oportunidades, quantas viraram inscrição".
   *
   * O topo alcançado por pessoa resolve isso de uma vez, e de quebra garante o
   * que um funil promete de graça — cada etapa é menor ou igual à anterior.
   */
  const RANK_MACRO = `
    WITH rank_macro(macro, nivel) AS (
      VALUES ('qualificados', 1), ('oportunidade', 2), ('inscricao', 3), ('matricula', 4)
    ),
    topo AS (
      SELECT l.pessoa_id AS pessoa,
             MAX(rank_macro.nivel) AS nivel
        FROM leads_etapa l
        JOIN processo_etapas pe
          ON pe.etapa_nome = l.etapa
         AND (l.processo_id IS NULL OR pe.processo_id = l.processo_id)
        JOIN rank_macro ON rank_macro.macro = pe.macro_etapa
       WHERE l.registrado_em >= ? AND l.registrado_em <= ?
         REPLACE_MESES
         REPLACE_FILTRO
       GROUP BY pessoa
    )`;

  /*
   * As quatro etapas numa consulta só. Eram oito idas ao D1 (quatro etapas x
   * dois períodos) e agora são duas, o que também elimina a chance de duas
   * etapas serem lidas de estados diferentes do banco.
   */
  /*
   * Os meses que a planilha cobre saem da contagem medida.
   *
   * Não é para somar os dois: janeiro a junho tem resíduo de evento no D1 —
   * uns poucos que a sincronização de oportunidades trouxe — e somá-lo ao
   * número da planilha contaria a mesma matrícula duas vezes. Onde a planilha
   * responde, ela responde sozinha; onde não há planilha, o medido responde
   * sozinho. Nunca os dois pelo mesmo mês.
   */
  const mesesPlanilha = (await c.env.DB.prepare(
    `SELECT DISTINCT mes FROM funil_historico
      WHERE mes >= ? AND mes <= ?`,
  ).bind(iv.de.slice(0, 7), iv.ate.slice(0, 7)).all()).results as Array<{ mes: string }>;

  const listaMeses = mesesPlanilha.map((m) => m.mes);
  const sqlMeses = listaMeses.length
    ? ` AND strftime('%Y-%m', l.registrado_em, '-3 hours') NOT IN (${listaMeses.map(() => '?').join(',')})`
    : '';

  const contarFunil = async (inicio: string, fim: string) => {
    const row = await c.env.DB.prepare(
      `${RANK_MACRO.replace('REPLACE_MESES', sqlMeses).replace('REPLACE_FILTRO', filtrosL.sql)}
       SELECT
         (SELECT COUNT(*) FROM topo WHERE nivel >= 1) AS qualificados,
         (SELECT COUNT(*) FROM topo WHERE nivel >= 2) AS oportunidades,
         (SELECT COUNT(*) FROM topo WHERE nivel >= 3) AS inscricoes,
         (SELECT COUNT(*) FROM topo WHERE nivel >= 4) AS matriculas`,
    ).bind(inicio, fim, ...listaMeses, ...filtrosL.binds).first();
    return {
      qualificados: num(row?.qualificados),
      oportunidades: num(row?.oportunidades),
      inscricoes: num(row?.inscricoes),
      matriculas: num(row?.matriculas),
    };
  };

  const vazio = { qualificados: 0, oportunidades: 0, inscricoes: 0, matriculas: 0 };
  const [atual, anterior] = await Promise.all([
    contarFunil(iv.inicioIso, iv.fimIso),
    q.data.comparar
      ? contarFunil(iv.inicioAnteriorIso, iv.fimAnteriorIso)
      : Promise.resolve(vazio),
  ]);

  /*
   * O que a planilha informa para os meses fechados, somado ao que foi medido
   * nos meses que ela não cobre. Um mês nunca entra pelos dois.
   */
  const somaHistorico = async (de: string, ate: string) => {
    const linhas = (await c.env.DB.prepare(
      `SELECT etapa, SUM(valor) AS total FROM funil_historico
        WHERE mes >= ? AND mes <= ? GROUP BY etapa`,
    ).bind(de.slice(0, 7), ate.slice(0, 7)).all()).results as Array<{ etapa: string; total: number }>;
    const m = new Map(linhas.map((l) => [l.etapa, num(l.total)]));
    return {
      qualificados: m.get('qualificados') ?? 0,
      oportunidades: m.get('oportunidade') ?? 0,
      inscricoes: m.get('inscricao') ?? 0,
      matriculas: m.get('matricula') ?? 0,
    };
  };

  /*
   * Filtro de curso e planilha não convivem: o histórico é um total por mês,
   * sem curso por trás. Pedir "Pós EAD em junho" não pode devolver o total de
   * junho inteiro rotulado como Pós EAD.
   */
  const semFiltroDeCurso = !q.data.categoria && !q.data.curso_codigo
    && !q.data.oferta_codigo && !q.data.modalidade;
  const hist = semFiltroDeCurso ? await somaHistorico(iv.de, iv.ate) : vazio;
  const histAnt = semFiltroDeCurso && q.data.comparar
    ? await somaHistorico(iv.inicioAnteriorIso.slice(0, 10), iv.fimAnteriorIso.slice(0, 10))
    : vazio;

  const qualificados = atual.qualificados + hist.qualificados;
  const oportunidades = atual.oportunidades + hist.oportunidades;
  const inscricoes = atual.inscricoes + hist.inscricoes;
  const matriculas = atual.matriculas + hist.matriculas;

  /** Rubeus, planilha, ou os dois quando o período pega meses de cada tipo. */
  const fonteDe = (medido: number, planilha: number): FonteEtapa =>
    planilha > 0 ? (medido > 0 ? 'misto' : 'planilha') : 'rubeus';
  const qualAnt = anterior.qualificados + histAnt.qualificados;
  const oppAnt = anterior.oportunidades + histAnt.oportunidades;
  const inscAnt = anterior.inscricoes + histAnt.inscricoes;
  const matAnt = anterior.matriculas + histAnt.matriculas;

  /*
   * O RD manda no topo — menos quando o topo que ele mediu é menor que a etapa
   * seguinte.
   *
   * Em janeiro o RD contou 86 leads e a planilha registra 1.162 qualificados.
   * Não é divergência de definição, é buraco de medição: a conta só passou a
   * marcar direito em abril, quando o número salta para 1.652. Publicar os 86
   * desenharia 1.351% de conversão de lead para qualificado, e o primeiro a
   * duvidar seria quem confia no painel.
   *
   * Onde a medição sobrevive à conferência ela vale, que foi a decisão tomada.
   * Onde ela quebra a ordem do funil, o mês fechado responde pelo próprio topo,
   * com a etiqueta dizendo de onde veio.
   */
  const topoHistorico = semFiltroDeCurso
    ? (await c.env.DB.prepare(
        `SELECT etapa, SUM(valor) AS total FROM funil_historico
          WHERE mes >= ? AND mes <= ? AND etapa IN ('visitantes', 'leads')
          GROUP BY etapa`,
      ).bind(iv.de.slice(0, 7), iv.ate.slice(0, 7)).all()).results as Array<{
        etapa: string; total: number;
      }>
    : [];
  const topoPlan = new Map(topoHistorico.map((r) => [r.etapa, num(r.total)]));

  const rdIncoerente =
    rd.ok && qualificados > 0 && num(rd.dados.leads) < qualificados && topoPlan.size > 0;

  const visitantes = rdIncoerente
    ? (topoPlan.get('visitantes') ?? null)
    : rd.ok ? num(rd.dados.visitors) : null;
  const leadsRd = rdIncoerente
    ? (topoPlan.get('leads') ?? null)
    : rd.ok ? num(rd.dados.leads) : null;
  const fonteTopo: FonteEtapa = rdIncoerente ? 'planilha' : rd.ok ? 'rd_marketing' : 'indisponivel';
  const visitantesAnt = rdAnt?.ok ? num(rdAnt.dados.visitors) : null;
  const leadsRdAnt = rdAnt?.ok ? num(rdAnt.dados.leads) : null;

  /*
   * Pico artificial de leads no RD (importação de base antiga).
   * Complementa rdIncoerente (RD com POUCOS leads): aqui o risco é EXCESSO.
   */
  let rdAlertaPico: {
    motivo: string;
    leads_rd: number;
    media_historica: number;
  } | null = null;
  if (rd.ok && !rdIncoerente && leadsRd != null) {
    const histLeads = await c.env.DB.prepare(
      `SELECT AVG(valor) AS media FROM funil_historico WHERE etapa = 'leads'`,
    ).first();
    const media = num(histLeads?.media);
    if (media > 0 && leadsRd > media * 2) {
      rdAlertaPico = {
        motivo: 'Leads do RD Marketing estão muito acima da média histórica da planilha — possível importação de base antiga.',
        leads_rd: leadsRd,
        media_historica: Number(media.toFixed(1)),
      };
    }
  }

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
      fonte: fonteTopo,
      indisponivel: rd.ok || rdIncoerente ? undefined : rd.motivo,
    },
    {
      chave: 'leads',
      total: leadsRd,
      anterior: leadsRdAnt,
      fonte: fonteTopo,
      indisponivel: rd.ok || rdIncoerente ? undefined : rd.motivo,
    },
    { chave: 'qualificados', total: qualificados, anterior: qualAnt, fonte: fonteDe(atual.qualificados, hist.qualificados) },
    { chave: 'oportunidade', total: oportunidades, anterior: oppAnt, fonte: fonteDe(atual.oportunidades, hist.oportunidades) },
    { chave: 'inscricao', total: inscricoes, anterior: inscAnt, fonte: fonteDe(atual.inscricoes, hist.inscricoes) },
    { chave: 'matricula', total: matriculas, anterior: matAnt, fonte: fonteDe(atual.matriculas, hist.matriculas) },
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

  /*
   * Inscrições e matrículas por categoria — a tabela do meio da planilha.
   *
   * A categoria é resolvida por PESSOA, não pelo evento. Os eventos de inscrição
   * e de matrícula chegam do Rubeus sem curso nenhum: das 309 linhas de
   * inscrição e 45 de matrícula no banco, zero casam com o catálogo. Só o evento
   * de qualificação traz curso. Perguntar o curso ao evento de matrícula é o que
   * deixava seis das sete categorias zeradas — não havia o que casar.
   *
   * Então o curso vem da própria pessoa: o último curso que ela demonstrou em
   * QUALQUER evento, e a matrícula dela conta na categoria desse curso. Ainda é
   * parcial — quem nunca passou por um evento com curso continua fora, e é por
   * isso que a tela mostra o total sem categoria em vez de escondê-lo.
   */
  const porCategoria = await (async () => {
    const fCat = filtrosDaQuery(q.data, 'l');

    const linhas = await c.env.DB.prepare(
      `WITH ${CTE_ORIGEM_DA_PESSOA},
       /*
        * Acumulado, igual ao funil de cima.
        *
        * Contar só quem tem evento DE inscrição deixaria a tabela somando menos
        * que a linha "Inscrições" do funil — quem foi direto para matrícula não
        * gera evento de inscrição e sumiria do meio. Na planilha as sete
        * categorias somam exatamente a linha do funil (82+3+8+0+0+1+27 = 121),
        * e duas respostas diferentes para "quantas inscrições" na mesma tela é
        * o tipo de divergência que faz alguém parar de confiar no painel.
        */
       marcos AS (
         SELECT l.pessoa_id AS pessoa,
                MAX(CASE pe.macro_etapa
                      WHEN 'qualificados' THEN 1 WHEN 'oportunidade' THEN 2
                      WHEN 'inscricao'    THEN 3 WHEN 'matricula'    THEN 4
                    END) AS nivel
           FROM leads_etapa l
           JOIN processo_etapas pe
             ON pe.etapa_nome = l.etapa
            AND (l.processo_id IS NULL OR pe.processo_id = l.processo_id)
          WHERE l.registrado_em >= ? AND l.registrado_em <= ?
            ${fCat.sql}
          GROUP BY pessoa
         HAVING nivel >= 3
       )
       SELECT ${SQL_CATEGORIA_RESOLVIDA} AS categoria,
              COALESCE(fu.nome, '') AS funil_nome,
              COUNT(*) AS inscricoes,
              SUM(CASE WHEN m.nivel >= 4 THEN 1 ELSE 0 END) AS matriculas
         FROM marcos m
         LEFT JOIN curso_da_pessoa cd ON cd.pessoa = m.pessoa
         LEFT JOIN funil_da_pessoa fd ON fd.pessoa = m.pessoa
         LEFT JOIN funis fu ON fu.id = fd.funil_id
        GROUP BY categoria, funil_nome`,
    ).bind(iv.inicioIso, iv.fimIso, ...fCat.binds).all();

    type Linha = { categoria: string; funil_nome: string; inscricoes: number; matriculas: number };
    const resultados = linhas.results as Linha[];

    const somaDe = (cat: string) =>
      resultados.filter((r) => r.categoria === cat).reduce(
        (a, r) => ({ inscricoes: a.inscricoes + num(r.inscricoes), matriculas: a.matriculas + num(r.matriculas) }),
        { inscricoes: 0, matriculas: 0 },
      );

    // As 7 categorias sempre aparecem, na ordem da planilha, mesmo zeradas —
    // uma linha ausente e uma linha em zero contam histórias diferentes.
    const lista = Object.keys(CATEGORIA_ROTULOS).map((cat) => ({
      categoria: cat,
      rotulo: CATEGORIA_ROTULOS[cat],
      ...somaDe(cat),
    }));

    /*
     * Quem o curso não resolveu vai agrupado pelo funil de origem, não num
     * balde único. "Pós-Graduação, curso não identificado: 16" diz em que
     * família a pessoa está e o que falta saber; "sem curso: 28" só diz que o
     * painel não sabe. A primeira dá para agir — é ir no Rubeus ver por que o
     * curso não vem naquele webhook.
     */
    const naoClassificados = resultados
      .filter((r) => !r.categoria)
      .map((r) => ({
        funil: r.funil_nome || null,
        rotulo: r.funil_nome
          ? `${r.funil_nome} — curso não identificado`
          : 'Sem curso nem funil de origem',
        inscricoes: num(r.inscricoes),
        matriculas: num(r.matriculas),
      }))
      .sort((a, b) => b.inscricoes - a.inscricoes);

    /*
     * As categorias da planilha entram somadas às medidas, pela mesma regra das
     * etapas: mês coberto pela planilha não é contado de novo pelo D1.
     */
    const histCat = semFiltroDeCurso
      ? (await c.env.DB.prepare(
          `SELECT categoria, SUM(inscricoes) AS inscricoes, SUM(matriculas) AS matriculas
             FROM funil_historico_categoria
            WHERE mes >= ? AND mes <= ? GROUP BY categoria`,
        ).bind(iv.de.slice(0, 7), iv.ate.slice(0, 7)).all()).results as Array<{
          categoria: string; inscricoes: number; matriculas: number;
        }>
      : [];
    const porHist = new Map(histCat.map((r) => [r.categoria, r]));

    for (const linha of lista) {
      linha.inscricoes += num(porHist.get(linha.categoria)?.inscricoes);
      linha.matriculas += num(porHist.get(linha.categoria)?.matriculas);
    }

    /*
     * Em janeiro as sete categorias da planilha somam 89 inscrições contra 99
     * na etapa do funil — divergência da própria planilha, em um dos seis
     * meses. A diferença vira linha própria em vez de sumir: se a tabela não
     * fechasse com o funil, a primeira conclusão de quem olha seria que o
     * painel está errado.
     */
    const somaCatHist = histCat.reduce(
      (a, r) => ({ i: a.i + num(r.inscricoes), m: a.m + num(r.matriculas) }),
      { i: 0, m: 0 },
    );
    const naoDetalhado = {
      inscricoes: Math.max(0, hist.inscricoes - somaCatHist.i),
      matriculas: Math.max(0, hist.matriculas - somaCatHist.m),
    };
    if (naoDetalhado.inscricoes > 0 || naoDetalhado.matriculas > 0) {
      naoClassificados.push({
        funil: null,
        rotulo: 'Planilha — sem detalhe por categoria',
        ...naoDetalhado,
      });
    }

    return { lista, nao_classificados: naoClassificados };
  })();

  /*
   * Evolução mês a mês — a aba "Evolução do Funil" da planilha.
   *
   * Mesma regra acumulada do funil de cima, aplicada por mês, para as duas
   * tabelas não se contradizerem. Antes esta consulta classificava por conta
   * própria, com `LIKE '%oportunidade%'` e afins: "Oportunidade (Inscrição
   * concluída)" entrava em oportunidades E em inscrições, e qualificados era
   * "tem curso" — três definições diferentes das usadas logo acima, na mesma
   * tela.
   *
   * O corte de mês usa -3 horas porque o Rubeus grava em UTC e a faculdade
   * fecha o mês em Brasília; sem isso, evento da noite do dia 31 cai no mês
   * seguinte.
   */
  const evolucao = await c.env.DB.prepare(
    `WITH rank_macro(macro, nivel) AS (
       VALUES ('qualificados', 1), ('oportunidade', 2), ('inscricao', 3), ('matricula', 4)
     ),
     topo AS (
       SELECT strftime('%Y-%m', l.registrado_em, '-3 hours') AS mes,
              l.pessoa_id AS pessoa,
              MAX(rank_macro.nivel) AS nivel
         FROM leads_etapa l
         JOIN processo_etapas pe
           ON pe.etapa_nome = l.etapa
          AND (l.processo_id IS NULL OR pe.processo_id = l.processo_id)
         JOIN rank_macro ON rank_macro.macro = pe.macro_etapa
        WHERE l.registrado_em >= ? AND l.registrado_em <= ?
          ${filtrosL.sql}
        GROUP BY mes, pessoa
     )
     SELECT mes,
            COUNT(*) AS qualificados,
            SUM(CASE WHEN nivel >= 2 THEN 1 ELSE 0 END) AS oportunidades,
            SUM(CASE WHEN nivel >= 3 THEN 1 ELSE 0 END) AS inscricoes,
            SUM(CASE WHEN nivel >= 4 THEN 1 ELSE 0 END) AS matriculas
       FROM topo
      GROUP BY mes ORDER BY mes`,
  ).bind(iv.inicioIso, iv.fimIso, ...filtrosL.binds).all();

  return c.json({
    periodo: {
      de: iv.de,
      ate: iv.ate,
      dias: iv.dias,
      tipo: iv.tipo,
      rotulo: iv.rotulo,
      anterior: { de: iv.inicioAnteriorIso.slice(0, 10), ate: iv.fimAnteriorIso.slice(0, 10) },
    },
    filtros: {
      curso_codigo: q.data.curso_codigo ?? null,
      categoria: q.data.categoria ?? null,
      modalidade: q.data.modalidade ?? null,
      unidade: q.data.unidade ?? null,
      origem: q.data.origem ?? null,
      funil_id: q.data.funil_id ?? null,
      processo_id: q.data.processo_id ?? null,
    },
    etapas,
    por_categoria: porCategoria.lista,
    por_categoria_nao_classificados: porCategoria.nao_classificados,
    evolucao: evolucao.results,
    rd_alerta_pico: rdAlertaPico,
    rd: rd.ok
      ? {
          ok: true as const,
          /*
           * O que o RD diz das etapas do meio, ao lado do que o Rubeus diz.
           *
           * Não entra no funil: "oportunidade" e "venda" no RD Marketing são as
           * etapas DELE, marcadas por automação de marketing, e não a
           * oportunidade e a matrícula do CRM. Fica exposto para dar para
           * comparar — e para quem for reconstruir mês fechado saber com o quê
           * está lidando.
           */
          qualificados: num(rd.dados.qualified_leads),
          oportunidades: num(rd.dados.opportunities),
          vendas: num(rd.dados.sales),
        }
      : { ok: false as const, motivo: rd.motivo },
  });
});

/**
 * GET /api/funil/macro/pessoas — quem está por trás de um número do funil.
 *
 * Um número agregado que ninguém consegue abrir é um número em que ninguém
 * consegue mexer: dá para desconfiar de "39 inscrições", mas não dá para
 * conferir. Esta rota devolve a lista que soma exatamente aquele card.
 *
 * A definição é a MESMA do agregado, de propósito — mesmo rank acumulado,
 * mesmo recorte de período, mesmos filtros. Se a lista e o card divergirem por
 * usarem critérios parecidos-mas-diferentes, a conferência vira mais uma
 * dúvida em vez de resposta.
 */
api.get('/funil/macro/pessoas', async (c) => {
  const q = pessoasDaEtapaQuerySchema.safeParse(c.req.query());
  if (!q.success) return c.json({ erro: 'parametros_invalidos', detalhe: q.error.issues }, 400);

  const iv = intervaloDeQuery({
    mes: q.data.mes,
    ano: q.data.ano,
    de: q.data.de,
    ate: q.data.ate,
    dias: q.data.dias ?? 30,
  });
  if ('erro' in iv) return c.json({ erro: iv.erro }, 400);

  const nivelMinimo = { qualificados: 1, oportunidade: 2, inscricao: 3, matricula: 4 }[q.data.etapa];

  const filtros = filtrosDaQuery(q.data, 'l');

  /*
   * `categoria_pessoa` ausente = não filtra. Presente e vazia = só quem ficou
   * sem curso identificado. São coisas diferentes, e `undefined` vs `''` é o
   * que as separa — por isso o teste é em `!== undefined`, não em verdade.
   */
  const filtraCategoria = q.data.categoria_pessoa !== undefined;
  const categoriaAlvo = q.data.categoria_pessoa ?? '';

  const base = `
    WITH rank_macro(macro, nivel) AS (
      VALUES ('qualificados', 1), ('oportunidade', 2), ('inscricao', 3), ('matricula', 4)
    ),
    ${CTE_ORIGEM_DA_PESSOA},
    topo AS (
      SELECT l.pessoa_id AS pessoa,
             MAX(rank_macro.nivel) AS nivel
        FROM leads_etapa l
        JOIN processo_etapas pe
          ON pe.etapa_nome = l.etapa
         AND (l.processo_id IS NULL OR pe.processo_id = l.processo_id)
        JOIN rank_macro ON rank_macro.macro = pe.macro_etapa
       WHERE l.registrado_em >= ? AND l.registrado_em <= ?
         ${filtros.sql}
       GROUP BY pessoa
      HAVING nivel >= ?
    ),
    -- O evento mais recente DENTRO do período dá o nome, a etapa e a data que
    -- a lista mostra. Fora do período seria outra pergunta.
    ultimo AS (
      SELECT l.pessoa_id AS pessoa,
             l.contato_id, l.contato_nome, l.email, l.telefone, l.etapa, l.registrado_em,
             ROW_NUMBER() OVER (
               PARTITION BY l.pessoa_id
               ORDER BY l.registrado_em DESC
             ) AS recencia
        FROM leads_etapa l
       WHERE l.registrado_em >= ? AND l.registrado_em <= ?
    ),
    listagem AS (
      SELECT u.contato_id, u.contato_nome, u.email, u.telefone, u.etapa, u.registrado_em,
             cd.curso_codigo,
             COALESCE(cd.oferta_nome, (SELECT k.nome FROM curso_catalogo k
               WHERE (cd.oferta_codigo IS NOT NULL AND k.oferta_codigo = cd.oferta_codigo)
                  OR (cd.curso_codigo  IS NOT NULL AND k.curso_codigo  = cd.curso_codigo)
                  OR (cd.curso_id      IS NOT NULL AND k.curso_id      = cd.curso_id)
               LIMIT 1)) AS curso_nome,
             (SELECT f.nome FROM funis f WHERE f.id = fd.funil_id) AS funil_nome,
             ${SQL_CATEGORIA_RESOLVIDA} AS categoria
        FROM topo t
        JOIN ultimo u ON u.pessoa = t.pessoa AND u.recencia = 1
        LEFT JOIN curso_da_pessoa cd ON cd.pessoa = t.pessoa
        LEFT JOIN funil_da_pessoa fd ON fd.pessoa = t.pessoa
    )
    SELECT %CAMPOS% FROM listagem
     WHERE (? = 0 OR categoria = ?)
       AND (? = 0 OR COALESCE(funil_nome, '') = ?)`;

  const filtraFunil = q.data.funil_nome !== undefined;
  const binds = [
    iv.inicioIso, iv.fimIso, ...filtros.binds, nivelMinimo,
    iv.inicioIso, iv.fimIso,
    filtraCategoria ? 1 : 0, categoriaAlvo,
    filtraFunil ? 1 : 0, q.data.funil_nome ?? '',
  ];

  const totalRow = await c.env.DB.prepare(base.replace('%CAMPOS%', 'COUNT(*) AS total'))
    .bind(...binds).first();
  const total = num(totalRow?.total);

  const porPagina = q.data.por_pagina;
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const pagina = Math.min(q.data.pagina, paginas);

  const itens = await c.env.DB.prepare(
    `${base.replace('%CAMPOS%', '*')}
     ORDER BY registrado_em DESC
     LIMIT ? OFFSET ?`,
  ).bind(...binds, porPagina, (pagina - 1) * porPagina).all();

  return c.json({
    periodo: { de: iv.de, ate: iv.ate, rotulo: iv.rotulo },
    etapa: q.data.etapa,
    rotulo_etapa: MACRO_ROTULOS[q.data.etapa],
    categoria_pessoa: filtraCategoria ? categoriaAlvo : null,
    total,
    pagina,
    paginas,
    por_pagina: porPagina,
    itens: itens.results,
  });
});

/**
 * GET /api/funil — detalhe por processo Rubeus (secundário).
 *
 * Conta quem tem ficha no CRM (`registro_processo_id` em algum evento do
 * contato), na etapa mais avançada do período. Eventos avançados muitas vezes
 * chegam sem o id da ficha; a etapa final ainda é lida, mas a unidade é a
 * ficha — alinhada ao kanban do Rubeus, sem inflar com sync sem registro.
 *
 * A esteira sempre lista as etapas visíveis do catálogo, mesmo zeradas.
 */
api.get('/funil', async (c) => {
  const q = funilQuerySchema.safeParse(c.req.query());
  if (!q.success) return c.json({ erro: 'parametros_invalidos', detalhe: q.error.issues }, 400);

  const iv = intervaloDeQuery({
    mes: q.data.mes,
    ano: q.data.ano,
    de: q.data.de,
    ate: q.data.ate,
    dias: q.data.dias ?? 90,
  });
  if ('erro' in iv) return c.json({ erro: iv.erro }, 400);

  const funilIds = listaCsv(q.data.funil_id)
    .map(Number)
    .filter((n) => !Number.isNaN(n));
  let processoIds = listaCsv(q.data.processo_id);
  if (!processoIds.length && funilIds.length) {
    const ph = funilIds.map(() => '?').join(',');
    const { results } = await c.env.DB.prepare(
      `SELECT DISTINCT processo_id FROM funis
        WHERE id IN (${ph}) AND ativo = 1 AND processo_id IS NOT NULL`,
    ).bind(...funilIds).all();
    processoIds = (results as Array<{ processo_id: string }>)
      .map((r) => String(r.processo_id))
      .filter(Boolean);
  }
  const processoId = processoIds.length === 1 ? processoIds[0] : null;
  const filtros = filtrosDaQuery({
    ...q.data,
    funil_id: undefined,
    processo_id: undefined,
  });

  const escopoPartes: string[] = [];
  const escopoBinds: unknown[] = [];
  if (funilIds.length === 1) {
    escopoPartes.push('funil_id = ?');
    escopoBinds.push(funilIds[0]);
  } else if (funilIds.length > 1) {
    escopoPartes.push(inSql('funil_id', funilIds.length));
    escopoBinds.push(...funilIds);
  }
  if (processoIds.length === 1) {
    escopoPartes.push('processo_id = ?');
    escopoBinds.push(processoIds[0]);
  } else if (processoIds.length > 1) {
    escopoPartes.push(inSql('processo_id', processoIds.length));
    escopoBinds.push(...processoIds);
  }

  const baseWhere = `
    registrado_em >= ? AND registrado_em <= ?
    ${escopoPartes.length ? `AND ${escopoPartes.join(' AND ')}` : ''}
    ${filtros.sql}`;
  const baseBinds = [
    iv.inicioIso, iv.fimIso, ...escopoBinds, ...filtros.binds,
  ];
  const antBinds = [
    iv.inicioAnteriorIso, iv.fimAnteriorIso, ...escopoBinds, ...filtros.binds,
  ];

  /*
   * 1) Descobre contatos que têm ficha no período.
   * 2) Junta todos os eventos desses contatos (e de quem compartilha o e-mail).
   * 3) Identidade = ficha quando existir; senão e-mail/telefone do contato.
   */
  const sqlLinhas = `
    WITH bruto AS (
      SELECT contato_id, email, telefone, etapa, registrado_em, registro_processo_id
        FROM leads_etapa
       WHERE ${baseWhere}
    ),
    email_do_contato AS (
      SELECT contato_id, MAX(email) AS email
        FROM bruto WHERE email IS NOT NULL AND email != '' GROUP BY contato_id
    ),
    tel_do_contato AS (
      SELECT contato_id, MAX(telefone) AS telefone
        FROM bruto WHERE telefone IS NOT NULL AND telefone != '' GROUP BY contato_id
    ),
    ficha_do_contato AS (
      SELECT contato_id, MAX(registro_processo_id) AS ficha
        FROM bruto
       WHERE registro_processo_id IS NOT NULL AND registro_processo_id != ''
       GROUP BY contato_id
    ),
    emails_com_ficha AS (
      SELECT DISTINCT COALESCE(NULLIF(b.email, ''), NULLIF(ec.email, '')) AS email
        FROM bruto b
        LEFT JOIN email_do_contato ec ON ec.contato_id = b.contato_id
        JOIN ficha_do_contato fc ON fc.contato_id = b.contato_id
       WHERE COALESCE(NULLIF(b.email, ''), NULLIF(ec.email, '')) IS NOT NULL
    )
    SELECT b.etapa, b.registrado_em,
           COALESCE(
             NULLIF(b.registro_processo_id, ''),
             NULLIF(fc.ficha, ''),
             NULLIF(b.email, ''),
             NULLIF(ec.email, ''),
             NULLIF(b.telefone, ''),
             NULLIF(tc.telefone, ''),
             b.contato_id
           ) AS pessoa
      FROM bruto b
      LEFT JOIN email_do_contato ec ON ec.contato_id = b.contato_id
      LEFT JOIN tel_do_contato tc ON tc.contato_id = b.contato_id
      LEFT JOIN ficha_do_contato fc ON fc.contato_id = b.contato_id
     WHERE fc.ficha IS NOT NULL
        OR COALESCE(NULLIF(b.email, ''), NULLIF(ec.email, '')) IN (SELECT email FROM emails_com_ficha)`;

  const [atuais, anteriores, funis, ordens] = await Promise.all([
    c.env.DB.prepare(sqlLinhas).bind(...baseBinds).all(),
    c.env.DB.prepare(sqlLinhas).bind(...antBinds).all(),

    c.env.DB.prepare(
      `WITH bruto AS (
         SELECT contato_id, email, telefone, funil_id, registro_processo_id
           FROM leads_etapa
          WHERE registrado_em >= ? AND registrado_em <= ?
       ),
       email_do_contato AS (
         SELECT contato_id, MAX(email) AS email
           FROM bruto WHERE email IS NOT NULL AND email != '' GROUP BY contato_id
       ),
       ficha_do_contato AS (
         SELECT contato_id, MAX(registro_processo_id) AS ficha
           FROM bruto
          WHERE registro_processo_id IS NOT NULL AND registro_processo_id != ''
          GROUP BY contato_id
       ),
       pessoas AS (
         SELECT DISTINCT f.id AS funil_id,
                COALESCE(NULLIF(b.registro_processo_id, ''), NULLIF(fc.ficha, ''),
                         NULLIF(b.email, ''), NULLIF(ec.email, ''), b.contato_id) AS quem
           FROM funis f
           JOIN bruto b ON b.funil_id = f.id
           LEFT JOIN email_do_contato ec ON ec.contato_id = b.contato_id
           LEFT JOIN ficha_do_contato fc ON fc.contato_id = b.contato_id
          WHERE f.ativo = 1 AND fc.ficha IS NOT NULL
       )
       SELECT f.id, f.nome, f.processo_id,
              (SELECT COUNT(*) FROM pessoas p WHERE p.funil_id = f.id) AS leads
         FROM funis f WHERE f.ativo = 1
         ORDER BY leads DESC, f.id`,
    ).bind(iv.inicioIso, iv.fimIso).all(),

    processoIds.length
      ? c.env.DB.prepare(
          `SELECT etapa_nome, MIN(ordem) AS ordem, macro_etapa,
                  MAX(visivel) AS visivel
             FROM processo_etapas
            WHERE processo_id IN (${processoIds.map(() => '?').join(',')})
            GROUP BY etapa_nome`,
        ).bind(...processoIds).all()
      : c.env.DB.prepare(
          `SELECT etapa_nome, MIN(ordem) AS ordem, macro_etapa,
                  MAX(visivel) AS visivel
             FROM processo_etapas
            GROUP BY etapa_nome`,
        ).all(),
  ]);

  const ordemPorNome = new Map<string, { ordem: number; macro: string | null; visivel: number }>(
    (ordens.results as Array<{ etapa_nome: string; ordem: number; macro_etapa: string | null; visivel: number }>)
      .map((r) => [r.etapa_nome, { ordem: num(r.ordem), macro: r.macro_etapa, visivel: num(r.visivel) }]),
  );

  type LinhaEtapa = { etapa: string; pessoa: string; registrado_em: string };
  const agregarPorTopo = (linhas: LinhaEtapa[]) => {
    const topoPorPessoa = new Map<string, { etapa: string; ordem: number; em: string }>();
    for (const l of linhas) {
      const meta = ordemPorNome.get(l.etapa);
      if ((meta?.visivel ?? 1) === 0) continue;
      const ordem = meta?.ordem ?? 7500;
      const atual = topoPorPessoa.get(l.pessoa);
      if (!atual || ordem > atual.ordem || (ordem === atual.ordem && l.registrado_em > atual.em)) {
        topoPorPessoa.set(l.pessoa, { etapa: l.etapa, ordem, em: l.registrado_em });
      }
    }
    const porEtapa = new Map<string, number>();
    for (const topo of topoPorPessoa.values()) {
      porEtapa.set(topo.etapa, (porEtapa.get(topo.etapa) ?? 0) + 1);
    }
    return { porEtapa, total: topoPorPessoa.size };
  };

  const atuaisAgg = agregarPorTopo(atuais.results as LinhaEtapa[]);
  const antesAgg = agregarPorTopo(anteriores.results as LinhaEtapa[]);
  const atuaisPorEtapa = atuaisAgg.porEtapa;
  const antesPorEtapa = antesAgg.porEtapa;

  /*
   * Catálogo primeiro: a esteira tem de existir mesmo zerada. Etapas que
   * apareceram só no evento (ainda sem linha no catálogo) entram no fim.
   */
  const nomesCatalogo = [...ordemPorNome.entries()]
    .filter(([nome, m]) => m.visivel !== 0 && (m.macro != null || atuaisPorEtapa.has(nome)))
    .map(([nome]) => nome);
  const nomesExtras = [...atuaisPorEtapa.keys()].filter((n) => !ordemPorNome.has(n));
  const nomesEsteira = [...nomesCatalogo, ...nomesExtras];

  const etapas = nomesEsteira
    .map((etapa) => ({
      etapa,
      total: atuaisPorEtapa.get(etapa) ?? 0,
      ordem: ordemPorNome.get(etapa)?.ordem ?? 7500,
      macro_etapa: ordemPorNome.get(etapa)?.macro ?? null,
      visivel: ordemPorNome.get(etapa)?.visivel ?? 1,
    }))
    .filter((l) => l.visivel !== 0)
    .sort((a, b) => a.ordem - b.ordem || b.total - a.total || a.etapa.localeCompare(b.etapa, 'pt-BR'));

  const passos = etapas.map((atual, i) => {
    const anterior = i === 0 ? null : etapas[i - 1];
    const taxa =
      anterior && anterior.total > 0 && atual.total > 0
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
    funil_id: funilIds.length === 1 ? funilIds[0] : null,
    funil_ids: funilIds,
    processo_id: processoId,
    processo_ids: processoIds,
    periodo: { dias: iv.dias, de: iv.de, ate: iv.ate },
    unidade: 'ficha',
    total_registros: atuaisAgg.total,
    etapas: passos,
    etapa_maior_queda: maiorQueda,
    funis_disponiveis: funis.results,
  });
});

api.get('/funil/serie', async (c) => {
  const q = funilQuerySchema.safeParse(c.req.query());
  if (!q.success) return c.json({ erro: 'parametros_invalidos', detalhe: q.error.issues }, 400);

  const iv = intervaloDeQuery({
    mes: q.data.mes,
    ano: q.data.ano,
    de: q.data.de,
    ate: q.data.ate,
    dias: q.data.dias ?? 30,
  });
  if ('erro' in iv) return c.json({ erro: iv.erro }, 400);

  const funilIds = listaCsv(q.data.funil_id)
    .map(Number)
    .filter((n) => !Number.isNaN(n));
  const etapa = c.req.query('etapa') || null;
  const filtros = filtrosDaQuery({
    ...q.data,
    funil_id: undefined,
  });

  const escopoFunil = funilIds.length === 0
    ? ''
    : funilIds.length === 1
      ? 'AND funil_id = ?'
      : `AND ${inSql('funil_id', funilIds.length)}`;
  const escopoBinds = funilIds;

  const DIA = 86_400_000;
  const BRASILIA = -3 * 3_600_000;
  const diaDe = (ms: number) => new Date(ms + BRASILIA).toISOString().slice(0, 10);

  const inicioAtual = new Date(iv.de + 'T00:00:00.000Z').getTime();
  const dias = iv.dias;
  const inicioAnterior = inicioAtual - dias * DIA;

  const ordens = await c.env.DB.prepare(
    `SELECT etapa_nome, MIN(ordem) AS ordem, MAX(visivel) AS visivel
       FROM processo_etapas
      GROUP BY etapa_nome`,
  ).all();
  const ordemPorNome = new Map<string, { ordem: number; visivel: number }>(
    (ordens.results as Array<{ etapa_nome: string; ordem: number; visivel: number }>)
      .map((r) => [r.etapa_nome, { ordem: num(r.ordem), visivel: num(r.visivel) }]),
  );

  type LinhaSerie = { etapa: string; pessoa: string; registrado_em: string };
  const contarPorDiaDoTopo = async (inicioIso: string, fimIso: string) => {
    const { results } = await c.env.DB.prepare(
      `WITH bruto AS (
         SELECT contato_id, email, telefone, etapa, registrado_em, registro_processo_id
           FROM leads_etapa
          WHERE registrado_em >= ? AND registrado_em <= ?
            ${escopoFunil}
            ${filtros.sql}
       ),
       email_do_contato AS (
         SELECT contato_id, MAX(email) AS email
           FROM bruto WHERE email IS NOT NULL AND email != '' GROUP BY contato_id
       ),
       tel_do_contato AS (
         SELECT contato_id, MAX(telefone) AS telefone
           FROM bruto WHERE telefone IS NOT NULL AND telefone != '' GROUP BY contato_id
       ),
       ficha_do_contato AS (
         SELECT contato_id, MAX(registro_processo_id) AS ficha
           FROM bruto
          WHERE registro_processo_id IS NOT NULL AND registro_processo_id != ''
          GROUP BY contato_id
       ),
       emails_com_ficha AS (
         SELECT DISTINCT COALESCE(NULLIF(b.email, ''), NULLIF(ec.email, '')) AS email
           FROM bruto b
           LEFT JOIN email_do_contato ec ON ec.contato_id = b.contato_id
           JOIN ficha_do_contato fc ON fc.contato_id = b.contato_id
          WHERE COALESCE(NULLIF(b.email, ''), NULLIF(ec.email, '')) IS NOT NULL
       )
       SELECT b.etapa, b.registrado_em,
              COALESCE(
                NULLIF(b.registro_processo_id, ''), NULLIF(fc.ficha, ''),
                NULLIF(b.email, ''), NULLIF(ec.email, ''),
                NULLIF(b.telefone, ''), NULLIF(tc.telefone, ''), b.contato_id
              ) AS pessoa
         FROM bruto b
         LEFT JOIN email_do_contato ec ON ec.contato_id = b.contato_id
         LEFT JOIN tel_do_contato tc ON tc.contato_id = b.contato_id
         LEFT JOIN ficha_do_contato fc ON fc.contato_id = b.contato_id
        WHERE fc.ficha IS NOT NULL
           OR COALESCE(NULLIF(b.email, ''), NULLIF(ec.email, '')) IN (SELECT email FROM emails_com_ficha)`,
    )
      .bind(inicioIso, fimIso, ...escopoBinds, ...filtros.binds)
      .all();

    const topoPorPessoa = new Map<string, { etapa: string; ordem: number; em: string; primeiroNaEtapa: string }>();
    for (const l of results as LinhaSerie[]) {
      const meta = ordemPorNome.get(l.etapa);
      if ((meta?.visivel ?? 1) === 0) continue;
      const ordem = meta?.ordem ?? 7500;
      const atual = topoPorPessoa.get(l.pessoa);
      if (!atual || ordem > atual.ordem || (ordem === atual.ordem && l.registrado_em > atual.em)) {
        const primeiroNaEtapa =
          atual && atual.etapa === l.etapa && atual.primeiroNaEtapa < l.registrado_em
            ? atual.primeiroNaEtapa
            : l.registrado_em;
        topoPorPessoa.set(l.pessoa, {
          etapa: l.etapa,
          ordem,
          em: l.registrado_em,
          primeiroNaEtapa,
        });
        continue;
      }
      if (atual.etapa === l.etapa && l.registrado_em < atual.primeiroNaEtapa) {
        atual.primeiroNaEtapa = l.registrado_em;
      }
    }

    const porDia = new Map<string, number>();
    for (const topo of topoPorPessoa.values()) {
      if (etapa && topo.etapa !== etapa) continue;
      const dia = String(topo.primeiroNaEtapa).slice(0, 10);
      porDia.set(dia, (porDia.get(dia) ?? 0) + 1);
    }
    return porDia;
  };

  const porDiaAtual = await contarPorDiaDoTopo(iv.inicioIso, iv.fimIso);
  const porDiaAnterior = await contarPorDiaDoTopo(
    new Date(inicioAnterior).toISOString(),
    new Date(inicioAtual - 1).toISOString(),
  );

  const serie = [];
  let acAtual = 0;
  let acAnterior = 0;
  for (let i = 0; i < dias; i++) {
    const dAtual = diaDe(inicioAtual + i * DIA);
    const dAnterior = diaDe(inicioAnterior + i * DIA);
    acAtual += porDiaAtual.get(dAtual) ?? 0;
    acAnterior += porDiaAnterior.get(dAnterior) ?? 0;
    serie.push({
      data: dAtual,
      data_anterior: dAnterior,
      novos: porDiaAtual.get(dAtual) ?? 0,
      atual: acAtual,
      anterior: acAnterior,
    });
  }

  return c.json({
    funil_id: funilIds.length === 1 ? funilIds[0] : null,
    funil_ids: funilIds,
    etapa,
    dias,
    serie,
    total_atual: acAtual,
    total_anterior: acAnterior,
    delta_pct: delta(acAtual, acAnterior),
  });
});

api.get('/funil/leads', async (c) => {
  const funilIds = listaCsv(c.req.query('funil_id'))
    .map(Number)
    .filter((n) => !Number.isNaN(n));
  const porPagina = Math.min(Math.max(Number(c.req.query('por_pagina') ?? 24) || 24, 6), 100);
  const pagina = Math.max(Number(c.req.query('pagina') ?? 1) || 1, 1);
  const offset = (pagina - 1) * porPagina;

  /*
   * Busca no servidor, junto da paginação.
   *
   * Filtrar no navegador só funcionava porque a lista inteira vinha de uma vez.
   * Com página, uma busca client-side procuraria apenas dentro dos 24 abertos e
   * diria "nenhum lead" para quem está na página 3 — pior que não ter busca.
   */
  const busca = (c.req.query('busca') ?? '').trim().toLowerCase();
  const like = `%${busca}%`;
  const filtroBusca = busca
    ? ` AND (lower(COALESCE(contato_nome,'')) LIKE ?
            OR lower(COALESCE(email,'')) LIKE ?
            OR lower(COALESCE(curso_codigo,'')) LIKE ?
            OR contato_id LIKE ?)`
    : '';
  const bindsBusca = busca ? [like, like, like, like] : [];

  /*
   * Um card por PESSOA, não por contato_id.
   *
   * O Rubeus emite id de contato diferente conforme o gatilho e, pior, o mesmo
   * contato chega ora com e-mail, ora sem: MARIA CÉLIA (337676) gerava dois
   * cards — um em `maria.lima.med@gmail.com` e outro em `337676` — porque
   * `pessoa_id` caía no id quando o webhook vinha
   * sem contato. Antes de agrupar, o e-mail/telefone conhecidos do MESMO
   * contato_id (e o e-mail de qualquer outro id que já compartilhe esse e-mail)
   * viram a chave canônica.
   *
   * Processo repetido NÃO é duplicata: a mesma pessoa pode se inscrever em dois
   * cursos, e isso é jornada legítima. Por isso o card conta os registros de
   * processo distintos em vez de escondê-los.
   *
   * O filtro de busca entra no `base`, antes do agrupamento: basta UM evento da
   * pessoa casar para ela aparecer inteira, com todos os processos.
   */
  const escopoFunil = funilIds.length === 0
    ? ''
    : funilIds.length === 1
      ? 'WHERE funil_id = ?'
      : `WHERE ${inSql('funil_id', funilIds.length)}`;
  const escopoBinds = funilIds;
  // filtroBusca assumes AND after WHERE — adjust when no funil filter
  const filtroBuscaSql = busca
    ? (escopoFunil
      ? filtroBusca
      : ` WHERE (lower(COALESCE(contato_nome,'')) LIKE ?
            OR lower(COALESCE(email,'')) LIKE ?
            OR lower(COALESCE(curso_codigo,'')) LIKE ?
            OR contato_id LIKE ?)`)
    : '';

  const cte = `WITH bruto AS (
       SELECT * FROM leads_etapa ${escopoFunil}${filtroBuscaSql}
     ),
     email_do_contato AS (
       SELECT contato_id, MAX(email) AS email
         FROM bruto
        WHERE email IS NOT NULL AND email != ''
        GROUP BY contato_id
     ),
     tel_do_contato AS (
       SELECT contato_id, MAX(telefone) AS telefone
         FROM bruto
        WHERE telefone IS NOT NULL AND telefone != ''
        GROUP BY contato_id
     ),
     base AS (
       SELECT COALESCE(
                NULLIF(b.email, ''),
                NULLIF(ec.email, ''),
                NULLIF(b.telefone, ''),
                NULLIF(tc.telefone, ''),
                b.contato_id
              ) AS quem,
              b.*
         FROM bruto b
         LEFT JOIN email_do_contato ec ON ec.contato_id = b.contato_id
         LEFT JOIN tel_do_contato tc ON tc.contato_id = b.contato_id
     ),
     agg AS (
       SELECT quem,
              COUNT(*)                               AS eventos,
              COUNT(DISTINCT contato_id)             AS ids_no_crm,
              COUNT(DISTINCT registro_processo_id)   AS processos,
              COUNT(DISTINCT curso_codigo)           AS cursos,
              MAX(registrado_em)                     AS ult
       FROM base GROUP BY quem
     )`;

  const [pagRes, totalRes] = await Promise.all([
    c.env.DB.prepare(
      `${cte},
       ultimo AS (
         SELECT b.* FROM base b
          JOIN agg a ON a.quem = b.quem AND a.ult = b.registrado_em
          GROUP BY b.quem
       )
       SELECT a.quem, a.eventos, a.ids_no_crm, a.processos, a.cursos,
              a.ult AS registrado_em,
              u.etapa, u.curso_codigo, u.oferta_codigo, u.oferta_nome, u.processo_nome, u.origem,
              u.contato_id,
              COALESCE(NULLIF(u.email, ''),
                       (SELECT MAX(b2.email) FROM base b2
                         WHERE b2.quem = a.quem AND b2.email IS NOT NULL AND b2.email != '')) AS email,
              COALESCE(NULLIF(u.telefone, ''),
                       (SELECT MAX(b2.telefone) FROM base b2
                         WHERE b2.quem = a.quem AND b2.telefone IS NOT NULL AND b2.telefone != '')) AS telefone,
              COALESCE(u.contato_nome,
                       (SELECT MAX(b2.contato_nome) FROM base b2 WHERE b2.quem = a.quem)) AS contato_nome
       FROM agg a JOIN ultimo u ON u.quem = a.quem
       ORDER BY a.ult DESC LIMIT ? OFFSET ?`,
    )
      .bind(...escopoBinds, ...bindsBusca, porPagina, offset)
      .all(),

    // Total de PESSOAS que casam com o filtro — é o que pagina, não linhas.
    c.env.DB.prepare(`${cte} SELECT COUNT(*) AS total FROM agg`)
      .bind(...escopoBinds, ...bindsBusca)
      .first<{ total: number }>(),
  ]);

  const total = num(totalRes?.total);
  return c.json({
    funil_id: funilIds.length === 1 ? funilIds[0] : null,
    funil_ids: funilIds,
    total,
    pagina,
    por_pagina: porPagina,
    paginas: Math.max(1, Math.ceil(total / porPagina)),
    busca: busca || null,
    itens: pagRes.results,
  });
});

api.get('/funil/lead/:contato_id', async (c) => {
  const id = c.req.param('contato_id');
  if (!id) return c.json({ erro: 'id_invalido' }, 400);

  /*
   * O id da URL é uma porta de entrada, não a chave.
   *
   * A lista já mostra uma pessoa por card, mas essa pessoa pode ter vários
   * contato_id no Rubeus e eventos sem e-mail. Abrir por um só mostraria um
   * pedaço da jornada. Resolve a identidade pelo e-mail/telefone conhecidos do
   * contato; a jornada junta tudo que compartilha essa chave ou o mesmo
   * contato_id.
   */
  const identidade = await c.env.DB.prepare(
    `SELECT COALESCE(
              (SELECT NULLIF(email, '') FROM leads_etapa
                WHERE contato_id = ? AND email IS NOT NULL AND email != ''
                ORDER BY registrado_em DESC LIMIT 1),
              (SELECT NULLIF(telefone, '') FROM leads_etapa
                WHERE contato_id = ? AND telefone IS NOT NULL AND telefone != ''
                ORDER BY registrado_em DESC LIMIT 1),
              ?
            ) AS quem`,
  ).bind(id, id, id).first<{ quem: string }>();
  const quem = identidade?.quem ?? id;

  const [etapas, payloads] = await Promise.all([
    c.env.DB.prepare(
      `SELECT l.etapa, l.registrado_em, l.origem, l.processo_nome, l.status, l.unidade,
              l.curso_codigo, l.oferta_codigo, l.oferta_nome, l.responsavel_comercial,
              l.contato_nome, l.contato_id,
              l.registro_processo_id, l.email, l.telefone,
              l.funil_id, COALESCE(f.nome, l.processo_nome, 'Sem funil') AS funil_nome
       FROM leads_etapa l LEFT JOIN funis f ON f.id = l.funil_id
       WHERE l.contato_id IN (
               SELECT DISTINCT contato_id FROM leads_etapa
                WHERE contato_id = ?
                   OR (email IS NOT NULL AND email != '' AND email = ?)
                   OR (telefone IS NOT NULL AND telefone != '' AND telefone = ?)
             )
       ORDER BY l.registrado_em ASC, l.id ASC`,
    ).bind(id, quem, quem).all(),

    c.env.DB.prepare(
      `SELECT etapa, canal, status, detalhe, corpo, recebido_em
       FROM eventos_recebidos
       WHERE contato_id IN (
         SELECT DISTINCT contato_id FROM leads_etapa
          WHERE contato_id = ?
             OR (email IS NOT NULL AND email != '' AND email = ?)
             OR (telefone IS NOT NULL AND telefone != '' AND telefone = ?)
       )
       ORDER BY recebido_em ASC, id ASC`,
    ).bind(id, quem, quem).all(),
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
    oferta_codigo: ultimo.oferta_codigo ?? null,
    oferta_nome: ultimo.oferta_nome ?? null,
    responsavel_comercial: ultimo.responsavel_comercial ?? null,
    etapa_atual: ultimo.etapa ?? null,
    primeiro_em: primeiro.registrado_em ?? null,
    ultimo_em: ultimo.registrado_em ?? null,
    jornada: linhas,
    payloads: payloads.results,
  });
});

api.get('/catalogo/cursos', async (c) => {
  /*
   * Lista OFERTAS do Rubeus (turma/campus/semestre), não o curso-pai.
   * É o que aparece no kanban e no filtro do Funil.
   */
  const { results } = await c.env.DB.prepare(
    `SELECT o.id,
            o.oferta_codigo,
            o.curso_codigo,
            o.nome,
            o.nivel_ensino,
            o.modalidade,
            (SELECT cc.categoria FROM curso_categorias cc
              WHERE (cc.oferta_codigo IS NOT NULL AND cc.oferta_codigo = o.oferta_codigo)
                 OR (cc.curso_codigo IS NOT NULL AND cc.curso_codigo = o.curso_codigo)
              LIMIT 1) AS categoria
       FROM curso_ofertas o
      WHERE COALESCE(o.oferta_codigo, o.id, '') != ''
      ORDER BY o.nome COLLATE NOCASE
      LIMIT 800`,
  ).all();

  const categorias = Object.entries(CATEGORIA_ROTULOS).map(([id, rotulo]) => ({ id, rotulo }));
  return c.json({
    itens: (results as Array<Record<string, unknown>>).map((r) => ({
      ...r,
      /* Alias estável para o filtro: código da oferta, senão id interno. */
      codigo: r.oferta_codigo || r.id,
    })),
    categorias,
  });
});

api.get('/catalogo/etapas', async (c) => {
  const processoId = c.req.query('processo_id') || null;
  const { results } = await c.env.DB.prepare(
    `SELECT pe.processo_id, pe.etapa_id, pe.etapa_nome, pe.ordem, pe.macro_etapa,
            pe.visivel,
            COALESCE(
              (SELECT f.nome FROM funis f
                WHERE f.processo_id = pe.processo_id AND f.ativo = 1
                ORDER BY f.id LIMIT 1),
              (SELECT l.processo_nome FROM leads_etapa l
                WHERE l.processo_id = pe.processo_id
                  AND l.processo_nome IS NOT NULL AND l.processo_nome != ''
                ORDER BY l.registrado_em DESC LIMIT 1),
              pe.processo_id
            ) AS processo_nome
     FROM processo_etapas pe
     WHERE (? IS NULL OR pe.processo_id = ?)
     ORDER BY processo_nome COLLATE NOCASE, pe.ordem ASC, pe.etapa_nome ASC`,
  ).bind(processoId, processoId).all();
  return c.json({
    processo_id: processoId,
    itens: (results as Array<Record<string, unknown>>).map((r) => ({
      ...r,
      visivel: Number(r.visivel ?? 1) !== 0,
    })),
    pode_editar: ehAdmin(c.env, c.get('usuarioEmail')),
  });
});

/** Valores distintos para popular selects do Funil. */
api.get('/catalogo/filtros', async (c) => {
  const [modalidades, unidades, origens, funis] = await Promise.all([
    c.env.DB.prepare(
      `SELECT DISTINCT modalidade AS v FROM leads_etapa
       WHERE modalidade IS NOT NULL AND modalidade != ''
       ORDER BY modalidade COLLATE NOCASE LIMIT 100`,
    ).all(),
    c.env.DB.prepare(
      `SELECT DISTINCT unidade AS v FROM leads_etapa
       WHERE unidade IS NOT NULL AND unidade != ''
       ORDER BY unidade COLLATE NOCASE LIMIT 100`,
    ).all(),
    c.env.DB.prepare(
      `SELECT DISTINCT origem AS v FROM leads_etapa
       WHERE origem IS NOT NULL AND origem != ''
       ORDER BY origem COLLATE NOCASE LIMIT 100`,
    ).all(),
    c.env.DB.prepare(
      `SELECT f.id, f.nome, f.processo_id,
              (SELECT COUNT(DISTINCT l.pessoa_id)
               FROM leads_etapa l WHERE l.funil_id = f.id) AS leads
       FROM funis f WHERE f.ativo = 1 ORDER BY leads DESC, f.id`,
    ).all(),
  ]);
  const vals = (rows: { results: unknown[] }) =>
    (rows.results as Array<{ v: string }>).map((r) => r.v);
  return c.json({
    modalidades: vals(modalidades),
    unidades: vals(unidades),
    origens: vals(origens),
    funis: funis.results,
  });
});

api.patch('/catalogo/etapas', exigirAdmin, async (c) => {
  const corpo = await c.req.json().catch(() => null);
  const r = patchEtapaSchema.safeParse(corpo);
  if (!r.success) return c.json({ erro: 'parametros_invalidos', detalhe: r.error.issues }, 400);

  const { processo_id, etapa_nome, macro_etapa, ordem, visivel } = r.data;
  if (macro_etapa === undefined && ordem === undefined && visivel === undefined) {
    return c.json({ erro: 'nada_a_atualizar' }, 400);
  }

  const sets: string[] = ["atualizado_em = datetime('now')"];
  const binds: unknown[] = [];
  if (macro_etapa !== undefined) {
    sets.push('macro_etapa = ?');
    binds.push(macro_etapa);
  }
  if (ordem !== undefined) {
    sets.push('ordem = ?');
    binds.push(ordem);
  }
  if (visivel !== undefined) {
    sets.push('visivel = ?');
    binds.push(visivel ? 1 : 0);
  }
  binds.push(processo_id, etapa_nome);

  const { meta } = await c.env.DB.prepare(
    `UPDATE processo_etapas SET ${sets.join(', ')}
     WHERE processo_id = ? AND etapa_nome = ?`,
  ).bind(...binds).run();

  if (!meta.changes) return c.json({ erro: 'etapa_nao_encontrada' }, 404);
  return c.json({ ok: true });
});

api.put('/catalogo/etapas/ordem', exigirAdmin, async (c) => {
  const corpo = await c.req.json().catch(() => null);
  const r = reordenarEtapasSchema.safeParse(corpo);
  if (!r.success) return c.json({ erro: 'parametros_invalidos', detalhe: r.error.issues }, 400);

  const stmts = r.data.itens.map((item) =>
    c.env.DB.prepare(
      `UPDATE processo_etapas
          SET ordem = ?, atualizado_em = datetime('now')
        WHERE processo_id = ? AND etapa_nome = ?`,
    ).bind(item.ordem, r.data.processo_id, item.etapa_nome),
  );
  await c.env.DB.batch(stmts);
  return c.json({ ok: true, atualizados: stmts.length });
});

/** Sync manual Rubeus — admin. */
api.post('/admin/rubeus/sync', exigirAdmin, async (c) => {
  try {
    const cursos = await sincronizarCursos(c.env, c.env.DB);
    const etapas = await sincronizarEtapasDeOportunidades(c.env, c.env.DB, 40);
    /*
     * Resgata o curso de quem chegou sem ele — é o que tira a tabela por
     * categoria do "não identificado".
     *
     * `limite` existe para recuperar atraso: é uma chamada ao Rubeus por
     * contato, então o cron diário anda devagar de propósito, e quem quiser
     * fechar o histórico de uma vez chama esta rota algumas vezes com o lote
     * maior em vez de esperar uma semana.
     */
    const limite = Math.min(200, Math.max(1, Number(c.req.query('limite')) || 60));
    const enriquecidos = await enriquecerCursoDosLeads(c.env, c.env.DB, limite);
    return c.json({ ok: true, cursos, etapas, enriquecidos });
  } catch (e) {
    const status = e instanceof ErroRubeus ? e.status : 502;
    return c.json({ erro: 'sync_falhou', detalhe: String(e instanceof Error ? e.message : e) }, status as any);
  }
});

/**
 * POST /api/admin/rubeus/resgatar-cursos?limite=45 — só o resgate de curso.
 *
 * Rota própria por causa do teto de 50 subrequisições por invocação. Junto do
 * sync de catálogo e da amostra de etapas, que já gastam mais de 40, sobravam
 * oito contatos por chamada — e o `catch` do resgate engolia a falha, então o
 * lote parecia pequeno em vez de estourado. Sozinho, o resgate usa o teto
 * inteiro.
 *
 * Continua sendo repetível: cada chamada devolve quantos ainda faltam, e é para
 * chamar até `restantes` zerar.
 */
api.post('/admin/rubeus/resgatar-cursos', exigirAdmin, async (c) => {
  try {
    const limite = Math.min(45, Math.max(1, Number(c.req.query('limite')) || 45));
    const resultado = await enriquecerCursoDosLeads(c.env, c.env.DB, limite);
    const restam = await c.env.DB.prepare(
      `SELECT COUNT(DISTINCT contato_id) AS n
         FROM leads_etapa
        WHERE (curso_id IS NULL OR curso_id = '')
          AND (curso_codigo IS NULL OR curso_codigo = '')
          AND (oferta_codigo IS NULL OR oferta_codigo = '')
          AND (oferta_nome IS NULL OR oferta_nome = '')
          AND curso_consultado_em IS NULL
          AND contato_id IS NOT NULL AND contato_id != ''`,
    ).first();
    return c.json({ ok: true, ...resultado, restantes: num(restam?.n) });
  } catch (e) {
    const status = e instanceof ErroRubeus ? e.status : 502;
    return c.json({ erro: 'resgate_falhou', detalhe: String(e instanceof Error ? e.message : e) }, status as any);
  }
});

/**
 * GET /api/admin/rubeus/oportunidades/:contatoId — o que a API devolve de um
 * contato, cru. Existe para conferir de onde o curso pode ser resgatado quando
 * o webhook não o manda, sem precisar sair do Worker com o token na mão.
 */
api.get('/admin/rubeus/oportunidades/:contatoId', exigirAdmin, async (c) => {
  try {
    const itens = await listarOportunidades(c.env, c.req.param('contatoId'));
    return c.json({ ok: true, total: itens.length, itens });
  } catch (e) {
    const status = e instanceof ErroRubeus ? e.status : 502;
    return c.json({ erro: 'consulta_falhou', detalhe: String(e instanceof Error ? e.message : e) }, status as any);
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
