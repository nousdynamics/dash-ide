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
   * Quem chegou a inscrição ou matrícula vem primeiro.
   *
   * A fila bruta é dominada por lead de topo, que o Rubeus responde "Sem oferta
   * de curso" porque a pessoa ainda não escolheu curso — e é justamente quem
   * não aparece na tabela por categoria. Ordenar por quem já está no fundo do
   * funil faz o lote diário atacar quem muda a tela.
   */
  const pendentes = await db.prepare(
    `SELECT l.contato_id,
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
      ORDER BY fundo DESC, MAX(l.registrado_em) DESC
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
           (id, curso_codigo, oferta_codigo, nome, nivel_ensino, modalidade, processo_seletivo_id, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           curso_codigo = excluded.curso_codigo,
           oferta_codigo = excluded.oferta_codigo,
           nome = excluded.nome,
           nivel_ensino = excluded.nivel_ensino,
           modalidade = excluded.modalidade,
           processo_seletivo_id = excluded.processo_seletivo_id,
           atualizado_em = excluded.atualizado_em`,
      ).bind(
        String(o.id),
        o.codCurso ?? null,
        o.codigo ?? null,
        o.nome ?? null,
        o.nivelEnsinoNome ?? (o.nivelEnsino != null ? String(o.nivelEnsino) : null),
        o.modalidadeNome ?? (o.modalidade != null ? String(o.modalidade) : null),
        o.processoSeletivo != null ? String(o.processoSeletivo) : null,
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
