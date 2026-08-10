import { z } from 'zod';

/**
 * Schemas de corpo dos webhooks do Rubeus e da Evolution API.
 *
 * Regra do plano (seção 5): rejeitar campo faltante com 400, nunca gravar linha
 * parcial em silêncio. Campo opcional aqui significa "a origem legitimamente
 * pode não mandar", não "não sei se vem".
 *
 * `.nullish()` em vez de `.optional()` porque as duas origens mandam `null`
 * explícito para campo sem valor, em vez de omitir a chave.
 */

/** Aceita string ou número e devolve string — ids do Rubeus vêm dos dois jeitos. */
const idFlexivel = z.union([z.string(), z.number()]).transform((v) => String(v));

/**
 * Booleano tolerante a como cada origem serializa.
 *
 * Não usar `z.coerce.boolean()`: ele é só `Boolean(v)`, então a string "false"
 * — que é exatamente o que um form-urlencoded manda — viraria `true`.
 */
const booleanoFlexivel = z.union([z.boolean(), z.string(), z.number()]).transform((v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return ['true', '1', 'sim', 'yes'].includes(v.trim().toLowerCase());
});

/** Timestamp ISO. O Rubeus manda "2026-07-29 16:12:00"; normalizamos para ISO real. */
const timestamp = z.string().min(1).transform((v) => {
  const normalizado = v.includes('T') ? v : v.replace(' ', 'T');
  const d = new Date(normalizado);
  return Number.isNaN(d.getTime()) ? normalizado : d.toISOString();
});

/**
 * Aceita nome alternativo de campo.
 *
 * O fluxo de automação do Rubeus monta o payload campo a campo, com o nome
 * escolhido por quem configurou. Rejeitar por causa de "id" no lugar de
 * "contato_id" transformaria erro de digitação em lead perdido — e o evento
 * perdido não volta.
 */
/** Lê caminho aninhado ("resumoAtual.nome") sem estourar em nível ausente. */
const fundo = (dado: unknown, caminho: string): unknown =>
  caminho.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), dado);

const aliases = (dado: unknown, nomes: string[]): unknown => {
  if (!dado || typeof dado !== 'object') return undefined;
  const o = dado as Record<string, unknown>;
  for (const n of nomes) {
    const v = n.includes('.') ? fundo(dado, n) : o[n];
    /*
     * Só primitivo serve. No payload padrão do Rubeus, `processo` é um objeto
     * {id, nome} — devolvê-lo faria o schema receber objeto onde espera string
     * e recusar o evento, mesmo tendo o dado logo ali em `processo.nome`.
     */
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'string' || typeof v === 'number') return v;
  }
  return undefined;
};

/** Normaliza o corpo antes da validação, mapeando os apelidos conhecidos. */
/**
 * E-mail em minúsculas — é a chave que casa com o RD Station, e "Joao@" e
 * "joao@" são a mesma pessoa em todo servidor de e-mail que importa.
 */
const normalizarEmail = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const e = v.trim().toLowerCase();
  return e.includes('@') && e.length > 3 ? e : undefined;
};

/**
 * Telefone só com dígitos, com DDI.
 *
 * O Rubeus manda "+5581999820742"; a Evolution manda
 * "5581999820742@s.whatsapp.net". Sem normalizar, nenhuma conversa casaria com
 * o lead que a originou. Número sem DDI ganha o 55: é uma faculdade de Recife,
 * e um celular brasileiro tem 10 ou 11 dígitos com DDD.
 */
const normalizarTelefone = (v: unknown): string | undefined => {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined;
  let d = String(v).split('@')[0]!.replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d.length >= 12 && d.length <= 15 ? d : undefined;
};

