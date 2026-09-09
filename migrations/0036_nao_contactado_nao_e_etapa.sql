-- "Não contactado" sai da contagem — sem apagar uma linha sequer.
--
-- Nunca foi etapa do Rubeus. É o `resumoAtualNome` da oportunidade — o
-- andamento do contato com a pessoa — que a lista de apelidos de `etapa`
-- aceitava por engano. O payload que a criava é de ATIVIDADE, não de passagem:
--
--   "atividade": "Parcial passo 2 - 8 dias - Entrar em contato (...)",
--   "oportunidades": [{ "resumoAtual": "1", "resumoAtualNome": "Não contactado" }]
--
-- Três coisas denunciavam: aparecia nos processos 0, 1, 2, 3 e 4 ao mesmo tempo
-- (etapa de funil não mora em cinco funis); era a ÚNICA linha do banco sem
-- `etapa_id`, porque resumo não tem id de etapa; e as passagens dela vinham com
-- `status` preenchido, enquanto toda etapa real vem com `status` nulo.
--
-- Efeito prático: o funil conta cada pessoa uma vez, na etapa mais alta, então
-- quem já tinha etapa real nunca foi contado errado. O estrago eram as 317
-- pessoas cuja ÚNICA passagem era esta — entravam como "Qualificados" sem
-- ninguém ter falado com elas.
--
-- A origem já está fechada em src/lib/schemas.ts (apelidos removidos) e em
-- src/lib/rubeus.ts (etapa sem id nasce sem macro, em quarentena).
--
-- ORDEM IMPORTA: rode `node scripts/reorganizar-nao-contactado.mjs --remote
-- --aplicar` ANTES desta migration. É ele que pergunta ao Rubeus em que etapa
-- essas pessoas realmente estão e grava essas passagens. Aplicar isto primeiro
-- faria as 317 sumirem do funil no intervalo entre as duas coisas.
--
-- Nada é apagado: as 5.174 linhas seguem em `leads_etapa` e a etapa continua na
-- tela de Etapas, com o switch, para quem quiser reverter.

UPDATE processo_etapas
   SET macro_etapa = NULL,   -- fora do Macro consolidado
       visivel = 0           -- fora da esteira "Por processo"
 WHERE lower(etapa_nome) IN ('não contactado', 'nao contactado');
