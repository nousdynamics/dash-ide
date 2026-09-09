-- Ordem padrão da esteira por processo (espelha src/lib/etapas.ts).
--
-- Só repõe linhas que ainda estão com ordem = 100 (default de fábrica).
-- Quem reordenou na UI (#/etapas) mantém o valor gravado.

UPDATE processo_etapas
   SET ordem = CASE
     WHEN lower(etapa_nome) LIKE '%desistente%'
       OR lower(etapa_nome) LIKE '%reembolso%' THEN 9900
     WHEN etapa_nome LIKE 'Matr%culado%acad%'
       OR lower(etapa_nome) LIKE '%matricula academica conclu%' THEN 180
     WHEN lower(etapa_nome) LIKE '%matricula comercial conclu%' THEN 170
     WHEN etapa_nome LIKE 'Matr%culado%' THEN 165
     WHEN lower(etapa_nome) LIKE '%aptos para a matr%' THEN 160
     WHEN lower(etapa_nome) LIKE '%aprovado (vestibular)%' THEN 155
     WHEN lower(etapa_nome) LIKE '%documentos enviados%' THEN 150
     WHEN lower(etapa_nome) LIKE '%oportunidade (inscri%conclu%' THEN 140
     WHEN etapa_nome LIKE 'Pr%-inscri%' THEN 130
     WHEN etapa_nome LIKE 'Iniciou o processo de inscri%'
       OR lower(etapa_nome) LIKE 'iniciou o processo de inscr%' THEN 120
     WHEN etapa_nome LIKE 'Inscrito Parcial%' THEN 110
     WHEN lower(etapa_nome) LIKE '%quer se inscrever%' THEN 105
     WHEN lower(etapa_nome) LIKE '%oportunidade paga%' THEN 80
     WHEN lower(etapa_nome) LIKE '%oportunidade%' THEN 70
     WHEN lower(etapa_nome) LIKE '%em qualifica%' THEN 40
     WHEN lower(etapa_nome) LIKE '%conex%' THEN 30
     WHEN lower(etapa_nome) LIKE '%novo lead%' THEN 20
     WHEN lower(etapa_nome) LIKE '%interessados%' THEN 15
     WHEN lower(etapa_nome) LIKE '%contactado%' THEN 10
     WHEN macro_etapa = 'lead' THEN 150
     WHEN macro_etapa = 'qualificados' THEN 250
     WHEN macro_etapa = 'oportunidade' THEN 350
     WHEN macro_etapa = 'inscricao' THEN 450
     WHEN macro_etapa = 'matricula' THEN 550
     WHEN macro_etapa = 'ignorar' THEN 9900
     ELSE 7500
   END
 WHERE ordem = 100;
