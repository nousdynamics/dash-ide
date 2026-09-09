import { Hono } from 'hono';
import { z } from 'zod';
import { exigirAdmin } from '../lib/access';
import { colunasDoClickId } from '../lib/cliques';
import {
  CATEGORIA_EVENTO,
  METAS_GOOGLE,
  ehMetaGoogle,
  EVENTOS,
  type Evento,
  NIVEL_PADRAO,
  ROTULO_EVENTO,
  conferirDiagnosticos,
  gravarConfig,
  lerConfig,
  processarPendentes,
  subirBackup,
} from '../lib/conversoes';
import { ESCOPOS_GOOGLE, refreshTokenGuardado } from '../lib/google';
import { ErroGoogleAds, criarAcaoDeUpload, listarAcoesDeUpload } from '../lib/googleAds';
import { conferirPlanilha, criarPlanilha } from '../lib/sheets';
import type { AppEnv } from '../lib/tipos';

/**
 * Tela de conversão offline.
 *
 * Inteira administrativa, atrás do segundo nível de acesso. Não é uma tela de
 * relatório com um botão perigoso no canto: cada rota daqui muda o que o Google
 * Ads recebe, e o que o Google Ads recebe muda o lance das campanhas. Ver
 * quantas conversões subiram é assunto de quem lê o painel; decidir que
 * "Oportunidade paga" vale R$ 2.400 é assunto de quem administra a conta.
 */
const conversoes = new Hono<AppEnv>();

conversoes.use('*', exigirAdmin);

const ehEvento = (v: unknown): v is Evento => EVENTOS.includes(v as Evento);

/**
 * GET /api/conversoes — tudo que a tela precisa, numa chamada.
 *
 * Config, gatilhos, ações, o estado do campo do Rubeus e o resumo dos envios.
 * Cinco requisições separadas fariam a tela montar em pedaços e mostrarem-se
 * estados incoerentes entre si — "desligado" ao lado de "12 enviadas hoje".
 */
