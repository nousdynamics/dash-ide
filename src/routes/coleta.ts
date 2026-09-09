import { Hono } from 'hono';
import { clickIdValido, normalizarEmail, normalizarTelefone, registrarCaptura } from '../lib/cliques';
import type { AppEnv } from '../lib/tipos';

/**
 * Coleta do identificador de clique, no navegador de quem visita o site.
 *
 * Fica FORA do Cloudflare Access, como `/webhook`: quem chama aqui é o
 * navegador de um visitante anônimo, que por definição não tem sessão do
 * painel. Não é a mesma coisa que uma rota aberta do painel — o que entra aqui
 * é só (click id, e-mail, telefone) e nada sai: nenhum GET devolve captura.
 *
 * A porta é pública, então a proteção é de forma e de origem, não de segredo:
 * um token embutido num script servido a qualquer navegador não é segredo
 * nenhum. O que realmente limita é a lista de sites permitidos, conferida
 * contra o `Origin` que o navegador põe e a página não consegue forjar.
 */
const coleta = new Hono<AppEnv>();

/** Teto diário de capturas — spray de bot não vira tabela infinita. */
const TETO_DIARIO = 5000;

async function origensPermitidas(db: D1Database): Promise<string[]> {
  const r = await db.prepare(
    `SELECT valor FROM conversao_config WHERE chave = 'origens_permitidas'`,
  ).first() as { valor: string | null } | null;
  return (r?.valor ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * Confere o `Origin` do navegador contra a lista.
 *
 * Aceita subdomínio do que está na lista: `curtaduracao.faculdadeide.edu.br`
 * casa com `faculdadeide.edu.br`. Casar por sufixo cru deixaria
 * `naofaculdadeide.edu.br` passar, então a comparação exige o ponto.
 */
function origemOk(origem: string | undefined, permitidas: string[]): string | null {
  if (!origem) return null;
  let host: string;
  try {
    host = new URL(origem).hostname.toLowerCase();
  } catch {
    return null;
  }
  const ok = permitidas.some((p) => host === p || host.endsWith(`.${p}`));
  return ok ? origem : null;
}

const semCache = {
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

/** Preflight — só responde para origem que está na lista. */
coleta.options('/clique', async (c) => {
  const permitido = origemOk(c.req.header('Origin'), await origensPermitidas(c.env.DB));
  if (!permitido) return c.body(null, 403);
  return c.body(null, 204, { ...semCache, 'Access-Control-Allow-Origin': permitido });
});

/**
 * POST /coleta/clique — recebe uma captura.
 *
 * Aceita `text/plain` além de JSON porque o script usa `sendBeacon`, que só
 * manda requisição simples: com `application/json` o navegador faria preflight,
 * e preflight numa saída de página costuma não completar a tempo. O corpo
 * continua sendo JSON — muda o rótulo, não o formato.
 *
 * Responde 204 em quase tudo, inclusive no que ignorou. Um script de página não
 * tem o que fazer com erro, e devolver detalhe daqui só ensinaria um raspador a
 * descobrir o que a lista aceita.
 */
coleta.post('/clique', async (c) => {
  const permitido = origemOk(c.req.header('Origin'), await origensPermitidas(c.env.DB));
  if (!permitido) return c.body(null, 403);

  const cabecalhos = { ...semCache, 'Access-Control-Allow-Origin': permitido };

  const ligada = await c.env.DB.prepare(
    `SELECT valor FROM conversao_config WHERE chave = 'captura_ligada'`,
  ).first() as { valor: string | null } | null;
  if (ligada?.valor !== '1') return c.body(null, 204, cabecalhos);

  let corpo: any;
  try {
    corpo = JSON.parse(await c.req.text());
  } catch {
    return c.body(null, 204, cabecalhos);
  }

  const tipo = ['gclid', 'gbraid', 'wbraid'].includes(corpo?.tipo) ? corpo.tipo : null;
  const valor = typeof corpo?.valor === 'string' ? corpo.valor.trim() : '';
  if (!tipo || !clickIdValido(valor)) return c.body(null, 204, cabecalhos);

  const email = normalizarEmail(corpo?.email);
  const telefone = normalizarTelefone(corpo?.telefone);
  /*
   * Captura sem e-mail e sem telefone não serve para nada.
   *
   * O cruzamento só existe por essas duas chaves; guardar um click id solto
   * seria acumular linha que nenhum lead vai reclamar. O script sabe disso e
   * só dispara quando o formulário tem identidade.
   */
  if (!email && !telefone) return c.body(null, 204, cabecalhos);

  const { total } = (await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM cliques_capturados WHERE capturado_em >= datetime('now', '-1 day')`,
  ).first()) as { total: number };
  if (total >= TETO_DIARIO) {
    console.warn(JSON.stringify({ evento: 'captura_teto_diario', total }));
    return c.body(null, 204, cabecalhos);
  }

  const novo = await registrarCaptura(c.env.DB, {
    tipo, valor, email, telefone,
    pagina: typeof corpo?.pagina === 'string' ? corpo.pagina : null,
    origemSite: new URL(permitido).hostname,
  });

  if (novo) {
    console.log(JSON.stringify({
      evento: 'clique_capturado', tipo, tem_email: Boolean(email), tem_telefone: Boolean(telefone),
    }));
  }
  return c.body(null, 204, cabecalhos);
});

/**
 * GET /coleta/ide-clique.js — o script que vai nas páginas do site.
 *
 * Servido pelo painel, e não colado à mão em cada página, por um motivo
 * prático: quando a regra mudar — outro parâmetro, outro campo de formulário —
 * muda aqui e vale em tudo, sem caçar tag espalhada em landing page.
 *
 * É primeira parte: o click id fica num cookie do próprio domínio do site, sem
 * nenhuma biblioteca externa, e o único destino do dado é este painel.
 */
coleta.get('/ide-clique.js', (c) =>
  c.body(montarScript(new URL(c.req.url).origin), 200, {
    'Content-Type': 'application/javascript; charset=utf-8',
    // Uma hora: curto o bastante para corrigir no mesmo dia, longo o bastante
    // para não virar uma requisição por página vista.
    'Cache-Control': 'public, max-age=3600',
  }));

/**
 * O script, com o endereço do painel já embutido.
 *
 * Antes o endpoint era deduzido de `document.currentScript.src`. Isso funciona
 * quando a tag é colada na página como `<script src=…>`, e falha em silêncio no
 * caminho que esta conta de fato usa: dentro do Google Tag Manager, quem cola o
 * CONTEÚDO do script numa tag de HTML personalizado não tem `currentScript.src`
 * — a captura passaria a postar em `https://site-da-faculdade/coleta/clique`,
 * que não existe, e nenhum clique chegaria aqui. Sem erro visível: o
 * `sendBeacon` não reclama de 404.
 *
 * O Worker conhece o próprio endereço. Embutir na resposta remove a dedução e,
 * com ela, o modo de falha.
 */
const montarScript = (origem: string) => `/* Captura de click id — Faculdade IDE. Servido por /coleta/ide-clique.js. */
(function () {
  'use strict';
  var ENDPOINT = '${origem}/coleta/clique';
  var CHAVE = 'ide_click_id';
  var DIAS = 90;

  /* O click id chega na URL do anúncio. Guardamos porque a inscrição costuma
     acontecer páginas depois — às vezes dias depois, noutra sessão. */
  function daUrl() {
    var q = new URLSearchParams(location.search);
    var tipos = ['gclid', 'gbraid', 'wbraid'];
    for (var i = 0; i < tipos.length; i++) {
      var v = q.get(tipos[i]);
      if (v) return { tipo: tipos[i], valor: v };
    }
    return null;
  }

  function guardar(c) {
    var payload = encodeURIComponent(c.tipo + ':' + c.valor);
    var exp = new Date(Date.now() + DIAS * 864e5).toUTCString();
    document.cookie = CHAVE + '=' + payload + ';path=/;expires=' + exp + ';SameSite=Lax';
    try { localStorage.setItem(CHAVE, c.tipo + ':' + c.valor); } catch (e) {}
  }

  function guardado() {
    var m = document.cookie.match(new RegExp('(?:^|; )' + CHAVE + '=([^;]*)'));
    var bruto = m ? decodeURIComponent(m[1]) : null;
    if (!bruto) { try { bruto = localStorage.getItem(CHAVE); } catch (e) {} }
    if (!bruto) return null;
    var p = bruto.indexOf(':');
    return p > 0 ? { tipo: bruto.slice(0, p), valor: bruto.slice(p + 1) } : null;
  }

  var atual = daUrl();
  if (atual) guardar(atual);

  /* Varre o formulário procurando quem é a pessoa. Por tipo e por nome do
     campo: formulário de CRM raramente usa type="email", e cair só no type
     perderia a maioria. */
  function identidade(form) {
    var email = null, telefone = null;
    var campos = form.querySelectorAll('input, textarea');
    for (var i = 0; i < campos.length; i++) {
      var el = campos[i];
      var v = (el.value || '').trim();
      if (!v) continue;
      var pista = ((el.name || '') + ' ' + (el.id || '') + ' ' + (el.type || '') + ' ' +
                   (el.getAttribute('autocomplete') || '')).toLowerCase();
      if (!email && (el.type === 'email' || pista.indexOf('mail') >= 0) && v.indexOf('@') > 0) email = v;
      if (!telefone && (el.type === 'tel' || /(phone|tel|celular|whats|fone)/.test(pista))) {
        if (v.replace(/\\D/g, '').length >= 10) telefone = v;
      }
    }
    return { email: email, telefone: telefone };
  }

  function enviar(form) {
    var c = guardado();
    if (!c) return;                      /* visita orgânica: nada a atribuir */
    var quem = identidade(form);
    if (!quem.email && !quem.telefone) return;

    var corpo = JSON.stringify({
      tipo: c.tipo, valor: c.valor,
      email: quem.email, telefone: quem.telefone,
      pagina: location.href.slice(0, 300)
    });

    /* sendBeacon sobrevive à navegação que o submit dispara; fetch com
       keepalive é o plano B onde ele não existe. Nenhum dos dois atrasa o
       envio do formulário — a inscrição é o que importa, a medição não pode
       atrapalhá-la. */
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([corpo], { type: 'text/plain;charset=UTF-8' }));
        return;
      }
    } catch (e) {}
    try {
      fetch(ENDPOINT, { method: 'POST', body: corpo, keepalive: true, mode: 'cors',
                        headers: { 'Content-Type': 'text/plain;charset=UTF-8' } });
    } catch (e) {}
  }

  /* Captura na fase de captura (true): pega o submit antes de qualquer
     handler da página chamar preventDefault e trocar por um envio via AJAX. */
  document.addEventListener('submit', function (ev) {
    if (ev.target && ev.target.tagName === 'FORM') enviar(ev.target);
  }, true);

  /* Formulário que envia por AJAX sem evento de submit — comum em CRM. O
     clique no botão é o último momento em que os campos ainda estão na tela. */
  document.addEventListener('click', function (ev) {
    var alvo = ev.target && ev.target.closest ? ev.target.closest('button, input[type=submit]') : null;
    if (!alvo) return;
    var form = alvo.form || (alvo.closest ? alvo.closest('form') : null);
    if (form) enviar(form);
  }, true);
})();
`;

export default coleta;
