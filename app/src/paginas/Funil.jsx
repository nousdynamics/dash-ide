import { useCallback, useEffect, useState } from 'react';
import { Cartao, Estado, Esqueleto, MultiSelect, Pill } from '../componentes/base';
import { BarraFiltros } from '../componentes/BarraFiltros';
import { GraficoAcumulado } from '../componentes/Graficos';
import { PainelLead } from '../componentes/PainelLead';
import { useApi } from '../lib/api';
import { MESES, filtroPadrao, queryPeriodo, resolverPeriodo, rotuloPeriodo } from '../lib/periodo';
import { fmtDataHora, fmtDec, fmtDiaMes, fmtInt, iniciais } from '../lib/formato';

const FONTES = {
  rd_marketing: { rotulo: 'RD Marketing', tom: 'neutro' },
  rubeus: { rotulo: 'Rubeus', tom: 'sucesso' },
  planilha: { rotulo: 'Planilha', tom: 'atencao' },
  misto: { rotulo: 'Medido + planilha', tom: 'atencao' },
  indisponivel: { rotulo: 'Indisponível', tom: 'perigo' },
};

/** "2026-06" vira "Junho/2026" — a coluna Mês da planilha, não a chave crua. */
function rotuloMes(chave) {
  const [ano, mes] = String(chave).split('-').map(Number);
  return MESES[mes - 1] ? `${MESES[mes - 1]}/${ano}` : chave;
}

function BadgeFonte({ fonte }) {
  const f = FONTES[fonte] || FONTES.rubeus;
  return <Pill tom={f.tom}>{f.rotulo}</Pill>;
}

function Variacao({ pct, abs, claro = false }) {
  if (pct === null || pct === undefined) {
    return <span className={`text-[11px] ${claro ? 'text-white/60' : 'text-tenue'}`}>sem base anterior</span>;
  }
  const seta = pct > 0 ? '↑' : pct < 0 ? '↓' : '→';
  const cor =
    pct === 0
      ? claro ? 'text-white/70' : 'text-tenue'
      : pct > 0
        ? 'text-sucesso'
        : 'text-perigo';
  const sinal = abs > 0 ? '+' : abs < 0 ? '−' : '';
  return (
    <span className={`text-[11px] font-semibold tnum ${cor}`}>
      {seta} {fmtDec(Math.abs(pct))}%{' '}
      <span className={claro ? 'text-white/70' : 'text-tenue'}>
        ({sinal}{fmtInt(Math.abs(abs))})
      </span>
    </span>
  );
}

function FiltroBloco({ titulo, children }) {
  return (
    <div className="min-w-0 rounded-[10px] border border-borda bg-superficie/35 px-2.5 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-tenue mb-1">
        {titulo}
      </div>
      {children}
    </div>
  );
}

/**
 * Esteira compacta em lista vertical — cabe em qualquer largura.
 * O layout horizontal antigo estourava com 6–8 etapas.
 */
