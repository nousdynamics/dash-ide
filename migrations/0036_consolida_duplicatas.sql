-- Consolida as linhas duplicadas de `leads_etapa` e fecha a porta com UNIQUE.
--
-- A prevenção entrou na 0032, no código do webhook, e funciona: zero grupos
-- novos desde o deploy. Ficaram as 331 linhas antigas (169 grupos), e enquanto
-- existirem o índice não pode ser UNIQUE — a regra fica no código em vez de
-- estar no banco, que é onde ela deveria morar.
--
-- APAGAR NÃO BASTA. Medido em 09/09/2026: das 169 duplicatas, 37 têm `curso_id`
-- divergente entre as cópias e 11 têm e-mail divergente. Quer dizer que o
-- webhook reemitiu o mesmo evento e, em alguma das vezes, trouxe um dado que nas
-- outras não veio. Manter cegamente a linha de menor id descartaria justamente
-- a cópia que tinha o curso — e curso perdido vira nível não identificado, que
-- vira conversão na ação curinga ou em `sem_acao`.
--
-- Então: guarda, consolida, apaga, tranca.

-- ------------------------------------------------------------------ guarda
--
-- Cópia exata do que vai sair, para o caso de a consolidação ter errado alguma
-- coisa que só apareça semanas depois. É barato: são 331 linhas.
CREATE TABLE leads_etapa_duplicatas_backup AS
SELECT * FROM leads_etapa l
 WHERE EXISTS (
   SELECT 1 FROM leads_etapa o
    WHERE o.contato_id = l.contato_id
      AND o.etapa = l.etapa
      AND o.registrado_em = l.registrado_em
      AND COALESCE(o.processo_id, '') = COALESCE(l.processo_id, '')
      AND o.id < l.id
 );

-- --------------------------------------------------------------- consolida
--
-- Uma varredura só, num apoio temporário.
--
-- A primeira versão desta migration fazia doze subconsultas correlacionadas por
-- linha, cada uma varrendo `leads_etapa` inteira: ~26 milhões de leituras, e o
-- D1 recusou por estourar o teto diário do plano. O mesmo resultado sai de um
-- `GROUP BY` — uma passada — gravado numa tabela de 169 linhas, contra a qual o
-- UPDATE faz busca por chave primária.
--
-- `MAX(...)` ignora NULL no SQLite, então ele é só "pegue um valor que exista".
-- Quando duas cópias discordam, qualquer uma é melhor do que o vazio: vieram do
-- mesmo evento, no mesmo instante, do mesmo contato.
CREATE TABLE _consolida_duplicatas AS
SELECT MIN(id)            AS id,
       MAX(contato_nome)  AS contato_nome,
       MAX(email)         AS email,
       MAX(telefone)      AS telefone,
       MAX(cep)           AS cep,
       MAX(curso_id)      AS curso_id,
       MAX(curso_codigo)  AS curso_codigo,
       MAX(oferta_codigo) AS oferta_codigo,
       MAX(oferta_nome)   AS oferta_nome,
       MAX(valor_curso)   AS valor_curso,
       MAX(funil_id)      AS funil_id,
       MAX(origem)        AS origem,
       MAX(gclid)         AS gclid
  FROM leads_etapa
 GROUP BY contato_id, etapa, registrado_em, COALESCE(processo_id, '')
HAVING COUNT(*) > 1;

UPDATE leads_etapa
   SET contato_nome  = COALESCE(contato_nome,  (SELECT c.contato_nome  FROM _consolida_duplicatas c WHERE c.id = leads_etapa.id)),
       email         = COALESCE(email,         (SELECT c.email         FROM _consolida_duplicatas c WHERE c.id = leads_etapa.id)),
       telefone      = COALESCE(telefone,      (SELECT c.telefone      FROM _consolida_duplicatas c WHERE c.id = leads_etapa.id)),
       cep           = COALESCE(cep,           (SELECT c.cep           FROM _consolida_duplicatas c WHERE c.id = leads_etapa.id)),
       curso_id      = COALESCE(curso_id,      (SELECT c.curso_id      FROM _consolida_duplicatas c WHERE c.id = leads_etapa.id)),
       curso_codigo  = COALESCE(curso_codigo,  (SELECT c.curso_codigo  FROM _consolida_duplicatas c WHERE c.id = leads_etapa.id)),
       oferta_codigo = COALESCE(oferta_codigo, (SELECT c.oferta_codigo FROM _consolida_duplicatas c WHERE c.id = leads_etapa.id)),
       oferta_nome   = COALESCE(oferta_nome,   (SELECT c.oferta_nome   FROM _consolida_duplicatas c WHERE c.id = leads_etapa.id)),
       valor_curso   = COALESCE(valor_curso,   (SELECT c.valor_curso   FROM _consolida_duplicatas c WHERE c.id = leads_etapa.id)),
       funil_id      = COALESCE(funil_id,      (SELECT c.funil_id      FROM _consolida_duplicatas c WHERE c.id = leads_etapa.id)),
       origem        = COALESCE(origem,        (SELECT c.origem        FROM _consolida_duplicatas c WHERE c.id = leads_etapa.id)),
       gclid         = COALESCE(gclid,         (SELECT c.gclid         FROM _consolida_duplicatas c WHERE c.id = leads_etapa.id))
 WHERE id IN (SELECT id FROM _consolida_duplicatas);

DROP TABLE _consolida_duplicatas;

-- ------------------------------------------------------------------- apaga
--
-- Sai tudo que não é a linha de menor id do seu grupo. O que elas tinham de
-- útil já foi para a sobrevivente no passo acima.
DELETE FROM leads_etapa
 WHERE id IN (SELECT id FROM leads_etapa_duplicatas_backup);

/*
 * A chave de pessoa é recalculada para os contatos tocados.
 *
 * A consolidação pode ter dado e-mail a uma linha que não tinha, e `pessoa_id`
 * sai do melhor identificador do contato — ver migration 0033. Sem refazer, a
 * contagem de leads continuaria com a chave antiga para esses contatos.
 */
UPDATE leads_etapa
   SET pessoa_id = (
     SELECT COALESCE(MIN(l2.email), MIN(l2.telefone), leads_etapa.contato_id)
       FROM leads_etapa l2 WHERE l2.contato_id = leads_etapa.contato_id
   )
 WHERE contato_id IN (SELECT DISTINCT contato_id FROM leads_etapa_duplicatas_backup);

/*
 * Agora a regra pode morar no banco.
 *
 * O código do webhook continua consultando antes de gravar — não por
 * desconfiança do índice, mas porque ele devolve 200 "repetido" ao Rubeus em
 * vez de deixar o INSERT estourar. O índice é a garantia — a checagem é a
 * cortesia com quem chamou.
 */
CREATE UNIQUE INDEX idx_leads_evento_unico
  ON leads_etapa (contato_id, etapa, registrado_em, COALESCE(processo_id, ''));
