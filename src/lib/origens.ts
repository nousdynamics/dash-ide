/**
 * De que canal veio o lead — a regra única, usada na captura e na tela.
 *
 * Três canais que o time quer ver separados, e nunca somados:
 *
 *   google_ads  → chegou com gclid/gbraid/wbraid, ou UTM paga de origem Google
 *   meta_ads    → UTM paga de origem Facebook/Instagram/Meta. Todos os anúncios
 *                 ativos da conta usam `utm_source=facebook&utm_medium=cpc`
 *                 (conferido em 05/10/2026 nos `url_tags` dos criativos)
 *   utm         → qualquer outra UTM: link divulgado organicamente — bio,
 *                 post, e-mail, WhatsApp, parceiro
 *
 * Sem UTM, a referência separa o resto: busca orgânica, rede social sem
 * marcação, outro site, ou direto.
 *
 * `fbclid` sozinho NÃO é Meta Ads: o Facebook põe fbclid em qualquer clique de
 * link, inclusive no post orgânico. O que separa o pago é a UTM do anúncio.
 */

export type Canal = 'google_ads' | 'meta_ads' | 'utm' | 'busca' | 'social' | 'referencia' | 'direto';

const MEIOS_PAGOS = new Set(['cpc', 'ppc', 'cpm', 'paid', 'paid_search', 'paid_social', 'paidsocial', 'ads', 'ad', 'display', 'pago', 'trafego_pago']);
const FONTES_META = new Set(['facebook', 'fb', 'instagram', 'ig', 'meta', 'facebook_ads', 'meta_ads', 'an', 'msg']);
const FONTES_GOOGLE = new Set(['google', 'google_ads', 'googleads', 'adwords', 'youtube']);

const BUSCADORES = /(^|\.)(google|bing|yahoo|duckduckgo|ecosia|yandex|baidu)\./;
const REDES = /(^|\.)(facebook|instagram|fb|threads|linkedin|lnkd|t|twitter|x|tiktok|youtube|youtu|pinterest|whatsapp|wa)\.(com|me|net|co|be)/;

export type DadosOrigem = {
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  tem_google_click?: boolean;
  referencia?: string | null;
};

export function classificarCanal(o: DadosOrigem): Canal {
  const fonte = (o.utm_source ?? '').trim().toLowerCase();
  const meio = (o.utm_medium ?? '').trim().toLowerCase();

  // Auto-tagging do Google: o gclid é a prova, com ou sem UTM.
  if (o.tem_google_click) return 'google_ads';
  if (MEIOS_PAGOS.has(meio)) {
    if (FONTES_META.has(fonte)) return 'meta_ads';
    if (FONTES_GOOGLE.has(fonte)) return 'google_ads';
  }
  if (fonte || meio || o.utm_campaign) return 'utm';

  const ref = (o.referencia ?? '').toLowerCase();
  if (!ref) return 'direto';
  if (BUSCADORES.test(ref)) return 'busca';
  if (REDES.test(ref)) return 'social';
  return 'referencia';
}

export const NOME_CANAL: Record<Canal, string> = {
  google_ads: 'Google Ads',
  meta_ads: 'Meta Ads',
  utm: 'Links UTM',
  busca: 'Busca orgânica',
  social: 'Rede social sem UTM',
  referencia: 'Outro site',
  direto: 'Direto',
};

/** UTM limpa: texto curto, sem quebra de linha. Valor vazio vira nulo. */
export function limparUtm(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 200);
  return s || null;
}

/** Só o host da referência — o caminho pode carregar dado pessoal. */
export function hostDaReferencia(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  try {
    return new URL(v).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}
