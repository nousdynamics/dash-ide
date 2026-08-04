-- Métricas montadas por quem analisa, não por quem programa.
--
-- Toda conta tem uma conta de padaria própria — connect rate, custo por
-- conversa, lead por real investido. Cada uma dessas viraria um deploy se
-- morasse no código, e quem precisa do número não é quem faz deploy.
--
-- A fórmula é texto e é avaliada por um parser próprio, com lista fechada de
-- identificadores (src/lib/formula.ts). Nunca `eval`: fórmula é entrada de
-- usuário, e `eval` num painel autenticado é execução de código de terceiro.

CREATE TABLE metricas_personalizadas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  formula TEXT NOT NULL,
  -- 'moeda' | 'numero' | 'percentual' — decide só a formatação na tela.
  formato TEXT NOT NULL DEFAULT 'numero',
  descricao TEXT,
  -- Menor é melhor (custo): a cor do chip de variação inverte.
  inverso INTEGER NOT NULL DEFAULT 0,
  ordem INTEGER NOT NULL DEFAULT 0,
  criado_por TEXT,
  criado_em TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_metricas_nome ON metricas_personalizadas (nome);

-- Connect rate entra semeado porque foi pedido nominalmente, mas com a
-- definição visível e editável: "conversa iniciada por clique" tem mais de uma
-- leitura, e a certa é a de quem opera a conta, não a minha.
INSERT INTO metricas_personalizadas (nome, formula, formato, descricao, ordem) VALUES
  ('Connect rate', 'acao_conversation_started / cliques * 100', 'percentual',
   'Cliques que viraram conversa iniciada. Confira a definicao: usa a acao "Conversation started".', 10),
  ('Conversas por clique (CTWA)', 'acao_ctwa / cliques * 100', 'percentual',
   'Cliques que dispararam a acao CTWA, que e a maior fonte de conversao primaria da conta.', 20);
