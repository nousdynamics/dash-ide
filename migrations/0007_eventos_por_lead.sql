-- Guarda a quem o evento pertence, para o histórico ser navegável por lead.
--
-- Sem isso o diário é só uma lista cronológica: dá para ver "chegou algo", mas
-- não "o que já chegou desta pessoa". A jornada do lead é justamente a leitura
-- que se quer — cada passagem de etapa, na ordem, com o corpo cru de cada uma.

ALTER TABLE eventos_recebidos ADD COLUMN contato_id TEXT;
ALTER TABLE eventos_recebidos ADD COLUMN contato_nome TEXT;
ALTER TABLE eventos_recebidos ADD COLUMN etapa TEXT;
CREATE INDEX idx_eventos_contato ON eventos_recebidos (contato_id, recebido_em DESC);
