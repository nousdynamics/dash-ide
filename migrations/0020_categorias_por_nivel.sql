-- As 7 categorias da planilha saem do NÍVEL DE ENSINO, não do nome do curso.
--
-- Só uma das sete tinha movimento. Os padrões da 0016 procuravam "%pós%ead%",
-- "%pos%presencial%", "%curta%" dentro de `cursos.nome` — e nome de curso aqui é
-- o assunto dele: "Audiologia", "Aleitamento Materno", "Neuropsicologia
-- Clínica". Nenhum dos 357 diz "pós", "EAD" ou "presencial", então nenhum
-- padrão casava. O único que casava era "%psicologia%", porque aí o assunto e a
-- categoria têm o mesmo nome por coincidência.
--
-- O que carrega a taxonomia é `nivel_ensino`, nas duas tabelas do catálogo, e
-- ele já vem do Rubeus exatamente com os rótulos que a planilha usa:
--
--   Pós-Graduação (Presencial)        351 ofertas
--   Curso de Curta Duração (Presencial)  97
--   Graduação (Presencial)               81
--   Pós-Graduação (EAD)                  53
--   Extensão (Presencial)                39
--   ...
--
-- Então a regra passa a casar nível E nome, com o nome servindo só para separar
-- o que o nível não separa: Medicina dentro da pós, e os três cursos de
-- graduação entre si.

ALTER TABLE curso_categorias ADD COLUMN padrao_nivel TEXT;

-- Categoria é excludente na planilha: cada inscrição cai em uma linha só. Como
-- "Medicina Em Psiquiatria" casa tanto com pós-medicina quanto com
-- pós-presencial, alguém tem de desempatar — e desempate por ordem explícita
-- envelhece melhor do que por ordem de inserção.
ALTER TABLE curso_categorias ADD COLUMN prioridade INTEGER NOT NULL DEFAULT 100;

-- Os 12 padrões antigos não casam com nada (exceto psicologia, recriado abaixo
-- com o nível junto). Saem para não deixar duas gerações de regra convivendo.
DELETE FROM curso_categorias WHERE padrao_nome IS NOT NULL AND curso_codigo IS NULL AND curso_id IS NULL;

/*
 * `_` no lugar de cada letra acentuada, de propósito.
 *
 * O LIKE do SQLite ignora caixa só em ASCII. Foi assim que a 0018 perdeu
 * "Matrícula ACADÊMICA concluída": o Ê maiúsculo não rebaixava e a comparação
 * nunca casava, num único registro, sem erro nenhum aparecendo. Aqui o mesmo
 * risco existe em "Pós", "Extensão", "Estética" e "Aperfeiçoamento". Escrever
 * "P_s-Gradua%" custa uma linha de comentário e remove a classe inteira de bug.
 */
INSERT INTO curso_categorias (categoria, rotulo, padrao_nivel, padrao_nome, prioridade) VALUES
  -- Medicina primeiro: é um recorte DENTRO da pós, e sem prioridade menor seria
  -- engolido por pós-presencial, que também casa.
  ('pos_medicina',    'Pós Medicina',         'P_s-Gradua%',            '%Medicina%',           10),

  -- Graduação tem três cursos e o nível não os distingue — só o nome distingue.
  ('grad_psicologia', 'Graduação Psicologia', 'Gradua%',                '%Psicologia%',         20),
  ('grad_estetica',   'Graduação Estética',   'Gradua%',                '%Est_tica%',           20),
  ('grad_rh_ead',     'Graduação RH EAD',     'Gradua%',                '%Recursos Humanos%',   20),

  -- Semipresencial entra em EAD: a planilha só tem duas colunas de pós fora de
  -- medicina, e quem não é presencial puro é o que ela chama de EAD.
  ('pos_ead',         'Pós EAD',              'P_s-Gradua%(EAD)%',           NULL,              30),
  ('pos_ead',         'Pós EAD',              'P_s-Gradua%Semipresencial%',  NULL,              30),
  ('pos_presencial',  'Pós presencial',       'P_s-Gradua%(Presencial)%',    NULL,              31),

  -- "Curta duração" na planilha é o balde do que não é pós nem graduação:
  -- curta duração, extensão e aperfeiçoamento.
  ('curta_duracao',   'Curta duração',        'Curso de Curta Dura%',   NULL,                   40),
  ('curta_duracao',   'Curta duração',        'Curta Dura%',            NULL,                   40),
  ('curta_duracao',   'Curta duração',        'Extens_o%',              NULL,                   40),
  ('curta_duracao',   'Curta duração',        'Aperfei_oamento%',       NULL,                   40);

/*
 * Catálogo achatado: curso e oferta respondem a mesma pergunta ("que curso é
 * este código?") e vinham sendo consultados separado, cada consulta com um
 * jeito diferente de casar o código. A oferta entra junto porque 684 ofertas
 * cobrem casos que as 357 linhas de `cursos` não têm — inclusive as de
 * graduação, que só existem como oferta por semestre.
 */
CREATE VIEW IF NOT EXISTS curso_catalogo AS
  SELECT id AS curso_id, codigo AS curso_codigo, nome, nivel_ensino, modalidade FROM cursos
  UNION ALL
  SELECT curso_id, COALESCE(curso_codigo, oferta_codigo), nome, nivel_ensino, modalidade
    FROM curso_ofertas;

/*
 * Cada identidade de curso resolvida para UMA categoria — a de menor prioridade
 * entre as que casam. Fica em view para que a regra de desempate exista num
 * lugar só: as telas perguntam "qual a categoria deste curso" e não repetem o
 * critério, que foi como pós-medicina e pós-presencial acabariam contando a
 * mesma inscrição duas vezes.
 */
CREATE VIEW IF NOT EXISTS curso_categoria AS
  SELECT
    k.curso_id,
    k.curso_codigo,
    (SELECT cc.categoria
       FROM curso_categorias cc
      WHERE (cc.curso_codigo IS NOT NULL AND cc.curso_codigo = k.curso_codigo)
         OR (cc.curso_id     IS NOT NULL AND cc.curso_id     = k.curso_id)
         OR (cc.curso_codigo IS NULL AND cc.curso_id IS NULL
             AND (cc.padrao_nivel IS NOT NULL OR cc.padrao_nome IS NOT NULL)
             AND (cc.padrao_nivel IS NULL OR k.nivel_ensino LIKE cc.padrao_nivel)
             AND (cc.padrao_nome  IS NULL OR k.nome         LIKE cc.padrao_nome))
      ORDER BY cc.prioridade, cc.id
      LIMIT 1) AS categoria
  FROM curso_catalogo k;
