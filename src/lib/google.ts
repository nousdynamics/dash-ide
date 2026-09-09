/**
 * Credencial única do Google, compartilhada pelas APIs que o painel usa.
 *
 * Um refresh token para tudo: consultar o Google Ads, enviar conversão pela
 * Data Manager API e escrever na planilha de backup. Manter uma credencial por
 * API criaria três lugares para expirar, três para revogar e três para esquecer
 * de renovar.
 *
 * Duas moradas possíveis, nesta ordem:
 *
 *   1. `credenciais_oauth` no D1 — gravado pelo fluxo "Conectar Google" da
 *      tela. É o caminho novo, e o único que consegue incluir escopo novo sem
 *      deploy;
 *   2. `GOOGLE_ADS_REFRESH_TOKEN` em secret — o que já existia. Continua
 *      valendo para as consultas de mídia, que só precisam de `adwords`.
 *
 * A ordem importa: o token do banco vence porque é o que pode ter sido
 * reconsentido com escopos novos. Cair para o secret quando ele não existe é o
 * que mantém as telas de mídia funcionando antes de qualquer reconexão.
 */

const OAUTH_URL = 'https://oauth2.googleapis.com/token';

/**
 * Tudo que o painel faz no Google, num consentimento só.
 *
 * `datamanager` é o que destrava o envio de conversão: a Google Ads API v24
 * recusa `uploadClickConversions` para integração nova — "limited to existing
 * users" — e manda usar a Data Manager API, que exige este escopo. Sem ele o
 * envio responde 403 por escopo insuficiente, e nada mais.
 */
export const ESCOPOS_GOOGLE = [
  'https://www.googleapis.com/auth/adwords',
  'https://www.googleapis.com/auth/datamanager',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
] as const;

export class ErroGoogle extends Error {
  constructor(msg: string, readonly status: number = 502) {
    super(msg);
  }
}

/**
 * Cache do access token no escopo do isolate.
 *
 * Não é estado de requisição — é credencial da aplicação, idêntica para todo
 * mundo e sem nenhum dado de usuário. Sem isso, cada request do painel gastaria
 * uma ida ao OAuth do Google antes da consulta real.
 */
let tokenCache: { valor: string; expiraEm: number; origem: string } | null = null;

/** O refresh token reconsentido pela tela, se existir. */
export async function refreshTokenGuardado(env: Env): Promise<{ token: string; escopo: string | null } | null> {
  try {
    const l = await env.DB.prepare(
      `SELECT refresh_token, escopo FROM credenciais_oauth WHERE provedor = 'google' LIMIT 1`,
    ).first() as { refresh_token: string; escopo: string | null } | null;
    return l ? { token: l.refresh_token, escopo: l.escopo } : null;
  } catch {
    // Banco indisponível não pode derrubar a consulta de mídia: cai no secret.
    return null;
  }
}

export async function obterAccessToken(env: Env): Promise<string> {
  const agora = Date.now();

  const guardado = await refreshTokenGuardado(env);
  const refreshToken = guardado?.token ?? env.GOOGLE_ADS_REFRESH_TOKEN;
  const origem = guardado ? 'banco' : 'secret';

  /*
   * A origem entra na chave do cache.
   *
   * Sem isso, reconectar o Google pela tela não teria efeito até o isolate
   * morrer: o access token antigo, gerado a partir do secret e sem o escopo
   * novo, continuaria válido por até uma hora e o envio seguiria respondendo
   * 403 — com a tela dizendo "conectado".
   */
  if (tokenCache && tokenCache.origem === origem && tokenCache.expiraEm > agora + 60_000) {
    return tokenCache.valor;
  }

  const faltando = (['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET'] as const)
    .filter((k) => !env[k]);
  if (faltando.length) throw new ErroGoogle(`credenciais ausentes: ${faltando.join(', ')}`, 500);
  if (!refreshToken) {
    throw new ErroGoogle('nenhuma conta Google conectada — use "Conectar Google" na tela de conversão', 500);
  }

  const resp = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_ADS_CLIENT_ID,
      client_secret: env.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!resp.ok) {
    const corpo = await resp.text();
    console.error(JSON.stringify({ evento: 'oauth_falhou', status: resp.status, corpo: corpo.slice(0, 300) }));
    throw new ErroGoogle('não foi possível renovar o token do Google', 502);
  }

  const dados = (await resp.json()) as { access_token: string; expires_in: number };
  tokenCache = { valor: dados.access_token, expiraEm: agora + dados.expires_in * 1000, origem };
  return dados.access_token;
}

/** Invalida o cache — chamado logo depois de reconectar, para valer na hora. */
export function esquecerToken(): void {
  tokenCache = null;
}

/**
 * SHA-256 em hex minúsculo — o formato que o Google aceita em `userIdentifiers`.
 *
 * Hash aqui não é proteção de banco, é o protocolo: conversão aprimorada exige
 * que o e-mail e o telefone cheguem já embaralhados, para que o casamento
 * aconteça sem que o identificador em claro saia daqui.
 */
export async function sha256Hex(texto: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Normaliza e-mail como o Google exige antes do hash.
 *
 * Sem isso o hash de "Joao.Silva+ads@gmail.com" nunca casaria com o do clique,
 * que o Google gera a partir da forma canônica. Ponto e sufixo `+` só são
 * ignorados no Gmail — em outros provedores "j.silva@" e "jsilva@" podem ser
 * caixas diferentes, e limpar seria inventar outro endereço.
 */
export function normalizarEmailParaHash(email: string): string | null {
  const e = email.trim().toLowerCase();
  if (!e.includes('@') || e.length < 5) return null;
  const [usuario, dominio] = e.split('@');
  if (!usuario || !dominio) return null;
  if (dominio === 'gmail.com' || dominio === 'googlemail.com') {
    const limpo = usuario.split('+')[0]!.replace(/\./g, '');
    return limpo ? `${limpo}@gmail.com` : null;
  }
  return e;
}

/**
 * Telefone em E.164 (`+5581999820742`), que é o formato exigido antes do hash.
 *
 * O painel já guarda só dígitos com DDI (ver `normalizarTelefone` em
 * schemas.ts); aqui só falta o `+`. Número curto demais para ser um celular com
 * DDI é descartado em vez de virar um hash que nunca casa com nada.
 */
export function normalizarTelefoneParaHash(telefone: string): string | null {
  const d = String(telefone).replace(/\D/g, '');
  if (d.length < 12 || d.length > 15) return null;
  return `+${d}`;
}
