-- Origem do lead: UTMs e referência, capturadas no site pelo mesmo script do
-- click id (/coleta/ide-clique.js, instalado pelo GTM).
--
-- Por que outra tabela, e não colunas em `cliques_capturados`: aquela só existe
-- quando há gclid — é a ponte para a conversão offline do Google. Origem vale
-- para TODA visita que vira formulário, inclusive a orgânica, que é justamente
-- a que não tem click id nenhum. O Rubeus não guarda nada disso: em 05/10/2026
-- os 16.002 leads tinham `url_origem` vazio.
--
-- O canal sai classificado já na entrada (src/lib/origens.ts), e as UTMs ficam
-- cruas ao lado — se a regra mudar, dá para reclassificar sem perder dado.

CREATE TABLE origens_capturadas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 'google_ads' | 'meta_ads' | 'utm' | 'busca' | 'social' | 'referencia' | 'direto'
  canal TEXT NOT NULL,

  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  tem_click_id INTEGER NOT NULL DEFAULT 0,   -- chegou com gclid/gbraid/wbraid/fbclid
  referencia TEXT,                           -- host do document.referrer na chegada

  -- Chaves do cruzamento com leads_etapa, normalizadas como em identidade.ts.
  email TEXT,
  telefone TEXT,

  pagina_entrada TEXT,   -- onde a pessoa chegou (com as UTMs)
  pagina_form TEXT,      -- onde ela preencheu o formulário
  origem_site TEXT,

  capturado_em TEXT DEFAULT (datetime('now'))
);

-- Reenvio do mesmo formulário com a mesma origem é a mesma captura.
CREATE UNIQUE INDEX idx_origem_unica ON origens_capturadas (
  COALESCE(email, ''), COALESCE(telefone, ''), canal,
  COALESCE(utm_source, ''), COALESCE(utm_medium, ''), COALESCE(utm_campaign, ''),
  COALESCE(utm_content, ''), COALESCE(utm_term, '')
);

CREATE INDEX idx_origem_periodo ON origens_capturadas (capturado_em, canal);
CREATE INDEX idx_origem_email ON origens_capturadas (email);
CREATE INDEX idx_origem_telefone ON origens_capturadas (telefone);

-- O cruzamento origem → lead entra por e-mail ou telefone. Sem estes índices
-- cada linha da tela de Origens varreria os ~16 mil leads, e a cota diária de
-- leitura do D1 é o limite real do painel (ver cacheBorda.ts).
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads_etapa (email);
CREATE INDEX IF NOT EXISTS idx_leads_telefone ON leads_etapa (telefone);
