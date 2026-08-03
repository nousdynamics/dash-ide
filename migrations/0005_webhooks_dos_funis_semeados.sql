-- A migration 0004 inseriu os quatro funis mas não os webhooks deles: só o
-- endpoint de criação gerava token, então os funis semeados nasceram sem link.
--
-- `hex(randomblob(32))` dá os mesmos 32 bytes aleatórios que o Worker gera com
-- crypto.getRandomValues — o SQLite tem gerador próprio, não precisa de round
-- trip pela aplicação para semear.

INSERT INTO webhooks (funil_id, canal, token)
SELECT f.id, c.canal, lower(hex(randomblob(32)))
FROM funis f
CROSS JOIN (SELECT 'rubeus' AS canal UNION ALL SELECT 'evolution' UNION ALL SELECT 'n8n') c
WHERE NOT EXISTS (
  SELECT 1 FROM webhooks w WHERE w.funil_id = f.id AND w.canal = c.canal
);
