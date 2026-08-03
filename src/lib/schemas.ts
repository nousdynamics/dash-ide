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
const aliases = (dado: unknown, nomes: string[]): unknown => {
  if (!dado || typeof dado !== 'object') return undefined;
  const o = dado as Record<string, unknown>;
  for (const n of nomes) {
    if (o[n] !== undefined && o[n] !== null && o[n] !== '') return o[n];
  }
  return undefined;
};

/** Normaliza o corpo antes da validação, mapeando os apelidos conhecidos. */
export const normalizarEtapa = (bruto: unknown): unknown => {
  if (!bruto || typeof bruto !== 'object') return bruto;
  const o = { ...(bruto as Record<string, unknown>) };
  o.contato_id ??= aliases(bruto, ['contato', 'contatoId', 'id_contato', 'idContato', 'id', 'aluno_id', 'lead_id']);
  o.contato_nome ??= aliases(bruto, ['nome', 'aluno', 'contatoNome', 'nome_contato', 'lead']);
  o.etapa ??= aliases(bruto, ['etapa_atual', 'etapaAtual', 'stage', 'situacao', 'resumo', 'etapa_nome']);
  o.registrado_em ??= aliases(bruto, ['data', 'data_hora', 'dataHora', 'criacao', 'timestamp', 'ocorrido_em', 'registradoEm']);
  o.processo_nome ??= aliases(bruto, ['processo', 'processoNome', 'funil']);
  o.processo_id ??= aliases(bruto, ['processoId', 'id_processo']);
  o.origem ??= aliases(bruto, ['canal', 'origem_nome']);
  o.curso_codigo ??= aliases(bruto, ['curso', 'cursoCodigo']);
  o.responsavel_comercial ??= aliases(bruto, ['responsavel', 'consultor']);
  // Sem data explícita, o evento é agora: é quando o CRM disparou.
  o.registrado_em ??= new Date().toISOString();
  return o;
};

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
  origem: z.string().nullish(),
  modalidade: z.string().nullish(),
  unidade: z.string().nullish(),
  responsavel_comercial: z.string().nullish(),
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

export const funilQuerySchema = z.object({
  funil_id: z.string().min(1).optional(),
  dias: z.coerce.number().int().min(1).max(365).default(90),
});
