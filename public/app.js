/*
 * Painel Faculdade IDE — frontend.
 *
 * Navegação por hash (#/funil) de propósito: o Worker serve /api e /webhook na
 * mesma origem, e rotas de path exigiriam o roteador de assets em modo SPA, que
 * devolveria index.html para /api/* também.
 */
'use strict';

// ------------------------------------------------------------------ utilitários

/** Escapa antes de interpolar. Nome de lead vem do Rubeus, é texto de terceiro. */
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dec = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const int = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

const fmtBRL = (n) => (n === null || n === undefined ? '—' : brl.format(n));
const fmtInt = (n) => (n === null || n === undefined ? '—' : int.format(n));
const fmtDec = (n) => (n === null || n === undefined ? '—' : dec.format(n));

/**
 * Converte "YYYY-MM-DD" em Date local.
 *
 * `new Date("2026-07-29")` é interpretado como UTC; no fuso do Brasil (-03:00)
 * isso volta 28/07 ao formatar. Montamos a data por componente pra não perder um
 * dia em todo rótulo de gráfico.
 */
function dataLocal(iso) {
  if (!iso) return null;
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!a || !m || !d) return null;
  return new Date(a, m - 1, d);
}

function fmtDiaMes(iso) {
  const d = dataLocal(iso);
  if (!d) return '—';
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
}

/** Timestamp completo → "29/07 16:12". Aqui o horário importa, então usa Date nativo. */
function fmtDataHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Iniciais pro avatar. Sem foto real: é lead, não cliente confirmado (LGPD). */
function iniciais(nome) {
  if (!nome) return '—';
  const partes = String(nome).trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '—';
  const a = partes[0][0] || '';
  const b = partes.length > 1 ? partes[partes.length - 1][0] || '' : '';
  return (a + b).toUpperCase();
}

/**
 * Chip de variação.
 *
 * `inverso` marca métrica em que menor é melhor — custo por resultado e CPC.
 * Sem isso, uma queda de 25% no custo por resultado apareceria em vermelho, que
 * é o oposto do que aconteceu. A seta continua indicando a direção real do
 * número; só a cor segue o significado para o negócio.
 */
function chipDelta(pct, inverso = false) {
  if (pct === null || pct === undefined) {
    return '<span class="delta flat" title="Sem período anterior para comparar">—</span>';
  }
  const bom = inverso ? pct < 0 : pct > 0;
  const cls = pct === 0 ? 'flat' : bom ? 'up' : 'down';
  const seta = pct > 0 ? '↑' : pct < 0 ? '↓' : '→';
  return `<span class="delta ${cls}">${seta} ${fmtDec(Math.abs(pct))}%</span>`;
}


// ------------------------------------------------------------------------ API

class ErroApi extends Error {}

async function api(caminho) {
  let resp;
  try {
    resp = await fetch(caminho, { headers: { Accept: 'application/json' } });
  } catch {
    throw new ErroApi('Não foi possível falar com o servidor. Verifique a conexão.');
  }
  if (resp.status === 401 || resp.status === 403) {
    throw new ErroApi('Sessão expirada. Recarregue a página para autenticar de novo.');
  }
  if (!resp.ok) {
    let detalhe = '';
    try { detalhe = (await resp.json()).erro || ''; } catch { /* corpo não-JSON */ }
    throw new ErroApi(`O servidor respondeu ${resp.status}${detalhe ? ` (${detalhe})` : ''}.`);
  }
  return resp.json();
}

// ------------------------------------------------------------------- gráficos

const isMobile = () => window.matchMedia('(max-width: 767px)').matches;

/** Mostra no máximo ~7 rótulos no eixo x, senão viram um borrão. */
function passoRotulos(n) { return Math.max(1, Math.ceil(n / 7)); }

/**
 * Preenche com zero os dias sem registro dentro da janela.
 *
 * A API só devolve os dias que têm linha. Plotar essa lista direto espaça os
 * pontos por índice, não por data: três dias sem conversão viram o mesmo passo
 * horizontal que um dia, e a linha mente sobre o ritmo. Aqui o eixo x volta a
 * ser tempo contínuo.
 *
 * Série vazia continua vazia de propósito — quem trata isso é o estado vazio do
 * gráfico, não uma reta de zeros.
 */
function densificarPorDia(dados, chave, deISO, ateISO) {
  if (!dados.length) return [];
  const porData = new Map(dados.map((d) => [String(d.data).slice(0, 10), Number(d[chave]) || 0]));
  const ini = dataLocal(deISO);
  const fim = dataLocal(ateISO);
  if (!ini || !fim || fim < ini) return dados;

  const saida = [];
  for (const d = new Date(ini); d <= fim; d.setDate(d.getDate() + 1)) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    saida.push({ data: iso, [chave]: porData.get(iso) ?? 0 });
  }
  return saida;
}

/** Um pouco de folga no topo pra marca mais alta não encostar na borda do card. */
const comFolga = (max) => (max > 0 ? max * 1.12 : 1);

/**
 * Gráfico de barras. Uma série só, então sem legenda — o título do card nomeia.
 * Topo arredondado em 4px ancorado na linha de base e 2px de respiro entre barras.
 */
