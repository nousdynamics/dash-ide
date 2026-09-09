-- Pós-reunião Nathália: ocultar etapas + "iniciou o processo" fora do funil.
--
-- `visivel = 0` tira a etapa da esteira e das contagens do detalhe por processo.
-- `macro_etapa` NULL já tira do Macro consolidado.
--
-- "Iniciou o processo de inscrição" estava em oportunidade (0019) e inflava o
-- funil; a Ata pede que não polua nenhum nível.

ALTER TABLE processo_etapas ADD COLUMN visivel INTEGER NOT NULL DEFAULT 1;

UPDATE processo_etapas
   SET macro_etapa = NULL
 WHERE etapa_nome LIKE 'Iniciou o processo de inscri%'
    OR lower(etapa_nome) LIKE 'iniciou o processo de inscr%';
