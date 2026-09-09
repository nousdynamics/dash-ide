-- O que o Rubeus já mandava e o painel descartava.
--
-- Levantado em 05/09/2026, lendo os corpos guardados em `eventos_recebidos`: o
-- payload da Ficha de Inscrição chega com `cep`, `cidade`, `estado`,
-- `valor_do_curso` e `url_origem[0]`, e o parser não lia nenhum deles. Não é
-- dado que falta na origem — é dado que chegava e era jogado fora na porta.
--
-- Cada um resolve um problema concreto:
--
--   valor_do_curso — o README afirmava que o Rubeus não tem preço em lugar
--     nenhum ("`valorCurso` nulo em todas as oportunidades, `valor` nulo nas
--     689 ofertas"). É verdade para a API — é falso para o webhook, que manda o
--     valor no corpo. Sem ele, toda conversão sobe com o valor fixo cadastrado
--     à mão na tela, e o Smart Bidding otimiza para um preço que não é o da
--     matrícula que aconteceu.
--
--   cep / cidade / estado — completam o identificador de ENDEREÇO do Google
--     (nome + sobrenome + país + CEP). É a terceira via de atribuição, que
--     alcança justamente o lead sem gclid e sem e-mail. Nome e sobrenome vão em
--     hash — CEP e país vão em claro, que é como a Data Manager API os define.
--
--   url_origem — a landing page em que a pessoa entrou. Diagnóstico de
--     atribuição: responde "de qual página vêm os leads que não têm gclid",
--     que é a pergunta que decide onde colar a tag de captura.

ALTER TABLE leads_etapa ADD COLUMN valor_curso REAL;
ALTER TABLE leads_etapa ADD COLUMN cep TEXT;
ALTER TABLE leads_etapa ADD COLUMN cidade TEXT;
ALTER TABLE leads_etapa ADD COLUMN estado TEXT;
ALTER TABLE leads_etapa ADD COLUMN url_origem TEXT;

/*
 * O mesmo na conversão, congelado no momento do envio.
 *
 * `conversoes_offline` guarda cópia dos dados do lead de propósito — ela é o
 * registro do que FOI ENVIADO, e precisa continuar dizendo a verdade mesmo
 * depois de alguém corrigir o cadastro no Rubeus. Um join até o lead mostraria
 * o dado de hoje ao lado de um envio de semana passada.
 */
ALTER TABLE conversoes_offline ADD COLUMN cep TEXT;
ALTER TABLE conversoes_offline ADD COLUMN contato_canonico TEXT;

/*
 * A costura de identidade lê todas as linhas de um contato de uma vez, na
 * ordem em que a mais recente vence. `idx_leads_etapa_contato` já existe, mas
 * só por `contato_id`: sem a data no índice, cada costura faz o SQLite ordenar
 * as linhas do contato em memória.
 */
CREATE INDEX IF NOT EXISTS idx_leads_contato_recente
  ON leads_etapa (contato_id, registrado_em DESC);

/*
 * A chave que identifica um evento repetido.
 *
 * NÃO é UNIQUE, e isso é deliberado. Existem hoje 321 linhas exatamente
 * duplicadas em produção (162 grupos), e um índice único não pode nascer sobre
 * dados que já o violam — a migration falharia no meio do deploy. A prevenção
 * fica no código (`src/routes/webhooks.ts`), que consulta por esta chave antes
 * de gravar — o índice existe para essa consulta custar nada.
 *
 * Quando as duplicatas antigas forem revisadas e removidas, este índice vira
 * UNIQUE numa migration de uma linha e a prevenção sai do código para o banco,
 * que é onde ela deveria estar.
 */
CREATE INDEX IF NOT EXISTS idx_leads_repetido
  ON leads_etapa (contato_id, etapa, registrado_em, processo_id);
