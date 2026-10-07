/**
 * Cliente do Meta Ads (Graph API / Marketing API) para o Worker.
 *
 * Mesmo desenho do Google Ads: o painel consulta ao vivo, e o D1 não guarda
 * número de mídia. O token é de um usuário de sistema do Business Manager
 * ("Conversions API System User") — não expira, então não há fluxo de renovação
 * como no Google.
 *
 * Conta: `META_AD_ACCOUNT_ID` é a conta "Faculdade IDE" (act_848063628589919),
 * a única que esse usuário de sistema enxerga. Moeda BRL, fuso de São Paulo —
 * o `time_range` dos insights já é interpretado nesse fuso.
 */

import { ttlDaConsulta } from './googleAds';

export class ErroMetaAds extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function versaoApi(env: Env): string {
  const v = (env.META_API_VERSION || 'v24.0').trim();
  return v.startsWith('v') ? v : `v${v}`;
}

export function contaMeta(env: Env): string {
  const id = (env.META_AD_ACCOUNT_ID || '').trim().replace(/^act_/, '').replace(/\D/g, '');
  if (!id) throw new ErroMetaAds('META_AD_ACCOUNT_ID não configurado', 500);
  return `act_${id}`;
}

function token(env: Env): string {
  const t = (env.META_ACCESS_TOKEN || '').trim();
  if (!t) throw new ErroMetaAds('META_ACCESS_TOKEN não configurado', 500);
  return t;
}

/**
 * `appsecret_proof`: HMAC-SHA256 do token com o segredo do app.
 *
 * Amarra o token ao app — um token vazado de log não funciona sozinho em quem
 * não tem o segredo. Opcional: sem `META_APP_SECRET` a chamada segue sem ele.
 */
