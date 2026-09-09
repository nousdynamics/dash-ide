-- O que o Google fez com a conversão DEPOIS de aceitar a requisição.
--
-- O que faltava para o envio estar realmente conectado: `HTTP 200` na Data
-- Manager API não quer dizer "conversão contabilizada". Quer dizer "requisição
-- aceita para processamento". O resultado real sai minutos depois, noutro
-- endpoint (`requestStatus:retrieve`), e é lá que aparece se o e-mail em hash
-- casou, se o gclid tinha expirado, se a ação de conversão recusou o registro.
--
-- Sem guardar o `requestId` que a ingestão devolve, esse resultado é
-- inalcançável: o endpoint de diagnóstico só aceita ser consultado por ele. E
-- sem consultá-lo o painel ficaria dizendo "enviada" para linhas que o Google
-- descartou — que é exatamente o modo de falha que a tabela `conversoes_offline`
-- foi criada para não ter.

-- ------------------------------------------------------ na linha da conversão

/*
 * O `requestId` da requisição que levou esta linha ao Google.
 *
 * Uma requisição carrega o lote inteiro de uma ação de conversão, então o mesmo
 * id se repete em várias linhas. Guardar por linha — em vez de só na tabela de
 * requisições — é o que permite responder "o que aconteceu com ESTA conversão"
 * sem um join que a tela de registro faria a cada abertura.
 */
ALTER TABLE conversoes_offline ADD COLUMN request_id TEXT;

/*
 * O veredito do processamento: SUCCESS, PARTIAL_SUCCESS, FAILED ou PROCESSING.
 *
 * Coluna separada de `status` de propósito. `status` é o que o PAINEL fez
 * (enviou, não enviou, por quê) — isto é o que o GOOGLE fez com o que recebeu.
 * Fundir os dois perderia a distinção que mais importa quando o número não bate:
 * "nós não mandamos" e "mandamos e o Google não aproveitou" pedem correções
 * opostas — uma no mapa de etapas, outra na qualidade do identificador.
 */
ALTER TABLE conversoes_offline ADD COLUMN diagnostico TEXT;
ALTER TABLE conversoes_offline ADD COLUMN diagnostico_em TEXT;

/*
 * Avisos de campo devolvidos já na ingestão (`fieldWarnings`).
 *
 * Não derrubam a requisição — e é justamente por isso que precisam ficar
 * guardados. Um aviso de "telefone ignorado por formato" some do console e o
 * envio continua parecendo perfeito, com metade dos identificadores descartados
 * em silêncio.
 */
ALTER TABLE conversoes_offline ADD COLUMN avisos TEXT;

CREATE INDEX idx_conversoes_request ON conversoes_offline (request_id);
-- O monitor filtra por curso, nível e evento dentro de uma janela de datas.
CREATE INDEX idx_conversoes_ocorrido ON conversoes_offline (ocorrido_em);
CREATE INDEX idx_conversoes_nivel ON conversoes_offline (nivel_ensino);

-- ----------------------------------------------------- a fila de diagnóstico

/*
 * Uma linha por requisição enviada à Data Manager API.
 *
 * Existe porque o diagnóstico não é síncrono: o Google pede 30 minutos antes de
 * ter resposta, e depois disso a recomendação é backoff de 1,3× até 24 h. Isso
 * é uma fila com horário próprio, e fila com horário não cabe em coluna de
 * outra tabela — precisaria varrer `conversoes_offline` inteira a cada rodada
 * para achar quais requisições ainda devem ser consultadas.
 *
 * Também é o que evita consultar a mesma requisição uma vez por linha: um lote
 * de 60 conversões é UMA requisição e UMA consulta de status.
 */
CREATE TABLE conversao_requisicoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  /* O id devolvido pela ingestão. Único: é a chave do endpoint de diagnóstico. */
  request_id TEXT NOT NULL UNIQUE,

  conversion_action_id TEXT,
  conversion_action_nome TEXT,
  eventos INTEGER NOT NULL DEFAULT 0,
  modo TEXT NOT NULL DEFAULT 'teste',

  /* SUCCESS | PARTIAL_SUCCESS | FAILED | PROCESSING | nulo (nunca consultado) */
  status TEXT,
  /*
   * Contagens por motivo, como o Google devolve: quantos registros caíram em
   * cada `reason`. Guardado como JSON porque a lista de motivos é do Google e
   * cresce sem avisar — uma coluna por motivo viraria migration a cada release
   * deles.
   */
  erros TEXT,
  avisos TEXT,

  verificado_em TEXT,
  tentativas INTEGER NOT NULL DEFAULT 0,

  /*
   * Quando vale a pena perguntar de novo.
   *
   * Nasce em +30 min porque antes disso o Google responde PROCESSING e a
   * consulta só gasta cota. Depois cresce por backoff — ver `conferirDiagnosticos`.
   */
  proxima_verificacao TEXT NOT NULL,
  criado_em TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_requisicoes_pendentes
  ON conversao_requisicoes (proxima_verificacao)
  WHERE status IS NULL OR status = 'PROCESSING';
