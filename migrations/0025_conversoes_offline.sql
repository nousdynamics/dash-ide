-- Conversão offline para o Google Ads, feita pelo painel.
--
-- Substitui o fluxo "Faculdade IDE - Teste Webhook + API Rubeus" do n8n, que
-- fazia o mesmo caminho por fora: recebia o webhook do Rubeus, consultava o
-- contato, montava um ClickConversion e postava no Google Ads. Trazer para cá
-- não é gosto de arquitetura — o painel já tem o cliente do Rubeus, o cliente
-- do Google Ads com OAuth e cache, o D1 e o login do Access. O n8n mantinha uma
-- segunda cópia das mesmas credenciais só para repetir o percurso.
--
-- A migration 0003 apagou `conversoes_ads`, que existia para o callback do n8n
-- e nunca teve fonte. Esta tabela é outra coisa: aqui o painel é quem envia,
-- então o status é conhecimento de primeira mão, não relato de terceiro.

-- ---------------------------------------------------------------- click ids
--
-- gclid, gbraid e wbraid no lead.
--
-- O Google manda UM dos três por clique: gclid é o padrão, gbraid e wbraid
-- aparecem quando o clique tem restrição de privacidade (iOS/Safari) ou vem de
-- campanha de App. Sem nenhum deles a conversão só pode ser atribuída por
-- e-mail/telefone, então guardar os três é o que separa "não veio" de "nunca
-- foi perguntado".
ALTER TABLE leads_etapa ADD COLUMN gclid TEXT;
ALTER TABLE leads_etapa ADD COLUMN gbraid TEXT;
ALTER TABLE leads_etapa ADD COLUMN wbraid TEXT;

-- ---------------------------------------------------------------- gatilhos
--
-- Qual etapa do Rubeus vira qual evento do Google Ads.
--
-- Não dá para inferir do nome: em Pós-Graduação, quem preenche o formulário cai
-- em "Oportunidade", e "Oportunidade paga" é o pagamento — mas outro processo
-- pode chamar as mesmas coisas de outro jeito. Por isso o mapa é dado, não
-- código, e mora numa tela onde dá para corrigir sem deploy.
--
-- `processo_id` NULL vale para qualquer processo, e serve de padrão quando não
-- existe uma linha específica para aquele funil.
CREATE TABLE conversao_gatilhos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  processo_id TEXT,
  etapa_nome TEXT NOT NULL,
  evento TEXT NOT NULL,             -- 'inscricao_concluida' | 'pagamento_realizado'
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT DEFAULT (datetime('now')),
  criado_por TEXT
);

-- Uma etapa dispara no máximo um evento por processo. `COALESCE` porque
-- NULL nunca colide com NULL num índice único do SQLite, e sem isso daria para
-- cadastrar a mesma regra global duas vezes com resultados diferentes.
CREATE UNIQUE INDEX idx_gatilho_unico
  ON conversao_gatilhos (COALESCE(processo_id, ''), etapa_nome);

-- ---------------------------------------------------------------- ações
--
-- Ação de conversão do Google Ads por evento × nível de ensino, com o valor.
--
-- São eventos separados por nível porque é assim que a conta mede retorno:
-- pós-graduação e curso de curta duração não valem o mesmo, e jogar tudo numa
-- ação só faria o Smart Bidding perseguir o lead mais barato.
--
-- `nivel_ensino = '*'` é o padrão de quem chegou sem nível identificado. Sem
-- ele, todo lead cujo curso o Rubeus ainda não devolveu ficaria sem envio.
--
-- O valor mora aqui e não no Rubeus por um motivo medido: `valorCurso` vem nulo
-- em todas as oportunidades e `valor` vem nulo nas 689 ofertas do catálogo. Se
-- um dia o Rubeus passar a preencher, ele vira a fonte e esta coluna vira só o
-- fallback.
CREATE TABLE conversao_acoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evento TEXT NOT NULL,
  nivel_ensino TEXT NOT NULL,       -- 'Pós-Graduação (Presencial)' | … | '*'
  conversion_action_id TEXT NOT NULL,
  conversion_action_nome TEXT,
  valor REAL NOT NULL DEFAULT 0,
  moeda TEXT NOT NULL DEFAULT 'BRL',
  ativo INTEGER NOT NULL DEFAULT 1,
  atualizado_em TEXT DEFAULT (datetime('now')),
  atualizado_por TEXT,
  UNIQUE (evento, nivel_ensino)
);