function graficoBarras(container, dados, fmtValor) {
  if (!dados.length) return vazioGrafico(container, 'Sem investimento registrado no período.');

  const larg = Math.max(280, container.clientWidth);
  const alt = 180;
  const padB = 22, padT = 8;
  const areaAlt = alt - padB - padT;
  const max = comFolga(Math.max(...dados.map((d) => d.valor), 0));
  const passoX = larg / dados.length;
  const largBarra = Math.max(4, Math.min(40, passoX - 2)); // 2px de gap
  const passo = passoRotulos(dados.length);

  let barras = '', rotulos = '', alvos = '';
  dados.forEach((d, i) => {
    // Zero não vira toco de 2px: um dia sem investimento tem que ficar vazio,
    // senão a linha de tocos parece dado que não existe. O piso só vale pra
    // valor positivo pequeno demais pra render.
    const h = d.valor > 0 ? Math.max(2, (d.valor / max) * areaAlt) : 0;
    const x = i * passoX + (passoX - largBarra) / 2;
    const y = padT + areaAlt - h;
    barras += `<rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${largBarra.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="url(#gradBarra)"></rect>`;
    if (i % passo === 0) {
      rotulos += `<text class="axis-label" x="${(i * passoX + passoX / 2).toFixed(1)}" y="${alt - 6}" text-anchor="middle">${esc(fmtDiaMes(d.data))}</text>`;
    }
    alvos += `<rect class="hit" x="${(i * passoX).toFixed(1)}" y="0" width="${passoX.toFixed(1)}" height="${alt}" data-i="${i}"></rect>`;
  });

  container.innerHTML = `
    <div class="chart-wrap">
      <svg class="chart" width="${larg}" height="${alt}" viewBox="0 0 ${larg} ${alt}" role="img"
           aria-label="Investimento por dia no período selecionado">
        <defs>
          <linearGradient id="gradBarra" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#4F8FE8"/><stop offset="100%" stop-color="#1D4E89"/>
          </linearGradient>
        </defs>
        ${barras}${rotulos}${alvos}
      </svg>
      <div class="tooltip" role="status"></div>
    </div>`;

  ligarTooltip(container, dados, (d) => `<div class="tooltip-title">${esc(fmtDiaMes(d.data))}</div><div class="tooltip-value">${esc(fmtValor(d.valor))}</div>`);
}

/**
 * Gráfico de área/linha. Linha de 2px, preenchimento em gradiente até
 * transparente, marcador de 8px e crosshair no hover.
 */
function graficoArea(container, dados, fmtValor) {
  if (!dados.length) return vazioGrafico(container, 'Nenhuma conversão enviada no período.');

  const larg = Math.max(280, container.clientWidth);
  const alt = 180;
  const padB = 22, padT = 12, padX = 6;
  const areaAlt = alt - padB - padT;
  const max = comFolga(Math.max(...dados.map((d) => d.total), 0));
  const n = dados.length;
  const x = (i) => (n === 1 ? larg / 2 : padX + (i * (larg - padX * 2)) / (n - 1));
  const y = (v) => padT + areaAlt - (v / max) * areaAlt;

  const pontos = dados.map((d, i) => `${x(i).toFixed(1)},${y(d.total).toFixed(1)}`);
  const linha = 'M' + pontos.join(' L');
  const area = `${linha} L${x(n - 1).toFixed(1)},${(padT + areaAlt).toFixed(1)} L${x(0).toFixed(1)},${(padT + areaAlt).toFixed(1)} Z`;
  const passo = passoRotulos(n);

  let rotulos = '', alvos = '';
  dados.forEach((d, i) => {
    if (i % passo === 0) {
      rotulos += `<text class="axis-label" x="${x(i).toFixed(1)}" y="${alt - 6}" text-anchor="middle">${esc(fmtDiaMes(d.data))}</text>`;
    }
    const larguraAlvo = larg / n;
    alvos += `<rect class="hit" x="${(x(i) - larguraAlvo / 2).toFixed(1)}" y="0" width="${larguraAlvo.toFixed(1)}" height="${alt}" data-i="${i}"></rect>`;
  });

  container.innerHTML = `
    <div class="chart-wrap">
      <svg class="chart" width="${larg}" height="${alt}" viewBox="0 0 ${larg} ${alt}" role="img"
           aria-label="Conversões enviadas por dia no período selecionado">
        <defs>
          <linearGradient id="gradArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#4F8FE8" stop-opacity="0.35"/>
            <stop offset="100%" stop-color="#4F8FE8" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <path d="${area}" fill="url(#gradArea)"></path>
        <path d="${linha}" fill="none" stroke="#4F8FE8" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></path>
        <line class="crosshair" style="display:none" y1="0" y2="${padT + areaAlt}"></line>
        <circle class="marcador" style="display:none" r="4" fill="#4F8FE8" stroke="#0A0E14" stroke-width="2"></circle>
        ${rotulos}${alvos}
      </svg>
      <div class="tooltip" role="status"></div>
    </div>`;

  const svg = container.querySelector('svg');
  const cross = svg.querySelector('.crosshair');
  const marca = svg.querySelector('.marcador');

  ligarTooltip(
    container, dados,
    (d) => `<div class="tooltip-title">${esc(fmtDiaMes(d.data))}</div><div class="tooltip-value">${esc(fmtValor(d.total))}</div>`,
    (i) => {
      if (i === null) { cross.style.display = 'none'; marca.style.display = 'none'; return; }
      const px = x(i), py = y(dados[i].total);
      cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.style.display = '';
      marca.setAttribute('cx', px); marca.setAttribute('cy', py); marca.style.display = '';
    },
    (i) => ({ cx: x(i), cy: y(dados[i].total) }),
  );
}

