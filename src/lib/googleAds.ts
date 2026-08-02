/**
 * Cliente do Google Ads para o Worker.
 *
 * O painel consulta a API ao vivo — o n8n não alimenta mais estes números. O
 * D1 continua sendo fonte só do que não existe em outro lugar (funil do Rubeus,
 * conversas da Evolution).
 *
 * Conta: a `GOOGLE_ADS_LOGIN_CUSTOMER_ID` do projeto NÃO é um MCC — é a própria
 * conta "Faculdade IDE" (manager: false). Por isso o header `login-customer-id`
 * não é enviado: ele só se aplica quando se acessa um cliente através de um
 * gerenciador.
 */

const OAUTH_URL = 'https://oauth2.googleapis.com/token';

/**
 * Cache do access token no escopo do isolate.
 *
 * Não é estado de requisição — é credencial da aplicação, idêntica para todo
 * mundo e sem nenhum dado de usuário. Sem isso, cada request do painel gastaria
 * uma ida ao OAuth do Google antes da consulta real.
 */
let tokenCache: { valor: string; expiraEm: number } | null = null;

export class ErroGoogleAds extends Error {
  constructor(msg: string, readonly status: number = 502) {
    super(msg);
  }
}

async function obterAccessToken(env: Env): Promise<string> {
  const agora = Date.now();
  if (tokenCache && tokenCache.expiraEm > agora + 60_000) return tokenCache.valor;

  const faltando = (['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN'] as const)
    .filter((k) => !env[k]);
  if (faltando.length) {
    throw new ErroGoogleAds(`credenciais ausentes: ${faltando.join(', ')}`, 500);
  }

  const resp = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_ADS_CLIENT_ID,
      client_secret: env.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: env.GOOGLE_ADS_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  if (!resp.ok) {
    const corpo = await resp.text();
    console.error(JSON.stringify({ evento: 'oauth_falhou', status: resp.status, corpo: corpo.slice(0, 300) }));
    throw new ErroGoogleAds('não foi possível renovar o token do Google Ads', 502);
  }

  const dados = (await resp.json()) as { access_token: string; expires_in: number };
  tokenCache = { valor: dados.access_token, expiraEm: agora + dados.expires_in * 1000 };
  return dados.access_token;
}

function versaoApi(env: Env): string {
  const v = (env.GOOGLE_ADS_API_VERSION || 'v24').trim();
  return v.startsWith('v') ? v : `v${v}`;
}

function customerId(env: Env): string {
  const id = (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/\D/g, '');
  if (!id) throw new ErroGoogleAds('GOOGLE_ADS_LOGIN_CUSTOMER_ID não configurado', 500);
  return id;
}

/**
 * Executa uma consulta GAQL, seguindo a paginação até o fim.
 *
 * `search` (e não `searchStream`) porque o volume por página é pequeno e o
 * corpo vem como JSON único — streaming aqui só adicionaria parsing manual de
 * chunks sem ganho.
 */
export async function consultar<T = Record<string, unknown>>(
  env: Env,
  query: string,
): Promise<T[]> {
  const token = await obterAccessToken(env);
  const cid = customerId(env);
  const url = `https://googleads.googleapis.com/${versaoApi(env)}/customers/${cid}/googleAds:search`;

  const linhas: T[] = [];
  let pageToken: string | undefined;

  do {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'developer-token': env.GOOGLE_ADS_DEVELOPER_TOKEN,
        'Content-Type': 'application/json',
      },
      // Sem `pageSize`: a v24 rejeita o campo com PAGE_SIZE_NOT_SUPPORTED.
      // A paginação fica só por conta do nextPageToken.
      body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
    });

    if (!resp.ok) {
      const corpo = await resp.text();
      console.error(JSON.stringify({
        evento: 'google_ads_erro',
        status: resp.status,
        query: query.slice(0, 200),
        corpo: corpo.slice(0, 500),
      }));
      throw new ErroGoogleAds(`Google Ads respondeu ${resp.status}`, 502);
    }

    const dados = (await resp.json()) as { results?: T[]; nextPageToken?: string };
    if (dados.results?.length) linhas.push(...dados.results);
    pageToken = dados.nextPageToken;
  } while (pageToken);

  return linhas;
}

// ------------------------------------------------------------------ helpers

/** Micros → unidade monetária. O Google devolve custo em milionésimos. */
export const deMicros = (v: unknown): number => (Number(v) || 0) / 1_000_000;

export const num = (v: unknown): number => Number(v) || 0;

/** Escapa aspas simples pra interpolação segura em GAQL. */
export const gaql = (v: string): string => v.replace(/'/g, "\\'");

/** Valida YYYY-MM-DD antes de entrar numa cláusula BETWEEN. */
export function dataValida(s: string | undefined): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * Janela anterior de mesmo tamanho, para o "Comparar KPIs".
 * Inclusiva nas duas pontas, como o BETWEEN do GAQL.
 */
export function janelaAnterior(de: string, ate: string): { de: string; ate: string } {
  const d1 = new Date(`${de}T00:00:00Z`).getTime();
  const d2 = new Date(`${ate}T00:00:00Z`).getTime();
  const dias = Math.round((d2 - d1) / 86_400_000) + 1;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { de: iso(d1 - dias * 86_400_000), ate: iso(d1 - 86_400_000) };
}
