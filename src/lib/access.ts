import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './tipos';

/**
 * Verificação do token do Cloudflare Access.
 *
 * Até aqui o Worker lia `Cf-Access-Authenticated-User-Email` e acreditava. Esse
 * header é injetado pelo Access, mas é só um header: qualquer requisição que
 * alcance o Worker por um caminho que não passe pela política — uma rota nova
 * mal configurada, um preview reativado sem querer, um Custom Domain acrescentado
 * depois — chega com o header que quiser e é atendida como se fosse gente da
 * lista. E o que está atrás dessas rotas não é só relatório: `/api/funis/:id/token`
 * entrega o token vivo de um webhook, e o log de "quem copiou" seria assinado
 * com o e-mail que o próprio invasor escolhesse.
 *
 * O Access também manda um JWT assinado (`Cf-Access-Jwt-Assertion`). Esse não dá
 * para forjar sem a chave privada da Cloudflare. Conferimos assinatura, público
 * e validade a cada request, e o e-mail passa a vir de dentro do token — não do
 * header ao lado dele.
 */

const CABECALHO_JWT = 'Cf-Access-Jwt-Assertion';
/** Uma hora. As chaves da Cloudflare giram devagar; `kid` desconhecido força recarga. */
const TTL_JWKS_MS = 60 * 60 * 1000;
/** Tolerância de relógio entre a borda que assinou e o isolate que confere. */
const FOLGA_S = 60;

type Carga = {
  aud?: string[] | string;
  email?: string;
  exp?: number;
  iat?: number;
  nbf?: number;
  iss?: string;
};

let cacheChaves: { mapa: Map<string, CryptoKey>; validoAte: number } | null = null;

function bytesDeB64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const textoDeB64Url = (s: string) => new TextDecoder().decode(bytesDeB64Url(s));

async function carregarChaves(dominioEquipe: string): Promise<Map<string, CryptoKey>> {
  const resp = await fetch(`https://${dominioEquipe}/cdn-cgi/access/certs`);
  if (!resp.ok) throw new Error(`jwks respondeu ${resp.status}`);
  const { keys } = (await resp.json()) as { keys: Array<Record<string, string>> };

  const mapa = new Map<string, CryptoKey>();
  for (const k of keys) {
    if (k.kty !== 'RSA' || !k.kid) continue;
    // JWK mínimo: `use`/`key_ops` vindos da Cloudflare às vezes brigam com o
    // importKey, e nada além de kty/n/e é necessário para conferir RS256.
    mapa.set(
      k.kid,
      await crypto.subtle.importKey(
        'jwk',
        { kty: 'RSA', n: k.n, e: k.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      ),
    );
  }
  return mapa;
}

async function chavePara(dominioEquipe: string, kid: string): Promise<CryptoKey | null> {
  if (!cacheChaves || cacheChaves.validoAte <= Date.now()) {
    cacheChaves = { mapa: await carregarChaves(dominioEquipe), validoAte: Date.now() + TTL_JWKS_MS };
  }
  const achada = cacheChaves.mapa.get(kid);
  if (achada) return achada;

  // `kid` novo: a Cloudflare girou as chaves antes do TTL vencer. Recarrega uma
  // vez — sem isso, toda a equipe ficaria trancada até o cache expirar.
  cacheChaves = { mapa: await carregarChaves(dominioEquipe), validoAte: Date.now() + TTL_JWKS_MS };
  return cacheChaves.mapa.get(kid) ?? null;
}

/** Devolve o e-mail do token quando ele é legítimo; `null` em qualquer outro caso. */
export async function emailDoToken(
  token: string,
  dominioEquipe: string,
  aud: string,
): Promise<string | null> {
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  const [cabB64, cargaB64, assinaturaB64] = partes as [string, string, string];

  let cabecalho: { alg?: string; kid?: string };
  let carga: Carga;
  try {
    cabecalho = JSON.parse(textoDeB64Url(cabB64));
    carga = JSON.parse(textoDeB64Url(cargaB64));
  } catch {
    return null;
  }

  // `alg` fixo em RS256: aceitar o que o token pedir é como o atacante escolher
  // o cadeado. "none" e HS256 com a chave pública viram bypass conhecidos.
  if (cabecalho.alg !== 'RS256' || !cabecalho.kid) return null;

  const chave = await chavePara(dominioEquipe, cabecalho.kid);
  if (!chave) return null;

  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    chave,
    bytesDeB64Url(assinaturaB64),
    new TextEncoder().encode(`${cabB64}.${cargaB64}`),
  );
  if (!ok) return null;

  /*
   * Assinatura boa não basta. O `aud` amarra o token A ESTA aplicação: sem
   * conferir, um token emitido para qualquer outra aplicação da mesma
   * organização — inclusive uma com lista de e-mails mais frouxa — abriria o
   * painel.
   */
  const audiencias = Array.isArray(carga.aud) ? carga.aud : carga.aud ? [carga.aud] : [];
  if (!audiencias.includes(aud)) return null;
  if (carga.iss !== `https://${dominioEquipe}`) return null;

  const agora = Math.floor(Date.now() / 1000);
  if (!carga.exp || carga.exp + FOLGA_S < agora) return null;
  if (carga.nbf && carga.nbf - FOLGA_S > agora) return null;

  return carga.email ?? null;
}

