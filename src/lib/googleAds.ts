/**
 * Cliente do Google Ads para o Worker.
 *
 * O painel consulta a API ao vivo — o n8n não alimenta mais estes números. O
 * D1 continua sendo fonte só do que não existe em outro lugar (funil do Rubeus,
 * conversas da Evolution).
 *
 * Conta: a `GOOGLE_ADS_LOGIN_CUSTOMER_ID` do projeto NÃO é um MCC — é a própria
 * conta "Faculdade IDE" (manager: false). Por isso o header `login-customer-id`
 * não é enviado: ele só se aplica quando se acessa um cliente através de um
 * gerenciador.
 */

import { ErroGoogle, obterAccessToken } from './google';

/**
 * O erro do Google Ads é o erro do Google, com outro nome.
 *
 * Mantido como classe própria porque as rotas já tratam `ErroGoogleAds` pelo
 * nome; herdar em vez de duplicar deixa um `catch (e instanceof ErroGoogle)`
 * pegar os dois — o do Ads e o da renovação de token.
 */
export class ErroGoogleAds extends ErroGoogle {}

export function versaoApi(env: Env): string {
  const v = (env.GOOGLE_ADS_API_VERSION || 'v24').trim();
  return v.startsWith('v') ? v : `v${v}`;
}

export function customerId(env: Env): string {
  const id = (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/\D/g, '');
  if (!id) throw new ErroGoogleAds('GOOGLE_ADS_LOGIN_CUSTOMER_ID não configurado', 500);
  return id;
}

/**
 * Executa uma consulta GAQL, seguindo a paginação até o fim.
 *
 * `search` (e não `searchStream`) porque o volume por página é pequeno e o
 * corpo vem como JSON único — streaming aqui só adicionaria parsing manual de
 * chunks sem ganho.
 */
/**
 * Cache das respostas do Google Ads, na Cache API da borda.
 *
 * O painel disparava três consultas por abertura de tela, de novo a cada troca
 * de período e por pessoa que abrisse — para um dado que o próprio Google avisa
 * não ser gerado em tempo real. Cinco pessoas olhando de manhã eram dezenas de
 * chamadas para o mesmo número.
 *
 * A validade sai do próprio período consultado: janela que termina no passado
 * não muda mais, então vale horas; janela que inclui hoje ainda recebe
 * conversão atrasada, e aí é minutos.
 */
const TTL_FECHADO_S = 6 * 60 * 60;
const TTL_ABERTO_S = 15 * 60;

function ttlDaConsulta(query: string): number {
  /*
   * Procura a data final do BETWEEN. Sem data na consulta — catálogo de
   * campanha, lista de ação — o dado é estrutural e muda pouco: TTL longo.
   */
  const datas = query.match(/\d{4}-\d{2}-\d{2}/g);
  if (!datas?.length) return TTL_FECHADO_S;
  const fim = datas.sort().at(-1)!;
  /*
   * Fechado é "termina antes de ONTEM", não antes de hoje.
   *
   * O Google atribui conversão com atraso: o número de ontem ainda muda ao
   * longo do dia de hoje. Como o painel usa ontem como fim padrão, tratar isso
   * como fechado congelaria por 6 h justamente a tela que todo mundo abre.
   * Comparação em Brasília — o Worker roda em UTC e às 21h daqui já é o dia
   * seguinte lá.
   */
  const agoraBr = Date.now() - 3 * 3_600_000;
  const ontemBr = new Date(agoraBr - 86_400_000).toISOString().slice(0, 10);
  return fim < ontemBr ? TTL_FECHADO_S : TTL_ABERTO_S;
}

/** Chave estável e opaca: a consulta inteira, sem expor GAQL numa URL. */
async function chaveDeCache(env: Env, query: string): Promise<Request> {
  const material = `${customerId(env)}|${versaoApi(env)}|${query}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return new Request(`https://ads-cache.painel.interno/${hex}`, { method: 'GET' });
}

