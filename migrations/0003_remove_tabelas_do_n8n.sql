-- O n8n não tem conexão com esta ferramenta. As duas tabelas abaixo existiam
-- só para o que ele enviaria, e agora não têm nenhuma fonte:
--
--   metricas_anuncio  -> substituída pela consulta ao vivo à API do Google Ads
--                        (src/lib/googleAds.ts). Guardar cópia diária no D1 só
--                        criaria uma segunda verdade para o mesmo número.
--   conversoes_ads    -> era alimentada pelo callback do n8n após o upload de
--                        conversão offline. Os status 'enviada' / 'sem_gclid' /
--                        'erro_api' são conhecimento do momento do upload; o
--                        Google Ads não os devolve, então não há como
--                        reconstruir esse dado por aqui.
--
-- Ambas estavam com zero linhas em produção quando esta migration foi escrita.
-- O que sobra no D1 é exatamente o que não existe em outra fonte: o funil do
-- Rubeus e as conversas da Evolution API.

DROP TABLE IF EXISTS conversoes_ads;
DROP TABLE IF EXISTS metricas_anuncio;
