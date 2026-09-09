/**
 * Aritmética compartilhada pelas rotas de agregado.
 *
 * `num` e `delta` viviam em duas cópias — uma em `routes/api.ts`, outra em
 * `routes/ads.ts` e `lib/googleAds.ts` — e as versões já tinham divergido: a do
 * Ads devolvia `null` quando qualquer lado fosse nulo, a do funil tratava nulo
 * como zero e devolvia uma variação inventada.
 *
 * A diferença não era decorativa. Uma métrica sem valor no período anterior
 * aparecia como "+100%" numa tela e como "—" na outra, para o mesmo dado.
 */

/**
 * Qualquer coisa vinda do D1 ou de API externa vira número.
 *
 * O D1 devolve `INTEGER` como número e `REAL` às vezes como string; o Google
 * devolve micros como string. `Number(null)` é 0, que é o que se quer para
 * somar — e é justamente o que NÃO se quer ao comparar, daí `delta` tratar nulo
 * à parte.
 */
export const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0);

/**
 * Variação percentual entre dois períodos, com uma casa decimal.
 *
 * Devolve `null` quando não há base de comparação — anterior nulo ou zero. Zero
 * como base não é "cresceu infinito", é "não dá para comparar": a divisão
 * explodiria, e um card mostrando `Infinity%` só assusta.
 *
 * Nulo em `atual` também devolve `null`, e não `-100%`: métrica sem valor no
 * período é ausência de dado, não queda até o fundo.
 */
export function delta(atual: number | null, anterior: number | null): number | null {
  if (atual === null || anterior === null || !anterior) return null;
  return Number((((atual - anterior) / anterior) * 100).toFixed(1));
}

/** Micros → unidade monetária. O Google devolve custo em milionésimos. */
export const deMicros = (v: unknown): number => num(v) / 1_000_000;
