-- A contagem de leads estava 45% inflada.
--
-- Medido em produção (08/09/2026): o painel mostrava 1.881 leads onde existem
-- 1.298 pessoas. 583 leads que nunca existiram.
--
-- A causa é uma linha de SQL repetida em 17 lugares:
--
--     COUNT(DISTINCT COALESCE(email, telefone, contato_id))
--
-- O COALESCE resolve por LINHA, e a mesma pessoa tem várias linhas — uma por
-- etapa do funil. Quando a linha da inscrição traz e-mail e a linha do sync do
-- Rubeus não traz (90% delas não trazem), a primeira é contada pelo e-mail e a
-- segunda pelo `contato_id`. Duas chaves, duas pessoas, uma pessoa só. São 584
-- contatos nessa situação.
--
-- A intenção do COALESCE estava certa e continua valendo: quem tem e-mail deve
-- ser contado pelo e-mail, porque a mesma pessoa às vezes existe sob dois
-- `contato_id` no Rubeus (78 e-mails em produção estão nessa situação). O que
-- estava errado era resolver isso por linha em vez de por pessoa.
--
-- `pessoa_id` materializa a chave certa: o melhor identificador que o contato
-- tem em QUALQUER uma de suas linhas, não naquela linha.

ALTER TABLE leads_etapa ADD COLUMN pessoa_id TEXT;

/*
 * O preenchimento inicial.
 *
 * `MIN` ignora NULL no SQLite, então `MIN(email)` devolve o e-mail de qualquer
 * linha do contato que tenha um — e devolve NULL só quando nenhuma tem. É o
 * que faz a chave ser a mesma para todas as linhas da pessoa.
 *
 * `MIN` e não "o mais recente" porque a chave precisa ser ESTÁVEL: um alvo que
 * muda quando chega um evento novo faria o mesmo lead ser contado como pessoa
 * diferente antes e depois, que é o defeito que esta migration conserta.
 */
UPDATE leads_etapa
   SET pessoa_id = (
     SELECT COALESCE(MIN(l2.email), MIN(l2.telefone), leads_etapa.contato_id)
       FROM leads_etapa l2
      WHERE l2.contato_id = leads_etapa.contato_id
   );

/*
 * Mantida em dia pelo webhook, não por gatilho de banco.
 *
 * Um TRIGGER seria mais garantido, mas roda a cada INSERT e faria a subconsulta
 * de agregação por contato em todo evento recebido — no caminho crítico do
 * webhook, que precisa devolver 201 rápido para o Rubeus não tratar como falha.
 * O recálculo fica em `src/routes/webhooks.ts`, logo depois da gravação e fora
 * do caminho crítico, junto da propagação de identidade que já existia ali.
 *
 * NOTA DE FORMATO: o arquivo precisa TERMINAR num comando SQL. O aplicador
 * remoto do wrangler divide o arquivo por statement e recusa o último pedaço
 * quando ele é só comentário — "SQL code did not contain a statement".
 * O local aceita — o remoto não. Comentário de fecho vai antes do último comando.
 */

/*
 * O índice que faz a diferença.
 *
 * Toda contagem do funil e da visão geral passa a agrupar por `pessoa_id`, e
 * sem índice cada card viraria uma varredura da tabela inteira.
 */
CREATE INDEX IF NOT EXISTS idx_leads_pessoa ON leads_etapa (pessoa_id);
CREATE INDEX IF NOT EXISTS idx_leads_pessoa_em ON leads_etapa (pessoa_id, registrado_em);