export async function consultar<T = Record<string, unknown>>(
  env: Env,
  query: string,
): Promise<T[]> {
  const chave = await chaveDeCache(env, query);
  const cache = caches.default;

  /*
   * Cache corrompido não derruba a tela.
   *
   * Uma entrada truncada — escrita cancelada, disco cheio, o que for — faria
   * `json()` estourar e a tela mostrar erro por causa de um cache, que é
   * otimização e nunca deveria ser caminho crítico. Se não der para ler,
   * consulta a origem como se não houvesse cache.
   */
  const guardado = await cache.match(chave);
  if (guardado) {
    try {
      const linhasEmCache = (await guardado.json()) as T[];
      if (Array.isArray(linhasEmCache)) {
        console.log(JSON.stringify({ evento: 'google_ads_cache_hit', query: query.slice(0, 80) }));
        return linhasEmCache;
      }
    } catch {
      console.warn(JSON.stringify({ evento: 'google_ads_cache_ilegivel', query: query.slice(0, 80) }));
    }
  }

  const linhas = await consultarNaOrigem<T>(env, query);

  /*
   * `await` no put, mesmo custando alguns ms no miss.
   *
   * Sem esperar, o runtime cancela a escrita quando o request termina e a
   * entrada fica truncada — o próximo acesso lê corpo vazio e a tela quebra.
   * Foi exatamente o que aconteceu no primeiro teste: 92 ms de resposta e
   * "Unexpected end of JSON input".
   */
  const ttl = ttlDaConsulta(query);
  try {
    await cache.put(
      chave,
      new Response(JSON.stringify(linhas), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttl}` },
      }),
    );
  } catch {
    /* falha de escrita só custa um miss no próximo acesso */
  }

  return linhas;
}

async function consultarNaOrigem<T>(env: Env, query: string): Promise<T[]> {
  const token = await obterAccessToken(env);
  const cid = customerId(env);
  const url = `https://googleads.googleapis.com/${versaoApi(env)}/customers/${cid}/googleAds:search`;

  const linhas: T[] = [];
  let pageToken: string | undefined;

  do {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'developer-token': env.GOOGLE_ADS_DEVELOPER_TOKEN,
        'Content-Type': 'application/json',
      },
      // Sem `pageSize`: a v24 rejeita o campo com PAGE_SIZE_NOT_SUPPORTED.
      // A paginação fica só por conta do nextPageToken.
      body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
    });

    if (!resp.ok) {
      const corpo = await resp.text();
      console.error(JSON.stringify({
        evento: 'google_ads_erro',
        status: resp.status,
        query: query.slice(0, 200),
        corpo: corpo.slice(0, 500),
      }));
      throw new ErroGoogleAds(`Google Ads respondeu ${resp.status}`, 502);
    }

    const dados = (await resp.json()) as { results?: T[]; nextPageToken?: string };
    if (dados.results?.length) linhas.push(...dados.results);
    pageToken = dados.nextPageToken;
  } while (pageToken);

  return linhas;
}

// ------------------------------------------------------------------ helpers

/** Micros → unidade monetária. O Google devolve custo em milionésimos. */
export const deMicros = (v: unknown): number => (Number(v) || 0) / 1_000_000;

export const num = (v: unknown): number => Number(v) || 0;

