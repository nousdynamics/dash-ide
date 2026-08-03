-- O webhook do Rubeus é por TIPO DE EVENTO, não por funil.
--
-- A tela "Definição de webhooks" cadastra um gatilho por evento — criação de
-- contato, novo registro de processo, criação de atividade — e o funil vem
-- dentro do corpo. Amarrar a credencial ao funil, como estava, obrigaria um
-- webhook por funil que o Rubeus não tem como emitir.
--
-- `funil_id` vira nullable em webhooks: um webhook de evento não pertence a
-- funil nenhum. O funil de cada lead passa a ser resolvido pelo processo que
-- vem no payload, casando com `funis.processo_id` ou pelo nome.

CREATE TABLE webhooks_novo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  funil_id INTEGER REFERENCES funis(id) ON DELETE CASCADE,
  canal TEXT NOT NULL,
  evento TEXT,                      -- 'registro_processo' | 'contato' | 'atividade' | NULL
  token TEXT NOT NULL UNIQUE,
  criado_em TEXT DEFAULT (datetime('now')),
  ultimo_uso_em TEXT,
  total_recebido INTEGER NOT NULL DEFAULT 0
);
INSERT INTO webhooks_novo (id, funil_id, canal, token, criado_em, ultimo_uso_em, total_recebido)
  SELECT id, funil_id, canal, token, criado_em, ultimo_uso_em, total_recebido FROM webhooks;
DROP TABLE webhooks;
ALTER TABLE webhooks_novo RENAME TO webhooks;
CREATE INDEX idx_webhooks_token ON webhooks (token);
CREATE UNIQUE INDEX idx_webhooks_funil_canal ON webhooks (funil_id, canal, evento);

-- Webhooks por evento, sem funil, um por tipo que o Rubeus emite.
INSERT INTO webhooks (funil_id, canal, evento, token)
SELECT NULL, 'rubeus', e.evento, lower(hex(randomblob(32)))
FROM (SELECT 'registro_processo' AS evento UNION ALL
      SELECT 'contato' UNION ALL SELECT 'atividade') e;

-- `processo_id` do Rubeus nos funis, para casar o payload com o funil certo.
UPDATE funis SET processo_id = NULL WHERE processo_id = '';
