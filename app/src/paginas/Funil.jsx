import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Abas,
  Atualizando,
  BarraProporcao,
  Bloco,
  Botao,
  BotaoIcone,
  CabecalhoPagina,
  Cartao,
  Dica,
  EsqueletoPagina,
  Estado,
  Icone,
  InfoDica,
  MultiSelect,
  Select,
  NumeroAnimado,
  Pill,
  Secao,
  TituloSecao,
} from '../componentes/base';
import { BarraFiltros } from '../componentes/BarraFiltros';
import { GraficoAcumulado } from '../componentes/Graficos';
import { PainelLead } from '../componentes/PainelLead';
import { invalidar, useApi } from '../lib/api';
import { MESES, filtroPadrao, queryPeriodo, resolverPeriodo, rotuloPeriodo } from '../lib/periodo';
import { fmtDataHora, fmtDec, fmtDiaMes, fmtInt, iniciais } from '../lib/formato';

const FONTES = {
  rd_marketing: { rotulo: 'RD Marketing', tom: 'neutro', dica: 'Contagem vinda do RD Marketing (topo do funil).' },
  rubeus: { rotulo: 'Rubeus', tom: 'sucesso', dica: 'Contagem medida pelos eventos do Rubeus — abre a lista de pessoas.' },
  planilha: {
    rotulo: 'Planilha',
    tom: 'atencao',
    dica: 'Total mensal informado à mão na planilha — sem pessoa por trás, por isso não abre lista.',
  },
  misto: {
    rotulo: 'Medido + planilha',
    tom: 'atencao',
    dica: 'Parte medida pelo Rubeus, parte vinda dos meses fechados da planilha.',
  },
  indisponivel: { rotulo: 'Indisponível', tom: 'perigo', dica: 'A fonte desta etapa não respondeu para o período.' },
};

/** "2026-06" vira "Junho/2026" — a coluna Mês da planilha, não a chave crua. */
function rotuloMes(chave) {
  const [ano, mes] = String(chave).split('-').map(Number);
  return MESES[mes - 1] ? `${MESES[mes - 1]}/${ano}` : chave;
}

function BadgeFonte({ fonte }) {
  const f = FONTES[fonte] || FONTES.rubeus;
  return (
    <Pill tom={f.tom} dica={f.dica}>
      {f.rotulo}
    </Pill>
  );
}

/**
 * Variação contra o período anterior, em chip.
 *
 * A seta segue o número e a cor segue o sinal; o valor absoluto, que antes
 * ocupava a linha como "(+12)", vai para a dica junto do percentual.
 */
