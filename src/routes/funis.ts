import { Hono } from 'hono';
import { z } from 'zod';
import { exigirAdmin } from '../lib/access';
import { hashDoToken, novoToken } from '../lib/credenciais';
import type { AppEnv } from '../lib/tipos';

/**
 * Funis e credenciais de webhook.
 *
 * Um webhook por funil × canal. Misturar canais numa URL só obrigaria a
 * adivinhar a origem pelo formato do corpo, que é exatamente o que já causou
 * problema com o Rubeus mandando JSON como form-urlencoded.
 */
const funis = new Hono<AppEnv>();

/*
 * Toda esta tela é administrativa: cria funil, emite e revoga credencial de
 * webhook. Fica atrás do segundo nível, não só do Access — ver ehAdmin().
 */
funis.use('*', exigirAdmin);

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

const novoFunilSchema = z.object({
  nome: z.string().min(2).max(80),
  processo_id: z.union([z.string(), z.number()]).transform(String).nullish(),
});

/** GET /api/funis — lista com o estado de cada webhook, SEM o token. */
funis.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT f.id, f.nome, f.slug, f.processo_id, f.ativo, f.criado_em,
            w.canal, w.ultimo_uso_em, w.total_recebido,
            (w.token_hash IS NOT NULL) AS tem_link
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
        // Só o caminho. O token nunca volta daqui — nem existe mais em claro.
        caminho: `/webhook/${l.canal}/${l.slug}`,
        tem_link: Boolean(l.tem_link),
        ultimo_uso_em: l.ultimo_uso_em,
        total_recebido: l.total_recebido ?? 0,
      });
    }
  }

  // Webhooks por tipo de evento: não pertencem a funil, o funil vem no corpo.
  const { results: porEvento } = await c.env.DB.prepare(
    `SELECT id, canal, evento, ultimo_uso_em, total_recebido,
            (token_hash IS NOT NULL) AS tem_link
     FROM webhooks WHERE funil_id IS NULL ORDER BY canal, evento`,
  ).all();

  return c.json({
    canais: CANAIS,
    itens: [...mapa.values()],
    por_evento: (porEvento as Array<Record<string, any>>).map((w) => ({
      id: w.id,
      canal: w.canal,
      evento: w.evento,
      caminho: `/webhook/${w.canal}/evento/${w.evento}`,
      tem_link: Boolean(w.tem_link),
      ultimo_uso_em: w.ultimo_uso_em,
      total_recebido: w.total_recebido ?? 0,
    })),
  });
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

  /*
   * O funil nasce com os três canais, mas SEM link.
   *
   * Gerar aqui obrigaria a devolver os três tokens nesta resposta, ou a
   * descartá-los — e token descartado é linha inútil no banco. Quem for
   * configurar o canal clica em "gerar link" e recebe o valor na hora.
   */
  const funilId = meta.last_row_id;
  const stmt = c.env.DB.prepare('INSERT INTO webhooks (funil_id, canal) VALUES (?, ?)');
  await c.env.DB.batch(CANAIS.map((canal) => stmt.bind(funilId, canal)));

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

/*
 * Não existe mais endpoint que LEIA um token.
 *
 * O banco guarda só o hash, então não há valor a devolver — e é esse o ponto:
 * um dump do D1 deixou de conter credencial. Gerar substitui copiar, e a URL
 * completa aparece uma única vez, na resposta de quem mandou gerar.
 */

/** POST /api/funis/token-evento/:id — novo link de um webhook por evento. */
funis.post('/token-evento/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ erro: 'id_invalido' }, 400);

  const l = await c.env.DB.prepare(
    'SELECT canal, evento FROM webhooks WHERE id = ? AND funil_id IS NULL',
  ).bind(id).first() as { canal: string; evento: string } | null;
  if (!l) return c.json({ erro: 'webhook_nao_encontrado' }, 404);

  const token = novoToken();
  await c.env.DB.prepare(
    'UPDATE webhooks SET token_hash = ?, ultimo_uso_em = NULL, total_recebido = 0 WHERE id = ?',
  )
    .bind(await hashDoToken(token), id)
    .run();

  console.log(JSON.stringify({
    evento: 'token_gerado',
    tipo: l.evento,
    por: c.get('usuarioEmail') ?? 'desconhecido',
  }));

  const base = new URL(c.req.url).origin;
  return c.json({ url: `${base}/webhook/${l.canal}/evento/${l.evento}?t=${token}` });
});

