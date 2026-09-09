-- Descrição das métricas semeadas: acentos e a regra que passou a valer.
--
-- Duas correções no texto que aparece embaixo do número no card:
--
-- 1. A descrição do CTWA foi semeada em 0015 sem acento ("acao", "que e",
--    "conversao") e isso está na tela da diretoria desde então.
-- 2. A do Connect rate dizia "soma das ações de visualização de página", que
--    era o critério antigo — casar o NOME da ação. As ações chamadas
--    "Visualização de página" foram removidas da conta e a soma vinha zero. O
--    critério agora é categoria PAGE_VIEW + origem WEBSITE — nenhuma das duas
--    muda quando alguém renomeia a ação, e a origem é o que mantém fora as
--    "Local actions", que são visualização no Perfil da Empresa, não na landing.
--
-- Os dois textos também encurtam. A descrição mora dentro do card, que tem a
-- largura de uma coluna de KPI; o nome da métrica saía repetido lá dentro
-- ("... (Connect rate)") e a regra técnica cabe melhor na ajuda da base, que é
-- onde quem escreve fórmula procura.

UPDATE metricas_personalizadas
   SET descricao = 'Cliques que chegaram a carregar uma página do site.'
 WHERE nome = 'Connect rate';

UPDATE metricas_personalizadas
   SET descricao = 'Cliques que abriram conversa no WhatsApp — a maior fonte de conversão primária da conta.'
 WHERE nome = 'Conversas por clique (CTWA)';
