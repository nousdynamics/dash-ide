-- Connect rate: cliques × visualizações de página, não conversas.
--
-- A seed em 0015 usava Conversation started ÷ cliques. A definição operacional
-- da conta é visualizações de página ÷ cliques.

UPDATE metricas_personalizadas
   SET formula = 'visualizacoes_pagina / cliques * 100',
       descricao = 'Cliques que geraram visualização de página (Connect rate). Usa a soma das ações de visualização de página do Google Ads.',
       formato = 'percentual'
 WHERE nome = 'Connect rate';
