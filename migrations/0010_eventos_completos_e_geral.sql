-- Os seis gatilhos que o Rubeus oferece, mais um webhook "geral".
--
-- O geral existe para esta fase do projeto: recebe qualquer payload, de
-- qualquer gatilho, e guarda cru. Enquanto o formato de cada evento não é
-- conhecido, recusar por schema perderia justamente o dado que ensinaria como
-- tratá-lo — e evento do CRM não é reenviado. Ele nunca devolve 400.
--
-- Inserts individuais, e não um UNION ALL: o D1 recusa compound SELECT com
-- muitos termos ("too many terms in compound SELECT").

INSERT OR IGNORE INTO webhooks (funil_id, canal, evento, token)
  VALUES (NULL, 'rubeus', 'geral', lower(hex(randomblob(32))));
INSERT OR IGNORE INTO webhooks (funil_id, canal, evento, token)
  VALUES (NULL, 'rubeus', 'contato_criacao', lower(hex(randomblob(32))));
INSERT OR IGNORE INTO webhooks (funil_id, canal, evento, token)
  VALUES (NULL, 'rubeus', 'contato_edicao', lower(hex(randomblob(32))));
INSERT OR IGNORE INTO webhooks (funil_id, canal, evento, token)
  VALUES (NULL, 'rubeus', 'atividade_criacao', lower(hex(randomblob(32))));
INSERT OR IGNORE INTO webhooks (funil_id, canal, evento, token)
  VALUES (NULL, 'rubeus', 'atividade_edicao', lower(hex(randomblob(32))));
INSERT OR IGNORE INTO webhooks (funil_id, canal, evento, token)
  VALUES (NULL, 'rubeus', 'ocorrencia_evento', lower(hex(randomblob(32))));

-- Os nomes genéricos antigos saem, para não haver dois rótulos para a mesma coisa.
DELETE FROM webhooks WHERE evento IN ('contato', 'atividade') AND total_recebido = 0;
