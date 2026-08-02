/** Teto de corpo aceito num webhook. Payload de etapa do Rubeus fica na casa dos KB. */
const LIMITE_BYTES = 1_000_000;

export class CorpoInvalido extends Error {}

/**
 * Lê o corpo de um webhook como JSON, contornando a quirk do Rubeus.
 *
 * O Rubeus envia `Content-Type: application/x-www-form-urlencoded` mas o corpo é
 * JSON puro. Um parser de formulário padrão transforma o JSON inteiro na *chave*
 * de um par sem valor. Mesma armadilha já documentada no node "Normalizar
 * Payload" do fluxo n8n — aqui a gente evita o parser de formulário por
 * completo: lê como texto e faz JSON.parse, com fallback pra form de verdade.
 */
export async function lerCorpoJson(req: Request): Promise<unknown> {
  const tamanho = Number(req.headers.get('content-length') ?? '0');
  if (tamanho > LIMITE_BYTES) {
    throw new CorpoInvalido(`corpo acima do limite de ${LIMITE_BYTES} bytes`);
  }

  const texto = await req.text();
  if (!texto.trim()) throw new CorpoInvalido('corpo vazio');

  try {
    return JSON.parse(texto);
  } catch {
    // Não era JSON direto — tenta como formulário de verdade.
  }

  const params = new URLSearchParams(texto);
  const chaves = [...params.keys()];

  // Caso do Rubeus: uma única chave que na verdade é o JSON inteiro.
  const primeira = chaves[0];
  if (chaves.length === 1 && primeira !== undefined && primeira.trim().startsWith('{')) {
    try {
      return JSON.parse(primeira);
    } catch {
      throw new CorpoInvalido('corpo parece JSON em form-urlencoded mas não parseia');
    }
  }

  if (chaves.length === 0) throw new CorpoInvalido('corpo não é JSON nem formulário válido');
  return Object.fromEntries(params.entries());
}
