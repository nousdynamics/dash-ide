/** Secrets / vars do Rubeus — opcionais até `wrangler secret put`. */
interface Env {
  RUBEUS_ORIGEM?: string;
  RUBEUS_TOKEN?: string;
  RUBEUS_BASE_URL?: string;
}