/** Escapa aspas simples pra interpolação segura em GAQL. */
export const gaql = (v: string): string => v.replace(/'/g, "\\'");

/** Valida YYYY-MM-DD antes de entrar numa cláusula BETWEEN. */
export function dataValida(s: string | undefined): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * Janela anterior de mesmo tamanho, para o "Comparar KPIs".
 * Inclusiva nas duas pontas, como o BETWEEN do GAQL.
 */
export function janelaAnterior(de: string, ate: string): { de: string; ate: string } {
  const d1 = new Date(`${de}T00:00:00Z`).getTime();
  const d2 = new Date(`${ate}T00:00:00Z`).getTime();
  const dias = Math.round((d2 - d1) / 86_400_000) + 1;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { de: iso(d1 - dias * 86_400_000), ate: iso(d1 - 86_400_000) };
}

// ------------------------------------------------------- conversões offline

/**
 * O envio de conversão NÃO usa a Google Ads API.
 *
 * Foi a primeira tentativa, e o próprio Google recusou, com todas as letras:
 * "New integrations for uploading click conversions should use the Data Manager
 * API. Usage of ConversionUploadService.UploadClickConversions is limited to
 * existing users." A conta da faculdade nunca subiu conversão offline, então é
 * integração nova — aquele caminho está fechado para ela, e o fluxo do n8n, que
 * era montado em cima dele, também não funcionaria.
 *
 * A Data Manager API mora noutro host (`datamanager.googleapis.com`), pede o
 * escopo `.../auth/datamanager` e tem outro formato de corpo. As consultas de
 * relatório e o cadastro de ações de conversão continuam na Google Ads API —
 * só o envio mudou de porta.
 */
const DATA_MANAGER = 'https://datamanager.googleapis.com/v1/events:ingest';

/** O diagnóstico do que foi ingerido — o resultado real, minutos depois. */
const DATA_MANAGER_STATUS = 'https://datamanager.googleapis.com/v1/requestStatus:retrieve';

/**
 * Um evento de conversão no formato da Data Manager API.
 *
 * `adIdentifiers` e `userData` não são alternativas excludentes: o Google
 * recomenda mandar os dois quando existirem, porque o gclid dá a atribuição
 * exata e o e-mail em hash recupera o caso em que o clique não pôde ser
 * observado. Diferente do `uploadClickConversions`, aqui isso é permitido.
 */
export type EventoConversao = {
  eventTimestamp: string;
  transactionId?: string;
  conversionValue?: number;
  currency?: string;
  /**
   * Onde a conversão nasceu. Para matrícula fechada no CRM depois de um clique
   * no anúncio, o Google classifica como `OTHER` — não é uma compra no site
   * (`WEB`) nem no balcão (`IN_STORE`), e errar isso muda como a conta agrupa
   * o relatório de origem.
   */
  eventSource?: 'WEB' | 'APP' | 'IN_STORE' | 'PHONE' | 'MESSAGE' | 'OTHER';
  adIdentifiers?: { gclid?: string; gbraid?: string; wbraid?: string };
  userData?: { userIdentifiers: UserIdentifier[] };
};

/**
 * Um identificador de usuário. É uma UNIÃO: só um campo por objeto.
 *
 * Mandar e-mail e telefone no mesmo item faria o Google ignorar um dos dois sem
 * dizer qual. Cada identificador vira um item da lista — e o Google aceita até
 * dez por evento, então não há motivo para escolher entre eles.
 */
export type UserIdentifier =
  | { emailAddress: string }
  | { phoneNumber: string }
  | { address: EnderecoGoogle };

/**
 * O identificador de endereço — a terceira via de atribuição.
 *
 * Alcança justamente o lead que não tem gclid nem e-mail. Regra de formato do
 * Google, e ela não é uniforme: `givenName` e `familyName` vão em SHA-256, mas
 * `regionCode` e `postalCode` vão em CLARO. Hashear os quatro — o engano
 * natural — faz o Google aceitar o evento e não casar com ninguém.
 *
 * Os quatro são necessários juntos: nome e sobrenome sozinhos identificariam
 * milhares de pessoas, e o Google descarta o identificador incompleto.
 */
export type EnderecoGoogle = {
  /** SHA-256 do primeiro nome, minúsculo e sem acento. */
  givenName: string;
  /** SHA-256 do sobrenome, mesma normalização. */
  familyName: string;
  /** Em claro. ISO-3166-1 alpha-2 — 'BR'. */
  regionCode: string;
  /** Em claro. CEP com oito dígitos, sem máscara. */
  postalCode: string;
};

/** Sinais de consentimento, como o Google Ads os define. */
export type Consentimento = {
  adUserData?: 'CONSENT_GRANTED' | 'CONSENT_DENIED';
  adPersonalization?: 'CONSENT_GRANTED' | 'CONSENT_DENIED';
};

export type ResultadoUpload = {
  /** Índices que o Google recusou, com a mensagem de cada um. */
  falhas: Map<number, string>;
  /** Corpo da resposta, guardado no registro para diagnóstico posterior. */
  resposta: string;
  /**
   * O id da requisição, devolvido pela ingestão.
   *
   * É a única chave que abre o diagnóstico depois. Sem guardá-lo, "o Google
   * aceitou a requisição" seria tudo que o painel jamais saberia — e aceitar a
   * requisição não é contabilizar a conversão.
   */
  requestId: string | null;
  /**
   * O requestId de cada evento aceito, por índice.
   *
   * Quase sempre é o mesmo id repetido — um lote, uma requisição. Deixa de ser
   * quando o lote falha e cada evento é reenviado sozinho: aí são N requisições
   * e N diagnósticos, e associar todos ao primeiro id faria o painel ler o
   * resultado de um evento como se fosse o de todos.
   */
  requestIds: Map<number, string>;
  /**
   * Avisos de campo (`fieldWarnings`): não derrubam nada e por isso somem.
   *
   * Um "telefone ignorado por formato" aqui significa metade dos
   * identificadores descartados com o envio parecendo perfeito.
   */
  avisos: string | null;
};

/**
 * Envia conversões de um mesmo destino (uma ação de conversão) num lote.
 *
 * O destino faz parte do corpo, não da URL, e cada ação de conversão é um
 * destino — por isso quem chama agrupa por ação antes de chamar. Misturar ações
 * num corpo só exigiria `destinationReferences` por evento, o que complica a
 * leitura do erro sem economizar requisição de verdade.
 *
 * `validateOnly` é o modo teste da tela: o Google valida tudo, devolve os
 * mesmos erros e não contabiliza nada. É o único jeito honesto de conferir o
 * mapa de etapas antes de deixar isso mexer em lance de campanha.
 *
 * A validação da Data Manager API é *fast-fail*: um campo inválido em UM evento
 * derruba a requisição inteira, diferente do `partialFailure` da Google Ads
 * API. É o que torna `isolarFalhas` necessário — ver abaixo.
 */
export async function enviarConversoes(
  env: Env,
  conversionActionId: string,
  eventos: EventoConversao[],
  opcoes: { validateOnly?: boolean; consentimento?: Consentimento | null; isolarFalhas?: boolean } = {},
): Promise<ResultadoUpload> {
  if (!eventos.length) {
    return { falhas: new Map(), resposta: '', requestId: null, requestIds: new Map(), avisos: null };
  }

  const token = await obterAccessToken(env);
  const cid = customerId(env);

  const resp = await fetch(DATA_MANAGER, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      destinations: [{
        operatingAccount: { accountType: 'GOOGLE_ADS', accountId: cid },
        productDestinationId: String(conversionActionId).replace(/\D/g, ''),
      }],
      // HEX porque é o que sha256Hex() produz. A alternativa é Base64, e
      // misturar os dois é o erro que faz o Google aceitar e não casar nada.
      encoding: 'HEX',
      events: eventos,
      /*
       * Consentimento só viaja quando a tela afirma tê-lo.
       *
       * Omitir é diferente de mandar `CONSENT_DENIED`: omitido, o Google aplica
       * o padrão da conta; negado, ele descarta o identificador. E afirmar
       * `CONSENT_GRANTED` por conta própria seria o painel declarando, em nome
       * da faculdade, um consentimento que ninguém aqui pode confirmar.
       */
      ...(opcoes.consentimento ? { consent: opcoes.consentimento } : {}),
      validateOnly: Boolean(opcoes.validateOnly),
    }),
  });

  const texto = await resp.text();

  if (!resp.ok) {
    console.error(JSON.stringify({
      evento: 'upload_conversao_erro', status: resp.status, corpo: texto.slice(0, 600),
    }));
    const msg = mensagemDeErro(texto) || `Data Manager respondeu ${resp.status}`;

    /*
     * Fast-fail: um evento ruim leva o lote inteiro junto.
     *
     * Reenviar um a um é caro, e por isso só acontece na falha — que deve ser
     * rara. O que ele evita é caro demais para deixar passar: sem isolar, um
     * único gclid expirado marcaria 59 conversões boas como recusadas, e elas
     * voltariam para a fila amanhã para falhar de novo pelo mesmo motivo, até
     * estourarem o teto de tentativas e sumirem em silêncio.
     *
     * Só na primeira volta (`isolarFalhas` desligado nas chamadas de dentro),
     * senão um erro de credencial viraria N requisições idênticas.
     */
    if (opcoes.isolarFalhas && eventos.length > 1 && ehErroDeConteudo(resp.status)) {
      return await isolarUmAUm(env, conversionActionId, eventos, opcoes, texto);
    }

    // Erro da requisição inteira: todo mundo do lote falhou pelo mesmo motivo.
    return {
      falhas: new Map(eventos.map((_, i) => [i, msg])),
      resposta: texto.slice(0, 2000),
      requestId: null,
      requestIds: new Map(),
      avisos: null,
    };
  }

  const corpo = leJson(texto);
  const requestId: string | null = typeof corpo?.requestId === 'string' ? corpo.requestId : null;
  const avisos = avisosDaResposta(corpo);

  if (avisos) {
    console.warn(JSON.stringify({
      evento: 'upload_conversao_avisos', request_id: requestId, avisos: avisos.slice(0, 400),
    }));
  }

  /*
   * Nenhuma falha por evento aqui, de propósito.
   *
   * A Data Manager API não devolve erro por linha na ingestão — ou a requisição
   * inteira passa, ou nenhuma passa. O que aconteceu com cada conversão sai no
   * diagnóstico (`consultarStatusDaRequisicao`), meia hora depois. Fingir aqui
   * que um 200 é resultado final foi o que a versão anterior fazia, procurando
   * um `partialFailureError` que esta API nunca emite.
   */
  return {
    falhas: new Map(),
    resposta: texto.slice(0, 2000),
    requestId,
    requestIds: requestId ? new Map(eventos.map((_, i) => [i, requestId])) : new Map(),
    avisos,
  };
}