/** Liga hover/foco dos alvos invisíveis ao tooltip (e ao crosshair, quando houver). */
function ligarTooltip(container, dados, render, aoMover, posDe) {
  const wrap = container.querySelector('.chart-wrap');
  const tip = wrap.querySelector('.tooltip');
  const svg = wrap.querySelector('svg');

  function mostrar(i) {
    const d = dados[i];
    if (!d) return;
    tip.innerHTML = render(d);
    tip.classList.add('on');
    const p = posDe ? posDe(i) : { cx: null, cy: null };
    const rect = svg.getBoundingClientRect();
    const alvo = svg.querySelector(`.hit[data-i="${i}"]`);
    const cx = p.cx !== null && p.cx !== undefined
      ? p.cx
      : parseFloat(alvo.getAttribute('x')) + parseFloat(alvo.getAttribute('width')) / 2;
    const cy = p.cy !== null && p.cy !== undefined ? p.cy : 8;
    // O SVG é renderizado em pixels reais, então coordenada do viewBox == offset.
    tip.style.left = `${cx}px`;
    tip.style.top = `${Math.max(28, cy - 8)}px`;
    void rect;
    if (aoMover) aoMover(i);
  }
  function esconder() { tip.classList.remove('on'); if (aoMover) aoMover(null); }

  svg.querySelectorAll('.hit').forEach((alvo) => {
    const i = Number(alvo.dataset.i);
    alvo.addEventListener('mouseenter', () => mostrar(i));
    alvo.addEventListener('focus', () => mostrar(i));
    alvo.setAttribute('tabindex', '0');
  });
  svg.addEventListener('mouseleave', esconder);
  svg.addEventListener('blur', esconder, true);
}

function vazioGrafico(container, msg) {
  container.innerHTML = `<div class="state"><div class="state-msg">${esc(msg)}</div></div>`;
}

// -------------------------------------------------------------------- estados

const carregando = (linhas = 3) =>
  `<div class="card">${Array.from({ length: linhas }, () =>
    '<div class="skeleton" style="height:16px;margin-bottom:12px">carregando</div>').join('')}</div>`;

const vazio = (titulo, msg) =>
  `<div class="card"><div class="state"><div class="state-title">${esc(titulo)}</div><div class="state-msg">${esc(msg)}</div></div></div>`;

const erro = (msg) =>
  `<div class="card"><div class="state error"><div class="state-title">Não foi possível carregar</div><div class="state-msg">${esc(msg)}</div></div></div>`;

// --------------------------------------------------------------------- estado

const estado = {
  rota: 'overview',
  /**
   * Filtro de período compartilhado por todas as telas. `preset` guarda a
   * escolha do usuário; `de`/`ate` só valem quando preset === 'custom'.
   */
  filtro: { preset: '30d', de: null, ate: null, comparar: true },
  // Filtros da tabela de campanhas.
  campanhaBusca: '',
  campanhaStatus: '',
  campanhaOrdem: { coluna: 'investimento', desc: true },
  processoId: null,
  convPagina: 0,
  convStatus: '',
  conversasPagina: 0,
  limite: 25,
};

/*
 * Ícones em SVG inline, não emoji: a sidebar retraída é uma trilha só de
 * ícones, e emoji vem colorido e com métrica própria de cada sistema — numa
 * fileira vertical isso aparece como desalinhamento. `currentColor` faz o
 * ícone seguir o estado do item (ativo/inativo) sem regra extra.
 */
