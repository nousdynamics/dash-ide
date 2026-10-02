-- Quando cada contato teve as fichas conferidas no Rubeus.
--
-- Nem toda ficha chega por webhook: a SARA e a MARIA LUCIANA tinham ficha nova
-- no Pós (93209 e 92774, em "Aptos para a matrícula" no kanban) sem nenhum
-- aviso de criação no painel — os eventos delas ficavam sem ficha, ou caíam na
-- ficha de 2023. `/api/Contato/listarOportunidades` lista as fichas do contato;
-- esta tabela evita perguntar de novo pelo mesmo contato a cada rodada.
CREATE TABLE IF NOT EXISTS contatos_conferidos (
  contato_id   TEXT PRIMARY KEY,
  conferido_em TEXT NOT NULL DEFAULT (datetime('now'))
);
