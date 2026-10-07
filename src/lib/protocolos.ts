/**
 * Protocolo do botão de WhatsApp — o clique no site e a conversa, ligados.
 *
 * Quem chama no WhatsApp pelo site não preenche formulário: sai da página sem
 * deixar e-mail nem telefone, e o script de captura não tem o que cruzar. O
 * que a pessoa leva é a mensagem pronta do botão. O script acrescenta a ela
 * `[Protocolo: IDE-XXXXXX]` e grava aqui o código com a origem da visita.
 *
 * Três tempos, como o click id (ver cliques.ts):
 *
 *   1. GERAÇÃO — no navegador, no clique do botão. Não espera o servidor: o
 *      código sai antes do beacon, e o WhatsApp abre na hora. Esperar uma ida
 *      ao painel para gerar o número atrasaria justamente o clique que mais
 *      converte, e uma falha de rede custaria a conversa.
 *   2. VÍNCULO — a ferramenta de atendimento (Blip) avisa que chegou mensagem;
 *      o painel acha o código no texto e anota o telefone de quem mandou.
 *   3. CRUZAMENTO — pelo telefone, como o resto do painel: etapa no Rubeus e,
 *      se o clique veio de anúncio, o gclid vira captura para a conversão
 *      offline.
 *
 * O formato da mensagem da ferramenta ainda não é conhecido (o acesso ao Blip
 * não saiu), então a leitura é deliberadamente tolerante: procura o código em
 * qualquer texto do corpo e o telefone nos campos de costume de cada
 * ferramenta. O formato do Blip (`from: 5581…@wa.gw.msging.net`, `content`)
 * já é coberto.
 */

import { registrarCaptura } from './cliques';
import { normalizarTelefone } from './identidade';

/**
 * Alfabeto sem os caracteres que se confundem lidos em voz alta ou na tela do
 * celular: 0/O, 1/I/L. O atendente às vezes digita o código à mão, e um "O"
 * lido como "0" é um protocolo que não casa.
 *
 * 31 símbolos ^ 6 ≈ 887 milhões de códigos. Com o volume desta operação
 * (centenas de cliques por dia) a chance de colisão é desprezível, e o índice
 * único descarta a segunda em vez de misturar duas pessoas.
 */
export const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const PREFIXO = 'IDE-';
const TAMANHO = 6;

/**
 * Acha o código num texto qualquer.
 *
 * Não exige os colchetes nem a palavra "Protocolo": a pessoa pode apagar parte
 * da mensagem, e o WhatsApp às vezes troca o colchete na formatação. O prefixo
 * `IDE-` com seis símbolos do alfabeto já é específico o bastante.
 *
 * Fica com o ÚLTIMO código do texto: se a pessoa colou uma mensagem antiga e o
 * botão acrescentou um novo, o novo está no fim.
 */
const PADRAO = new RegExp(`\\b${PREFIXO}([${ALFABETO}]{${TAMANHO}})\\b`, 'gi');

export function extrairCodigo(texto: string): string | null {
  const achados = [...texto.matchAll(PADRAO)];
  const ultimo = achados[achados.length - 1];
  return ultimo ? `${PREFIXO}${ultimo[1]!.toUpperCase()}` : null;
}

export function codigoValido(v: unknown): v is string {
  return typeof v === 'string' && new RegExp(`^${PREFIXO}[${ALFABETO}]{${TAMANHO}}$`).test(v);
}

/**
 * As duas formas de um celular brasileiro: com e sem o nono dígito.
 *
 * O WhatsApp entrega número antigo sem o 9 (`55 81 9999-9999`, 12 dígitos), e
 * o Rubeus guarda com ele. Medido em 05/10/2026: 9.397 telefones de lead com 13
 * dígitos e 156 com 12. Comparar por igualdade crua perderia exatamente quem
 * tem conta de WhatsApp antiga. Fixo de 12 dígitos (local começando em 2–5)
 * não ganha variante — lá o 9 não existe.
 */
export function variantesTelefone(t: string | null): string[] {
  if (!t) return [];
  if (!t.startsWith('55')) return [t];
  if (t.length === 13 && t[4] === '9') return [t, t.slice(0, 4) + t.slice(5)];
  if (t.length === 12 && /[6-9]/.test(t[4]!)) return [t.slice(0, 4) + '9' + t.slice(4), t];
  return [t];
}

/** A forma que se grava: com o nono dígito, que é a do Rubeus. */
export function telefoneCanonico(v: unknown): string | null {
  return variantesTelefone(normalizarTelefone(v))[0] ?? null;
}

// ------------------------------------------------- leitura da mensagem

export type Mensagem = {
  codigo: string | null;
  telefone: string | null;
  nome: string | null;
  /** Mensagem que o próprio atendimento mandou — não é do lead. */
  enviadaPorNos: boolean;
};

