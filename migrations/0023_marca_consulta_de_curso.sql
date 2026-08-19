-- Marca quem já foi perguntado ao Rubeus, com ou sem resposta útil.
--
-- O resgate de curso pela API rodava sempre nos mesmos contatos. A fila era
-- "quem não tem curso", ordenada pelo evento mais recente — e boa parte dessa
-- fila é gente que o Rubeus responde com `curso: null` e "Sem oferta de curso",
-- porque são leads que ainda não escolheram curso nenhum. Não há o que resgatar
-- neles, então nunca saíam da fila, e cada rodada gastava o lote inteiro
-- perguntando de novo pelos mesmos: 8 resolvidos a cada 120 consultados.
--
-- Com a marca, "perguntei e não havia" é um estado registrado em vez de uma
-- pergunta a repetir. A fila anda, e o lote diário passa a atacar quem ainda
-- não foi visto.
--
-- Fica com a data, não com um booleano: um lead sem curso hoje pode escolher um
-- amanhã, e daqui a algum tempo vale perguntar de novo. Booleano fecharia essa
-- porta e exigiria outra migration para reabrir.

ALTER TABLE leads_etapa ADD COLUMN curso_consultado_em TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_etapa_consulta
  ON leads_etapa (curso_consultado_em);
