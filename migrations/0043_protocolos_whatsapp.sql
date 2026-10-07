-- Protocolo do botão de WhatsApp: a ponte entre o clique no site e a conversa.
--
-- Quem chama no WhatsApp pelo site não preenche formulário, então não deixa
-- e-mail nem telefone na página — e o script de captura (ide-clique.js) não tem
-- o que mandar. O que a pessoa leva consigo é a mensagem pronta do botão. O
-- script acrescenta a ela `[Protocolo: IDE-XXXXXX]` e grava aqui o código com
-- tudo o que a página sabia: UTMs, gclid, página do clique.
--
-- Quando a mensagem chega na ferramenta de atendimento (Blip, por enquanto sem
-- acesso), o webhook `/webhook/whatsapp/evento/mensagem` lê o código no texto e
-- preenche `telefone`. A partir daí o protocolo cruza com `leads_etapa` pelo
-- telefone, como todo o resto do painel.
--
-- Uma linha por clique, não por pessoa: quem clica duas vezes gera dois códigos
-- e só manda um. A taxa "cliques que viraram conversa" depende disso.

CREATE TABLE protocolos_whatsapp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  codigo TEXT NOT NULL UNIQUE,           -- 'IDE-7K3M9Q', gerado no navegador

  -- Do clique, gravado pelo script do site.
  numero_destino TEXT,                   -- o WhatsApp da faculdade que o botão abre
  pagina TEXT,
  origem_site TEXT,
  canal TEXT,                            -- mesma classificação de origens_capturadas
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  referencia TEXT,
  click_id_tipo TEXT,                    -- 'gclid' | 'gbraid' | 'wbraid'
  click_id_valor TEXT,
  gerado_em TEXT DEFAULT (datetime('now')),

  -- Da mensagem, gravado pelo webhook da ferramenta de atendimento.
  telefone TEXT,                         -- normalizado como em identidade.ts
  contato_nome TEXT,
  fonte TEXT,                            -- quem vinculou: 'blip', 'n8n', 'generico'
  mensagem_em TEXT
);

CREATE INDEX idx_protocolos_gerado ON protocolos_whatsapp (gerado_em);
CREATE INDEX idx_protocolos_telefone ON protocolos_whatsapp (telefone);

-- O link do webhook aparece na tela "Funis e webhooks", com o botão de gerar
-- token, como os outros por evento. Sem token até alguém gerar.
INSERT INTO webhooks (funil_id, canal, evento) VALUES (NULL, 'whatsapp', 'mensagem');
