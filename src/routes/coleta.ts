import { Hono } from 'hono';
import { clickIdValido, normalizarEmail, normalizarTelefone, registrarCaptura } from '../lib/cliques';
import { classificarCanal, hostDaReferencia, limparUtm } from '../lib/origens';
import { ALFABETO, PREFIXO, codigoValido } from '../lib/protocolos';
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
coleta.options('/:rota{clique|origem|protocolo}', async (c) => {
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
 * POST /coleta/origem — de onde veio quem preencheu o formulário.
 *
 * Irmã de `/coleta/clique`, com a mesma porta (lista de sites, interruptor
 * `captura_ligada`, teto diário) e a mesma resposta muda. A diferença é que
 * esta aceita visita SEM click id: o link orgânico com UTM, a busca, o direto —
 * é o que separa os canais na tela de Origens.
 */
coleta.post('/origem', async (c) => {
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

  const email = normalizarEmail(corpo?.email);
  const telefone = normalizarTelefone(corpo?.telefone);
  if (!email && !telefone) return c.body(null, 204, cabecalhos);

  const { total } = (await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM origens_capturadas WHERE capturado_em >= datetime('now', '-1 day')`,
  ).first()) as { total: number };
  if (total >= TETO_DIARIO) {
    console.warn(JSON.stringify({ evento: 'origem_teto_diario', total }));
    return c.body(null, 204, cabecalhos);
  }

  const utm = {
    utm_source: limparUtm(corpo?.utm_source),
    utm_medium: limparUtm(corpo?.utm_medium),
    utm_campaign: limparUtm(corpo?.utm_campaign),
    utm_content: limparUtm(corpo?.utm_content),
    utm_term: limparUtm(corpo?.utm_term),
  };
  const referencia = hostDaReferencia(corpo?.referencia);
  const temGoogle = ['gclid', 'gbraid', 'wbraid'].includes(corpo?.click_tipo);
  const canal = classificarCanal({ ...utm, tem_google_click: temGoogle, referencia });
  const pagina = (v: unknown) => (typeof v === 'string' ? v.slice(0, 300) : null);

  const { meta } = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO origens_capturadas
       (canal, utm_source, utm_medium, utm_campaign, utm_content, utm_term, tem_click_id,
        referencia, email, telefone, pagina_entrada, pagina_form, origem_site)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    canal, utm.utm_source, utm.utm_medium, utm.utm_campaign, utm.utm_content, utm.utm_term,
    corpo?.click_tipo ? 1 : 0, referencia, email, telefone,
    pagina(corpo?.entrada), pagina(corpo?.pagina), new URL(permitido).hostname,
  ).run();

  if (meta.changes) console.log(JSON.stringify({ evento: 'origem_capturada', canal }));
  return c.body(null, 204, cabecalhos);
});

async function protocoloLigado(db: D1Database): Promise<boolean> {
  const r = await db.prepare(
    `SELECT valor FROM conversao_config WHERE chave = 'protocolo_ligado'`,
  ).first() as { valor: string | null } | null;
  return r?.valor === '1';
}

/**
 * POST /coleta/protocolo — o clique no botão de WhatsApp, com o código gerado.
 *
 * Mesma porta das irmãs (lista de sites, teto diário, resposta muda), mas com
 * interruptor próprio: `protocolo_ligado`, e não `captura_ligada`. O protocolo
 * muda a mensagem que o aluno vê no WhatsApp, e isso é decisão diferente de
 * medir em silêncio — tem de poder ficar desligado com a captura ligada.
 *
 * Diferente de `/coleta/origem`, aceita clique sem e-mail nem telefone: é a
 * razão de existir. A identidade chega depois, pelo webhook da mensagem.
 */
coleta.post('/protocolo', async (c) => {
  const permitido = origemOk(c.req.header('Origin'), await origensPermitidas(c.env.DB));
  if (!permitido) return c.body(null, 403);
  const cabecalhos = { ...semCache, 'Access-Control-Allow-Origin': permitido };

  if (!(await protocoloLigado(c.env.DB))) return c.body(null, 204, cabecalhos);

  let corpo: any;
  try {
    corpo = JSON.parse(await c.req.text());
  } catch {
    return c.body(null, 204, cabecalhos);
  }
  if (!codigoValido(corpo?.codigo)) return c.body(null, 204, cabecalhos);

  const { total } = (await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM protocolos_whatsapp WHERE gerado_em >= datetime('now', '-1 day')`,
  ).first()) as { total: number };
  if (total >= TETO_DIARIO) {
    console.warn(JSON.stringify({ evento: 'protocolo_teto_diario', total }));
    return c.body(null, 204, cabecalhos);
  }

  const utm = {
    utm_source: limparUtm(corpo?.utm_source),
    utm_medium: limparUtm(corpo?.utm_medium),
    utm_campaign: limparUtm(corpo?.utm_campaign),
    utm_content: limparUtm(corpo?.utm_content),
    utm_term: limparUtm(corpo?.utm_term),
  };
  const referencia = hostDaReferencia(corpo?.referencia);
  const clickTipo = ['gclid', 'gbraid', 'wbraid'].includes(corpo?.click_tipo) ? corpo.click_tipo : null;
  const clickValor = typeof corpo?.click_valor === 'string' && clickIdValido(corpo.click_valor)
    ? corpo.click_valor : null;
  const canal = classificarCanal({ ...utm, tem_google_click: Boolean(clickTipo), referencia });
  const texto = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : null);

  const { meta } = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO protocolos_whatsapp
       (codigo, numero_destino, pagina, origem_site, canal,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term, referencia,
        click_id_tipo, click_id_valor)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    corpo.codigo, normalizarTelefone(corpo?.numero), texto(corpo?.pagina, 300),
    new URL(permitido).hostname, canal,
    utm.utm_source, utm.utm_medium, utm.utm_campaign, utm.utm_content, utm.utm_term, referencia,
    clickValor ? clickTipo : null, clickValor,
  ).run();

  if (meta.changes) console.log(JSON.stringify({ evento: 'protocolo_gerado', canal }));
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
coleta.get('/ide-clique.js', async (c) => {
  const [sites, protocolo] = await Promise.all([
    origensPermitidas(c.env.DB),
    protocoloLigado(c.env.DB),
  ]);
  return c.body(montarScript(new URL(c.req.url).origin, sites, protocolo), 200, {
    'Content-Type': 'application/javascript; charset=utf-8',
    // Uma hora: curto o bastante para corrigir no mesmo dia, longo o bastante
    // para não virar uma requisição por página vista. É também o tempo que o
    // interruptor do protocolo leva para valer em quem já está no site.
    'Cache-Control': 'public, max-age=3600',
  });
});

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
const montarScript = (origem: string, sitesProprios: string[], protocolo: boolean) => `/* Captura de click id — Faculdade IDE. Servido por /coleta/ide-clique.js. */
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

  /* ---- Origem da visita (UTMs e referência), para separar os canais. ----
     Último toque não direto: UTM ou click id na URL sempre substituem a origem
     guardada; referência externa sem UTM só entra se não houver nada guardado;
     visita direta nunca apaga o que veio antes. Os sites da própria faculdade
     não contam como referência — passar do site para o formulário do CRM não
     é um canal. */
  var ENDPOINT_ORIGEM = '${origem}/coleta/origem';
  var CHAVE_ORIGEM = 'ide_origem';
  var PROPRIOS = ${JSON.stringify(sitesProprios)};
  var UTMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

  function proprio(host) {
    host = (host || '').toLowerCase();
    for (var i = 0; i < PROPRIOS.length; i++) {
      if (host === PROPRIOS[i] || host.slice(-(PROPRIOS[i].length + 1)) === '.' + PROPRIOS[i]) return true;
    }
    return host === location.hostname;
  }

  function origemGuardada() {
    var m = document.cookie.match(new RegExp('(?:^|; )' + CHAVE_ORIGEM + '=([^;]*)'));
    var bruto = m ? decodeURIComponent(m[1]) : null;
    if (!bruto) { try { bruto = localStorage.getItem(CHAVE_ORIGEM); } catch (e) {} }
    try { return bruto ? JSON.parse(bruto) : null; } catch (e) { return null; }
  }

  (function registrarChegada() {
    var q = new URLSearchParams(location.search);
    var o = {}, tem = false;
    for (var i = 0; i < UTMS.length; i++) {
      var v = q.get(UTMS[i]);
      if (v) { o[UTMS[i]] = v.slice(0, 200); tem = true; }
    }
    var click = atual ? atual.tipo : (q.get('fbclid') ? 'fbclid' : null);
    if (click) { o.click_tipo = click; tem = true; }
    var ref = '';
    try { ref = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) {}
    var externo = ref && !proprio(ref);
    if (externo) o.referencia = document.referrer.slice(0, 300);
    if (!tem && !(externo && !origemGuardada())) return;
    o.entrada = location.href.slice(0, 300);
    var json = JSON.stringify(o);
    var exp = new Date(Date.now() + DIAS * 864e5).toUTCString();
    document.cookie = CHAVE_ORIGEM + '=' + encodeURIComponent(json) + ';path=/;expires=' + exp + ';SameSite=Lax';
    try { localStorage.setItem(CHAVE_ORIGEM, json); } catch (e) {}
  })();

  function postar(url, corpo) {
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([corpo], { type: 'text/plain;charset=UTF-8' }));
        return;
      }
    } catch (e) {}
    try {
      fetch(url, { method: 'POST', body: corpo, keepalive: true, mode: 'cors',
                   headers: { 'Content-Type': 'text/plain;charset=UTF-8' } });
    } catch (e) {}
  }

  /* Vai sempre que o formulário tem identidade — inclusive sem origem
     guardada: isso é o canal "direto", que também precisa ser contado. */
  function enviarOrigem(form) {
    var quem = identidade(form);
    if (!quem.email && !quem.telefone) return;
    var o = origemGuardada() || {};
    o.email = quem.email; o.telefone = quem.telefone;
    o.pagina = location.href.slice(0, 300);
    postar(ENDPOINT_ORIGEM, JSON.stringify(o));
  }

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
    if (ev.target && ev.target.tagName === 'FORM') { enviar(ev.target); enviarOrigem(ev.target); }
  }, true);

  /* Formulário que envia por AJAX sem evento de submit — comum em CRM. O
     clique no botão é o último momento em que os campos ainda estão na tela. */
  document.addEventListener('click', function (ev) {
    var alvo = ev.target && ev.target.closest ? ev.target.closest('button, input[type=submit]') : null;
    if (!alvo) return;
    var form = alvo.form || (alvo.closest ? alvo.closest('form') : null);
    if (form) { enviar(form); enviarOrigem(form); }
  }, true);

  /* ---- Protocolo do botão de WhatsApp. ----
     Quem chama no WhatsApp não preenche formulário, então não deixa e-mail nem
     telefone. No clique, o link ganha "[Protocolo: IDE-XXXXXX]" no fim da
     mensagem pronta, e o código vai para o painel com a origem da visita.
     Quando a mensagem chega no atendimento, o código liga a conversa a este
     clique. O código nasce aqui, sem esperar o servidor: o WhatsApp abre na
     hora, e uma falha de rede custa a medição, nunca a conversa. */
  var PROTOCOLO = ${protocolo ? 'true' : 'false'};
  var ENDPOINT_PROTOCOLO = '${origem}/coleta/protocolo';
  var ALFABETO = '${ALFABETO}';

  function gerarCodigo() {
    var n = new Uint32Array(6), s = '', i;
    try { crypto.getRandomValues(n); }
    catch (e) { for (i = 0; i < 6; i++) n[i] = Math.floor(Math.random() * 4294967296); }
    for (i = 0; i < 6; i++) s += ALFABETO.charAt(n[i] % ALFABETO.length);
    return '${PREFIXO}' + s;
  }

  /* Só link de conversa com número: wa.me/55…, api.whatsapp.com/send,
     web.whatsapp.com/send e whatsapp://send. O link curto wa.me/message/…
     não aceita texto, então fica como está. */
  function linkWhatsapp(href) {
    var u;
    try { u = new URL(href, location.href); } catch (e) { return null; }
    var host = u.hostname.toLowerCase().replace(/^www\\./, '');
    if (u.protocol === 'whatsapp:') return u;
    if (host === 'wa.me') return /^\\/\\d+\\/?$/.test(u.pathname) ? u : null;
    if (host === 'api.whatsapp.com' || host === 'web.whatsapp.com' || host === 'whatsapp.com') {
      return /^\\/send\\/?$/.test(u.pathname) ? u : null;
    }
    return null;
  }

  /* Monta a busca à mão, com encodeURIComponent: o URLSearchParams escreve
     espaço como "+", e há cliente de WhatsApp que mostra o "+" literal. */
  function comProtocolo(u, codigo) {
    var texto = u.searchParams.get('text') || '';
    texto = (texto ? texto + '\\n\\n' : 'Olá!\\n\\n') + '[Protocolo: ' + codigo + ']';
    var resto = u.search.replace(/^\\?/, '').split('&').filter(function (p) {
      return p && p.indexOf('text=') !== 0;
    });
    resto.push('text=' + encodeURIComponent(texto));
    u.search = '?' + resto.join('&');
    return u.toString();
  }

  function aoClicarWhatsapp(ev) {
    if (!PROTOCOLO) return;
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (!a) return;

    /* O href original fica guardado no próprio link: o segundo clique parte
       dele, e não do link já carimbado — senão os protocolos se acumulariam
       na mensagem. Se a página trocou o href depois, o novo vira o original. */
    var atual = a.getAttribute('href');
    var original = a.getAttribute('data-ide-wa-carimbado') === atual
      ? a.getAttribute('data-ide-wa-original') : atual;
    var u = linkWhatsapp(original);
    if (!u) return;

    var codigo = gerarCodigo();
    var carimbado = comProtocolo(u, codigo);
    a.setAttribute('data-ide-wa-original', original);
    a.setAttribute('data-ide-wa-carimbado', carimbado);
    a.setAttribute('href', carimbado);

    var o = origemGuardada() || {};
    var c = guardado();
    var numero = u.searchParams.get('phone') || (u.pathname.match(/\\d{10,15}/) || [''])[0];
    postar(ENDPOINT_PROTOCOLO, JSON.stringify({
      codigo: codigo,
      numero: numero,
      pagina: location.href.slice(0, 300),
      utm_source: o.utm_source, utm_medium: o.utm_medium, utm_campaign: o.utm_campaign,
      utm_content: o.utm_content, utm_term: o.utm_term,
      referencia: o.referencia,
      click_tipo: c ? c.tipo : null, click_valor: c ? c.valor : null
    }));
  }

  /* Fase de captura: o href muda antes que a navegação aconteça e antes de
     qualquer handler da página que leia o link para abrir numa janela nova.
     auxclick cobre o botão do meio (abrir em nova aba). */
  document.addEventListener('click', aoClicarWhatsapp, true);
  document.addEventListener('auxclick', aoClicarWhatsapp, true);
})();
`;

export default coleta;
