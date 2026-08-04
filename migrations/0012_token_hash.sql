-- Token de webhook passa a ser guardado só como hash SHA-256.
--
-- Em texto claro, quem tivesse o banco — dump, backup, uma consulta de rotina —
-- saía com a credencial de escrita de todos os funis. Com hash, dá para conferir
-- um token apresentado, mas não para recuperá-lo: o D1 deixa de conter segredo.
--
-- ATENÇÃO À ORDEM. Esta migration só ADICIONA a coluna. Os tokens que já estão
-- configurados no Rubeus precisam ser convertidos ANTES de a 0013 apagar a
-- coluna antiga, senão os links em produção morrem todos de uma vez:
--
--   npm run db:remote               (aplica só até esta)
--   node scripts/hash-tokens.mjs --remote
--   npm run db:remote               (aí sim a 0013)
--
-- Num banco novo não há o que converter: as linhas semeadas nascem sem link e
-- o painel gera o primeiro sob demanda.

ALTER TABLE webhooks ADD COLUMN token_hash TEXT;

-- Único, mas aceitando vários NULL: no SQLite dois NULL não colidem, então
-- webhook ainda sem link não impede outro de existir.
CREATE UNIQUE INDEX idx_webhooks_token_hash ON webhooks (token_hash);
