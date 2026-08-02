-- Adição sobre o schema da seção 4 do plano (que não previa o nome do lead em
-- nenhuma tabela além de conversas_whatsapp).
--
-- Motivo: os mockups aprovados exibem o nome do lead tanto na tabela "Conversões
-- enviadas ao Google Ads" quanto na lista de leads recentes. Sem essa coluna o
-- painel só teria o contato_id pra mostrar, o que não atende ao design.
--
-- O dado já existe na origem: o code node "Extrair Etapa Atual" do fluxo n8n já
-- extrai `contato_nome` da API do Rubeus — só precisa ser repassado no callback.
-- Ambas as colunas são nullable: evento que chegar sem nome continua sendo
-- gravado normalmente.

ALTER TABLE leads_etapa ADD COLUMN contato_nome TEXT;
ALTER TABLE conversoes_ads ADD COLUMN contato_nome TEXT;
