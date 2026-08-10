-- Catálogo de cursos/ofertas e mapeamento do funil macro (planilha).
--
-- A planilha soma RD Marketing (topo) com Rubeus (qualificação → matrícula).
-- `processo_etapas.macro_etapa` traduz o nome real do CRM para as 6 etapas da
-- planilha. `curso_categorias` agrupa cursos nas categorias que a equipe já usa.

CREATE TABLE IF NOT EXISTS cursos (
  id TEXT PRIMARY KEY,
  codigo TEXT,
  nome TEXT NOT NULL,
  nivel_ensino TEXT,
  modalidade TEXT,
  atualizado_em TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cursos_codigo ON cursos (codigo);

CREATE TABLE IF NOT EXISTS curso_ofertas (
  id TEXT PRIMARY KEY,
  curso_id TEXT,
  curso_codigo TEXT,
  oferta_codigo TEXT,
  nome TEXT,
  nivel_ensino TEXT,
  modalidade TEXT,
  processo_seletivo_id TEXT,
  atualizado_em TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_curso_ofertas_codigo ON curso_ofertas (curso_codigo);

-- Categorias exatamente como na planilha de funil 2026.
CREATE TABLE IF NOT EXISTS curso_categorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  categoria TEXT NOT NULL,          -- pos_presencial | pos_ead | ...
  rotulo TEXT NOT NULL,             -- "Pós presencial"
  curso_codigo TEXT,                -- match por código (preferido)
  curso_id TEXT,
  oferta_codigo TEXT,
  padrao_nome TEXT,                 -- LIKE em nome do curso, se sem código
  UNIQUE (categoria, curso_codigo, oferta_codigo, padrao_nome)
);

CREATE TABLE IF NOT EXISTS processo_etapas (
  processo_id TEXT NOT NULL,
  etapa_id TEXT,
  etapa_nome TEXT NOT NULL,
  ordem INTEGER NOT NULL DEFAULT 100,
  macro_etapa TEXT,                 -- lead | qualificado | oportunidade | inscricao | matricula | ignorar
  atualizado_em TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (processo_id, etapa_nome)
);

CREATE INDEX IF NOT EXISTS idx_processo_etapas_macro
  ON processo_etapas (macro_etapa, processo_id);

CREATE INDEX IF NOT EXISTS idx_leads_etapa_curso_em
  ON leads_etapa (curso_codigo, registrado_em);

CREATE INDEX IF NOT EXISTS idx_leads_etapa_funil_etapa_em
  ON leads_etapa (funil_id, etapa, registrado_em);

CREATE INDEX IF NOT EXISTS idx_leads_etapa_curso_id_em
  ON leads_etapa (curso_id, registrado_em);

-- Seeds das categorias conhecidas da planilha (casamento por padrão de nome).
INSERT OR IGNORE INTO curso_categorias (categoria, rotulo, padrao_nome) VALUES
  ('pos_presencial', 'Pós presencial', '%pós%presencial%'),
  ('pos_presencial', 'Pós presencial', '%pos%presencial%'),
  ('pos_ead', 'Pós EAD', '%pós%ead%'),
  ('pos_ead', 'Pós EAD', '%pos%ead%'),
  ('pos_medicina', 'Pós Medicina', '%pós%medicina%'),
  ('pos_medicina', 'Pós Medicina', '%pos%medicina%'),
  ('grad_rh_ead', 'Graduação RH EAD', '%rh%ead%'),
  ('grad_rh_ead', 'Graduação RH EAD', '%recursos humanos%'),
  ('grad_psicologia', 'Graduação Psicologia', '%psicologia%'),
  ('grad_estetica', 'Graduação Estética', '%estética%'),
  ('grad_estetica', 'Graduação Estética', '%estetica%'),
  ('curta_duracao', 'Curta duração', '%curta%');