/**
 * Middleware das rotas do painel.
 *
 * Falha fechado: sem token válido, nada responde. É o oposto do que existia —
 * antes, a ausência do header apenas deixava o e-mail em branco e a rota
 * continuava servindo os dados.
 */
export const exigirAcesso: MiddlewareHandler<AppEnv> = async (c, next) => {
  /*
   * `wrangler dev` não tem Access na frente. A brecha é ligada por uma variável
   * que só existe em `.dev.vars` (nunca publicada), e não por heurística de
   * hostname: `localhost` viria do header Host, que o cliente escolhe.
   */
  if (c.env.AMBIENTE === 'dev') {
    c.set('usuarioEmail', 'dev@local');
    await next();
    return;
  }

  const { ACCESS_TEAM_DOMAIN: dominio, ACCESS_AUD: aud } = c.env;
  if (!dominio || !aud) {
    console.error(JSON.stringify({ evento: 'access_sem_configuracao', rota: c.req.path }));
    return c.json({ erro: 'servidor_sem_configuracao_de_acesso' }, 500);
  }

  const token = c.req.header(CABECALHO_JWT) || leCookie(c.req.header('Cookie'), 'CF_Authorization');
  if (!token) {
    console.warn(JSON.stringify({ evento: 'access_sem_token', rota: c.req.path }));
    return c.json({ erro: 'nao_autenticado' }, 401);
  }

  let email: string | null = null;
  try {
    email = await emailDoToken(token, dominio, aud);
  } catch (e) {
    // JWKS fora do ar não vira porta aberta.
    console.error(JSON.stringify({ evento: 'access_verificacao_falhou', msg: String(e) }));
    return c.json({ erro: 'nao_foi_possivel_validar_acesso' }, 503);
  }

  if (!email) {
    console.warn(JSON.stringify({ evento: 'access_token_invalido', rota: c.req.path }));
    return c.json({ erro: 'nao_autorizado' }, 403);
  }

  c.set('usuarioEmail', email);
  await next();
};

/**
 * Quem administra webhooks.
 *
 * O Access libera o domínio inteiro `@faculdadeide.edu.br`, o que está certo
 * para relatório: investimento, funil e conversas são o trabalho de todo mundo
 * ali. A tela de Funis e webhooks é outra coisa — ela EMITE credencial de
 * escrita no banco. Um segundo nível separa "ver o resultado" de "criar a chave
 * que grava o resultado", que são autorizações de natureza diferente.
 */
export function ehAdmin(env: Env, email: string | undefined): boolean {
  if (!email) return false;
  const lista = (env.ADMINS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  // Lista vazia não vira "todo mundo pode": nesse caso ninguém administra.
  return lista.includes(email.toLowerCase());
}

/** Middleware das rotas que emitem ou revogam credencial. */
export const exigirAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const email = c.get('usuarioEmail');
  if (!ehAdmin(c.env, email)) {
    console.warn(JSON.stringify({ evento: 'admin_negado', rota: c.req.path, por: email ?? '?' }));
    return c.json({ erro: 'sem_permissao' }, 403);
  }
  await next();
};

/** O JWT também vem no cookie quando a navegação não passa pelo header. */
function leCookie(cabecalho: string | undefined, nome: string): string | null {
  if (!cabecalho) return null;
  for (const parte of cabecalho.split(';')) {
    const [k, ...resto] = parte.trim().split('=');
    if (k === nome) return resto.join('=') || null;
  }
  return null;
}
