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

// POST /webhook/rubeus/etapa
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
