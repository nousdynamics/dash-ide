import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from './tipos';

/*
 * Cache de borda para os agregados caros do painel.
 *
 * O teto diário de leitura do D1 (plano gratuito: 5 milhões de linhas) é o
 * limite real deste painel. Em 01/10/2026 ele estourou à tarde e todas as telas
 * passaram a responder 500: a consulta de origem da pessoa no Funil lê ~143 mil
 * linhas por abertura, o volume da tela de Conversões ~28 mil, e cada abertura
 * de tela refazia tudo. Esses números mudam na escala de minutos, não de
 * segundos — guardar a resposta por alguns minutos troca dezenas de leituras
 * idênticas por uma.
 *
 * Usa a Cache API da Cloudflare (`caches.default`), que é por data center e
 * gratuita. A chave é a URL da requisição num host interno, então cada
 * combinação de período e filtro tem a sua entrada. Só entra resposta 200.
 *
 * Roda DEPOIS do `exigirAcesso` (está montado nas rotas, não no app), então
 * resposta do cache nunca chega a quem não passou pelo Access. Nenhuma das
 * rotas cacheadas varia por usuário.
 *
 * `X-Sem-Cache: 1` pula a leitura e regrava — o front manda isso logo depois
 * de uma gravação, para não mostrar o dado de antes dela.
 */
const HOST_INTERNO = 'https://cache-borda.painel.interno';

function chaveDe(url: string, prefixo = ''): string {
  const u = new URL(url);
  return `${HOST_INTERNO}/${prefixo}${u.pathname}${u.search}`;
}

export function cacheDeBorda(segundos: number): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.req.method !== 'GET') return next();
    const chave = chaveDe(c.req.url);
    const cache = caches.default;

    if (c.req.header('X-Sem-Cache') !== '1') {
      const achou = await cache.match(chave);
      if (achou) {
        const r = new Response(achou.body, achou);
        // Para o navegador é sempre fresco: o cache que vale é o da borda.
        r.headers.set('Cache-Control', 'no-store');
        r.headers.set('X-Cache-Borda', 'HIT');
        return r;
      }
    }

    await next();
    if (c.res.status !== 200) return;

    const copia = new Response(c.res.clone().body, c.res);
    copia.headers.set('Cache-Control', `max-age=${segundos}`);
    c.executionCtx.waitUntil(cache.put(chave, copia));
    c.res.headers.set('Cache-Control', 'no-store');
    c.res.headers.set('X-Cache-Borda', 'MISS');
  };
}

/**
 * Memoriza um pedaço de uma resposta — para rota que mistura dado caro e
 * estável com dado que muda a cada gravação (a tela de Conversões: o volume
 * de 60 dias com a configuração atual).
 */
export async function memorizar<T>(
  c: Context<AppEnv>,
  nome: string,
  segundos: number,
  calcular: () => Promise<T>,
): Promise<T> {
  const chave = `${HOST_INTERNO}/memo/${encodeURIComponent(nome)}`;
  const cache = caches.default;
  if (c.req.header('X-Sem-Cache') !== '1') {
    const achou = await cache.match(chave);
    if (achou) return (await achou.json()) as T;
  }
  const valor = await calcular();
  c.executionCtx.waitUntil(
    cache.put(
      chave,
      new Response(JSON.stringify(valor), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${segundos}` },
      }),
    ),
  );
  return valor;
}

/** Esquece um valor memorizado — chame depois de gravar o que ele resume. */
export function esquecer(c: Context<AppEnv>, nome: string): void {
  c.executionCtx.waitUntil(caches.default.delete(`${HOST_INTERNO}/memo/${encodeURIComponent(nome)}`));
}
