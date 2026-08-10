-- "Inscrição iniciada" não é inscrição.
--
-- O funil marcava 78 inscrições contra 66 oportunidades em 90 dias. Um funil não
-- faz isso, e a suspeita natural — "Oportunidade (Inscrição concluída)" no balde
-- errado — não explicava nada: são 4 pessoas ao todo. Ela está classificada
-- certo, aliás; o nome diz oportunidade mas o que ela descreve é inscrição
-- concluída, e é isso que vale.
--
-- Quem inverte o funil são estas três, com 121 pessoas somadas:
--
--   Inscrito Parcial                  64
--   Iniciou o processo de inscrição   50
--   Pré-inscrição                      7
--
-- As três descrevem alguém que COMEÇOU uma inscrição, não que a concluiu —
-- "parcial" e "iniciou" dizem isso na própria etiqueta. Contá-las como inscrição
-- é contar intenção como resultado, e é o que empurrava inscrições acima de
-- oportunidades. Intenção de se inscrever é exatamente o que "Quer se inscrever"
-- já significa neste funil, e essa etapa é oportunidade.
--
-- O que confirma a leitura é a razão matrícula/inscrição. Com a classificação
-- antiga o período de 90 dias fecha em 30/94 = 32%. Com estas três movidas, em
-- 30/36 = 83% — e a planilha de junho, preenchida à mão por quem opera o CRM,
-- traz 102/121 = 84%. Não é prova, mas é a mesma faculdade vendendo do mesmo
-- jeito, e 32% não se parece com o negócio.
--
-- Continua sendo decisão de negócio, como diz a 0018: para desfazer, é UPDATE
-- de volta para 'inscricao', não deploy.

UPDATE processo_etapas SET macro_etapa = 'oportunidade'
 WHERE etapa_nome LIKE 'Inscrito Parcial%'
    OR etapa_nome LIKE 'Iniciou o processo de inscri%'
    OR etapa_nome LIKE 'Pr_-inscri%';

-- "Desistentes e Reembolsos COMERCIAIS" fica sem macro de propósito: é saída do
-- funil, não etapa dele. Nula não entra em contagem nenhuma, que é o certo aqui
-- — mas deixar explícito evita que a próxima leitura ache que é esquecimento.
