/**
 * Conversão offline: do evento do Rubeus até o Google Ads.
 *
 * Reimplementa dentro do painel o fluxo "Faculdade IDE - Teste Webhook + API
 * Rubeus" que vivia no n8n, e conserta o que lá estava quebrado em silêncio:
 * aquele fluxo procurava um campo personalizado `gclid` no contato do Rubeus, e
 * esse campo não existe na conta — nenhum dos 18 campos do contato nem dos 45
 * da oportunidade é gclid, gbraid, wbraid ou UTM. Toda execução caía no ramo
 * "sem click ID" e nada nunca foi enviado.
 *
 * Por isso aqui a atribuição tem dois caminhos, nesta ordem:
 *
 *   1. click id (gclid/gbraid/wbraid), quando o formulário passar a gravá-lo;
 *   2. conversão aprimorada — e-mail e telefone em hash SHA-256, que o Rubeus
 *      JÁ tem hoje para praticamente todo lead.
 *
 * O caminho 2 é o que faz isso funcionar antes de qualquer mudança no site, e o
 * caminho 1 melhora sozinho quando o campo entrar. Sem os dois, este fluxo
 * seria o do n8n com outro sotaque.
 *
 * O percurso: o webhook grava a etapa → o gatilho diz se aquela etapa é um
 * evento → a linha é reservada com um orderId único → o Rubeus completa o que
 * falta → o Google recebe → a planilha guarda a cópia legível.
 */

import {
  type Consentimento,
  type EventoConversao,
  type UserIdentifier,
  consultarStatusDaRequisicao,
  enviarConversoes,
} from './googleAds';
import { devolverAoRubeus, marcarCasado, procurarClique } from './cliques';
import { normalizarEmailParaHash, normalizarTelefoneParaHash, sha256Hex } from './google';
import { identidadeDoContato, normalizarCep, partirNome } from './identidade';
import { dadosPessoa, listarOportunidades } from './rubeus';
import { acrescentarLinhas, type LinhaBackup } from './sheets';

/** Os dois eventos que a conta mede. Nome interno, estável, não é rótulo de tela. */
export const EVENTOS = ['inscricao_concluida', 'pagamento_realizado'] as const;
export type Evento = (typeof EVENTOS)[number];

export const ROTULO_EVENTO: Record<Evento, string> = {
  inscricao_concluida: 'Inscrição concluída',
  pagamento_realizado: 'Pagamento realizado',
};

/** Categoria do Google Ads sugerida ao criar a ação de cada evento. */
export const CATEGORIA_EVENTO: Record<Evento, string> = {
  inscricao_concluida: 'SUBMIT_LEAD_FORM',
  pagamento_realizado: 'PURCHASE',
};

/**
 * Metas (ConversionActionCategory) que o painel deixa escolher ao criar a ação.
 * Rótulos alinhados ao painel do Google Ads em português.
 */
export const METAS_GOOGLE = [
  { id: 'PURCHASE', rotulo: 'Compras' },
  { id: 'SUBMIT_LEAD_FORM', rotulo: 'Enviar formulário de lead' },
  { id: 'SIGNUP', rotulo: 'Inscrições' },
  { id: 'QUALIFIED_LEAD', rotulo: 'Leads qualificados' },
  { id: 'CONVERTED_LEAD', rotulo: 'Leads convertidos' },
  { id: 'CONTACT', rotulo: 'Contatos' },
  { id: 'SUBSCRIBE_PAID', rotulo: 'Assinaturas pagas' },
  { id: 'ADD_TO_CART', rotulo: 'Adicionar ao carrinho' },
  { id: 'BEGIN_CHECKOUT', rotulo: 'Iniciar checkout' },
  { id: 'BOOK_APPOINTMENT', rotulo: 'Agendar horário' },
  { id: 'REQUEST_QUOTE', rotulo: 'Solicitar orçamento' },
  { id: 'PAGE_VIEW', rotulo: 'Visualizações de página' },
  { id: 'ENGAGEMENT', rotulo: 'Engajamento' },
  { id: 'DEFAULT', rotulo: 'Outra / padrão' },
] as const;

export type MetaGoogle = (typeof METAS_GOOGLE)[number]['id'];

export function ehMetaGoogle(v: string): v is MetaGoogle {
  return METAS_GOOGLE.some((m) => m.id === v);
}

/** Nível de ensino curinga: vale para o lead cujo curso ainda não foi resolvido. */
export const NIVEL_PADRAO = '*';

/** Desiste depois de tentar cinco vezes — erro que persiste não é intermitência. */
const MAX_TENTATIVAS = 5;

export type Config = {
  ligado: boolean;
  modo: 'teste' | 'real';
  janelaDias: number;
  planilhaId: string | null;
  planilhaAba: string;
  planilhaUrl: string | null;
  /** O script do site está autorizado a mandar captura de clique? */
  capturaLigada: boolean;
  /** O painel pode escrever o click id de volta no campo do Rubeus? */
  escreverNoRubeus: boolean;
  /** Hosts autorizados a mandar captura — conferidos contra o `Origin`. */
  origensPermitidas: string;
  /**
   * O que o painel declara ao Google sobre consentimento de dados do usuário.
   *
   * `nao_informado` é o padrão e significa "o painel não afirma nada" — o
   * Google aplica então o padrão da conta. É diferente de `negado`, que manda
   * `CONSENT_DENIED` e faz o Google descartar o identificador.
   *
   * Não é detalhe de protocolo: `concedido` é uma declaração jurídica em nome
   * da faculdade, sobre um consentimento que só quem administra a captação de
   * leads pode confirmar que existe. Por isso mora na tela, com padrão no lado
   * que não afirma nada, em vez de ficar cravado no código.
   */
  consentimento: 'nao_informado' | 'concedido' | 'negado';
};

/** Traduz a config da tela no objeto `consent` da Data Manager API. */
export function consentimentoGoogle(cfg: Config): Consentimento | null {
  if (cfg.consentimento === 'concedido') {
    return { adUserData: 'CONSENT_GRANTED', adPersonalization: 'CONSENT_GRANTED' };
  }
  if (cfg.consentimento === 'negado') {
    return { adUserData: 'CONSENT_DENIED', adPersonalization: 'CONSENT_DENIED' };
  }
  return null;
}