/**
 * O erro fala do CONTEÚDO, e não da credencial, da cota ou do servidor?
 *
 * Só `400 INVALID_ARGUMENT` merece o reenvio um a um — é o único em que a culpa
 * pode ser de um evento específico do lote. Um `403` é a conta inteira: foi o
 * que o primeiro teste real devolveu, "Request had insufficient authentication
 * scopes", e isolar naquele caso teria virado 60 requisições idênticas para
 * receber 60 vezes a mesma recusa de escopo. `401` e `429` pela mesma razão, e
 * o `429` ainda pioraria a cota que causou a recusa.
 */
const ehErroDeConteudo = (status: number): boolean => status === 400;

async function isolarUmAUm(
  env: Env,
  conversionActionId: string,
  eventos: EventoConversao[],
  opcoes: { validateOnly?: boolean; consentimento?: Consentimento | null },
  respostaDoLote: string,
): Promise<ResultadoUpload> {
  console.warn(JSON.stringify({
    evento: 'upload_conversao_isolando', eventos: eventos.length,
  }));

  const falhas = new Map<number, string>();
  const requestIds = new Map<number, string>();
  const avisos: string[] = [];

  for (const [i, evento] of eventos.entries()) {
    const r = await enviarConversoes(env, conversionActionId, [evento], {
      ...opcoes,
      isolarFalhas: false,
    });
    const erro = r.falhas.get(0);
    if (erro) falhas.set(i, erro);
    if (r.requestId) requestIds.set(i, r.requestId);
    if (r.avisos) avisos.push(r.avisos);
  }

  return {
    falhas,
    // O corpo do lote fica junto: é ele que diz o que a requisição agrupada viu.
    resposta: `lote recusado: ${respostaDoLote.slice(0, 800)}`.slice(0, 2000),
    /*
     * Sem requestId de lote: aqui são N requisições, uma por evento. Devolver
     * o primeiro faria o diagnóstico de um evento ser lido como o de todos.
     */
    requestId: null,
    requestIds,
    avisos: avisos.length ? avisos.join(' | ').slice(0, 1000) : null,
  };
}

