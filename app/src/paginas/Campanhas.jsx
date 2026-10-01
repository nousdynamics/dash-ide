import { Fragment, useEffect, useState } from 'react';
import {
  Abas,
  Atualizando,
  BarraProporcao,
  CabecalhoPagina,
  Cartao,
  CartaoKpi,
  Dica,
  Estado,
  EsqueletoPagina,
  Icone,
  PillStatus,
  Select,
  SetaSanfona,
  Switch,
} from '../componentes/base';
import { BarraFiltros } from '../componentes/BarraFiltros';
import { useApi } from '../lib/api';
import { queryPeriodo, resolverPeriodo } from '../lib/periodo';
import { fmtBRL, fmtDec, fmtDiaMes, fmtInt, fmtPct } from '../lib/formato';
import { CampanhaDetalhe } from './CampanhaDetalhe';

/**
 * Campanhas do Google Ads.
 *
 * A tela responde uma pergunta de dinheiro — para onde foi o investimento e o
 * que ele trouxe —, e o desenho segue disso: primeiro os totais do período,
 * depois a lista ordenada por gasto, e a campanha se abre no lugar em vez de
 * levar para outra tela.
 *
 * O que a versão anterior errava, e por quê:
 *
 *   - Os controles de período e de filtro ocupavam uma linha cada, empilhados,
 *     empurrando a tabela para baixo da dobra. A causa não estava aqui: era o
 *     `Select` do design system, que nascia com `w-full` e, dentro de um
 *     `flex-wrap`, força cada controle a ocupar a linha sozinho.
 *   - Os números ficavam alinhados à esquerda. Coluna de dinheiro se compara
 *     pela vertical, e com casas decimais desalinhadas não dá para varrer a
 *     lista de cima a baixo — que é o único jeito de ler uma tabela dessas.
 *   - Das 94 campanhas da conta, 87 estavam pausadas com R$ 0,00. A lista real
 *     — as sete que gastam — ficava soterrada por 87 linhas de zero.
 */

/**
 * As colunas, na ordem em que a pergunta se desdobra: quanto gastei, o que
 * rendeu, quanto custou cada resultado, e o tráfego que gerou.
 *
 * `alinhamento` existe porque texto e número se leem em direções opostas: nome
 * pela esquerda, valor pela direita, com a casa decimal na mesma coluna.
 *
 * `dica` é a explicação da coluna, que aparece ao passar o mouse no cabeçalho.
 */
const COLUNAS = [
  { id: 'nome', rotulo: 'Campanha', fmt: (v) => v, alinha: 'left' },
  { id: 'status', rotulo: 'Status', alinha: 'left' },
  {
    id: 'investimento',
    rotulo: 'Investimento',
    fmt: fmtBRL,
    alinha: 'right',
    dica: 'Quanto a campanha gastou no período. A barra compara com a campanha que mais gastou.',
  },
  {
    id: 'resultados',
    rotulo: 'Conversões',
    fmt: fmtDec,
    alinha: 'right',
    dica: 'Todas as conversões registradas pelo Google Ads, primárias e secundárias.',
  },
  {
    id: 'custo_por_resultado',
    rotulo: 'Custo/conv.',
    fmt: fmtBRL,
    alinha: 'right',
    dica: 'Investimento dividido pelas conversões primárias, como no gerenciador do Google.',
  },
  { id: 'cliques', rotulo: 'Cliques', fmt: fmtInt, alinha: 'right' },
  {
    id: 'ctr',
    rotulo: 'CTR',
    fmt: fmtPct,
    alinha: 'right',
    dica: 'Taxa de cliques: cliques divididos pelas impressões.',
  },
];

const OPCOES_STATUS = [
  ['nao_removidas', 'Ativas e pausadas'],
  ['ativas', 'Somente ativas'],
  ['pausadas', 'Somente pausadas'],
  ['removidas', 'Somente excluídas'],
  ['todas', 'Todas, inclusive excluídas'],
];
const OPCOES_MODO = [['contem', 'contém'], ['exata', 'exata']];

/**
 * Agrupamento por status, em abas, sobre o que já veio da API.
 *
 * O seletor de status decide o que o servidor devolve; as abas só recortam a
 * lista na tela. Servem para a leitura "o que está rodando agora" sem perder a
 * comparação com as pausadas que ainda gastaram no período.
 */