export async function lerConfig(db: D1Database): Promise<Config> {
  const { results } = await db.prepare('SELECT chave, valor FROM conversao_config').all();
  const m = new Map((results as Array<{ chave: string; valor: string | null }>)
    .map((r) => [r.chave, r.valor]));
  return {
    ligado: m.get('ligado') === '1',
    modo: m.get('modo') === 'real' ? 'real' : 'teste',
    janelaDias: Number(m.get('janela_dias')) || 30,
    planilhaId: m.get('planilha_id') || null,
    planilhaAba: m.get('planilha_aba') || 'Conversões',
    planilhaUrl: m.get('planilha_url') || null,
    capturaLigada: m.get('captura_ligada') === '1',
    escreverNoRubeus: m.get('escrever_no_rubeus') === '1',
    origensPermitidas: m.get('origens_permitidas') || '',
    consentimento:
      m.get('consentimento') === 'concedido' ? 'concedido'
        : m.get('consentimento') === 'negado' ? 'negado'
          : 'nao_informado',
  };
}

export async function gravarConfig(
  db: D1Database,
  valores: Record<string, string | null>,
  por: string | undefined,
): Promise<void> {
  const stmts = Object.entries(valores).map(([chave, valor]) =>
    db.prepare(
      `INSERT INTO conversao_config (chave, valor, atualizado_por)
       VALUES (?, ?, ?)
       ON CONFLICT (chave) DO UPDATE SET
         valor = excluded.valor,
         atualizado_em = datetime('now'),
         atualizado_por = excluded.atualizado_por`,
    ).bind(chave, valor, por ?? null),
  );
  if (stmts.length) await db.batch(stmts);
}

// ------------------------------------------------------------------ gatilho

type Lead = {
  id?: number;
  contato_id: string;
  contato_nome?: string | null;
  email?: string | null;
  telefone?: string | null;
  registro_processo_id?: string | null;
  processo_id?: string | null;
  processo_nome?: string | null;
  etapa: string;
  curso_id?: string | null;
  registrado_em?: string | null;
  cep?: string | null;
  /** Valor real da matrícula, quando o webhook o traz. Vence o valor da tela. */
  valor_curso?: number | null;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
};

/**
 * A etapa que acabou de chegar dispara algum evento?
 *
 * Casa primeiro a regra do processo específico e só depois a global. Um funil
 * pode chamar de "Oportunidade" algo que não é inscrição concluída; a regra
 * específica existe para dizer isso sem desfazer o padrão dos outros.
 *
 * Comparação sem acento e sem caixa: o mesmo nome de etapa chega do webhook
 * nativo e do fluxo de automação com grafias diferentes, e recusar por causa de
 * um acento perderia a conversão sem deixar rastro.
 */
export async function gatilhoDaEtapa(
  db: D1Database,
  processoId: string | null | undefined,
  etapa: string,
): Promise<Evento | null> {
  const alvo = chave(etapa);
  if (!alvo) return null;

  const { results } = await db.prepare(
    `SELECT processo_id, etapa_nome, evento FROM conversao_gatilhos WHERE ativo = 1`,
  ).all();

  const linhas = results as Array<{ processo_id: string | null; etapa_nome: string; evento: Evento }>;
  const especifica = linhas.find(
    (l) => l.processo_id != null && String(l.processo_id) === String(processoId ?? '') && chave(l.etapa_nome) === alvo,
  );
  if (especifica) return especifica.evento;

  return linhas.find((l) => l.processo_id == null && chave(l.etapa_nome) === alvo)?.evento ?? null;
}

