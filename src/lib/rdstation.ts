/**
 * Cliente RD Station Marketing — access token via refresh guardado no D1.
 *
 * Analytics funnel: Visitantes / Leads do topo da planilha.
 * Doc: GET https://api.rd.services/platform/analytics/funnel
 */

const TOKEN_URL = 'https://api.rd.services/auth/token';
const FUNNEL_URL = 'https://api.rd.services/platform/analytics/funnel';

export class ErroRdStation extends Error {
  constructor(msg: string, readonly status: number = 502) {
    super(msg);
  }
}

let cacheAccess: { valor: string; expiraEm: number } | null = null;

async function accessToken(env: Env, db: D1Database): Promise<string> {
  const agora = Date.now();
  if (cacheAccess && cacheAccess.expiraEm > agora + 60_000) return cacheAccess.valor;

  const clientId = env.RD_STATION_CLIENT_ID;
  const clientSecret = env.RD_STATION_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new ErroRdStation('RD_STATION_CLIENT_ID / CLIENT_SECRET não configurados', 500);
  }

  const cred = await db.prepare(
    `SELECT refresh_token FROM credenciais_oauth WHERE provedor = 'rdstation' LIMIT 1`,
  ).first() as { refresh_token: string } | null;

  if (!cred?.refresh_token) {
    throw new ErroRdStation('RD Station não conectado — autorize em /oauth/rdstation/iniciar', 503);
  }

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: cred.refresh_token,
    }),
  });

  const texto = await resp.text();
  if (!resp.ok) {
    console.error(JSON.stringify({
      evento: 'rd_token_falhou',
      status: resp.status,
      corpo: texto.slice(0, 300),
    }));
    throw new ErroRdStation('não foi possível renovar o token do RD Station', 502);
  }

  const dados = JSON.parse(texto) as {
    access_token: string;
    expires_in?: number;
    refresh_token?: string;
  };

  if (dados.refresh_token && dados.refresh_token !== cred.refresh_token) {
    await db.prepare(
      `UPDATE credenciais_oauth SET refresh_token = ? WHERE provedor = 'rdstation'`,
    ).bind(dados.refresh_token).run();
  }

  const ttl = (dados.expires_in ?? 3600) * 1000;
  cacheAccess = { valor: dados.access_token, expiraEm: agora + ttl };
  return dados.access_token;
}

export type FunilRd = {
  visitors?: number;
  leads?: number;
  qualified_leads?: number;
  opportunities?: number;
  sales?: number;
  [k: string]: unknown;
};

/**
 * Estatísticas do funil de marketing no período.
 * Devolve `null` se a Analysis API não estiver no plano (403/404).
 */
export async function funilMarketing(
  env: Env,
  db: D1Database,
  de: string,
  ate: string,
): Promise<{ ok: true; dados: FunilRd } | { ok: false; motivo: string }> {
  let token: string;
  try {
    token = await accessToken(env, db);
  } catch (e) {
    const msg = e instanceof ErroRdStation ? e.message : String(e);
    return { ok: false, motivo: msg };
  }

  const qs = new URLSearchParams({
    start_date: de.slice(0, 10),
    end_date: ate.slice(0, 10),
  });

  const resp = await fetch(`${FUNNEL_URL}?${qs}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });

  const texto = await resp.text();
  if (resp.status === 403 || resp.status === 404 || resp.status === 402) {
    console.warn(JSON.stringify({
      evento: 'rd_analytics_indisponivel',
      status: resp.status,
      corpo: texto.slice(0, 200),
    }));
    return { ok: false, motivo: 'Analysis API indisponível neste plano RD Marketing' };
  }
  if (!resp.ok) {
    console.error(JSON.stringify({
      evento: 'rd_funnel_falhou',
      status: resp.status,
      corpo: texto.slice(0, 300),
    }));
    return { ok: false, motivo: `RD respondeu ${resp.status}` };
  }

  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return { ok: false, motivo: 'JSON inválido do RD' };
  }

  /*
   * A API já devolveu formatos diferentes ao longo do tempo. Aceita objeto
   * único ou lista diária — no segundo caso soma visitantes/leads.
   */
  const dados = agregarFunilRd(bruto);
  return { ok: true, dados };
}

function n(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) return Number(v) || 0;
  return 0;
}

/*
 * Uma linha do funil, seja ela o total do período ou um dia solto.
 *
 * A Analysis API responde com `*_count` (`visitors_count`, `contacts_count`…);
 * versões anteriores usavam nomes secos (`visitors`, `leads`). Os dois jogos de
 * nome ficam aceitos porque a conta já respondeu dos dois jeitos, e um período
 * lido com a chave errada não dá erro — dá zero, que é pior.
 */
function linhaFunilRd(item: unknown): FunilRd {
  const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
  return {
    visitors: n(o.visitors_count ?? o.visitors ?? o.Visitors ?? o.visitantes),
    leads: n(o.contacts_count ?? o.leads ?? o.Leads),
    qualified_leads: n(o.qualified_contacts_count ?? o.qualified_leads ?? o.qualifiedLeads),
    opportunities: n(o.opportunities_count ?? o.opportunities),
    sales: n(o.sales_count ?? o.sales),
  };
}

const somarFunilRd = (linhas: unknown[]): FunilRd =>
  linhas.reduce<FunilRd>((acc, item) => {
    const l = linhaFunilRd(item);
    return {
      visitors: n(acc.visitors) + n(l.visitors),
      leads: n(acc.leads) + n(l.leads),
      qualified_leads: n(acc.qualified_leads) + n(l.qualified_leads),
      opportunities: n(acc.opportunities) + n(l.opportunities),
      sales: n(acc.sales) + n(l.sales),
    };
  }, { visitors: 0, leads: 0, qualified_leads: 0, opportunities: 0, sales: 0 });

function agregarFunilRd(bruto: unknown): FunilRd {
  if (Array.isArray(bruto)) return somarFunilRd(bruto);

  const o = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;

  /*
   * `grouped_by: "daily"` devolve { funnel: [ {reference_day, ...}, ... ] } — uma
   * linha por dia, para somar. O caminho antigo pegava `o.funnel`, caía num
   * array e lia `.visitors` dele: sempre `undefined`, sempre zero. Era por isso
   * que Visitantes e Leads apareciam vazios com a credencial funcionando.
   */
  for (const chave of ['funnel', 'metrics', 'data'] as const) {
    const v = o[chave];
    if (Array.isArray(v)) return somarFunilRd(v);
    if (v && typeof v === 'object') return linhaFunilRd(v);
  }

  return linhaFunilRd(o);
}