const GRUPOS = [
  { id: 'todas', nome: 'Todas', filtro: () => true },
  { id: 'ENABLED', nome: 'Ativas', icone: 'raio', filtro: (i) => i.status === 'ENABLED' },
  { id: 'PAUSED', nome: 'Pausadas', filtro: (i) => i.status === 'PAUSED' },
  { id: 'REMOVED', nome: 'Excluídas', filtro: (i) => i.status === 'REMOVED' },
];

const plural = (n, um, varios) => `${fmtInt(n)} ${n === 1 ? um : varios}`;

/** Métricas secundárias da campanha, para a dica da linha. */
function resumoSecundario(i) {
  return (
    <span className="flex flex-col gap-0.5 tnum">
      <strong className="font-semibold">{i.nome}</strong>
      <span>Impressões: {fmtInt(i.impressoes)}</span>
      <span>Conversões primárias: {fmtDec(i.resultados_primarios)}</span>
      <span>Custo por clique: {i.cliques > 0 ? fmtBRL(i.investimento / i.cliques) : '—'}</span>
    </span>
  );
}

export function Campanhas({ filtro, setFiltro }) {
  const [status, setStatus] = useState('nao_removidas');
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [modo, setModo] = useState('contem');
  const [ordem, setOrdem] = useState({ coluna: 'investimento', desc: true });
  const [grupo, setGrupo] = useState('todas');
  /*
   * Esconder o que não gastou nasce LIGADO.
   *
   * Nesta conta são 87 campanhas pausadas com R$ 0,00 contra 7 que gastam. A
   * lista sem esse filtro é 93% ruído, e quem abre a tela está perguntando para
   * onde o dinheiro foi — pergunta que campanha sem gasto não responde.
   *
   * Nunca em silêncio: a contagem do que ficou de fora aparece ao lado do
   * interruptor, e um clique traz tudo de volta. Filtro padrão que esconde sem
   * dizer é como o painel passa a mentir por omissão.
   */
  const [soComGasto, setSoComGasto] = useState(true);
  // Sanfona: uma campanha aberta por vez, expandindo dentro da própria lista.
  const [aberta, setAberta] = useState(null);

  // Debounce: sem isso cada tecla re-renderiza a tabela inteira.
  useEffect(() => {
    const t = setTimeout(() => setBuscaAplicada(busca), 250);
    return () => clearTimeout(t);
  }, [busca]);

  const p = queryPeriodo(filtro);
  // `manter`: trocar período ou status não muda o formato da resposta, então a
  // lista antiga fica esmaecida até a nova chegar, em vez de virar esqueleto.
  const { dados, carregando, atualizando, erro } = useApi(
    `/api/ads/campanhas?${p}&status=${encodeURIComponent(status)}`,
    `${p}|${status}`,
    { manter: true },
  );

  const { de, ate } = resolverPeriodo(filtro);

  /*
   * Título e barra de filtros, nesta ordem.
   *
   * A barra é ancorada e ocupa a largura toda de propósito: é ela que define o
   * recorte de tudo abaixo, e ficava solta no canto direito, competindo com o
   * título em vez de anunciar o que vem depois.
   */
  const cabecalho = (
    <>
      <CabecalhoPagina
        titulo="Campanhas"
        icone="alvo"
        subtitulo={`Google Ads · ${fmtDiaMes(de)} a ${fmtDiaMes(ate)}`}
        descricao="Para onde foi o investimento no Google Ads e o que ele trouxe. Clique numa campanha para abrir conjuntos, anúncios e palavras-chave."
      />
      <BarraFiltros filtro={filtro} aoTrocar={setFiltro} />
    </>
  );

  if (erro) {
    return (
      <>
        {cabecalho}
        <Cartao><Estado tipo="erro" titulo="Não foi possível carregar" mensagem={erro} /></Cartao>
      </>
    );
  }
  if (carregando || !dados) {
    return (
      <>
        {cabecalho}
        <EsqueletoPagina kpis={5} graficos={0} tabela />
      </>
    );
  }

  const termo = buscaAplicada.trim().toLowerCase();

  /** Aplica busca e o filtro de gasto; a ordenação vem depois. */
  let itens = dados.itens;
  if (termo) {
    itens = modo === 'exata'
      ? itens.filter((i) => i.nome.toLowerCase() === termo)
      : itens.filter((i) => i.nome.toLowerCase().includes(termo));
  }
  const semGasto = itens.filter((i) => !(i.investimento > 0)).length;
  if (soComGasto) itens = itens.filter((i) => i.investimento > 0);

  itens = [...itens].sort((a, b) => {
    const x = a[ordem.coluna];
    const y = b[ordem.coluna];
    // Nulo sempre no fim, nas duas direções: ausência de valor não é o menor valor.
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    const cmp = typeof x === 'string' ? x.localeCompare(y, 'pt-BR') : x - y;
    return ordem.desc ? -cmp : cmp;
  });

  // Os totais valem para tudo que bate a busca e o filtro de gasto — as abas
  // de status só recortam a lista, não mudam o número do topo.
  const totalInv = itens.reduce((s, i) => s + i.investimento, 0);
  const totalRes = itens.reduce((s, i) => s + i.resultados, 0);
  const totalPrim = itens.reduce((s, i) => s + (i.resultados_primarios ?? 0), 0);
  const totalCliques = itens.reduce((s, i) => s + i.cliques, 0);
  const totalImpr = itens.reduce((s, i) => s + (i.impressoes ?? 0), 0);
  const ativas = itens.filter((i) => i.status === 'ENABLED').length;

  /*
   * A escala da barra de participação é o MAIOR gasto da lista, não o total.
   *
   * Com o total, a maior campanha desta conta ocuparia 27% da barra e todas as
   * outras virariam traços indistinguíveis. Contra o maior, a leitura é
   * relativa — "esta gasta metade da líder" —, que é a comparação que se faz.
   * A fatia do total continua disponível, na dica da barra.
   */
  const maiorInv = Math.max(...itens.map((i) => i.investimento), 0);

  // Abas só com os grupos que existem na lista; com um grupo só, não há o que separar.
  const abas = GRUPOS.map((g) => ({ ...g, contagem: itens.filter(g.filtro).length })).filter(
    (g) => g.id === 'todas' || g.contagem > 0,
  );
  const grupoAtivo = abas.some((g) => g.id === grupo) ? grupo : 'todas';
  const visiveis = itens.filter(GRUPOS.find((g) => g.id === grupoAtivo).filtro);

  const ordenar = (col) =>
    setOrdem((o) => (o.coluna === col ? { ...o, desc: !o.desc } : { coluna: col, desc: true }));

  const dicaFatia = (i) =>
    `${fmtBRL(i.investimento)} — ${totalInv > 0 ? fmtDec((i.investimento / totalInv) * 100) : '0'}% do investimento listado`;

  return (
    <>
      {cabecalho}

      <Atualizando ativo={atualizando} className="flex flex-col gap-4">
        {/* Os totais do período, antes da lista: "quanto" vem antes de "onde". */}
        <div className="grid gap-3 grade-kpi cascata">
          <CartaoKpi
            rotulo="Investimento"
            valor={totalInv}
            fmt={fmtBRL}
            icone="dinheiro"
            dica="Soma do gasto das campanhas listadas no período."
          >
            <span className="text-[12.5px] text-secundario tnum">
              {plural(itens.length, 'campanha', 'campanhas')} · {plural(ativas, 'ativa', 'ativas')}
            </span>
          </CartaoKpi>
          <CartaoKpi
            rotulo="Conversões"
            valor={totalRes}
            fmt={fmtDec}
            icone="checkCirculo"
            tom="sucesso"
            dica="Todas as conversões registradas pelo Google Ads. As primárias são as que entram no custo por conversão."
          >
            <span className="text-[12.5px] text-secundario tnum">{fmtDec(totalPrim)} primárias</span>
          </CartaoKpi>
          <CartaoKpi
            rotulo="Custo por conversão"
            // Denominador é a conversão primária, como no gerenciador do Google.
            valor={totalPrim > 0 ? totalInv / totalPrim : null}
            fmt={fmtBRL}
            icone="alvo"
            tom="atencao"
            dica="Investimento dividido pelas conversões primárias, como no gerenciador do Google."
          />
          <CartaoKpi
            rotulo="Cliques"
            valor={totalCliques}
            fmt={fmtInt}
            icone="clique"
            dica="Cliques nos anúncios. Abaixo, o custo médio de cada clique."
          >
            {totalCliques > 0 && (
              <span className="text-[12.5px] text-secundario tnum">
                {fmtBRL(totalInv / totalCliques)} por clique
              </span>
            )}
          </CartaoKpi>
          <CartaoKpi
            rotulo="CTR médio"
            valor={totalImpr > 0 ? (totalCliques / totalImpr) * 100 : null}
            fmt={fmtPct}
            icone="porcentagem"
            tom="neutro"
            dica="Cliques divididos pelas impressões de todas as campanhas listadas."
          >
            <span className="text-[12.5px] text-secundario tnum">{fmtInt(totalImpr)} impressões</span>
          </CartaoKpi>
        </div>

        <Cartao>
          {/* Uma linha só de controles — ver a nota sobre `w-full` no topo. */}
          <div className="flex items-center gap-2 flex-wrap pb-3 mb-3 border-b border-borda">
            <label className="relative inline-flex items-center w-[220px] max-w-full">
              <Icone
                nome="busca"
                className="w-4 h-4 absolute left-2.5 text-tenue pointer-events-none"
              />
              <input
                type="search"
                placeholder="Buscar campanha…"
                aria-label="Buscar campanha"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="w-full bg-superficie text-primario border border-borda-forte rounded-[9px]
                           pl-8 pr-2.5 py-[6px] text-[13px] hover:border-azul-400/50 transition-colors"
              />
            </label>
            <Select rotulo="Modo da busca" valor={modo} aoTrocar={setModo} opcoes={OPCOES_MODO} />
            <Select rotulo="Filtrar por status" valor={status} aoTrocar={setStatus} opcoes={OPCOES_STATUS} />

            <span className="flex items-center gap-2 ml-auto">
              <Switch
                ligado={soComGasto}
                aoTrocar={setSoComGasto}
                dica="Esconde as campanhas que não gastaram nada no período."
              >
                Só com investimento
              </Switch>
              {soComGasto && semGasto > 0 && (
                <span className="text-[12.5px] text-tenue tnum">
                  {semGasto} sem gasto oculta{semGasto === 1 ? '' : 's'}
                </span>
              )}
            </span>
          </div>

          {abas.length > 2 && (
            <Abas
              abas={abas.map(({ id, nome, icone, contagem }) => ({ id, nome, icone, contagem }))}
              ativa={grupoAtivo}
              aoTrocar={setGrupo}
              rotulo="Agrupar por status"
              className="mb-3"
            />
          )}

          {visiveis.length ? (
            <>
              {/* Tabela de 7 colunas não cabe em 390px; no mobile vira lista. */}
              <div className="hidden md:block overflow-x-auto">
                <table className="tabela">
                  <thead>
                    <tr>
                      {COLUNAS.map((c) => {
                        const ativa = ordem.coluna === c.id;
                        return (
                          <th key={c.id} className={c.alinha === 'right' ? 'text-right!' : ''}>
                            <Dica conteudo={c.dica}>
                              <button
                                type="button"
                                onClick={() => ordenar(c.id)}
                                aria-sort={ativa ? (ordem.desc ? 'descending' : 'ascending') : 'none'}
                                className={`inline-flex items-center gap-1 bg-transparent border-0 p-0 cursor-pointer
                                  font-semibold text-[12px] whitespace-nowrap transition-colors
                                  ${ativa ? 'text-azul-600' : 'text-secundario hover:text-primario'}`}
                              >
                                {c.rotulo}
                                <span aria-hidden="true" className="inline-flex w-3.5">
                                  {ativa && (
                                    <Icone
                                      nome="chevronBaixo"
                                      className={`w-3.5 h-3.5 transition-transform ${ordem.desc ? '' : 'rotate-180'}`}
                                    />
                                  )}
                                </span>
                              </button>
                            </Dica>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.map((i) => {
                      const expandida = aberta === i.id;
                      const alternar = () => setAberta(expandida ? null : i.id);
                      const fatia = maiorInv > 0 ? (i.investimento / maiorInv) * 100 : 0;
                      return (
                        <Fragment key={i.id}>
                          <tr
                            tabIndex={0}
                            role="button"
                            aria-expanded={expandida}
                            onClick={alternar}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                alternar();
                              }
                            }}
                            className={`cursor-pointer focus-visible:outline-2 focus-visible:outline-azul-400
                              focus-visible:-outline-offset-2 ${expandida ? 'bg-azul-50' : ''}`}
                          >
                            <td>
                              <span className="flex items-center gap-2 min-w-0 max-w-[340px]">
                                <SetaSanfona aberta={expandida} />
                                <Dica conteudo={resumoSecundario(i)} className="min-w-0">
                                  <span
                                    className={`truncate text-[13.5px] ${expandida ? 'font-semibold' : 'font-medium'}`}
                                  >
                                    {i.nome}
                                  </span>
                                </Dica>
                              </span>
                            </td>

                            <td>
                              <PillStatus status={i.status} />
                            </td>

                            {/*
                              * O valor e a barra de participação na mesma célula.
                              *
                              * A barra responde de relance o que a coluna de
                              * números só entrega somando de cabeça: qual fatia do
                              * gasto cada campanha leva. Fica sob o número, fina,
                              * para informar sem competir com ele.
                              */}
                            <td className="text-right tnum min-w-[130px]">
                              <div className="font-semibold">{fmtBRL(i.investimento)}</div>
                              {fatia > 0 && (
                                <div className="mt-1.5 ml-auto w-full max-w-[110px]">
                                  <BarraProporcao pct={fatia} altura="h-[5px]" dica={dicaFatia(i)} />
                                </div>
                              )}
                            </td>

                            {COLUNAS.slice(3).map((c) => (
                              <td key={c.id} className="text-right tnum text-secundario whitespace-nowrap">
                                {c.id === 'resultados' ? (
                                  <Dica conteudo={`${fmtDec(i.resultados_primarios)} primárias`}>
                                    <span className="text-primario font-medium">{c.fmt(i[c.id])}</span>
                                  </Dica>
                                ) : c.id === 'cliques' ? (
                                  <Dica conteudo={`${fmtInt(i.impressoes)} impressões`}>
                                    <span>{c.fmt(i[c.id])}</span>
                                  </Dica>
                                ) : (
                                  c.fmt(i[c.id])
                                )}
                              </td>
                            ))}
                          </tr>
                          {expandida && (
                            // A linha do detalhe não reage ao hover da tabela: não é clicável.
                            <tr className="hover:bg-transparent!">
                              <td colSpan={COLUNAS.length} className="p-0! bg-elevado">
                                <div className="px-4 animate-surgir">
                                  <CampanhaDetalhe id={i.id} filtro={filtro} />
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden flex flex-col">
                {visiveis.map((i) => {
                  const expandida = aberta === i.id;
                  const fatia = maiorInv > 0 ? (i.investimento / maiorInv) * 100 : 0;
                  return (
                    <div key={i.id} className="border-t border-borda first:border-t-0">
                      <button
                        type="button"
                        aria-expanded={expandida}
                        onClick={() => setAberta(expandida ? null : i.id)}
                        className={`w-full text-left py-3 px-1 bg-transparent border-0 cursor-pointer rounded-[10px]
                          transition-colors hover:bg-superficie-hover ${expandida ? 'bg-azul-50' : ''}`}
                      >
                        <div className="flex items-start gap-2">
                          <SetaSanfona aberta={expandida} className="mt-[3px]" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-[13.5px] font-medium min-w-0 break-words">{i.nome}</span>
                              <span className="text-[13.5px] font-semibold tnum shrink-0">
                                {fmtBRL(i.investimento)}
                              </span>
                            </div>
                            {fatia > 0 && (
                              <div className="mt-2">
                                <BarraProporcao pct={fatia} altura="h-[5px]" />
                              </div>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-secundario tnum">
                              <PillStatus status={i.status} />
                              <span>{fmtDec(i.resultados)} conv.</span>
                              <span>{fmtBRL(i.custo_por_resultado)}/conv.</span>
                              <span>{fmtInt(i.cliques)} cliques</span>
                              <span>CTR {fmtPct(i.ctr)}</span>
                            </div>
                          </div>
                        </div>
                      </button>
                      {expandida && (
                        <div className="animate-surgir">
                          <CampanhaDetalhe id={i.id} filtro={filtro} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <Estado
              icone="alvo"
              titulo={soComGasto && semGasto > 0 ? 'Nenhuma campanha gastou no período' : 'Nenhuma campanha'}
              mensagem={
                soComGasto && semGasto > 0
                  ? `${semGasto} campanha${semGasto === 1 ? '' : 's'} bate${semGasto === 1 ? '' : 'm'} os filtros, mas nenhuma teve investimento. Desligue "Só com investimento" para vê-las.`
                  : 'Nenhuma campanha bate os filtros deste período.'
              }
            />
          )}
        </Cartao>
      </Atualizando>
    </>
  );
}
