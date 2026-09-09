/**
 * Quem é a pessoa por trás do lead — um lugar só.
 *
 * Antes desta biblioteca a normalização de e-mail e telefone existia DUAS
 * vezes, com implementações diferentes: uma em `schemas.ts`, usada quando o
 * webhook grava o lead, e outra em `cliques.ts`, usada quando o script do site
 * grava a captura do clique. As duas pontas precisam produzir exatamente a
 * mesma string, porque é por igualdade dela que o clique encontra o lead. Duas
 * cópias que "fazem a mesma coisa" só ficam iguais até alguém corrigir uma
 * delas — e o sintoma seria o cruzamento parar de casar, em silêncio, sem erro
 * em lugar nenhum.
 *
 * Aqui também mora a costura, que é o que faltava: o painel guarda uma linha
 * por etapa, e a identidade chega em algumas e falta em outras. Medido em
 * produção (05/09/2026): das 7.346 linhas, 3.510 vieram do sync do Rubeus e só
 * 10% delas têm e-mail. Mas 410 contatos que nunca tiveram e-mail em nenhuma
 * linha TÊM telefone em alguma. O dado estava no banco o tempo todo; ninguém
 * olhava para as outras linhas do mesmo contato.
 */

/**
 * E-mail canônico: minúsculo, sem espaço.
 *
 * Não remove ponto nem sufixo `+` — isso é regra do Gmail, e aplicá-la a
 * qualquer domínio inventaria um endereço diferente do real. A forma específica
 * que o Google exige antes do hash mora em `normalizarEmailParaHash`
 * (google.ts), que parte daqui.
 */
export function normalizarEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  /*
   * Exige um ponto DEPOIS do arroba.
   *
   * "joao@local" passava na versão antiga e virava um hash que nunca casa com
   * nada — e, pior, contava como "lead identificado" nas estatísticas de
   * atribuição, escondendo o tamanho real do problema.
   */
  const m = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  return m && e.length > 4 && e.length < 200 ? e : null;
}

/**
 * Telefone canônico: só dígitos, sempre com DDI.
 *
 * Aceita o formato que a Evolution manda (`5581999820742@s.whatsapp.net`) e o
 * nacional de 10/11 dígitos, ao qual acrescenta o 55. Número fora dessa faixa é
 * descartado em vez de virar hash que não casa com nada.
 */
export function normalizarTelefone(v: unknown): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  let d = String(v).split('@')[0]!.replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d.length >= 12 && d.length <= 15 ? d : null;
}

/**
 * CEP canônico: oito dígitos, sem máscara.
 *
 * Vai em CLARO para o Google (`postalCode` não é hasheado) e é o que completa o
 * identificador de endereço — sem ele, nome e sobrenome sozinhos não casam.
 */
export function normalizarCep(v: unknown): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const d = String(v).replace(/\D/g, '');
  return d.length === 8 ? d : null;
}

/**
 * Nome em duas partes, como o Google pede.
 *
 * Primeiro token é o nome, último é o sobrenome; o miolo — "de", "da", nomes do
 * meio — é descartado, que é a regra do próprio Google. Partícula solta como
 * sobrenome ("Silva" virando "de") faria o hash divergir do que o Google
 * calculou a partir do cadastro da pessoa, e o identificador não casaria.
 */
export function partirNome(nome: string | null | undefined): { primeiro: string; ultimo: string } | null {
  const limpo = (nome ?? '')
    .normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  const partes = limpo.filter((p) => !PARTICULAS.has(p) && p.length > 1);
  if (partes.length < 2) return null;
  return { primeiro: partes[0]!, ultimo: partes[partes.length - 1]! };
}

// -------------------------------------------------------------- a costura

export type Identidade = {
  email: string | null;
  telefone: string | null;
  nome: string | null;
  cep: string | null;
  /**
   * O contato que representa esta pessoa.
   *
   * Quase sempre é o próprio `contato_id` do lead. Deixa de ser quando a mesma
   * pessoa foi cadastrada duas vezes no Rubeus — ver `contatoCanonico`.
   */
  contatoCanonico: string;
  /** De onde saiu cada dado, para a tela explicar por que atribuiu ou não. */
  origem: string[];
};

/**
 * Junta tudo que o painel sabe sobre um contato, varrendo TODAS as linhas dele.
 *
 * Uma consulta ao D1 no lugar de uma ida ao Rubeus. Além de mais barata, é a
 * única que funciona quando o CRM está fora do ar — e o dado que ela acha é o
 * mesmo, porque foi de lá que veio.
 *
 * A ordem de preferência é "mais recente primeiro": se a pessoa corrigiu o
 * e-mail, é o novo que casa com o cadastro que o Google conhece.
 */