const leJson = (texto: string): any => {
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
};

/**
 * Os `fieldWarnings` da ingestão, achatados numa linha legível.
 *
 * O caminho do campo vem em snake_case com índice — `events[0].user_data
 * .user_identifiers[1].phone_number` —, e é ele que diz QUAL identificador o
 * Google ignorou. Guardar só a descrição perderia justamente isso.
 */
function avisosDaResposta(corpo: any): string | null {
  const lista = corpo?.fieldWarnings;
  if (!Array.isArray(lista) || !lista.length) return null;
  return lista
    .map((a: any) => {
      const campo = a?.field ?? a?.fieldPath ?? '';
      const texto = a?.description ?? a?.reason ?? '';
      return campo ? `${campo}: ${texto}` : String(texto);
    })
    .filter(Boolean)
    .join(' | ')
    .slice(0, 1000);
}

/** O que o Google reporta por requisição, depois de processar. */
export type StatusRequisicao = {
  /** SUCCESS | PARTIAL_SUCCESS | FAILED | PROCESSING | REQUEST_STATUS_UNKNOWN */
  status: string;
  /** Contagem de registros por motivo de recusa. */
  erros: Array<{ motivo: string; registros: number }>;
  avisos: Array<{ motivo: string; registros: number }>;
};

/**
 * O diagnóstico de uma requisição já ingerida.
 *
 * É a metade que faltava do envio. `events:ingest` responde 200 quando ACEITA a
 * requisição — o processamento vem depois, e é aqui que aparece se o e-mail em
 * hash casou com alguém, se o gclid já tinha expirado, se a ação recusou o
 * registro. Sem esta consulta, a tela diria "enviada" para conversão que o
 * Google descartou, que é o único estado pior do que não ter enviado: some sem
 * deixar rastro e ainda dá a impressão de que está funcionando.
 *
 * O Google pede 30 minutos antes da primeira consulta e não guarda diagnóstico
 * de requisição feita com `validateOnly` — o modo teste do painel, portanto,
 * nunca chega aqui.
 *
 * Devolve `null` quando a requisição ainda não existe para o Google (404): não
 * é erro, é cedo demais.
 */