function Variacao({ pct, abs }) {
  if (pct === null || pct === undefined) {
    return (
      <Dica conteudo="Sem base no período anterior para comparar">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-semibold bg-elevado text-tenue">
          —
        </span>
      </Dica>
    );
  }
  const cor = pct === 0 ? 'bg-elevado text-tenue' : pct > 0 ? 'bg-sucesso/12 text-sucesso' : 'bg-perigo/12 text-perigo';
  const sinal = abs > 0 ? '+' : abs < 0 ? '−' : '';
  const icone = pct > 0 ? 'tendencia' : pct < 0 ? 'queda' : null;
  return (
    <Dica
      conteudo={
        <>
          {pct > 0 ? 'Subiu' : pct < 0 ? 'Caiu' : 'Estável'} {fmtDec(Math.abs(pct))}% em relação ao período anterior
          <span className="block text-white/75 tnum">
            {sinal}
            {fmtInt(Math.abs(abs))} pessoa(s) de diferença
          </span>
        </>
      }
    >
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-semibold tnum ${cor}`}>
        {icone ? <Icone nome={icone} className="w-3.5 h-3.5" traco={2.2} /> : '→'}
        {fmtDec(Math.abs(pct))}%
      </span>
    </Dica>
  );
}

function FiltroBloco({ titulo, dica, children }) {
  return (
    <div className="min-w-0 flex flex-col gap-1">
      <div className="text-[12.5px] font-medium text-secundario flex items-center gap-1">
        {titulo}
        <InfoDica texto={dica} tamanho="w-[13px] h-[13px]" />
      </div>
      {children}
    </div>
  );
}

/** Olho riscado — "ocultar". Desenhado aqui: o conjunto de ícones não tem. */
function IconeOcultar({ className = 'w-4 h-4' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.8 3.8" />
      <path d="M6.6 6.6A17.4 17.4 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m3 3 18 18" />
    </svg>
  );
}

/** O conteúdo da dica de cada etapa: o número e tudo que o explica. */
function DicaEtapa({ e, anterior, maiorQueda }) {
  const f = e.fonte ? FONTES[e.fonte] : null;
  return (
    <span className="flex flex-col gap-0.5">
      <span className="font-semibold">{e.etapa}</span>
      <span className="tnum">
        Total: <strong>{e.total === null || e.total === undefined ? '—' : fmtInt(e.total)}</strong>
      </span>
      {anterior && (
        <span className="tnum text-white/85">
          Conversão desde {anterior.etapa}:{' '}
          <strong>{e.taxa_desde_anterior_pct == null ? '—' : `${fmtDec(e.taxa_desde_anterior_pct)}%`}</strong>
        </span>
      )}
      {e.delta_pct !== null && e.delta_pct !== undefined && (
        <span className="tnum text-white/85">
          Contra o período anterior: {e.delta_pct > 0 ? '+' : e.delta_pct < 0 ? '−' : ''}
          {fmtDec(Math.abs(e.delta_pct))}%
        </span>
      )}
      {f && <span className="text-white/75">Fonte: {f.rotulo}</span>}
      {maiorQueda && <span className="text-[#ffc56b] font-semibold">Maior queda do funil</span>}
    </span>
  );
}

/**
 * Esteira compacta em lista vertical — cabe em qualquer largura.
 * O layout horizontal antigo estourava com 6–8 etapas.
 *
 * Cada etapa é um bloco com o número grande e uma barra proporcional à maior
 * etapa; entre dois blocos, o conector mostra a taxa de conversão de uma para
 * a outra. A etapa da maior queda ganha contorno âmbar — é para onde o olho
 * precisa ir primeiro, sem gritar.
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
  kanban = false,
}) {
  const Celula = interativa ? 'button' : 'div';
  const podeAbrir = (e) => aoAbrirLista && e.fonte === 'rubeus' && e.total > 0;
  const maior = Math.max(1, ...etapas.map((e) => Number(e.total) || 0));

  return (
    <ol className="flex flex-col m-0 p-0 list-none cascata">
      {etapas.map((e, i) => {
        const ativa = interativa && e.etapa === selecionada;
        const vazio = e.total === null || e.total === undefined;
        const queda = maiorQueda === e.etapa;
        const anterior = i > 0 ? etapas[i - 1] : null;
        return (
          <li key={e.etapa} className={kanban && anterior ? 'mt-2' : ''}>
            {/* No kanban as colunas não são passos uma da outra: sem "conversão" entre elas. */}
            {anterior && !kanban && (
              <div className="flex items-center gap-2 py-1 pl-[17px]">
                <span aria-hidden="true" className={`w-px h-3 ${queda ? 'bg-atencao/60' : 'bg-borda-forte'}`} />
                <Dica
                  conteudo={
                    e.taxa_desde_anterior_pct == null
                      ? `Sem taxa entre ${anterior.etapa} e ${e.etapa}`
                      : `${fmtDec(e.taxa_desde_anterior_pct)}% de ${anterior.etapa} chegaram a ${e.etapa}`
                  }
                >
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-semibold tnum
                      ${queda ? 'bg-atencao/12 text-atencao' : 'bg-azul-50 text-azul-700'}`}
                  >
                    <Icone nome="chevronBaixo" className="w-3.5 h-3.5" traco={2.2} />
                    {e.taxa_desde_anterior_pct == null ? '—' : `${fmtDec(e.taxa_desde_anterior_pct)}%`}
                    <span className="font-normal opacity-80">conversão</span>
                  </span>
                </Dica>
              </div>
            )}
            <div
              className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-[12px] border transition-[background-color,border-color,box-shadow] duration-200
                ${ativa
                  ? 'bg-azul-50 border-azul-400/60 shadow-[0_0_0_3px_rgba(79,143,232,0.14)]'
                  : queda
                    ? 'bg-atencao/5 border-atencao/50 shadow-[0_0_0_3px_rgba(196,125,10,0.08)]'
                    : 'bg-superficie border-borda'}
                ${interativa && !ativa ? 'hover:border-azul-400/40 hover:bg-superficie-hover' : ''}`}
            >
              <Celula
                type={interativa ? 'button' : undefined}
                onClick={interativa ? () => aoSelecionar(e.etapa) : undefined}
                aria-pressed={interativa ? ativa : undefined}
                className={`min-w-0 flex-1 flex items-center gap-3 text-left bg-transparent border-0 p-0 text-primario
                  ${interativa ? 'cursor-pointer focus-visible:outline-2 focus-visible:outline-azul-400 rounded-[8px]' : ''}`}
              >
                <span
                  aria-hidden="true"
                  className={`w-[26px] h-[26px] rounded-[8px] shrink-0 flex items-center justify-center text-[12.5px] font-bold tnum
                    ${ativa ? 'bg-azul-600 text-white' : queda ? 'bg-atencao/15 text-atencao' : 'bg-azul-50 text-azul-700'}`}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1 flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <Dica conteudo={e.etapa} className="min-w-0">
                      <span className="text-[13.5px] font-semibold truncate">{e.etapa}</span>
                    </Dica>
                    {queda && (
                      <span className="shrink-0 inline-flex items-center gap-1 text-[12px] font-semibold text-atencao">
                        <Icone nome="alerta" className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">maior queda</span>
                      </span>
                    )}
                  </div>
                  <BarraProporcao
                    pct={vazio ? 0 : (Number(e.total) / maior) * 100}
                    tom={queda ? 'atencao' : 'azul'}
                    altura="h-2.5"
                    dica={<DicaEtapa e={e} anterior={anterior} maiorQueda={queda} />}
                  />
                  <div className="flex flex-wrap items-center gap-1.5">
                    {comFonte && e.fonte && <BadgeFonte fonte={e.fonte} />}
                    {kanban && e.participacao_pct != null && (
                      <Pill tom="neutro" dica="Fatia desta etapa no total de fichas do período">
                        {fmtDec(e.participacao_pct)}% do total
                      </Pill>
                    )}
                    <Variacao pct={e.delta_pct} abs={e.delta_abs} />
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 self-center">
                  <span className="text-[24px] font-bold tracking-tight leading-none min-w-[3ch] text-right">
                    {vazio ? '—' : <NumeroAnimado valor={e.total} fmt={fmtInt} />}
                  </span>
                  {podeAbrir(e) && <BotaoLista rotulo={e.etapa} aoAbrir={() => aoAbrirLista(e)} />}
                </div>
              </Celula>
              {aoOcultar && (
                <Dica conteudo={`Ocultar ${e.etapa} da esteira`}>
                  <button
                    type="button"
                    aria-label={`Ocultar etapa ${e.etapa}`}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      aoOcultar(e.etapa);
                    }}
                    className="shrink-0 w-8 h-8 flex items-center justify-center rounded-[9px] border border-borda
                               bg-superficie text-tenue cursor-pointer transition-colors
                               hover:bg-superficie-hover hover:text-primario hover:border-borda-forte"
                  >
                    <IconeOcultar />
                  </button>
                </Dica>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Esqueleto no desenho da esteira — blocos empilhados com conectores. */
function EsqueletoEsteira({ etapas = 6 }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {Array.from({ length: etapas }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-3 rounded-[12px] border border-borda">
          <Bloco className="h-[26px] w-[26px] !rounded-[8px]" />
          <div className="flex-1 flex flex-col gap-2">
            <Bloco className="h-3.5 w-32" />
            <Bloco className="h-2.5 !rounded-full" style={{ width: `${95 - i * 12}%` }} />
          </div>
          <Bloco className="h-6 w-14" />
        </div>
      ))}
    </div>
  );
}

function BotaoLista({ rotulo, aoAbrir }) {
  return (
    <Dica conteudo={`Ver quem são: ${rotulo}`}>
      <button
        type="button"
        onClick={(e) => {
          // A célula do funil também é clicável na aba de processo; sem parar a
          // propagação, abrir a lista trocaria a etapa selecionada junto.
          e.stopPropagation();
          aoAbrir();
        }}
        aria-label={`Ver a lista de ${rotulo}`}
        className="inline-flex items-center justify-center w-7 h-7 rounded-[8px] border border-borda bg-superficie
                   text-tenue cursor-pointer transition-colors
                   hover:bg-azul-50 hover:text-azul-600 hover:border-azul-400/40"
      >
        <Icone nome="lista" className="w-[15px] h-[15px]" />
      </button>
    </Dica>
  );
}

/** Número da tabela com o ícone ao lado. Zero não abre nada — não há o que ver. */
function CelulaComLista({ valor, aoAbrir }) {
  return (
    <span className="inline-flex items-center justify-end gap-2">
      {fmtInt(valor)}
      {valor > 0 ? <BotaoLista rotulo="esta linha" aoAbrir={aoAbrir} /> : <span className="w-7" aria-hidden="true" />}
    </span>
  );
}

/** Avatar de iniciais — lead não tem foto (LGPD), e as iniciais bastam para achar alguém na lista. */
function Avatar({ nome }) {
  return (
    <span
      aria-hidden="true"
      className="w-8 h-8 rounded-full bg-gradient-to-br from-azul-600 to-azul-400 text-white flex items-center
                 justify-center text-[12px] font-semibold shrink-0"
    >
      {iniciais(nome)}
    </span>
  );
}

/** Paginação das listas de pessoas — a mesma nas duas, para ler do mesmo jeito. */
function Paginacao({ dados, aoTrocar }) {
  if (!(dados?.paginas > 1)) return null;
  return (
    <div className="flex items-center justify-between gap-3 mt-1 pt-3 border-t border-borda">
      <Botao
        tamanho="sm"
        icone="chevronEsquerda"
        onClick={() => aoTrocar((p) => Math.max(1, p - 1))}
        disabled={dados.pagina <= 1}
      >
        Anteriores
      </Botao>
      <span className="text-[12.5px] text-secundario tnum">
        {(dados.pagina - 1) * dados.por_pagina + 1}–{Math.min(dados.pagina * dados.por_pagina, dados.total)} de{' '}
        {fmtInt(dados.total)}
      </span>
      <Botao
        tamanho="sm"
        onClick={() => aoTrocar((p) => Math.min(dados.paginas, p + 1))}
        disabled={dados.pagina >= dados.paginas}
      >
        Próximos
        <Icone nome="chevronDireita" className="w-4 h-4" />
      </Botao>
    </div>
  );
}

/** Esqueleto dos cartões de pessoa — mesma grade do que vem depois. */
function EsqueletoPessoas({ n = 6, grade = true }) {
  return (
    <div
      aria-busy="true"
      aria-label="Carregando"
      className={grade ? 'grid gap-2 grid-cols-[repeat(auto-fill,minmax(260px,1fr))]' : 'flex flex-col gap-2'}
    >
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="rounded-[12px] border border-borda p-3 flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <Bloco className="h-8 w-8 !rounded-full" />
            <Bloco className="h-4 w-36" />
          </div>
          <div className="flex gap-1.5">
            <Bloco className="h-5 w-20 !rounded-full" />
            <Bloco className="h-5 w-28 !rounded-full" />
          </div>
          <Bloco className="h-3.5 w-40" />
        </div>
      ))}
    </div>
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

  // `manter`: dentro da gaveta a chave só troca de página — a etapa é fixa
  // enquanto ela está aberta, então a página anterior pode esperar esmaecida.
  const { dados, atualizando, erro } = useApi(`/api/funil/macro/pessoas?${qs}`, `pessoas-${qs}`, { manter: true });

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
        <div
          className="flex-1 bg-azul-900/35 backdrop-blur-[2px] animate-aparecer"
          onClick={aoFechar}
          aria-hidden="true"
        />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label={`Pessoas em ${rotulo}`}
          className="w-full md:w-[560px] h-full bg-base border-l border-borda
                     overflow-y-auto shadow-[var(--shadow-flutuante)] flex flex-col animate-surgir"
        >
          <div
            className="sticky top-0 z-[2] bg-base/95 backdrop-blur border-b border-borda px-5 py-4
                       flex items-start justify-between gap-3"
          >
            <div className="min-w-0 flex items-center gap-3">
              <span
                aria-hidden="true"
                className="w-9 h-9 rounded-[10px] bg-azul-50 text-azul-600 flex items-center justify-center shrink-0"
              >
                <Icone nome="pessoas" className="w-[18px] h-[18px]" />
              </span>
              <div className="min-w-0">
                <div className="text-[16px] font-semibold truncate">{rotulo}</div>
                <div className="text-[13px] text-secundario mt-0.5 flex flex-wrap items-center gap-x-1.5 tnum">
                  <strong className="text-primario font-semibold">{dados ? fmtInt(dados.total) : '—'}</strong>
                  pessoa(s)
                  {rotuloCategoria ? <span>· {rotuloCategoria}</span> : null}
                  {dados?.periodo?.rotulo ? <span>· {dados.periodo.rotulo}</span> : null}
                </div>
              </div>
            </div>
            <BotaoIcone aoClicar={aoFechar} titulo="Fechar" icone="x" />
          </div>

          <div className="p-5 flex flex-col gap-2">
            {erro && <Estado tipo="erro" titulo="Não foi possível carregar a lista" mensagem={erro} />}
            {!erro && !dados && <EsqueletoPessoas n={6} grade={false} />}

            {dados?.itens?.length === 0 && (
              <Estado
                titulo="Ninguém neste recorte"
                mensagem="Nenhuma pessoa alcançou esta etapa no período escolhido."
              />
            )}

            <Atualizando ativo={atualizando} className="flex flex-col gap-2">
              {dados?.itens?.map((p) => (
                <button
                  key={`${p.contato_id}-${p.registrado_em}`}
                  type="button"
                  onClick={() => setLeadAberto(p.contato_id)}
                  className="text-left bg-superficie border border-borda rounded-[12px] p-3
                             transition-colors hover:bg-superficie-hover hover:border-azul-400/40 cursor-pointer
                             focus-visible:outline-2 focus-visible:outline-azul-400"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar nome={p.contato_nome} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-semibold truncate">
                        {p.contato_nome || `Contato ${p.contato_id}`}
                      </div>
                      {p.email && (
                        <Dica conteudo={p.email} className="w-full">
                          <span className="block text-[12.5px] text-secundario truncate">{p.email}</span>
                        </Dica>
                      )}
                    </div>
                    <span className="shrink-0 text-[12px] text-tenue tnum inline-flex items-center gap-1">
                      <Icone nome="relogio" className="w-3.5 h-3.5" />
                      {fmtDataHora(p.registrado_em)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Pill tom="sucesso">{p.etapa}</Pill>
                    {p.curso_nome
                      ? <Pill tom="neutro">{p.curso_nome}</Pill>
                      : <Pill tom="atencao">sem curso identificado</Pill>}
                  </div>
                </button>
              ))}
            </Atualizando>

            <Paginacao dados={dados} aoTrocar={setPagina} />
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
  // Sem `manter`: trocar a etapa troca o assunto da curva, e mostrar a curva
  // da etapa anterior com o título da nova seria mentir por meio segundo.
  const { dados, carregando, erro } = useApi(
    `/api/funil/serie?${periodoQs}` +
      (funilId ? `&funil_id=${encodeURIComponent(funilId)}` : '') +
      (etapa ? `&etapa=${encodeURIComponent(etapa)}` : '') +
      (filtrosQs || ''),
    `serie-${funilId}-${etapa}-${chave}`,
  );

  if (erro) return <Cartao><Estado tipo="erro" titulo="Não foi possível carregar a curva" mensagem={erro} /></Cartao>;
  if (carregando || !dados) return <EsqueletoPagina kpis={0} graficos={1} />;

  const novos = dados.serie.reduce((a, d) => a + d.novos, 0);

  return (
    <GraficoAcumulado
      titulo={`${fmtInt(novos)} ficha(s) com ${etapa} como etapa final`}
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

/** Dia local em YYYY-MM-DD, `n` dias atrás. */
const diaAtras = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function LeadsDoFunil({ funilId, aoAbrir, filtroPagina }) {
  const [busca, setBusca] = useState('');
  const [aplicada, setAplicada] = useState('');
  const [etapas, setEtapas] = useState([]);

  /*
   * Período da lista. Começa no mesmo período do topo da página, para a lista
   * conferir com a esteira logo acima (os mesmos 69 "sem etapa", por exemplo).
   * Quem quer a base inteira escolhe "Todo o histórico".
   */
  const [modoPeriodo, setModoPeriodo] = useState('pagina');
  const [deLivre, setDeLivre] = useState('');
  const [ateLivre, setAteLivre] = useState('');
  const pag = filtroPagina ? resolverPeriodo(filtroPagina) : null;
  const periodo = (() => {
    if (modoPeriodo === 'pagina' && pag) return { de: pag.de, ate: pag.ate };
    if (['7', '30', '90'].includes(modoPeriodo)) return { de: diaAtras(Number(modoPeriodo) - 1), ate: diaAtras(0) };
    if (modoPeriodo === 'livre' && deLivre && ateLivre && deLivre <= ateLivre) return { de: deLivre, ate: ateLivre };
    return { de: null, ate: null };
  })();
  const chavePeriodo = `${periodo.de ?? ''}_${periodo.ate ?? ''}`;
  const [pagina, setPagina] = useState(1);
  const chaveEtapas = etapas.join('|');

  /*
   * `manter`: página e busca trocam a chave mas não o formato da resposta.
   * Sem ele, cada letra digitada virava esqueleto — e o campo de busca, que
   * mora dentro deste bloco, sumia e perdia o foco no meio da digitação.
   */
  /*
   * Um processo só: a lista vem do kanban — as MESMAS fichas que "Etapas no
   * Rubeus" conta logo acima. Antes ela agrupava por pessoa e pelo funil
   * gravado no evento, e as duas divergiam (Aptos para a matrícula: 3 em cima,
   * 4 embaixo, com pessoas diferentes). Vários processos ou nenhum: a lista
   * por pessoa de antes, que não tem equivalente no kanban.
   */
  const porFicha = Boolean(funilId) && !String(funilId).includes(',');
  const qsComum =
    `pagina=${pagina}&por_pagina=${POR_PAGINA}` +
    (funilId ? `&funil_id=${encodeURIComponent(funilId)}` : '') +
    (aplicada.trim() ? `&busca=${encodeURIComponent(aplicada.trim())}` : '') +
    (etapas.length ? `&etapa=${etapas.map(encodeURIComponent).join(',')}` : '');
  const { dados: bruto, atualizando } = useApi(
    porFicha
      ? `/api/funil/kanban?${qsComum}&listar=1` +
          // "Todo o histórico" no kanban é um intervalo longo — a rota exige período.
          `&de=${periodo.de ?? '2000-01-01'}&ate=${periodo.ate ?? diaAtras(0)}`
      : `/api/funil/leads?${qsComum}` + (periodo.de ? `&de=${periodo.de}&ate=${periodo.ate}` : ''),
    `leads-${porFicha}-${funilId}-${pagina}-${aplicada}-${chaveEtapas}-${chavePeriodo}`,
    { manter: true },
  );
  // A resposta do kanban no formato dos cards de sempre: uma ficha por card.
  const dados = bruto && porFicha && bruto.fichas
    ? {
        total: bruto.fichas_total,
        pagina: bruto.pagina,
        paginas: bruto.paginas,
        busca: bruto.busca,
        por_etapa: (bruto.etapas ?? []).map((e) => ({ etapa: e.etapa, pessoas: e.total })),
        itens: bruto.fichas.map((f) => ({
          quem: f.registro,
          contato_id: f.contato_id,
          contato_nome: f.contato_nome,
          email: f.email,
          etapa: f.etapa,
          oferta_nome: f.oferta_nome,
          eventos: f.eventos,
          registrado_em: f.na_etapa_desde,
          processos: 1,
          ids_no_crm: 1,
        })),
      }
    : bruto;

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
  }, [aplicada, funilId, chaveEtapas, chavePeriodo]);

  // Etapa escolhida em outro funil não existe neste — começa sem filtro.
  useEffect(() => {
    setEtapas([]);
  }, [funilId]);

  if (!dados) return <EsqueletoPessoas n={6} />;

  const itens = dados.itens;

  const filtrando = Boolean(dados.busca) || etapas.length > 0 || Boolean(periodo.de);
  const opcoesEtapa = (dados.por_etapa ?? []).map((e) => [
    e.etapa,
    e.etapa || '(sem etapa)',
    { detalhe: `${fmtInt(e.pessoas)} ${porFicha ? 'ficha' : 'pessoa'}${e.pessoas === 1 ? '' : 's'} nesta etapa agora` },
  ]);

  if (!dados.total && !filtrando) {
    return (
      <Estado
        icone="pessoas"
        titulo="Nenhum lead neste funil ainda"
        mensagem="Os leads aparecem assim que o Rubeus disparar eventos para o webhook deste funil."
      />
    );
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <label className="relative flex-1 min-w-[200px] max-w-[420px]">
          <Icone
            nome="busca"
            className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-tenue pointer-events-none"
          />
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, e-mail, id ou curso…"
            aria-label="Buscar lead"
            className="w-full bg-superficie text-primario border border-borda-forte rounded-[10px]
                       pl-8 pr-3 py-[7px] text-[13px] transition-colors
                       hover:border-azul-400/50 focus:border-azul-400"
          />
        </label>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          <Select
            rotulo="Período de chegada"
            valor={modoPeriodo}
            aoTrocar={setModoPeriodo}
            className="w-full sm:w-auto"
            opcoes={[
              ...(pag ? [['pagina', `Período da página (${fmtDiaMes(pag.de)} a ${fmtDiaMes(pag.ate)})`]] : []),
              ['tudo', 'Todo o histórico'],
              ['7', 'Últimos 7 dias'],
              ['30', 'Últimos 30 dias'],
              ['90', 'Últimos 90 dias'],
              ['livre', 'Escolher datas…'],
            ]}
          />
          {modoPeriodo === 'livre' && (
            <span className="inline-flex items-center gap-1.5 animate-surgir">
              <input
                type="date"
                aria-label="Chegada a partir de"
                value={deLivre}
                max={ateLivre || undefined}
                onChange={(e) => setDeLivre(e.target.value)}
                className="bg-superficie text-primario border border-borda-forte rounded-[9px] px-2 py-[5px] text-[13px]"
              />
              <span className="text-secundario text-[13px]">até</span>
              <input
                type="date"
                aria-label="Chegada até"
                value={ateLivre}
                min={deLivre || undefined}
                onChange={(e) => setAteLivre(e.target.value)}
                className="bg-superficie text-primario border border-borda-forte rounded-[9px] px-2 py-[5px] text-[13px]"
              />
            </span>
          )}
          <InfoDica texto="Filtra pela data em que a pessoa chegou a este funil (o primeiro evento dela aqui) — o mesmo que o 'Período de criação do registro' do Rubeus. A etapa mostrada é sempre a atual." />
        </div>
        <div className="w-full sm:w-[240px]">
          <MultiSelect
            rotulo="Etapa atual"
            rotuloVazio="Todas as etapas"
            valores={etapas}
            aoTrocar={setEtapas}
            opcoes={opcoesEtapa}
            placeholderBusca="Buscar etapa…"
          />
        </div>
        <span className="text-[13px] text-secundario tnum flex items-center gap-1">
          <strong className="text-primario font-semibold">{fmtInt(dados.total)}</strong> lead(s)
          {filtrando ? ' encontrados' : ''}
          <InfoDica
            texto={
              porFicha
                ? 'Cada card é uma ficha do Rubeus, como no kanban: fichas criadas no período, na etapa em que estão agora — as mesmas que "Etapas no Rubeus" conta acima.'
                : 'O filtro de etapa usa a etapa atual da pessoa — a do evento mais recente, a mesma que aparece no card.'
            }
          />
          {dados.paginas > 1 && ` · página ${dados.pagina} de ${dados.paginas}`}
        </span>
      </div>

      <Atualizando ativo={atualizando}>
        <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(260px,1fr))] cascata">
          {itens.map((l) => (
            <button
              key={l.quem}
              type="button"
              onClick={() => aoAbrir({ id: l.contato_id, funilId })}
              className="text-left bg-superficie border border-borda rounded-[12px] p-3 min-w-0
                         transition-colors hover:bg-superficie-hover hover:border-azul-400/40 cursor-pointer
                         focus-visible:outline-2 focus-visible:outline-azul-400"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Avatar nome={l.contato_nome} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold truncate">
                    {l.contato_nome || `Contato ${l.contato_id}`}
                  </div>
                  {l.email && (
                    <Dica conteudo={l.email} className="w-full">
                      <span className="block text-[12.5px] text-secundario truncate">{l.email}</span>
                    </Dica>
                  )}
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <Pill tom="sucesso" ponto>{l.etapa}</Pill>
                {(l.oferta_nome || l.oferta_codigo || l.curso_codigo) && (
                  <Pill tom="neutro">{l.oferta_nome || l.oferta_codigo || l.curso_codigo}</Pill>
                )}
                {/* Processo repetido é jornada legítima — a mesma pessoa pode se
                    inscrever em dois cursos. Fica visível em vez de somado. */}
                {l.processos > 1 && (
                  <Pill tom="atencao" dica="A mesma pessoa tem mais de um processo — por exemplo, inscrita em dois cursos.">
                    {l.processos} processos
                  </Pill>
                )}
              </div>
              <div className="text-[12px] text-tenue mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 tnum">
                <span className="inline-flex items-center gap-1">
                  <Icone nome="raio" className="w-3.5 h-3.5" />
                  {l.eventos} evento(s)
                </span>
                <span className="inline-flex items-center gap-1">
                  <Icone nome="relogio" className="w-3.5 h-3.5" />
                  {fmtDataHora(l.registrado_em)}
                </span>
                {l.ids_no_crm > 1 && (
                  <Dica conteudo="O Rubeus emitiu mais de um id de contato para esta pessoa; o painel juntou pelo e-mail">
                    <span className="inline-flex items-center gap-1 text-atencao">
                      <Icone nome="copiar" className="w-3.5 h-3.5" />
                      {l.ids_no_crm} cadastros no CRM
                    </span>
                  </Dica>
                )}
              </div>
            </button>
          ))}
        </div>
      </Atualizando>

      {/* Busca sem resultado é diferente de funil vazio — o texto tem de dizer qual é. */}
      {!itens.length && (
        <Estado
          icone="busca"
          titulo={etapas.length && !dados.busca ? 'Nenhum lead nesta etapa' : 'Nenhum lead com esse filtro'}
          mensagem="A busca procura em nome, e-mail, código do curso e id, no funil inteiro — não só nesta página."
          acao={
            etapas.length > 0 && (
              <Botao tamanho="sm" variante="secundario" icone="x" onClick={() => setEtapas([])}>
                Limpar filtro de etapa
              </Botao>
            )
          }
        />
      )}

      <div className="mt-2">
        <Paginacao dados={dados} aoTrocar={setPagina} />
      </div>
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
  const rotuloCategoria = Object.fromEntries(categorias.map((c) => [c.id, c.rotulo]));

  /*
   * Oferta é a lista longa — centenas de turmas com nome quase igual
   * ("2023.2 | Graduação Psicologia", "2024.1 | Graduação Psicologia"). O que
   * a torna usável:
   *   - agrupada pela categoria; sem categoria cadastrada, pelo nível de ensino
   *     que o Rubeus manda — boa parte das ofertas ainda não tem categoria, e
   *     um grupo único "Sem categoria" com tudo dentro não separa nada;
   *   - semestre mais recente primeiro dentro do grupo: é a turma que se procura;
   *   - modalidade e código como linha de detalhe, e ambos entram na busca;
   *   - com Categoria escolhida, só as ofertas dela. Se nenhuma oferta casar
   *     (categoria ainda não atribuída), a lista não some — mostra todas.
   *     Oferta já marcada fica sempre, para poder desmarcar.
   */
  const catSel = new Set(filtrosCrm.categoria ?? []);
  const ofertaSel = new Set((filtrosCrm.oferta ?? []).map(String));
  const comCodigo = ofertas.filter((o) => o.codigo);
  const daCategoria = catSel.size ? comCodigo.filter((o) => catSel.has(o.categoria)) : [];
  const recortouPorCategoria = daCategoria.length > 0;
  const grupoDe = (o) => rotuloCategoria[o.categoria] || o.nivel_ensino || 'Outras';
  const opcoesOferta = comCodigo
    .filter((o) => !recortouPorCategoria || catSel.has(o.categoria) || ofertaSel.has(String(o.codigo)))
    .sort(
      (x, y) =>
        grupoDe(x).localeCompare(grupoDe(y), 'pt-BR') ||
        String(y.nome || '').localeCompare(String(x.nome || ''), 'pt-BR'),
    )
    .map((o) => [
      String(o.codigo),
      o.nome || o.codigo,
      {
        grupo: grupoDe(o),
        detalhe: [o.modalidade, `cód. ${o.codigo}`].filter(Boolean).join(' · '),
        busca: `${o.curso_codigo ?? ''} ${o.nivel_ensino ?? ''}`,
      },
    ]);

  const opcoesProcesso = funis.map((f) => [
    String(f.id),
    f.nome,
    { detalhe: `${fmtInt(f.leads)} leads no período`, busca: f.processo_id },
  ]);

  const campos = [
    { campo: 'categoria', titulo: 'Categoria', vazio: 'Todas', opcoes: categorias.map((c) => [c.id, c.rotulo]) },
    {
      campo: 'oferta',
      titulo: 'Oferta',
      rotulo: 'Oferta de curso',
      vazio: recortouPorCategoria ? 'Todas da categoria' : 'Todas',
      opcoes: opcoesOferta,
      busca: 'Curso, semestre, código…',
      dica: 'Com uma categoria escolhida, a lista mostra só as ofertas dela. Digite parte do nome, o semestre (2024.1) ou o código.',
    },
    { campo: 'modalidade', titulo: 'Modalidade', vazio: 'Todas', opcoes: (opcoesFiltro?.modalidades ?? []).map((m) => [m, m]) },
    { campo: 'unidade', titulo: 'Unidade', vazio: 'Todas', opcoes: (opcoesFiltro?.unidades ?? []).map((u) => [u, u]) },
    { campo: 'origem', titulo: 'Origem', vazio: 'Todas', opcoes: (opcoesFiltro?.origens ?? []).map((o) => [o, o]) },
    { campo: 'funilId', titulo: 'Processo / funil', vazio: 'Todos', opcoes: opcoesProcesso, busca: 'Nome do processo…' },
  ];

  // Cada valor marcado vira um chip removível — o recorte inteiro legível numa linha.
  const chips = campos.flatMap(({ campo, titulo, opcoes }) => {
    const nomes = new Map(opcoes.map(([v, r]) => [String(v), r]));
    return (filtrosCrm[campo] ?? []).map((v) => ({ campo, titulo, v: String(v), nome: nomes.get(String(v)) ?? v }));
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {campos.map((c) => (
          <FiltroBloco key={c.campo} titulo={c.titulo} dica={c.dica}>
            <MultiSelect
              rotulo={c.rotulo || c.titulo}
              rotuloVazio={c.vazio}
              valores={filtrosCrm[c.campo]}
              aoTrocar={(v) => aoTrocar(c.campo, v)}
              opcoes={c.opcoes}
              placeholderBusca={c.busca}
            />
          </FiltroBloco>
        ))}
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 animate-surgir">
          <span className="text-[12.5px] text-secundario mr-1">Filtrando por</span>
          {chips.map((c) => (
            <span
              key={`${c.campo}-${c.v}`}
              className="inline-flex items-center gap-1 max-w-full pl-2.5 pr-1 py-[3px] rounded-full bg-azul-50 border border-azul-400/30 text-[12.5px] text-azul-700 animate-escala"
            >
              <span className="text-azul-700/70">{c.titulo}:</span>
              <Dica conteudo={c.nome} className="min-w-0">
                <span className="truncate max-w-[220px] font-medium">{c.nome}</span>
              </Dica>
              <button
                type="button"
                aria-label={`Remover ${c.titulo}: ${c.nome}`}
                onClick={() => aoTrocar(c.campo, (filtrosCrm[c.campo] ?? []).filter((x) => String(x) !== c.v))}
                className="w-5 h-5 shrink-0 rounded-full border-0 bg-transparent text-azul-700/70 hover:bg-azul-400/20 hover:text-azul-700 flex items-center justify-center cursor-pointer"
              >
                <Icone nome="x" className="w-3 h-3" traco={2.4} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Aviso que exige leitura — fica na tela, curto; o detalhe vai na dica. */
function Aviso({ tom = 'atencao', children, dica }) {
  const cores = {
    atencao: 'bg-atencao/8 border-atencao/35 text-[#8a5806]',
    perigo: 'bg-perigo/8 border-perigo/35 text-perigo',
  };
  return (
    <div
      role={tom === 'perigo' ? 'alert' : undefined}
      className={`flex items-start gap-2 text-[13px] leading-snug border rounded-[10px] px-3 py-2 animate-surgir ${cores[tom]}`}
    >
      <Icone nome="alerta" className="w-4 h-4 shrink-0 mt-[1px]" />
      <span className="min-w-0 flex-1">{children}</span>
      {dica && <InfoDica texto={dica} largura={340} className="mt-[1px]" />}
    </div>
  );
}

function MacroView({ filtro, filtrosCrm }) {
  const p = queryPeriodo(filtro);
  const filtrosQs = qsFiltrosCrm(filtrosCrm);
  const qs = `${p}${filtrosQs}&comparar=${filtro.comparar ? '1' : '0'}`;

  // O que a gaveta está mostrando: { etapa, rotulo, categoriaPessoa, rotuloCategoria }.
  const [lista, setLista] = useState(null);

  // `manter`: filtro e período não mudam o formato — o funil antigo fica
  // esmaecido até o novo chegar, em vez de a tela virar esqueleto.
  const { dados, atualizando, erro } = useApi(`/api/funil/macro?${qs}`, `macro-${qs}`, { manter: true });
  if (erro && !dados) return <Cartao><Estado tipo="erro" titulo="Não foi possível carregar o funil macro" mensagem={erro} /></Cartao>;
  if (!dados) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Carregando">
        <Cartao>
          <Bloco className="h-4 w-44 mb-4" />
          <EsqueletoEsteira etapas={7} />
        </Cartao>
        <EsqueletoPagina kpis={0} graficos={0} tabela />
      </div>
    );
  }

  const naoClassificados = dados.por_categoria_nao_classificados ?? [];
  const temPlanilha = dados.etapas.some((e) => e.fonte === 'planilha' || e.fonte === 'misto');

  const dicaFunil =
    'Espelha a planilha: RD Marketing no topo, Rubeus da qualificação à matrícula. ' +
    'Contagem acumulada, como na planilha: quem se matriculou também conta como inscrito, ' +
    'oportunidade e qualificado. A taxa entre duas etapas é a segunda dividida pela primeira.' +
    (temPlanilha
      ? ' Etapas marcadas Planilha vêm dos meses fechados informados à mão (janeiro a junho de 2026) — ' +
        'são um total por mês, sem pessoa por trás, e por isso não abrem lista.'
      : '');

  const dicaCategorias =
    'Clique no ícone de lista ao lado de um número para ver quem está por trás dele.' +
    (naoClassificados.length
      ? ' O Rubeus não envia o curso nos eventos de inscrição e matrícula. O painel recupera o ' +
        'curso pela própria pessoa e, quando nem isso existe, usa o funil de origem — que diz a ' +
        'família mas não o curso. As linhas em itálico são o que falta identificar, agrupado por ' +
        'funil, em vez de distribuído por chute.'
      : '');

  // As gavetas ficam fora do véu de "atualizando": esmaecer o conteúdo não
  // pode esmaecer (nem travar o clique de) uma sobreposição aberta por cima.
  return (
    <>
    <Atualizando ativo={atualizando} className="flex flex-col gap-4">
      <Secao titulo="Funil consolidado" icone="funil" dica={dicaFunil}>
        <Cartao>
          <TituloSecao
            titulo="Da visita à matrícula"
            icone="camadas"
            extra={
              <span className="tnum">
                <strong className="text-primario font-semibold">{dados.etapas.length}</strong> etapas
              </span>
            }
          />

          {(!dados.rd?.ok || dados.rd_alerta_pico) && (
            <div className="flex flex-col gap-2 mb-3">
              {!dados.rd?.ok && (
                <Aviso dica="Qualificação em diante segue com dados do Rubeus.">
                  Visitantes/Leads do RD Marketing indisponíveis:{' '}
                  {dados.rd?.motivo || 'conecte o OAuth ou verifique o plano Analysis.'}
                </Aviso>
              )}
              {dados.rd_alerta_pico && (
                <Aviso
                  dica="O número do período está bem acima da média histórica da planilha (mais de 2×). O valor continua exibido — confira tags e janela de sync antes de usar na tomada de decisão."
                >
                  Pico artificial de leads no RD Marketing — confira antes de usar o número.
                </Aviso>
              )}
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
        </Cartao>
      </Secao>

      <Secao titulo="Recortes" icone="grafico" dica="O mesmo funil aberto por categoria de curso e mês a mês.">
        <div className={`grid gap-4 ${dados.evolucao?.length > 0 ? 'xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]' : ''}`}>
          <Cartao className="min-w-0">
            <TituloSecao titulo="Inscrições e matrículas por categoria" icone="etiqueta" dica={dicaCategorias} />
            <div className="overflow-x-auto -mx-1">
              <table className="tabela text-[13px]">
                <thead>
                  <tr>
                    <th className="text-left">Categoria</th>
                    <th className="text-right tnum">Inscrições</th>
                    <th className="text-right tnum">Matrículas</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.por_categoria.map((r) => (
                    <tr key={r.categoria}>
                      <td>{r.rotulo}</td>
                      <td className="text-right tnum">
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
                      <td className="text-right tnum">
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
                    <tr key={r.rotulo} className="text-secundario">
                      <td className="italic">{r.rotulo}</td>
                      <td className="text-right tnum">
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
                      <td className="text-right tnum">
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
          </Cartao>

          {dados.evolucao?.length > 0 && (
            <Cartao className="min-w-0">
              <TituloSecao
                titulo="Evolução mês a mês (Rubeus)"
                icone="calendario"
                dica="A última coluna é a conversão de ponta a ponta do mês: de qualificado a matriculado."
              />
              <div className="overflow-x-auto -mx-1">
                <table className="tabela text-[13px]">
                  <thead>
                    <tr>
                      <th className="text-left">Mês</th>
                      <th className="text-right tnum">Qualificados</th>
                      <th className="text-right tnum">Oportunidades</th>
                      <th className="text-right tnum">Inscrições</th>
                      <th className="text-right tnum">Matrículas</th>
                      {/* A conversão de ponta a ponta é a leitura que a planilha
                          cobra do mês: de qualificado a matriculado. */}
                      <th className="text-right tnum">Qualif. → Matríc.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.evolucao.map((r) => (
                      <tr key={r.mes}>
                        <td className="whitespace-nowrap">{rotuloMes(r.mes)}</td>
                        <td className="text-right tnum">{fmtInt(r.qualificados)}</td>
                        <td className="text-right tnum">{fmtInt(r.oportunidades)}</td>
                        <td className="text-right tnum">{fmtInt(r.inscricoes)}</td>
                        <td className="text-right tnum">{fmtInt(r.matriculas)}</td>
                        <td className="text-right tnum">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-azul-50 text-azul-700 font-semibold">
                            {r.qualificados > 0 ? `${fmtDec((r.matriculas / r.qualificados) * 100)}%` : '—'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Cartao>
          )}
        </div>
      </Secao>
    </Atualizando>

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

/**
 * As fichas da etapa selecionada, ao lado da esteira — a leitura rápida de
 * "quem são esses 18 em Oportunidade paga" sem descer até a lista completa.
 * Mesma contagem do kanban: fichas criadas no período, na etapa atual.
 */
function FichasDaEtapa({ funilId, etapa, periodoQs, versao, aoAbrir }) {
  const [pagina, setPagina] = useState(1);
  // Sem `manter`: trocar de etapa troca de lista, e a anterior seria de outra etapa.
  const { dados, erro } = useApi(
    `/api/funil/kanban?funil_id=${encodeURIComponent(funilId)}&${periodoQs}` +
      `&etapa=${encodeURIComponent(etapa)}&por_pagina=8&pagina=${pagina}`,
    `fichas-${funilId}-${etapa}-${periodoQs}-${pagina}-${versao}`,
  );

  return (
    <Cartao>
      <TituloSecao
        titulo={`Fichas em ${etapa}`}
        icone="pessoas"
        dica="Fichas criadas no período que estão nesta etapa agora — o mesmo que a coluna do kanban do Rubeus. Clique para ver a jornada."
        extra={dados && <span className="tnum"><strong className="text-primario font-semibold">{fmtInt(dados.fichas_total)}</strong> ficha(s)</span>}
      />
      {erro ? (
        <Estado tipo="erro" titulo="Não foi possível carregar" mensagem={erro} />
      ) : !dados ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, i) => <Bloco key={i} className="h-11 w-full !rounded-[10px]" />)}
        </div>
      ) : !dados.fichas.length ? (
        <Estado icone="pessoas" mensagem="Nenhuma ficha nesta etapa no período." />
      ) : (
        <>
          <ul className="m-0 p-0 list-none flex flex-col divide-y divide-borda cascata">
            {dados.fichas.map((f) => (
              <li key={f.registro}>
                <button
                  type="button"
                  onClick={() => aoAbrir(f.contato_id)}
                  className="w-full flex items-center gap-3 py-2.5 px-1 text-left bg-transparent border-0 cursor-pointer
                             rounded-[8px] transition-colors hover:bg-superficie-hover"
                >
                  <Avatar nome={f.contato_nome} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-semibold truncate">{f.contato_nome || `Contato ${f.contato_id}`}</span>
                    <Dica conteudo={f.oferta_nome || 'Oferta não informada'} className="w-full">
                      <span className="block text-[12.5px] text-secundario truncate">{f.oferta_nome || f.email || '—'}</span>
                    </Dica>
                  </span>
                  <Dica conteudo={`Ficha ${f.registro} · criada em ${fmtDataHora(f.criado_em)} · nesta etapa desde ${fmtDataHora(f.na_etapa_desde)}`}>
                    <span className="text-[12px] text-tenue tnum whitespace-nowrap">{fmtDataHora(f.na_etapa_desde)}</span>
                  </Dica>
                </button>
              </li>
            ))}
          </ul>
          {dados.paginas > 1 && (
            <div className="flex items-center justify-between gap-2 mt-3 text-[12.5px] text-secundario tnum">
              <Botao tamanho="sm" variante="fantasma" icone="chevronEsquerda" disabled={pagina <= 1} onClick={() => setPagina((n) => n - 1)}>
                Anterior
              </Botao>
              <span>página {dados.pagina} de {dados.paginas}</span>
              <Botao tamanho="sm" variante="fantasma" disabled={pagina >= dados.paginas} onClick={() => setPagina((n) => n + 1)}>
                Próxima
              </Botao>
            </div>
          )}
        </>
      )}
    </Cartao>
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
  const { dados, atualizando, erro } = useApi(
    `/api/funil?${p}${filtrosQs}`,
    `detalhe-${chave}`,
    { manter: true },
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

  /*
   * Um processo só: a esteira vira o kanban do Rubeus — fichas criadas no
   * período, na etapa em que estão agora. É o que permite pôr as duas telas
   * lado a lado e ver o mesmo número. Com vários processos (ou nenhum), segue a
   * esteira acumulada, que não tem equivalente no Rubeus.
   */
  const umFunil = funilIds.length === 1 ? funilIds[0] : null;
  const { dados: kanban, atualizando: atualizandoKanban } = useApi(
    umFunil ? `/api/funil/kanban?funil_id=${encodeURIComponent(umFunil)}&${p}` : null,
    `kanban-${umFunil}-${p}-${versao}`,
    { manter: true },
  );

  /*
   * Recorte que a esteira na tela representa.
   *
   * Com `manter`, a esteira velha fica visível enquanto a nova não chega; a
   * etapa selecionada sai dela. Se a curva usasse o recorte novo com a etapa
   * velha, dispararia uma consulta à série para uma combinação que pode sumir
   * assim que o funil novo chegar. A curva acompanha a esteira: só troca de
   * recorte quando o dado dele está na tela.
   */
  const recorteExibido = useRef(null);
  if (dados && !atualizando) recorteExibido.current = { p, filtrosCrm, funilQs: funilIds.join(','), chave };
  const recorteCurva = recorteExibido.current ?? { p, filtrosCrm, funilQs: funilIds.join(','), chave };

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
      // A etapa oculta mexe no funil e no catálogo; sem limpar o cache, a
      // volta a qualquer tela mostraria a esteira de antes da mudança.
      invalidar();
      setVersao((v) => v + 1);
    } catch (e) {
      setErroOcultar(e.message || 'Não foi possível ocultar a etapa');
    } finally {
      setOcultando(null);
    }
  };

  if (erro && !dados) return <Cartao><Estado tipo="erro" titulo="Não foi possível carregar" mensagem={erro} /></Cartao>;
  if (!dados) {
    return (
      <div className="grid gap-4 xl:grid-cols-2" aria-busy="true" aria-label="Carregando">
        <Cartao>
          <Bloco className="h-4 w-48 mb-4" />
          <EsqueletoEsteira etapas={6} />
        </Cartao>
        <EsqueletoPagina kpis={0} graficos={1} />
      </div>
    );
  }

  const funilQs = funilIds.join(',');
  if (!funis.length) {
    return (
      <Cartao>
        <Estado
          icone="funil"
          titulo="Nenhum funil cadastrado"
          mensagem="Cadastre um funil em Funis e webhooks para ver o detalhe por processo."
        />
      </Cartao>
    );
  }

  const etapasEsteira = umFunil && kanban?.etapas ? kanban.etapas : dados.etapas;
  const totalFichas = umFunil && kanban ? kanban.total_fichas : dados.total_registros ?? 0;
  const comDado = etapasEsteira.filter((e) => e.total > 0);
  const etapa = comDado.some((e) => e.etapa === etapaSel) ? etapaSel : comDado[0]?.etapa ?? null;

  const dicaEtapas =
    (umFunil
      ? 'Como o kanban do Rubeus: fichas criadas no período, na etapa em que estão agora. A etapa é conferida com o Rubeus periodicamente; ficha excluída lá sai daqui. '
      : 'Etapa final de cada ficha no período. Só entram fichas com registro de processo no CRM. ') +
    'Clique numa etapa para ver a curva dela ao lado. Use o ícone de ocultar para tirar uma etapa ' +
    'da esteira, ou configure tudo em Etapas do processo.' +
    (funilIds.length !== 1 ? ' Para ocultar etapa, selecione um único processo.' : '');

  return (
    <>
    <Atualizando ativo={atualizando || atualizandoKanban} className="flex flex-col gap-4">
      <Secao
        titulo="Etapas do processo"
        icone="funil"
        dica={dicaEtapas}
        extra={
          <a
            href="#/etapas"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-azul-600 hover:text-azul-700
                       px-2.5 py-1 rounded-[8px] hover:bg-azul-50 transition-colors"
          >
            <Icone nome="engrenagem" className="w-4 h-4" />
            <span className="hidden sm:inline">Configurar etapas</span>
          </a>
        }
      >
        <div className="grid gap-4 xl:grid-cols-2 items-start">
          <Cartao className="min-w-0">
            <TituloSecao
              titulo="Etapas no Rubeus"
              icone="camadas"
              extra={
                <span className="flex items-center gap-2 flex-wrap justify-end">
                  {ocultando && (
                    <Pill tom="azul" ponto>
                      Ocultando “{ocultando}”…
                    </Pill>
                  )}
                  <span className="tnum">
                    <strong className="text-primario font-semibold">{fmtInt(totalFichas)}</strong> ficha(s)
                    {funilIds.length > 1 ? ` · ${funilIds.length} processos` : ''}
                  </span>
                </span>
              }
            />

            {erroOcultar && (
              <div className="mb-3">
                <Aviso tom="perigo">{erroOcultar}</Aviso>
              </div>
            )}

            {etapasEsteira?.length ? (
              <Esteira
                etapas={etapasEsteira}
                kanban={Boolean(umFunil && kanban)}
                maiorQueda={umFunil && kanban ? null : dados.etapa_maior_queda}
                selecionada={etapa}
                aoSelecionar={setEtapaSel}
                comFonte
                aoOcultar={podeEditar && processoId && funilIds.length === 1 && !ocultando ? ocultarEtapa : null}
              />
            ) : (
              <Estado
                icone="funil"
                titulo="Nenhum lead neste recorte"
                mensagem="Cole o link deste funil no Rubeus, em Funis e webhooks. As etapas aparecem sozinhas conforme os eventos chegam."
              />
            )}
          </Cartao>

          {etapa && (
            <div className="min-w-0 xl:sticky xl:top-4 flex flex-col gap-4 animate-surgir" key={etapa}>
              <CurvaDaEtapa
                funilId={recorteCurva.funilQs}
                etapa={etapa}
                periodoQs={recorteCurva.p}
                filtrosQs={qsFiltrosCrm({ ...recorteCurva.filtrosCrm, funilId: [] })}
                chave={recorteCurva.chave}
              />
              {umFunil && (
                <FichasDaEtapa
                  funilId={umFunil}
                  etapa={etapa}
                  periodoQs={p}
                  versao={versao}
                  aoAbrir={(id) => setLeadAberto({ id, funilId: umFunil })}
                />
              )}
            </div>
          )}
        </div>
      </Secao>

      <Secao titulo="Leads deste funil" icone="pessoas" dica="Clique num lead para ver a jornada completa dele.">
        <Cartao>
          <LeadsDoFunil funilId={funilQs} aoAbrir={setLeadAberto} filtroPagina={filtro} />
        </Cartao>
      </Secao>
    </Atualizando>

      {leadAberto && (
        <PainelLead
          contatoId={leadAberto.id ?? leadAberto}
          funilId={leadAberto.funilId ?? ''}
          aoFechar={() => setLeadAberto(null)}
        />
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
      <CabecalhoPagina
        titulo="Funil de vendas"
        icone="funil"
        descricao="Funil automático no estilo da planilha 2026: RD Marketing no topo, Rubeus da qualificação à matrícula. A visão consolidada soma tudo; a visão por processo abre as etapas de cada funil do Rubeus."
        subtitulo={`${rotuloPeriodo(filtroLocal)} · ${fmtDiaMes(de)} a ${fmtDiaMes(ate)} · RD Marketing + Rubeus`}
      />

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

      <Abas
        rotulo="Visões do funil"
        abas={[
          { id: 'macro', nome: 'Visão consolidada', icone: 'camadas' },
          { id: 'detalhe', nome: 'Por processo (Rubeus)', icone: 'funil' },
        ]}
        ativa={aba}
        aoTrocar={setAba}
        className="self-start"
      />

      <div key={aba} className="flex flex-col gap-4 animate-aparecer">
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
      </div>
    </>
  );
}