const chave = (s: string | null | undefined): string =>
  (s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/**
 * `orderId` — a mesma string serve de chave de idempotência aqui e no Google.
 *
 * O Rubeus reemite gatilho: reprocessamento, correção de cadastro, o operador
 * puxando o lead para trás e para a frente. Sem uma chave estável, cada
 * reemissão viraria uma conversão nova e a conta contaria a mesma matrícula
 * várias vezes — o erro caro, porque infla o resultado e o Smart Bidding passa
 * a pagar mais pelo que não aconteceu.
 *
 * Quando o evento traz `registro_processo_id`, ele entra na chave: a mesma
 * pessoa pode comprar dois cursos, e são duas conversões legítimas. Quando não
 * traz — e boa parte dos gatilhos do Rubeus não traz — a chave é
 * contato + evento, o que funde compras distintas num registro só. Subcontar é
 * o lado certo para errar.
 */
export function orderId(contatoId: string, evento: Evento, registroProcessoId?: string | null): string {
  const sufixo = registroProcessoId ? String(registroProcessoId) : 'sem-registro';
  return `${contatoId}-${evento}-${sufixo}`.slice(0, 64);
}

// -------------------------------------------------------------- reserva

/**
 * Reserva a linha da conversão, sem enviar nada ainda.
 *
 * Separado do envio de propósito: a reserva é uma escrita rápida e idempotente
 * que acontece junto do webhook, e o envio depende do Rubeus e do Google, que
 * podem estar fora do ar. Assim um evento nunca se perde por causa de uma API
 * de terceiro — ele fica pendente e o reprocessamento diário o alcança.
 *
 * Devolve `null` quando a linha já existia: é reemissão, não conversão nova.
 */
export async function reservar(
  db: D1Database,
  lead: Lead,
  evento: Evento,
  modo: 'teste' | 'real',
): Promise<number | null> {
  /*
   * A identidade é costurada ANTES de reservar, não depois.
   *
   * A linha da etapa que disparou o gatilho pode não ter e-mail nenhum — 3.510
   * das 7.346 linhas em produção vieram do sync do Rubeus e só 10% delas têm.
   * Mas o painel costuma ter o dado noutra linha do mesmo contato: 410 contatos
   * sem e-mail em lugar nenhum TÊM telefone em alguma passagem. Costurando
   * aqui, esses viram conversão aprimorada em vez de "sem identificador".
   */
  const quem = await identidadeDoContato(db, lead.contato_id, {
    email: lead.email,
    telefone: lead.telefone,
    nome: lead.contato_nome,
  });

  /*
   * O `orderId` usa o contato CANÔNICO, não o do evento.
   *
   * 78 e-mails e 79 telefones aparecem sob `contato_id` diferentes em produção
   * — cerca de 90 cadastros que são a mesma pessoa. Como o Google deduplica
   * pelo `orderId`, a mesma matrícula sob dois ids viraria duas conversões e
   * inflaria o número que decide lance de campanha.
   *
   * Momento certo para mudar isto: `conversoes_offline` está vazia em produção.
   * Depois do primeiro envio, mexer na regra do orderId faria o Google tratar
   * como nova uma conversão já contabilizada — que é o erro que ela evita.
   */
  const oid = orderId(quem.contatoCanonico, evento, lead.registro_processo_id);

  const { meta } = await db.prepare(
    `INSERT OR IGNORE INTO conversoes_offline (
       order_id, lead_etapa_id, contato_id, contato_canonico, contato_nome, email, telefone, cep,
       registro_processo_id, processo_id, processo_nome, etapa, evento,
       curso_id, click_id_tipo, click_id_valor, valor, modo, status, ocorrido_em
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', ?)`,
  ).bind(
    oid,
    lead.id ?? null,
    lead.contato_id,
    quem.contatoCanonico,
    quem.nome,
    quem.email,
    quem.telefone,
    lead.cep ?? quem.cep,
    lead.registro_processo_id ?? null,
    lead.processo_id ?? null,
    lead.processo_nome ?? null,
    lead.etapa,
    evento,
    lead.curso_id ?? null,
    lead.gclid ? 'gclid' : lead.gbraid ? 'gbraid' : lead.wbraid ? 'wbraid' : null,
    lead.gclid ?? lead.gbraid ?? lead.wbraid ?? null,
    // Valor do webhook. Nulo aqui deixa `acaoDoEvento` aplicar o da tela.
    lead.valor_curso ?? null,
    modo,
    lead.registrado_em ?? new Date().toISOString(),
  ).run();

  if (meta.changes && quem.origem.some((o) => o.endsWith(':outra-etapa'))) {
    console.log(JSON.stringify({
      evento: 'identidade_costurada',
      contato_id: lead.contato_id,
      canonico: quem.contatoCanonico,
      de_onde: quem.origem,
    }));
  }

  return meta.changes ? (meta.last_row_id as number) : null;
}

/**
 * Ponto de entrada do webhook: avalia a etapa que acabou de ser gravada.
 *
 * Roda em `waitUntil`, fora do caminho crítico. Um erro aqui não pode virar 500
 * para o Rubeus — o evento já está no funil, e é isso que o webhook precisa
 * garantir. Se o envio falhar, a linha fica pendente e o cron diário reprocessa.
 */
export async function avaliarLead(env: Env, lead: Lead): Promise<void> {
  const cfg = await lerConfig(env.DB);
  if (!cfg.ligado) return;

  const evento = await gatilhoDaEtapa(env.DB, lead.processo_id, lead.etapa);
  if (!evento) return;

  const id = await reservar(env.DB, lead, evento, cfg.modo);
  if (id === null) {
    console.log(JSON.stringify({
      evento: 'conversao_ja_registrada',
      contato_id: lead.contato_id,
      gatilho: evento,
    }));
    return;
  }

  await processarPendentes(env, cfg, 1);
}

// -------------------------------------------------------------- enriquecer

type Pendente = {
  id: number; order_id: string; contato_id: string; contato_nome: string | null;
  email: string | null; telefone: string | null; registro_processo_id: string | null;
  processo_id: string | null; processo_nome: string | null; etapa: string; evento: Evento;
  curso_id: string | null; curso_nome: string | null; nivel_ensino: string | null;
  click_id_tipo: string | null; click_id_valor: string | null;
  cep: string | null; contato_canonico: string | null; valor: number | null;
  ocorrido_em: string | null; tentativas: number; status: string;
  /* Não é coluna do banco: sai do Rubeus durante o enriquecimento. */
  valor_rubeus?: number | null;
};

/**
 * Completa o que o webhook não mandou, consultando o Rubeus.
 *
 * Duas coisas faltam quase sempre: o click id, que só existe se alguém tiver
 * cadastrado o campo personalizado, e o nível de ensino, que decide para qual
 * ação de conversão a linha vai. Sem o nível, a conversão iria toda para a ação
 * curinga e a conta perderia justamente a separação por nível que motivou os
 * eventos separados.
 */
async function enriquecer(env: Env, cfg: Config, p: Pendente): Promise<Pendente> {
  /*
   * Costura antes de tudo: o banco antes do CRM.
   *
   * Uma linha reservada há dias pode ter ganhado identidade desde então — outro
   * evento do mesmo contato chegou com o e-mail que faltava. Ler o próprio
   * banco custa uma consulta indexada; ir ao Rubeus custa uma chamada externa
   * que pode estar fora do ar. Quando o banco resolve, a chamada nem acontece.
   */
  if (!p.email || !p.telefone || !p.cep) {
    const quem = await identidadeDoContato(env.DB, p.contato_canonico ?? p.contato_id, {
      email: p.email, telefone: p.telefone, nome: p.contato_nome,
    });
    p.email = p.email ?? quem.email;
    p.telefone = p.telefone ?? quem.telefone;
    p.contato_nome = p.contato_nome ?? quem.nome;
    p.cep = p.cep ?? quem.cep;
    /*
     * Registra qual contato foi tratado como canônico.
     *
     * Informativo aqui, e não usado para recalcular o `order_id`: a chave de
     * idempotência é fixada na reserva e precisa continuar a mesma. Trocá-la
     * agora faria o Google ver como nova uma conversão que já contabilizou.
     */
    p.contato_canonico = p.contato_canonico ?? quem.contatoCanonico;
  }

  // Nível e curso: primeiro o catálogo local, que não custa chamada externa.
  if (!p.nivel_ensino && p.curso_id) {
    const c = await env.DB.prepare(
      'SELECT nome, nivel_ensino FROM cursos WHERE id = ?',
    ).bind(p.curso_id).first() as { nome: string; nivel_ensino: string | null } | null;
    if (c) {
      p.curso_nome = p.curso_nome ?? c.nome;
      p.nivel_ensino = c.nivel_ensino;
    }
  }

  if (!env.RUBEUS_ORIGEM || !env.RUBEUS_TOKEN) return p;

  // Oportunidades: trazem curso, nível e — quando existir — o valor do curso.
  if (!p.nivel_ensino) {
    try {
      const opps = await listarOportunidades(env, p.contato_id);
      const escolhida =
        (p.registro_processo_id
          ? opps.find((o) => String(o.id) === String(p.registro_processo_id))
          : undefined) ??
        opps.find((o) => chave(o.etapaNome) === chave(p.etapa)) ??
        [...opps]
          .filter((o) => (o.momento ?? '') <= (p.ocorrido_em ?? '9999'))
          .sort((a, b) => String(b.momento ?? '').localeCompare(String(a.momento ?? '')))[0] ??
        opps[0];
      if (escolhida) {
        p.nivel_ensino = p.nivel_ensino ?? escolhida.nivelEnsinoNome ?? null;
        p.curso_nome = p.curso_nome ?? escolhida.cursoNome ?? null;
        p.curso_id = p.curso_id ?? (escolhida.curso != null ? String(escolhida.curso) : null);
        p.valor_rubeus = valorDaOportunidade(escolhida);
      }
    } catch {
      /* CRM fora do ar não impede o envio: sem nível, cai na ação curinga. */
    }
  }

  // Click id e identidade: só vale a consulta se ainda falta alguma das duas.
  if (!p.click_id_valor || !p.email) {
    try {
      const contato = await dadosPessoa(env, p.contato_id);
      if (contato) {
        const campos = Array.isArray(contato.camposPersonalizados)
          ? (contato.camposPersonalizados as Array<Record<string, any>>)
          : [];
        /*
         * Procura por nome E por coluna: o campo personalizado do Rubeus tem um
         * rótulo escolhido por quem o criou ("gclid", "GCLID", "Google Click
         * Id") e uma coluna técnica que não diz nada. Casar só pelo rótulo
         * exato transformaria a diferença de maiúscula em conversão perdida.
         */
        const acha = (alvo: string) => campos.find((c) =>
          chave(c.nome).includes(alvo) || chave(c.coluna).includes(alvo),
        )?.valor || null;

        if (!p.click_id_valor) {
          const gclid = acha('gclid');
          const gbraid = acha('gbraid');
          const wbraid = acha('wbraid');
          p.click_id_tipo = gclid ? 'gclid' : gbraid ? 'gbraid' : wbraid ? 'wbraid' : null;
          p.click_id_valor = gclid || gbraid || wbraid || null;
        }

        const emails = contato.emails as any;
        const telefones = contato.telefones as any;
        p.email = p.email ?? emails?.principal?.email ?? null;
        p.telefone = p.telefone ?? telefones?.principal?.telefone ?? null;
        p.contato_nome = p.contato_nome ?? (contato.nome as string) ?? null;
      }
    } catch {
      /* mesma lógica: sem o contato, sobra o que o webhook já trouxe */
    }
  }

  /*
   * O cruzamento: o clique que o site capturou encontra o lead que o CRM mandou.
   *
   * Só entra quando o Rubeus não tem o click id — o CRM vence, porque lá o dado
   * pode ter vindo do próprio formulário, que é a fonte mais direta. Aqui é o
   * resgate de quando o formulário não carrega o campo.
   */
  if (!p.click_id_valor && (p.email || p.telefone)) {
    const clique = await procurarClique(env.DB, { email: p.email, telefone: p.telefone });
    if (clique) {
      p.click_id_tipo = clique.click_id_tipo;
      p.click_id_valor = clique.click_id_valor;
      await marcarCasado(env.DB, clique.id, p.contato_id);

      console.log(JSON.stringify({
        evento: 'clique_cruzado',
        contato_id: p.contato_id,
        tipo: clique.click_id_tipo,
        por: p.email ? 'email' : 'telefone',
      }));

      /*
       * Devolve ao CRM, se autorizado.
       *
       * Fora do caminho crítico do envio: se a escrita no Rubeus falhar, a
       * conversão já tem o click id em mãos e segue. Perder o registro no CRM é
       * ruim; perder a conversão por causa dele seria pior.
       */
      if (cfg.escreverNoRubeus) {
        await devolverAoRubeus(env, clique, p.contato_id, p.email);
      }
    }
  }

  return p;
}

/**
 * O valor real do curso, quando o Rubeus tiver algum.
 *
 * Duas moradas possíveis, nenhuma preenchida hoje: `valorCurso` na oportunidade
 * e o campo personalizado "VALOR DO CURSO" no cadastro de Curso. Ler as duas
 * custa nada — já temos a oportunidade em mãos — e faz o painel migrar sozinho
 * para a fonte certa no dia em que ela existir.
 */
function valorDaOportunidade(o: {
  valorCurso?: string | number | null;
  camposPersonalizados?: Record<string, unknown>;
}): number | null {
  const bruto = o.valorCurso ?? o.camposPersonalizados?.['campopersonalizado_3_compl_curso'];
  if (bruto === null || bruto === undefined || bruto === '') return null;
  // Aceita "1.250,00" e "1250.00": o Rubeus devolve texto, não número.
  const n = Number(String(bruto).replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ------------------------------------------------------------------ envio

/**
 * O momento da conversão em RFC 3339, no fuso de Brasília.
 *
 * A Data Manager API quer `2026-08-19T09:00:00-03:00` — com o `T`, diferente do
 * espaço que a Google Ads API aceitava. Em Brasília e não em UTC porque o
 * relatório do Google Ads é lido no fuso da conta: mandar UTC empurraria toda
 * conversão da noite para o dia seguinte e a curva do painel nunca casaria com
 * a do Google.
 */
export function momentoGoogle(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  const d = new Date(Number.isNaN(t) ? Date.now() : t);
  const br = new Date(d.getTime() - 3 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${br.getUTCFullYear()}-${p(br.getUTCMonth() + 1)}-${p(br.getUTCDate())}T` +
    `${p(br.getUTCHours())}:${p(br.getUTCMinutes())}:${p(br.getUTCSeconds())}-03:00`;
}

type Acao = { conversion_action_id: string; conversion_action_nome: string | null; valor: number; moeda: string };

/** A ação do nível exato; sem ela, a curinga. Sem nenhuma das duas, não envia. */
async function acaoDoEvento(db: D1Database, evento: Evento, nivel: string | null): Promise<Acao | null> {
  const linha = await db.prepare(
    `SELECT conversion_action_id, conversion_action_nome, valor, moeda
       FROM conversao_acoes
      WHERE ativo = 1 AND evento = ? AND nivel_ensino IN (?, ?)
      ORDER BY CASE WHEN nivel_ensino = ? THEN 0 ELSE 1 END
      LIMIT 1`,
  ).bind(evento, nivel ?? NIVEL_PADRAO, NIVEL_PADRAO, nivel ?? NIVEL_PADRAO).first();
  return (linha as Acao | null) ?? null;
}

/**
 * Monta o evento de conversão.
 *
 * Devolve `null` quando não há como atribuir — nem click id nem e-mail/telefone.
 * Isso não é erro do envio: é lead sem nada que ligue a pessoa a um clique, e
 * mandar assim só geraria recusa do Google com o mesmo resultado, mais ruído.
 *
 * Diferente do antigo `uploadClickConversions`, aqui click id e identificadores
 * de usuário vão JUNTOS quando os dois existem — é o que o próprio Google
 * recomenda: o gclid dá a atribuição exata, e o e-mail em hash recupera o caso
 * em que o clique não pôde ser observado.
 */
async function montar(
  p: Pendente,
  acao: Acao,
): Promise<{ evento: EventoConversao; identificadores: string } | null> {
  const evento: EventoConversao = {
    eventTimestamp: momentoGoogle(p.ocorrido_em),
    // O mesmo orderId da idempotência interna: o Google também deduplica por ele.
    transactionId: p.order_id,
    /*
     * Ordem do valor: webhook → API do Rubeus → tabela da tela.
     *
     * `p.valor` é o `valor_do_curso` que veio no corpo do webhook, e é o mais
     * confiável: é o preço daquela matrícula, não a média do nível de ensino.
     * O README afirmava que o Rubeus não tinha preço em lugar nenhum — verdade
     * para a API, falso para o webhook. A tabela da tela vira o último recurso.
     */
    conversionValue: p.valor ?? p.valor_rubeus ?? acao.valor,
    currency: acao.moeda || 'BRL',
    /*
     * `OTHER`, e não `WEB`.
     *
     * O clique aconteceu na web, mas o evento que está sendo enviado é a
     * matrícula — fechada no CRM, depois de conversa por telefone ou WhatsApp.
     * `WEB` diria ao Google que a conversão ocorreu no site, e é assim que ele
     * agrupa o relatório de origem: a conta veria compras no site que nunca
     * existiram.
     */
    eventSource: 'OTHER',
  };

  const usados: string[] = [];

  // Só UM identificador de clique por evento — o Google nunca emite dois.
  if (p.click_id_valor && p.click_id_tipo) {
    evento.adIdentifiers = { [p.click_id_tipo]: p.click_id_valor };
    usados.push(p.click_id_tipo);
  }

  /*
   * Conversão aprimorada: e-mail e telefone em hash.
   *
   * É o caminho que faz isso funcionar hoje, porque o click id ainda não existe
   * na base. Exige que a conta tenha aceitado os termos de dados do cliente no
   * Google Ads — sem isso o Google recusa com mensagem explícita, que fica
   * gravada no registro em vez de virar silêncio.
   */
  const ids: UserIdentifier[] = [];

  const email = p.email ? normalizarEmailParaHash(p.email) : null;
  if (email) {
    ids.push({ emailAddress: await sha256Hex(email) });
    usados.push('email');
  }
  const telefone = p.telefone ? normalizarTelefoneParaHash(p.telefone) : null;
  if (telefone) {
    ids.push({ phoneNumber: await sha256Hex(telefone) });
    usados.push('telefone');
  }

  /*
   * Endereço: a terceira via, e a única que alcança quem não tem e-mail.
   *
   * Só entra completo — nome, sobrenome, país e CEP. O Google descarta o
   * identificador de endereço incompleto, e mandá-lo pela metade só geraria
   * aviso de campo. O CEP chega na Ficha de Inscrição do Rubeus e é espalhado
   * para as outras passagens do mesmo lead pelo webhook.
   *
   * Nome e sobrenome em hash; país e CEP em claro — é assim que a Data Manager
   * API os define, e hashear os quatro faria o Google aceitar sem casar nada.
   */
  const cep = normalizarCep(p.cep);
  const nome = partirNome(p.contato_nome);
  if (cep && nome) {
    ids.push({
      address: {
        givenName: await sha256Hex(nome.primeiro),
        familyName: await sha256Hex(nome.ultimo),
        regionCode: 'BR',
        postalCode: cep,
      },
    });
    usados.push('endereco');
  }

  if (ids.length) evento.userData = { userIdentifiers: ids };

  if (!usados.length) return null;
  return { evento, identificadores: usados.join('+') };
}

/**
 * Pega a fila e envia, um lote por ação de conversão.
 *
 * O agrupamento não é otimização: na Data Manager API o destino faz parte do
 * corpo, e um corpo tem um destino. Como o painel usa uma ação por evento ×
 * nível de ensino, a fila de uma rodada costuma render dois ou três lotes — bem
 * menos que uma requisição por lead, que era o que o fluxo do n8n fazia.
 */
export async function processarPendentes(
  env: Env,
  cfg: Config,
  limite = 20,
): Promise<{ tentadas: number; enviadas: number; falhas: number; sem_identificador: number }> {
  const corte = new Date(Date.now() - cfg.janelaDias * 86_400_000).toISOString();

  /*
   * O que volta para a fila.
   *
   * 'simulada' entra só quando o modo é real: a linha foi validada pelo Google
   * mas nunca contabilizada, então ligar o modo real deve alcançar o que passou
   * pelo teste — é justamente o que torna o teste útil em vez de descartável.
   *
   * O teto de tentativas existe porque erro que persiste não é intermitência:
   * gclid expirado ou ação removida vão falhar para sempre, e reencostar neles
   * todo dia só gastaria cota e encheria o log.
   */
  const { results } = await env.DB.prepare(
    `SELECT * FROM conversoes_offline
      WHERE (status IN ('pendente', 'erro_api', 'sem_identificador', 'sem_acao')
             OR (status = 'simulada' AND ? = 'real'))
        AND tentativas < ?
        AND criado_em >= ?
      ORDER BY criado_em
      LIMIT ?`,
  ).bind(cfg.modo, MAX_TENTATIVAS, corte, limite).all();

  const fila = results as unknown as Pendente[];
  if (!fila.length) return { tentadas: 0, enviadas: 0, falhas: 0, sem_identificador: 0 };

  /** Fila já montada, agrupada pela ação de conversão que vai recebê-la. */
  const porAcao = new Map<string, Array<{ p: Pendente; evento: EventoConversao; identificadores: string; acao: Acao }>>();
  const stmts: D1PreparedStatement[] = [];
  let semIdentificador = 0;

  for (const bruto of fila) {
    const p = await enriquecer(env, cfg, bruto);
    const acao = await acaoDoEvento(env.DB, p.evento, p.nivel_ensino);

    if (!acao) {
      stmts.push(marcar(env.DB, p, 'sem_acao',
        `Nenhuma ação de conversão cadastrada para "${ROTULO_EVENTO[p.evento]}" no nível "${p.nivel_ensino ?? 'não identificado'}".`));
      continue;
    }

    const montada = await montar(p, acao);
    if (!montada) {
      semIdentificador++;
      stmts.push(marcar(env.DB, p, 'sem_identificador',
        'O lead não tem gclid nem e-mail/telefone válidos — não há como ligá-lo a um clique.'));
      continue;
    }

    const chaveAcao = acao.conversion_action_id;
    const lote = porAcao.get(chaveAcao);
    if (lote) lote.push({ p, ...montada, acao });
    else porAcao.set(chaveAcao, [{ p, ...montada, acao }]);
  }

  let enviadas = 0;
  let falhas = 0;
  const teste = cfg.modo === 'teste';

  const consentimento = consentimentoGoogle(cfg);

  for (const [conversionActionId, lote] of porAcao) {
    const { falhas: erros, resposta, requestIds, avisos } = await enviarConversoes(
      env,
      conversionActionId,
      lote.map((x) => x.evento),
      {
        validateOnly: teste,
        consentimento,
        /*
         * Na validação fast-fail da Data Manager API um evento ruim derruba o
         * lote inteiro. Sem isolar, um gclid expirado marcaria como recusadas
         * dezenas de conversões que o Google teria aceitado.
         */
        isolarFalhas: true,
      },
    );

    /*
     * Uma linha na fila de diagnóstico por requisição que o Google aceitou.
     *
     * `Set` porque o mesmo requestId se repete por evento do lote — e vira
     * vários ids distintos quando o lote precisou ser isolado.
     */
    const requisicoes = new Set(requestIds.values());
    for (const rid of requisicoes) {
      stmts.push(registrarRequisicao(env.DB, {
        requestId: rid,
        conversionActionId,
        conversionActionNome: lote[0]?.acao.conversion_action_nome ?? null,
        eventos: [...requestIds.values()].filter((v) => v === rid).length,
        modo: cfg.modo,
      }));
    }

    lote.forEach((x, i) => {
      const erro = erros.get(i);
      if (erro) {
        falhas++;
        stmts.push(marcar(env.DB, x.p, 'erro_api', erro, x, resposta, null, avisos));
      } else {
        enviadas++;
        stmts.push(marcar(
          env.DB, x.p, teste ? 'simulada' : 'enviada', null, x, null,
          requestIds.get(i) ?? null, avisos,
        ));
      }
    });
  }

  if (stmts.length) await env.DB.batch(stmts);

  console.log(JSON.stringify({
    evento: 'conversoes_processadas',
    modo: cfg.modo,
    tentadas: fila.length,
    enviadas,
    falhas,
    sem_identificador: semIdentificador,
  }));

  return { tentadas: fila.length, enviadas, falhas, sem_identificador: semIdentificador };
}

/**
 * Entra na fila de diagnóstico.
 *
 * `+30 minutos` não é folga arbitrária: é o intervalo que o Google pede antes
 * da primeira consulta, e antes disso o endpoint responde `PROCESSING` de
 * qualquer jeito — perguntar mais cedo só gasta cota para receber "ainda não".
 *
 * `INSERT OR IGNORE`: se a mesma requisição voltasse a ser registrada, manter a
 * primeira preserva o horário de consulta já agendado em vez de empurrá-lo.
 */
function registrarRequisicao(
  db: D1Database,
  d: {
    requestId: string;
    conversionActionId: string;
    conversionActionNome: string | null;
    eventos: number;
    modo: 'teste' | 'real';
  },
): D1PreparedStatement {
  return db.prepare(
    `INSERT OR IGNORE INTO conversao_requisicoes
       (request_id, conversion_action_id, conversion_action_nome, eventos, modo, proxima_verificacao)
     VALUES (?, ?, ?, ?, ?, datetime('now', '+30 minutes'))`,
  ).bind(d.requestId, d.conversionActionId, d.conversionActionNome, d.eventos, d.modo);
}

/** Uma escrita só por linha: status, o que foi resolvido e o resultado. */
function marcar(
  db: D1Database,
  p: Pendente,
  status: string,
  erro: string | null,
  extra?: { evento: EventoConversao; identificadores: string; acao: Acao },
  resposta?: string | null,
  requestId?: string | null,
  avisos?: string | null,
): D1PreparedStatement {
  return db.prepare(
    `UPDATE conversoes_offline SET
       status = ?, erro_detalhe = ?, tentativas = tentativas + 1,
       request_id = COALESCE(?, request_id),
       avisos = COALESCE(?, avisos),
       /*
        * O diagnóstico anterior morre junto com o envio anterior.
        *
        * Uma linha reenviada ganha um requestId novo, e o veredito do Google
        * sobre a tentativa passada não diz nada sobre esta. Mantê-lo faria a
        * tela mostrar "FAILED" ao lado de um envio que acabou de dar certo.
        */
       diagnostico = CASE WHEN ? IS NOT NULL THEN NULL ELSE diagnostico END,
       diagnostico_em = CASE WHEN ? IS NOT NULL THEN NULL ELSE diagnostico_em END,
       contato_nome = COALESCE(?, contato_nome),
       email = COALESCE(?, email),
       telefone = COALESCE(?, telefone),
       cep = COALESCE(?, cep),
       contato_canonico = COALESCE(?, contato_canonico),
       curso_id = COALESCE(?, curso_id),
       curso_nome = COALESCE(?, curso_nome),
       nivel_ensino = COALESCE(?, nivel_ensino),
       click_id_tipo = COALESCE(?, click_id_tipo),
       click_id_valor = COALESCE(?, click_id_valor),
       conversion_action_id = COALESCE(?, conversion_action_id),
       conversion_action_nome = COALESCE(?, conversion_action_nome),
       valor = COALESCE(?, valor),
       moeda = COALESCE(?, moeda),
       identificadores = COALESCE(?, identificadores),
       resposta = COALESCE(?, resposta),
       enviado_em = CASE WHEN ? IN ('enviada', 'simulada') THEN datetime('now') ELSE enviado_em END
     WHERE id = ?`,
  ).bind(
    status, erro,
    requestId ?? null,
    avisos ?? null,
    requestId ?? null,
    requestId ?? null,
    p.contato_nome, p.email, p.telefone,
    p.cep, p.contato_canonico,
    p.curso_id, p.curso_nome, p.nivel_ensino,
    p.click_id_tipo, p.click_id_valor,
    extra?.acao.conversion_action_id ?? null,
    extra?.acao.conversion_action_nome ?? null,
    /*
     * Grava o valor que FOI ENVIADO, não o padrão da ação.
     *
     * `acao.valor` é o último recurso da escala (webhook → Rubeus → tela). Se
     * ele fosse gravado aqui, o COALESCE sobrescreveria o `valor_do_curso` que
     * veio no webhook — e o registro passaria a mentir sobre quanto foi
     * mandado, que é justamente o número que se cruza com o Google Ads.
     */
    extra?.evento.conversionValue ?? null,
    extra?.acao.moeda ?? null,
    extra?.identificadores ?? null,
    resposta ?? null,
    status,
    p.id,
  );
}

// ------------------------------------------------------------- diagnóstico

/**
 * Pergunta ao Google o que ele fez com o que já aceitou.
 *
 * Esta é a metade que faltava do "conectar o Google". `events:ingest` responde
 * 200 quando aceita a REQUISIÇÃO; o processamento vem depois, e é onde aparece
 * se o e-mail em hash casou com alguém, se o gclid já tinha expirado, se a ação
 * de conversão recusou o registro. Sem esta passada, a tela diria "enviada"
 * para conversão que o Google descartou — o estado pior do que não ter enviado,
 * porque some sem rastro e ainda parece que funcionou.
 *
 * O resultado NÃO devolve as linhas à fila automaticamente. `PARTIAL_SUCCESS`
 * informa quantos registros caíram e por qual motivo, mas não QUAIS — reenviar
 * o lote todo por causa disso duplicaria as conversões que deram certo. O
 * painel marca, mostra o motivo, e o reenvio é decisão de quem lê.
 */
export async function conferirDiagnosticos(
  env: Env,
  limite = 10,
): Promise<{ consultadas: number; concluidas: number }> {
  const { results } = await env.DB.prepare(
    `SELECT id, request_id, tentativas FROM conversao_requisicoes
      WHERE (status IS NULL OR status = 'PROCESSING')
        AND proxima_verificacao <= datetime('now')
        /*
         * Depois de 24 h o Google não tem mais o que dizer, e uma requisição
         * que ficou PROCESSING esse tempo todo não vai concluir. Insistir só
         * gastaria cota para sempre, numa fila que nunca esvazia.
         */
        AND criado_em >= datetime('now', '-25 hours')
      ORDER BY proxima_verificacao
      LIMIT ?`,
  ).bind(limite).all();

  const fila = results as Array<{ id: number; request_id: string; tentativas: number }>;
  if (!fila.length) return { consultadas: 0, concluidas: 0 };

  const stmts: D1PreparedStatement[] = [];
  let concluidas = 0;

  for (const r of fila) {
    let status: string;
    let erros: Array<{ motivo: string; registros: number }> = [];
    let avisos: Array<{ motivo: string; registros: number }> = [];

    try {
      const d = await consultarStatusDaRequisicao(env, r.request_id);
      // `null` = o Google ainda não conhece esta requisição. Cedo demais.
      status = d?.status ?? 'PROCESSING';
      erros = d?.erros ?? [];
      avisos = d?.avisos ?? [];
    } catch (e) {
      console.error(JSON.stringify({
        evento: 'diagnostico_falhou', request_id: r.request_id, msg: String(e),
      }));
      /*
       * Erro de rede não é veredito. A requisição continua PROCESSING e volta
       * no próximo backoff — marcar FAILED aqui acusaria o Google de ter
       * recusado uma conversão que ele talvez tenha aceitado.
       */
      status = 'PROCESSING';
    }

    const terminou = status !== 'PROCESSING' && status !== 'REQUEST_STATUS_UNKNOWN';
    if (terminou) concluidas++;

    /*
     * Backoff de 1,3× a partir de 30 min, com teto de 60 min — o que o Google
     * recomenda. Em minutos inteiros porque o `datetime()` do SQLite só recebe
     * o modificador pronto.
     */
    const minutos = Math.min(60, Math.round(30 * 1.3 ** (r.tentativas + 1)));

    stmts.push(env.DB.prepare(
      `UPDATE conversao_requisicoes SET
         status = ?, erros = ?, avisos = ?,
         verificado_em = datetime('now'),
         tentativas = tentativas + 1,
         proxima_verificacao = datetime('now', ?)
       WHERE id = ?`,
    ).bind(
      status,
      erros.length ? JSON.stringify(erros) : null,
      avisos.length ? JSON.stringify(avisos) : null,
      `+${minutos} minutes`,
      r.id,
    ));

    if (terminou) {
      stmts.push(env.DB.prepare(
        `UPDATE conversoes_offline SET
           diagnostico = ?, diagnostico_em = datetime('now'),
           /*
            * O motivo do Google entra em erro_detalhe só quando a linha não
            * tinha erro nosso. Sobrescrever apagaria a causa mais próxima:
            * "sem acao cadastrada" explica mais do que "INVALID_EVENT".
            */
           erro_detalhe = COALESCE(erro_detalhe, ?)
         WHERE request_id = ?`,
      ).bind(
        status,
        erros.length
          ? `Google recusou: ${erros.map((x) => `${x.motivo} (${x.registros})`).join(', ')}`
          : null,
        r.request_id,
      ));
    }

    console.log(JSON.stringify({
      evento: 'diagnostico_conferido',
      request_id: r.request_id,
      status,
      erros: erros.length,
      avisos: avisos.length,
    }));
  }

  await env.DB.batch(stmts);
  return { consultadas: fila.length, concluidas };
}

// ---------------------------------------------------------------- planilha

/**
 * Sobe para a planilha tudo que já foi decidido e ainda não tem cópia lá.
 *
 * Inclui o que NÃO foi enviado. Uma planilha só com sucesso responde "quantas
 * conversões subiram" e esconde a pergunta que importa mais — quantos leads
 * ficaram de fora e por quê. É esse número que diz se vale a pena mexer no
 * formulário para capturar o gclid.
 */
export async function subirBackup(
  env: Env,
  cfg: Config,
  limite = 200,
): Promise<{ linhas: number }> {
  if (!cfg.planilhaId) return { linhas: 0 };

  /*
   * Espera o veredito do Google antes de copiar — mas não para sempre.
   *
   * A planilha é alimentada por append e cada linha entra uma vez só: copiar
   * assim que o envio termina congelaria "enviada" na coluna de status, e a
   * recusa que chega meia hora depois nunca apareceria lá. Como é a planilha
   * que se cruza com o relatório do Ads quando o número não bate, seria
   * justamente a cópia consultada nessa hora que estaria errada.
   *
   * As 24 h de teto existem porque diagnóstico que não chega não pode virar
   * linha que nunca é copiada: passado esse prazo a linha sobe como está, com
   * o diagnóstico em branco dizendo a verdade — não houve resposta.
   */
  const { results } = await env.DB.prepare(
    `SELECT * FROM conversoes_offline
      WHERE backup_em IS NULL
        AND status != 'pendente'
        AND (request_id IS NULL
             OR diagnostico IS NOT NULL
             OR criado_em < datetime('now', '-24 hours'))
      ORDER BY id LIMIT ?`,
  ).bind(limite).all();

  const linhas = results as unknown as Array<Record<string, any>>;
  if (!linhas.length) return { linhas: 0 };

  const paraPlanilha: LinhaBackup[] = linhas.map((l) => ({
    'Enviado em': l.enviado_em ?? l.criado_em,
    'Ocorrido em': l.ocorrido_em,
    Status: l.status,
    Modo: l.modo,
    Evento: ROTULO_EVENTO[l.evento as Evento] ?? l.evento,
    'Etapa (Rubeus)': l.etapa,
    'Contato ID': l.contato_id,
    Nome: l.contato_nome,
    'E-mail': l.email,
    Telefone: l.telefone,
    Curso: l.curso_nome,
    'Nível de ensino': l.nivel_ensino,
    Processo: l.processo_nome,
    'Ação de conversão': l.conversion_action_nome,
    'ID da ação': l.conversion_action_id,
    Valor: l.valor,
    Moeda: l.moeda,
    'Identificador usado': l.identificadores,
    'Click ID': l.click_id_valor,
    'Order ID': l.order_id,
    'Detalhe do erro': l.erro_detalhe,
    'Diagnóstico do Google': l.diagnostico,
    'Avisos do Google': l.avisos,
    'Request ID': l.request_id,
  }));

  await acrescentarLinhas(env, cfg.planilhaId, cfg.planilhaAba, paraPlanilha);

  /*
   * Marca DEPOIS do append, nunca antes.
   *
   * Se o Sheets falhar no meio, as linhas voltam na próxima rodada e no pior
   * caso duplicam na planilha — o que se percebe olhando. Marcar antes trocaria
   * isso por perda silenciosa, que é o defeito que backup nenhum pode ter.
   */
  await env.DB.prepare(
    `UPDATE conversoes_offline SET backup_em = datetime('now')
      WHERE id IN (${linhas.map(() => '?').join(',')})`,
  ).bind(...linhas.map((l) => l.id)).run();

  console.log(JSON.stringify({ evento: 'conversoes_backup', linhas: linhas.length }));
  return { linhas: linhas.length };
}

/**
 * Passada diária: reprocessa a fila e sincroniza a planilha.
 *
 * A fila reprocessada não é só "o que deu erro". É também o lead que chegou sem
 * curso e ganhou nível de ensino no sync do Rubeus da mesma madrugada, e o que
 * chegou sem e-mail e teve a identidade costurada por um evento posterior.
 */
export async function rodadaDiaria(env: Env): Promise<void> {
  const cfg = await lerConfig(env.DB);
  if (!cfg.ligado) {
    console.log(JSON.stringify({ evento: 'conversoes_puladas', motivo: 'desligado' }));
    return;
  }
  try {
    await processarPendentes(env, cfg, 60);
    /*
     * Diagnóstico ANTES do backup, para que a planilha leve o veredito junto.
     *
     * Não alcança o que acabou de ser enviado — esse ainda está nos 30 minutos
     * de espera do Google e sai na passada seguinte. Alcança o de ontem, que é
     * o que a planilha ainda não tinha.
     */
    await conferirDiagnosticos(env, 30);
    await subirBackup(env, cfg);
  } catch (e) {
    console.error(JSON.stringify({ evento: 'conversoes_rodada_erro', msg: String(e) }));
  }
}

/**
 * Passada curta, de meia em meia hora.
 *
 * Existe por causa do relógio do diagnóstico: o Google só responde 30 minutos
 * depois da ingestão, e com apenas o cron diário todo veredito chegaria com um
 * dia de atraso — tempo em que a tela seguiria dizendo "enviada" para conversão
 * recusada. De quebra, a fila de envio para de esperar até amanhã para
 * reprocessar o lead que chegou sem e-mail.
 *
 * Deliberadamente magra: nada de reconciliação do Rubeus, nada de planilha. O
 * teto baixo de linhas é o que mantém esta passada barata o bastante para rodar
 * 48 vezes por dia.
 */
export async function rodadaLeve(env: Env): Promise<void> {
  const cfg = await lerConfig(env.DB);
  if (!cfg.ligado) return;
  try {
    await conferirDiagnosticos(env, 10);
    await processarPendentes(env, cfg, 15);
  } catch (e) {
    console.error(JSON.stringify({ evento: 'conversoes_rodada_leve_erro', msg: String(e) }));
  }
}
