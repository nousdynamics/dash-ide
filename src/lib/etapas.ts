/**
 * Nomes de etapa exatamente como aparecem no Rubeus (seção 9 do plano — não
 * traduzir, não abreviar, não normalizar acento). A ordem aqui define a ordem
 * de exibição do funil no painel.
 */
export const ETAPAS_FUNIL = [
  'Novo Lead',
  'Conexão',
  'Em qualificação',
  'Inscrito parcial',
  'Oportunidade',
  'Oportunidade paga',
  'Aptos para matrícula',
  'Matrícula comercial concluída',
] as const;

export type EtapaFunil = (typeof ETAPAS_FUNIL)[number];

/** Etapas que disparam conversão offline no Google Ads (via n8n). */
export const ETAPAS_DE_CONVERSAO = [
  'Oportunidade paga',
  'Matrícula comercial concluída',
] as const;

/** Status possíveis de uma conversão reportada pelo n8n. */
export const STATUS_CONVERSAO = ['enviada', 'sem_gclid', 'erro_api', 'pendente'] as const;
