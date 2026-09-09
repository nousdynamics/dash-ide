/**
 * Captura do identificador de clique e cruzamento com o lead.
 *
 * O gclid nasce e morre no navegador: entra na URL do anúncio, e some quando a
 * pessoa fecha a aba. O CRM só o conhece se alguém o entregar — e é aí que o
 * fluxo do n8n falhava em silêncio, procurando no Rubeus um campo que nada
 * preenchia.
 *
 * A ponte tem três tempos:
 *
 *   1. CAPTURA — um script de primeira parte guarda o click id do visitante e,
 *      quando ele preenche um formulário, manda click id + e-mail + telefone
 *      para cá. É o único instante em que as duas pontas estão na mesma tela.
 *   2. CRUZAMENTO — o webhook do Rubeus traz o lead com e-mail e telefone; o
 *      painel procura aqui a captura mais recente daquela pessoa.
 *   3. DEVOLUÇÃO — o click id é escrito no campo personalizado do Rubeus, para
 *      que o CRM passe a ter o dado, e é usado na conversão do Google Ads.
 *
 * O passo 3 é o que faz o CRM parar de ser só destino e virar registro: quem
 * abrir a ficha do lead vê de qual clique ele veio, sem depender deste painel.
 */

import { acharColunaClickId, gravarCampoDoContato } from './rubeus';

/** Janela do cruzamento. O gclid do Google vale 90 dias; casar além disso é chute. */
const JANELA_DIAS = 90;

export type Clique = {
  id: number;
  click_id_tipo: 'gclid' | 'gbraid' | 'wbraid';
  click_id_valor: string;
  email: string | null;
  telefone: string | null;
  capturado_em: string;
};

/**
 * Um click id do Google tem cara de click id.
 *
 * O endpoint de captura é público — precisa ser, roda no navegador de quem
 * visita o site. Sem uma forma mínima, qualquer um encheria a tabela de lixo
 * pareado com e-mails reais e envenenaria a atribuição. Isto não é
 * autenticação; é o filtro que separa erro de integração de dado plausível.
 */
export function clickIdValido(valor: string): boolean {
  return /^[A-Za-z0-9_\-.]{20,512}$/.test(valor);
}

/*
 * A normalização vem da biblioteca única — ver `src/lib/identidade.ts`.
 *
 * Antes havia uma cópia aqui e outra em `schemas.ts`. As duas precisam produzir
 * a MESMA string, porque o cruzamento entre a captura do clique e o lead do CRM
 * é uma comparação de igualdade entre elas. Reexportadas para não quebrar quem
 * já as importava daqui.
 */
export { normalizarEmail, normalizarTelefone } from './identidade';
import { normalizarEmail, normalizarTelefone } from './identidade';

/**
 * Guarda uma captura.
 *
 * `INSERT OR IGNORE` sobre o índice único: o script dispara a cada envio de
 * formulário e a mesma pessoa reenvia — validação que falhou, dois cursos, a
 * volta do "corrigir e-mail". Todas essas são a mesma captura.
 */
