const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dec = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const int = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

const vazio = (n) => n === null || n === undefined || Number.isNaN(n);

export const fmtBRL = (n) => (vazio(n) ? '—' : brl.format(n));
export const fmtInt = (n) => (vazio(n) ? '—' : int.format(n));
export const fmtDec = (n) => (vazio(n) ? '—' : dec.format(n));
export const fmtPct = (n) => (vazio(n) ? '—' : `${dec.format(n)}%`);

/** Eixo de gráfico usa forma curta: "R$ 1,2 mil" no lugar de "R$ 1.234,56". */
export const fmtBRLCurto = (n) =>
  n >= 1000 ? `R$ ${dec.format(n / 1000)} mil` : `R$ ${int.format(n || 0)}`;

/**
 * Converte "YYYY-MM-DD" em Date local.
 *
 * `new Date("2026-07-29")` é lido como UTC; no fuso do Brasil isso volta 28/07
 * ao formatar. Montamos por componente para não perder um dia em todo rótulo.
 */
export function dataLocal(iso) {
  if (!iso) return null;
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!a || !m || !d) return null;
  return new Date(a, m - 1, d);
}

export function fmtDiaMes(iso) {
  const d = dataLocal(iso);
  if (!d) return '—';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function fmtDataHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Iniciais para avatar. Sem foto real: é lead, não cliente confirmado (LGPD). */
export function iniciais(nome) {
  if (!nome) return '—';
  const partes = String(nome).trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '—';
  const a = partes[0][0] || '';
  const b = partes.length > 1 ? partes[partes.length - 1][0] || '' : '';
  return (a + b).toUpperCase();
}

export const ROTULO_STATUS = { ENABLED: 'Ativa', PAUSED: 'Pausada', REMOVED: 'Excluída' };
export const ROTULO_CORRESP = { EXACT: 'Exata', PHRASE: 'Frase', BROAD: 'Ampla' };
export const ROTULO_RECURSO = {
  SITELINK: 'Sitelink',
  CALLOUT: 'Frase de destaque',
  STRUCTURED_SNIPPET: 'Snippet estruturado',
  BUSINESS_NAME: 'Nome da empresa',
  HEADLINE: 'Título',
  DESCRIPTION: 'Descrição',
  CALL: 'Chamada',
  PRICE: 'Preço',
  PROMOTION: 'Promoção',
  IMAGE: 'Imagem',
  LOGO: 'Logo',
};
