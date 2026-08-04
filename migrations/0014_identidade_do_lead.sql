-- E-mail e telefone no lead: identidade estável e chave de cruzamento.
--
-- Dois problemas, uma causa. O `contato_id` do Rubeus NÃO é estável entre
-- fluxos: RAFAEL DE PAULA DA SILVA entrou como 1670629 num gatilho e como 44176
-- no de "Inscrito Parcial", e o funil, que conta contatos distintos, passou a
-- vê-lo como duas pessoas — inflando a primeira etapa contra as seguintes.
--
-- O e-mail é o que não muda. E é a mesma chave que o RD Station usa; o telefone
-- é a que a Evolution usa. Guardar os dois aqui resolve a contagem e abre o
-- cruzamento com as duas integrações, sem tabela de identidade à parte.
--
-- `telefone` guarda só dígitos com DDI: o Rubeus manda "+5581999820742" e a
-- Evolution manda "5581999820742@s.whatsapp.net". Normalizado, os dois casam.

ALTER TABLE leads_etapa ADD COLUMN email TEXT;
ALTER TABLE leads_etapa ADD COLUMN telefone TEXT;

CREATE INDEX idx_leads_email ON leads_etapa (email);
CREATE INDEX idx_leads_telefone ON leads_etapa (telefone);
