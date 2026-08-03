-- Guarda o refresh_token obtido no fluxo OAuth.
--
-- Vai no D1 e não em secret do Worker porque é gerado em tempo de execução: o
-- callback recebe o code, troca por tokens e precisa persistir na hora. Secret
-- do Cloudflare só se escreve por deploy ou CLI, o que não serve aqui.
--
-- Só o refresh_token fica guardado; o access_token vive uma hora e é obtido a
-- cada uso, então não há motivo para persistir.

CREATE TABLE credenciais_oauth (
  provedor TEXT PRIMARY KEY,        -- 'rdstation_marketing' | 'rdstation_crm'
  refresh_token TEXT NOT NULL,
  escopo TEXT,
  conectado_em TEXT DEFAULT (datetime('now')),
  conectado_por TEXT
);
