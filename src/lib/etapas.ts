/**
 * Nomes de etapa exatamente como aparecem no Rubeus (seção 9 do plano — não
 * traduzir, não abreviar, não normalizar acento). A ordem aqui define a ordem
 * de exibição do funil no painel — espelha o kanban do CRM.
 */
export const ETAPAS_FUNIL = [
  'Não contactado',
  'Interessados',
  'Novo Lead',
  'Conexão',
  'Em qualificação',
  'Quer se inscrever',
  'Inscrito Parcial',
  'Oportunidade',
  'Oportunidade paga',
  'Pré-inscrição',
  'Oportunidade (Inscrição concluída)',
  'Documentos enviados (transf., diploma, enem)',
  'Aprovado (vestibular)',
  'Aptos para a matrícula',
  'Pré- Matriculado (contrato assinado)',
  'Matrícula COMERCIAL concluída',
  'Matrículado',
  'Matrícula ACADÊMICA concluída',
  'Matrículado Acadêmico',
] as const;

export type EtapaFunil = (typeof ETAPAS_FUNIL)[number];

/** Valor de fábrica — indica que a ordem nunca foi ajustada na UI. */
export const ORDEM_ETAPA_PADRAO = 100;

const semAcento = (s: string): string =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/**
 * Faixa por macro quando o nome não casa com nenhum padrão conhecido.
 * Mantém etapas do mesmo nível juntas, acima/abaixo das vizinhas certas.
 */
const ORDEM_POR_MACRO: Record<string, number> = {
  lead: 150,
  qualificados: 250,
  oportunidade: 350,
  inscricao: 450,
  matricula: 550,
  ignorar: 9900,
};

/*
 * Ordem do kanban Rubeus (Pós / Curta / Graduação), do topo ao fundo.
 * Strings mais longas primeiro para "oportunidade paga" não cair em "oportunidade".
 *
 * Pós: Inscrito Parcial → Oportunidade → Oportunidade paga → Aptos →
 *      Matrícula COMERCIAL → Matrícula ACADÊMICA
 */
const PADROES_ORDEM: Array<{ inclui: string; ordem: number }> = [
  { inclui: 'desistente', ordem: 9900 },
  { inclui: 'reembolso', ordem: 9900 },
  { inclui: 'conversoes diversas', ordem: 9800 },
  { inclui: 'finalizou a inscricao no evento', ordem: 200 },
  { inclui: 'participou do evento', ordem: 210 },
  { inclui: 'indicou interesse no curso', ordem: 190 },
  { inclui: 'matricula academica concluida', ordem: 170 },
  { inclui: 'matriculado academico', ordem: 170 },
  { inclui: 'matricula comercial concluida', ordem: 160 },
  { inclui: 'pre- matriculado', ordem: 150 },
  { inclui: 'pre matriculado', ordem: 150 },
  { inclui: 'matriculado', ordem: 155 },
  { inclui: 'aptos para a matricula', ordem: 140 },
  { inclui: 'aptos para matricula', ordem: 140 },
  { inclui: 'aprovado (vestibular)', ordem: 130 },
  { inclui: 'documentos enviados', ordem: 120 },
  { inclui: 'oportunidade (inscricao concluida)', ordem: 110 },
  { inclui: 'pre-inscri', ordem: 100 },
  { inclui: 'pre_inscri', ordem: 100 },
  { inclui: 'iniciou o processo de inscr', ordem: 55 },
  { inclui: 'inscrito parcial', ordem: 60 },
  { inclui: 'quer se inscrever', ordem: 50 },
  { inclui: 'oportunidade paga', ordem: 80 },
  { inclui: 'oportunidade', ordem: 70 },
  { inclui: 'em qualificacao', ordem: 40 },
  { inclui: 'conexao', ordem: 30 },
  { inclui: 'novo lead', ordem: 20 },
  { inclui: 'interessados', ordem: 15 },
  { inclui: 'nao contactado', ordem: 10 },
];

const PADROES_ORDENADOS = [...PADROES_ORDEM].sort(
  (a, b) => b.inclui.length - a.inclui.length,
);

/**
 * Ordem padrão da esteira do detalhe por processo.
 *
 * Usado na criação de etapas (webhook/sync). Quem reordenou na UI mantém o
 * valor gravado — o upsert não sobrescreve `ordem` existente.
 */
export function inferirOrdemEtapa(nome: string, macro?: string | null): number {
  const n = semAcento(nome);
  if (!n || n.startsWith('(etapa')) return 9900;

  for (let i = 0; i < ETAPAS_FUNIL.length; i++) {
    const canon = ETAPAS_FUNIL[i];
    if (canon && n === semAcento(canon)) return (i + 1) * 10;
  }

  for (const { inclui, ordem } of PADROES_ORDENADOS) {
    if (n.includes(inclui)) return ordem;
  }

  if (macro) {
    const porMacro = ORDEM_POR_MACRO[macro];
    if (porMacro !== undefined) return porMacro;
  }
  return 7500;
}