const svg = (d) =>
  `<svg class="nav-icone" viewBox="0 0 24 24" fill="none" stroke="currentColor"
     stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const ICONES = {
  overview: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  funil: svg('<path d="M3 4h18l-7 8v7l-4 2v-9L3 4Z"/>'),
  campanhas: svg('<path d="M3 20h4V10H3v10Zm7 0h4V4h-4v16Zm7 0h4v-6h-4v6Z"/>'),
  conversas: svg('<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.7-.8L3 21l1.9-5.2A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z"/>'),
};

const PAGINAS = [
  { id: 'overview',   nome: 'Visão geral',    curto: 'Visão' },
  { id: 'funil',      nome: 'Funil de leads', curto: 'Funil' },
  { id: 'campanhas',  nome: 'Campanhas',      curto: 'Camp.' },
  { id: 'conversas',  nome: 'Conversas',      curto: 'Chat' },
];

// --------------------------------------------------------------------- páginas

async function paginaOverview(el) {
  el.innerHTML = cabecalho('Visão geral', '') + barraFiltros() + carregando(4);

  // Duas origens distintas: mídia vem da consulta ao vivo ao Google Ads,
  // leads e conversas vêm do D1 (Rubeus e Evolution).
  let ads, base;
  try {
    [ads, base] = await Promise.all([
      api(`/api/ads/overview?${queryPeriodo()}${estado.filtro.comparar ? '&comparar=1' : ''}`),
      api(`/api/overview?dias=${diasDoPeriodo()}`),
    ]);
  } catch (e) {
    return void (el.innerHTML = cabecalho('Visão geral', '') + barraFiltros() + erro(e.message));
  }

  const t = ads.totais;
  const dl = ads.comparacao ? ads.comparacao.deltas : {};
  // Totais da janela anterior: o chip diz "quanto variou", esta linha diz
  // "variou em relação a quê". Sem ela, +37,3% é um número sem âncora.
  const ant = ads.comparacao ? ads.comparacao.totais : null;
  const leads = base.cards.leads_periodo;

  const cards = [
    { icone: '💰', cls: '', label: 'Investimento', valor: fmtBRL(t.investimento), delta: dl.investimento, antes: ant && fmtBRL(ant.investimento), rodape: 'Google Ads' },
    { icone: '✓', cls: 'success', label: 'Resultados', valor: fmtDec(t.resultados), delta: dl.resultados, antes: ant && fmtDec(ant.resultados), rodape: 'Todas as conversões da plataforma' },
    { icone: '⊘', cls: '', label: 'Custo / resultado', valor: fmtBRL(t.custo_por_resultado), delta: dl.custo_por_resultado, inverso: true, antes: ant && fmtBRL(ant.custo_por_resultado), rodape: 'Investimento ÷ resultados' },
    { icone: '◐', cls: '', label: 'Taxa de conversão', valor: t.taxa_conversao === null ? '—' : fmtDec(t.taxa_conversao) + '%', delta: dl.taxa_conversao, antes: ant && (ant.taxa_conversao === null ? '—' : fmtDec(ant.taxa_conversao) + '%'), rodape: 'Resultados ÷ cliques' },
    { icone: '◎', cls: '', label: 'Leads no período', valor: fmtInt(leads.valor), delta: leads.delta_pct, rodape: 'Contatos distintos no Rubeus' },
  ].map((k) => `
    <div class="card">
      <div class="stat-icon ${k.cls}" aria-hidden="true">${k.icone}</div>
      <div class="stat-label">${esc(k.label)}</div>
      <div class="stat-value tnum">${esc(k.valor)}</div>
      ${chipDelta(k.delta, k.inverso)}
      ${k.antes ? `<span class="comparado">antes: <strong class="tnum">${esc(k.antes)}</strong></span>` : ''}
      <span class="stat-footer">${esc(k.rodape)}</span>
    </div>`).join('');

  const secundarios = [
    ['Impressões', fmtInt(t.impressoes), ant && fmtInt(ant.impressoes)],
    ['Cliques', fmtInt(t.cliques), ant && fmtInt(ant.cliques)],
    ['CPC médio', fmtBRL(t.cpc_medio), ant && fmtBRL(ant.cpc_medio)],
    ['CTR', t.ctr === null ? '—' : fmtDec(t.ctr) + '%', ant && (ant.ctr === null ? '—' : fmtDec(ant.ctr) + '%')],
  ].map(([r, v, a]) => `<div class="card">
      <div class="stat-label">${esc(r)}</div>
      <div class="stat-value tnum" style="font-size:18px">${esc(v)}</div>
      ${a ? `<span class="comparado">antes: <strong class="tnum">${esc(a)}</strong></span>` : ''}
    </div>`).join('');

  el.innerHTML = `
    ${cabecalho('Visão geral', ads.comparacao
      ? `${fmtDiaMes(ads.periodo.de)} a ${fmtDiaMes(ads.periodo.ate)} · comparado com ${fmtDiaMes(ads.comparacao.periodo.de)} a ${fmtDiaMes(ads.comparacao.periodo.ate)}`
      : `${fmtDiaMes(ads.periodo.de)} a ${fmtDiaMes(ads.periodo.ate)}`)}
    ${barraFiltros()}
    <div class="stat-grid">${cards}</div>
    <div class="stat-grid">${secundarios}</div>
    <div class="chart-grid">
      <div class="card">
        <div class="card-head"><div class="card-title">Investimento diário</div></div>
        <div id="g-invest"></div>
        <div class="chart-caption"><span class="dot"></span> Total de ${fmtBRL(t.investimento)} no período</div>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title">Resultados ao longo do tempo</div></div>
        <div id="g-conv"></div>
        <div class="chart-caption"><span class="dot"></span> ${fmtDec(t.resultados)} resultados no período</div>
      </div>
    </div>
    <div class="bottom-grid">
      <div class="card">
        <div class="card-head"><div class="card-title">Conversas recentes</div></div>
        ${base.conversas_recentes.length ? listaConversas(base.conversas_recentes) : `<div class="state"><div class="state-msg">Nenhuma conversa capturada ainda. Elas chegam pela Evolution API.</div></div>`}
      </div>
    </div>`;

  const dados = {
    periodo: { de: ads.periodo.de, ate: ads.periodo.ate },
    series: {
      investimento_diario: ads.serie_diaria.map((x) => ({ data: x.data, valor: x.investimento })),
      conversoes_diarias: ads.serie_diaria.map((x) => ({ data: x.data, total: x.resultados })),
    },
  };
  desenharGraficos(dados);
  window.__redesenhar = () => desenharGraficos(dados);
}


/** Tabela de campanhas — Google Ads ao vivo, com busca, filtro e ordenação. */
const COLUNAS_CAMPANHA = [
  { id: 'nome', rotulo: 'Campanha', tipo: 'texto' },
  { id: 'status', rotulo: 'Status', tipo: 'texto' },
  { id: 'investimento', rotulo: 'Investimento', tipo: 'brl' },
  { id: 'resultados', rotulo: 'Resultados', tipo: 'dec' },
  { id: 'custo_por_resultado', rotulo: 'Custo/result.', tipo: 'brl' },
  { id: 'cliques', rotulo: 'Cliques', tipo: 'int' },
  { id: 'ctr', rotulo: 'CTR', tipo: 'pct' },
];

function celula(item, col) {
  const v = item[col.id];
  if (col.tipo === 'brl') return fmtBRL(v);
  if (col.tipo === 'dec') return fmtDec(v);
  if (col.tipo === 'int') return fmtInt(v);
  if (col.tipo === 'pct') return v === null || v === undefined ? '—' : fmtDec(v) + '%';
  return esc(v ?? '—');
}

async function paginaCampanhas(el) {
  el.innerHTML = cabecalho('Campanhas', 'Google Ads') + barraFiltros() + carregando(6);

  let d;
  try { d = await api(`/api/ads/campanhas?${queryPeriodo()}`); }
  catch (e) { return void (el.innerHTML = cabecalho('Campanhas', '') + barraFiltros() + erro(e.message)); }

  const busca = estado.campanhaBusca.trim().toLowerCase();
  const ord = estado.campanhaOrdem;

  let itens = d.itens.filter((i) => i.investimento > 0);
  if (busca) itens = itens.filter((i) => i.nome.toLowerCase().includes(busca));
  if (estado.campanhaStatus) itens = itens.filter((i) => i.status === estado.campanhaStatus);

  itens = [...itens].sort((a, b) => {
    const x = a[ord.coluna], y = b[ord.coluna];
    // null sempre no fim, independente da direção — "sem valor" não é o menor
    // valor, é ausência de valor.
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    const cmp = typeof x === 'string' ? x.localeCompare(y, 'pt-BR') : x - y;
    return ord.desc ? -cmp : cmp;
  });

  const statusDisponiveis = [...new Set(d.itens.filter((i) => i.investimento > 0).map((i) => i.status))].sort();
  const optsStatus = ['<option value="">Todos os status</option>']
    .concat(statusDisponiveis.map((st) => `<option value="${esc(st)}"${st === estado.campanhaStatus ? ' selected' : ''}>${esc(st)}</option>`))
    .join('');

  const cabecalhos = COLUNAS_CAMPANHA.map((c) => {
    const ativa = ord.coluna === c.id;
    const seta = ativa ? (ord.desc ? ' ↓' : ' ↑') : '';
    return `<th><button class="th-sort${ativa ? ' ativa' : ''}" data-col="${c.id}"
              aria-sort="${ativa ? (ord.desc ? 'descending' : 'ascending') : 'none'}">${esc(c.rotulo)}${seta}</button></th>`;
  }).join('');

  const linhas = itens.map((i) => `<tr>${
    COLUNAS_CAMPANHA.map((c) => `<td class="${c.id === 'nome' ? '' : 'muted tnum'}">${celula(i, c)}</td>`).join('')
  }</tr>`).join('');

  const totalInv = itens.reduce((s2, i) => s2 + i.investimento, 0);
  const totalRes = itens.reduce((s2, i) => s2 + i.resultados, 0);

  el.innerHTML = `
    ${cabecalho('Campanhas', `${fmtDiaMes(d.periodo.de)} a ${fmtDiaMes(d.periodo.ate)}`)}
    ${barraFiltros()}
    <div class="card">
      <div class="card-head">
        <div class="filtros">
          <input class="select" id="c-busca" type="search" placeholder="Buscar campanha…"
                 value="${esc(estado.campanhaBusca)}" aria-label="Buscar campanha">
          <select class="select" id="c-status" aria-label="Filtrar por status">${optsStatus}</select>
        </div>
        <div class="card-title tnum">${itens.length} de ${d.itens.length} · ${fmtBRL(totalInv)} · ${fmtDec(totalRes)} result.</div>
      </div>
      ${itens.length ? `<div class="table-wrap"><table>
        <thead><tr>${cabecalhos}</tr></thead>
        <tbody>${linhas}</tbody>
      </table></div>` : `<div class="state"><div class="state-title">Nenhuma campanha</div><div class="state-msg">Nenhuma campanha com investimento bate os filtros deste período.</div></div>`}
    </div>`;

  const bu = document.getElementById('c-busca');
  if (bu) {
    // Debounce: sem isso cada tecla re-renderiza a tabela inteira.
    let t;
    bu.addEventListener('input', (e) => {
      clearTimeout(t);
      const v = e.target.value;
      t = setTimeout(() => { estado.campanhaBusca = v; render(); }, 250);
    });
  }
  const st = document.getElementById('c-status');
  if (st) st.addEventListener('change', (e) => { estado.campanhaStatus = e.target.value; render(); });

  document.querySelectorAll('.th-sort').forEach((b) => {
    b.addEventListener('click', () => {
      const col = b.dataset.col;
      if (ord.coluna === col) ord.desc = !ord.desc;
      else { ord.coluna = col; ord.desc = true; }
      render();
    });
  });

  window.__redesenhar = () => render();
}

function desenharGraficos(d) {
  const gi = document.getElementById('g-invest');
  const gc = document.getElementById('g-conv');
  const invest = densificarPorDia(d.series.investimento_diario || [], 'valor', d.periodo.de, d.periodo.ate);
  const conv = densificarPorDia(d.series.conversoes_diarias || [], 'total', d.periodo.de, d.periodo.ate);
  if (gi) graficoBarras(gi, invest, fmtBRL);
  if (gc) graficoArea(gc, conv, (v) => `${fmtInt(v)} conv.`);
}

async function paginaFunil(el) {
  el.innerHTML = cabecalho('Funil de leads', 'Contatos distintos que passaram por cada etapa') + carregando(3);

  const url = () => `/api/funil?dias=90${estado.processoId ? `&processo_id=${encodeURIComponent(estado.processoId)}` : ''}`;

  let d;
  try {
    d = await api(url());
    /*
     * O funil é sempre de UM processo. Somar processos diferentes produz taxa
     * acima de 100% — cada processo usa um conjunto de etapas distinto, então
     * uma etapa que só existe em dois deles acumula mais contatos do que a
     * etapa anterior, que só existe em um. Na primeira visita assumimos o
     * processo com mais leads.
     */
    if (!estado.processoId && (d.processos_disponiveis || []).length) {
      estado.processoId = String(d.processos_disponiveis[0].processo_id);
      d = await api(url());
    }
  } catch (e) { return void (el.innerHTML = cabecalho('Funil de leads', '') + erro(e.message)); }

  const opcoes = (d.processos_disponiveis || []).map((p) =>
    `<option value="${esc(p.processo_id)}"${String(p.processo_id) === String(estado.processoId) ? ' selected' : ''}>${esc(p.processo_nome || 'Processo ' + p.processo_id)} (${fmtInt(p.leads)})</option>`).join('');

  const comDado = d.etapas.filter((e) => e.total > 0);
  const corpo = comDado.length
    ? (isMobile() ? funilVertical(d) : funilHorizontal(d))
    : `<div class="state"><div class="state-title">Nenhum lead neste recorte</div><div class="state-msg">Assim que o Rubeus disparar eventos de etapa para o Worker, o funil aparece aqui.</div></div>`;

  el.innerHTML = `
    ${cabecalho('Funil de leads', 'Contatos distintos que passaram por cada etapa · últimos 90 dias')}
    <div class="card">
      <div class="card-head">
        <div class="card-title">Etapas do Rubeus</div>
        <select class="select" id="sel-processo" aria-label="Filtrar por processo">${opcoes}</select>
      </div>
      ${corpo}
      ${d.etapa_maior_queda ? `<div class="chart-caption">Maior queda entre etapas: <strong>${esc(d.etapa_maior_queda)}</strong></div>` : ''}
    </div>`;

  const sel = document.getElementById('sel-processo');
  if (sel) sel.addEventListener('change', (ev) => {
    estado.processoId = ev.target.value || null;
    render();
  });
  window.__redesenhar = () => render();
}

function funilHorizontal(d) {
  const etapas = d.etapas;
  let html = '<div class="funnel">';
  etapas.forEach((e, i) => {
    if (i > 0) {
      const taxa = e.taxa_desde_anterior_pct;
      html += `<div class="funnel-arrow"><span class="funnel-arrow-glyph" aria-hidden="true">→</span><span class="funnel-rate tnum">${taxa === null ? '—' : fmtDec(taxa) + '%'}</span></div>`;
    }
    const alerta = d.etapa_maior_queda === e.etapa;
    html += `<div class="funnel-step${alerta ? ' warn' : ''}">
      <div class="funnel-count tnum">${fmtInt(e.total)}</div>
      <div class="funnel-label">${esc(e.etapa)}</div>
      ${alerta ? '<span class="funnel-flag">maior queda</span>' : ''}
    </div>`;
  });
  return html + '</div>';
}

function funilVertical(d) {
  let html = '<div class="funnel-v">';
  d.etapas.forEach((e, i) => {
    if (i > 0) {
      const taxa = e.taxa_desde_anterior_pct;
      html += `<div class="funnel-connector"><span class="funnel-connector-line"></span><span class="funnel-rate tnum">${taxa === null ? '—' : fmtDec(taxa) + '%'}</span></div>`;
    }
    const alerta = d.etapa_maior_queda === e.etapa;
    html += `<div class="funnel-row${alerta ? ' warn' : ''}">
      <div><div class="funnel-label">${esc(e.etapa)}</div>${alerta ? '<span class="funnel-flag">maior queda</span>' : ''}</div>
      <div class="funnel-count tnum">${fmtInt(e.total)}</div>
    </div>`;
  });
  return html + '</div>';
}

async function paginaConversas(el) {
  el.innerHTML = cabecalho('Conversas', 'WhatsApp via Evolution API') + carregando(5);

  let d;
  try {
    const off = estado.conversasPagina * estado.limite;
    d = await api(`/api/conversas?limite=${estado.limite}&offset=${off}`);
  } catch (e) { return void (el.innerHTML = cabecalho('Conversas', '') + erro(e.message)); }

  const r = d.resumo;
  el.innerHTML = `
    ${cabecalho('Conversas', 'WhatsApp via Evolution API · somente leitura')}
    <div class="stat-grid">
      <div class="card"><div class="stat-label">Total de conversas</div><div class="stat-value tnum">${fmtInt(r.total)}</div></div>
      <div class="card"><div class="stat-label">Respondidas</div><div class="stat-value tnum">${fmtInt(r.respondidas)}</div></div>
      <div class="card"><div class="stat-label">Tempo médio de resposta</div><div class="stat-value tnum">${r.total ? fmtDec(r.tempo_medio_min) + ' min' : '—'}</div></div>
    </div>
    <div class="card">
      <div class="card-head"><div class="card-title">Conversas recentes</div></div>
      ${d.itens.length ? listaConversas(d.itens) : `<div class="state"><div class="state-title">Nenhuma conversa</div><div class="state-msg">As conversas aparecem aqui conforme a Evolution API envia eventos para o Worker.</div></div>`}
      ${paginador(d.paginacao, estado.conversasPagina, 'conversas')}
    </div>`;

  ligarPaginador('conversas', (p) => { estado.conversasPagina = p; render(); });
  window.__redesenhar = () => render();
}

// ------------------------------------------------------------------ fragmentos

const cabecalho = (titulo, sub) => `
  <div class="page-head">
    <div>
      <div class="page-title">${esc(titulo)}</div>
      ${sub ? `<div class="page-sub">${esc(sub)}</div>` : ''}
    </div>
  </div>`;

const PRESETS = [
  { id: '7d',  nome: 'Últimos 7 dias' },
  { id: '30d', nome: 'Últimos 30 dias' },
  { id: '90d', nome: 'Últimos 90 dias' },
  { id: 'mes', nome: 'Este mês' },
  { id: 'mes_anterior', nome: 'Mês passado' },
  { id: 'custom', nome: 'Período personalizado' },
];

const isoDia = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Traduz o filtro em datas concretas.
 *
 * "Últimos N dias" termina ONTEM, não hoje: o Google Ads fecha o dia no fuso da
 * conta e o parcial de hoje entraria como queda falsa no último ponto da série.
 */
function resolverPeriodo() {
  const f = estado.filtro;
  const hoje = new Date();
  const ontem = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);

  /*
   * Trava de sanidade: nenhum preset pode devolver início depois do fim. O caso
   * real é "Este mês" no dia 1º — o mês começa hoje, mas "ontem" ainda é do mês
   * anterior, e o intervalo saía invertido (ex.: 01/08 a 31/07). Quando isso
   * acontece o período colapsa no próprio dia 1º.
   */
  const ordenado = (de, ate) => (de > ate ? { de, ate: de } : { de, ate });

  if (f.preset === 'custom' && f.de && f.ate) return ordenado(f.de, f.ate);

  if (f.preset === 'mes') {
    return ordenado(isoDia(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), isoDia(ontem));
  }
  if (f.preset === 'mes_anterior') {
    const ini = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    const fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
    return ordenado(isoDia(ini), isoDia(fim));
  }
  const dias = { '7d': 7, '30d': 30, '90d': 90 }[f.preset] ?? 30;
  const ini = new Date(ontem.getFullYear(), ontem.getMonth(), ontem.getDate() - (dias - 1));
  return ordenado(isoDia(ini), isoDia(ontem));
}

/** Quantos dias o período cobre — o /api/overview do D1 ainda pensa em dias. */
function diasDoPeriodo() {
  const { de, ate } = resolverPeriodo();
  const d = Math.round((new Date(`${ate}T00:00:00Z`) - new Date(`${de}T00:00:00Z`)) / 86400000) + 1;
  return Math.min(365, Math.max(1, d));
}

const queryPeriodo = () => {
  const { de, ate } = resolverPeriodo();
  return `de=${de}&ate=${ate}`;
};

function barraFiltros() {
  const f = estado.filtro;
  const { de, ate } = resolverPeriodo();
  const opts = PRESETS.map((p) => `<option value="${p.id}"${p.id === f.preset ? ' selected' : ''}>${esc(p.nome)}</option>`).join('');

  return `<div class="filtros">
    <select class="select" id="f-preset" aria-label="Período">${opts}</select>
    <span class="filtro-datas${f.preset === 'custom' ? '' : ' oculto'}">
      <input class="select" type="date" id="f-de" value="${esc(f.de || de)}" aria-label="Data inicial">
      <span class="filtro-sep">até</span>
      <input class="select" type="date" id="f-ate" value="${esc(f.ate || ate)}" aria-label="Data final">
    </span>
    <button type="button" class="switch" id="f-comparar" role="switch"
            aria-checked="${f.comparar ? 'true' : 'false'}">
      <span class="switch-trilho" aria-hidden="true"><span class="switch-bolinha"></span></span>
      Comparar com período anterior
    </button>
  </div>`;
}

/** Liga os controles do filtro. Chamado depois de cada render. */
function ligarFiltros() {
  const preset = document.getElementById('f-preset');
  if (preset) preset.addEventListener('change', (e) => {
    estado.filtro.preset = e.target.value;
    if (e.target.value === 'custom' && !estado.filtro.de) {
      const p = resolverPeriodo();
      estado.filtro.de = p.de; estado.filtro.ate = p.ate;
    }
    render();
  });

  const de = document.getElementById('f-de');
  const ate = document.getElementById('f-ate');
  // Só re-renderiza com as duas pontas preenchidas e na ordem certa; senão o
  // primeiro caractere digitado já dispararia uma consulta com data inválida.
  const mudouData = () => {
    if (!de.value || !ate.value) return;
    if (de.value > ate.value) return;
    estado.filtro.de = de.value; estado.filtro.ate = ate.value;
    estado.filtro.preset = 'custom';
    render();
  };
  if (de) de.addEventListener('change', mudouData);
  if (ate) ate.addEventListener('change', mudouData);

  const cmp = document.getElementById('f-comparar');
  if (cmp) cmp.addEventListener('click', () => {
    estado.filtro.comparar = cmp.getAttribute('aria-checked') !== 'true';
    render();
  });
}


function listaConversas(itens) {
  return itens.map((c) => `
    <div class="convo-item">
      <div class="convo-left">
        <div class="lead-avatar">${esc(iniciais(c.contato_nome))}</div>
        <div>
          <div class="convo-name">${esc(c.contato_nome || 'Contato ' + (c.contato_id || '—'))}</div>
          <div class="convo-meta">${esc(c.atendente || 'Sem atendente')} · ${esc(fmtDataHora(c.iniciada_em))}</div>
        </div>
      </div>
      <div class="convo-right">
        <div class="label tnum">${c.tempo_resposta_min != null ? esc(fmtDec(c.tempo_resposta_min)) + ' min' : (c.respondida ? 'respondida' : 'sem resposta')}</div>
      </div>
    </div>`).join('');
}

function paginador(pag, pagina, ns) {
  const total = pag.total || 0;
  const paginas = Math.max(1, Math.ceil(total / estado.limite));
  if (total <= estado.limite) return '';
  return `<div class="pager">
    <button class="btn-secondary" data-pg="${ns}" data-dir="-1" ${pagina === 0 ? 'disabled' : ''}>← Anterior</button>
    <span class="pager-info">Página ${pagina + 1} de ${paginas}</span>
    <button class="btn-secondary" data-pg="${ns}" data-dir="1" ${pagina + 1 >= paginas ? 'disabled' : ''}>Próxima →</button>
  </div>`;
}

function ligarPaginador(ns, aoMudar) {
  document.querySelectorAll(`[data-pg="${ns}"]`).forEach((b) => {
    b.addEventListener('click', () => {
      const atual = ns === 'conv' ? estado.convPagina : estado.conversasPagina;
      aoMudar(Math.max(0, atual + Number(b.dataset.dir)));
    });
  });
}

// ---------------------------------------------------------------- navegação

function montarNav() {
  document.getElementById('nav').innerHTML = PAGINAS.map((p) => {
    const ativo = p.id === estado.rota;
    // O title é o que dá o nome do item quando a sidebar está retraída.
    return `<button class="nav-item${ativo ? ' active' : ''}" data-rota="${p.id}"
              title="${esc(p.nome)}" aria-current="${ativo ? 'page' : 'false'}">
        <span class="nav-left">${ICONES[p.id] || ''}<span class="nav-rotulo">${esc(p.nome)}</span></span>
      </button>`;
  }).join('');

  document.getElementById('tabbar').innerHTML = PAGINAS.map((p) => {
    const ativo = p.id === estado.rota;
    return `<button class="tab${ativo ? ' active' : ''}" data-rota="${p.id}"
              aria-current="${ativo ? 'page' : 'false'}">
        <span class="tab-icon">${ICONES[p.id] || ''}</span>${esc(p.curto)}
      </button>`;
  }).join('');

  document.querySelectorAll('[data-rota]').forEach((b) => {
    b.addEventListener('click', () => { location.hash = `#/${b.dataset.rota}`; });
  });

  const atual = PAGINAS.find((p) => p.id === estado.rota);
  document.getElementById('mobile-title').textContent = atual ? atual.nome : 'Painel IDE';
}

