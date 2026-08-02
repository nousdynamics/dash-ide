import { z } from 'zod';
import { STATUS_CONVERSAO } from './etapas';

/**
 * Schemas de corpo dos webhooks.
 *
 * Regra do plano (seção 5): rejeitar campo faltante com 400, nunca gravar linha
 * parcial em silêncio. Campo opcional aqui significa "o Rubeus legitimamente
 * pode não mandar", não "não sei se vem".
 *
 * `.nullish()` em vez de `.optional()` porque o code node do n8n normaliza
 * ausência para `null` explícito, não para chave ausente.
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

// POST /webhook/n8n/conversao
export const conversaoSchema = z.object({
  contato_id: idFlexivel,
  etapa: z.string().min(1),
  status: z.enum(STATUS_CONVERSAO),
  contato_nome: z.string().nullish(),
  gclid: z.string().nullish(),
  conversion_action: z.string().nullish(),
  valor: z.coerce.number().nullish(),
  erro_detalhe: z.string().nullish(),
  enviado_em: timestamp.nullish(),
});

// POST /webhook/n8n/metricas — o n8n manda o lote de campanhas do dia de uma vez.
const metricaSchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'esperado YYYY-MM-DD'),
  campanha_id: idFlexivel,
  campanha_nome: z.string().nullish(),
  investimento: z.coerce.number().nonnegative().nullish(),
  impressoes: z.coerce.number().int().nonnegative().nullish(),
  cliques: z.coerce.number().int().nonnegative().nullish(),
  cpc_medio: z.coerce.number().nonnegative().nullish(),
  ctr: z.coerce.number().nullish(),
  conversoes_primarias: z.coerce.number().nullish(),
  conversoes_secundarias: z.coerce.number().nullish(),
});

type Metrica = z.infer<typeof metricaSchema>;

/**
 * Aceita as três formas que o n8n pode mandar dependendo de como o node estiver
 * configurado: array puro, objeto único, ou embrulhado em `{ metricas: [...] }`.
 * Sempre devolve array, pra o handler ter um caminho só.
 */
export const metricasSchema = z
  .union([
    z.array(metricaSchema).min(1, 'lote vazio'),
    z.object({ metricas: z.array(metricaSchema).min(1, 'lote vazio') }),
    metricaSchema,
  ])
  .transform((v): Metrica[] => {
    if (Array.isArray(v)) return v;
    if ('metricas' in v) return v.metricas;
    return [v];
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
  processo_id: z.string().min(1).optional(),
  dias: z.coerce.number().int().min(1).max(365).default(90),
});
