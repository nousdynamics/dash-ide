-- O que a conferência com o Rubeus aprende sobre cada ficha (registro).
--
-- O kanban do Rubeus filtra pela data de CRIAÇÃO da ficha e não mostra ficha
-- excluída. O painel só via a data do primeiro aviso que chegou e não tinha
-- como saber de exclusão: no Pós de setembro, 13 fichas que o Rubeus já
-- apagou ("Registro inexistente!") seguiam contando, a maioria em Inscrito
-- Parcial. `/api/Registro/dados` devolve `momentoCriacao` e diz quando a ficha
-- não existe; esta tabela guarda as duas coisas para o kanban do painel usar.
CREATE TABLE IF NOT EXISTS fichas_rubeus (
  registro     TEXT PRIMARY KEY,
  processo_id  TEXT,
  criado_em    TEXT,                 -- ISO UTC, do momentoCriacao (Brasília)
  etapa        TEXT,
  excluida     INTEGER NOT NULL DEFAULT 0,
  conferido_em TEXT NOT NULL DEFAULT (datetime('now'))
);
