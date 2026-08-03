-- Remove os webhooks de evento que o Rubeus permite escopar por funil.
--
-- "Novo registro de processo" e "Ocorrência de um evento" são os dois gatilhos
-- em que a tela do Rubeus deixa escolher o processo. Para esses, o link por
-- funil separa a origem e é o que será usado — manter também a versão geral
-- deles só ofereceria dois caminhos para a mesma coisa, e duas formas de
-- configurar errado.
--
-- Os demais gatilhos não têm seletor de funil e continuam precisando da URL
-- por evento.

DELETE FROM webhooks
 WHERE funil_id IS NULL
   AND evento IN ('registro_processo', 'ocorrencia_evento');
