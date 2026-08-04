/**
 * Tokens de webhook: gerados uma vez, guardados só como hash.
 *
 * Antes o valor ficava em texto claro no D1 e o painel reexibia quando pedissem.
 * Quem tivesse o banco — um dump, um backup, uma consulta de rotina — saía com
 * as credenciais de todos os funis, e a tela entregava a mesma coisa a qualquer
 * pessoa da lista do Access. Guardando o hash, o banco deixa de conter segredo:
 * dá para conferir um token apresentado, mas não para recuperá-lo.
 *
 * Consequência aceita: link perdido não é reexibido, é regerado. O valor aparece
 * exatamente uma vez, no momento em que nasce.
 */

/**
 * SHA-256 puro, sem KDF e sem sal.
 *
 * Sal serviria contra tabela pré-computada, e KDF lento contra força bruta —
 * ambos protegem segredo que gente escolhe. Aqui o token é 32 bytes de
 * `crypto.getRandomValues`: não há dicionário que o alcance, e um KDF lento só
 * adicionaria latência em todo webhook recebido.
 */
export async function hashDoToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Token opaco de 32 bytes.
 *
 * `crypto.getRandomValues`, nunca Math.random: é credencial, e um valor
 * previsível deixaria qualquer um postar evento no funil.
 */
export function novoToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
