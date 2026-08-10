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
  periodoQuerySchema,
  pessoasDaEtapaQuerySchema,
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
  /*
   * Categoria vem da view `curso_categoria`, que já resolveu nível, nome e
   * desempate. Antes o critério estava escrito aqui também, e em outra versão:
   * casava `padrao_nome` contra `cursos.nome` e ignorava as ofertas — onde mora
   * a graduação inteira, que só existe por semestre. Filtrar por "Graduação
   * Psicologia" não devolvia nada mesmo havendo inscrição.
   */
  if (opts.categoria) {
    partes.push(`EXISTS (
      SELECT 1 FROM curso_categoria cc
      WHERE cc.categoria = ?
        AND ((${a}curso_codigo IS NOT NULL AND cc.curso_codigo = ${a}curso_codigo)
          OR (${a}curso_id     IS NOT NULL AND cc.curso_id     = ${a}curso_id))
    )`);
    binds.push(opts.categoria);
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
    SELECT COALESCE(l.email, l.telefone, l.contato_id) AS pessoa,
           l.curso_codigo, l.curso_id, l.oferta_codigo, l.oferta_nome,
           ROW_NUMBER() OVER (
             PARTITION BY COALESCE(l.email, l.telefone, l.contato_id)
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
    SELECT COALESCE(l.email, l.telefone, l.contato_id) AS pessoa,
           l.funil_id,
           ROW_NUMBER() OVER (
             PARTITION BY COALESCE(l.email, l.telefone, l.contato_id)
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

  const filtrosL = clausulasFiltroCurso({
    curso_codigo: q.data.curso_codigo,
    categoria: q.data.categoria,
    modalidade: q.data.modalidade,
    alias: 'l',
  });

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
      SELECT COALESCE(l.email, l.telefone, l.contato_id) AS pessoa,
             MAX(rank_macro.nivel) AS nivel
        FROM leads_etapa l
        JOIN processo_etapas pe
          ON pe.etapa_nome = l.etapa
         AND (l.processo_id IS NULL OR pe.processo_id = l.processo_id)
        JOIN rank_macro ON rank_macro.macro = pe.macro_etapa
       WHERE l.registrado_em >= ? AND l.registrado_em <= ?
         REPLACE_FILTRO
       GROUP BY pessoa
    )`;

  /*
   * As quatro etapas numa consulta só. Eram oito idas ao D1 (quatro etapas x
   * dois períodos) e agora são duas, o que também elimina a chance de duas
   * etapas serem lidas de estados diferentes do banco.
   */
  const contarFunil = async (inicio: string, fim: string) => {
    const row = await c.env.DB.prepare(
      `${RANK_MACRO.replace('REPLACE_FILTRO', filtrosL.sql)}
       SELECT
         (SELECT COUNT(*) FROM topo WHERE nivel >= 1) AS qualificados,
         (SELECT COUNT(*) FROM topo WHERE nivel >= 2) AS oportunidades,
         (SELECT COUNT(*) FROM topo WHERE nivel >= 3) AS inscricoes,
         (SELECT COUNT(*) FROM topo WHERE nivel >= 4) AS matriculas`,
    ).bind(inicio, fim, ...filtrosL.binds).first();
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

  const { qualificados, oportunidades, inscricoes, matriculas } = atual;
  const {
    qualificados: qualAnt,
    oportunidades: oppAnt,
    inscricoes: inscAnt,
    matriculas: matAnt,
  } = anterior;

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
    const fCat = clausulasFiltroCurso({
      curso_codigo: q.data.curso_codigo,
      modalidade: q.data.modalidade,
      categoria: q.data.categoria,
      alias: 'l',
    });

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
         SELECT COALESCE(l.email, l.telefone, l.contato_id) AS pessoa,
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
              COALESCE(l.email, l.telefone, l.contato_id) AS pessoa,
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
    },
    etapas,
    por_categoria: porCategoria.lista,
    por_categoria_nao_classificados: porCategoria.nao_classificados,
    evolucao: evolucao.results,
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

  const filtros = clausulasFiltroCurso({
    curso_codigo: q.data.curso_codigo,
    categoria: q.data.categoria,
    modalidade: q.data.modalidade,
    alias: 'l',
  });

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
      SELECT COALESCE(l.email, l.telefone, l.contato_id) AS pessoa,
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
      SELECT COALESCE(l.email, l.telefone, l.contato_id) AS pessoa,
             l.contato_id, l.contato_nome, l.email, l.telefone, l.etapa, l.registrado_em,
             ROW_NUMBER() OVER (
               PARTITION BY COALESCE(l.email, l.telefone, l.contato_id)
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
 * Aceita de/ate ou dias; ordena por processo_etapas.ordem quando houver.
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
    mes: q.data.mes,
    ano: q.data.ano,
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
   * O Rubeus emite id de contato diferente conforme o gatilho: RAFAEL DE PAULA
   * DA SILVA chegou como 1670626, 44176, 1670628 e 1670629 — a lista mostrava
   * quatro cards da mesma pessoa. A identidade é o e-mail (depois telefone,
   * depois o id), a mesma que o funil usa para contar.
   *
   * Processo repetido NÃO é duplicata: a mesma pessoa pode se inscrever em dois
   * cursos, e isso é jornada legítima. Por isso o card conta os registros de
   * processo distintos em vez de escondê-los.
   *
   * O filtro de busca entra no `base`, antes do agrupamento: basta UM evento da
   * pessoa casar para ela aparecer inteira, com todos os processos.
   */
  const cte = `WITH base AS (
       SELECT COALESCE(email, telefone, contato_id) AS quem, *
       FROM leads_etapa WHERE (? IS NULL OR funil_id = ?)${filtroBusca}
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
              u.etapa, u.curso_codigo, u.processo_nome, u.origem,
              u.contato_id, u.email, u.telefone,
              COALESCE(u.contato_nome,
                       (SELECT MAX(b2.contato_nome) FROM base b2 WHERE b2.quem = a.quem)) AS contato_nome
       FROM agg a JOIN ultimo u ON u.quem = a.quem
       ORDER BY a.ult DESC LIMIT ? OFFSET ?`,
    )
      .bind(fid, fid, ...bindsBusca, porPagina, offset)
      .all(),

    // Total de PESSOAS que casam com o filtro — é o que pagina, não linhas.
    c.env.DB.prepare(`${cte} SELECT COUNT(*) AS total FROM agg`)
      .bind(fid, fid, ...bindsBusca)
      .first<{ total: number }>(),
  ]);

  const total = num(totalRes?.total);
  return c.json({
    funil_id: fid,
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
