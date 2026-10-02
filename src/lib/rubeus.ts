import { valorMonetario } from './metricas';
import { inferirOrdemEtapa } from './etapas';

/**
 * Cliente da API CRM Rubeus.
 *
 * Auth: `origem` + `token` no body (ou query em GET). Base padrão da conta IDE.
 * Doc: https://docs.rubeus.com.br/api_crm/
 */

const BASE_PADRAO = 'https://crmide.apprubeus.com.br';

export class ErroRubeus extends Error {
  constructor(msg: string, readonly status: number = 502) {
    super(msg);
  }
}

type Credenciais = { origem: string; token: string; base: string };

function credenciais(env: Env): Credenciais {
  const origem = (env.RUBEUS_ORIGEM || '').trim();
  const token = (env.RUBEUS_TOKEN || '').trim();
  if (!origem || !token) {
    throw new ErroRubeus('RUBEUS_ORIGEM e RUBEUS_TOKEN não configurados', 500);
  }
  const base = (env.RUBEUS_BASE_URL || BASE_PADRAO).replace(/\/$/, '');
  return { origem, token, base };
}

async function postJson<T>(
  env: Env,
  caminho: string,
  corpo: Record<string, unknown>,
): Promise<T> {
  const { origem, token, base } = credenciais(env);
  const resp = await fetch(`${base}${caminho}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ...corpo, origem: Number(origem) || origem, token }),
  });
  const texto = await resp.text();
  if (!resp.ok) {
    console.error(JSON.stringify({
      evento: 'rubeus_http_erro',
      caminho,
      status: resp.status,
      corpo: texto.slice(0, 400),
    }));
    throw new ErroRubeus(`Rubeus ${caminho} respondeu ${resp.status}`, 502);
  }
  try {
    return JSON.parse(texto) as T;
  } catch {
    throw new ErroRubeus(`Rubeus ${caminho} devolveu JSON inválido`, 502);
  }
}

async function getJson<T>(
  env: Env,
  caminho: string,
  params: Record<string, string | undefined> = {},
): Promise<T> {
  const { origem, token, base } = credenciais(env);
  const qs = new URLSearchParams({ origem, token });
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') qs.set(k, v);
  }
  const resp = await fetch(`${base}${caminho}?${qs}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const texto = await resp.text();
  if (!resp.ok) {
    console.error(JSON.stringify({
      evento: 'rubeus_http_erro',
      caminho,
      status: resp.status,
      corpo: texto.slice(0, 400),
    }));
    throw new ErroRubeus(`Rubeus ${caminho} respondeu ${resp.status}`, 502);
  }
  try {
    return JSON.parse(texto) as T;
  } catch {
    throw new ErroRubeus(`Rubeus ${caminho} devolveu JSON inválido`, 502);
  }
}

function listaDe<T>(resp: unknown): T[] {
  if (!resp || typeof resp !== 'object') return [];
  const o = resp as Record<string, unknown>;
  if (Array.isArray(o.dados)) return o.dados as T[];
  const resultado = o.resultado as Record<string, unknown> | undefined;
  if (resultado && Array.isArray(resultado.dados)) return resultado.dados as T[];
  if (Array.isArray(o.data)) return o.data as T[];
  return [];
}

export type CursoRubeus = {
  id?: string;
  nome?: string;
  codigo?: string;
  descricao?: string;
};

export type OfertaRubeus = {
  id?: string;
  nome?: string;
  codigo?: string;
  codCurso?: string;
  nivelEnsinoNome?: string;
  nivelEnsino?: string;
  modalidadeNome?: string;
  modalidade?: string;
  processoSeletivo?: string;
  processoSeletivoNome?: string;
  /**
   * Os dois preços da oferta, como o Rubeus os devolve: TEXTO, e em convenções
   * decimais diferentes entre si. Ver `valorMonetario` em `lib/metricas.ts`.
   */
  valor?: string | number | null;        // total do curso — "6195.00"
  complemento?: string | number | null;  // valor da inscrição — "197,00"
};

export type OportunidadeRubeus = {
  id?: string;
  curso?: string;
  cursoNome?: string;
  etapa?: string;
  etapaNome?: string;
  statusNome?: string;
  processo?: string;
  processoNome?: string;
  modalidadeNome?: string;
  unidadeNome?: string;
  nivelEnsinoNome?: string;
  momento?: string;
  /*
   * O valor real do curso, quando existir.
   *
   * `valorCurso` é campo nativo da oportunidade e `VALOR DO CURSO` é um campo
   * personalizado do cadastro de Curso. Os dois vieram vazios em todas as 689
   * ofertas do catálogo e nas 55 oportunidades conferidas — por isso o painel
   * mantém a própria tabela de valores. Ficam mapeados aqui para que, no dia em
   * que a faculdade preencher, o valor de verdade vença o cadastrado à mão sem
   * precisar de código novo.
   */
  valorCurso?: string | number | null;
  camposPersonalizados?: Record<string, unknown>;
};

/** GET /api/Curso/listarCursos */
export async function listarCursos(env: Env): Promise<CursoRubeus[]> {
  const resp = await getJson(env, '/api/Curso/listarCursos');
  return listaDe<CursoRubeus>(resp);
}

/** GET /api/Curso/listarOfertas */
export async function listarOfertas(env: Env): Promise<OfertaRubeus[]> {
  const resp = await getJson(env, '/api/Curso/listarOfertas');
  return listaDe<OfertaRubeus>(resp);
}

/** POST /api/Contato/listarOportunidades */
export async function listarOportunidades(
  env: Env,
  contatoId: string | number,
  camposRetorno?: string[],
): Promise<OportunidadeRubeus[]> {
  const resp = await postJson(env, '/api/Contato/listarOportunidades', {
    id: Number(contatoId) || contatoId,
    camposRetorno: camposRetorno ?? [
      'id', 'curso', 'cursoNome', 'etapa', 'etapaNome', 'statusNome',
      'processo', 'processoNome', 'modalidadeNome', 'unidadeNome',
      'nivelEnsinoNome', 'momento',
    ],
  });
  return listaDe<OportunidadeRubeus>(resp);
}

/** POST /api/Contato/dadosPessoa */
export async function dadosPessoa(
  env: Env,
  contatoId: string | number,
): Promise<Record<string, unknown> | null> {
  const resp = await postJson<{ success?: boolean; dados?: Record<string, unknown> }>(
    env,
    '/api/Contato/dadosPessoa',
    { id: Number(contatoId) || contatoId },
  );
  return resp.dados ?? (resp as unknown as Record<string, unknown>);
}

/** POST /api/Registro/dados */
export async function dadosRegistro(
  env: Env,
  registroId: string,
): Promise<Record<string, unknown> | null> {
  const resp = await postJson<{ success?: boolean; dados?: Record<string, unknown> }>(
    env,
    '/api/Registro/dados',
    { id: registroId },
  );
  return resp.dados ?? null;
}

/**
 * Inferência inicial do encaixe na planilha.
 * Pode ser sobrescrita depois em `processo_etapas.macro_etapa`.
 */
export function inferirMacroEtapa(nome: string): string | null {
  const n = nome.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  if (!n || n.startsWith('(etapa')) return 'ignorar';
  /*
   * Intenção / início de ficha: a Ata e a 0019/0027 pedem decisão humana.
   * Classificar sozinho (por conter "inscri") recolocava "iniciou o processo"
   * e "pré-inscrição" no funil sem querer.
   */
  if (
    n.includes('iniciou') ||
    n.includes('parcial') ||
    n.includes('pre-inscri') ||
    n.includes('pre_inscri')
  ) {
    return null;
  }
  if (n.includes('matricula')) return 'matricula';
  if (n.includes('apto')) return 'matricula';
  if (n.includes('inscrito') || n.includes('inscri')) return 'inscricao';
  if (n.includes('oportunidade')) return 'oportunidade';
  if (n.includes('qualific')) return 'qualificados';
  if (n.includes('novo lead') || n.includes('conex') || n.includes('lead')) return 'lead';
  return null;
}

/**
 * Preenche o curso dos leads que chegaram sem ele, consultando o Rubeus.
 *
 * O webhook de inscrição e matrícula não manda curso: das linhas dessas etapas,
 * nenhuma casava com o catálogo, e a tabela por categoria vivia de "não
 * identificado". Mas `/api/Contato/listarOportunidades` devolve, por contato,
 * `cursoNome` e `nivelEnsinoNome` — e `nivelEnsinoNome` é exatamente o campo de
 * que as regras de categoria vivem ("Pós-Graduação (Presencial)").
 *
 * Uma pessoa costuma ter mais de uma oportunidade, às vezes em cursos
 * diferentes (RH e Psicologia no mesmo contato). Por isso a escolha não é "a
 * primeira": casa pelo registro de processo quando o evento trouxe o id, senão
 * pela etapa de mesmo nome, senão pela oportunidade mais recente até a data do
 * evento. Pegar a última de todas atribuiria a matrícula de hoje ao curso que a
 * pessoa procurou ano passado.
 */
export async function enriquecerCursoDosLeads(
  env: Env,
  db: D1Database,
  limiteContatos = 40,
): Promise<{ contatos: number; linhas: number }> {
  /*
   * Quem vira conversão vem primeiro. Depois, quem está no fundo do funil.
   *
   * A fila bruta é dominada por lead de topo, que o Rubeus responde "Sem oferta
   * de curso" porque a pessoa ainda não escolheu curso. A ordem antiga
   * priorizava as macro-etapas de inscrição e matrícula — o que fazia sentido
   * quando esta função só alimentava a tabela por categoria.
   *
   * Deixou de fazer: as etapas que disparam conversão ("Oportunidade",
   * "Oportunidade paga") estão na macro `oportunidade`, fora daquela
   * prioridade. Quem mais precisa do curso resolvido — porque sem nível a
   * conversão cai na ação curinga ou em `sem_acao` — estava no fim da fila.
   *
   * Medido em 09/09/2026: 766 contatos na fila, 60 por rodada diária. Nessa
   * ordem, um lead que vira conversão hoje esperaria semanas pelo nível.
   */
  const pendentes = await db.prepare(
    `SELECT l.contato_id,
            MAX(CASE WHEN EXISTS (
              SELECT 1 FROM conversao_gatilhos g
               WHERE g.ativo = 1 AND g.etapa_nome = l.etapa
                 AND (g.processo_id IS NULL OR g.processo_id = l.processo_id)
            ) THEN 1 ELSE 0 END) AS vira_conversao,
            MAX(CASE WHEN pe.macro_etapa IN ('inscricao', 'matricula') THEN 1 ELSE 0 END) AS fundo
       FROM leads_etapa l
       LEFT JOIN processo_etapas pe ON pe.etapa_nome = l.etapa
      WHERE (l.curso_id IS NULL OR l.curso_id = '')
        AND (l.curso_codigo IS NULL OR l.curso_codigo = '')
        AND (l.oferta_codigo IS NULL OR l.oferta_codigo = '')
        AND (l.oferta_nome IS NULL OR l.oferta_nome = '')
        AND l.curso_consultado_em IS NULL
        AND l.contato_id IS NOT NULL AND l.contato_id != ''
      GROUP BY l.contato_id
      ORDER BY vira_conversao DESC, fundo DESC, MAX(l.registrado_em) DESC
      LIMIT ?`,
  ).bind(limiteContatos).all();

  const ids = (pendentes.results as Array<{ contato_id: string }>).map((r) => r.contato_id);
  if (!ids.length) return { contatos: 0, linhas: 0 };

  /*
   * Os eventos de TODOS os contatos do lote numa consulta só.
   *
   * Era uma por contato, e o Worker tem teto de 50 subrequisições por
   * invocação: com a consulta extra, cada contato custava dois, e o lote
   * morria na metade sem erro visível — o `catch` engolia calado. Agora o
   * custo é uma chamada ao Rubeus por contato, mais duas de banco no total.
   */
  const eventos = await db.prepare(
    `SELECT id, contato_id, etapa, registrado_em, registro_processo_id
       FROM leads_etapa
      WHERE contato_id IN (${ids.map(() => '?').join(',')})
        AND (curso_id IS NULL OR curso_id = '')
        AND (curso_codigo IS NULL OR curso_codigo = '')
        AND (oferta_codigo IS NULL OR oferta_codigo = '')
        AND (oferta_nome IS NULL OR oferta_nome = '')`,
  ).bind(...ids).all();

  type Evento = {
    id: number; contato_id: string; etapa: string;
    registrado_em: string; registro_processo_id: string | null;
  };
  const eventosPorContato = new Map<string, Evento[]>();
  for (const ev of eventos.results as Evento[]) {
    const lista = eventosPorContato.get(ev.contato_id);
    if (lista) lista.push(ev);
    else eventosPorContato.set(ev.contato_id, [ev]);
  }

  const stmts: D1PreparedStatement[] = [];
  let contatos = 0;
  let resgatados = 0;

  for (const linha of pendentes.results as Array<{ contato_id: string }>) {
    let oportunidades: OportunidadeRubeus[];
    try {
      oportunidades = await listarOportunidades(env, linha.contato_id);
    } catch {
      // Um contato que o CRM não resolve não pode derrubar a rodada inteira.
      // Fica sem marca de propósito: erro de rede merece nova tentativa amanhã.
      continue;
    }
    contatos++;

    /*
     * Marca o contato como consultado ANTES de saber se deu em algo.
     *
     * "Perguntei e o Rubeus não tem curso para esta pessoa" é resposta, não
     * falha, e precisa ser registrada — senão ela volta para a frente da fila
     * amanhã e nas próximas mil rodadas, que foi exatamente o que travou o
     * resgate em 8 contatos por lote.
     */
    stmts.push(
      db.prepare(
        `UPDATE leads_etapa SET curso_consultado_em = datetime('now')
          WHERE contato_id = ? AND curso_consultado_em IS NULL`,
      ).bind(linha.contato_id),
    );

    if (!oportunidades.length) continue;

    for (const ev of eventosPorContato.get(linha.contato_id) ?? []) {
      const escolhida =
        (ev.registro_processo_id
          ? oportunidades.find((o) => String(o.id) === String(ev.registro_processo_id))
          : undefined) ??
        oportunidades.find((o) => o.etapaNome === ev.etapa) ??
        [...oportunidades]
          .filter((o) => (o.momento ?? '') <= ev.registrado_em)
          .sort((a, b) => String(b.momento ?? '').localeCompare(String(a.momento ?? '')))[0] ??
        oportunidades[0];

      if (!escolhida?.curso) continue;
      resgatados++;
      stmts.push(
        db.prepare(
          `UPDATE leads_etapa
              SET curso_id = ?,
                  oferta_nome = COALESCE(oferta_nome, ?),
                  modalidade = COALESCE(modalidade, ?)
            WHERE id = ?`,
        ).bind(
          String(escolhida.curso),
          escolhida.cursoNome ?? null,
          escolhida.modalidadeNome ?? null,
          ev.id,
        ),
      );

      /*
       * O curso pode não estar no catálogo, e sem ele o nível não existe para
       * casar categoria. A oportunidade traz nome e nível juntos, então dá para
       * completar a linha aqui em vez de esperar o próximo sync de catálogo.
       */
      if (escolhida.cursoNome) {
        stmts.push(
          db.prepare(
            `INSERT INTO cursos (id, codigo, nome, nivel_ensino, modalidade, atualizado_em)
             VALUES (?, NULL, ?, ?, ?, datetime('now'))
             ON CONFLICT(id) DO UPDATE SET
               nome = excluded.nome,
               nivel_ensino = COALESCE(excluded.nivel_ensino, cursos.nivel_ensino),
               modalidade = COALESCE(excluded.modalidade, cursos.modalidade),
               atualizado_em = excluded.atualizado_em`,
          ).bind(
            String(escolhida.curso),
            escolhida.cursoNome,
            escolhida.nivelEnsinoNome ?? null,
            escolhida.modalidadeNome ?? null,
          ),
        );
      }
    }
  }

  if (stmts.length) await db.batch(stmts);
  return { contatos, linhas: resgatados };
}

/** Persiste cursos e ofertas no D1. */
export async function sincronizarCursos(env: Env, db: D1Database): Promise<{ cursos: number; ofertas: number }> {
  const [cursos, ofertas] = await Promise.all([listarCursos(env), listarOfertas(env)]);

  const stmts: D1PreparedStatement[] = [];
  for (const c of cursos) {
    if (!c.id) continue;
    stmts.push(
      db.prepare(
        `INSERT INTO cursos (id, codigo, nome, atualizado_em)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           codigo = excluded.codigo,
           nome = excluded.nome,
           atualizado_em = excluded.atualizado_em`,
      ).bind(String(c.id), c.codigo ?? null, c.nome ?? c.codigo ?? String(c.id)),
    );
  }
  for (const o of ofertas) {
    if (!o.id) continue;
    stmts.push(
      db.prepare(
        `INSERT INTO curso_ofertas
           (id, curso_codigo, oferta_codigo, nome, nivel_ensino, modalidade, processo_seletivo_id,
            valor_total, valor_inscricao, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           curso_codigo = excluded.curso_codigo,
           oferta_codigo = excluded.oferta_codigo,
           nome = excluded.nome,
           nivel_ensino = excluded.nivel_ensino,
           modalidade = excluded.modalidade,
           processo_seletivo_id = excluded.processo_seletivo_id,
           /*
            * COALESCE e nao excluded direto: o Rubeus devolve o campo vazio
            * em parte das ofertas, e um sync não pode APAGAR um preço que já
            * estava guardado. Preço que some faz a conversão cair para o valor
            * padrão da tela sem nada indicando a troca.
            */
           valor_total = COALESCE(excluded.valor_total, valor_total),
           valor_inscricao = COALESCE(excluded.valor_inscricao, valor_inscricao),
           atualizado_em = excluded.atualizado_em`,
      ).bind(
        String(o.id),
        o.codCurso ?? null,
        o.codigo ?? null,
        o.nome ?? null,
        o.nivelEnsinoNome ?? (o.nivelEnsino != null ? String(o.nivelEnsino) : null),
        o.modalidadeNome ?? (o.modalidade != null ? String(o.modalidade) : null),
        o.processoSeletivo != null ? String(o.processoSeletivo) : null,
        valorMonetario(o.valor),
        valorMonetario(o.complemento),
      ),
    );
    // Completa nivel/modalidade no curso pai quando conhecemos a oferta.
    if (o.codCurso) {
      stmts.push(
        db.prepare(
          `UPDATE cursos SET
             nivel_ensino = COALESCE(?, nivel_ensino),
             modalidade = COALESCE(?, modalidade),
             atualizado_em = datetime('now')
           WHERE codigo = ?`,
        ).bind(
          o.nivelEnsinoNome ?? null,
          o.modalidadeNome ?? null,
          o.codCurso,
        ),
      );
    }
  }

  if (stmts.length) await db.batch(stmts);
  return { cursos: cursos.length, ofertas: ofertas.length };
}

/**
 * Aprende etapas a partir de oportunidades reais de contatos já no D1.
 * Não grava evento novo — só preenche `processo_etapas`.
 */
export async function sincronizarEtapasDeOportunidades(
  env: Env,
  db: D1Database,
  limiteContatos = 40,
): Promise<{ contatos: number; etapas: number }> {
  const { results } = await db.prepare(
    `SELECT DISTINCT contato_id FROM leads_etapa
     WHERE contato_id IS NOT NULL AND contato_id != ''
     ORDER BY registrado_em DESC LIMIT ?`,
  ).bind(limiteContatos).all();

  const vistos = new Set<string>();
  const stmts: D1PreparedStatement[] = [];
  let contatosOk = 0;

  for (const row of results as Array<{ contato_id: string }>) {
    try {
      const opps = await listarOportunidades(env, row.contato_id);
      contatosOk += 1;
      for (const o of opps) {
        const processoId = o.processo != null ? String(o.processo) : null;
        const nome = (o.etapaNome || '').trim();
        if (!processoId || !nome) continue;
        const chave = `${processoId}::${nome}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        const macro = inferirMacroEtapa(nome);
        stmts.push(
          db.prepare(
            `INSERT INTO processo_etapas (processo_id, etapa_id, etapa_nome, ordem, macro_etapa, atualizado_em)
             VALUES (?, ?, ?, ?, ?, datetime('now'))
             ON CONFLICT(processo_id, etapa_nome) DO UPDATE SET
               etapa_id = COALESCE(excluded.etapa_id, processo_etapas.etapa_id),
               atualizado_em = excluded.atualizado_em,
               macro_etapa = COALESCE(processo_etapas.macro_etapa, excluded.macro_etapa)`,
          ).bind(
            processoId,
            o.etapa != null ? String(o.etapa) : null,
            nome,
            inferirOrdemEtapa(nome, macro),
            macro,
          ),
        );
      }
    } catch (e) {
      console.warn(JSON.stringify({
        evento: 'rubeus_sync_oportunidade_falhou',
        contato_id: row.contato_id,
        msg: String(e),
      }));
    }
  }

  if (stmts.length) await db.batch(stmts);
  return { contatos: contatosOk, etapas: vistos.size };
}

/**
 * Upsert de uma etapa observada em webhook.
 *
 * Etapa sem `etapa_id` nasce em quarentena: `macro_etapa` NULL.
 *
 * Toda etapa de verdade tem id no Rubeus — é o que a API devolve em
 * `etapaNome`+`etapa`. Nome sem id significa que o webhook mandou outra coisa
 * no lugar da etapa, e adivinhar a macro pelo nome foi exatamente como
 * "Não contactado" (que é resumo, não etapa) entrou como Qualificados em cinco
 * processos e ficou lá contando gente que ninguém tinha contactado.
 *
 * Macro NULL não entra em nenhuma contagem (o JOIN com rank_macro descarta),
 * então a linha aparece na tela de Etapas para alguém classificar, e até lá não
 * mexe em número nenhum. Nada se perde: o evento continua em `leads_etapa`.
 */
export async function aprenderEtapaDoEvento(
  db: D1Database,
  processoId: string | null | undefined,
  etapaNome: string | null | undefined,
  etapaId?: string | null,
): Promise<void> {
  const pid = processoId != null ? String(processoId) : '';
  const nome = (etapaNome || '').trim();
  if (!pid || !nome) return;
  const macro = etapaId ? inferirMacroEtapa(nome) : null;
  await db.prepare(
    `INSERT INTO processo_etapas (processo_id, etapa_id, etapa_nome, ordem, macro_etapa, atualizado_em)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(processo_id, etapa_nome) DO UPDATE SET
       etapa_id = COALESCE(excluded.etapa_id, processo_etapas.etapa_id),
       atualizado_em = excluded.atualizado_em`,
  )
    .bind(pid, etapaId ?? null, nome, inferirOrdemEtapa(nome, macro ?? inferirMacroEtapa(nome)), macro)
    .run();
}

// ------------------------------------------------- campos personalizados

export type CampoPersonalizado = {
  id?: string;
  nome?: string;
  coluna?: string;
  tipoNome?: string;
  tipoLocalNome?: string;   // 'Contato' | 'Registro de processo' | 'Curso'
};

/** GET /api/Instituicao/campoPersonalizado — catálogo dos campos da conta. */
export async function listarCamposPersonalizados(env: Env): Promise<CampoPersonalizado[]> {
  const resp = await getJson(env, '/api/Instituicao/campoPersonalizado');
  return listaDe<CampoPersonalizado>(resp);
}

const semAcento = (s: unknown): string =>
  String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Acha, pelo NOME, a coluna do campo que guarda o identificador de clique.
 *
 * Descoberta em vez de configuração fixa. A coluna do Rubeus
 * (`campopersonalizado_24_compl_cont`) é um número de slot: recriar o campo
 * gera outro número, e um valor fixo no código passaria a escrever no campo
 * errado — em cima de "Profissão", por exemplo — sem nenhum erro visível.
 * Procurar pelo nome que a pessoa deu ao campo é o que sobrevive a isso.
 *
 * Só campos de Contato. O mesmo nome pode existir no Registro de processo, e
 * escrever no lugar errado é o modo de falha mais caro aqui.
 */
export async function acharColunaClickId(
  env: Env,
): Promise<{ gclid?: string; gbraid?: string; wbraid?: string }> {
  const campos = await listarCamposPersonalizados(env);
  const doContato = campos.filter((c) => semAcento(c.tipoLocalNome) === 'contato');

  const achar = (alvo: string): string | undefined =>
    doContato.find((c) => semAcento(c.nome).includes(alvo) || semAcento(c.coluna).includes(alvo))?.coluna;

  return { gclid: achar('gclid'), gbraid: achar('gbraid'), wbraid: achar('wbraid') };
}

/**
 * Escreve um campo personalizado no contato.
 *
 * `/api/Contato/cadastro` é o mesmo endpoint de criação — não existe um
 * "atualizar só este campo". Por isso o corpo leva o mínimo possível: o `id` do
 * contato para dizer QUEM, o e-mail principal porque a API exige um
 * identificador de contato, e o campo a gravar. Qualquer coisa a mais seria
 * reescrever cadastro que alguém preencheu à mão no CRM.
 *
 * Quem chama precisa ter conferido o interruptor `escrever_no_rubeus` antes:
 * esta função não pergunta, ela escreve.
 */
export async function gravarCampoDoContato(
  env: Env,
  contatoId: string,
  emailPrincipal: string | null,
  coluna: string,
  valor: string,
): Promise<void> {
  await postJson(env, '/api/Contato/cadastro', {
    id: Number(contatoId) || contatoId,
    ...(emailPrincipal ? { emailPrincipal } : {}),
    camposPersonalizados: { [coluna]: valor },
  });
  console.log(JSON.stringify({
    evento: 'rubeus_campo_gravado', contato_id: contatoId, coluna,
  }));
}

/** Rótulo gravado quando o webhook não diz a etapa — ver src/routes/webhooks.ts. */
export const ETAPA_NAO_INFORMADA = '(etapa não informada)';

/**
 * Em que etapa o registro está agora, segundo a API do Rubeus.
 *
 * O webhook nativo de registro (o JSON com `processo`, `contatos`,
 * `resumoAtual`) não traz a etapa: `resumoAtual` é o resumo do ATENDIMENTO
 * ("Não contactado"), não a coluna do funil. Desde 10/09/2026 cerca de um terço
 * dos eventos chegou assim, e no Pós de setembro 69 de 106 registros ficaram
 * sem etapa no painel enquanto o kanban os mostrava em Oportunidade, Inscrito
 * Parcial, Oportunidade paga. `/api/Registro/dados` tem a resposta:
 * `etapaNome`, e `minutosEtapa` para saber desde quando.
 *
 * Teto de quatro segundos: isto roda dentro do webhook, e o Rubeus não pode
 * ficar esperando o painel conversar com o próprio Rubeus. Estourou, devolve
 * nulo e o evento é gravado sem etapa, como antes — a rodada de 30 minutos
 * tenta de novo depois.
 */
export async function etapaAtualDoRegistro(
  env: Env,
  registroId: string,
): Promise<{ etapa: string; etapaId: string | null; desde: string | null } | null> {
  const consulta = dadosRegistro(env, registroId).catch(() => null);
  const limite = new Promise<null>((ok) => setTimeout(() => ok(null), 4000));
  const d = await Promise.race([consulta, limite]);
  const etapa = typeof d?.etapaNome === 'string' ? d.etapaNome.trim() : '';
  if (!d || !etapa) return null;
  const minutos = Number(d.minutosEtapa);
  return {
    etapa,
    etapaId: d.etapa != null ? String(d.etapa) : null,
    desde: Number.isFinite(minutos) && minutos >= 0
      ? new Date(Date.now() - minutos * 60_000).toISOString()
      : null,
  };
}

/**
 * Completa a etapa de quem ficou parado em "(etapa não informada)".
 *
 * Pega os registros cujo evento MAIS RECENTE não tem etapa, pergunta ao Rubeus
 * onde cada um está e grava um evento novo com essa etapa. O evento sem etapa
 * fica como está — ele aconteceu, só não dizia a coluna.
 *
 * A data do evento novo é a de entrada na etapa (`minutosEtapa`), mas nunca
 * antes do último evento gravado: precisa ser o mais recente para a tela ler a
 * etapa atual dele, e a lista de leads e o filtro por etapa olham o último.
 *
 * Lote pequeno por passada (uma chamada ao Rubeus por registro), mais recentes
 * primeiro: quem acabou de entrar é quem a equipe está olhando agora.
 */
export async function completarEtapasDosRegistros(
  env: Env,
  db: D1Database,
  limite = 15,
): Promise<{ consultados: number; completados: number }> {
  const { results } = await db.prepare(
    /*
     * "Último" olhando o CONTATO no processo, não só o registro.
     *
     * Os webhooks de mudança de etapa costumam chegar sem `registro_processo_id`
     * — só o de criação traz. Particionando pelo registro, o aviso de criação
     * (sem etapa) parecia ser o último, e o preenchimento gravava de novo uma
     * etapa que o contato já tinha recebido depois: o MATHEUS do Pós ganhou um
     * segundo "Matrícula ACADÊMICA concluída". Agora só entra quem não tem
     * NENHUM evento mais novo no mesmo processo.
     */
    `WITH ultimo AS (
       SELECT id, registro_processo_id, etapa, registrado_em, contato_id, processo_id,
              ROW_NUMBER() OVER (PARTITION BY registro_processo_id
                                 ORDER BY registrado_em DESC, id DESC) AS rec
         FROM leads_etapa
        WHERE registro_processo_id IS NOT NULL AND registro_processo_id != ''
          AND registrado_em >= datetime('now', '-120 days')
     )
     SELECT u.id, u.registro_processo_id, u.registrado_em FROM ultimo u
      WHERE u.rec = 1 AND u.etapa = ?
        AND NOT EXISTS (
          SELECT 1 FROM leads_etapa n
           WHERE n.contato_id = u.contato_id
             AND n.processo_id IS u.processo_id
             AND n.registrado_em > u.registrado_em)
      ORDER BY u.registrado_em DESC
      LIMIT ?`,
  ).bind(ETAPA_NAO_INFORMADA, limite).all<{ id: number; registro_processo_id: string; registrado_em: string }>();

  let completados = 0;
  for (const r of results) {
    const atual = await etapaAtualDoRegistro(env, r.registro_processo_id);
    if (!atual) continue;
    const ultimo = Date.parse(r.registrado_em);
    const desde = atual.desde ? Date.parse(atual.desde) : NaN;
    const quando = new Date(
      Number.isFinite(desde) && desde > ultimo ? desde : ultimo + 1000,
    ).toISOString();
    const { meta } = await db.prepare(
      `INSERT OR IGNORE INTO leads_etapa (
         contato_id, contato_nome, registro_processo_id, processo_id, processo_nome, etapa, status,
         curso_id, curso_codigo, oferta_codigo, oferta_nome,
         origem, modalidade, unidade, responsavel_comercial, registrado_em,
         funil_id, email, telefone, gclid, gbraid, wbraid,
         cep, cidade, estado, valor_curso, url_origem, pessoa_id)
       SELECT contato_id, contato_nome, registro_processo_id, processo_id, processo_nome, ?, status,
              curso_id, curso_codigo, oferta_codigo, oferta_nome,
              origem, modalidade, unidade, responsavel_comercial, ?,
              funil_id, email, telefone, gclid, gbraid, wbraid,
              cep, cidade, estado, valor_curso, url_origem, pessoa_id
         FROM leads_etapa WHERE id = ?`,
    ).bind(atual.etapa, quando, r.id).run();
    if (meta.changes) {
      completados += 1;
      const p = await db.prepare('SELECT processo_id FROM leads_etapa WHERE id = ?').bind(r.id)
        .first<{ processo_id: string | null }>();
      await aprenderEtapaDoEvento(db, p?.processo_id, atual.etapa, atual.etapaId).catch(() => undefined);
    }
  }
  console.log(JSON.stringify({ evento: 'etapas_completadas', consultados: results.length, completados }));
  return { consultados: results.length, completados };
}

/**
 * Cada evento de um processo atribuído ao REGISTRO dele.
 *
 * O kanban do Rubeus conta registros (fichas), não pessoas: a mesma pessoa com
 * duas fichas no Pós aparece duas vezes lá. Só o aviso de criação traz
 * `registro_processo_id`; os de mudança de etapa chegam sem. O evento sem
 * registro vai para a ficha mais recente do mesmo contato, no mesmo processo,
 * criada até aquele momento — a soma corrida de "eventos com registro" vira o
 * grupo, e o registro do grupo é o do aviso que o abriu. Uma passada só, sem
 * subconsulta por linha.
 *
 * Evento anterior a qualquer ficha conhecida do contato fica sem registro e
 * não entra no kanban.
 *
 * `?` = processo_id.
 */
export const SQL_EVENTOS_POR_REGISTRO = `
  ev AS (
    SELECT id, contato_id, contato_nome, email, telefone, etapa, registrado_em,
           oferta_nome, oferta_codigo, curso_codigo, origem, funil_id,
           NULLIF(registro_processo_id, '') AS reg,
           SUM(CASE WHEN NULLIF(registro_processo_id, '') IS NOT NULL THEN 1 ELSE 0 END)
             OVER (PARTITION BY contato_id ORDER BY registrado_em, id) AS grupo
      FROM leads_etapa
     WHERE processo_id = ?
  ),
  atrib AS (
    SELECT ev.*, MAX(reg) OVER (PARTITION BY contato_id, grupo) AS registro
      FROM ev
  ),
  fichas AS (
    -- Data de criação do Rubeus quando a conferência já a trouxe; senão, o
    -- primeiro aviso recebido. Ficha que o Rubeus diz não existir fica fora.
    SELECT a.registro, COALESCE(MAX(fr.criado_em), MIN(a.registrado_em)) AS criado_em
      FROM atrib a
      LEFT JOIN fichas_rubeus fr ON fr.registro = a.registro
     WHERE a.registro IS NOT NULL AND COALESCE(fr.excluida, 0) = 0
     GROUP BY a.registro
  ),
  atual AS (
    SELECT a.*,
           ROW_NUMBER() OVER (
             PARTITION BY registro
             ORDER BY (etapa = '(etapa não informada)'), registrado_em DESC, id DESC
           ) AS rn
      FROM atrib a WHERE registro IS NOT NULL
  )`;

/**
 * A ficha como o Rubeus a vê agora — ou a certeza de que ela não existe mais.
 *
 * Diferente de `etapaAtualDoRegistro`, separa "excluída" (o Rubeus responde
 * "Registro inexistente!") de "não deu para saber" (erro de rede, teto de
 * tempo), que devolve nulo: apagar uma ficha do kanban por causa de um
 * timeout seria pior que deixá-la mais uma rodada.
 */
async function fichaNoRubeus(
  env: Env,
  registroId: string,
): Promise<
  | { excluida: true }
  | { excluida: false; etapa: string; etapaId: string | null; desde: string | null; criadoEm: string | null }
  | null
> {
  const consulta = postJson<{ success?: boolean; erros?: string; dados?: Record<string, any> }>(
    env, '/api/Registro/dados', { id: registroId },
  ).catch(() => null);
  const limite = new Promise<null>((ok) => setTimeout(() => ok(null), 4000));
  const r = await Promise.race([consulta, limite]);
  if (!r) return null;
  if (r.success === false && /inexistente/i.test(String(r.erros ?? ''))) return { excluida: true };
  const d = r.dados;
  const etapa = typeof d?.etapaNome === 'string' ? d.etapaNome.trim() : '';
  if (!d || !etapa) return null;
  const minutos = Number(d.minutosEtapa);
  // "2026-09-08 16:44:01", horário de Brasília.
  const m = typeof d.momentoCriacao === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(d.momentoCriacao)
    ? new Date(`${d.momentoCriacao.replace(' ', 'T')}-03:00`)
    : null;
  return {
    excluida: false,
    etapa,
    etapaId: d.etapa != null ? String(d.etapa) : null,
    desde: Number.isFinite(minutos) && minutos >= 0 ? new Date(Date.now() - minutos * 60_000).toISOString() : null,
    criadoEm: m && !Number.isNaN(m.getTime()) ? m.toISOString() : null,
  };
}

/**
 * Confere com o Rubeus a etapa das fichas recentes e grava o que faltou.
 *
 * Nem toda mudança de etapa vira webhook: a ERYKA estava em "Aptos para a
 * matrícula" no kanban e o último aviso do painel era "Oportunidade paga". Sem
 * conferir, o painel nunca fica fiel ao Rubeus. A cada passada, uma amostra
 * aleatória das fichas criadas nos últimos 60 dias é comparada; se a etapa do
 * Rubeus difere da atual do painel, entra um evento novo com ela, datado da
 * entrada na etapa e nunca antes do último evento da ficha. Igual, não grava
 * nada — é o que evita repetir etapa.
 */
export async function reconciliarFichasRecentes(
  env: Env,
  db: D1Database,
  limite = 25,
  soProcesso: string | null = null,
): Promise<{ conferidas: number; corrigidas: number }> {
  const { results } = soProcesso
    ? { results: [{ processo_id: soProcesso }] }
    : await db.prepare(
        `SELECT DISTINCT processo_id FROM leads_etapa
          WHERE processo_id IS NOT NULL AND registrado_em >= datetime('now', '-60 days')`,
      ).all<{ processo_id: string }>();

  const fichas: Array<{ processo_id: string; registro: string; etapa: string; registrado_em: string; id: number }> = [];
  for (const p of results) {
    const { results: r } = await db.prepare(
      `WITH ${SQL_EVENTOS_POR_REGISTRO}
       SELECT ? AS processo_id, a.registro, a.etapa, a.registrado_em, a.id
         FROM atual a JOIN fichas f ON f.registro = a.registro
        WHERE a.rn = 1 AND f.criado_em >= datetime('now', '-60 days')`,
    ).bind(p.processo_id, p.processo_id).all<{ processo_id: string; registro: string; etapa: string; registrado_em: string; id: number }>();
    fichas.push(...r);
  }

  // Amostra aleatória: ao longo do dia todas as fichas recentes passam.
  for (let i = fichas.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = fichas[i]!;
    fichas[i] = fichas[j]!;
    fichas[j] = t;
  }

  let conferidas = 0;
  let corrigidas = 0;
  for (const f of fichas.slice(0, limite)) {
    const real = await fichaNoRubeus(env, f.registro);
    if (!real) continue;
    conferidas += 1;
    await db.prepare(
      `INSERT INTO fichas_rubeus (registro, processo_id, criado_em, etapa, excluida, conferido_em)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(registro) DO UPDATE SET
         criado_em = COALESCE(excluded.criado_em, fichas_rubeus.criado_em),
         etapa = COALESCE(excluded.etapa, fichas_rubeus.etapa),
         excluida = excluded.excluida,
         conferido_em = excluded.conferido_em`,
    ).bind(
      f.registro, f.processo_id,
      real.excluida ? null : real.criadoEm,
      real.excluida ? null : real.etapa,
      real.excluida ? 1 : 0,
    ).run();
    if (real.excluida || real.etapa === f.etapa) continue;
    const ultimo = Date.parse(f.registrado_em);
    const desde = real.desde ? Date.parse(real.desde) : NaN;
    const quando = new Date(Number.isFinite(desde) && desde > ultimo ? desde : ultimo + 1000).toISOString();
    const { meta } = await db.prepare(
      `INSERT OR IGNORE INTO leads_etapa (
         contato_id, contato_nome, registro_processo_id, processo_id, processo_nome, etapa, status,
         curso_id, curso_codigo, oferta_codigo, oferta_nome,
         origem, modalidade, unidade, responsavel_comercial, registrado_em,
         funil_id, email, telefone, gclid, gbraid, wbraid,
         cep, cidade, estado, valor_curso, url_origem, pessoa_id)
       SELECT contato_id, contato_nome, ?, processo_id, processo_nome, ?, status,
              curso_id, curso_codigo, oferta_codigo, oferta_nome,
              origem, modalidade, unidade, responsavel_comercial, ?,
              (SELECT fu.id FROM funis fu WHERE fu.processo_id = leads_etapa.processo_id AND fu.ativo = 1 LIMIT 1),
              email, telefone, gclid, gbraid, wbraid,
              cep, cidade, estado, valor_curso, url_origem, pessoa_id
         FROM leads_etapa WHERE id = ?`,
    ).bind(f.registro, real.etapa, quando, f.id).run();
    if (meta.changes) {
      corrigidas += 1;
      await aprenderEtapaDoEvento(db, f.processo_id, real.etapa, real.etapaId).catch(() => undefined);
    }
  }
  console.log(JSON.stringify({ evento: 'fichas_reconciliadas', candidatas: fichas.length, conferidas, corrigidas }));
  return { conferidas, corrigidas };
}
