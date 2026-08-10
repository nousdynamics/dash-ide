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
  if (n.includes('matricula')) return 'matricula';
  if (n.includes('apto')) return 'matricula';
  if (n.includes('inscrito') || n.includes('inscri')) return 'inscricao';
  if (n.includes('oportunidade')) return 'oportunidade';
  if (n.includes('qualific')) return 'qualificado';
  if (n.includes('novo lead') || n.includes('conex') || n.includes('lead')) return 'lead';
  return null;
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
            100,
            inferirMacroEtapa(nome),
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

/** Upsert de uma etapa observada em webhook. */
export async function aprenderEtapaDoEvento(
  db: D1Database,
  processoId: string | null | undefined,
  etapaNome: string | null | undefined,
  etapaId?: string | null,
): Promise<void> {
  const pid = processoId != null ? String(processoId) : '';
  const nome = (etapaNome || '').trim();
  if (!pid || !nome) return;
  await db.prepare(
    `INSERT INTO processo_etapas (processo_id, etapa_id, etapa_nome, ordem, macro_etapa, atualizado_em)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(processo_id, etapa_nome) DO UPDATE SET
       etapa_id = COALESCE(excluded.etapa_id, processo_etapas.etapa_id),
       atualizado_em = excluded.atualizado_em`,
  )
    .bind(pid, etapaId ?? null, nome, 100, inferirMacroEtapa(nome))
    .run();
}