function Esteira({
  etapas,
  maiorQueda,
  selecionada,
  aoSelecionar,
  comFonte = false,
  interativa = true,
  aoAbrirLista = null,
  aoOcultar = null,
}) {
  const Celula = interativa ? 'button' : 'div';
  const podeAbrir = (e) => aoAbrirLista && e.fonte === 'rubeus' && e.total > 0;

  return (
    <div className="flex flex-col gap-0.5">
      {etapas.map((e, i) => {
        const ativa = interativa && e.etapa === selecionada;
        const vazio = e.total === null || e.total === undefined;
        return (
          <div key={e.etapa}>
            {i > 0 && (
              <div className="flex items-center gap-2 py-0.5 pl-3 text-[10px] text-tenue">
                <span aria-hidden="true" className="text-azul-300">↓</span>
                <span className="font-semibold text-azul-300 tnum">
                  {e.taxa_desde_anterior_pct == null ? '—' : `${fmtDec(e.taxa_desde_anterior_pct)}%`}
                </span>
                <span>conv.</span>
              </div>
            )}
            <div
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-[10px] border
                ${ativa ? 'bg-azul-600 border-azul-500 text-white' : 'bg-elevado border-transparent'}
                ${!ativa && maiorQueda === e.etapa ? 'border-atencao' : ''}`}
            >
              <Celula
                type={interativa ? 'button' : undefined}
                onClick={interativa ? () => aoSelecionar(e.etapa) : undefined}
                aria-pressed={interativa ? ativa : undefined}
                className={`min-w-0 flex-1 flex items-center gap-3 text-left bg-transparent border-0 p-0
                  ${interativa ? 'cursor-pointer focus-visible:outline-2 focus-visible:outline-azul-400' : ''}
                  ${interativa && !ativa ? 'hover:opacity-90' : ''}`}
              >
                <div className="min-w-0 flex-1">
                  <div className={`text-[12px] font-semibold truncate ${ativa ? 'text-white' : 'text-primario'}`}>
                    {e.etapa}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {comFonte && e.fonte && <BadgeFonte fonte={e.fonte} />}
                    <Variacao pct={e.delta_pct} abs={e.delta_abs} claro={ativa} />
                    {maiorQueda === e.etapa && (
                      <span className={`text-[10px] font-semibold ${ativa ? 'text-white/80' : 'text-atencao'}`}>
                        maior queda
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-[18px] font-bold tnum leading-none">
                    {vazio ? '—' : fmtInt(e.total)}
                  </div>
                  {podeAbrir(e) && (
                    <BotaoLista rotulo={e.etapa} claro={ativa} aoAbrir={() => aoAbrirLista(e)} />
                  )}
                </div>
              </Celula>
              {aoOcultar && (
                <button
                  type="button"
                  title={`Ocultar ${e.etapa} da esteira`}
                  aria-label={`Ocultar etapa ${e.etapa}`}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    aoOcultar(e.etapa);
                  }}
                  className={`shrink-0 text-[10px] px-2 py-1 rounded-[6px] border cursor-pointer
                    ${ativa
                      ? 'border-white/30 text-white/80 hover:bg-white/15'
                      : 'border-borda text-tenue hover:bg-superficie-hover hover:text-primario'}`}
                >
                  Ocultar
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Ícone de lista — abre quem está por trás do número. */
function IconeLista() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BotaoLista({ rotulo, aoAbrir, claro = false }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        // A célula do funil também é clicável na aba de processo; sem parar a
        // propagação, abrir a lista trocaria a etapa selecionada junto.
        e.stopPropagation();
        aoAbrir();
      }}
      title={`Ver quem são: ${rotulo}`}
      aria-label={`Ver a lista de ${rotulo}`}
      className={`inline-flex items-center justify-center w-[22px] h-[22px] rounded-[6px]
                  border cursor-pointer transition-colors
                  ${claro
                    ? 'border-white/25 text-white/70 hover:bg-white/15 hover:text-white'
                    : 'border-borda text-tenue hover:bg-superficie-hover hover:text-primario'}`}
    >
      <IconeLista />
    </button>
  );
}

/** Número da tabela com o ícone ao lado. Zero não abre nada — não há o que ver. */
function CelulaComLista({ valor, aoAbrir }) {
  return (
    <span className="inline-flex items-center gap-2">
      {fmtInt(valor)}
      {valor > 0 && <BotaoLista rotulo="esta linha" aoAbrir={aoAbrir} />}
    </span>
  );
}

const POR_PAGINA_LISTA = 50;

/**
 * Gaveta com as pessoas que compõem um número do funil.
 *
 * Serve para conferir, não só para navegar: o total no topo é o mesmo do card
 * que abriu a gaveta, e é assim que se descobre que "39 inscrições" está certo
 * — ou que não está. Por isso o servidor conta com a mesma regra do agregado,
 * em vez de a tela remontar a conta por fora.
 */
function ListaPessoas({ etapa, rotulo, categoriaPessoa, funilNome, rotuloCategoria, qsBase, aoFechar }) {
  const [pagina, setPagina] = useState(1);
  const [leadAberto, setLeadAberto] = useState(null);

  const qs =
    `${qsBase}&etapa=${encodeURIComponent(etapa)}` +
    (categoriaPessoa !== null && categoriaPessoa !== undefined
      ? `&categoria_pessoa=${encodeURIComponent(categoriaPessoa)}`
      : '') +
    (funilNome !== null && funilNome !== undefined
      ? `&funil_nome=${encodeURIComponent(funilNome)}`
      : '') +
    `&pagina=${pagina}&por_pagina=${POR_PAGINA_LISTA}`;

  const { dados, carregando, erro } = useApi(`/api/funil/macro/pessoas?${qs}`, `pessoas-${qs}`);

  useEffect(() => {
    const aoTeclar = (e) => e.key === 'Escape' && aoFechar();
    document.addEventListener('keydown', aoTeclar);
    const antes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      document.body.style.overflow = antes;
    };
  }, [aoFechar]);

  return (
    <>
      <div className="fixed inset-0 z-40 flex">
        <div className="flex-1 bg-black/60" onClick={aoFechar} aria-hidden="true" />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label={`Pessoas em ${rotulo}`}
          className="w-full md:w-[560px] h-full bg-elevado border-l border-borda
                     overflow-y-auto shadow-2xl flex flex-col"
        >
          <div className="sticky top-0 bg-elevado border-b border-borda px-4 py-3
                          flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[15px] font-semibold truncate">{rotulo}</div>
              <div className="text-[11px] text-tenue mt-[2px]">
                {dados ? `${fmtInt(dados.total)} pessoa(s)` : '—'}
                {rotuloCategoria ? ` · ${rotuloCategoria}` : ''}
                {dados?.periodo?.rotulo ? ` · ${dados.periodo.rotulo}` : ''}
              </div>
            </div>
            <button
              type="button"
              onClick={aoFechar}
              aria-label="Fechar"
              className="w-7 h-7 shrink-0 rounded-[8px] border border-borda bg-superficie
                         text-secundario hover:bg-superficie-hover cursor-pointer"
            >
              ✕
            </button>
          </div>

          <div className="p-4 flex flex-col gap-2">
            {erro && <Estado tipo="erro" titulo="Não foi possível carregar a lista" mensagem={erro} />}
            {!erro && (carregando || !dados) && <Esqueleto linhas={6} />}

            {dados?.itens?.length === 0 && (
              <Estado
                titulo="Ninguém neste recorte"
                mensagem="Nenhuma pessoa alcançou esta etapa no período escolhido."
              />
            )}

            {dados?.itens?.map((p) => (
              <button
                key={`${p.contato_id}-${p.registrado_em}`}
                type="button"
                onClick={() => setLeadAberto(p.contato_id)}
                className="text-left bg-superficie border border-borda rounded-[12px] p-3
                           hover:bg-superficie-hover hover:border-borda-forte cursor-pointer
                           focus-visible:outline-2 focus-visible:outline-azul-400"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-7 h-7 rounded-full bg-azul-700 text-white flex items-center
                                   justify-center text-[10px] font-semibold shrink-0">
                    {iniciais(p.contato_nome)}
                  </span>
                  <span className="text-xs font-semibold truncate">
                    {p.contato_nome || `Contato ${p.contato_id}`}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Pill tom="sucesso">{p.etapa}</Pill>
                  {p.curso_nome
                    ? <Pill tom="neutro">{p.curso_nome}</Pill>
                    : <Pill tom="atencao">sem curso identificado</Pill>}
                </div>
                <div className="text-[11px] text-tenue mt-2">{fmtDataHora(p.registrado_em)}</div>
                {p.email && (
                  <div className="text-[11px] text-tenue truncate" title={p.email}>{p.email}</div>
                )}
              </button>
            ))}

            {dados?.paginas > 1 && (
              <div className="flex items-center justify-between gap-3 mt-1 pt-3 border-t border-borda">
                <button
                  type="button"
                  onClick={() => setPagina((p) => Math.max(1, p - 1))}
                  disabled={dados.pagina <= 1}
                  className="text-xs px-3 py-[6px] rounded-[8px] border border-borda-forte bg-superficie
                             text-secundario cursor-pointer hover:bg-superficie-hover hover:text-primario
                             disabled:opacity-35 disabled:cursor-not-allowed"
                >
                  ← Anteriores
                </button>
                <span className="text-[11px] text-tenue tnum">
                  {(dados.pagina - 1) * dados.por_pagina + 1}–
                  {Math.min(dados.pagina * dados.por_pagina, dados.total)} de {dados.total}
                </span>
                <button
                  type="button"
                  onClick={() => setPagina((p) => Math.min(dados.paginas, p + 1))}
                  disabled={dados.pagina >= dados.paginas}
                  className="text-xs px-3 py-[6px] rounded-[8px] border border-borda-forte bg-superficie
                             text-secundario cursor-pointer hover:bg-superficie-hover hover:text-primario
                             disabled:opacity-35 disabled:cursor-not-allowed"
                >
                  Próximos →
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Fica por cima da gaveta (z-50 contra z-40): quem clicou numa pessoa
          quer o detalhe dela sem perder a lista atrás. */}
      {leadAberto && <PainelLead contatoId={leadAberto} aoFechar={() => setLeadAberto(null)} />}
    </>
  );
}

function CurvaDaEtapa({ funilId, etapa, periodoQs, filtrosQs, chave }) {
  const { dados, carregando, erro } = useApi(
    `/api/funil/serie?${periodoQs}` +
      (funilId ? `&funil_id=${encodeURIComponent(funilId)}` : '') +
      (etapa ? `&etapa=${encodeURIComponent(etapa)}` : '') +
      (filtrosQs || ''),
    `serie-${funilId}-${etapa}-${chave}`,
  );

  if (erro) return <Cartao><Estado tipo="erro" titulo="Não foi possível carregar a curva" mensagem={erro} /></Cartao>;
  if (carregando || !dados) return <Esqueleto linhas={6} />;

  const novos = dados.serie.reduce((a, d) => a + d.novos, 0);

  return (
    <GraficoAcumulado
      titulo={`${fmtInt(novos)} ficha(s) com ${etapa} como etapa final no período`}
      subtitulo={`Acumulado no período · ${fmtInt(dados.total_anterior)} no período anterior`}
      dados={dados.serie}
      rotuloAtual="Período atual"
      rotuloAnterior="Período anterior"
    />
  );
}

const POR_PAGINA = 24;

/** Query string compartilhada pelos filtros CRM (macro e detalhe). Aceita listas. */
function qsFiltrosCrm({ categoria, oferta, modalidade, unidade, origem, funilId }) {
  const csv = (v) => {
    if (Array.isArray(v)) return v.filter(Boolean).map(String);
    return v ? [String(v)] : [];
  };
  let s = '';
  const cat = csv(categoria);
  const ofe = csv(oferta);
  const mod = csv(modalidade);
  const uni = csv(unidade);
  const ori = csv(origem);
  const fun = csv(funilId);
  if (cat.length) s += `&categoria=${encodeURIComponent(cat.join(','))}`;
  if (ofe.length) s += `&oferta_codigo=${encodeURIComponent(ofe.join(','))}`;
  if (mod.length) s += `&modalidade=${encodeURIComponent(mod.join(','))}`;
  if (uni.length) s += `&unidade=${encodeURIComponent(uni.join(','))}`;
  if (ori.length) s += `&origem=${encodeURIComponent(ori.join(','))}`;
  if (fun.length) s += `&funil_id=${encodeURIComponent(fun.join(','))}`;
  return s;
}

function LeadsDoFunil({ funilId, aoAbrir }) {
  const [busca, setBusca] = useState('');
  const [aplicada, setAplicada] = useState('');
  const [pagina, setPagina] = useState(1);

  const { dados, carregando } = useApi(
    `/api/funil/leads?pagina=${pagina}&por_pagina=${POR_PAGINA}` +
      (funilId ? `&funil_id=${encodeURIComponent(funilId)}` : '') +
      (aplicada.trim() ? `&busca=${encodeURIComponent(aplicada.trim())}` : ''),
    `leads-${funilId}-${pagina}-${aplicada}`,
  );

  useEffect(() => {
    const t = setTimeout(() => setAplicada(busca), 250);
    return () => clearTimeout(t);
  }, [busca]);

  /*
   * Busca nova e troca de funil voltam para a primeira página.
   * Ficar na página 5 de um resultado que agora tem 2 mostraria tela vazia com
   * leads existindo logo atrás.
   */
  useEffect(() => {
    setPagina(1);
  }, [aplicada, funilId]);

  if (carregando || !dados) return <Esqueleto linhas={4} />;

  const itens = dados.itens;

  if (!dados.total && !dados.busca) {
    return (
      <Estado
        titulo="Nenhum lead neste funil ainda"
        mensagem="Os leads aparecem assim que o Rubeus disparar eventos para o webhook deste funil."
      />
    );
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar lead por nome, id ou curso…"
          aria-label="Buscar lead"
          className="bg-superficie text-primario border border-borda-forte rounded-[8px]
                     px-2 py-[5px] text-xs flex-1 min-w-[200px]"
        />
        <span className="text-[11px] text-tenue tnum">
          {dados.total} lead(s){dados.busca ? ' encontrados' : ''}
          {dados.paginas > 1 && ` · página ${dados.pagina} de ${dados.paginas}`}
        </span>
      </div>

      <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
        {itens.map((l) => (
          <button
            key={l.quem}
            type="button"
            onClick={() => aoAbrir(l.contato_id)}
            className="text-left bg-superficie border border-borda rounded-[12px] p-3
                       hover:bg-superficie-hover hover:border-borda-forte cursor-pointer
                       focus-visible:outline-2 focus-visible:outline-azul-400"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-7 h-7 rounded-full bg-azul-700 text-white flex items-center
                               justify-center text-[10px] font-semibold shrink-0">
                {iniciais(l.contato_nome)}
              </span>
              <span className="text-xs font-semibold truncate">
                {l.contato_nome || `Contato ${l.contato_id}`}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <Pill tom="sucesso">{l.etapa}</Pill>
              {(l.oferta_nome || l.oferta_codigo || l.curso_codigo) && (
                <Pill tom="neutro">{l.oferta_nome || l.oferta_codigo || l.curso_codigo}</Pill>
              )}
              {/* Processo repetido é jornada legítima — a mesma pessoa pode se
                  inscrever em dois cursos. Fica visível em vez de somado. */}
              {l.processos > 1 && <Pill tom="atencao">{l.processos} processos</Pill>}
            </div>
            <div className="text-[11px] text-tenue mt-2">
              {l.eventos} evento(s) · {fmtDataHora(l.registrado_em)}
              {l.ids_no_crm > 1 && (
                <span title="O Rubeus emitiu mais de um id de contato para esta pessoa; o painel juntou pelo e-mail">
                  {' '}· {l.ids_no_crm} cadastros no CRM
                </span>
              )}
            </div>
            {l.email && (
              <div className="text-[11px] text-tenue truncate" title={l.email}>{l.email}</div>
            )}
          </button>
        ))}
      </div>

      {/* Busca sem resultado é diferente de funil vazio — o texto tem de dizer qual é. */}
      {!itens.length && (
        <Estado
          titulo="Nenhum lead com esse termo"
          mensagem="A busca procura em nome, e-mail, código do curso e id, no funil inteiro — não só nesta página."
        />
      )}

      {dados.paginas > 1 && (
        <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-borda">
          <button
            type="button"
            onClick={() => setPagina((p) => Math.max(1, p - 1))}
            disabled={dados.pagina <= 1}
            className="text-xs px-3 py-[6px] rounded-[8px] border border-borda-forte bg-superficie
                       text-secundario cursor-pointer hover:bg-superficie-hover hover:text-primario
                       disabled:opacity-35 disabled:cursor-not-allowed"
          >
            ← Anteriores
          </button>
          <span className="text-[11px] text-tenue tnum">
            {(dados.pagina - 1) * dados.por_pagina + 1}–
            {Math.min(dados.pagina * dados.por_pagina, dados.total)} de {dados.total}
          </span>
          <button
            type="button"
            onClick={() => setPagina((p) => Math.min(dados.paginas, p + 1))}
            disabled={dados.pagina >= dados.paginas}
            className="text-xs px-3 py-[6px] rounded-[8px] border border-borda-forte bg-superficie
                       text-secundario cursor-pointer hover:bg-superficie-hover hover:text-primario
                       disabled:opacity-35 disabled:cursor-not-allowed"
          >
            Próximos →
          </button>
        </div>
      )}
    </>
  );
}

/**
 * Os filtros de recorte do funil — categoria, oferta, modalidade, unidade,
 * origem e processo.
 *
 * Existiam DUAS cópias deste bloco: uma na visão consolidada com seis listas e
 * outra na visão por processo com quatro. Além de divergirem, ficavam dentro do
 * cartão de conteúdo, abaixo do gráfico — enquanto o filtro de período ficava
 * lá em cima, ao lado do título. Quem queria recortar o número procurava em dois
 * lugares e achava conjuntos diferentes conforme a aba.
 *
 * Agora é um componente só, dentro da barra de filtros, ao lado do período.
 */
function FiltrosCrm({ filtrosCrm, aoTrocar, categorias, ofertas, opcoesFiltro }) {
  const funis = opcoesFiltro?.funis ?? [];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2">
      <FiltroBloco titulo="Categoria">
        <MultiSelect
          rotulo="Categoria"
          rotuloVazio="Todas"
          valores={filtrosCrm.categoria}
          aoTrocar={(v) => aoTrocar('categoria', v)}
          opcoes={categorias.map((c) => [c.id, c.rotulo])}
        />
      </FiltroBloco>
      <FiltroBloco titulo="Oferta">
        <MultiSelect
          rotulo="Oferta de curso"
          rotuloVazio="Todas"
          valores={filtrosCrm.oferta}
          aoTrocar={(v) => aoTrocar('oferta', v)}
          opcoes={ofertas
            .filter((o) => o.codigo)
            .slice(0, 400)
            .map((o) => [String(o.codigo), o.nome || o.codigo])}
        />
      </FiltroBloco>
      <FiltroBloco titulo="Modalidade">
        <MultiSelect
          rotulo="Modalidade"
          rotuloVazio="Todas"
          valores={filtrosCrm.modalidade}
          aoTrocar={(v) => aoTrocar('modalidade', v)}
          opcoes={(opcoesFiltro?.modalidades ?? []).map((m) => [m, m])}
        />
      </FiltroBloco>
      <FiltroBloco titulo="Unidade">
        <MultiSelect
          rotulo="Unidade"
          rotuloVazio="Todas"
          valores={filtrosCrm.unidade}
          aoTrocar={(v) => aoTrocar('unidade', v)}
          opcoes={(opcoesFiltro?.unidades ?? []).map((u) => [u, u])}
        />
      </FiltroBloco>
      <FiltroBloco titulo="Origem">
        <MultiSelect
          rotulo="Origem"
          rotuloVazio="Todas"
          valores={filtrosCrm.origem}
          aoTrocar={(v) => aoTrocar('origem', v)}
          opcoes={(opcoesFiltro?.origens ?? []).map((o) => [o, o])}
        />
      </FiltroBloco>
      <FiltroBloco titulo="Processo / funil">
        <MultiSelect
          rotulo="Processo / funil"
          rotuloVazio="Todos"
          valores={filtrosCrm.funilId}
          aoTrocar={(v) => aoTrocar('funilId', v)}
          opcoes={funis.map((f) => [String(f.id), `${f.nome} (${fmtInt(f.leads)})`])}
        />
      </FiltroBloco>
    </div>
  );
}

function MacroView({ filtro, filtrosCrm }) {
  const p = queryPeriodo(filtro);
  const filtrosQs = qsFiltrosCrm(filtrosCrm);
  const qs = `${p}${filtrosQs}&comparar=${filtro.comparar ? '1' : '0'}`;

  // O que a gaveta está mostrando: { etapa, rotulo, categoriaPessoa, rotuloCategoria }.
  const [lista, setLista] = useState(null);

  const { dados, carregando, erro } = useApi(`/api/funil/macro?${qs}`, `macro-${qs}`);
  if (erro) return <Cartao><Estado tipo="erro" titulo="Não foi possível carregar o funil macro" mensagem={erro} /></Cartao>;
  if (carregando || !dados) return <Esqueleto linhas={8} />;

  const naoClassificados = dados.por_categoria_nao_classificados ?? [];
  const temPlanilha = dados.etapas.some((e) => e.fonte === 'planilha' || e.fonte === 'misto');

  return (
    <>
      <Cartao>
        <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
          <div>
            <div className="text-[13px] font-semibold">Funil consolidado</div>
            <div className="text-[11px] text-tenue mt-[2px]">
              Espelha a planilha: RD Marketing no topo, Rubeus da qualificação à matrícula
            </div>
          </div>
        </div>

        {!dados.rd?.ok && (
          <div className="mb-3 text-[11px] text-atencao bg-superficie border border-borda rounded-[8px] px-3 py-2">
            Visitantes/Leads do RD Marketing indisponíveis: {dados.rd?.motivo || 'conecte o OAuth ou verifique o plano Analysis.'}
            {' '}Qualificação em diante segue com dados do Rubeus.
          </div>
        )}

        {dados.rd_alerta_pico && (
          <div className="mb-3 text-[11px] text-atencao bg-superficie border border-atencao/40 rounded-[8px] px-3 py-2">
            Pico artificial de leads no RD Marketing: o número do período está bem acima da média
            histórica da planilha (mais de 2×). O valor continua exibido — confira tags e janela de
            sync antes de usar na tomada de decisão.
          </div>
        )}

        <Esteira
          etapas={dados.etapas}
          maiorQueda={null}
          selecionada={null}
          aoSelecionar={() => {}}
          comFonte
          interativa={false}
          aoAbrirLista={(e) => setLista({ etapa: e.chave, rotulo: e.etapa })}
        />

        <div className="text-[11px] text-tenue mt-3 leading-relaxed">
          Contagem acumulada, como na planilha: quem se matriculou também conta como inscrito,
          oportunidade e qualificado. A taxa entre duas etapas é a segunda dividida pela primeira.
          {temPlanilha && (
            <>
              {' '}Etapas marcadas <strong>Planilha</strong> vêm dos meses fechados informados à mão
              (janeiro a junho de 2026) — são um total por mês, sem pessoa por trás, e por isso não
              abrem lista.
            </>
          )}
        </div>
      </Cartao>

      <Cartao>
        <div className="text-[13px] font-semibold mb-3">Inscrições e matrículas por categoria</div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-tenue border-b border-borda">
                <th className="py-2 pr-3 font-medium">Categoria</th>
                <th className="py-2 pr-3 font-medium tnum">Inscrições</th>
                <th className="py-2 font-medium tnum">Matrículas</th>
              </tr>
            </thead>
            <tbody>
              {dados.por_categoria.map((r) => (
                <tr key={r.categoria} className="border-b border-borda/60">
                  <td className="py-2 pr-3">{r.rotulo}</td>
                  <td className="py-2 pr-3 tnum">
                    <CelulaComLista
                      valor={r.inscricoes}
                      aoAbrir={() => setLista({
                        etapa: 'inscricao',
                        rotulo: 'Inscrições',
                        categoriaPessoa: r.categoria,
                        rotuloCategoria: r.rotulo,
                      })}
                    />
                  </td>
                  <td className="py-2 tnum">
                    <CelulaComLista
                      valor={r.matriculas}
                      aoAbrir={() => setLista({
                        etapa: 'matricula',
                        rotulo: 'Matrículas',
                        categoriaPessoa: r.categoria,
                        rotuloCategoria: r.rotulo,
                      })}
                    />
                  </td>
                </tr>
              ))}
              {/*
                * Sem curso conhecido é linha, não arredondamento.
                *
                * O Rubeus manda inscrição e matrícula sem curso nenhum; o curso
                * só aparece no evento de qualificação, e nem toda pessoa passa
                * por um. Somar essa gente em "Curta duração" ou sumir com ela
                * faria a tabela fechar bonito e mentir — a soma das categorias
                * bateria com o funil sem que ninguém soubesse o que entrou.
                */}
              {naoClassificados.map((r) => (
                <tr key={r.rotulo} className="border-b border-borda/60 text-tenue">
                  <td className="py-2 pr-3 italic">{r.rotulo}</td>
                  <td className="py-2 pr-3 tnum">
                    <CelulaComLista
                      valor={r.inscricoes}
                      aoAbrir={() => setLista({
                        etapa: 'inscricao',
                        rotulo: 'Inscrições',
                        categoriaPessoa: '',
                        funilNome: r.funil ?? '',
                        rotuloCategoria: r.rotulo,
                      })}
                    />
                  </td>
                  <td className="py-2 tnum">
                    <CelulaComLista
                      valor={r.matriculas}
                      aoAbrir={() => setLista({
                        etapa: 'matricula',
                        rotulo: 'Matrículas',
                        categoriaPessoa: '',
                        funilNome: r.funil ?? '',
                        rotuloCategoria: r.rotulo,
                      })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {naoClassificados.length > 0 && (
          <div className="text-[11px] text-tenue mt-2 leading-relaxed">
            O Rubeus não envia o curso nos eventos de inscrição e matrícula. O painel recupera o
            curso pela própria pessoa e, quando nem isso existe, usa o funil de origem — que diz a
            família mas não o curso. As linhas em itálico são o que falta identificar, agrupado por
            funil, em vez de distribuído por chute.
          </div>
        )}
      </Cartao>

      {dados.evolucao?.length > 0 && (
        <Cartao>
          <div className="text-[13px] font-semibold mb-3">Evolução mês a mês (Rubeus)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-tenue border-b border-borda">
                  <th className="py-2 pr-3 font-medium">Mês</th>
                  <th className="py-2 pr-3 font-medium tnum">Qualificados</th>
                  <th className="py-2 pr-3 font-medium tnum">Oportunidades</th>
                  <th className="py-2 pr-3 font-medium tnum">Inscrições</th>
                  <th className="py-2 pr-3 font-medium tnum">Matrículas</th>
                  {/* A conversão de ponta a ponta é a leitura que a planilha
                      cobra do mês: de qualificado a matriculado. */}
                  <th className="py-2 font-medium tnum">Qualif. → Matríc.</th>
                </tr>
              </thead>
              <tbody>
                {dados.evolucao.map((r) => (
                  <tr key={r.mes} className="border-b border-borda/60">
                    <td className="py-2 pr-3">{rotuloMes(r.mes)}</td>
                    <td className="py-2 pr-3 tnum">{fmtInt(r.qualificados)}</td>
                    <td className="py-2 pr-3 tnum">{fmtInt(r.oportunidades)}</td>
                    <td className="py-2 pr-3 tnum">{fmtInt(r.inscricoes)}</td>
                    <td className="py-2 pr-3 tnum">{fmtInt(r.matriculas)}</td>
                    <td className="py-2 tnum text-azul-300 font-semibold">
                      {r.qualificados > 0 ? `${fmtDec((r.matriculas / r.qualificados) * 100)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Cartao>
      )}

      {lista && (
        <ListaPessoas
          etapa={lista.etapa}
          rotulo={lista.rotulo}
          categoriaPessoa={lista.categoriaPessoa ?? null}
          funilNome={lista.funilNome ?? null}
          rotuloCategoria={lista.rotuloCategoria}
          qsBase={`${p}${filtrosQs}`}
          aoFechar={() => setLista(null)}
        />
      )}
    </>
  );
}

function DetalheRubeus({ filtro, filtrosCrm, opcoesFiltro }) {
  const [etapaSel, setEtapaSel] = useState(null);
  const [leadAberto, setLeadAberto] = useState(null);
  const [versao, setVersao] = useState(0);
  const [ocultando, setOcultando] = useState(null);
  const [erroOcultar, setErroOcultar] = useState(null);
  const p = queryPeriodo(filtro);
  const filtrosQs = qsFiltrosCrm(filtrosCrm);
  const chave = `${p}${filtrosQs}-${versao}`;
  const { dados, carregando, erro } = useApi(
    `/api/funil?${p}${filtrosQs}`,
    `detalhe-${chave}`,
  );
  /*
   * `funis_disponiveis` da própria resposta vence a lista do catálogo: ela já
   * vem recortada pelo período e pelos filtros, então lista só o que tem lead
   * na janela. `opcoesFiltro` desce como prop — antes era uma segunda consulta
   * à mesma rota que o pai já faz.
   */
  const { dados: catalogoEtapas } = useApi('/api/catalogo/etapas', 'catalogo-etapas-admin');
  const podeEditar = Boolean(catalogoEtapas?.pode_editar);

  const funis = dados?.funis_disponiveis || opcoesFiltro?.funis || [];
  const funilIds = Array.isArray(filtrosCrm.funilId)
    ? filtrosCrm.funilId.map(String).filter(Boolean)
    : filtrosCrm.funilId
      ? [String(filtrosCrm.funilId)]
      : [];
  const funilAtual = funis.find((f) => funilIds.length === 1 && String(f.id) === funilIds[0]);
  const processoId = dados?.processo_id || funilAtual?.processo_id || null;

  const ocultarEtapa = async (etapaNome) => {
    if (!processoId || !podeEditar || funilIds.length !== 1) return;
    setOcultando(etapaNome);
    setErroOcultar(null);
    try {
      const r = await fetch('/api/catalogo/etapas', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          processo_id: String(processoId),
          etapa_nome: etapaNome,
          visivel: false,
        }),
      });
      if (!r.ok) {
        const c = await r.json().catch(() => ({}));
        throw new Error(c.erro || String(r.status));
      }
      setVersao((v) => v + 1);
    } catch (e) {
      setErroOcultar(e.message || 'Não foi possível ocultar a etapa');
    } finally {
      setOcultando(null);
    }
  };

  if (erro) return <Cartao><Estado tipo="erro" titulo="Não foi possível carregar" mensagem={erro} /></Cartao>;
  if (carregando || !dados) return <Esqueleto />;

  const funilQs = funilIds.join(',');
  if (!funis.length) {
    return (
      <Cartao>
        <Estado
          titulo="Nenhum funil cadastrado"
          mensagem="Cadastre um funil em Funis e webhooks para ver o detalhe por processo."
        />
      </Cartao>
    );
  }

  const comDado = dados.etapas.filter((e) => e.total > 0);
  const etapa = comDado.some((e) => e.etapa === etapaSel) ? etapaSel : comDado[0]?.etapa ?? null;

  return (
    <>
      <Cartao>
        <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
          <div>
            <div className="text-[13px] font-semibold">Etapas do processo (Rubeus)</div>
            <div className="text-[11px] text-tenue mt-[2px]">
              {fmtInt(dados.total_registros ?? 0)} ficha(s) no período · etapa final de cada uma
              {funilIds.length > 1 ? ` · ${funilIds.length} processos` : ''}
            </div>
          </div>
          <a
            href="#/etapas"
            className="text-[11px] text-azul-600 hover:text-azul-700 underline-offset-2 hover:underline"
          >
            Configurar etapas (mapear / ocultar / reordenar)
          </a>
        </div>

        {erroOcultar && (
          <div className="mb-2 text-[11px] text-perigo bg-superficie border border-borda rounded-[8px] px-3 py-2">
            {erroOcultar}
          </div>
        )}

        {dados.etapas?.length ? (
          <>
            <Esteira
              etapas={dados.etapas}
              maiorQueda={dados.etapa_maior_queda}
              selecionada={etapa}
              aoSelecionar={setEtapaSel}
              comFonte
              aoOcultar={podeEditar && processoId && funilIds.length === 1 && !ocultando ? ocultarEtapa : null}
            />
            <div className="text-[11px] text-tenue mt-3 leading-relaxed">
              Só entram fichas com registro de processo no CRM. Use <strong>Ocultar</strong> para
              tirar uma etapa da esteira (ou configure tudo em{' '}
              <a href="#/etapas" className="text-azul-300 hover:underline">Etapas do processo</a>).
              {funilIds.length !== 1 && ' Para ocultar etapa, selecione um único processo.'}
              {ocultando && ` Ocultando “${ocultando}”…`}
            </div>
          </>
        ) : (
          <Estado
            titulo="Nenhum lead neste recorte"
            mensagem="Cole o link deste funil no Rubeus, em Funis e webhooks. As etapas aparecem sozinhas conforme os eventos chegam."
          />
        )}
      </Cartao>

      {etapa && (
        <CurvaDaEtapa
          funilId={funilQs}
          etapa={etapa}
          periodoQs={p}
          filtrosQs={qsFiltrosCrm({ ...filtrosCrm, funilId: [] })}
          chave={chave}
        />
      )}

      <Cartao>
        <div className="text-[13px] font-semibold mb-3">Leads deste funil</div>
        <LeadsDoFunil funilId={funilQs} aoAbrir={setLeadAberto} />
      </Cartao>

      {leadAberto && (
        <PainelLead contatoId={leadAberto} aoFechar={() => setLeadAberto(null)} />
      )}
    </>
  );
}

