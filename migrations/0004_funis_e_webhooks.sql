-- Registro de funis e das credenciais de webhook por funil × canal.
--
-- Por que o funil precisa de registro, se `leads_etapa` já traz processo_id:
-- a URL do webhook tem de existir ANTES de qualquer evento chegar. Sem tabela,
-- não há como gerar o link do funil novo.
--
-- Por que as ETAPAS não são registradas aqui: o Rubeus é a fonte da verdade
-- delas e cada processo usa um conjunto diferente. Uma lista manual paralela
-- vira uma segunda verdade que diverge no primeiro rename feito lá. As etapas
-- são descobertas a partir de `leads_etapa` e ordenadas por contatos distintos
-- em ordem decrescente — que é a própria semântica de funil.

CREATE TABLE funis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,        -- entra na URL do webhook
  processo_id TEXT,                 -- id do processo no Rubeus, quando conhecido
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT DEFAULT (datetime('now'))
);

CREATE TABLE webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  funil_id INTEGER NOT NULL REFERENCES funis(id) ON DELETE CASCADE,
  canal TEXT NOT NULL,              -- 'rubeus' | 'evolution' | 'n8n'
  token TEXT NOT NULL UNIQUE,       -- opaco; nunca renderizado, só copiado sob demanda
  criado_em TEXT DEFAULT (datetime('now')),
  ultimo_uso_em TEXT,               -- alimenta o "recebeu evento?" da tela
  total_recebido INTEGER NOT NULL DEFAULT 0,
  UNIQUE (funil_id, canal)
);
CREATE INDEX idx_webhooks_token ON webhooks (token);

-- `funil_id` em leads_etapa permite separar o dado por funil sem depender de
-- casar processo_id, que nem sempre vem preenchido.
ALTER TABLE leads_etapa ADD COLUMN funil_id INTEGER;
CREATE INDEX idx_leads_etapa_funil ON leads_etapa (funil_id, etapa);

ALTER TABLE conversas_whatsapp ADD COLUMN funil_id INTEGER;

-- Os quatro funis que existem hoje no Rubeus.
INSERT INTO funis (nome, slug) VALUES
  ('Qualificação de Leads', 'qualificacao-de-leads'),
  ('Graduação', 'graduacao'),
  ('Pós-Graduação', 'pos-graduacao'),
  ('Curta e média duração', 'curta-e-media-duracao');
