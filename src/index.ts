import { Hono } from 'hono';
import type { AppEnv } from './lib/tipos';
import ads from './routes/ads';
import api from './routes/api';
import funisRotas from './routes/funis';
import webhooks from './routes/webhooks';

const app = new Hono<AppEnv>();

/**
 * POST /webhook/* — chamadas servidor-a-servidor (Rubeus, n8n, Evolution API).
 * Protegidos pelo header X-Webhook-Secret e deliberadamente FORA do Cloudflare
 * Access, que barraria uma requisição sem sessão humana.
 */
app.route('/webhook', webhooks);

/**
 * GET /api/* — consumidos pelo painel. Sem autenticação própria: o Cloudflare
 * Access fica na frente do domínio e barra o request antes de chegar aqui.
 *
 * Para auditar quem acessou, o Access injeta o header abaixo automaticamente.
 */
app.use('/api/*', async (c, next) => {
  const email = c.req.header('Cf-Access-Authenticated-User-Email');
  if (email) c.set('usuarioEmail', email);
  await next();
});
// Consultas ao vivo no Google Ads. Montado antes de /api pra que as rotas
// específicas de mídia não passem pelo roteador de agregados do D1.
app.route('/api/funis', funisRotas);
app.route('/api/ads', ads);
app.route('/api', api);

/** Sonda de saúde — útil pra confirmar deploy e binding do D1 sem tocar em dado. */
app.get('/health', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first();
    return c.json({ ok: true, db: 'conectado' });
  } catch (e) {
    console.error(JSON.stringify({ evento: 'health_db_falhou', msg: String(e) }));
    return c.json({ ok: false, db: 'indisponivel' }, 503);
  }
});

app.notFound((c) => c.json({ erro: 'rota_nao_encontrada', rota: c.req.path }, 404));

/**
 * Handler de erro explícito em vez de `passThroughOnException()`: o cliente
 * recebe JSON estruturado e o stack fica no log, não na resposta.
 */
app.onError((err, c) => {
  console.error(JSON.stringify({
    evento: 'erro_nao_tratado',
    rota: c.req.path,
    metodo: c.req.method,
    msg: err.message,
    stack: err.stack,
  }));
  return c.json({ erro: 'erro_interno' }, 500);
});

export default app;