/**
 * Funil automático no estilo da planilha 2026.
 * Macro (RD + Rubeus) é a view default; detalhe por processo fica secundário.
 */
export function Funil({ filtro, setFiltro }) {
  const [aba, setAba] = useState('macro');
  const [filtrosCrm, setFiltrosCrm] = useState({
    categoria: [],
    oferta: [],
    modalidade: [],
    unidade: [],
    origem: [],
    funilId: [],
  });
  const filtroLocal = filtro ?? filtroPadrao();
  const { de, ate } = resolverPeriodo(filtroLocal);
  const setFiltroLocal = setFiltro ?? (() => {});

  const aoTrocarFiltro = useCallback((campo, valor) => {
    setFiltrosCrm((prev) => ({
      ...prev,
      [campo]: Array.isArray(valor) ? valor : valor ? [valor] : [],
    }));
  }, []);

  /*
   * As opções dos filtros são buscadas AQUI, não em cada aba.
   *
   * Estavam duplicadas: `MacroView` e `DetalheRubeus` pediam as mesmas duas
   * rotas de catálogo, então trocar de aba refazia as duas consultas para
   * montar exatamente as mesmas listas. Subindo para o pai, cada uma é pedida
   * uma vez e as duas abas leem do mesmo lugar — que também é o que garante que
   * as duas ofereçam os mesmos recortes.
   */
  const { dados: catalogo } = useApi('/api/catalogo/cursos', 'catalogo-cursos');
  const { dados: opcoesFiltro } = useApi('/api/catalogo/filtros', 'catalogo-filtros');

  const filtrosAtivos = Object.values(filtrosCrm).reduce((n, v) => n + (v?.length ?? 0), 0);
  const limpar = () =>
    setFiltrosCrm({ categoria: [], oferta: [], modalidade: [], unidade: [], origem: [], funilId: [] });

  return (
    <>
      <div className="min-w-0">
        <div className="text-[19px] font-semibold tracking-tight">Funil de vendas</div>
        <div className="text-tenue text-xs mt-[2px]">
          {rotuloPeriodo(filtroLocal)} · {fmtDiaMes(de)} a {fmtDiaMes(ate)} · RD Marketing + Rubeus
        </div>
      </div>

      <BarraFiltros
        filtro={filtroLocal}
        aoTrocar={setFiltroLocal}
        aoLimpar={limpar}
        filtrosAtivos={filtrosAtivos}
      >
        <FiltrosCrm
          filtrosCrm={filtrosCrm}
          aoTrocar={aoTrocarFiltro}
          categorias={catalogo?.categorias ?? []}
          ofertas={catalogo?.itens ?? []}
          opcoesFiltro={opcoesFiltro}
        />
      </BarraFiltros>

      <div className="flex gap-1 p-[3px] rounded-[10px] bg-elevado border border-borda w-fit">
        {[
          ['macro', 'Visão consolidada'],
          ['detalhe', 'Por processo (Rubeus)'],
        ].map(([id, nome]) => (
          <button
            key={id}
            type="button"
            onClick={() => setAba(id)}
            className={`text-xs px-3 py-[6px] rounded-[8px] border-0 cursor-pointer
              ${aba === id ? 'bg-azul-600 text-white' : 'bg-transparent text-secundario hover:text-primario'}`}
          >
            {nome}
          </button>
        ))}
      </div>

      {aba === 'macro' ? (
        <MacroView
          filtro={filtroLocal}
          filtrosCrm={filtrosCrm}
        />
      ) : (
        <DetalheRubeus
          filtro={filtroLocal}
          filtrosCrm={filtrosCrm}
          opcoesFiltro={opcoesFiltro}
        />
      )}
    </>
  );
}
