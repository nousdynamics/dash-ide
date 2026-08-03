-- Diário de bordo dos webhooks.
--
-- Sem isso, um payload com nome de campo diferente do esperado devolve 400 e
-- some: quem configurou o fluxo no Rubeus não tem como saber o que chegou nem
-- por que foi recusado. Guardar o corpo cru dos últimos eventos transforma
-- "não está funcionando" em "chegou assim, faltou tal campo".
--
-- Retenção curta de propósito: o corpo pode conter nome e telefone de lead, e
-- isso não precisa viver no D1 além do tempo de diagnosticar a integração. A
-- limpeza roda a cada gravação, mantendo as 50 últimas por webhook.

CREATE TABLE eventos_recebidos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  webhook_id INTEGER REFERENCES webhooks(id) ON DELETE CASCADE,
  canal TEXT,
  funil_slug TEXT,
  status TEXT NOT NULL,          -- 'aceito' | 'schema_invalido' | 'corpo_invalido'
  detalhe TEXT,                  -- por que recusou, quando recusou
  corpo TEXT,                    -- payload cru, truncado
  recebido_em TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_eventos_recebidos ON eventos_recebidos (webhook_id, recebido_em DESC);
