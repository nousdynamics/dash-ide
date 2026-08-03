import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../lib/tipos';

/**
 * Funis e credenciais de webhook.
 *
 * Um webhook por funil × canal. Misturar canais numa URL só obrigaria a
 * adivinhar a origem pelo formato do corpo, que é exatamente o que já causou
 * problema com o Rubeus mandando JSON como form-urlencoded.
 */
const funis = new Hono<AppEnv>();

export const CANAIS = ['rubeus', 'evolution', 'n8n'] as const;
export type Canal = (typeof CANAIS)[number];

/** Slug estável para a URL: sem acento, sem espaço, sem borda solta. */
function paraSlug(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Token opaco de 32 bytes.
 *
 * `crypto.getRandomValues`, nunca Math.random: é credencial, e um valor
 * previsível deixaria qualquer um postar evento no funil.
 */
function novoToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const novoFunilSchema = z.object({
  nome: z.string().min(2).max(80),
  processo_id: z.union([z.string(), z.number()]).transform(String).nullish(),
});

/** GET /api/funis — lista com o estado de cada webhook, SEM o token. */
funis.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT f.id, f.nome, f.slug, f.processo_id, f.ativo, f.criado_em,
            w.canal, w.ultimo_uso_em, w.total_recebido
     FROM funis f LEFT JOIN webhooks w ON w.funil_id = f.id
     WHERE f.ativo = 1
     ORDER BY f.id, w.canal`,
  ).all();

  const mapa = new Map<number, Record<string, unknown>>();
  for (const l of results as Array<Record<string, any>>) {
    if (!mapa.has(l.id)) {
      mapa.set(l.id, {
        id: l.id,
        nome: l.nome,
        slug: l.slug,
        processo_id: l.processo_id,
        criado_em: l.criado_em,
        webhooks: [],
      });
    }
    if (l.canal) {
      (mapa.get(l.id)!.webhooks as unknown[]).push({
        canal: l.canal,
        // O caminho vai completo; o token entra só no clique de copiar.
        caminho: `/webhook/${l.canal}/${l.slug}`,
        ultimo_uso_em: l.ultimo_uso_em,
        total_recebido: l.total_recebido ?? 0,
      });
    }
  }

  return c.json({ canais: CANAIS, itens: [...mapa.values()] });
});

/** POST /api/funis — cria o funil e já gera os três webhooks. */
funis.post('/', async (c) => {
  let corpo: unknown;
  try {
    corpo = await c.req.json();
  } catch {
    return c.json({ erro: 'corpo_invalido' }, 400);
  }

  const r = novoFunilSchema.safeParse(corpo);
  if (!r.success) {
    return c.json(
      { erro: 'schema_invalido', detalhe: r.error.issues.map((i) => i.message) },
      400,
    );
  }

  const slug = paraSlug(r.data.nome);
  if (!slug) return c.json({ erro: 'nome_sem_slug' }, 400);

  const existe = await c.env.DB.prepare('SELECT id FROM funis WHERE slug = ?').bind(slug).first();
  if (existe) return c.json({ erro: 'funil_ja_existe', slug }, 409);

  const { meta } = await c.env.DB.prepare(
    'INSERT INTO funis (nome, slug, processo_id) VALUES (?, ?, ?)',
  )
    .bind(r.data.nome.trim(), slug, r.data.processo_id ?? null)
    .run();

  const funilId = meta.last_row_id;
  const stmt = c.env.DB.prepare('INSERT INTO webhooks (funil_id, canal, token) VALUES (?, ?, ?)');
  await c.env.DB.batch(CANAIS.map((canal) => stmt.bind(funilId, canal, novoToken())));

  console.log(JSON.stringify({ evento: 'funil_criado', slug, canais: CANAIS.length }));
  return c.json({ ok: true, id: funilId, nome: r.data.nome, slug }, 201);
});

/** DELETE /api/funis/:id — desativa; o histórico de leads continua no D1. */
funis.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ erro: 'id_invalido' }, 400);
  await c.env.DB.prepare('UPDATE funis SET ativo = 0 WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

/**
 * GET /api/funis/:id/token/:canal — a URL completa, com token.
 *
 * Endpoint separado de propósito: a listagem nunca carrega o token, então ele
 * não aparece no HTML, em screenshot nem para quem olha a tela por cima do
 * ombro. Só trafega quando alguém clica em copiar.
 */
funis.get('/:id/token/:canal', async (c) => {
  const id = Number(c.req.param('id'));
  const canal = c.req.param('canal');
  if (!Number.isInteger(id) || !CANAIS.includes(canal as Canal)) {
    return c.json({ erro: 'parametros_invalidos' }, 400);
  }

  const linha = await c.env.DB.prepare(
    `SELECT w.token, f.slug FROM webhooks w JOIN funis f ON f.id = w.funil_id
     WHERE w.funil_id = ? AND w.canal = ?`,
  )
    .bind(id, canal)
    .first<{ token: string; slug: string }>();

  if (!linha) return c.json({ erro: 'webhook_nao_encontrado' }, 404);

  console.log(JSON.stringify({
    evento: 'token_copiado',
    funil_id: id,
    canal,
    por: c.get('usuarioEmail') ?? 'desconhecido',
  }));

  const base = new URL(c.req.url).origin;
  return c.json({ url: `${base}/webhook/${canal}/${linha.slug}?t=${linha.token}` });
});

/** POST /api/funis/:id/regerar/:canal — invalida o token anterior na hora. */
funis.post('/:id/regerar/:canal', async (c) => {
  const id = Number(c.req.param('id'));
  const canal = c.req.param('canal');
  if (!Number.isInteger(id) || !CANAIS.includes(canal as Canal)) {
    return c.json({ erro: 'parametros_invalidos' }, 400);
  }
  const { meta } = await c.env.DB.prepare(
    'UPDATE webhooks SET token = ?, ultimo_uso_em = NULL, total_recebido = 0 WHERE funil_id = ? AND canal = ?',
  )
    .bind(novoToken(), id, canal)
    .run();

  if (!meta.changes) return c.json({ erro: 'webhook_nao_encontrado' }, 404);
  console.log(JSON.stringify({ evento: 'token_regerado', funil_id: id, canal }));
  return c.json({ ok: true });
});

export default funis;