export async function identidadeDoContato(
  db: D1Database,
  contatoId: string,
  jaConhecido: { email?: string | null; telefone?: string | null; nome?: string | null } = {},
): Promise<Identidade> {
  const origem: string[] = [];
  let email = normalizarEmail(jaConhecido.email);
  let telefone = normalizarTelefone(jaConhecido.telefone);
  let nome = (jaConhecido.nome ?? '').trim() || null;
  let cep: string | null = null;

  if (email) origem.push('email:evento');
  if (telefone) origem.push('telefone:evento');

  /*
   * Só vai ao banco se ainda falta algo. O caso comum — webhook completo — não
   * paga consulta nenhuma.
   */
  if (email && telefone && nome && cep) {
    return { email, telefone, nome, cep, contatoCanonico: contatoId, origem };
  }

  const varrer = async (id: string, marca: string) => {
    const { results } = await db.prepare(
      `SELECT email, telefone, contato_nome, cep
         FROM leads_etapa
        WHERE contato_id = ?
          AND (email IS NOT NULL OR telefone IS NOT NULL
               OR contato_nome IS NOT NULL OR cep IS NOT NULL)
        ORDER BY registrado_em DESC, id DESC
        LIMIT 50`,
    ).bind(id).all();

    for (const l of results as Array<{
      email: string | null; telefone: string | null; contato_nome: string | null; cep: string | null;
    }>) {
      if (!email && l.email) {
        email = normalizarEmail(l.email);
        if (email) origem.push(`email:${marca}`);
      }
      if (!telefone && l.telefone) {
        telefone = normalizarTelefone(l.telefone);
        if (telefone) origem.push(`telefone:${marca}`);
      }
      if (!nome && l.contato_nome) nome = l.contato_nome.trim() || null;
      if (!cep && l.cep) {
        cep = normalizarCep(l.cep);
        if (cep) origem.push(`cep:${marca}`);
      }
    }
  };

  await varrer(contatoId, 'outra-etapa');

  const canonico = await contatoCanonico(db, contatoId, email, telefone);

  /*
   * Segunda varredura, no cadastro duplicado.
   *
   * Quando a mesma pessoa existe sob dois `contato_id`, cada cadastro costuma
   * ter METADE do dado — um tem o e-mail com que ela preencheu o formulário, o
   * outro tem o telefone e o CEP da ficha de inscrição. Parar na primeira
   * varredura deixaria de fora exatamente o identificador que o outro cadastro
   * guardava, que é o caso em que a duplicação mais atrapalha.
   *
   * Só roda quando há um canônico diferente — o caminho comum não paga nada.
   */
  if (canonico !== contatoId && (!email || !telefone || !cep)) {
    await varrer(canonico, 'contato-duplicado');
  }

  return { email, telefone, nome, cep, contatoCanonico: canonico, origem };
}

/**
 * O menor `contato_id` que compartilha e-mail ou telefone com este.
 *
 * Existe por um problema medido: 78 e-mails e 79 telefones aparecem sob
 * `contato_id` diferentes em produção — cerca de 90 cadastros que são a mesma
 * pessoa. Isso não é só estatística feia. O `orderId` da conversão é
 * `contato + evento`, e o Google deduplica por ele: a mesma matrícula sob dois
 * ids vira DUAS conversões na conta de anúncios, inflando o resultado que
 * decide lance de campanha.
 *
 * O menor id, e não o mais recente, porque precisa ser estável: o critério é
 * consultado a cada envio, e um alvo que muda quando um cadastro novo aparece
 * geraria um `orderId` diferente para a mesma conversão — exatamente a
 * duplicata que se quer evitar.
 *
 * Não funde cadastro nenhum no Rubeus. Só decide, na hora do envio, qual id
 * representa a pessoa. Fundir contato é decisão de quem opera o CRM.
 */
export async function contatoCanonico(
  db: D1Database,
  contatoId: string,
  email: string | null,
  telefone: string | null,
): Promise<string> {
  if (!email && !telefone) return contatoId;

  const linha = await db.prepare(
    `SELECT MIN(CAST(contato_id AS INTEGER)) AS menor
       FROM leads_etapa
      WHERE (? IS NOT NULL AND email = ?)
         OR (? IS NOT NULL AND telefone = ?)`,
  ).bind(email, email, telefone, telefone).first() as { menor: number | null } | null;

  const menor = linha?.menor;
  if (menor == null) return contatoId;

  /*
   * Compara como número, devolve como texto.
   *
   * `contato_id` é TEXT no banco (o Rubeus manda string), então `MIN` textual
   * diria que "10" é menor que "9". O CAST resolve a comparação; a volta para
   * texto mantém o tipo que o resto do código espera.
   */
  const atual = Number(contatoId);
  return Number.isFinite(atual) && menor < atual ? String(menor) : contatoId;
}
