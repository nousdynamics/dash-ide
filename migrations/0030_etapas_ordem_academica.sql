-- Acento em ACADÊMICA / Acadêmico: lower()+LIKE ASCII da 0029 não casava.
-- Idempotente — reforça COMERCIAL → ACADÊMICA nessa ordem.

UPDATE processo_etapas
   SET ordem = 170
 WHERE etapa_nome LIKE '%ACAD%MICA%'
    OR etapa_nome LIKE '%Acad%mica%'
    OR etapa_nome LIKE '%acad%mica%'
    OR etapa_nome LIKE 'Matr%culado Acad%';

UPDATE processo_etapas
   SET ordem = 160
 WHERE etapa_nome LIKE '%COMERCIAL conclu%'
    OR etapa_nome LIKE '%comercial conclu%';