/*
 * Onde cada ferramenta põe quem mandou. Ordem importa: os campos explícitos
 * vêm antes de `from`, porque em evento de mensagem ENVIADA o `from` é o
 * número da própria faculdade.
 *
 *   genérico/n8n : telefone, phone
 *   Blip         : from ("5581…@wa.gw.msging.net"), customerIdentity (Desk)
 *   Evolution    : key.remoteJid
 *   Meta Cloud   : wa_id, contacts[].wa_id
 */
const CAMPOS_TELEFONE = ['telefone', 'phone', 'wa_id', 'remoteJid', 'customerIdentity', 'from', 'sender'];
const CAMPOS_NOME = ['contato_nome', 'nome', 'name', 'pushName', 'fullName'];

/** Varre o corpo em largura: o campo mais raso vence o mais fundo. */
function* emLargura(raiz: unknown): Generator<[string, unknown]> {
  const fila: unknown[] = [raiz];
  let visitados = 0;
  while (fila.length && visitados < 500) {
    const no = fila.shift();
    visitados += 1;
    if (Array.isArray(no)) {
      fila.push(...no);
    } else if (no && typeof no === 'object') {
      for (const [k, v] of Object.entries(no)) {
        yield [k, v];
        if (v && typeof v === 'object') fila.push(v);
      }
    }
  }
}

export function lerMensagem(corpo: unknown): Mensagem {
  const campos = [...emLargura(corpo)];

  /*
   * O código pode estar em `content`, `text`, `body`, `conversation`,
   * `message.text.body`… Em vez de listar cada ferramenta, procura em todo
   * texto do corpo. É seguro porque o padrão é específico demais para casar
   * por acaso.
   */
  let codigo: string | null = null;
  for (const [, v] of campos) {
    if (typeof v === 'string') codigo = extrairCodigo(v) ?? codigo;
  }

  const enviadaPorNos = campos.some(([k, v]) =>
    (k === 'fromMe' && v === true) || (k === 'direction' && String(v).toLowerCase() === 'sent'));

  let telefone: string | null = null;
  for (const chave of CAMPOS_TELEFONE) {
    const achado = campos.find(([k, v]) => k === chave && (typeof v === 'string' || typeof v === 'number'));
    telefone = achado ? telefoneCanonico(achado[1]) : null;
    if (telefone) break;
  }

  let nome: string | null = null;
  for (const chave of CAMPOS_NOME) {
    const achado = campos.find(([k, v]) => k === chave && typeof v === 'string' && v.trim());
    if (achado) {
      nome = String(achado[1]).trim().slice(0, 120);
      break;
    }
  }

  return { codigo, telefone, nome, enviadaPorNos };
}

// ------------------------------------------------------------ vínculo

export type Vinculo =
  | { resultado: 'vinculado'; codigo: string; capturouClique: boolean }
  | { resultado: 'ja_vinculado' | 'desconhecido'; codigo: string };

/**
 * Anota de quem é o protocolo.
 *
 * Só o PRIMEIRO telefone vale. Um protocolo que reaparece vindo de outro
 * número é alguém repassando a mensagem — o clique foi de quem mandou
 * primeiro, e trocar o dono depois apagaria a atribuição certa.
 *
 * Quando o clique veio de anúncio, o gclid vira uma captura comum em
 * `cliques_capturados`, com o telefone. É o que faltava para o lead que só
 * falou pelo WhatsApp: a conversão offline já procura o clique pelo telefone
 * (cliques.ts), então nada mais precisa saber que existe protocolo.
 */
export async function vincular(
  db: D1Database,
  codigo: string,
  telefone: string,
  nome: string | null,
  fonte: string,
): Promise<Vinculo> {
  const { meta } = await db.prepare(
    `UPDATE protocolos_whatsapp
        SET telefone = ?, contato_nome = ?, fonte = ?, mensagem_em = datetime('now')
      WHERE codigo = ? AND telefone IS NULL`,
  ).bind(telefone, nome, fonte, codigo).run();

  if (!meta.changes) {
    const existe = await db.prepare('SELECT 1 FROM protocolos_whatsapp WHERE codigo = ?').bind(codigo).first();
    return { resultado: existe ? 'ja_vinculado' : 'desconhecido', codigo };
  }

  const p = await db.prepare(
    `SELECT click_id_tipo, click_id_valor, pagina, origem_site FROM protocolos_whatsapp WHERE codigo = ?`,
  ).bind(codigo).first() as {
    click_id_tipo: 'gclid' | 'gbraid' | 'wbraid' | null;
    click_id_valor: string | null;
    pagina: string | null;
    origem_site: string | null;
  } | null;

  let capturouClique = false;
  if (p?.click_id_tipo && p.click_id_valor) {
    capturouClique = await registrarCaptura(db, {
      tipo: p.click_id_tipo,
      valor: p.click_id_valor,
      email: null,
      telefone,
      pagina: p.pagina,
      origemSite: p.origem_site,
    });
  }
  return { resultado: 'vinculado', codigo, capturouClique };
}
