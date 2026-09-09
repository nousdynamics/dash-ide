/**
 * Reorganiza os leads que ficaram presos na etapa fantasma "Não contactado".
 *
 * "Não contactado" nunca foi etapa do Rubeus: é o `resumoAtualNome` da
 * oportunidade — o andamento do contato com a pessoa — que a lista de apelidos
 * de `etapa` aceitava por engano (ver src/lib/schemas.ts). O resultado foram
 * 5.174 passagens gravadas com um nome que não existe em kanban nenhum, das
 * quais 317 pessoas não tinham NENHUMA outra passagem: para o funil, elas eram
 * "Qualificados" sem ninguém ter falado com elas.
 *
 * Este script não apaga nada. Ele vai ao Rubeus perguntar em que etapa cada
 * uma dessas pessoas realmente está e grava ESSAS passagens ao lado das que já
 * existem. A data usada é o `momento` da própria oportunidade, não a data da
 * atividade que gerou o fantasma — senão o histórico ganharia passagem em dia
 * que não aconteceu.
 *
 * Depois que isto rodar, a migration 0036 tira a etapa fantasma da contagem.
 * Nessa ordem: neutralizar antes do backfill faria os 317 sumirem no intervalo.
 *
 *   node scripts/reorganizar-nao-contactado.mjs [--remote] [--aplicar] [--limite N]
 *
 * Sem `--aplicar` só mostra o que faria. É idempotente: a chave de repetição é
 * a mesma do webhook — (contato_id, etapa, registrado_em, processo_id).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const remoto = process.argv.includes('--remote');
const aplicar = process.argv.includes('--aplicar');
const iLimite = process.argv.indexOf('--limite');
const limite = iLimite > -1 ? Number(process.argv[iLimite + 1]) : Infinity;
const alvo = remoto ? '--remote' : '--local';

const ETAPA_FANTASMA = 'Não contactado';

const d1 = (sql) => {
  const s = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'dash-ide', alvo, '--json', '--command', sql],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(s.slice(s.indexOf('[')))[0].results;
};

const aspas = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

// Credenciais do Rubeus saem do .dev.vars — os mesmos valores publicados como
// secret. Script de manutenção roda da máquina de quem opera, não do Worker.
const vars = {};
for (const linha of readFileSync('.dev.vars', 'utf8').split('\n')) {
  const m = linha.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m) vars[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}

async function listarOportunidades(contatoId) {
  const r = await fetch('https://crmide.apprubeus.com.br/api/Contato/listarOportunidades', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      id: Number(contatoId) || contatoId,
      camposRetorno: [
        'id', 'curso', 'cursoNome', 'etapa', 'etapaNome', 'statusNome',
        'processo', 'processoNome', 'momento', 'codCurso', 'codOferta',
      ],
      origem: Number(vars.RUBEUS_ORIGEM) || vars.RUBEUS_ORIGEM,
      token: vars.RUBEUS_TOKEN,
    }),
  });
  const j = await r.json().catch(() => null);
  if (!j?.success) return null;
  return Array.isArray(j.dados) ? j.dados : [];
}

/** "2026-06-08 11:24:33" (Brasília) → ISO em UTC, como o resto da tabela. */
const paraIso = (momento) => {
  if (!momento) return null;
  const m = String(momento).trim().replace(' ', 'T');
  const d = new Date(`${m}-03:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const contatos = d1(
  `SELECT contato_id,
          MAX(contato_nome) AS nome,
          MAX(email) AS email,
          MAX(telefone) AS telefone,
          MAX(funil_id) AS funil_id,
          MAX(pessoa_id) AS pessoa_id
     FROM leads_etapa
    WHERE etapa = '${ETAPA_FANTASMA.replace(/'/g, "''")}'
      AND contato_id IS NOT NULL AND contato_id <> ''
    GROUP BY contato_id
    ORDER BY MAX(registrado_em) DESC`,
);

console.log(`${contatos.length} contatos com a etapa fantasma. Alvo: ${alvo}${aplicar ? ' (aplicando)' : ' (simulação)'}\n`);

// O que já existe, para não gravar passagem repetida. Mesma chave do webhook.
const jaExiste = new Set(
  d1(
    `SELECT contato_id || '|' || etapa || '|' || registrado_em || '|' || COALESCE(processo_id, '') AS k
       FROM leads_etapa`,
  ).map((r) => r.k),
);

const inserts = [];
const etapasVistas = new Map();
let comOportunidade = 0;
let semResposta = 0;
let jaCobertos = 0;

for (const [i, c] of contatos.slice(0, limite).entries()) {
  if (i % 50 === 0) process.stdout.write(`  ${i}/${Math.min(contatos.length, limite)}\r`);

  let opps;
  try {
    opps = await listarOportunidades(c.contato_id);
  } catch {
    opps = null;
  }
  if (opps == null) { semResposta += 1; continue; }
  if (!opps.length) { jaCobertos += 1; continue; }
  comOportunidade += 1;

  for (const o of opps) {
    const nome = (o.etapaNome || '').trim();
    const processo = o.processo != null ? String(o.processo) : null;
    const em = paraIso(o.momento);
    if (!nome || !processo || !em) continue;

    const chave = `${c.contato_id}|${nome}|${em}|${processo}`;
    if (jaExiste.has(chave)) continue;
    jaExiste.add(chave);

    // A etapa real traz id — é o que tira a linha da quarentena.
    etapasVistas.set(`${processo}::${nome}`, {
      processo,
      nome,
      id: o.etapa != null ? String(o.etapa) : null,
    });

    inserts.push(
      `INSERT INTO leads_etapa (contato_id, contato_nome, registro_processo_id, processo_id,` +
      ` processo_nome, etapa, status, curso_id, curso_codigo, oferta_codigo, registrado_em,` +
      ` funil_id, email, telefone, pessoa_id) VALUES (` +
      [
        aspas(c.contato_id), aspas(c.nome), aspas(o.id), aspas(processo),
        aspas(o.processoNome), aspas(nome), aspas(o.statusNome), aspas(o.curso),
        aspas(o.codCurso), aspas(o.codOferta), aspas(em),
        c.funil_id == null ? 'NULL' : Number(c.funil_id),
        aspas(c.email), aspas(c.telefone), aspas(c.pessoa_id ?? c.contato_id),
      ].join(', ') + ')',
    );
  }
}

console.log(`\n`);
console.log(`  contatos consultados no Rubeus : ${contatos.slice(0, limite).length}`);
console.log(`  com oportunidade encontrada    : ${comOportunidade}`);
console.log(`  sem oportunidade nenhuma       : ${jaCobertos}`);
console.log(`  sem resposta da API            : ${semResposta}`);
console.log(`  passagens reais a gravar       : ${inserts.length}`);
console.log(`  etapas reais a ensinar         : ${etapasVistas.size}`);

// Quais etapas reais apareceram, e quais delas o consolidado ainda não sabe
// classificar — é essa lista que a migration 0036 precisa cobrir.
const classificadas = new Map(
  d1('SELECT processo_id, etapa_nome, macro_etapa FROM processo_etapas')
    .map((r) => [`${r.processo_id}::${r.etapa_nome}`, r.macro_etapa]),
);
console.log('\n  etapas reais encontradas:');
for (const [k, e] of [...etapasVistas].sort()) {
  const macro = classificadas.has(k) ? (classificadas.get(k) ?? 'SEM MACRO') : 'NOVA (sem macro)';
  console.log(`    proc ${e.processo.padEnd(3)} id=${String(e.id).padEnd(5)} ${macro.padEnd(18)} ${e.nome}`);
}

if (!aplicar) {
  console.log('\nSimulação. Rode com --aplicar para gravar.');
  process.exit(0);
}

for (const e of etapasVistas.values()) {
  d1(
    `INSERT INTO processo_etapas (processo_id, etapa_id, etapa_nome, ordem, macro_etapa, atualizado_em)
     VALUES (${aspas(e.processo)}, ${aspas(e.id)}, ${aspas(e.nome)}, 100, NULL, datetime('now'))
     ON CONFLICT(processo_id, etapa_nome) DO UPDATE SET
       etapa_id = COALESCE(excluded.etapa_id, processo_etapas.etapa_id),
       atualizado_em = excluded.atualizado_em`,
  );
}
console.log(`  etapas ensinadas: ${etapasVistas.size}`);

// Lotes: o D1 recusa comando gigante, e um lote que falha não leva o resto.
const LOTE = 100;
let gravadas = 0;
for (let i = 0; i < inserts.length; i += LOTE) {
  const lote = inserts.slice(i, i + LOTE);
  d1(lote.join('; '));
  gravadas += lote.length;
  process.stdout.write(`  gravadas ${gravadas}/${inserts.length}\r`);
}
console.log(`\n  ${gravadas} passagens reais gravadas. Nada foi apagado.`);
console.log('\nAgora rode a migration 0036 para tirar a etapa fantasma da contagem.');