export async function registrarCaptura(
  db: D1Database,
  dados: {
    tipo: 'gclid' | 'gbraid' | 'wbraid';
    valor: string;
    email: string | null;
    telefone: string | null;
    pagina: string | null;
    origemSite: string | null;
  },
): Promise<boolean> {
  const { meta } = await db.prepare(
    `INSERT OR IGNORE INTO cliques_capturados
       (click_id_tipo, click_id_valor, email, telefone, pagina, origem_site)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(
    dados.tipo, dados.valor, dados.email, dados.telefone,
    dados.pagina?.slice(0, 300) ?? null, dados.origemSite,
  ).run();
  return Boolean(meta.changes);
}

/**
 * Acha o clique daquela pessoa, do mais recente para o mais antigo.
 *
 * E-mail e telefone valem igual — o formulário do Rubeus às vezes traz um, às
 * vezes o outro, e exigir os dois perderia metade dos cruzamentos possíveis.
 * Entre várias capturas da mesma pessoa vence a última: é o clique que a levou
 * a se inscrever, não o que ela deu duas semanas antes e abandonou.
 */
export async function procurarClique(
  db: D1Database,
  chaves: { email?: string | null; telefone?: string | null },
): Promise<Clique | null> {
  const email = chaves.email ? normalizarEmail(chaves.email) : null;
  const telefone = chaves.telefone ? normalizarTelefone(chaves.telefone) : null;
  if (!email && !telefone) return null;

  const corte = new Date(Date.now() - JANELA_DIAS * 86_400_000).toISOString();

  const linha = await db.prepare(
    `SELECT id, click_id_tipo, click_id_valor, email, telefone, capturado_em
       FROM cliques_capturados
      WHERE capturado_em >= ?
        AND ((? IS NOT NULL AND email = ?) OR (? IS NOT NULL AND telefone = ?))
      ORDER BY capturado_em DESC
      LIMIT 1`,
  ).bind(corte, email, email, telefone, telefone).first();

  return (linha as Clique | null) ?? null;
}

/** Anota que aquele clique achou dono — a tela mostra o casamento acontecendo. */
export async function marcarCasado(
  db: D1Database,
  cliqueId: number,
  contatoId: string,
): Promise<void> {
  await db.prepare(
    `UPDATE cliques_capturados
        SET contato_id = ?, casado_em = COALESCE(casado_em, datetime('now'))
      WHERE id = ?`,
  ).bind(contatoId, cliqueId).run();
}

// ------------------------------------------------------- devolver ao Rubeus

type Colunas = { gclid?: string; gbraid?: string; wbraid?: string };

/**
 * A coluna do campo personalizado, descoberta e guardada.
 *
 * Descobrir custa uma chamada ao Rubeus, e o catálogo de campos muda uma vez
 * por semestre — então o resultado fica em `conversao_config`. `forcar` existe
 * para o botão da tela: é exatamente o que se aperta depois de criar o campo no
 * CRM, sem esperar cache nenhum vencer.
 */
export async function colunasDoClickId(
  env: Env,
  forcar = false,
): Promise<Colunas> {
  if (!forcar) {
    const guardado = await env.DB.prepare(
      `SELECT valor FROM conversao_config WHERE chave = 'clickid_coluna'`,
    ).first() as { valor: string | null } | null;
    if (guardado?.valor) {
      try {
        return JSON.parse(guardado.valor) as Colunas;
      } catch { /* valor corrompido: redescobre abaixo */ }
    }
  }

  const colunas = await acharColunaClickId(env);
  await env.DB.prepare(
    `INSERT INTO conversao_config (chave, valor) VALUES ('clickid_coluna', ?)
     ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor, atualizado_em = datetime('now')`,
  ).bind(JSON.stringify(colunas)).run();

  console.log(JSON.stringify({
    evento: 'clickid_coluna_descoberta',
    achou: Object.entries(colunas).filter(([, v]) => v).map(([k]) => k),
  }));
  return colunas;
}

/**
 * Escreve o click id no campo personalizado do contato.
 *
 * Nunca é chamada sem o interruptor ligado — quem chama confere antes. É a
 * única escrita que este painel faz no CRM, e o endpoint do Rubeus é o mesmo
 * que cria contato: errar aqui não devolve erro, altera o cadastro real de uma
 * pessoa. Falha não propaga: a conversão já tem o click id em mãos e vai ser
 * enviada de qualquer jeito, então não conseguir gravar no CRM é perder o
 * registro, não perder a conversão.
 */
export async function devolverAoRubeus(
  env: Env,
  clique: Clique,
  contatoId: string,
  email: string | null,
): Promise<'gravado' | 'sem_campo' | 'falhou'> {
  const colunas = await colunasDoClickId(env);
  const coluna = colunas[clique.click_id_tipo];
  if (!coluna) return 'sem_campo';

  try {
    await gravarCampoDoContato(env, contatoId, email, coluna, clique.click_id_valor);
    await env.DB.prepare(
      `UPDATE cliques_capturados SET escrito_no_rubeus_em = datetime('now') WHERE id = ?`,
    ).bind(clique.id).run();
    return 'gravado';
  } catch (e) {
    console.warn(JSON.stringify({
      evento: 'rubeus_escrita_falhou', contato_id: contatoId, coluna, msg: String(e),
    }));
    return 'falhou';
  }
}
