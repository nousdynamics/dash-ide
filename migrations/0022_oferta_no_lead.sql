-- Guarda a oferta, não só o curso.
--
-- O payload do Rubeus manda `curso: { id, codCurso, codOferta }`, e o parser
-- pegava os dois primeiros e jogava o terceiro fora. A oferta é mais específica
-- que o curso: "Graduação Em Psicologia" existe como oferta por semestre e por
-- turno, e é nela que mora a graduação inteira — `cursos` mal tem essas linhas.
--
-- Mais importante: o time avisou que a etapa "Aptos para a matrícula" carrega o
-- nome do curso num campo chamado "nome da oferta". Esse campo não está sendo
-- enviado hoje (o payload dessa etapa chega urlencoded, da Ficha de Inscrição,
-- com nome/e-mail/etapa e nada de curso). Quando for habilitado na configuração
-- do webhook no Rubeus, cai aqui e passa a resolver categoria sozinho — sem
-- deploy, porque o parser já vai estar esperando.

ALTER TABLE leads_etapa ADD COLUMN oferta_codigo TEXT;
ALTER TABLE leads_etapa ADD COLUMN oferta_nome TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_etapa_oferta ON leads_etapa (oferta_codigo);

/*
 * A view de catálogo passa a expor o código da oferta separado do código do
 * curso. Antes os dois vinham achatados no mesmo campo por COALESCE, o que
 * bastava para casar por nível mas impedia casar por oferta — que é justamente
 * o que `codOferta` permite.
 */
DROP VIEW IF EXISTS curso_categoria;
DROP VIEW IF EXISTS curso_catalogo;

CREATE VIEW curso_catalogo AS
  SELECT id AS curso_id, codigo AS curso_codigo, NULL AS oferta_codigo,
         nome, nivel_ensino, modalidade
    FROM cursos
  UNION ALL
  SELECT curso_id, curso_codigo, oferta_codigo, nome, nivel_ensino, modalidade
    FROM curso_ofertas;

CREATE VIEW curso_categoria AS
  SELECT
    k.curso_id,
    k.curso_codigo,
    k.oferta_codigo,
    k.nome,
    (SELECT cc.categoria
       FROM curso_categorias cc
      WHERE (cc.curso_codigo IS NOT NULL AND cc.curso_codigo = k.curso_codigo)
         OR (cc.curso_id     IS NOT NULL AND cc.curso_id     = k.curso_id)
         OR (cc.oferta_codigo IS NOT NULL AND cc.oferta_codigo = k.oferta_codigo)
         OR (cc.curso_codigo IS NULL AND cc.curso_id IS NULL AND cc.oferta_codigo IS NULL
             AND (cc.padrao_nivel IS NOT NULL OR cc.padrao_nome IS NOT NULL)
             AND (cc.padrao_nivel IS NULL OR k.nivel_ensino LIKE cc.padrao_nivel)
             AND (cc.padrao_nome  IS NULL OR k.nome         LIKE cc.padrao_nome))
      ORDER BY cc.prioridade, cc.id
      LIMIT 1) AS categoria
  FROM curso_catalogo k;
