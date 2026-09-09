-- Meta do Google por OFERTA de curso, não só por nível de ensino.
--
-- A tabela mirava um alvo só: nível de ensino, com o curinga para o resto. Isso
-- basta para separar Pós de Graduação, e não basta para o que a operação faz na
-- prática: um MBA caro e um curso de curta duração de R$ 300 caem no mesmo
-- balde e sobem com o mesmo valor, então o Smart Bidding passa a perseguir os
-- dois pelo mesmo preço.
--
-- Em vez de acrescentar uma coluna por dimensão nova, o alvo virou um par
-- (escopo, alvo). Quatro escopos, do mais específico para o mais geral:
--
--   oferta  — o código da oferta do Rubeus (turma/campus/semestre)
--   curso   — o curso-pai, valendo para todas as ofertas dele
--   nivel   — o nível de ensino, que é o que existia
--   geral   — o curinga, que era o `nivel_ensino = '*'`
--
-- `acaoDoEvento` resolve nessa ordem e para na primeira que casar. Acrescentar
-- uma dimensão amanhã — modalidade, unidade — é uma linha no CASE, não uma
-- migration de coluna.

-- ------------------------------------------------ a oferta na conversão
--
-- `conversoes_offline` guardava curso e nível, nunca a oferta, então não havia
-- contra o que casar uma regra por oferta. As colunas vão para cá e não para um
-- join com `leads_etapa` porque esta tabela é o registro do que FOI ENVIADO:
-- precisa continuar dizendo a verdade depois que o cadastro mudar no Rubeus.

ALTER TABLE conversoes_offline ADD COLUMN oferta_codigo TEXT;
ALTER TABLE conversoes_offline ADD COLUMN oferta_nome TEXT;
ALTER TABLE conversoes_offline ADD COLUMN curso_codigo TEXT;

-- ------------------------------------------------ a tabela de ações
--
-- Reconstrução, não ALTER. O SQLite não remove constraint, e a antiga
-- `UNIQUE (evento, nivel_ensino)` impediria justamente o que esta migration
-- existe para permitir: duas regras do mesmo evento e do mesmo nível apontando
-- para ofertas diferentes.

CREATE TABLE conversao_acoes_novo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evento TEXT NOT NULL,

  /* 'oferta' | 'curso' | 'nivel' | 'geral' — ver a ordem de resolução acima. */
  escopo TEXT NOT NULL DEFAULT 'nivel',

  /*
   * O valor do alvo, conforme o escopo: código da oferta, id ou código do
   * curso, nome do nível. NULL apenas quando o escopo é 'geral'.
   */
  alvo TEXT,

  /*
   * Como o alvo se chama, congelado no momento em que a regra foi criada.
   *
   * Sem isto a tela precisaria juntar catálogo a cada carga só para escrever
   * "MBA em Gestão" ao lado de um código — e a regra de uma oferta que saiu do
   * catálogo apareceria como um número solto, sem ninguém conseguir dizer o que
   * ela mira nem se pode ser removida.
   */
  alvo_rotulo TEXT,

  conversion_action_id TEXT NOT NULL,
  conversion_action_nome TEXT,
  valor REAL NOT NULL DEFAULT 0,
  moeda TEXT NOT NULL DEFAULT 'BRL',
  ativo INTEGER NOT NULL DEFAULT 1,
  atualizado_em TEXT DEFAULT (datetime('now')),
  atualizado_por TEXT
);

/*
 * O que existia vira escopo de nível, e o curinga vira 'geral'.
 *
 * `nivel_ensino = '*'` era um valor sentinela dentro de uma coluna de dados —
 * funcionava, mas obrigava todo SELECT a saber que aquele asterisco não é um
 * nível. Com o escopo explícito, o curinga deixa de precisar de disfarce.
 */
INSERT INTO conversao_acoes_novo (
  id, evento, escopo, alvo, alvo_rotulo,
  conversion_action_id, conversion_action_nome, valor, moeda, ativo,
  atualizado_em, atualizado_por
)
SELECT
  id, evento,
  CASE WHEN nivel_ensino = '*' THEN 'geral' ELSE 'nivel' END,
  CASE WHEN nivel_ensino = '*' THEN NULL ELSE nivel_ensino END,
  CASE WHEN nivel_ensino = '*' THEN NULL ELSE nivel_ensino END,
  conversion_action_id, conversion_action_nome, valor, moeda, ativo,
  atualizado_em, atualizado_por
FROM conversao_acoes;

DROP TABLE conversao_acoes;

ALTER TABLE conversao_acoes_novo RENAME TO conversao_acoes;

/*
 * Uma regra por (evento, escopo, alvo).
 *
 * `COALESCE` porque NULL nunca colide com NULL num índice único do SQLite, e
 * sem isso daria para cadastrar dois curingas do mesmo evento apontando para
 * ações diferentes — com o desempate saindo da ordem de inserção, que é o tipo
 * de resultado que muda sozinho no dia em que alguém mexe numa linha vizinha.
 */
CREATE UNIQUE INDEX idx_acao_alvo
  ON conversao_acoes (evento, escopo, COALESCE(alvo, ''));

/* A resolução varre por evento e escopo a cada conversão enviada. */
CREATE INDEX idx_acao_resolucao ON conversao_acoes (evento, ativo, escopo);