-- ---------------------------------------------------------------- registro
--
-- Uma linha por conversão que o painel tentou enviar — enviada ou não.
--
-- É o registro de origem; a planilha do Google é a cópia legível. As duas
-- existem de propósito: a planilha é para conferir e cruzar à mão, e some se
-- alguém apagar a aba; esta tabela é o que permite reenviar o que falhou.
CREATE TABLE conversoes_offline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  /*
   * Chave de idempotência, e também o `orderId` que vai para o Google.
   *
   * O Rubeus reemite o mesmo gatilho — reprocessamento, correção de cadastro,
   * o operador movendo o lead de volta e para frente. Sem isso, cada reemissão
   * viraria uma conversão nova e a conta contaria a mesma matrícula três vezes.
   * O Google também deduplica por orderId, então a proteção é dos dois lados.
   */
  order_id TEXT NOT NULL UNIQUE,

  lead_etapa_id INTEGER,
  contato_id TEXT NOT NULL,
  contato_nome TEXT,
  email TEXT,
  telefone TEXT,
  registro_processo_id TEXT,
  processo_id TEXT,
  processo_nome TEXT,
  etapa TEXT NOT NULL,
  evento TEXT NOT NULL,
  curso_id TEXT,
  curso_nome TEXT,
  nivel_ensino TEXT,

  conversion_action_id TEXT,
  conversion_action_nome TEXT,
  valor REAL,
  moeda TEXT,

  click_id_tipo TEXT,               -- 'gclid' | 'gbraid' | 'wbraid'
  click_id_valor TEXT,
  identificadores TEXT,             -- 'gclid' | 'email' | 'email+telefone' | ''

  modo TEXT NOT NULL DEFAULT 'teste',   -- 'teste' (validateOnly) | 'real'
  /*
   * 'pendente'   — reservada, ainda não tentada
   * 'enviada'    — o Google aceitou
   * 'sem_identificador' — nem click id nem e-mail/telefone: nada a atribuir
   * 'sem_acao'   — não há ação cadastrada para este evento × nível
   * 'erro_api'   — o Google recusou (detalhe em erro_detalhe)
   * 'simulada'   — modo teste: validada pelo Google, não contabilizada
   */
  status TEXT NOT NULL DEFAULT 'pendente',
  tentativas INTEGER NOT NULL DEFAULT 0,
  erro_detalhe TEXT,
  /*
   * A resposta crua do Google, truncada.
   *
   * `erro_detalhe` é a mensagem já desembrulhada do `partialFailureError`, que
   * é o que a tela mostra. Isto aqui é o corpo inteiro: quando o Google recusa
   * por um motivo que a mensagem não explica — e recusa —, é a única coisa que
   * permite descobrir o porquê sem reproduzir o envio.
   */
  resposta TEXT,

  ocorrido_em TEXT,                 -- momento da etapa; vira conversionDateTime
  enviado_em TEXT,
  backup_em TEXT,                   -- quando a linha foi para a planilha
  criado_em TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_conversoes_status ON conversoes_offline (status, criado_em);
CREATE INDEX idx_conversoes_contato ON conversoes_offline (contato_id);
-- A planilha é alimentada varrendo quem ainda não subiu.
CREATE INDEX idx_conversoes_backup ON conversoes_offline (backup_em) WHERE backup_em IS NULL;

-- ---------------------------------------------------------------- config
--
-- Chave/valor porque são poucos ajustes e todos mudam pela tela, não por
-- deploy: o interruptor geral, o modo teste, a planilha de backup e a janela de
-- reenvio. Uma coluna por ajuste viraria uma migration a cada botão novo.
CREATE TABLE conversao_config (
  chave TEXT PRIMARY KEY,
  valor TEXT,
  atualizado_em TEXT DEFAULT (datetime('now')),
  atualizado_por TEXT
);

/*
 * Nasce desligada e em modo teste.
 *
 * O primeiro envio real mexe no número que decide lance de campanha. Errar o
 * mapa de etapas e descobrir depois que a conta passou uma semana otimizando
 * para "Oportunidade" achando que era pagamento é caro e silencioso — então o
 * padrão é o lado seguro, e ligar é uma decisão explícita de quem administra.
 */
INSERT INTO conversao_config (chave, valor) VALUES
  ('ligado', '0'),
  ('modo', 'teste'),
  ('janela_dias', '30');

/*
 * Semente do mapa de etapas, a partir do que o funil já usa hoje.
 *
 * `processo_id` NULL: vale para todos os processos até alguém cadastrar uma
 * regra específica. São exatamente as duas etapas descritas — o lead cai em
 * "Oportunidade" ao preencher o formulário e vira "Oportunidade paga" quando
 * paga. Vem desativada: gatilho é decisão de quem administra, e a tela mostra
 * a sugestão pronta para ligar em vez de fazer adivinhar o nome exato.
 */
INSERT INTO conversao_gatilhos (processo_id, etapa_nome, evento, ativo) VALUES
  (NULL, 'Oportunidade', 'inscricao_concluida', 0),
  (NULL, 'Oportunidade paga', 'pagamento_realizado', 0);
