/**
 * Vocabulário da conversão offline — um lugar só.
 *
 * Estava duplicado entre a tela de configuração e a de monitor: as mesmas
 * chaves de status, com os mesmos rótulos, escritas duas vezes. Duas cópias
 * ficam iguais só até alguém renomear uma delas, e aí a mesma conversão aparece
 * como "recusada pelo Google" numa tela e "erro_api" na outra, sem que nada
 * quebre para avisar.
 */

/**
 * O que o PAINEL fez com a conversão.
 *
 * Deliberadamente separado do veredito do Google, abaixo. "Nós não mandamos" e
 * "mandamos e o Google não aproveitou" pedem correções opostas — uma no mapa de
 * etapas, outra na qualidade do identificador —, e uma coluna só apagaria essa
 * diferença justamente quando ela importa.
 */
export const ROTULO_STATUS = {
  enviada: 'enviada',
  simulada: 'simulada (modo teste)',
  erro_api: 'recusada pelo Google',
  sem_identificador: 'sem gclid nem e-mail',
  sem_acao: 'sem ação cadastrada',
  pendente: 'na fila',
};

export const TOM_STATUS = {
  enviada: 'sucesso',
  simulada: 'neutro',
  erro_api: 'perigo',
  sem_identificador: 'atencao',
  sem_acao: 'atencao',
  pendente: 'neutro',
};

/** O que o GOOGLE fez depois de aceitar a requisição (`requestStatus`). */
export const ROTULO_DIAGNOSTICO = {
  SUCCESS: 'Google processou',
  PARTIAL_SUCCESS: 'Google aproveitou em parte',
  FAILED: 'Google descartou',
  PROCESSING: 'processando',
  REQUEST_STATUS_UNKNOWN: 'sem resposta',
};

export const TOM_DIAGNOSTICO = {
  SUCCESS: 'sucesso',
  PARTIAL_SUCCESS: 'atencao',
  FAILED: 'perigo',
  PROCESSING: 'neutro',
  REQUEST_STATUS_UNKNOWN: 'neutro',
};

/**
 * Fallback dos nomes de evento.
 *
 * A fonte é o servidor, que manda `eventos: [{id, rotulo}]` — é ele que conhece
 * os eventos que a conta mede. Isto aqui só cobre a tabela do registro, que
 * mostra linhas antigas cujo evento pode não estar mais na lista ativa.
 */
export const ROTULO_EVENTO = {
  inscricao_concluida: 'Inscrição concluída',
  pagamento_realizado: 'Pagamento realizado',
};

/**
 * Como o lead foi ligado ao clique, do mais forte para o mais fraco.
 *
 * A ordem é a da qualidade da atribuição: click id é exato, endereço e
 * e-mail/telefone são probabilísticos, e nada é lead que não dá para atribuir.
 */
export const ROTULO_IDENTIFICADOR = {
  gclid: 'clique (gclid)',
  gbraid: 'clique (gbraid)',
  wbraid: 'clique (wbraid)',
  email: 'e-mail',
  telefone: 'telefone',
  endereco: 'nome + CEP',
};

/** Traduz "email+telefone+endereco" na frase que a tabela mostra. */
export function descreverIdentificadores(bruto) {
  if (!bruto) return null;
  return String(bruto)
    .split('+')
    .map((p) => ROTULO_IDENTIFICADOR[p.trim()] ?? p.trim())
    .join(' + ');
}