/**
 * Retrair/expandir a sidebar. A preferência persiste porque é escolha de espaço
 * de trabalho — reabrir o painel e achar o menu de volta expandido é irritante.
 */
const CHAVE_RETRAIDA = 'painel-ide:sidebar-retraida';

function aplicarRetraida(retraida) {
  const app = document.getElementById('app');
  const btn = document.getElementById('btn-retrair');
  app.classList.toggle('retraida', retraida);
  btn.textContent = retraida ? '»' : '«';
  btn.setAttribute('aria-expanded', String(!retraida));
  const rotulo = retraida ? 'Expandir menu' : 'Retrair menu';
  btn.setAttribute('title', rotulo);
  btn.setAttribute('aria-label', rotulo);
  // A sidebar mudou de largura: os gráficos são desenhados em pixels reais.
  if (window.__redesenhar) setTimeout(window.__redesenhar, 220);
}

function ligarRetrair() {
  let retraida = false;
  try { retraida = localStorage.getItem(CHAVE_RETRAIDA) === '1'; } catch { /* modo restrito */ }
  aplicarRetraida(retraida);

  document.getElementById('btn-retrair').addEventListener('click', () => {
    const agora = !document.getElementById('app').classList.contains('retraida');
    aplicarRetraida(agora);
    try { localStorage.setItem(CHAVE_RETRAIDA, agora ? '1' : '0'); } catch { /* modo restrito */ }
  });
}