export async function consultarStatusDaRequisicao(
  env: Env,
  requestId: string,
): Promise<StatusRequisicao | null> {
  const token = await obterAccessToken(env);

  const resp = await fetch(`${DATA_MANAGER_STATUS}?requestId=${encodeURIComponent(requestId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  const texto = await resp.text();

  if (resp.status === 404) return null;
  if (!resp.ok) {
    console.error(JSON.stringify({
      evento: 'status_requisicao_erro', status: resp.status,
      request_id: requestId, corpo: texto.slice(0, 400),
    }));
    throw new ErroGoogleAds(
      mensagemDeErro(texto) ?? `Data Manager respondeu ${resp.status} no diagnóstico`,
      502,
    );
  }

  const corpo = leJson(texto);
  const porDestino: any[] = Array.isArray(corpo?.requestStatusPerDestination)
    ? corpo.requestStatusPerDestination
    : [];

  if (!porDestino.length) return { status: 'PROCESSING', erros: [], avisos: [] };

  /*
   * Um destino por requisição, porque o painel agrupa por ação de conversão
   * antes de enviar. Ainda assim a leitura é do array inteiro: se um dia um
   * lote sair com dois destinos, o pior status é o que a tela precisa mostrar —
   * "deu certo em um dos dois" não é "deu certo".
   */
  const contagens = (info: any, campo: string) =>
    (Array.isArray(info?.[campo]) ? info[campo] : []).map((e: any) => ({
      motivo: String(e?.reason ?? 'DESCONHECIDO'),
      registros: Number(e?.recordCount ?? 0) || 0,
    }));

  const erros: Array<{ motivo: string; registros: number }> = [];
  const avisos: Array<{ motivo: string; registros: number }> = [];
  const status: string[] = [];

  for (const d of porDestino) {
    status.push(String(d?.requestStatus ?? 'REQUEST_STATUS_UNKNOWN'));
    erros.push(...contagens(d?.errorInfo, 'errorCounts'));
    avisos.push(...contagens(d?.warningInfo, 'warningCounts'));
  }

  // Do pior para o melhor: o primeiro que aparecer é o que vale.
  const ordem = ['FAILED', 'PARTIAL_SUCCESS', 'PROCESSING', 'REQUEST_STATUS_UNKNOWN', 'SUCCESS'];
  const pior = ordem.find((s) => status.includes(s)) ?? status[0]!;

  return { status: pior, erros, avisos };
}

function mensagemDeErro(texto: string): string | null {
  try {
    const c = JSON.parse(texto);
    return c?.error?.message ?? null;
  } catch {
    return null;
  }
}

/**
 * Ações de conversão que aceitam upload offline.
 *
 * Só `UPLOAD_CLICKS` serve: uma ação de página ou do GA4 recusa o upload, e
 * deixar essas aparecerem no seletor da tela seria oferecer uma escolha que
 * falha depois, no envio, longe de quem escolheu.
 */
export async function listarAcoesDeUpload(env: Env): Promise<Array<{
  id: string; nome: string; status: string; categoria: string;
}>> {
  const linhas = await consultar<{ conversionAction: Record<string, any> }>(
    env,
    `SELECT conversion_action.id, conversion_action.name, conversion_action.status,
            conversion_action.category
     FROM conversion_action
     WHERE conversion_action.type = 'UPLOAD_CLICKS'
       AND conversion_action.status != 'REMOVED'
     ORDER BY conversion_action.name`,
  );
  return linhas.map((l) => ({
    id: String(l.conversionAction.id),
    nome: l.conversionAction.name,
    status: l.conversionAction.status,
    categoria: l.conversionAction.category ?? '',
  }));
}

/**
 * Cria uma ação de conversão offline na conta.
 *
 * Existe para poupar a ida ao painel do Google numa configuração que já é
 * conhecida — um evento por nível de ensino dá mais de uma dúzia de ações, e
 * criá-las à mão é onde nasce o nome divergente que ninguém consegue mapear
 * depois. É escrita na conta de anúncios, então só sai daqui por clique
 * explícito de quem administra.
 */
export async function criarAcaoDeUpload(
  env: Env,
  dados: { nome: string; categoria: string; valorPadrao?: number },
): Promise<{ id: string; recurso: string }> {
  const token = await obterAccessToken(env);
  const cid = customerId(env);
  const url = `https://googleads.googleapis.com/${versaoApi(env)}/customers/${cid}/conversionActions:mutate`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'developer-token': env.GOOGLE_ADS_DEVELOPER_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operations: [{
        create: {
          name: dados.nome,
          type: 'UPLOAD_CLICKS',
          category: dados.categoria,
          status: 'ENABLED',
          /*
           * `alwaysUseDefaultValue: false` — quem manda o valor é o painel, por
           * nível de ensino. O padrão da ação é só a rede de segurança para
           * quando o upload vier sem valor.
           */
          valueSettings: {
            defaultValue: dados.valorPadrao ?? 0,
            defaultCurrencyCode: 'BRL',
            alwaysUseDefaultValue: false,
          },
          /*
           * ONE_PER_CLICK: uma matrícula por clique, não uma por vez que o
           * lead reentra na etapa. A deduplicação por orderId já cobre a
           * reemissão do Rubeus; esta cobre o resto.
           */
          countingType: 'ONE_PER_CLICK',
          clickThroughLookbackWindowDays: 90,
        },
      }],
    }),
  });

  const texto = await resp.text();
  if (!resp.ok) {
    console.error(JSON.stringify({
      evento: 'criar_acao_conversao_erro', status: resp.status, corpo: texto.slice(0, 500),
    }));
    throw new ErroGoogleAds(mensagemDeErro(texto) ?? `Google Ads respondeu ${resp.status}`, 502);
  }

  const recurso: string = JSON.parse(texto)?.results?.[0]?.resourceName ?? '';
  const id = recurso.split('/').pop() ?? '';
  if (!id) throw new ErroGoogleAds('o Google não devolveu o id da ação criada', 502);
  return { id, recurso };
}
