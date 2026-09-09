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
-- O nome da métrica também saía repetido dentro da própria descrição
-- ("... (Connect rate)"), logo abaixo do título "Connect rate".

UPDATE metricas_personalizadas
   SET descricao = 'Cliques que geraram visualização de página no site. Soma as ações de conversão de categoria PAGE_VIEW e origem WEBSITE.'
 WHERE nome = 'Connect rate';

UPDATE metricas_personalizadas
   SET descricao = 'Cliques que dispararam a ação CTWA, que é a maior fonte de conversão primária da conta.'
 WHERE nome = 'Conversas por clique (CTWA)';
