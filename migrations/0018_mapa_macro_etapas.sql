-- Traduz as etapas reais do Rubeus para as 6 da planilha.
--
-- A tabela `processo_etapas` aprende sozinha o NOME da etapa quando um evento
-- chega, mas `macro_etapa` nasce nula — e nula não entra em nenhuma contagem.
-- Resultado: 19 etapas no banco, 2 cadastradas, nenhuma classificada, e o funil
-- consolidado marcando zero enquanto a planilha marcava 979 leads em junho.
--
-- Classificar é decisão de negócio, não de código: quem opera o CRM é quem sabe
-- se "Aptos para a matrícula" conta como inscrição ou como matrícula. O que
-- está aqui é a leitura mais defensável do vocabulário do funil, e é para ser
-- corrigida — a tabela existe justamente para isso ser um UPDATE, não um deploy.
--
-- Casado por nome, sem acento e sem caixa: o Rubeus escreve "Matrículado" com
-- acento em uns lugares e não em outros.

-- Primeiro semeia: 17 das 19 etapas nem existiam na tabela, e UPDATE não cria
-- linha. A fonte é o próprio dado recebido — não uma lista escrita à mão que
-- diverge no primeiro rename feito no CRM.
INSERT OR IGNORE INTO processo_etapas (processo_id, etapa_nome, ordem)
SELECT DISTINCT COALESCE(processo_id, '0'), etapa, 100
  FROM leads_etapa
 WHERE etapa IS NOT NULL AND etapa <> '';

UPDATE processo_etapas SET macro_etapa = 'qualificados'
 WHERE lower(etapa_nome) IN (
   'interessados', 'não contactado', 'nao contactado', 'novo lead',
   'em qualificação', 'em qualificacao', 'conexão', 'conexao'
 );

UPDATE processo_etapas SET macro_etapa = 'oportunidade'
 WHERE lower(etapa_nome) IN (
   'oportunidade', 'oportunidade paga', 'quer se inscrever'
 );

-- "Oportunidade (Inscrição concluída)" tem nome de oportunidade mas descreve
-- inscrição concluída. Segue o que ela DESCREVE, não como foi batizada.
UPDATE processo_etapas SET macro_etapa = 'inscricao'
 WHERE lower(etapa_nome) IN (
   'inscrito parcial', 'iniciou o processo de inscrição', 'iniciou o processo de inscricao',
   'pré-inscrição', 'pre-inscricao', 'oportunidade (inscrição concluída)',
   'oportunidade (inscricao concluida)', 'documentos enviados (transf., diploma, enem)',
   'aptos para a matrícula', 'aptos para a matricula', 'aprovado (vestibular)'
 );

UPDATE processo_etapas SET macro_etapa = 'matricula'
 WHERE lower(etapa_nome) IN (
   'matrícula comercial concluída', 'matricula comercial concluida',
   'matrícula acadêmica concluída', 'matricula academica concluida',
   'matrículado', 'matriculado', 'matrículado acadêmico', 'matriculado academico'
 );

-- `lower()` do SQLite só rebaixa ASCII: em "Matrícula ACADÊMICA concluída" o Ê
-- continua maiúsculo e a comparação acima nunca casa. "COMERCIAL" casou porque
-- é ASCII puro — o que fez o bug atingir uma etapa só e passar despercebido.
-- Por isso o casamento final é por trecho, sem depender de caixa em acento.
UPDATE processo_etapas SET macro_etapa = 'matricula'
 WHERE macro_etapa IS NULL
   AND (etapa_nome LIKE 'Matr%cula%conclu%' OR etapa_nome LIKE 'Matr%culado%');
