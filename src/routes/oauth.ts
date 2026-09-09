import { Hono } from 'hono';
import { ESCOPOS_GOOGLE, esquecerToken } from '../lib/google';
import type { AppEnv } from '../lib/tipos';

/**
 * Fluxo OAuth do RD Station.
 *
 * Fica atrás do Cloudflare Access de propósito: autorizar a integração é ação
 * administrativa, e o Access garante que só alguém da lista de e-mails complete
 * o fluxo. Como o retorno é um redirect no navegador de quem autorizou, a
 * sessão do Access já existe e nada quebra.
 */
const oauth = new Hono<AppEnv>();

const TOKEN_URL = 'https://api.rd.services/auth/token';

const COOKIE_ESTADO = 'rd_oauth_state';

/**
 * GET /oauth/rdstation/iniciar — manda para a tela de autorização.
 *
 * O `state` aleatório vai junto e fica num cookie HttpOnly. Sem ele, bastaria
 * induzir alguém da lista a abrir uma URL de callback preparada para gravar o
 * refresh_token de OUTRA conta RD no nosso banco — daí em diante o painel
 * cruzaria dados com a base do atacante achando que é a da faculdade.
 */
oauth.get('/rdstation/iniciar', (c) => {
  const id = c.env.RD_STATION_CLIENT_ID;
  if (!id) return c.json({ erro: 'RD_STATION_CLIENT_ID não configurado' }, 500);

  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  const estado = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

  const redirect = `${new URL(c.req.url).origin}/oauth/rdstation/callback`;
  c.header(
    'Set-Cookie',
    `${COOKIE_ESTADO}=${estado}; Path=/oauth; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
  );
  return c.redirect(
    `https://api.rd.services/auth/dialog?client_id=${encodeURIComponent(id)}` +
      `&redirect_uri=${encodeURIComponent(redirect)}&state=${estado}`,
  );
});

