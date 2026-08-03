import { Hono } from 'hono';
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

/** GET /oauth/rdstation/iniciar — manda para a tela de autorização. */
oauth.get('/rdstation/iniciar', (c) => {
  const id = c.env.RD_STATION_CLIENT_ID;
  if (!id) return c.json({ erro: 'RD_STATION_CLIENT_ID não configurado' }, 500);
  const redirect = `${new URL(c.req.url).origin}/oauth/rdstation/callback`;
  return c.redirect(
    `https://api.rd.services/auth/dialog?client_id=${encodeURIComponent(id)}&redirect_uri=${encodeURIComponent(redirect)}`,
  );
});

/**
 * GET /oauth/rdstation/callback — troca o code por tokens e guarda o refresh.
 *
 * O RD manda o usuário de volta aqui com `?code=`. O code vale uma vez só e
 * expira rápido, então a troca acontece no mesmo request.
 */
oauth.get('/rdstation/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) return c.html(pagina('Autorização cancelada', 'O RD Station não devolveu um código.'), 400);

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

/** Página mínima de retorno — o usuário chega aqui pelo navegador, não por API. */
const pagina = (titulo: string, msg: string) => `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${titulo}</title>
<style>body{background:#0a0e14;color:#f5f7fa;font-family:system-ui,sans-serif;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
h1{font-size:19px;margin:0 0 8px}p{color:#9aa5b4;font-size:13px;margin:0 0 16px}
a{color:#7fb0f2;font-size:13px}</style></head>
<body><div><h1>${titulo}</h1><p>${msg}</p><a href="/#/webhooks">Voltar ao painel</a></div></body></html>`;

export default oauth;