/**
 * POST /api/funis/:id/regerar/:canal — gera o link e invalida o anterior.
 *
 * Serve tanto para o primeiro link quanto para a troca: os dois casos são a
 * mesma operação, e separá-los só criaria uma tela a mais para errar.
 */
funis.post('/:id/regerar/:canal', async (c) => {
  const id = Number(c.req.param('id'));
  const canal = c.req.param('canal');
  if (!Number.isInteger(id) || !CANAIS.includes(canal as Canal)) {
    return c.json({ erro: 'parametros_invalidos' }, 400);
  }

  const linha = await c.env.DB.prepare(
    `SELECT f.slug FROM webhooks w JOIN funis f ON f.id = w.funil_id
     WHERE w.funil_id = ? AND w.canal = ?`,
  )
    .bind(id, canal)
    .first<{ slug: string }>();
  if (!linha) return c.json({ erro: 'webhook_nao_encontrado' }, 404);

  const token = novoToken();
  await c.env.DB.prepare(
    'UPDATE webhooks SET token_hash = ?, ultimo_uso_em = NULL, total_recebido = 0 WHERE funil_id = ? AND canal = ?',
  )
    .bind(await hashDoToken(token), id, canal)
    .run();

  console.log(JSON.stringify({
    evento: 'token_gerado',
    funil_id: id,
    canal,
    por: c.get('usuarioEmail') ?? 'desconhecido',
  }));

  const base = new URL(c.req.url).origin;
  return c.json({ url: `${base}/webhook/${canal}/${linha.slug}?t=${token}` });
});

/**
 * GET /api/funis/eventos — últimos payloads recebidos, aceitos e recusados.
 *
 * É a tela que responde "o Rubeus está mandando?" e, se está, "por que foi
 * recusado?" — sem isso, o diagnóstico vira tentativa e erro às cegas.
 */
/**
 * GET /api/funis/eventos-por-lead — histórico agrupado por contato.
 *
 * A leitura útil não é cronológica, é por pessoa: "o que já chegou deste lead",
 * na ordem, com o corpo cru de cada passagem. É o que permite reconstruir a
 * jornada e mandar o payload inteiro para análise quando algo não mapeia.
 */
funis.get('/eventos-por-lead', async (c) => {
  const limite = Math.min(Number(c.req.query('leads') ?? 40) || 40, 100);

  const { results } = await c.env.DB.prepare(
    `SELECT contato_id, contato_nome, etapa, canal, funil_slug, status, detalhe, corpo, recebido_em
     FROM eventos_recebidos
     WHERE contato_id IN (
       SELECT contato_id FROM eventos_recebidos
       WHERE contato_id IS NOT NULL
       GROUP BY contato_id ORDER BY MAX(recebido_em) DESC LIMIT ?
     )
     ORDER BY recebido_em DESC, id DESC`,
  )
    .bind(limite)
    .all();

  const mapa = new Map<string, any>();
  for (const l of results as Array<Record<string, any>>) {
    if (!mapa.has(l.contato_id)) {
      mapa.set(l.contato_id, {
        contato_id: l.contato_id,
        contato_nome: l.contato_nome,
        funil_slug: l.funil_slug,
        ultimo_em: l.recebido_em,
        eventos: [],
      });
    }
    const g = mapa.get(l.contato_id);
    if (!g.contato_nome && l.contato_nome) g.contato_nome = l.contato_nome;
    g.eventos.push({
      etapa: l.etapa,
      canal: l.canal,
      status: l.status,
      detalhe: l.detalhe,
      corpo: l.corpo,
      recebido_em: l.recebido_em,
    });
  }

  // Eventos sem contato identificado ficam num grupo à parte, não somem.
  const orfaos = await c.env.DB.prepare(
    `SELECT canal, funil_slug, status, detalhe, corpo, recebido_em
     FROM eventos_recebidos WHERE contato_id IS NULL
     ORDER BY recebido_em DESC LIMIT 20`,
  ).all();

  return c.json({ leads: [...mapa.values()], sem_contato: orfaos.results });
});

funis.get('/eventos', async (c) => {
  const limite = Math.min(Number(c.req.query('limite') ?? 30) || 30, 100);
  const { results } = await c.env.DB.prepare(
    `SELECT canal, funil_slug, status, detalhe, corpo, recebido_em
     FROM eventos_recebidos ORDER BY recebido_em DESC, id DESC LIMIT ?`,
  )
    .bind(limite)
    .all();
  return c.json({ itens: results });
});

export default funis;