export const normalizarEtapa = (bruto: unknown): unknown => {
  /*
   * O webhook nativo do Rubeus embrulha tudo num array de um elemento — o de
   * automação manda objeto. Eram 56 eventos recusados por isso: contato,
   * atividade e registro de processo, todos legítimos, todos perdidos por causa
   * de dois colchetes.
   */
  if (Array.isArray(bruto)) bruto = bruto[0];
  if (!bruto || typeof bruto !== 'object') return bruto;
  const o = { ...(bruto as Record<string, unknown>) };

  /*
   * Preenche quando falta OU quando o que está lá não é primitivo.
   *
   * `??=` sozinho não bastava: no payload padrão do Rubeus, `status` já existe
   * como objeto {id, nome}, então a atribuição nunca acontecia e o schema
   * recusava o evento por receber objeto onde espera string.
   */
  const preencher = (campo: string, nomes: string[]) => {
    const atual = o[campo];
    const ok = typeof atual === 'string' || typeof atual === 'number';
    if (!ok) {
      const v = aliases(bruto, nomes);
      if (v !== undefined) o[campo] = v;
      else if (atual !== null && atual !== undefined && !ok) delete o[campo];
    }
  };
  /*
   * Um único fluxo do Rubeus atende várias etapas — sete, no funil de
   * Pós-Graduação. Todas apontam para a mesma URL, então a etapa PRECISA vir no
   * corpo; separar por URL exigiria um fluxo por etapa, que não é como a conta
   * está montada. Aqui cobrimos tanto o payload padrão do Rubeus
   * (`resumoAtual.nome`) quanto o montado campo a campo no fluxo.
   */

  preencher('etapa', ['etapa', 'etapa_atual', 'etapaAtual', 'stage', 'situacao', 'etapa_nome', 'nome_etapa', 'resumoAtual.nome', 'resumo.nome', 'etapa.nome', 'situacao.nome', 'oportunidades.0.resumoAtualNome']);
  /*
   * `contatos.0.id` vem ANTES de `id`.
   *
   * No payload padrão do Rubeus, `id` no topo é o id do registro de processo,
   * não do contato — usá-lo criaria um "lead" por registro e quebraria a
   * contagem de contatos distintos do funil. Já no payload montado campo a
   * campo pelo fluxo, `id` É o contato, e por isso continua na lista, depois.
   */
  /*
   * `contato.id` entra na frente de `id` pelo mesmo motivo que `contatos.0.id`.
   * No payload de ATIVIDADE, `id` é o id da atividade — sem isto, cada tarefa
   * criada virava um "lead" novo, e foi o que gerou os contatos sem nome que
   * apareceram no funil.
   */
  preencher('contato_id', ['contatos.0.id', 'contato.id', 'contatoPrincipal.id', 'contato', 'contatoId', 'id_contato', 'idContato', 'aluno_id', 'lead_id', 'id']);
  preencher('contato_nome', ['nome', 'aluno', 'contatoNome', 'nome_contato', 'lead', 'contatos.0.nome']);

  /*
   * Identidade que atravessa as integrações: e-mail casa com o RD Station,
   * telefone casa com a Evolution. O fluxo de automação manda `email`/`phone`
   * na raiz; o webhook nativo aninha em `emails.principal`/`telefones.principal`.
   */
  const email = normalizarEmail(aliases(bruto, ['email', 'emails.principal', 'e_mail', 'emailPrincipal', 'contatos.0.email']));
  if (email) o.email = email;
  else delete o.email;

  const telefone = normalizarTelefone(
    aliases(bruto, ['phone', 'telefone', 'telefones.principal', 'celular', 'whatsapp', 'telefonePrincipal']),
  );
  if (telefone) o.telefone = telefone;
  else delete o.telefone;
  preencher('registrado_em', ['data', 'data_hora', 'dataHora', 'criacao', 'timestamp', 'ocorrido_em', 'registradoEm']);
  preencher('processo_nome', ['processo.nome', 'processoNome', 'funil', 'processo']);
  preencher('processo_id', ['processo.id', 'processoId', 'id_processo']);
  preencher('status', ['status.nome', 'situacaoNome', 'status']);
  preencher('origem', ['origem.nome', 'canal', 'origem_nome', 'origem']);
  preencher('unidade', ['unidade.nome', 'cidade', 'unidade_nome', 'unidade']);
  /*
   * Curso: preferir o marcado como principal no array oficial do webhook
   * (`cursos[].principal = "1"`), depois o primeiro da lista, depois `curso.*`
   * (atividade/evento) e campos soltos do fluxo de automação.
   */
  const cursoPrincipal = cursoPrincipalDoPayload(bruto);
  if (cursoPrincipal.codigo && !primitivo(o.curso_codigo)) o.curso_codigo = cursoPrincipal.codigo;
  if (cursoPrincipal.id && !primitivo(o.curso_id)) o.curso_id = cursoPrincipal.id;
  preencher('curso_codigo', [
    'cursos.0.codCurso', 'curso.codCurso', 'curso.codigo', 'codCurso', 'cursoCodigo', 'curso',
  ]);
  preencher('curso_id', ['cursos.0.id', 'curso.id', 'cursoId']);
  /*
   * Oferta: mais específica que o curso e, em graduação, a única que existe —
   * "Graduação Em Psicologia" só é oferta, por semestre e por turno.
   */
  if (cursoPrincipal.oferta && !primitivo(o.oferta_codigo)) o.oferta_codigo = cursoPrincipal.oferta;
  preencher('oferta_codigo', [
    'cursos.0.codOferta', 'curso.codOferta', 'codOferta', 'ofertaCodigo',
    'cod_oferta', 'codigo_da_oferta',
  ]);
  /*
   * Nome da oferta. Hoje o Rubeus não manda em etapa nenhuma — a Ficha de
   * Inscrição, que é de onde vem "Aptos para a matrícula", chega urlencoded com
   * nome/e-mail/etapa e nada de curso. Os aliases cobrem as grafias plausíveis
   * do campo para que, no dia em que ele for marcado na configuração do
   * webhook, a categoria passe a resolver sozinha e sem deploy.
   */
  preencher('oferta_nome', [
    'cursos.0.nomeOferta', 'curso.nomeOferta', 'nomeOferta', 'oferta.nome',
    'nome_da_oferta', 'nome_oferta', 'ofertaNome', 'oferta',
  ]);
  preencher('modalidade', ['modalidade.nome', 'modalidade']);
  preencher('responsavel_comercial', ['responsavel.nome', 'responsavel', 'consultor']);
  // O `id` do topo só é o registro de processo quando o contato veio aninhado.
  preencher('registro_processo_id', ['registroProcessoId']);
  if (o.registro_processo_id === undefined && aliases(bruto, ['contatos.0.id']) !== undefined) {
    preencher('registro_processo_id', ['id']);
  }
  // Sem data explícita, o evento é agora: é quando o CRM disparou.
  o.registrado_em ??= new Date().toISOString();
  return o;
};

