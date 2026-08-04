/**
 * Reprocessa os payloads já guardados em `eventos_recebidos`.
 *
 * O diário existia para diagnóstico, mas serve também de rede: evento do CRM não
 * é reenviado, então tudo que foi recusado por um mapeamento incompleto só volta
 * daqui. Extrai e-mail e telefone do corpo cru e completa `leads_etapa`.
 *
 *   node scripts/reprocessar-eventos.mjs [--remote] [--aplicar]
 *
 * Sem `--aplicar` só mostra o que faria.
 */
import { execFileSync } from 'node:child_process';

const remoto = process.argv.includes('--remote');
const aplicar = process.argv.includes('--aplicar');
const alvo = remoto ? '--remote' : '--local';

const d1 = (sql) => {
  const s = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'dash-ide', alvo, '--json', '--command', sql],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(s.slice(s.indexOf('[')))[0].results;
};

const aspas = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

const email = (v) => {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  return e.includes('@') && e.length > 3 ? e : null;
};
const telefone = (v) => {
  if (v == null) return null;
  let d = String(v).split('@')[0].replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d.length >= 12 && d.length <= 15 ? d : null;
};

/** Tira do corpo o que interessa, seja qual for o formato que o Rubeus usou. */
function extrair(corpo) {
  if (!corpo) return null;
  let o;
  if (corpo.trim().startsWith('{') || corpo.trim().startsWith('[')) {
    try {
      o = JSON.parse(corpo);
    } catch {
      return null;
    }
    if (Array.isArray(o)) o = o[0];
    if (!o || typeof o !== 'object') return null;
    return {
      contato_id: o?.contatos?.[0]?.id ?? o?.contato?.id ?? o?.id ?? null,
      nome: o?.nome ?? o?.contatos?.[0]?.nome ?? null,
      email: email(o?.emails?.principal ?? o?.email),
      telefone: telefone(o?.telefones?.principal ?? o?.telefone ?? o?.phone),
    };
  }
  // form-urlencoded do fluxo de automação
  const p = new URLSearchParams(corpo);
  return {
    contato_id: p.get('id'),
    nome: p.get('nome'),
    email: email(p.get('email')),
    telefone: telefone(p.get('phone') ?? p.get('telefone')),
  };
}

const eventos = d1(
  'SELECT id, corpo FROM eventos_recebidos WHERE corpo IS NOT NULL ORDER BY id',
);

/* Uma identidade por pessoa: o mesmo e-mail aparece com contato_id diferente
 * conforme o gatilho, e é justamente isso que precisa ser costurado. */
const porEmail = new Map();
for (const e of eventos) {
  const d = extrair(e.corpo);
  if (!d?.email) continue;
  const reg = porEmail.get(d.email) ?? { nome: null, telefone: null, ids: new Set() };
  reg.nome ??= d.nome;
  reg.telefone ??= d.telefone;
  if (d.contato_id) reg.ids.add(String(d.contato_id));
  porEmail.set(d.email, reg);
}

console.log(`${alvo}: ${eventos.length} evento(s) no diário, ${porEmail.size} e-mail(s) distinto(s)`);

let atualizados = 0;
for (const [mail, reg] of porEmail) {
  const ids = [...reg.ids].map(aspas).join(',');
  if (!ids) continue;
  const sql =
    `UPDATE leads_etapa SET email = COALESCE(email, ${aspas(mail)}), ` +
    `telefone = COALESCE(telefone, ${aspas(reg.telefone)}) ` +
    `WHERE contato_id IN (${ids}) AND (email IS NULL OR telefone IS NULL)`;
  const nome = (reg.nome || '').slice(0, 26).padEnd(26);
  console.log(`  ${nome} ${mail.padEnd(34)} ids: ${[...reg.ids].join(', ')}`);
  if (aplicar) {
    d1(sql);
    atualizados++;
  }
}

console.log(aplicar ? `\n${atualizados} identidade(s) aplicada(s).` : '\n(simulação — rode com --aplicar)');
