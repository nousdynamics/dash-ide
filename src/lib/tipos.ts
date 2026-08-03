/**
 * Contexto compartilhado por todas as rotas.
 *
 * `Bindings` vem de `worker-configuration.d.ts`, gerado por `wrangler types` a
 * partir do wrangler.jsonc — não escrever essa interface à mão, senão ela
 * silenciosamente diverge da config real.
 */
export type AppEnv = {
  Bindings: Env;
  Variables: {
    /** E-mail injetado pelo Cloudflare Access nas rotas do painel. */
    usuarioEmail?: string;
    /** Funil resolvido a partir do token do webhook. */
    funilId?: number;
  };
};