const primitivo = (v: unknown) => typeof v === 'string' || typeof v === 'number';

/** Extrai curso principal do payload padrão do Registro de Processo. */
function cursoPrincipalDoPayload(
  bruto: unknown,
): { id?: string; codigo?: string; oferta?: string } {
  if (!bruto || typeof bruto !== 'object') return {};
  const o = bruto as Record<string, unknown>;
  const lista = Array.isArray(o.cursos) ? o.cursos : [];
  const escolhido =
    lista.find((c) => c && typeof c === 'object' && String((c as any).principal) === '1') ??
    lista[0];
  if (escolhido && typeof escolhido === 'object') {
    const c = escolhido as Record<string, unknown>;
    return {
      id: c.id != null ? String(c.id) : undefined,
      codigo: c.codCurso != null ? String(c.codCurso) : undefined,
      oferta: c.codOferta != null ? String(c.codOferta) : undefined,
    };
  }
  const curso = o.curso;
  if (curso && typeof curso === 'object') {
    const c = curso as Record<string, unknown>;
    return {
      id: c.id != null ? String(c.id) : undefined,
      codigo: c.codCurso != null ? String(c.codCurso) : (c.codigo != null ? String(c.codigo) : undefined),
      oferta: c.codOferta != null ? String(c.codOferta) : undefined,
    };
  }
  return {};
}

