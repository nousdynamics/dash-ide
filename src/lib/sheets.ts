/**
 * Planilha de backup das conversões enviadas ao Google Ads.
 *
 * O registro de origem é a tabela `conversoes_offline` no D1 — é dela que sai
 * o reenvio do que falhou. A planilha é a cópia que gente lê: dá para filtrar,
 * cruzar com o relatório do Google e conferir lead a lead sem pedir consulta a
 * ninguém. Duas cópias de propósito, com papéis diferentes.
 *
 * Usa o MESMO refresh token do Google Ads — o consentimento salvo já cobre
 * `spreadsheets` e `drive`, então nenhuma credencial nova entra no projeto.
 */

import { ErroGoogle, obterAccessToken } from './google';

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * As colunas da planilha, em ordem.
 *
 * A ordem é contrato: a planilha é alimentada por append, então mudar a posição
 * de uma coluna deixaria as linhas antigas desalinhadas com as novas para
 * sempre. Coluna nova entra no FIM.
 */
export const COLUNAS = [
  'Enviado em',
  'Ocorrido em',
  'Status',
  'Modo',
  'Evento',
  'Etapa (Rubeus)',
  'Contato ID',
  'Nome',
  'E-mail',
  'Telefone',
  'Curso',
  'Nível de ensino',
  'Processo',
  'Ação de conversão',
  'ID da ação',
  'Valor',
  'Moeda',
  'Identificador usado',
  'Click ID',
  'Order ID',
  'Detalhe do erro',
  /*
   * Colunas novas entram no FIM — ver a nota de ordem acima.
   *
   * O diagnóstico é o veredito do Google sobre o processamento, que chega meia
   * hora depois da ingestão. Sem ele a planilha registraria "enviada" para
   * linhas que o Google descartou, e é a planilha que a diretoria cruza com o
   * relatório do Ads quando os números não batem.
   */
  'Diagnóstico do Google',
  'Avisos do Google',
  'Request ID',
] as const;

export type LinhaBackup = Record<(typeof COLUNAS)[number], string | number | null | undefined>;

async function chamar<T>(
  env: Env,
  caminho: string,
  init: { method: string; body?: unknown },
): Promise<T> {
  const token = await obterAccessToken(env);
  const resp = await fetch(`${SHEETS}${caminho}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const texto = await resp.text();
  if (!resp.ok) {
    console.error(JSON.stringify({
      evento: 'sheets_erro', caminho, status: resp.status, corpo: texto.slice(0, 400),
    }));
    let msg = `Google Sheets respondeu ${resp.status}`;
    try {
      msg = JSON.parse(texto)?.error?.message || msg;
    } catch { /* corpo não-JSON */ }
    throw new ErroGoogle(msg, 502);
  }
  return (texto ? JSON.parse(texto) : {}) as T;
}

/**
 * Cria a planilha de backup, já com o cabeçalho congelado.
 *
 * A alternativa era pedir para colar o id de uma planilha existente, e foi
 * descartada: uma planilha criada aqui nasce com as colunas na ordem certa, e
 * apontar para uma aba que já tem outro conteúdo faz o append escrever no lugar
 * errado sem reclamar.
 */
export async function criarPlanilha(
  env: Env,
  titulo: string,
): Promise<{ id: string; url: string; aba: string }> {
  const aba = 'Conversões';
  const criada = await chamar<{ spreadsheetId: string; spreadsheetUrl: string }>(env, '', {
    method: 'POST',
    body: {
      properties: { title: titulo, locale: 'pt_BR', timeZone: 'America/Recife' },
      sheets: [{
        properties: {
          title: aba,
          gridProperties: { frozenRowCount: 1, columnCount: COLUNAS.length },
        },
      }],
    },
  });

  await chamar(env, `/${criada.spreadsheetId}/values/${encodeURIComponent(`${aba}!A1`)}` +
    `?valueInputOption=RAW`, {
    method: 'PUT',
    body: { values: [COLUNAS] },
  });

  console.log(JSON.stringify({ evento: 'planilha_backup_criada', id: criada.spreadsheetId }));
  return { id: criada.spreadsheetId, url: criada.spreadsheetUrl, aba };
}

/**
 * Acrescenta linhas ao fim da aba.
 *
 * `RAW` e não `USER_ENTERED`: o valor vai como texto, sem o Sheets tentar
 * interpretar. Sem isso um telefone com `+` vira fórmula e um id numérico longo
 * perde precisão virando número — a planilha existe para conferir o que foi
 * enviado, e não pode reescrever o que foi enviado.
 */
export async function acrescentarLinhas(
  env: Env,
  planilhaId: string,
  aba: string,
  linhas: LinhaBackup[],
): Promise<number> {
  if (!linhas.length) return 0;

  const valores = linhas.map((l) => COLUNAS.map((c) => {
    const v = l[c];
    return v === null || v === undefined ? '' : String(v);
  }));

  const r = await chamar<{ updates?: { updatedRows?: number } }>(
    env,
    `/${planilhaId}/values/${encodeURIComponent(`${aba}!A1`)}:append` +
      `?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: { values: valores } },
  );

  return r.updates?.updatedRows ?? valores.length;
}

/** Confere se a planilha configurada ainda existe e a aba continua lá. */
export async function conferirPlanilha(
  env: Env,
  planilhaId: string,
  aba: string,
): Promise<{ ok: boolean; titulo?: string; url?: string; motivo?: string }> {
  try {
    const d = await chamar<{
      properties?: { title?: string };
      spreadsheetUrl?: string;
      sheets?: Array<{ properties?: { title?: string } }>;
    }>(env, `/${planilhaId}?fields=properties.title,spreadsheetUrl,sheets.properties.title`, {
      method: 'GET',
    });
    const abas = (d.sheets ?? []).map((s) => s.properties?.title);
    if (!abas.includes(aba)) {
      return { ok: false, titulo: d.properties?.title, motivo: `a aba "${aba}" não existe mais` };
    }
    return { ok: true, titulo: d.properties?.title, url: d.spreadsheetUrl };
  } catch (e) {
    return { ok: false, motivo: e instanceof ErroGoogle ? e.message : String(e) };
  }
}