const RENDERIZADORES = {
  overview: paginaOverview,
  funil: paginaFunil,
  campanhas: paginaCampanhas,
  conversas: paginaConversas,
};

async function render() {
  montarNav();
  const el = document.getElementById('page');
  const fn = RENDERIZADORES[estado.rota] || paginaOverview;
  await fn(el);

  ligarFiltros();
}

function lerHash() {
  const r = (location.hash || '').replace(/^#\/?/, '') || 'overview';
  estado.rota = RENDERIZADORES[r] ? r : 'overview';
}

async function carregarUsuario() {
  try {
    const { email } = await api('/api/me');
    document.getElementById('user-name').textContent = email || 'Sessão local';
    document.getElementById('user-avatar').textContent = email ? iniciais(email.split('@')[0].replace(/[._-]/g, ' ')) : 'ID';
  } catch {
    // Identificação é acessório: se falhar, o painel continua utilizável.
    document.getElementById('user-name').textContent = 'Sessão';
    document.getElementById('user-avatar').textContent = 'ID';
  }
}

window.addEventListener('hashchange', () => { lerHash(); render(); });

document.getElementById('btn-refresh').addEventListener('click', () => render());

// Gráficos são desenhados em pixels reais, então precisam ser refeitos no resize.
let tResize;
window.addEventListener('resize', () => {
  clearTimeout(tResize);
  tResize = setTimeout(() => { if (window.__redesenhar) window.__redesenhar(); }, 200);
});

ligarRetrair();
lerHash();
render();
carregarUsuario();
