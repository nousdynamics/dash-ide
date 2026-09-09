-- Reordena a esteira para espelhar o kanban do Rubeus.
--
-- Pós / Curta: Inscrito Parcial → Oportunidade → Oportunidade paga → …
-- Graduação:   Inscrito Parcial → Oportunidade (Inscrição) → Documentos → …
--
-- Força UPDATE em todas as linhas (não só ordem = 100): a 0028 deixou a
-- sequência antiga (Oportunidade antes de Inscrito) gravada.

UPDATE processo_etapas
   SET ordem = CASE
     WHEN lower(etapa_nome) LIKE '%desistente%'
       OR lower(etapa_nome) LIKE '%reembolso%' THEN 9900
     WHEN lower(etapa_nome) LIKE '%conversoes diversas%'
       OR lower(etapa_nome) LIKE '%conversões diversas%' THEN 9800
     WHEN etapa_nome LIKE '%ACAD%MICA%'
       OR etapa_nome LIKE '%Acad%mica%'
       OR etapa_nome LIKE '%acad%mica%'
       OR etapa_nome LIKE 'Matr%culado Acad%' THEN 170
     WHEN etapa_nome LIKE '%COMERCIAL conclu%'
       OR etapa_nome LIKE '%comercial conclu%' THEN 160
     WHEN lower(etapa_nome) LIKE '%pre-%matriculado%'
       OR lower(etapa_nome) LIKE '%pré-%matriculado%'
       OR lower(etapa_nome) LIKE '%pre matriculado%' THEN 150
     WHEN etapa_nome LIKE 'Matr%culado%' THEN 155
     WHEN lower(etapa_nome) LIKE '%aptos para a matr%'
       OR lower(etapa_nome) LIKE '%aptos para matr%' THEN 140
     WHEN lower(etapa_nome) LIKE '%aprovado (vestibular)%' THEN 130
     WHEN lower(etapa_nome) LIKE '%documentos enviados%' THEN 120
     WHEN lower(etapa_nome) LIKE '%oportunidade (inscri%conclu%' THEN 110
     WHEN etapa_nome LIKE 'Pr%-inscri%'
       OR lower(etapa_nome) LIKE 'pré-inscri%'
       OR lower(etapa_nome) LIKE 'pre-inscri%' THEN 100
     WHEN lower(etapa_nome) LIKE '%oportunidade paga%' THEN 80
     WHEN lower(etapa_nome) LIKE '%oportunidade%' THEN 70
     WHEN etapa_nome LIKE 'Inscrito Parcial%'
       OR lower(etapa_nome) LIKE 'inscrito parcial%' THEN 60
     WHEN etapa_nome LIKE 'Iniciou o processo de inscri%'
       OR lower(etapa_nome) LIKE 'iniciou o processo de inscr%' THEN 55
     WHEN lower(etapa_nome) LIKE '%quer se inscrever%' THEN 50
     WHEN lower(etapa_nome) LIKE '%em qualifica%' THEN 40
     WHEN lower(etapa_nome) LIKE '%conex%' THEN 30
     WHEN lower(etapa_nome) LIKE '%novo lead%' THEN 20
     WHEN lower(etapa_nome) LIKE '%interessados%' THEN 15
     WHEN lower(etapa_nome) LIKE '%contactado%' THEN 10
     WHEN lower(etapa_nome) LIKE '%finalizou a inscricao no evento%'
       OR lower(etapa_nome) LIKE '%finalizou a inscrição no evento%' THEN 200
     WHEN lower(etapa_nome) LIKE '%participou do evento%' THEN 210
     WHEN lower(etapa_nome) LIKE '%indicou interesse%' THEN 190
     WHEN macro_etapa = 'lead' THEN 150
     WHEN macro_etapa = 'qualificados' THEN 250
     WHEN macro_etapa = 'oportunidade' THEN 350
     WHEN macro_etapa = 'inscricao' THEN 450
     WHEN macro_etapa = 'matricula' THEN 550
     WHEN macro_etapa = 'ignorar' THEN 9900
     ELSE 7500
   END;
