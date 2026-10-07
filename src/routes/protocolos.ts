import { Hono } from 'hono';
import { z } from 'zod';
import { ehAdmin, exigirAdmin } from '../lib/access';
import { gravarConfig } from '../lib/conversoes';
import { dataValida } from '../lib/googleAds';
import { NOME_CANAL, type Canal } from '../lib/origens';
import type { AppEnv } from '../lib/tipos';

/**
 * GET /api/protocolos — cliques no botão de WhatsApp e onde cada um foi parar.
 *
 * Três degraus: protocolo gerado (clicou no botão), conversa (a mensagem com o
 * código chegou no atendimento) e lead (o telefone existe no Rubeus). A etapa
 * é a do evento mais recente daquele telefone — a mesma regra do "etapa atual"
 * do perfil do lead (/api/funil/lead).
 *
 * Sem cache de borda: é a tela onde se confere se o protocolo de um teste
 * acabou de chegar, e cinco minutos de atraso ali parecem integração quebrada.
 */
const protocolos = new Hono<AppEnv>();

/*
 * O lead daquele telefone, com e sem o nono dígito (ver variantesTelefone em
 * src/lib/protocolos.ts). O protocolo grava a forma de 13 dígitos; o Rubeus
 * tem as duas. `idx_leads_telefone` atende o IN.
 */
const LEAD_DO_TELEFONE = `
  LEFT JOIN leads_etapa l ON l.id = (
    SELECT id FROM leads_etapa
     WHERE p.telefone IS NOT NULL
       AND telefone IN (p.telefone,
             CASE WHEN length(p.telefone) = 13 AND substr(p.telefone, 5, 1) = '9'
                  THEN substr(p.telefone, 1, 4) || substr(p.telefone, 6) END)
     ORDER BY registrado_em DESC, id DESC LIMIT 1)
  LEFT JOIN funis f ON f.id = l.funil_id`;

protocolos.get('/', async (c) => {
  const hoje = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
  const de = dataValida(c.req.query('de')) ? c.req.query('de')! : hoje.slice(0, 8) + '01';
  const ate = dataValida(c.req.query('ate')) ? c.req.query('ate')! : hoje;

  /*
   * Busca por código ou telefone ignora o período: quem procura um protocolo
   * que o aluno ditou não sabe em que dia ele clicou.
   */
  const busca = (c.req.query('q') ?? '').trim().toUpperCase().slice(0, 20);
  const digitos = busca.replace(/\D/g, '');
  const filtro = busca
    ? `(p.codigo LIKE ?1 OR (length(?2) >= 4 AND p.telefone LIKE '%' || ?2 || '%'))`
    : `date(p.gerado_em, '-3 hours') BETWEEN ?1 AND ?2`;
  const params = busca ? [`%${busca}%`, digitos] : [de, ate];

  const [lista, resumo, porCanal, webhook] = await Promise.all([
    c.env.DB.prepare(
      `SELECT p.codigo, p.gerado_em, p.mensagem_em, p.pagina, p.canal,
              p.utm_source, p.utm_medium, p.utm_campaign, p.click_id_tipo,
              p.telefone, p.contato_nome, p.fonte,
              l.contato_id, l.contato_nome AS lead_nome, l.etapa, l.registrado_em AS etapa_em,
              COALESCE(f.nome, l.processo_nome) AS funil
         FROM protocolos_whatsapp p ${LEAD_DO_TELEFONE}
        WHERE ${filtro}
        ORDER BY p.gerado_em DESC, p.id DESC
        LIMIT 500`,
    ).bind(...params).all(),

    c.env.DB.prepare(
      `SELECT COUNT(*) AS gerados,
              SUM(p.telefone IS NOT NULL) AS conversas,
              SUM(l.id IS NOT NULL) AS leads
         FROM protocolos_whatsapp p ${LEAD_DO_TELEFONE}
        WHERE ${filtro}`,
    ).bind(...params).first<{ gerados: number; conversas: number | null; leads: number | null }>(),

    c.env.DB.prepare(
      `SELECT COALESCE(p.canal, 'direto') AS canal, COUNT(*) AS gerados,
              SUM(p.telefone IS NOT NULL) AS conversas, SUM(l.id IS NOT NULL) AS leads
         FROM protocolos_whatsapp p ${LEAD_DO_TELEFONE}
        WHERE ${filtro}
        GROUP BY 1 ORDER BY gerados DESC`,
    ).bind(...params).all<{ canal: Canal; gerados: number; conversas: number; leads: number }>(),

    c.env.DB.prepare(
      `SELECT id, token_hash IS NOT NULL AS tem_link, ultimo_uso_em, total_recebido
         FROM webhooks WHERE canal = 'whatsapp' AND evento = 'mensagem' AND funil_id IS NULL`,
    ).first<{ id: number; tem_link: number; ultimo_uso_em: string | null; total_recebido: number }>(),
  ]);

  const ligado = await c.env.DB.prepare(
    `SELECT valor FROM conversao_config WHERE chave = 'protocolo_ligado'`,
  ).first<{ valor: string | null }>();

  return c.json({
    de, ate, busca: busca || null,
    ligado: ligado?.valor === '1',
    admin: ehAdmin(c.env, c.get('usuarioEmail')),
    webhook: webhook
      ? { ...webhook, tem_link: Boolean(webhook.tem_link) }
      : null,
    resumo: {
      gerados: resumo?.gerados ?? 0,
      conversas: resumo?.conversas ?? 0,
      leads: resumo?.leads ?? 0,
    },
    canais: porCanal.results.map((r) => ({ ...r, nome: NOME_CANAL[r.canal] ?? r.canal })),
    protocolos: lista.results,
  });
});

/**
 * PUT /api/protocolos/config — liga ou desliga o carimbo na mensagem.
 *
 * Só quem administra: ligar muda o texto que todo aluno vê ao chamar no
 * WhatsApp pelo site. Vale em até uma hora para quem já está com a página
 * aberta, que é o cache do script (/coleta/ide-clique.js).
 */
protocolos.put('/config', exigirAdmin, async (c) => {
  const r = z.object({ ligado: z.boolean() }).safeParse(await c.req.json().catch(() => null));
  if (!r.success) return c.json({ erro: 'schema_invalido', detalhe: r.error.issues }, 400);

  await gravarConfig(c.env.DB, { protocolo_ligado: r.data.ligado ? '1' : '0' }, c.get('usuarioEmail'));
  console.log(JSON.stringify({
    evento: 'protocolo_interruptor', ligado: r.data.ligado, por: c.get('usuarioEmail') ?? '?',
  }));
  return c.json({ ok: true, ligado: r.data.ligado });
});

export default protocolos;
