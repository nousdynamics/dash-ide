import { Fragment, useEffect, useState } from 'react';
import { Cartao, Estado, Esqueleto, PillStatus, Select, SetaSanfona, Switch } from '../componentes/base';
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
 */
const COLUNAS = [
  { id: 'nome', rotulo: 'Campanha', fmt: (v) => v, alinha: 'left' },
  { id: 'status', rotulo: 'Status', alinha: 'left' },
  { id: 'investimento', rotulo: 'Investimento', fmt: fmtBRL, alinha: 'right' },
  { id: 'resultados', rotulo: 'Conversões', fmt: fmtDec, alinha: 'right' },
  { id: 'custo_por_resultado', rotulo: 'Custo/conv.', fmt: fmtBRL, alinha: 'right' },
  { id: 'cliques', rotulo: 'Cliques', fmt: fmtInt, alinha: 'right' },
  { id: 'ctr', rotulo: 'CTR', fmt: fmtPct, alinha: 'right' },
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
 * Um número do topo, com o contexto que o torna legível.
 *
 * `detalhe` não é enfeite: "R$ 729,39" sozinho não diz se é muito; "em 7
 * campanhas" diz. O número grande responde "quanto", a linha de baixo responde
 * "de onde", que é a pergunta seguinte em toda leitura.
 */
function Kpi({ rotulo, valor, detalhe }) {
  return (
    <div className="rounded-[10px] border border-borda bg-elevado px-3 py-2.5 min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-tenue truncate">
        {rotulo}
      </div>
      <div className="text-[20px] leading-tight font-semibold tnum mt-1 truncate">{valor}</div>
      {detalhe && <div className="text-[10px] text-tenue mt-0.5 truncate">{detalhe}</div>}
    </div>
  );
}

export function Campanhas({ filtro, setFiltro }) {
  const [status, setStatus] = useState('nao_removidas');
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [modo, setModo] = useState('contem');
  const [ordem, setOrdem] = useState({ coluna: 'investimento', desc: true });
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
  const { dados, carregando, erro } = useApi(
    `/api/ads/campanhas?${p}&status=${encodeURIComponent(status)}`,
    `${p}|${status}`,
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
      <div className="min-w-0">
        <div className="text-[19px] font-semibold tracking-tight">Campanhas</div>
        <div className="text-tenue text-xs mt-[2px]">
          Google Ads · {fmtDiaMes(de)} a {fmtDiaMes(ate)}
        </div>
      </div>
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
  if (carregando || !dados) return <>{cabecalho}<Esqueleto linhas={6} /></>;

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
   */
  const maiorInv = Math.max(...itens.map((i) => i.investimento), 0);

  const ordenar = (col) =>
    setOrdem((o) => (o.coluna === col ? { ...o, desc: !o.desc } : { coluna: col, desc: true }));

  const alinhar = (c) => (c.alinha === 'right' ? 'text-right' : 'text-left');

  return (
    <>
      {cabecalho}

      {/* Os totais do período, antes da lista: "quanto" vem antes de "onde". */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
        <Kpi
          rotulo="Investimento"
          valor={fmtBRL(totalInv)}
          detalhe={`${itens.length} campanha${itens.length === 1 ? '' : 's'} · ${ativas} ativa${ativas === 1 ? '' : 's'}`}
        />
        <Kpi
          rotulo="Conversões"
          valor={fmtDec(totalRes)}
          detalhe={`${fmtDec(totalPrim)} primárias`}
        />
        <Kpi
          rotulo="Custo por conversão"
          // Denominador é a conversão primária, como no gerenciador do Google.
          valor={totalPrim > 0 ? fmtBRL(totalInv / totalPrim) : '—'}
          detalhe="sobre conversões primárias"
        />
        <Kpi
          rotulo="Cliques"
          valor={fmtInt(totalCliques)}
          detalhe={totalCliques > 0 ? `${fmtBRL(totalInv / totalCliques)} por clique` : null}
        />
        <Kpi
          rotulo="CTR médio"
          valor={totalImpr > 0 ? fmtPct((totalCliques / totalImpr) * 100) : '—'}
          detalhe={`${fmtInt(totalImpr)} impressões`}
        />
      </div>

      <Cartao>
        {/* Uma linha só de controles — ver a nota sobre `w-full` no topo. */}
        <div className="flex items-center gap-2 flex-wrap pb-3 mb-1 border-b border-borda">
          <input
            type="search"
            placeholder="Buscar campanha…"
            aria-label="Buscar campanha"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="bg-superficie text-primario border border-borda-forte rounded-[8px]
                       px-2 py-[5px] text-xs w-[190px] max-w-full"
          />
          <Select rotulo="Modo da busca" valor={modo} aoTrocar={setModo} opcoes={OPCOES_MODO} />
          <Select rotulo="Filtrar por status" valor={status} aoTrocar={setStatus} opcoes={OPCOES_STATUS} />

          <span className="flex items-center gap-2 ml-auto">
            <Switch ligado={soComGasto} aoTrocar={setSoComGasto}>
              Só com investimento
            </Switch>
            {soComGasto && semGasto > 0 && (
              <span className="text-[11px] text-tenue tnum">
                {semGasto} sem gasto oculta{semGasto === 1 ? '' : 's'}
              </span>
            )}
          </span>
        </div>

        {itens.length ? (
          <>
            {/* Tabela de 7 colunas não cabe em 390px; no mobile vira lista. */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {COLUNAS.map((c) => (
                      <th
                        key={c.id}
                        className={`${alinhar(c)} pb-2 px-3`}
                      >
                        <button
                          type="button"
                          onClick={() => ordenar(c.id)}
                          aria-sort={ordem.coluna === c.id ? (ordem.desc ? 'descending' : 'ascending') : 'none'}
                          className={`bg-transparent border-0 p-0 cursor-pointer font-semibold text-[11px]
                            uppercase tracking-wide whitespace-nowrap
                            ${ordem.coluna === c.id ? 'text-azul-600' : 'text-tenue hover:text-secundario'}`}
                        >
                          {c.rotulo}
                          <span aria-hidden="true" className="ml-1 inline-block w-2">
                            {ordem.coluna === c.id ? (ordem.desc ? '↓' : '↑') : ''}
                          </span>
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {itens.map((i) => {
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
                            focus-visible:-outline-offset-2
                            ${expandida ? 'bg-superficie-hover' : 'hover:bg-superficie-hover'}`}
                        >
                          <td className="py-2 px-3 text-xs border-t border-borda">
                            <span className="flex items-center gap-2 min-w-0">
                              <SetaSanfona aberta={expandida} />
                              <span className={`truncate ${expandida ? 'font-semibold' : 'font-medium'}`}>
                                {i.nome}
                              </span>
                            </span>
                          </td>

                          <td className="py-2 px-3 border-t border-borda">
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
                          <td className="py-2 px-3 text-xs border-t border-borda text-right tnum">
                            <div className="font-medium">{fmtBRL(i.investimento)}</div>
                            {fatia > 0 && (
                              <div
                                className="mt-1 h-[3px] rounded-full bg-borda overflow-hidden ml-auto w-full max-w-[90px]"
                                aria-hidden="true"
                              >
                                <div
                                  className="h-full rounded-full bg-azul-500"
                                  style={{ width: `${Math.max(3, fatia)}%` }}
                                />
                              </div>
                            )}
                          </td>

                          {COLUNAS.slice(3).map((c) => (
                            <td
                              key={c.id}
                              className="py-2 px-3 text-xs border-t border-borda text-right tnum text-secundario"
                            >
                              {c.fmt(i[c.id])}
                            </td>
                          ))}
                        </tr>
                        {expandida && (
                          <tr>
                            <td colSpan={COLUNAS.length} className="p-0 border-t border-borda bg-elevado">
                              <div className="px-3">
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
              {itens.map((i) => {
                const expandida = aberta === i.id;
                const fatia = maiorInv > 0 ? (i.investimento / maiorInv) * 100 : 0;
                return (
                  <div key={i.id} className="border-t border-borda first:border-t-0">
                    <button
                      type="button"
                      aria-expanded={expandida}
                      onClick={() => setAberta(expandida ? null : i.id)}
                      className="w-full text-left py-3 bg-transparent border-0 cursor-pointer"
                    >
                      <div className="flex items-start gap-2">
                        <SetaSanfona aberta={expandida} className="mt-[2px]" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-xs font-medium min-w-0">{i.nome}</span>
                            <span className="text-xs font-semibold tnum shrink-0">
                              {fmtBRL(i.investimento)}
                            </span>
                          </div>
                          {fatia > 0 && (
                            <div className="mt-1.5 h-[3px] rounded-full bg-borda overflow-hidden" aria-hidden="true">
                              <div
                                className="h-full rounded-full bg-azul-500"
                                style={{ width: `${Math.max(3, fatia)}%` }}
                              />
                            </div>
                          )}
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-tenue tnum">
                            <PillStatus status={i.status} />
                            <span>{fmtDec(i.resultados)} conv.</span>
                            <span>{fmtBRL(i.custo_por_resultado)}/conv.</span>
                            <span>{fmtInt(i.cliques)} cliques</span>
                            <span>{fmtPct(i.ctr)}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                    {expandida && <CampanhaDetalhe id={i.id} filtro={filtro} />}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <Estado
            titulo={soComGasto && semGasto > 0 ? 'Nenhuma campanha gastou no período' : 'Nenhuma campanha'}
            mensagem={
              soComGasto && semGasto > 0
                ? `${semGasto} campanha${semGasto === 1 ? '' : 's'} bate${semGasto === 1 ? '' : 'm'} os filtros, mas nenhuma teve investimento. Desligue "Só com investimento" para vê-las.`
                : 'Nenhuma campanha bate os filtros deste período.'
            }
          />
        )}
      </Cartao>
    </>
  );
}
