/** Secrets / vars do Rubeus — opcionais até `wrangler secret put`. */
interface Env {
  RUBEUS_ORIGEM?: string;
  RUBEUS_TOKEN?: string;
  RUBEUS_BASE_URL?: string;
}

/** Secrets do Meta Ads — opcionais até `wrangler secret put`; sem eles a tela avisa em vez de quebrar. */
interface Env {
  META_ACCESS_TOKEN?: string;
  META_APP_SECRET?: string;
  META_AD_ACCOUNT_ID?: string;
  META_API_VERSION?: string;
}
