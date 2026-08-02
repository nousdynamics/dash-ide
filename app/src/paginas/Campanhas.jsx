import { Fragment, useEffect, useState } from 'react';
import { Cartao, Estado, Esqueleto, Select } from '../componentes/base';
import { FiltroPeriodo } from '../componentes/FiltroPeriodo';
import { useApi } from '../lib/api';
import { queryPeriodo, resolverPeriodo } from '../lib/periodo';
import { fmtBRL, fmtDec, fmtDiaMes, fmtInt, fmtPct } from '../lib/formato';
import { CampanhaDetalhe } from './CampanhaDetalhe';

const COLUNAS = [
  { id: 'nome', rotulo: 'Campanha', fmt: (v) => v },
  { id: 'status', rotulo: 'Status', fmt: (v) => ({ ENABLED: 'Ativa', PAUSED: 'Pausada', REMOVED: 'Excluída' }[v] || v) },
  { id: 'investimento', rotulo: 'Investimento', fmt: fmtBRL },
  { id: 'resultados', rotulo: 'Resultados', fmt: fmtDec },
  { id: 'custo_por_resultado', rotulo: 'Custo/result.', fmt: fmtBRL },
  { id: 'cliques', rotulo: 'Cliques', fmt: fmtInt },
  { id: 'ctr', rotulo: 'CTR', fmt: fmtPct },
];

const OPCOES_STATUS = [
  ['nao_removidas', 'Ativas e pausadas'],
  ['ativas', 'Somente ativas'],
  ['pausadas', 'Somente pausadas'],
  ['removidas', 'Somente excluídas'],
  ['todas', 'Todas, inclusive excluídas'],
];
const OPCOES_MODO = [['contem', 'contém'], ['exata', 'exata']];

export function Campanhas({ filtro, setFiltro }) {
  const [status, setStatus] = useState('nao_removidas');
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [modo, setModo] = useState('contem');
  const [ordem, setOrdem] = useState({ coluna: 'investimento', desc: true });
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
  const cabecalho = (
    <>
      <div>
        <div className="text-[19px] font-semibold tracking-tight">Campanhas</div>
        <div className="text-tenue text-xs mt-[2px]">
          Google Ads · {fmtDiaMes(de)} a {fmtDiaMes(ate)}
        </div>
      </div>
      <FiltroPeriodo filtro={filtro} aoTrocar={setFiltro} />
    </>
  );

  if (erro) return <>{cabecalho}<Cartao><Estado tipo="erro" titulo="Não foi possível carregar" mensagem={erro} /></Cartao></>;
  if (carregando || !dados) return <>{cabecalho}<Esqueleto linhas={6} /></>;

  const termo = buscaAplicada.trim().toLowerCase();
  let itens = dados.itens;
  if (termo) {
    itens = modo === 'exata'
      ? itens.filter((i) => i.nome.toLowerCase() === termo)
      : itens.filter((i) => i.nome.toLowerCase().includes(termo));
  }

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

  const ordenar = (col) =>
    setOrdem((o) => (o.coluna === col ? { ...o, desc: !o.desc } : { coluna: col, desc: true }));

  return (
    <>
      {cabecalho}
      <Cartao>
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="search"
              placeholder="Buscar campanha…"
              aria-label="Buscar campanha"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="bg-superficie text-primario border border-borda-forte rounded-[8px] px-2 py-[5px] text-xs"
            />
            <Select rotulo="Modo da busca" valor={modo} aoTrocar={setModo} opcoes={OPCOES_MODO} />
            <Select rotulo="Filtrar por status" valor={status} aoTrocar={setStatus} opcoes={OPCOES_STATUS} />
          </div>
          <div className="text-[13px] font-semibold tnum">
            {itens.length} de {dados.itens.length} · {fmtBRL(totalInv)} · {fmtDec(totalRes)} result.
          </div>
        </div>

        {itens.length ? (
          <>
          {/* Tabela de 7 colunas não cabe em 390px; no mobile vira lista. */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {COLUNAS.map((c) => (
                    <th key={c.id} className="text-left pb-2 px-3">
                      <button
                        type="button"
                        onClick={() => ordenar(c.id)}
                        aria-sort={ordem.coluna === c.id ? (ordem.desc ? 'descending' : 'ascending') : 'none'}
                        className={`bg-transparent border-0 p-0 cursor-pointer font-semibold text-[11px] uppercase tracking-wide whitespace-nowrap
                          ${ordem.coluna === c.id ? 'text-azul-300' : 'text-tenue hover:text-secundario'}`}
                      >
                        {c.rotulo}
                        {ordem.coluna === c.id ? (ordem.desc ? ' ↓' : ' ↑') : ''}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {itens.map((i) => {
                  const expandida = aberta === i.id;
                  const alternar = () => setAberta(expandida ? null : i.id);
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
                        className={`cursor-pointer focus-visible:outline-2 focus-visible:outline-azul-400 focus-visible:-outline-offset-2
                          ${expandida ? 'bg-superficie-hover' : 'hover:bg-superficie-hover'}`}
                      >
                        {COLUNAS.map((c) => (
                          <td
                            key={c.id}
                            className={`py-[7px] px-3 text-xs border-t border-borda ${c.id === 'nome' ? '' : 'text-secundario tnum'}`}
                          >
                            {c.id === 'nome' ? (
                              <span className="flex items-center gap-2">
                                <span
                                  aria-hidden="true"
                                  className={`text-tenue text-[10px] transition-transform motion-reduce:transition-none ${expandida ? 'rotate-90' : ''}`}
                                >
                                  ▶
                                </span>
                                {c.fmt(i[c.id])}
                              </span>
                            ) : (
                              c.fmt(i[c.id])
                            )}
                          </td>
                        ))}
                      </tr>
                      {expandida && (
                        <tr>
                          <td colSpan={COLUNAS.length} className="p-0 border-t border-borda bg-base/40">
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
              return (
                <div key={i.id} className="border-t border-borda first:border-t-0">
                  <button
                    type="button"
                    aria-expanded={expandida}
                    onClick={() => setAberta(expandida ? null : i.id)}
                    className="w-full text-left py-3 bg-transparent border-0 cursor-pointer"
                  >
                    <div className="flex items-start gap-2">
                      <span
                        aria-hidden="true"
                        className={`text-tenue text-[10px] mt-1 shrink-0 transition-transform motion-reduce:transition-none ${expandida ? 'rotate-90' : ''}`}
                      >
                        ▶
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium">{i.nome}</div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-tenue tnum">
                          <span>{fmtBRL(i.investimento)}</span>
                          <span>{fmtDec(i.resultados)} result.</span>
                          <span>{fmtBRL(i.custo_por_resultado)}/result.</span>
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
            titulo="Nenhuma campanha"
            mensagem="Nenhuma campanha bate os filtros deste período."
          />
        )}
      </Cartao>
    </>
  );
}