/** Compara em tempo constante — o `state` é credencial de uso único. */
async function estadoConfere(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

/**
 * GET /oauth/rdstation/callback — troca o code por tokens e guarda o refresh.
 *
 * O RD manda o usuário de volta aqui com `?code=`. O code vale uma vez só e
 * expira rápido, então a troca acontece no mesmo request.
 */
oauth.get('/rdstation/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) return c.html(pagina('Autorização cancelada', 'O RD Station não devolveu um código.'), 400);

  // Queima o cookie logo: o `state` vale uma vez, dando certo ou errado.
  c.header('Set-Cookie', `${COOKIE_ESTADO}=; Path=/oauth; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);

  const esperado = (c.req.header('Cookie') || '')
    .split(';')
    .map((p) => p.trim().split('='))
    .find(([k]) => k === COOKIE_ESTADO)?.[1];
  const recebido = c.req.query('state');
  if (!esperado || !recebido || !(await estadoConfere(recebido, esperado))) {
    console.warn(JSON.stringify({ evento: 'rd_oauth_state_invalido', tem_cookie: Boolean(esperado) }));
    return c.html(
      pagina('Autorização não confere', 'Recomece a conexão pelo painel — o pedido não bate com o que foi iniciado aqui.'),
      403,
    );
  }

  const clientId = c.env.RD_STATION_CLIENT_ID;
  const clientSecret = c.env.RD_STATION_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return c.html(pagina('Falta configurar', 'RD_STATION_CLIENT_ID e RD_STATION_CLIENT_SECRET não estão publicados como secret.'), 500);
  }

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });

  const corpo = await resp.text();
  if (!resp.ok) {
    console.error(JSON.stringify({ evento: 'rd_oauth_falhou', status: resp.status, corpo: corpo.slice(0, 300) }));
    return c.html(pagina('Não foi possível conectar', `O RD Station respondeu ${resp.status}.`), 502);
  }

  const dados = JSON.parse(corpo) as { refresh_token?: string; scope?: string };
  if (!dados.refresh_token) {
    return c.html(pagina('Resposta inesperada', 'O RD Station não devolveu refresh_token.'), 502);
  }

  await c.env.DB.prepare(
    `INSERT INTO credenciais_oauth (provedor, refresh_token, escopo, conectado_por)
     VALUES ('rdstation', ?, ?, ?)
     ON CONFLICT (provedor) DO UPDATE SET
       refresh_token = excluded.refresh_token,
       escopo = excluded.escopo,
       conectado_em = datetime('now'),
       conectado_por = excluded.conectado_por`,
  )
    .bind(dados.refresh_token, dados.scope ?? null, c.get('usuarioEmail') ?? null)
    .run();

  console.log(JSON.stringify({ evento: 'rd_oauth_conectado', por: c.get('usuarioEmail') ?? 'desconhecido' }));
  return c.html(pagina('RD Station conectado', 'Pode fechar esta aba e voltar ao painel.'));
});

// ------------------------------------------------------------------ Google

const COOKIE_ESTADO_GOOGLE = 'google_oauth_state';

/**
 * GET /oauth/google/iniciar — reconsentimento da conta Google.
 *
 * Existe porque o consentimento antigo não cobre `datamanager`, e sem esse
 * escopo o envio de conversão responde 403 — a Google Ads API recusa
 * `uploadClickConversions` para integração nova e manda usar a Data Manager
 * API. Trocar o escopo de um refresh token exige passar pela tela do Google de
 * novo; não há atalho por API.
 *
 * `access_type=offline` + `prompt=consent`: sem os dois, o Google devolve só um
 * access token de uma hora para quem já autorizou antes, e o painel ficaria sem
 * refresh token — funcionando na primeira hora e quebrando depois do almoço,
 * que é o modo de falha mais difícil de diagnosticar.
 */
oauth.get('/google/iniciar', (c) => {
  const id = c.env.GOOGLE_ADS_CLIENT_ID;
  if (!id) return c.json({ erro: 'GOOGLE_ADS_CLIENT_ID não configurado' }, 500);

  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  const estado = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

  const redirect = `${new URL(c.req.url).origin}/oauth/google/callback`;
  c.header(
    'Set-Cookie',
    `${COOKIE_ESTADO_GOOGLE}=${estado}; Path=/oauth; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
  );

  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: redirect,
    response_type: 'code',
    scope: ESCOPOS_GOOGLE.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    // Mantém os escopos que a conta já concedeu, em vez de trocá-los por estes.
    include_granted_scopes: 'true',
    state: estado,
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

/** GET /oauth/google/callback — troca o code por refresh token e guarda. */
oauth.get('/google/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) {
    return c.html(pagina('Autorização cancelada', 'O Google não devolveu um código.'), 400);
  }

  // Queima o cookie logo: o `state` vale uma vez, dando certo ou errado.
  c.header('Set-Cookie', `${COOKIE_ESTADO_GOOGLE}=; Path=/oauth; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);

  const esperado = (c.req.header('Cookie') || '')
    .split(';')
    .map((p) => p.trim().split('='))
    .find(([k]) => k === COOKIE_ESTADO_GOOGLE)?.[1];
  const recebido = c.req.query('state');
  if (!esperado || !recebido || !(await estadoConfere(recebido, esperado))) {
    console.warn(JSON.stringify({ evento: 'google_oauth_state_invalido', tem_cookie: Boolean(esperado) }));
    return c.html(
      pagina('Autorização não confere', 'Recomece a conexão pelo painel — o pedido não bate com o que foi iniciado aqui.'),
      403,
    );
  }

  const resp = await fetch(TOKEN_URL_GOOGLE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.env.GOOGLE_ADS_CLIENT_ID,
      client_secret: c.env.GOOGLE_ADS_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${new URL(c.req.url).origin}/oauth/google/callback`,
    }),
  });

  const corpo = await resp.text();
  if (!resp.ok) {
    console.error(JSON.stringify({ evento: 'google_oauth_falhou', status: resp.status, corpo: corpo.slice(0, 300) }));
    return c.html(pagina('Não foi possível conectar', `O Google respondeu ${resp.status}.`), 502);
  }

  const dados = JSON.parse(corpo) as { refresh_token?: string; scope?: string };
  if (!dados.refresh_token) {
    /*
     * Sem refresh token não adianta guardar nada.
     *
     * Acontece quando a conta já autorizou este cliente antes e o Google
     * decide não reemitir. `prompt=consent` deveria evitar; quando não evita, o
     * caminho é revogar o acesso do app na conta Google e refazer.
     */
    return c.html(
      pagina(
        'O Google não devolveu refresh token',
        'Revogue o acesso deste app em myaccount.google.com/permissions e tente de novo.',
      ),
      502,
    );
  }

  await c.env.DB.prepare(
    `INSERT INTO credenciais_oauth (provedor, refresh_token, escopo, conectado_por)
     VALUES ('google', ?, ?, ?)
     ON CONFLICT (provedor) DO UPDATE SET
       refresh_token = excluded.refresh_token,
       escopo = excluded.escopo,
       conectado_em = datetime('now'),
       conectado_por = excluded.conectado_por`,
  )
    .bind(dados.refresh_token, dados.scope ?? null, c.get('usuarioEmail') ?? null)
    .run();

  // Sem isto, o access token velho — e sem o escopo novo — valeria mais uma hora.
  esquecerToken();

  const temDataManager = (dados.scope ?? '').includes('datamanager');
  console.log(JSON.stringify({
    evento: 'google_oauth_conectado',
    por: c.get('usuarioEmail') ?? 'desconhecido',
    tem_datamanager: temDataManager,
  }));

  return c.html(pagina(
    'Google conectado',
    temDataManager
      ? 'O envio de conversão já pode ser ligado. Pode fechar esta aba.'
      : 'Atenção: o escopo do Data Manager NÃO foi concedido, e sem ele a conversão não é enviada. Refaça a conexão marcando todas as permissões.',
  ));
});

const TOKEN_URL_GOOGLE = 'https://oauth2.googleapis.com/token';

/** Página mínima de retorno — o usuário chega aqui pelo navegador, não por API. */
const pagina = (titulo: string, msg: string) => `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${titulo}</title>
<style>body{background:#0a0e14;color:#f5f7fa;font-family:system-ui,sans-serif;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
h1{font-size:19px;margin:0 0 8px}p{color:#9aa5b4;font-size:13px;margin:0 0 16px}
a{color:#7fb0f2;font-size:13px}</style></head>
<body><div><h1>${titulo}</h1><p>${msg}</p><a href="/#/conversoes">Voltar ao painel</a></div></body></html>`;

export default oauth;
