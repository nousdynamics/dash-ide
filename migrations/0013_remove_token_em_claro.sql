-- Apaga a coluna com o token em claro.
--
-- Rebuild da tabela em vez de DROP COLUMN: `token` é UNIQUE e tem índice
-- próprio, e o SQLite recusa remover coluna nessa condição.
--
-- Só rode depois de `node scripts/hash-tokens.mjs` — ver o cabeçalho da 0012.

CREATE TABLE webhooks_novo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  funil_id INTEGER REFERENCES funis(id) ON DELETE CASCADE,
  canal TEXT NOT NULL,
  evento TEXT,
  -- Nulo enquanto ninguém gerou o link. É estado legítimo, não pendência:
  -- o funil existe, o canal existe, a credencial ainda não foi emitida.
  token_hash TEXT UNIQUE,
  criado_em TEXT DEFAULT (datetime('now')),
  ultimo_uso_em TEXT,
  total_recebido INTEGER NOT NULL DEFAULT 0
);

INSERT INTO webhooks_novo (id, funil_id, canal, evento, token_hash, criado_em, ultimo_uso_em, total_recebido)
SELECT id, funil_id, canal, evento, token_hash, criado_em, ultimo_uso_em, total_recebido FROM webhooks;

DROP TABLE webhooks;
ALTER TABLE webhooks_novo RENAME TO webhooks;

CREATE UNIQUE INDEX idx_webhooks_funil_canal ON webhooks (funil_id, canal, evento);
