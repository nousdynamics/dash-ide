import { Hono } from 'hono';
import type { ZodTypeAny, output as ZodOutput } from 'zod';
import { CorpoInvalido, lerCorpoJson } from '../lib/corpo';
import { avaliarLead } from '../lib/conversoes';
import { hashDoToken } from '../lib/credenciais';
import { aprenderEtapaDoEvento } from '../lib/rubeus';
import { conversaSchema, etapaSchema, normalizarEtapa } from '../lib/schemas';
import type { AppEnv } from '../lib/tipos';

/**
 * Webhooks de entrada.
 *
 * Três canais, cada um com URL e token próprios por funil: Rubeus (mudança de
 * etapa), Evolution API (conversa de WhatsApp) e n8n (genérico). Separar por
 * canal E por funil deixa revogar uma credencial sem derrubar as outras, e faz
 * o evento já chegar sabendo a qual funil pertence.
 *
 * As métricas de mídia não passam por aqui — vêm da consulta ao vivo em
 * /api/ads.
 */
/** Marcador de etapa ausente — visível na tela, em vez de sumir. */
const ETAPA_DESCONHECIDA = '(etapa não informada)';

const webhooks = new Hono<AppEnv>();

/**
 * Duas formas de autenticar, por rota:
 *
 * - `/webhook/<canal>/<slug>?t=<token>` — token por funil × canal, emitido pelo
 *   painel. É o caminho novo: cada origem tem a própria credencial, então dá
 *   para revogar uma sem derrubar as outras, e o evento já chega sabendo a qual
 *   funil pertence.
 * O caminho antigo, com `X-Webhook-Secret` no header, foi removido: era um
 * segredo único para todas as origens e todos os funis, sem como revogar um
 * sem derrubar os outros, e sem dizer de qual funil o evento vinha. Manter os
 * dois esquemas só preservaria o elo mais fraco.
 */
/**
 * Todo token que a requisição carrega, em qualquer lugar que a origem consiga pôr.
 *
 * Lista, não precedência. O Rubeus oferece "Autenticação: Bearer" com campo de
 * token E aceita query na URL; com o Bearer vencendo, um valor velho deixado
 * naquele campo anulava o token correto do link e o webhook voltava 401 sem
 * explicação. Basta UM dos candidatos ser válido — quem não tem token nenhum
 * continua sendo recusado, então isso não afrouxa nada.
 */
