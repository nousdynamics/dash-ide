/**
 * Converte os tokens de webhook já existentes para hash, uma vez só.
 *
 * Roda entre a migration 0012 (cria a coluna) e a 0013 (apaga a antiga). Sem
 * este passo, os links já colados no Rubeus morreriam todos junto com a coluna —
 * e o SQLite não tem SHA-256 embutido, então a conversão não cabe numa migration.
 *
 *   node scripts/hash-tokens.mjs            # banco local
 *   node scripts/hash-tokens.mjs --remote   # produção
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const remoto = process.argv.includes('--remote');
const alvo = remoto ? '--remote' : '--local';

const d1 = (sql) => {
  const saida = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'dash-ide', alvo, '--json', '--command', sql],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  // O wrangler imprime banner antes do JSON; corta no primeiro colchete.
  return JSON.parse(saida.slice(saida.indexOf('[')))[0].results;
};

const linhas = d1('SELECT id, token FROM webhooks WHERE token IS NOT NULL AND token_hash IS NULL');
console.log(`${alvo}: ${linhas.length} token(s) a converter`);

for (const { id, token } of linhas) {
  const hash = createHash('sha256').update(token).digest('hex');
  d1(`UPDATE webhooks SET token_hash = '${hash}' WHERE id = ${id}`);
  console.log(`  #${id} → ${hash.slice(0, 12)}…`);
}

const restantes = d1('SELECT COUNT(*) AS n FROM webhooks WHERE token IS NOT NULL AND token_hash IS NULL');
console.log(restantes[0].n === 0 ? 'Tudo convertido.' : `FALTARAM ${restantes[0].n}`);
process.exit(restantes[0].n === 0 ? 0 : 1);