async function provaDoSegredo(env: Env, tk: string): Promise<string | null> {
  const segredo = (env.META_APP_SECRET || '').trim();
  if (!segredo) return null;
  const chave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(segredo),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const assinatura = await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(tk));
  return [...new Uint8Array(assinatura)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Lê um endpoint da Graph API, seguindo `paging.next` até o fim.
 *
 * `caminho` é relativo à versão (`act_123/insights`). O token vai no header
 * Authorization, nunca na URL — URL acaba em log, header não.
 */
export async function consultarMeta<T = Record<string, unknown>>(
  env: Env,
  caminho: string,
  params: Record<string, string>,
): Promise<T[]> {
  const busca = new URLSearchParams(params);
  busca.sort();
  const chave = await chaveDeCache(env, `${caminho}?${busca}`);
  const cache = caches.default;

  // Cache corrompido não derruba a tela — ver o mesmo trecho em googleAds.ts.
  const guardado = await cache.match(chave);
  if (guardado) {
    try {
      const linhas = (await guardado.json()) as T[];
      if (Array.isArray(linhas)) return linhas;
    } catch {
      console.warn(JSON.stringify({ evento: 'meta_ads_cache_ilegivel', caminho }));
    }
  }

  const linhas = await consultarNaOrigem<T>(env, caminho, busca);

  // `await` no put pelo mesmo motivo do Google: sem ele a escrita é cancelada
  // no fim do request e a entrada fica truncada.
  try {
    await cache.put(
      chave,
      new Response(JSON.stringify(linhas), {
        headers: {
          'Content-Type': 'application/json',
          // Mesma regra de validade do Google: janela fechada vale horas,
          // janela que inclui ontem ou hoje vale minutos.
          'Cache-Control': `max-age=${ttlDaConsulta(busca.get('time_range') ?? '')}`,
        },
      }),
    );
  } catch {
    /* falha de escrita só custa um miss no próximo acesso */
  }
  return linhas;
}

async function chaveDeCache(env: Env, material: string): Promise<Request> {
  const texto = `${contaMeta(env)}|${versaoApi(env)}|${material}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return new Request(`https://meta-cache.painel.interno/${hex}`, { method: 'GET' });
}

async function consultarNaOrigem<T>(env: Env, caminho: string, busca: URLSearchParams): Promise<T[]> {
  const tk = token(env);
  const prova = await provaDoSegredo(env, tk);
  if (prova) busca.set('appsecret_proof', prova);
  if (!busca.has('limit')) busca.set('limit', '500');

  const linhas: T[] = [];
  let url: string | null = `https://graph.facebook.com/${versaoApi(env)}/${caminho}?${busca}`;
  // Teto de páginas: uma conta com milhares de anúncios não pode prender o Worker.
  for (let pagina = 0; url && pagina < 20; pagina++) {
    const resp: Response = await fetch(url, { headers: { Authorization: `Bearer ${tk}` } });
    if (!resp.ok) {
      const corpo = await resp.text();
      console.error(JSON.stringify({
        evento: 'meta_ads_erro',
        status: resp.status,
        caminho,
        corpo: corpo.slice(0, 500),
      }));
      throw new ErroMetaAds(`Meta Ads respondeu ${resp.status}`, 502);
    }
    const dados = (await resp.json()) as { data?: T[]; paging?: { next?: string } };
    if (dados.data?.length) linhas.push(...dados.data);
    // O `next` da Graph API já traz os parâmetros (inclusive o appsecret_proof).
    url = dados.paging?.next ?? null;
  }
  return linhas;
}

// ------------------------------------------------------------------ ações

/**
 * O que conta como CONVERSÃO no Meta — decisão do time, não do gerenciador.
 *
 * O gerenciador chama de "resultado" o evento que cada conjunto otimiza, e na
 * conta da IDE os conjuntos de site otimizam `click_cta`: clique no botão da
 * landing, não contato deixado. Com ele, o custo por resultado saía ≈ R$ 7,60
 * contra ≈ R$ 42 contando só quem deixou contato — o mesmo engano que o painel
 * já corrigiu no Google (ver totalizar() em routes/ads.ts).
 *
 *   lead                        → lead do pixel + formulário instantâneo
 *                                  (o Meta já deduplica os dois neste total)
 *   messaging_conversation_started_7d → conversa iniciada no WhatsApp/Direct
 */
export const ACOES_CONVERSAO = [
  'lead',
  'onsite_conversion.messaging_conversation_started_7d',
] as const;

/**
 * Ações exibidas no "de onde vêm as conversões", com nome legível.
 *
 * Lista fechada de propósito: o Meta devolve ~40 tipos de ação por período
 * (curtida, salvamento, clique no link…), e a tela quer as que dizem algo sobre
 * captação — clique no link já tem card próprio e, com milhares por mês,
 * afogaria as conversões no ranking. O `fb_pixel_custom` é o `click_cta` da landing — fica visível como
 * secundária porque é o que os conjuntos otimizam.
 */
export const ACOES_EXIBIDAS: Record<string, { nome: string; tipo: 'primaria' | 'secundaria' }> = {
  lead: { nome: 'Lead (pixel + formulário)', tipo: 'primaria' },
  'onsite_conversion.messaging_conversation_started_7d': { nome: 'Conversa iniciada (WhatsApp/Direct)', tipo: 'primaria' },
  'offsite_conversion.fb_pixel_custom': { nome: 'Evento personalizado do pixel (click_cta)', tipo: 'secundaria' },
};

export type AcaoMeta = { action_type: string; value: string };

/** Soma de uma lista de ações do Meta para os tipos pedidos. */
export function somaAcoes(acoes: AcaoMeta[] | undefined, tipos: readonly string[]): number {
  let s = 0;
  for (const a of acoes ?? []) if (tipos.includes(a.action_type)) s += Number(a.value) || 0;
  return s;
}

/** `time_range` no formato que a Graph API espera. */
export const intervaloMeta = (de: string, ate: string) => JSON.stringify({ since: de, until: ate });
