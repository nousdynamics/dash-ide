/**
 * Avaliador de fórmula de métrica.
 *
 * Existe para não usar `eval`. A fórmula é escrita por quem usa o painel, e o
 * painel é autenticado — mas "autenticado" não é "confiável para executar
 * código arbitrário no navegador de todo mundo". Uma conta comprometida
 * escreveria uma fórmula que rouba a sessão de quem abrir a tela.
 *
 * O que aceita: números, os identificadores da lista, + - * / e parênteses.
 * Qualquer outra coisa é erro de sintaxe, não um caminho para execução.
 */

export type Contexto = Record<string, number>;

type Token =
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'op'; v: '+' | '-' | '*' | '/' }
  | { t: 'par'; v: '(' | ')' };

export class FormulaInvalida extends Error {}

function tokenizar(entrada: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < entrada.length) {
    const c = entrada[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < entrada.length && /[0-9.]/.test(entrada[j]!)) j++;
      const v = Number(entrada.slice(i, j));
      if (Number.isNaN(v)) throw new FormulaInvalida(`número inválido: ${entrada.slice(i, j)}`);
      tokens.push({ t: 'num', v });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < entrada.length && /[a-zA-Z0-9_]/.test(entrada[j]!)) j++;
      tokens.push({ t: 'id', v: entrada.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '+' || c === '-' || c === '*' || c === '/') {
      tokens.push({ t: 'op', v: c });
      i++;
      continue;
    }
    if (c === '(' || c === ')') {
      tokens.push({ t: 'par', v: c });
      i++;
      continue;
    }
    throw new FormulaInvalida(`caractere não permitido: "${c}"`);
  }
  return tokens;
}

/**
 * Descida recursiva, com a precedência de sempre: * e / antes de + e -.
 *
 * Menor que shunting-yard e mais fácil de conferir de olho, que é o que
 * importa num pedaço de código cujo trabalho é ser seguro.
 */
function analisar(tokens: Token[], ctx: Contexto): number {
  let pos = 0;

  const espiar = () => tokens[pos];
  const consumir = () => tokens[pos++];

  function expressao(): number {
    let esq = termo();
    for (;;) {
      const t = espiar();
      if (t?.t === 'op' && (t.v === '+' || t.v === '-')) {
        consumir();
        const dir = termo();
        esq = t.v === '+' ? esq + dir : esq - dir;
      } else return esq;
    }
  }

  function termo(): number {
    let esq = fator();
    for (;;) {
      const t = espiar();
      if (t?.t === 'op' && (t.v === '*' || t.v === '/')) {
        consumir();
        const dir = fator();
        // Divisão por zero vira NaN de propósito: a tela mostra "—" em vez de
        // Infinity, que num card de métrica só assusta.
        esq = t.v === '*' ? esq * dir : dir === 0 ? NaN : esq / dir;
      } else return esq;
    }
  }

  function fator(): number {
    const t = consumir();
    if (!t) throw new FormulaInvalida('fórmula termina antes da hora');
    if (t.t === 'num') return t.v;
    if (t.t === 'id') {
      /*
       * `Object.hasOwn`, nunca `in`: `in` percorre o protótipo, então
       * "constructor", "toString" e "__proto__" passariam como se fossem
       * métricas e devolveriam uma função onde a conta espera número.
       */
      if (!Object.hasOwn(ctx, t.v)) throw new FormulaInvalida(`métrica desconhecida: "${t.v}"`);
      const v = ctx[t.v];
      // `null` é ausência declarada, não zero. Ver o mesmo trecho em
      // app/src/lib/formula.js — os dois avaliadores andam juntos.
      if (v === null) throw new FormulaInvalida(`sem dado no período para "${t.v}"`);
      if (typeof v !== 'number') throw new FormulaInvalida(`métrica sem valor numérico: "${t.v}"`);
      return v;
    }
    if (t.t === 'op' && t.v === '-') return -fator();
    if (t.t === 'par' && t.v === '(') {
      const v = expressao();
      const fecha = consumir();
      if (!fecha || fecha.t !== 'par' || fecha.v !== ')') throw new FormulaInvalida('falta fechar parêntese');
      return v;
    }
    throw new FormulaInvalida('esperava número, métrica ou parêntese');
  }

  const valor = expressao();
  if (pos !== tokens.length) throw new FormulaInvalida('sobrou conteúdo depois do fim da fórmula');
  return valor;
}

/** Calcula. Devolve `null` quando o resultado não é número utilizável. */
export function avaliar(formula: string, ctx: Contexto): number | null {
  const v = analisar(tokenizar(formula), ctx);
  return Number.isFinite(v) ? v : null;
}

/**
 * Confere a fórmula sem ter os valores.
 *
 * Usa 1 para toda métrica conhecida: o que importa aqui é a sintaxe e se todo
 * identificador existe, não quanto dá. Roda na hora de salvar, para o erro
 * aparecer para quem escreveu e não para quem abrir a tela depois.
 */
export function validarFormula(formula: string, nomesConhecidos: string[]): string | null {
  // Sem protótipo: o contexto só contém o que foi posto nele.
  const ctx: Contexto = Object.assign(Object.create(null), Object.fromEntries(nomesConhecidos.map((n) => [n, 1])));
  try {
    analisar(tokenizar(formula), ctx);
    return null;
  } catch (e) {
    return e instanceof FormulaInvalida ? e.message : 'fórmula inválida';
  }
}