conversoes.get('/', async (c) => {
  const cfg = await lerConfig(c.env.DB);

  const [gatilhos, acoes, resumo, niveis, etapas, captura] = await Promise.all([
    c.env.DB.prepare(
      `SELECT g.id, g.processo_id, g.etapa_nome, g.evento, g.ativo,
              (SELECT nome FROM funis f WHERE f.processo_id = g.processo_id LIMIT 1) AS processo_nome
         FROM conversao_gatilhos g ORDER BY g.evento, g.etapa_nome`,
    ).all(),
    c.env.DB.prepare(
      `SELECT id, evento, nivel_ensino, conversion_action_id, conversion_action_nome,
              valor, moeda, ativo FROM conversao_acoes ORDER BY evento, nivel_ensino`,
    ).all(),
    c.env.DB.prepare(
      `SELECT status, COUNT(*) AS total, MAX(enviado_em) AS ultimo
         FROM conversoes_offline
        WHERE criado_em >= datetime('now', '-30 days')
        GROUP BY status ORDER BY total DESC`,
    ).all(),
    // Os níveis que a base realmente usa — a lista fixa envelheceria calada.
    c.env.DB.prepare(
      `SELECT nivel_ensino AS nivel, COUNT(*) AS cursos FROM cursos
        WHERE nivel_ensino IS NOT NULL AND nivel_ensino != ''
        GROUP BY nivel_ensino ORDER BY cursos DESC`,
    ).all(),
    // Etapas do catálogo, agrupadas por processo — é o que a tela usa para
    // mapear gatilho sem misturar Pós com Graduação.
    c.env.DB.prepare(
      `SELECT pe.processo_id, pe.etapa_nome, pe.ordem,
              COALESCE(
                (SELECT f.nome FROM funis f
                  WHERE f.processo_id = pe.processo_id AND f.ativo = 1
                  ORDER BY f.id LIMIT 1),
                pe.processo_id
              ) AS processo_nome
         FROM processo_etapas pe
        ORDER BY processo_nome COLLATE NOCASE, pe.ordem ASC, pe.etapa_nome ASC`,
    ).all(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN casado_em IS NOT NULL THEN 1 ELSE 0 END) AS casados,
              SUM(CASE WHEN escrito_no_rubeus_em IS NOT NULL THEN 1 ELSE 0 END) AS escritos,
              MAX(capturado_em) AS ultimo
         FROM cliques_capturados WHERE capturado_em >= datetime('now', '-30 days')`,
    ).first(),
  ]);

  /*
   * O estado da credencial do Google, em destaque.
   *
   * Sem o escopo `datamanager` nada é enviado — a Google Ads API recusa
   * `uploadClickConversions` para integração nova e manda usar a Data Manager
   * API, que exige esse escopo. É o primeiro diagnóstico que a tela precisa
   * dar, senão todo envio falha com 403 e a causa fica escondida no registro.
   */
  const credencial = await refreshTokenGuardado(c.env);
  const escopos = credencial?.escopo ?? '';

  const linhasEtapa = etapas.results as Array<{
    processo_id: string; etapa_nome: string; ordem: number; processo_nome: string;
  }>;
  const porProcesso = new Map<string, {
    processo_id: string; processo_nome: string; etapas: Array<{ nome: string; ordem: number }>;
  }>();
  for (const r of linhasEtapa) {
    const k = String(r.processo_id);
    if (!porProcesso.has(k)) {
      porProcesso.set(k, {
        processo_id: k,
        processo_nome: r.processo_nome || k,
        etapas: [],
      });
    }
    porProcesso.get(k)!.etapas.push({ nome: r.etapa_nome, ordem: Number(r.ordem) || 0 });
  }

  return c.json({
    google: {
      conectado: Boolean(credencial),
      tem_datamanager: escopos.includes('datamanager'),
      escopos_necessarios: ESCOPOS_GOOGLE,
    },
    config: cfg,
    eventos: EVENTOS.map((e) => ({ id: e, rotulo: ROTULO_EVENTO[e], categoria: CATEGORIA_EVENTO[e] })),
    metas_google: METAS_GOOGLE,
    nivel_padrao: NIVEL_PADRAO,
    gatilhos: gatilhos.results,
    acoes: acoes.results,
    resumo: resumo.results,
    niveis: niveis.results,
    pipelines: [...porProcesso.values()],
    captura,
    // A URL que vai na tag do site — montada a partir do host real do painel.
    script_url: `${new URL(c.req.url).origin}/coleta/ide-clique.js`,
  });
});

// ------------------------------------------------------------------ monitor

/**
 * O filtro do monitor, traduzido em `WHERE` com parâmetros.
 *
 * Uma função só, usada pelo registro, pelos agregados e pelo CSV. Escrever a
 * cláusula três vezes é como as três telas passam a discordar entre si: o total
 * do cartão deixa de bater com a contagem da tabela porque uma delas esqueceu
 * de filtrar o modo teste.
 *
 * Tudo entra por `?`. Nenhum valor da URL é concatenado — os nomes de curso e
 * de nível vêm de digitação livre no Rubeus, com aspas e tudo.
 */
type Filtro = { sql: string; params: (string | number | null)[] };

/**
 * Vários valores do mesmo filtro → cláusula `IN (?, ?, …)`, ou nada se vazia.
 *
 * Os valores chegam como parâmetros REPETIDOS (`curso=A&curso=B`), e não numa
 * string separada por vírgula. A diferença não é estilo: nome de curso vem de
 * digitação livre no Rubeus e tem vírgula — "Recurso de Glosas – Como Fazer,
 * Montar E Administrar Um Setor" viraria dois filtros que não casam com nada, e
 * a tela ficaria vazia sem explicar por quê.
 */
function listaEm(coluna: string, valores: string[] | undefined): Filtro | null {
  const vals = (valores ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 50);
  if (!vals.length) return null;
  return { sql: `${coluna} IN (${vals.map(() => '?').join(',')})`, params: vals };
}

const dataOk = (s: string | undefined): s is string => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '');

function filtrosDoPedido(
  q: (nome: string) => string | undefined,
  qs: (nome: string) => string[] | undefined,
): Filtro {
  const partes: string[] = [];
  const params: (string | number | null)[] = [];

  const junta = (f: Filtro | null) => {
    if (!f) return;
    partes.push(f.sql);
    params.push(...f.params);
  };

  /*
   * A data do evento, não a do envio.
   *
   * Quem lê o painel compara com o relatório do Google Ads, e lá a conversão
   * aparece no dia em que aconteceu. Filtrar por `enviado_em` jogaria a
   * matrícula de ontem no dia em que a fila finalmente a alcançou, e as duas
   * curvas nunca casariam. `substr` porque a coluna guarda ISO com `T` vindo do
   * webhook e sem `T` vindo do `datetime('now')`.
   */
  const de = q('de');
  const ate = q('ate');
  if (dataOk(de) && dataOk(ate)) {
    partes.push(`substr(COALESCE(ocorrido_em, criado_em), 1, 10) BETWEEN ? AND ?`);
    params.push(de, ate);
  }

  junta(listaEm('status', qs('status')));
  junta(listaEm('evento', qs('evento')));
  junta(listaEm('nivel_ensino', qs('nivel')));
  junta(listaEm('curso_nome', qs('curso')));
  junta(listaEm('processo_id', qs('processo')));
  junta(listaEm('conversion_action_id', qs('acao')));
  junta(listaEm('diagnostico', qs('diagnostico')));

  const modo = q('modo');
  if (modo === 'teste' || modo === 'real') {
    partes.push('modo = ?');
    params.push(modo);
  }

  /*
   * Como o lead foi ligado ao clique — a pergunta que decide se vale mexer no
   * formulário do site. `clique` é atribuição exata (gclid/gbraid/wbraid);
   * `aprimorada` é e-mail/telefone em hash; `nenhuma` é o lead que não pôde ser
   * atribuído de jeito nenhum, e é o número que justifica a captura no site.
   */
  const atrib = q('atribuicao');
  if (atrib === 'clique') partes.push('click_id_valor IS NOT NULL');
  else if (atrib === 'aprimorada') {
    partes.push(`click_id_valor IS NULL AND identificadores IS NOT NULL AND identificadores != ''`);
  } else if (atrib === 'nenhuma') {
    partes.push(`click_id_valor IS NULL AND (identificadores IS NULL OR identificadores = '')`);
  }

  const busca = (q('q') ?? '').trim();
  if (busca) {
    /*
     * `LIKE` com escape explícito: um `%` digitado na busca casaria com tudo, e
     * quem procura "50%" acabaria vendo o registro inteiro sem entender por quê.
     */
    const alvo = `%${busca.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    partes.push(
      `(contato_nome LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\'
        OR contato_id LIKE ? ESCAPE '\\' OR order_id LIKE ? ESCAPE '\\'
        OR curso_nome LIKE ? ESCAPE '\\')`,
    );
    params.push(alvo, alvo, alvo, alvo, alvo);
  }

  return { sql: partes.length ? `WHERE ${partes.join(' AND ')}` : '', params };
}

/** As colunas que a tabela do monitor mostra, e as que o CSV leva. */
const COLUNAS_REGISTRO = `id, order_id, request_id, contato_id, contato_nome, email, telefone,
        etapa, evento, processo_id, processo_nome, curso_id, curso_nome, nivel_ensino,
        conversion_action_id, conversion_action_nome, valor, moeda,
        click_id_tipo, identificadores, modo, status, diagnostico, diagnostico_em,
        avisos, tentativas, erro_detalhe, ocorrido_em, enviado_em, backup_em, criado_em`;

/**
 * GET /api/conversoes/registro — o histórico, lead a lead, com filtro e página.
 *
 * `total` viaja junto com os itens de propósito: sem ele a tela mostraria "60
 * conversões" quando 60 é só o tamanho da página, e o número que a pessoa
 * anotaria estaria errado.
 */
conversoes.get('/registro', async (c) => {
  const limite = Math.min(Number(c.req.query('limite')) || 50, 500);
  const pagina = Math.max(0, Number(c.req.query('pagina')) || 0);
  const f = filtrosDoPedido((n) => c.req.query(n), (n) => c.req.queries(n));

  const [itens, contagem] = await Promise.all([
    c.env.DB.prepare(
      `SELECT ${COLUNAS_REGISTRO} FROM conversoes_offline
        ${f.sql} ORDER BY id DESC LIMIT ? OFFSET ?`,
    ).bind(...f.params, limite, pagina * limite).all(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS total FROM conversoes_offline ${f.sql}`,
    ).bind(...f.params).first(),
  ]);

  return c.json({
    itens: itens.results,
    total: Number((contagem as { total: number } | null)?.total ?? 0),
    pagina,
    limite,
  });
});

/**
 * GET /api/conversoes/monitor — os números da janela filtrada, num pedido.
 *
 * Cinco recortes da mesma pergunta: quanto saiu, para onde, por qual curso, com
 * que atribuição, e o que o Google fez com isso. Separá-los em requisições
 * deixaria os cartões e a tabela discordando enquanto uma resposta ainda não
 * chegou — o tipo de incoerência que faz ninguém confiar no painel.
 *
 * As opções dos seletores vêm SEM filtro aplicado. Filtrá-las faria a opção
 * escolhida ser a única listada, e sair do filtro viraria recarregar a página.
 */
conversoes.get('/monitor', async (c) => {
  const f = filtrosDoPedido((n) => c.req.query(n), (n) => c.req.queries(n));

  /*
   * Só o que foi de fato entregue conta como enviada — em modo teste o Google
   * valida e descarta, e somar isso ao total infla o resultado com conversão
   * que nunca existiu na conta.
   */
  const ENVIADA = `status = 'enviada'`;

  const [geral, porStatus, porNivel, porCurso, porEvento, porDia, opcoes, requisicoes] =
    await Promise.all([
      c.env.DB.prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN ${ENVIADA} THEN 1 ELSE 0 END) AS enviadas,
                SUM(CASE WHEN status = 'simulada' THEN 1 ELSE 0 END) AS simuladas,
                SUM(CASE WHEN status = 'erro_api' THEN 1 ELSE 0 END) AS recusadas,
                SUM(CASE WHEN status = 'sem_identificador' THEN 1 ELSE 0 END) AS sem_identificador,
                SUM(CASE WHEN status = 'sem_acao' THEN 1 ELSE 0 END) AS sem_acao,
                SUM(CASE WHEN status = 'pendente' THEN 1 ELSE 0 END) AS pendentes,
                SUM(CASE WHEN ${ENVIADA} THEN COALESCE(valor, 0) ELSE 0 END) AS valor_enviado,
                SUM(CASE WHEN click_id_valor IS NOT NULL THEN 1 ELSE 0 END) AS com_clique,
                SUM(CASE WHEN click_id_valor IS NULL
                          AND identificadores IS NOT NULL AND identificadores != ''
                         THEN 1 ELSE 0 END) AS com_hash,
                SUM(CASE WHEN diagnostico = 'SUCCESS' THEN 1 ELSE 0 END) AS google_ok,
                SUM(CASE WHEN diagnostico = 'PARTIAL_SUCCESS' THEN 1 ELSE 0 END) AS google_parcial,
                SUM(CASE WHEN diagnostico = 'FAILED' THEN 1 ELSE 0 END) AS google_falhou,
                SUM(CASE WHEN ${ENVIADA} AND diagnostico IS NULL THEN 1 ELSE 0 END) AS google_aguardando
           FROM conversoes_offline ${f.sql}`,
      ).bind(...f.params).first(),

      c.env.DB.prepare(
        `SELECT status, COUNT(*) AS total, MAX(enviado_em) AS ultimo
           FROM conversoes_offline ${f.sql}
          GROUP BY status ORDER BY total DESC`,
      ).bind(...f.params).all(),

      // "Tipo de curso" é o nível de ensino — Pós, Graduação, Curta duração.
      c.env.DB.prepare(
        `SELECT COALESCE(NULLIF(nivel_ensino, ''), '—') AS nivel,
                COUNT(*) AS total,
                SUM(CASE WHEN ${ENVIADA} THEN 1 ELSE 0 END) AS enviadas,
                SUM(CASE WHEN ${ENVIADA} THEN COALESCE(valor, 0) ELSE 0 END) AS valor
           FROM conversoes_offline ${f.sql}
          GROUP BY nivel ORDER BY total DESC`,
      ).bind(...f.params).all(),

      c.env.DB.prepare(
        `SELECT COALESCE(NULLIF(curso_nome, ''), '—') AS curso,
                COALESCE(NULLIF(nivel_ensino, ''), '—') AS nivel,
                COUNT(*) AS total,
                SUM(CASE WHEN ${ENVIADA} THEN 1 ELSE 0 END) AS enviadas,
                SUM(CASE WHEN ${ENVIADA} THEN COALESCE(valor, 0) ELSE 0 END) AS valor
           FROM conversoes_offline ${f.sql}
          GROUP BY curso, nivel ORDER BY total DESC LIMIT 40`,
      ).bind(...f.params).all(),

      c.env.DB.prepare(
        `SELECT evento, COUNT(*) AS total,
                SUM(CASE WHEN ${ENVIADA} THEN 1 ELSE 0 END) AS enviadas,
                SUM(CASE WHEN ${ENVIADA} THEN COALESCE(valor, 0) ELSE 0 END) AS valor
           FROM conversoes_offline ${f.sql}
          GROUP BY evento ORDER BY total DESC`,
      ).bind(...f.params).all(),

      c.env.DB.prepare(
        `SELECT substr(COALESCE(ocorrido_em, criado_em), 1, 10) AS data,
                COUNT(*) AS total,
                SUM(CASE WHEN ${ENVIADA} THEN 1 ELSE 0 END) AS enviadas,
                SUM(CASE WHEN status IN ('erro_api', 'sem_identificador', 'sem_acao')
                          OR diagnostico = 'FAILED' THEN 1 ELSE 0 END) AS falhas
           FROM conversoes_offline ${f.sql}
          GROUP BY data ORDER BY data`,
      ).bind(...f.params).all(),

      /*
       * Os valores que os seletores oferecem.
       *
       * Saem do que já foi registrado, e não de uma lista fixa: um curso novo
       * aparece no filtro no dia em que a primeira conversão dele chega, sem
       * deploy. Uma lista escrita à mão envelheceria calada e esconderia
       * exatamente os cursos novos, que são os que se quer conferir.
       */
      c.env.DB.prepare(
        `SELECT DISTINCT 'nivel' AS tipo, COALESCE(NULLIF(nivel_ensino, ''), '—') AS valor,
                NULL AS extra FROM conversoes_offline
         UNION SELECT DISTINCT 'curso', COALESCE(NULLIF(curso_nome, ''), '—'),
                COALESCE(NULLIF(nivel_ensino, ''), '—') FROM conversoes_offline
         UNION SELECT DISTINCT 'processo', COALESCE(processo_id, ''),
                COALESCE(processo_nome, processo_id) FROM conversoes_offline
                WHERE processo_id IS NOT NULL
         UNION SELECT DISTINCT 'acao', conversion_action_id, conversion_action_nome
                FROM conversoes_offline WHERE conversion_action_id IS NOT NULL
         ORDER BY tipo, valor`,
      ).all(),

      // As últimas requisições e o veredito de cada uma — a saúde do transporte.
      c.env.DB.prepare(
        `SELECT request_id, conversion_action_nome, eventos, modo, status,
                erros, avisos, verificado_em, criado_em
           FROM conversao_requisicoes ORDER BY id DESC LIMIT 15`,
      ).all(),
    ]);

  const listas = opcoes.results as Array<{ tipo: string; valor: string; extra: string | null }>;
  const doTipo = (t: string) => listas.filter((l) => l.tipo === t);

  return c.json({
    geral,
    por_status: porStatus.results,
    por_nivel: porNivel.results,
    por_curso: porCurso.results,
    por_evento: porEvento.results,
    por_dia: porDia.results,
    requisicoes: requisicoes.results,
    opcoes: {
      niveis: doTipo('nivel').map((l) => l.valor),
      cursos: doTipo('curso').map((l) => ({ nome: l.valor, nivel: l.extra })),
      processos: doTipo('processo').map((l) => ({ id: l.valor, nome: l.extra || l.valor })),
      acoes: doTipo('acao').map((l) => ({ id: l.valor, nome: l.extra || l.valor })),
      eventos: EVENTOS.map((e) => ({ id: e, rotulo: ROTULO_EVENTO[e] })),
    },
  });
});

/**
 * GET /api/conversoes/registro.csv — a janela filtrada, para conferir fora.
 *
 * Existe porque conferência de verdade acontece cruzando com o relatório do
 * Google Ads numa planilha, e ninguém faz isso rolando uma tabela. É o mesmo
 * filtro da tela — o arquivo baixado é exatamente o que está na frente da
 * pessoa, não "tudo" nem "os primeiros 50".
 */
conversoes.get('/registro.csv', async (c) => {
  const f = filtrosDoPedido((n) => c.req.query(n), (n) => c.req.queries(n));
  const { results } = await c.env.DB.prepare(
    `SELECT ${COLUNAS_REGISTRO} FROM conversoes_offline ${f.sql} ORDER BY id DESC LIMIT 5000`,
  ).bind(...f.params).all();

  const linhas = results as Array<Record<string, unknown>>;
  const colunas = COLUNAS_REGISTRO.split(',').map((s) => s.trim().split(/\s+/)[0]!);

  const corpo = [
    colunas.join(','),
    ...linhas.map((l) => colunas.map((k) => csv(l[k])).join(',')),
  ].join('\r\n');

  return c.body(`﻿${corpo}`, 200, {
    // BOM acima: sem ele o Excel em pt-BR abre "Inscrição" como "InscriÃ§Ã£o".
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="conversoes-${new Date().toISOString().slice(0, 10)}.csv"`,
  });
});

/**
 * Uma célula de CSV.
 *
 * O `'` na frente de `=`, `+`, `-` e `@` não é capricho: uma planilha trata
 * essas células como fórmula, e um nome de lead que comece com `=` viraria
 * cálculo — ou, num arquivo aberto por outra pessoa, chamada externa. O dado
 * aqui vem de digitação livre no Rubeus.
 */
function csv(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  const seguro = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${seguro.replace(/"/g, '""')}"`;
}

/**
 * POST /api/conversoes/registro/:id/reenviar — devolve UMA linha para a fila.
 *
 * Zera as tentativas de propósito: quem aperta isto acabou de corrigir a causa
 * — cadastrou a ação que faltava, arrumou o nível do curso — e a linha já podia
 * ter estourado o teto de cinco tentativas com o problema antigo.
 *
 * Não vale para o que já foi entregue: reenviar uma conversão `enviada` a
 * contaria duas vezes na conta de anúncios. O `orderId` deduplica no Google,
 * mas contar com isso seria delegar a um terceiro a proteção do número que
 * decide lance de campanha.
 */
conversoes.post('/registro/:id/reenviar', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ erro: 'id_invalido' }, 400);

  const linha = await c.env.DB.prepare(
    'SELECT status FROM conversoes_offline WHERE id = ?',
  ).bind(id).first() as { status: string } | null;

  if (!linha) return c.json({ erro: 'nao_encontrada' }, 404);
  if (linha.status === 'enviada') {
    return c.json({
      erro: 'ja_enviada',
      detalhe: 'Esta conversão já foi entregue ao Google. Reenviar contaria a mesma matrícula duas vezes.',
    }, 409);
  }

  await c.env.DB.prepare(
    `UPDATE conversoes_offline SET
       status = 'pendente', tentativas = 0, erro_detalhe = NULL,
       diagnostico = NULL, diagnostico_em = NULL, request_id = NULL
     WHERE id = ?`,
  ).bind(id).run();

  const cfg = await lerConfig(c.env.DB);
  if (!cfg.ligado) {
    return c.json({ ok: true, processado: false, detalhe: 'Devolvida à fila; o envio está desligado.' });
  }

  const r = await processarPendentes(c.env, cfg, 1);
  return c.json({ ok: true, processado: true, ...r });
});

/**
 * POST /api/conversoes/diagnosticos — pergunta ao Google agora, sem o cron.
 *
 * O uso normal é meia hora depois de um envio, para ver o veredito sem esperar
 * a passada automática.
 */
conversoes.post('/diagnosticos', async (c) => {
  const r = await conferirDiagnosticos(c.env, 30);
  return c.json({ ok: true, ...r });
});

/**
 * GET /api/conversoes/acoes-google — as ações de upload que existem na conta.
 *
 * Consultado ao vivo, e não guardado no D1: uma ação pausada ou removida no
 * Google continuaria aparecendo aqui como opção válida, e o erro só surgiria no
 * envio, dias depois, longe de quem escolheu.
 */
conversoes.get('/acoes-google', async (c) => {
  try {
    return c.json({ itens: await listarAcoesDeUpload(c.env) });
  } catch (e) {
    const msg = e instanceof ErroGoogleAds ? e.message : 'falha ao consultar o Google Ads';
    return c.json({ erro: msg }, 502);
  }
});

const novaAcaoGoogleSchema = z.object({
  nome: z.string().min(3).max(80),
  evento: z.string().refine(ehEvento, 'evento desconhecido'),
  /** Meta do Google Ads (ConversionActionCategory). Se omitida, usa a sugerida do evento. */
  categoria: z.string().refine(ehMetaGoogle, 'meta desconhecida').optional(),
});

/**
 * POST /api/conversoes/acoes-google — cria a ação de conversão na conta.
 *
 * Escrita real na conta de anúncios, disparada por clique explícito de quem
 * administra. Nome e meta vêm da tela — o evento só sugere a meta padrão.
 */
conversoes.post('/acoes-google', async (c) => {
  const r = novaAcaoGoogleSchema.safeParse(await c.req.json().catch(() => null));
  if (!r.success) return c.json({ erro: 'schema_invalido', detalhe: r.error.issues }, 400);

  const categoria = r.data.categoria
    ?? CATEGORIA_EVENTO[r.data.evento as Evento];

  try {
    const criada = await criarAcaoDeUpload(c.env, {
      nome: r.data.nome,
      categoria,
    });
    console.log(JSON.stringify({
      evento: 'acao_conversao_criada', id: criada.id, nome: r.data.nome,
      categoria, por: c.get('usuarioEmail') ?? '?',
    }));
    return c.json({ ok: true, ...criada }, 201);
  } catch (e) {
    return c.json({ erro: e instanceof ErroGoogleAds ? e.message : String(e) }, 502);
  }
});

// ------------------------------------------------------------------ gatilhos

const gatilhoSchema = z.object({
  etapa_nome: z.string().min(1).max(120),
  evento: z.string().refine(ehEvento, 'evento desconhecido'),
  processo_id: z.string().nullish(),
  ativo: z.boolean().default(true),
});

/** POST /api/conversoes/gatilhos — cria ou atualiza a regra de uma etapa. */
conversoes.post('/gatilhos', async (c) => {
  const r = gatilhoSchema.safeParse(await c.req.json().catch(() => null));
  if (!r.success) return c.json({ erro: 'schema_invalido', detalhe: r.error.issues }, 400);
  const d = r.data;

  await c.env.DB.prepare(
    `INSERT INTO conversao_gatilhos (processo_id, etapa_nome, evento, ativo, criado_por)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (COALESCE(processo_id, ''), etapa_nome) DO UPDATE SET
       evento = excluded.evento, ativo = excluded.ativo`,
  ).bind(d.processo_id ?? null, d.etapa_nome, d.evento, d.ativo ? 1 : 0, c.get('usuarioEmail') ?? null)
    .run();

  console.log(JSON.stringify({
    evento: 'gatilho_salvo', etapa: d.etapa_nome, gatilho: d.evento, ativo: d.ativo,
    por: c.get('usuarioEmail') ?? '?',
  }));
  return c.json({ ok: true }, 201);
});

conversoes.delete('/gatilhos/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM conversao_gatilhos WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// --------------------------------------------------------------------- ações

const acaoSchema = z.object({
  evento: z.string().refine(ehEvento, 'evento desconhecido'),
  nivel_ensino: z.string().min(1).max(120),
  conversion_action_id: z.string().regex(/^\d+$/, 'id da ação deve ser numérico'),
  conversion_action_nome: z.string().nullish(),
  valor: z.coerce.number().min(0).max(1_000_000).default(0),
  moeda: z.string().length(3).default('BRL'),
  ativo: z.boolean().default(true),
});

/** POST /api/conversoes/acoes — liga evento × nível a uma ação, com valor. */
conversoes.post('/acoes', async (c) => {
  const r = acaoSchema.safeParse(await c.req.json().catch(() => null));
  if (!r.success) return c.json({ erro: 'schema_invalido', detalhe: r.error.issues }, 400);
  const d = r.data;

  await c.env.DB.prepare(
    `INSERT INTO conversao_acoes
       (evento, nivel_ensino, conversion_action_id, conversion_action_nome, valor, moeda, ativo, atualizado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (evento, nivel_ensino) DO UPDATE SET
       conversion_action_id = excluded.conversion_action_id,
       conversion_action_nome = excluded.conversion_action_nome,
       valor = excluded.valor,
       moeda = excluded.moeda,
       ativo = excluded.ativo,
       atualizado_em = datetime('now'),
       atualizado_por = excluded.atualizado_por`,
  ).bind(
    d.evento, d.nivel_ensino, d.conversion_action_id, d.conversion_action_nome ?? null,
    d.valor, d.moeda.toUpperCase(), d.ativo ? 1 : 0, c.get('usuarioEmail') ?? null,
  ).run();

  console.log(JSON.stringify({
    evento: 'acao_conversao_salva', gatilho: d.evento, nivel: d.nivel_ensino,
    valor: d.valor, por: c.get('usuarioEmail') ?? '?',
  }));
  return c.json({ ok: true }, 201);
});

conversoes.delete('/acoes/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM conversao_acoes WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// -------------------------------------------------------------------- config

const configSchema = z.object({
  ligado: z.boolean().optional(),
  modo: z.enum(['teste', 'real']).optional(),
  janela_dias: z.coerce.number().int().min(1).max(90).optional(),
  captura_ligada: z.boolean().optional(),
  escrever_no_rubeus: z.boolean().optional(),
  origens_permitidas: z.string().max(500).optional(),
  consentimento: z.enum(['nao_informado', 'concedido', 'negado']).optional(),
});

conversoes.put('/config', async (c) => {
  const r = configSchema.safeParse(await c.req.json().catch(() => null));
  if (!r.success) return c.json({ erro: 'schema_invalido', detalhe: r.error.issues }, 400);

  const valores: Record<string, string> = {};
  const d = r.data;
  if (d.ligado !== undefined) valores.ligado = d.ligado ? '1' : '0';
  if (d.modo !== undefined) valores.modo = d.modo;
  if (d.janela_dias !== undefined) valores.janela_dias = String(d.janela_dias);
  if (d.captura_ligada !== undefined) valores.captura_ligada = d.captura_ligada ? '1' : '0';
  if (d.escrever_no_rubeus !== undefined) valores.escrever_no_rubeus = d.escrever_no_rubeus ? '1' : '0';
  if (d.origens_permitidas !== undefined) valores.origens_permitidas = d.origens_permitidas;
  if (d.consentimento !== undefined) valores.consentimento = d.consentimento;

  await gravarConfig(c.env.DB, valores, c.get('usuarioEmail'));
  console.log(JSON.stringify({
    evento: 'conversao_config_alterada', mudou: Object.keys(valores),
    por: c.get('usuarioEmail') ?? '?',
  }));
  return c.json({ ok: true, config: await lerConfig(c.env.DB) });
});

// ------------------------------------------------------------------ planilha

/** POST /api/conversoes/planilha — cria a planilha de backup no Drive. */
conversoes.post('/planilha', async (c) => {
  const cfg = await lerConfig(c.env.DB);
  if (cfg.planilhaId) {
    const estado = await conferirPlanilha(c.env, cfg.planilhaId, cfg.planilhaAba);
    if (estado.ok) return c.json({ ok: true, ja_existia: true, url: cfg.planilhaUrl ?? estado.url });
  }

  try {
    const nova = await criarPlanilha(c.env, 'Backup de conversões — Faculdade IDE');
    await gravarConfig(c.env.DB, {
      planilha_id: nova.id,
      planilha_aba: nova.aba,
      planilha_url: nova.url,
    }, c.get('usuarioEmail'));
    /*
     * A planilha nasce visível só para a conta que a criou — a mesma do OAuth do
     * Google Ads. Compartilhar por API exigiria escopo de permissão e decidir
     * com quem, o que é escolha de quem administra, não do código.
     */
    return c.json({ ok: true, url: nova.url, id: nova.id }, 201);
  } catch (e) {
    return c.json({ erro: String(e) }, 502);
  }
});

/** GET /api/conversoes/planilha — a planilha configurada ainda responde? */
conversoes.get('/planilha', async (c) => {
  const cfg = await lerConfig(c.env.DB);
  if (!cfg.planilhaId) return c.json({ configurada: false });
  const estado = await conferirPlanilha(c.env, cfg.planilhaId, cfg.planilhaAba);
  return c.json({ configurada: true, url: cfg.planilhaUrl, aba: cfg.planilhaAba, ...estado });
});

// ------------------------------------------------------------ campo do Rubeus

/**
 * GET /api/conversoes/campo-rubeus — o campo de click id já existe no CRM?
 *
 * `?forcar=1` refaz a descoberta ignorando o que está guardado. É o botão que
 * se aperta logo depois de criar o campo no Rubeus, para não ter de esperar
 * cache nenhum vencer.
 */
conversoes.get('/campo-rubeus', async (c) => {
  try {
    const colunas = await colunasDoClickId(c.env, c.req.query('forcar') === '1');
    return c.json({
      colunas,
      encontrado: Object.values(colunas).some(Boolean),
    });
  } catch (e) {
    return c.json({ erro: String(e) }, 502);
  }
});

// ------------------------------------------------------------ reprocessamento

/**
 * POST /api/conversoes/processar — roda a fila agora, sem esperar o cron.
 *
 * O uso normal é depois de mexer no mapa: cadastrou a ação que faltava, aperta
 * aqui e as linhas marcadas "sem_acao" saem na hora, em vez de amanhã.
 */
conversoes.post('/processar', async (c) => {
  const cfg = await lerConfig(c.env.DB);
  if (!cfg.ligado) return c.json({ erro: 'desligado', detalhe: 'ligue o envio antes de processar a fila' }, 409);

  const r = await processarPendentes(c.env, cfg, 60);
  const backup = await subirBackup(c.env, cfg);
  return c.json({ ok: true, ...r, backup: backup.linhas });
});

export default conversoes;
