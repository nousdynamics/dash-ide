/*
 * Mesma gramática do avaliador do Worker (src/lib/formula.ts).
 *
 * Duplicado de propósito: a tela precisa calcular enquanto a pessoa digita, sem
 * ida ao servidor, e o servidor precisa validar sem confiar na tela. Manter os
 * dois lados iguais é o preço; importar TypeScript do Worker no bundle do
 * navegador custaria mais.
 */
export class FormulaInvalida extends Error {}

function tokenizar(entrada) {
  const tokens = [];
  let i = 0;
  while (i < entrada.length) {
    const c = entrada[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < entrada.length && /[0-9.]/.test(entrada[j])) j++;
      const v = Number(entrada.slice(i, j));
      if (Number.isNaN(v)) throw new FormulaInvalida(`número inválido: ${entrada.slice(i, j)}`);
      tokens.push({ t: 'num', v }); i = j; continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < entrada.length && /[a-zA-Z0-9_]/.test(entrada[j])) j++;
      tokens.push({ t: 'id', v: entrada.slice(i, j) }); i = j; continue;
    }
    if ('+-*/'.includes(c)) { tokens.push({ t: 'op', v: c }); i++; continue; }
    if (c === '(' || c === ')') { tokens.push({ t: 'par', v: c }); i++; continue; }
    throw new FormulaInvalida(`caractere não permitido: "${c}"`);
  }
  return tokens;
}

function analisar(tokens, ctx) {
  let pos = 0;
  const espiar = () => tokens[pos];
  const consumir = () => tokens[pos++];

  function expressao() {
    let esq = termo();
    for (;;) {
      const t = espiar();
      if (t?.t === 'op' && (t.v === '+' || t.v === '-')) {
        consumir(); const dir = termo();
        esq = t.v === '+' ? esq + dir : esq - dir;
      } else return esq;
    }
  }
  function termo() {
    let esq = fator();
    for (;;) {
      const t = espiar();
      if (t?.t === 'op' && (t.v === '*' || t.v === '/')) {
        consumir(); const dir = fator();
        esq = t.v === '*' ? esq * dir : dir === 0 ? NaN : esq / dir;
      } else return esq;
    }
  }
  function fator() {
    const t = consumir();
    if (!t) throw new FormulaInvalida('fórmula termina antes da hora');
    if (t.t === 'num') return t.v;
    if (t.t === 'id') {
      // hasOwn, nunca `in`: `in` acha "constructor" no protótipo.
      if (!Object.hasOwn(ctx, t.v)) throw new FormulaInvalida(`métrica desconhecida: "${t.v}"`);
      const v = ctx[t.v];
      if (typeof v !== 'number') throw new FormulaInvalida(`métrica sem valor numérico: "${t.v}"`);
      return v;
    }
    if (t.t === 'op' && t.v === '-') return -fator();
    if (t.t === 'par' && t.v === '(') {
      const v = expressao();
      const f = consumir();
      if (!f || f.t !== 'par' || f.v !== ')') throw new FormulaInvalida('falta fechar parêntese');
      return v;
    }
    throw new FormulaInvalida('esperava número, métrica ou parêntese');
  }

  const valor = expressao();
  if (pos !== tokens.length) throw new FormulaInvalida('sobrou conteúdo depois do fim da fórmula');
  return valor;
}

export function avaliar(formula, ctx) {
  const seguro = Object.assign(Object.create(null), ctx);
  const v = analisar(tokenizar(formula), seguro);
  return Number.isFinite(v) ? v : null;
}

export function validarFormula(formula, nomes) {
  const ctx = Object.assign(Object.create(null), Object.fromEntries(nomes.map((n) => [n, 1])));
  try { analisar(tokenizar(formula), ctx); return null; }
  catch (e) { return e instanceof FormulaInvalida ? e.message : 'fórmula inválida'; }
}
