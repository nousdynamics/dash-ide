import type { MiddlewareHandler } from 'hono';

/**
 * Compara dois segredos em tempo constante.
 *
 * `crypto.subtle.timingSafeEqual` exige buffers do mesmo tamanho e lança se
 * forem diferentes — o que por si só já vazaria o comprimento do segredo. Por
 * isso passamos os dois por SHA-256 antes: o digest tem sempre 32 bytes,
 * independente da entrada.
 */
async function segredosConferem(recebido: string, esperado: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [hashRecebido, hashEsperado] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(recebido)),
    crypto.subtle.digest('SHA-256', encoder.encode(esperado)),
  ]);
  return crypto.subtle.timingSafeEqual(hashRecebido, hashEsperado);
}

/**
 * Exige o header `X-Webhook-Secret` em todo POST vindo de Rubeus / n8n /
 * Evolution API (seção 2 do plano: validado ANTES de gravar qualquer coisa).
 *
 * Não protege as rotas GET do painel — essas ficam atrás do Cloudflare Access,
 * que barra o request antes de chegar aqui.
 */
export const exigirSegredoDeWebhook: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const esperado = c.env.WEBHOOK_SECRET;

  if (!esperado) {
    // Falha fechado: sem secret configurado, nenhum webhook é aceito. O
    // contrário abriria a porta de escrita do banco durante um deploy ruim.
    console.error(JSON.stringify({
      evento: 'webhook_secret_ausente',
      rota: c.req.path,
      msg: 'WEBHOOK_SECRET não configurado — rodar `wrangler secret put WEBHOOK_SECRET`',
    }));
    return c.json({ erro: 'servidor_sem_segredo_configurado' }, 500);
  }

  const recebido = c.req.header('X-Webhook-Secret');
  if (!recebido || !(await segredosConferem(recebido, esperado))) {
    console.warn(JSON.stringify({
      evento: 'webhook_nao_autorizado',
      rota: c.req.path,
      tem_header: Boolean(recebido),
    }));
    return c.json({ erro: 'nao_autorizado' }, 401);
  }

  await next();
};
