import { Hono } from 'hono';
import { z } from 'zod';
import { ehAdmin } from '../lib/access';
import { validarFormula } from '../lib/formula';
import type { AppEnv } from '../lib/tipos';

/**
 * Métricas personalizadas.
 *
 * Ler é para todo mundo — a métrica existe justamente para aparecer no painel
 * de quem analisa. Criar, editar e apagar é de admin: a definição é
 * compartilhada, e mudar a fórmula muda o número que a diretoria vê.
 */
const metricas = new Hono<AppEnv>();

/**
 * Bases disponíveis para montar fórmula.
 *
 * Lista fechada e explícita. É ela que o avaliador aceita como identificador e
 * é ela que a tela mostra como ajuda — as duas coisas saindo da mesma fonte,
 * para a ajuda não descrever um campo que a fórmula recusa.
 */
export const BASES: Array<{ id: string; rotulo: string; ajuda: string }> = [
  { id: 'investimento', rotulo: 'Investimento', ajuda: 'Custo em reais no período' },
  { id: 'conversoes', rotulo: 'Conversões', ajuda: 'Só as primárias, como no gerenciador' },
  { id: 'todas_conversoes', rotulo: 'Todas as conversões', ajuda: 'Primárias + secundárias' },
  { id: 'conversoes_secundarias', rotulo: 'Conversões secundárias', ajuda: 'Ações locais: rota, visita, perfil' },
  { id: 'cliques', rotulo: 'Cliques', ajuda: 'Cliques no anúncio' },
  { id: 'impressoes', rotulo: 'Impressões', ajuda: 'Vezes que o anúncio apareceu' },
  { id: 'leads_crm', rotulo: 'Leads no Rubeus', ajuda: 'Pessoas distintas que entraram no CRM no período' },
  {
    id: 'visualizacoes_pagina',
    rotulo: 'Visualizações de página',
    ajuda: 'Ações de conversão de visualização de página do site (categoria PAGE_VIEW, origem WEBSITE)',
  },
];

/*
 * Ações de conversão viram identificador `acao_<nome>` gerado do dado.
 *
 * Tentei fixar `ctwa`, `conversas_iniciadas` e `visualizacoes_pagina` na mão e
 * a última não existia: os nomes que o gerenciador mostra por campanha não são
 * os que a API devolve. Lista fixa de ação vira mentira no dia em que alguém
 * renomeia uma conversão no Google — a tela oferece as que existem de verdade.
 *
 * Pelo mesmo motivo `visualizacoes_pagina` soma por categoria + origem da ação
 * e não por nome: casar nome custou meses de Connect rate em 0% depois que as
 * ações chamadas "Visualização de página" foram removidas da conta.
 */
const ACAO = /^acao_[a-z0-9_]+$/;

const NOMES = BASES.map((b) => b.id);

const schema = z.object({
  nome: z.string().min(2).max(40),
  formula: z.string().min(1).max(300),
  formato: z.enum(['moeda', 'numero', 'percentual']).default('numero'),
  descricao: z.string().max(240).nullish(),
  inverso: z.boolean().default(false),
  ordem: z.number().int().min(0).max(999).default(0),
});

/** GET /api/metricas — definições + as bases que a tela oferece. */
metricas.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, nome, formula, formato, descricao, inverso, ordem FROM metricas_personalizadas ORDER BY ordem, id',
  ).all();
  return c.json({
    bases: BASES,
    itens: (results as Array<Record<string, any>>).map((m) => ({ ...m, inverso: Boolean(m.inverso) })),
    pode_editar: ehAdmin(c.env, c.get('usuarioEmail')),
  });
});

/** Erro de fórmula é do autor: 400 com a mensagem, não 500 depois na tela alheia. */
function conferir(formula: string): string | null {
  /*
   * Os identificadores de ação não dão para enumerar aqui — dependem da conta
   * do Google e mudam sem deploy. A validação aceita o formato; se a ação não
   * existir no período, o card mostra o erro em vez de um número inventado.
   */
  const usados = formula.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) ?? [];
  const acoes = usados.filter((u) => ACAO.test(u));
  return validarFormula(formula, [...NOMES, ...acoes]);
}

metricas.post('/', async (c) => {
  if (!ehAdmin(c.env, c.get('usuarioEmail'))) return c.json({ erro: 'sem_permissao' }, 403);

  const corpo = await c.req.json().catch(() => null);
  const r = schema.safeParse(corpo);
  if (!r.success) return c.json({ erro: 'schema_invalido', detalhe: r.error.issues.map((i) => i.message) }, 400);

  const problema = conferir(r.data.formula);
  if (problema) return c.json({ erro: 'formula_invalida', detalhe: problema }, 400);

  try {
    const { meta } = await c.env.DB.prepare(
      `INSERT INTO metricas_personalizadas (nome, formula, formato, descricao, inverso, ordem, criado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        r.data.nome.trim(), r.data.formula.trim(), r.data.formato,
        r.data.descricao ?? null, r.data.inverso ? 1 : 0, r.data.ordem,
        c.get('usuarioEmail') ?? null,
      )
      .run();
    return c.json({ ok: true, id: meta.last_row_id }, 201);
  } catch (e) {
    if (String(e).includes('UNIQUE')) return c.json({ erro: 'nome_ja_existe' }, 409);
    throw e;
  }
});

metricas.put('/:id', async (c) => {
  if (!ehAdmin(c.env, c.get('usuarioEmail'))) return c.json({ erro: 'sem_permissao' }, 403);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ erro: 'id_invalido' }, 400);

  const r = schema.safeParse(await c.req.json().catch(() => null));
  if (!r.success) return c.json({ erro: 'schema_invalido', detalhe: r.error.issues.map((i) => i.message) }, 400);

  const problema = conferir(r.data.formula);
  if (problema) return c.json({ erro: 'formula_invalida', detalhe: problema }, 400);

  const { meta } = await c.env.DB.prepare(
    `UPDATE metricas_personalizadas
        SET nome = ?, formula = ?, formato = ?, descricao = ?, inverso = ?, ordem = ?
      WHERE id = ?`,
  )
    .bind(
      r.data.nome.trim(), r.data.formula.trim(), r.data.formato,
      r.data.descricao ?? null, r.data.inverso ? 1 : 0, r.data.ordem, id,
    )
    .run();

  if (!meta.changes) return c.json({ erro: 'nao_encontrada' }, 404);
  return c.json({ ok: true });
});

metricas.delete('/:id', async (c) => {
  if (!ehAdmin(c.env, c.get('usuarioEmail'))) return c.json({ erro: 'sem_permissao' }, 403);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ erro: 'id_invalido' }, 400);
  await c.env.DB.prepare('DELETE FROM metricas_personalizadas WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

export default metricas;
