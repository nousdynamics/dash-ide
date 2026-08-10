-- Segunda fonte de categoria: o funil por onde o webhook entrou.
--
-- Em agosto, 39 pessoas chegaram a inscrição ou matrícula e só 12 tinham curso
-- em algum evento. As outras 27 caíam todas em "sem curso identificado" — 72%
-- da tabela num balde só, com o funil ao lado dizendo 4 e 2 e 1. Fecha com o
-- total, e não serve para nada.
--
-- Mas o curso não é o único sinal. As 39 têm `funil_id`, e os funis cadastrados
-- são a própria taxonomia:
--
--   Pós-Graduação            25 pessoas
--   Curta e média duração     9
--   Graduação                 4
--   Qualificação de Leads     1
--
-- Isso não é inferência do painel: é a configuração que o próprio time fez no
-- Rubeus, um webhook por funil. Quem entrou pelo webhook de "Curta e média
-- duração" está em curta duração, com ou sem curso no payload.
--
-- O que o funil NÃO resolve é o detalhe dentro da família. "Pós-Graduação" não
-- diz se é presencial, EAD ou medicina, e "Graduação" não diz se é psicologia,
-- estética ou RH. Nesses casos o fallback fica nulo de propósito e a pessoa
-- continua fora das 7 categorias — mas passa a ser contada sob o nome do funil,
-- que é informação de verdade, em vez de "sem curso identificado".
--
-- Preencher só onde o funil determina UMA categoria é a regra. No dia em que
-- existir um funil por curso, é só acrescentar a linha aqui.

ALTER TABLE funis ADD COLUMN categoria_fallback TEXT;

UPDATE funis SET categoria_fallback = 'curta_duracao'
 WHERE nome LIKE 'Curta%dura%';
