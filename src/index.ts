import { Hono } from 'hono';
import { exigirAcesso } from './lib/access';
import { rodadaDiaria, rodadaLeve } from './lib/conversoes';
import { reconciliarRubeus } from './lib/sync';
import type { AppEnv } from './lib/tipos';
import ads from './routes/ads';
import api from './routes/api';
import coleta from './routes/coleta';
import conversoesRotas from './routes/conversoes';
import funisRotas from './routes/funis';
import metricasRotas from './routes/metricas';
import oauth from './routes/oauth';
import webhooks from './routes/webhooks';

const app = new Hono<AppEnv>();

/**
 * Cabeçalhos de resposta de tudo que sai do Worker.
 *
 * PRIMEIRO de todos. O Hono percorre os handlers na ordem de registro e para no
 * que responde: registrado depois de `/webhook`, este middleware simplesmente
 * não rodava para as rotas de webhook, que respondem sem chamar `next()`.
 *
 * `no-store` importa mais do que parece: as respostas de `/api` carregam dado de
 * lead e o endpoint de token devolve credencial viva. Sem isso, qualquer cache
 * no caminho — a borda, um proxy corporativo, o disco do navegador — fica com
 * uma cópia que sobrevive ao logout.
 */
app.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
});

/**
 * POST /webhook/* — chamadas servidor-a-servidor (Rubeus, n8n, Evolution API).
 * Autenticados pelo token do funil ou do evento e deliberadamente FORA do
 * Cloudflare Access, que barraria uma requisição sem sessão humana.
 */
app.route('/webhook', webhooks);

/**
 * POST /coleta/* — chamado pelo NAVEGADOR de quem visita o site da faculdade.
 *
 * Fora do Access pelo mesmo motivo que `/webhook`: quem chama é um visitante
 * anônimo, sem sessão. A porta aceita só entrada — nenhuma rota aqui devolve
 * dado guardado — e confere o `Origin` contra a lista de sites permitidos.
 */
app.route('/coleta', coleta);

/**
 * GET /api/* — consumidos pelo painel, atrás do Cloudflare Access.
 *
 * O middleware confere o JWT assinado do Access, não o header de e-mail: header
 * qualquer um manda, assinatura não. Ver src/lib/access.ts.
 */
app.use('/api/*', exigirAcesso);
// Consultas ao vivo no Google Ads. Montado antes de /api pra que as rotas
// específicas de mídia não passem pelo roteador de agregados do D1.
// Fluxo OAuth: fica atrás do Access, porque autorizar integração é ação
// administrativa e o retorno é um redirect no navegador de quem autorizou.
app.use('/oauth/*', exigirAcesso);
app.route('/oauth', oauth);
app.route('/api/funis', funisRotas);
app.route('/api/metricas', metricasRotas);
app.route('/api/ads', ads);
app.route('/api/conversoes', conversoesRotas);
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

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    /*
     * Dois cron para dois relógios diferentes.
     *
     * O diário é o pesado: reconcilia o catálogo do Rubeus e sobe a planilha.
     * O de meia em meia hora existe por causa do relógio do Google — a Data
     * Manager API só devolve o resultado do processamento 30 minutos depois da
     * ingestão, e com apenas a passada diária todo veredito chegaria com um dia
     * de atraso, com a tela dizendo "enviada" para conversão recusada nesse
     * meio-tempo.
     */
    if (event.cron !== '0 9 * * *') {
      ctx.waitUntil(rodadaLeve(env));
      return;
    }

    /*
     * Nesta ordem, e não em paralelo.
     *
     * A reconciliação do Rubeus é o que descobre o curso — e portanto o nível
     * de ensino — de quem chegou sem ele. A rodada de conversões escolhe a ação
     * do Google pelo nível. Invertendo, a fila do dia inteiro cairia na ação
     * curinga por falta de um dado que estava a um passo de existir.
     */
    ctx.waitUntil((async () => {
      await reconciliarRubeus(env);
      await rodadaDiaria(env);
    })());
  },
};