// POST /webhook/rubeus/:funil
export const etapaSchema = z.object({
  contato_id: idFlexivel,
  etapa: z.string().min(1),
  registrado_em: timestamp,
  contato_nome: z.string().nullish(),
  registro_processo_id: idFlexivel.nullish(),
  processo_id: idFlexivel.nullish(),
  processo_nome: z.string().nullish(),
  status: z.string().nullish(),
  curso_id: idFlexivel.nullish(),
  curso_codigo: z.string().nullish(),
  oferta_codigo: z.string().nullish(),
  oferta_nome: z.string().nullish(),
  origem: z.string().nullish(),
  modalidade: z.string().nullish(),
  unidade: z.string().nullish(),
  responsavel_comercial: z.string().nullish(),
  email: z.string().nullish(),
  telefone: z.string().nullish(),
});

/**
 * Payload de contato: identidade, não passagem de etapa.
 *
 * O gatilho de criação/edição de contato não descreve movimento no funil — ele
 * descreve QUEM é a pessoa. Gravá-lo como etapa criaria uma linha
 * "(etapa não informada)" por edição de cadastro e sujaria a contagem. O que ele
 * tem de valioso é o par e-mail + telefone, que é o que liga o lead ao RD
 * Station e à conversa na Evolution.
 */
export const identidadeSchema = z
  .object({
    contato_id: idFlexivel,
    contato_nome: z.string().nullish(),
    email: z.string().nullish(),
    telefone: z.string().nullish(),
  })
  .refine((d) => Boolean(d.email || d.telefone), {
    message: 'sem e-mail nem telefone: nada a cruzar',
  });

// POST /webhook/evolution/conversa
export const conversaSchema = z.object({
  iniciada_em: timestamp,
  contato_id: idFlexivel.nullish(),
  contato_nome: z.string().nullish(),
  atendente: z.string().nullish(),
  respondida: booleanoFlexivel.nullish(),
  tempo_resposta_min: z.coerce.number().nonnegative().nullish(),
});


// Query params das rotas GET do painel.
export const periodoQuerySchema = z.object({
  dias: z.coerce.number().int().min(1).max(365).default(30),
});

export const paginacaoQuerySchema = z.object({
  limite: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Mês (yyyy-mm), ano (yyyy) e intervalo — as três formas de pedir período. */
const periodoCampos = {
  mes: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  ano: z.string().regex(/^\d{4}$/).optional(),
  dias: z.coerce.number().int().min(1).max(365).optional(),
  de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
};

export const funilQuerySchema = z.object({
  funil_id: z.string().min(1).optional(),
  ...periodoCampos,
  curso_codigo: z.string().min(1).optional(),
  categoria: z.string().min(1).optional(),
  modalidade: z.string().min(1).optional(),
  processo_id: z.string().min(1).optional(),
});

/** Quem está por trás de um número do funil — a lista que o ícone abre. */
export const pessoasDaEtapaQuerySchema = z.object({
  ...periodoCampos,
  etapa: z.enum(['qualificados', 'oportunidade', 'inscricao', 'matricula']),
  /*
   * Categoria RESOLVIDA da pessoa, para abrir uma linha da tabela do meio.
   * String vazia é "sem curso identificado" — é uma linha de verdade ali, e
   * precisa ser abrível como as outras.
   */
  categoria_pessoa: z.string().optional(),
  /* Desempata as linhas não classificadas, que são agrupadas por funil. */
  funil_nome: z.string().optional(),
  curso_codigo: z.string().min(1).optional(),
  categoria: z.string().min(1).optional(),
  modalidade: z.string().min(1).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  por_pagina: z.coerce.number().int().min(1).max(200).default(50),
});

export const macroQuerySchema = z.object({
  ...periodoCampos,
  curso_codigo: z.string().min(1).optional(),
  categoria: z.string().min(1).optional(),
  modalidade: z.string().min(1).optional(),
  comparar: z
    .union([z.literal('1'), z.literal('0'), z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === undefined || v === '1' || v === 'true'),
});