function tokensCandidatos(c: any): string[] {
  const bruto = [
    (c.req.header('Authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1],
    c.req.header('X-Webhook-Token'),
    c.req.header('apikey'),
    c.req.query('t'),
  ];
  return [...new Set(bruto.map((t) => t?.trim()).filter((t): t is string => !!t))];
}

async function resolverToken(c: any): Promise<{ funilId: number | null; slug: string } | null> {
  const candidatos = tokensCandidatos(c);
  const canal = c.req.path.split('/')[2];
  const slug = c.req.param('slug');
  if (!candidatos.length) return null;

  /*
   * Duas formas de credencial:
   *  - por funil  → /webhook/<canal>/<slug>, o funil vem da URL
   *  - por evento → /webhook/<canal>/evento/<tipo>, sem funil na URL
   *
   * A segunda existe porque o Rubeus cadastra webhook por TIPO DE EVENTO, não
   * por funil: uma URL só recebe "novo registro de processo" de todos os
   * processos, e o funil vem no corpo.
   */
  /*
   * Compara hashes, não tokens: o D1 não guarda mais o valor em claro. Hash é
   * determinístico, então a busca continua sendo um índice, sem varrer a tabela.
   */
  const hashes = await Promise.all(candidatos.map(hashDoToken));
  const marcadores = hashes.map(() => '?').join(',');
  const linha = await c.env.DB.prepare(
    `SELECT w.id, w.funil_id FROM webhooks w
     LEFT JOIN funis f ON f.id = w.funil_id
     WHERE w.token_hash IN (${marcadores}) AND w.canal = ?
       AND (w.funil_id IS NULL OR (f.slug = ? AND f.ativo = 1))`,
  )
    .bind(...hashes, canal, slug ?? null)
    .first() as { id: number; funil_id: number | null } | null;

  if (!linha) return null;

  // Alimenta o "recebeu evento?" da tela de webhooks.
  c.executionCtx?.waitUntil(
    c.env.DB.prepare(
      `UPDATE webhooks SET ultimo_uso_em = datetime('now'), total_recebido = total_recebido + 1 WHERE id = ?`,
    )
      .bind(linha.id)
      .run(),
  );

  return { funilId: linha.funil_id, slug: slug ?? '' };
}

/**
 * Descobre o funil a partir do processo que veio no payload.
 *
 * Casa primeiro por `processo_id`, que é estável, e cai para o nome quando o id
 * não está cadastrado. Se o processo é novo, cria o funil na hora: perder o
 * evento por causa de um funil não cadastrado seria pior que ter um funil a
 * mais na lista, e o nome vem do próprio Rubeus.
 */
async function funilDoPayload(c: any, d: any): Promise<number | null> {
  const pid = d.processo_id != null ? String(d.processo_id) : null;
  const nome = d.processo_nome ? String(d.processo_nome).trim() : null;
  if (!pid && !nome) return null;

  const achado = await c.env.DB.prepare(
    `SELECT id FROM funis WHERE ativo = 1
       AND ((? IS NOT NULL AND processo_id = ?) OR (? IS NOT NULL AND lower(nome) = lower(?)))
     LIMIT 1`,
  )
    .bind(pid, pid, nome, nome)
    .first() as { id: number } | null;

  if (achado) {
    // Aprende o processo_id na primeira vez que ele aparece.
    if (pid) {
      c.executionCtx?.waitUntil(
        c.env.DB.prepare('UPDATE funis SET processo_id = ? WHERE id = ? AND processo_id IS NULL')
          .bind(pid, achado.id)
          .run(),
      );
    }
    return achado.id;
  }

  if (!nome) return null;
  const slug = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  const { meta } = await c.env.DB.prepare(
    'INSERT OR IGNORE INTO funis (nome, slug, processo_id) VALUES (?, ?, ?)',
  ).bind(nome, slug, pid).run();
  console.log(JSON.stringify({ evento: 'funil_criado_pelo_payload', nome, slug }));
  return meta.last_row_id || null;
}

/**
 * Registra o que chegou, aceito ou não.
 *
 * Fora do caminho crítico (waitUntil): diagnóstico não pode atrasar nem
 * derrubar a gravação do lead.
 */
/**
 * Tira do corpo o que o diagnóstico não precisa.
 *
 * O diário existe para descobrir o FORMATO do payload, não para guardar dado
 * pessoal: 1.017 dos payloads recebidos traziam CPF e 1.020 a data de
 * nascimento, em texto puro. O formato continua legível — o campo fica lá, com
 * o valor mascarado — e o que vazaria num dump deixa de existir.
 */
function mascararPii(corpo: string | null): string | null {
  if (!corpo) return corpo;
  return corpo
    // "cpf":"09492414406" e cpf=09492414406
    .replace(/("cpf"\s*:\s*")[^"]*(")/gi, '$1<oculto>$2')
    .replace(/(\bcpf=)[^&]*/gi, '$1%3Coculto%3E')
    // nascimento em qualquer grafia
    .replace(/("(?:dataNascimento|nascimento)"\s*:\s*")[^"]*(")/gi, '$1<oculto>$2')
    .replace(/(\b(?:dataNascimento|nascimento)=)[^&]*/gi, '$1%3Coculto%3E');
}

function registrarEvento(
  c: any,
  status: string,
  corpo: string | null,
  detalhe?: string,
  lead?: { contato_id?: unknown; contato_nome?: unknown; etapa?: unknown },
) {
  const canal = c.req.path.split('/')[2] ?? null;
  const slug = c.req.param('slug') ?? null;
  c.executionCtx?.waitUntil(
    (async () => {
      try {
        await c.env.DB.prepare(
          `INSERT INTO eventos_recebidos
             (webhook_id, canal, funil_slug, status, detalhe, corpo, contato_id, contato_nome, etapa)
           VALUES ((SELECT w.id FROM webhooks w JOIN funis f ON f.id = w.funil_id
                    WHERE w.canal = ? AND f.slug = ?), ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            canal, slug, canal, slug, status, detalhe ?? null, mascararPii(corpo)?.slice(0, 4000) ?? null,
            lead?.contato_id != null ? String(lead.contato_id) : null,
            lead?.contato_nome != null ? String(lead.contato_nome) : null,
            lead?.etapa != null ? String(lead.etapa) : null,
          )
          .run();
        // Mantém só as 50 últimas por webhook: o corpo tem dado de lead e não
        // precisa viver além do tempo de diagnosticar a integração.
        await c.env.DB.prepare(
          /*
           * `IS`, não `=`.
           *
           * Webhook por evento não tem funil, então `funil_slug` é NULL — e
           * `NULL = NULL` em SQL não é verdadeiro, é NULL. A retenção nunca
           * casava nenhuma linha e o diário cresceu sem limite: 1.643 payloads
           * acumulados, 1.017 deles com CPF. Nos webhooks por funil, onde o
           * slug é texto, o corte de 50 sempre funcionou — o que escondeu o bug.
           *
           * Consequência aceita: os cinco webhooks por evento passam a dividir o
           * mesmo teto de 50, porque compartilham (canal, NULL). Para um diário
           * de diagnóstico é o suficiente, e um teto compartilhado é melhor que
           * teto nenhum guardando CPF.
           */
          `DELETE FROM eventos_recebidos WHERE id IN (
             SELECT id FROM eventos_recebidos
             WHERE canal IS ? AND funil_slug IS ?
             ORDER BY recebido_em DESC LIMIT -1 OFFSET 50)`,
        )
          .bind(canal, slug)
          .run();
      } catch {
        /* diagnóstico nunca derruba o webhook */
      }
    })(),
  );
}

/** Middleware das rotas com token no lugar do header. */
const exigirToken = async (c: any, next: any) => {
  const r = await resolverToken(c);
  if (!r) {
    console.warn(JSON.stringify({ evento: 'token_invalido', rota: c.req.path }));
    return c.json({ erro: 'nao_autorizado' }, 401);
  }
  c.set('funilId', r.funilId);
  await next();
};

/**
 * Lê + valida o corpo, para que campo faltante vire 400 explícito em vez de
 * linha parcial gravada em silêncio.
 */
async function validarCorpo<S extends ZodTypeAny>(
  req: Request,
  schema: S,
  rota: string,
  normalizar?: (b: unknown) => unknown,
): Promise<
  { ok: true; dados: ZodOutput<S> } | { ok: false; erro: string; detalhe: unknown }
> {
  let bruto: unknown;
  try {
    bruto = await lerCorpoJson(req);
  } catch (e) {
    const msg = e instanceof CorpoInvalido ? e.message : 'falha ao ler corpo';
    console.warn(JSON.stringify({ evento: 'corpo_ilegivel', rota, msg }));
    return { ok: false, erro: 'corpo_invalido', detalhe: msg };
  }

  const r = schema.safeParse(normalizar ? normalizar(bruto) : bruto);
  if (!r.success) {
    console.warn(JSON.stringify({
      evento: 'schema_invalido',
      rota,
      problemas: r.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`),
    }));
    return {
      ok: false,
      erro: 'schema_invalido',
      detalhe: r.error.issues.map((i) => ({ campo: i.path.join('.'), msg: i.message })),
    };
  }

  return { ok: true, dados: r.data };
}

/**
 * Costura a identidade nos eventos que já chegaram sem ela.
 *
 * Não cria linha no funil: casa por contato_id, e-mail ou telefone e completa o
 * que estiver vazio. É o que junta o mesmo lead que o Rubeus mandou com ids
 * diferentes conforme o gatilho — RAFAEL entrou como 1670629 num e 44176 noutro.
 */
async function gravarIdentidade(
  c: any,
  d: { contato_id: string; contato_nome?: string | null; email?: string | null; telefone?: string | null },
  cru: string | null,
) {
  const { meta } = await c.env.DB.prepare(
    `UPDATE leads_etapa
        SET email        = COALESCE(email, ?),
            telefone     = COALESCE(telefone, ?),
            contato_nome = COALESCE(contato_nome, ?)
      WHERE contato_id = ?
         OR (? IS NOT NULL AND email = ?)
         OR (? IS NOT NULL AND telefone = ?)`,
  )
    .bind(
      d.email ?? null, d.telefone ?? null, d.contato_nome ?? null,
      d.contato_id,
      d.email ?? null, d.email ?? null,
      d.telefone ?? null, d.telefone ?? null,
    )
    .run();

  registrarEvento(
    c,
    'identidade',
    cru,
    meta.changes
      ? `E-mail/telefone aplicados a ${meta.changes} passagem(ns) deste lead.`
      : 'Contato ainda sem passagem de etapa registrada; a identidade será aplicada quando a primeira chegar.',
    d,
  );

  console.log(JSON.stringify({
    evento: 'identidade_recebida',
    contato_id: d.contato_id,
    tem_email: Boolean(d.email),
    linhas: meta.changes,
  }));

  return c.json({ ok: true, tipo: 'identidade', atualizados: meta.changes }, 200);
}

/** Grava um evento de etapa, com ou sem funil associado. */
async function gravarEtapa(c: any, funilId: number | null, jaValidado?: any) {
  let d = jaValidado;
  if (!d) {
    const cru = await c.req.raw.clone().text().catch(() => null);
    /*
     * A query completa o payload.
     *
     * O fluxo de automação do Rubeus dispara a partir de um gatilho de etapa
     * ("entrou na etapa Oportunidade"), mas o corpo que ele monta não carrega
     * qual etapa é — a informação está no fluxo, não no dado. Como cada fluxo
     * tem a própria URL, a etapa vai nela: ?etapa=Oportunidade. Quem configura
     * cola um link por ação, que é exatamente o modelo de "um webhook por
     * etapa" que se quer monitorar.
     *
     * O corpo vence a query quando os dois trazem o campo: dado real do evento
     * é mais confiável que valor fixo na URL.
     */
    const daQuery = {
      etapa: c.req.query('etapa'),
      processo_nome: c.req.query('processo'),
      status: c.req.query('status'),
    };
    let semEtapa = false;
    const r = await validarCorpo(c.req.raw, etapaSchema, c.req.path, (b) => {
      const norm = normalizarEtapa(b) as Record<string, unknown>;
      for (const [k, v] of Object.entries(daQuery)) {
        if (v && (norm[k] === undefined || norm[k] === null || norm[k] === '')) norm[k] = v;
      }
      /*
       * Evento real nunca é descartado.
       *
       * Se a etapa não veio nem no corpo nem na query, gravar marcado é melhor
       * que devolver 400: o lead existe, o CRM não vai reenviar, e um 400 às 8h
       * da manhã vira buraco permanente no histórico. Fica visível no diário
       * como "sem etapa" para o mapeamento ser corrigido, e o evento continua
       * lá para ser reprocessado.
       */
      if (!norm.etapa) {
        norm.etapa = ETAPA_DESCONHECIDA;
        semEtapa = true;
      }
      return norm;
    });
    if (!r.ok) {
      registrarEvento(c, r.erro, cru, JSON.stringify(r.detalhe).slice(0, 500));
      return c.json({ erro: r.erro, detalhe: r.detalhe }, 400);
    }

    /*
     * Payload de contato entra por identidade, não por etapa.
     *
     * Criação e edição de cadastro não descrevem movimento no funil. Se a etapa
     * teve de ser inventada mas o payload traz e-mail ou telefone, o que chegou
     * foi QUEM é a pessoa — e isso completa os eventos que já estão gravados sem
     * identidade, em vez de virar mais uma linha "(etapa não informada)".
     */
    if (semEtapa && (r.dados.email || r.dados.telefone)) {
      return gravarIdentidade(c, r.dados, cru);
    }
    registrarEvento(
      c,
      semEtapa ? 'aceito_sem_etapa' : 'aceito',
      cru,
      semEtapa
        ? 'Gravado, mas sem etapa: mapeie um campo de etapa nos parâmetros do fluxo do Rubeus.'
        : undefined,
      r.dados as any,
    );
    d = r.dados;
  }

  // Funil do payload vence o da URL: com webhook por evento, a URL não sabe.
  const doPayload = await funilDoPayload(c, d);
  const funilFinal = doPayload ?? funilId;

  /*
   * O mesmo evento já está gravado?
   *
   * Medido em produção (05/09/2026): 321 linhas exatamente duplicadas — mesmo
   * contato, mesma etapa, mesmo `registrado_em`, mesmo processo. O Rubeus
   * reemite o gatilho (reprocessamento, o operador salvando duas vezes) e nada
   * impedia a segunda gravação.
   *
   * A checagem mora aqui, e não num índice UNIQUE, porque o índice não pode
   * nascer sobre dados que já o violam — a migration falharia no meio do
   * deploy. Quando as 321 forem revisadas e removidas, isto vira uma linha de
   * SQL e a regra passa para o banco, que é o lugar certo dela.
   *
   * Corrida entre dois webhooks simultâneos ainda pode escapar: o resultado é o
   * comportamento de hoje, não um pior.
   */
  const jaExiste = await c.env.DB.prepare(
    `SELECT id FROM leads_etapa
      WHERE contato_id = ? AND etapa = ? AND registrado_em = ?
        AND COALESCE(processo_id, '') = COALESCE(?, '')
      LIMIT 1`,
  ).bind(d.contato_id, d.etapa, d.registrado_em, d.processo_id ?? null).first();

  if (jaExiste) {
    console.log(JSON.stringify({
      evento: 'etapa_repetida_ignorada',
      contato_id: d.contato_id,
      etapa: d.etapa,
      registrado_em: d.registrado_em,
    }));
    return c.json({ ok: true, repetido: true }, 200);
  }

  /*
   * `INSERT OR IGNORE`, agora que o banco tem a chave única.
   *
   * A consulta acima resolve o caso comum e devolve 200 "repetido" ao Rubeus,
   * que é a resposta educada. Ela não fecha a corrida: dois webhooks do mesmo
   * evento no mesmo instante passam os dois pela checagem. Com o índice único
   * da migration 0036, o segundo INSERT estouraria e viraria 500 — e 500 faz o
   * Rubeus tratar como falha um evento que foi recebido e já está gravado.
   *
   * `OR IGNORE` transforma esse choque em `meta.changes = 0`, que é exatamente
   * a verdade: nada foi inserido porque já estava lá.
   */
  const { meta } = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO leads_etapa (
       contato_id, contato_nome, registro_processo_id, processo_id, processo_nome, etapa, status,
       curso_id, curso_codigo, oferta_codigo, oferta_nome,
       origem, modalidade, unidade, responsavel_comercial, registrado_em,
       funil_id, email, telefone, gclid, gbraid, wbraid,
       cep, cidade, estado, valor_curso, url_origem, pessoa_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      d.contato_id,
      d.contato_nome ?? null,
      d.registro_processo_id ?? null,
      d.processo_id ?? null,
      d.processo_nome ?? null,
      d.etapa,
      d.status ?? null,
      d.curso_id ?? null,
      d.curso_codigo ?? null,
      d.oferta_codigo ?? null,
      d.oferta_nome ?? null,
      d.origem ?? null,
      d.modalidade ?? null,
      d.unidade ?? null,
      d.responsavel_comercial ?? null,
      d.registrado_em,
      funilFinal,
      d.email ?? null,
      d.telefone ?? null,
      d.gclid ?? null,
      d.gbraid ?? null,
      d.wbraid ?? null,
      d.cep ?? null,
      d.cidade ?? null,
      d.estado ?? null,
      d.valor_curso ?? null,
      d.url_origem ?? null,
      /*
       * Chute inicial da chave de pessoa, corrigido logo abaixo.
       *
       * Vai preenchido no INSERT para que a linha nunca exista com
       * `pessoa_id` nulo — uma linha sem chave some de toda contagem do funil,
       * que é pior do que uma chave provisória por alguns milissegundos.
       */
      d.email ?? d.telefone ?? d.contato_id,
    )
    .run();

  /* Perdeu a corrida: a linha já existe, gravada pelo webhook gêmeo. */
  if (!meta.changes) {
    console.log(JSON.stringify({
      evento: 'etapa_repetida_corrida', contato_id: d.contato_id, etapa: d.etapa,
    }));
    return c.json({ ok: true, repetido: true }, 200);
  }

  /*
   * Espalha a identidade para trás.
   *
   * O gatilho de "Inscrito Parcial" manda e-mail e telefone mas um `id` que não
   * é o do contato; o de contato manda o id certo. Quando um evento traz e-mail,
   * todas as passagens do mesmo e-mail que chegaram sem ele ficam completas —
   * senão o cruzamento com RD e Evolution só enxergaria metade da jornada.
   */
  if (d.email || d.telefone || d.cep) {
    c.executionCtx?.waitUntil(
      c.env.DB.prepare(
        /*
         * O CEP viaja junto: ele só chega na Ficha de Inscrição, e é o que
         * completa o identificador de endereço do Google para as outras
         * passagens do mesmo lead.
         */
        `UPDATE leads_etapa
            SET email    = COALESCE(email, ?),
                telefone = COALESCE(telefone, ?),
                cep      = COALESCE(cep, ?)
          WHERE (email IS NULL OR telefone IS NULL OR cep IS NULL)
            AND (contato_id = ? OR (? IS NOT NULL AND email = ?) OR (? IS NOT NULL AND telefone = ?))`,
      )
        .bind(
          d.email ?? null, d.telefone ?? null, d.cep ?? null,
          d.contato_id,
          d.email ?? null, d.email ?? null,
          d.telefone ?? null, d.telefone ?? null,
        )
        .run(),
    );
  }

  /*
   * Recalcula a chave de pessoa deste contato.
   *
   * Precisa rodar DEPOIS da propagação de identidade acima: é ela que espalha o
   * e-mail recém-chegado para as passagens antigas, e a chave sai justamente do
   * melhor identificador presente em qualquer linha do contato.
   *
   * Sem isto, o lead que chegou pelo sync sem e-mail ficaria chaveado pelo
   * `contato_id` para sempre, e a pessoa apareceria duas vezes na contagem —
   * o defeito que a migration 0033 corrigiu no histórico.
   *
   * Fora do caminho crítico, e limitado às linhas de um contato: é barato.
   */
  c.executionCtx?.waitUntil(
    c.env.DB.prepare(
      `UPDATE leads_etapa
          SET pessoa_id = (
            SELECT COALESCE(MIN(l2.email), MIN(l2.telefone), leads_etapa.contato_id)
              FROM leads_etapa l2 WHERE l2.contato_id = leads_etapa.contato_id
          )
        WHERE contato_id = ?`,
    ).bind(d.contato_id).run(),
  );

  // Catálogo de etapas: cada evento real ensina a ordem/macro do processo.
  if (d.processo_id && d.etapa) {
    c.executionCtx?.waitUntil(
      aprenderEtapaDoEvento(c.env.DB, d.processo_id, d.etapa).catch(() => undefined),
    );
  }

  /*
   * Conversão offline, fora do caminho crítico.
   *
   * `waitUntil` e `catch` engolindo: o webhook precisa devolver 201 para o
   * Rubeus porque a etapa JÁ está gravada no funil — que é o que ele veio
   * entregar. Se o Google ou o CRM estiverem fora do ar, a conversão fica
   * pendente e o reprocessamento diário a alcança; devolver erro aqui faria o
   * Rubeus tratar como falha um evento que foi recebido com sucesso.
   */
  c.executionCtx?.waitUntil(
    avaliarLead(c.env, {
      id: meta.last_row_id as number,
      contato_id: d.contato_id,
      contato_nome: d.contato_nome ?? null,
      email: d.email ?? null,
      telefone: d.telefone ?? null,
      registro_processo_id: d.registro_processo_id ?? null,
      processo_id: d.processo_id ?? null,
      processo_nome: d.processo_nome ?? null,
      etapa: d.etapa,
      curso_id: d.curso_id ?? null,
      curso_codigo: d.curso_codigo ?? null,
      oferta_codigo: d.oferta_codigo ?? null,
      oferta_nome: d.oferta_nome ?? null,
      registrado_em: d.registrado_em,
      cep: d.cep ?? null,
      valor_curso: d.valor_curso ?? null,
      gclid: d.gclid ?? null,
      gbraid: d.gbraid ?? null,
      wbraid: d.wbraid ?? null,
    }).catch((e) => {
      console.error(JSON.stringify({ evento: 'conversao_falhou', contato_id: d.contato_id, msg: String(e) }));
    }),
  );

  console.log(JSON.stringify({
    evento: 'etapa_gravada',
    contato_id: d.contato_id,
    etapa: d.etapa,
    processo: d.processo_nome,
    tem_curso: Boolean(d.curso_id || d.curso_codigo || d.oferta_codigo || d.oferta_nome),
    tem_email: Boolean(d.email),
  }));

  return c.json({ ok: true, id: meta.last_row_id }, 201);
}

/**
 * POST /webhook/evolution/conversa — Evolution API (somente leitura de conversa;
 * nenhum disparo de mensagem sai daqui, conforme decisão do plano).
 *
 * Upsert por (contato_id, iniciada_em): a Evolution reemite eventos da mesma
 * conversa conforme ela avança, e cada reemissão deve atualizar a linha — o
 * tempo de resposta só é conhecido depois da primeira resposta do atendente.
 */
/** Grava/atualiza uma conversa, com ou sem funil associado. */
async function gravarConversa(c: any, funilId: number | null) {
  const r = await validarCorpo(c.req.raw, conversaSchema, c.req.path);
  if (!r.ok) return c.json({ erro: r.erro, detalhe: r.detalhe }, 400);
  const d = r.dados;

  await c.env.DB.prepare(
    `INSERT INTO conversas_whatsapp
       (contato_id, contato_nome, atendente, iniciada_em, respondida, tempo_resposta_min, funil_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (contato_id, iniciada_em) DO UPDATE SET
       contato_nome       = COALESCE(excluded.contato_nome, contato_nome),
       atendente          = COALESCE(excluded.atendente, atendente),
       respondida         = MAX(excluded.respondida, respondida),
       tempo_resposta_min = COALESCE(tempo_resposta_min, excluded.tempo_resposta_min)`,
  )
    .bind(
      d.contato_id ?? null,
      d.contato_nome ?? null,
      d.atendente ?? null,
      d.iniciada_em,
      d.respondida ? 1 : 0,
      d.tempo_resposta_min ?? null,
      funilId,
    )
    .run();

  return c.json({ ok: true }, 201);
}

/*
 * Rotas por funil. Declaradas DEPOIS das fixas: o Hono casa na ordem, e
 * `/rubeus/:slug` engoliria `/rubeus/etapa` se viesse antes.
 */
/*
 * Rotas por tipo de evento. Vêm antes das por slug: `/rubeus/:slug` casaria
 * com `/rubeus/evento` e engoliria estas.
 */
/**
 * POST /webhook/rubeus/evento/geral — porta de entrada que aceita qualquer coisa.
 *
 * Declarada antes de `/rubeus/evento/:tipo`, que casaria com "geral" e mandaria
 * o payload para a validação estrita — exatamente o que este endpoint existe
 * para evitar.
 *
 * Nesta fase do projeto o formato de cada gatilho ainda não é todo conhecido.
 * Recusar por schema perderia justamente o payload que ensinaria a tratá-lo, e
 * evento do CRM não é reenviado. Então este endpoint nunca devolve 400: tenta
 * interpretar como etapa e, se não der, guarda cru no diário para análise.
 */
webhooks.post('/rubeus/evento/geral', exigirToken, async (c) => {
  const cru = await c.req.raw.clone().text().catch(() => null);
  const etapa = await validarCorpo(c.req.raw.clone(), etapaSchema, c.req.path, normalizarEtapa);

  if (etapa.ok) return gravarEtapa(c, null, etapa.dados);

  registrarEvento(
    c,
    'guardado_sem_tratar',
    cru,
    'Recebido pelo webhook geral. Formato ainda não mapeado — o corpo está guardado para análise.',
  );
  return c.json({ ok: true, tratado: false }, 202);
});

webhooks.post('/rubeus/evento/:tipo', exigirToken, (c) => gravarEtapa(c, null));
webhooks.post('/evolution/evento/:tipo', exigirToken, (c) => gravarConversa(c, null));
webhooks.post('/n8n/evento/:tipo', exigirToken, (c) => gravarEtapa(c, null));

webhooks.post('/rubeus/:slug', exigirToken, async (c) => gravarEtapa(c, c.get('funilId') ?? null));
webhooks.post('/evolution/:slug', exigirToken, async (c) => gravarConversa(c, c.get('funilId') ?? null));

/**
 * POST /webhook/n8n/:slug — canal de contingência.
 *
 * Não é uma integração de rotina: existe para reenviar evento que se perdeu e
 * para injetar dado à mão quando algo quebra do lado do Rubeus ou da Evolution.
 * Por isso aceita tanto payload de etapa quanto de conversa e decide pelo
 * formato — num canal usado enquanto se apaga incêndio, obrigar a escolher a
 * rota certa só transfere a chance de errar para o pior momento possível.
 *
 * Reenviar o mesmo evento é seguro: o funil conta contatos DISTINTOS por etapa,
 * então linha duplicada não infla número, e conversa é upsert por
 * (contato_id, iniciada_em).
 */
webhooks.post('/n8n/:slug', exigirToken, async (c) => {
  const funilId = c.get('funilId') ?? null;
  const clone = c.req.raw.clone();
  const etapa = await validarCorpo(clone, etapaSchema, '/webhook/n8n', normalizarEtapa);
  if (etapa.ok) return gravarEtapa(c, funilId, etapa.dados);
  return gravarConversa(c, funilId);
});

export default webhooks;
