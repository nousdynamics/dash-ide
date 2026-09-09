-- Saem do painel as duas métricas que vieram semeadas.
--
-- Connect rate nunca teve o que medir nesta conta: ele é visualização de página
-- do site ÷ cliques, e as ações de conversão que contariam essa visualização
-- estão REMOVED no Google Ads desde antes do painel existir. O que sobrou com
-- categoria PAGE_VIEW é "Local actions - Menu views", que é o Perfil da Empresa
-- e não a landing. A métrica passava meses exibindo "0%" — número com cara de
-- resultado onde não havia medição (ver 0034 e src/routes/ads.ts).
--
-- CTWA saiu junto por decisão de quem lê o painel: conversas por clique já sai
-- da leitura das conversões primárias, e um card a menos é uma conta a menos
-- para conferir.
--
-- O recurso continua de pé — tabela, rota e editor. Some o conteúdo semeado,
-- não a possibilidade de montar métrica. Quem quiser o Connect rate de volta
-- recria pelo próprio painel no dia em que o site voltar a medir página; a
-- fórmula está no histórico, em 0015.
DELETE FROM metricas_personalizadas
 WHERE nome IN ('Connect rate', 'Conversas por clique (CTWA)');
