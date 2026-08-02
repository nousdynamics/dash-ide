-- Schema inicial do painel Faculdade IDE.
-- Espelha a seção 4 do ide-painel-plano-implementacao.md sem alterações de estrutura.

CREATE TABLE leads_etapa (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contato_id TEXT NOT NULL,
  registro_processo_id TEXT,
  processo_id TEXT,
  processo_nome TEXT,
  etapa TEXT NOT NULL,
  status TEXT,
  curso_id TEXT,
  curso_codigo TEXT,
  origem TEXT,
  modalidade TEXT,
  unidade TEXT,
  responsavel_comercial TEXT,
  registrado_em TEXT NOT NULL,      -- timestamp ISO do evento
  criado_em TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_leads_etapa_contato ON leads_etapa (contato_id);
CREATE INDEX idx_leads_etapa_processo ON leads_etapa (processo_id, etapa);
-- Extra (não está no plano): as consultas de série temporal e dos cards filtram
-- por janela de data, e sem esse índice viram full scan conforme a tabela cresce.
CREATE INDEX idx_leads_etapa_registrado_em ON leads_etapa (registrado_em);

CREATE TABLE conversoes_ads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contato_id TEXT NOT NULL,
  etapa TEXT NOT NULL,               -- 'Oportunidade paga' | 'Matrícula comercial concluída'
  gclid TEXT,
  conversion_action TEXT,
  valor REAL,
  status TEXT NOT NULL,              -- 'enviada' | 'sem_gclid' | 'erro_api' | 'pendente'
  erro_detalhe TEXT,
  enviado_em TEXT,
  criado_em TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_conversoes_status ON conversoes_ads (status);
CREATE INDEX idx_conversoes_criado_em ON conversoes_ads (criado_em);

CREATE TABLE metricas_anuncio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,                -- YYYY-MM-DD
  campanha_id TEXT,
  campanha_nome TEXT,
  investimento REAL,
  impressoes INTEGER,
  cliques INTEGER,
  cpc_medio REAL,
  ctr REAL,
  conversoes_primarias REAL,
  conversoes_secundarias REAL,
  criado_em TEXT DEFAULT (datetime('now')),
  UNIQUE(data, campanha_id)
);
CREATE INDEX idx_metricas_data ON metricas_anuncio (data);

CREATE TABLE conversas_whatsapp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contato_id TEXT,
  contato_nome TEXT,
  atendente TEXT,
  iniciada_em TEXT NOT NULL,
  respondida INTEGER DEFAULT 0,
  tempo_resposta_min REAL,
  criado_em TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_conversas_iniciada_em ON conversas_whatsapp (iniciada_em);
-- O endpoint da Evolution API faz upsert por conversa; sem essa unicidade cada
-- evento de mensagem viraria uma linha nova em vez de atualizar a conversa existente.
CREATE UNIQUE INDEX idx_conversas_contato_inicio ON conversas_whatsapp (contato_id, iniciada_em);
