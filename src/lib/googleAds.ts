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
/**
 * Cache das respostas do Google Ads, na Cache API da borda.
 *
 * O painel disparava três consultas por abertura de tela, de novo a cada troca
 * de período e por pessoa que abrisse — para um dado que o próprio Google avisa
 * não ser gerado em tempo real. Cinco pessoas olhando de manhã eram dezenas de
 * chamadas para o mesmo número.
 *
 * A validade sai do próprio período consultado: janela que termina no passado
 * não muda mais, então vale horas; janela que inclui hoje ainda recebe
 * conversão atrasada, e aí é minutos.
 */
const TTL_FECHADO_S = 6 * 60 * 60;
const TTL_ABERTO_S = 15 * 60;

function ttlDaConsulta(query: string): number {
  /*
   * Procura a data final do BETWEEN. Sem data na consulta — catálogo de
   * campanha, lista de ação — o dado é estrutural e muda pouco: TTL longo.
   */
  const datas = query.match(/\d{4}-\d{2}-\d{2}/g);
  if (!datas?.length) return TTL_FECHADO_S;
  const fim = datas.sort().at(-1)!;
  /*
   * Fechado é "termina antes de ONTEM", não antes de hoje.
   *
   * O Google atribui conversão com atraso: o número de ontem ainda muda ao
   * longo do dia de hoje. Como o painel usa ontem como fim padrão, tratar isso
   * como fechado congelaria por 6 h justamente a tela que todo mundo abre.
   * Comparação em Brasília — o Worker roda em UTC e às 21h daqui já é o dia
   * seguinte lá.
   */
  const agoraBr = Date.now() - 3 * 3_600_000;
  const ontemBr = new Date(agoraBr - 86_400_000).toISOString().slice(0, 10);
  return fim < ontemBr ? TTL_FECHADO_S : TTL_ABERTO_S;
}

/** Chave estável e opaca: a consulta inteira, sem expor GAQL numa URL. */
async function chaveDeCache(env: Env, query: string): Promise<Request> {
  const material = `${customerId(env)}|${versaoApi(env)}|${query}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return new Request(`https://ads-cache.painel.interno/${hex}`, { method: 'GET' });
}

export async function consultar<T = Record<string, unknown>>(
  env: Env,
  query: string,
): Promise<T[]> {
  const chave = await chaveDeCache(env, query);
  const cache = caches.default;

  /*
   * Cache corrompido não derruba a tela.
   *
   * Uma entrada truncada — escrita cancelada, disco cheio, o que for — faria
   * `json()` estourar e a tela mostrar erro por causa de um cache, que é
   * otimização e nunca deveria ser caminho crítico. Se não der para ler,
   * consulta a origem como se não houvesse cache.
   */
  const guardado = await cache.match(chave);
  if (guardado) {
    try {
      const linhasEmCache = (await guardado.json()) as T[];
      if (Array.isArray(linhasEmCache)) {
        console.log(JSON.stringify({ evento: 'google_ads_cache_hit', query: query.slice(0, 80) }));
        return linhasEmCache;
      }
    } catch {
      console.warn(JSON.stringify({ evento: 'google_ads_cache_ilegivel', query: query.slice(0, 80) }));
    }
  }

  const linhas = await consultarNaOrigem<T>(env, query);

  /*
   * `await` no put, mesmo custando alguns ms no miss.
   *
   * Sem esperar, o runtime cancela a escrita quando o request termina e a
   * entrada fica truncada — o próximo acesso lê corpo vazio e a tela quebra.
   * Foi exatamente o que aconteceu no primeiro teste: 92 ms de resposta e
   * "Unexpected end of JSON input".
   */
  const ttl = ttlDaConsulta(query);
  try {
    await cache.put(
      chave,
      new Response(JSON.stringify(linhas), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttl}` },
      }),
    );
  } catch {
    /* falha de escrita só custa um miss no próximo acesso */
  }

  return linhas;
}

async function consultarNaOrigem<T>(env: Env, query: string): Promise<T[]> {
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
