import { useEffect, useState } from 'react';
import { Cartao, Estado, Esqueleto, PillStatus, Select } from '../componentes/base';
import { useApi } from '../lib/api';
import { queryPeriodo } from '../lib/periodo';
import { ROTULO_CORRESP, ROTULO_RECURSO, fmtBRL, fmtDec, fmtDiaMes, fmtInt } from '../lib/formato';

const OPCOES_MODO = [['contem', 'contém'], ['exata', 'exata']];

/**
 * Conteúdo do detalhe, renderizado dentro da própria linha da tabela.
 *
 * Sanfona e não página separada: o usuário compara campanhas entre si, e sair
 * da lista para ver o interior de uma delas custa o contexto de comparação.
 */
export function CampanhaDetalhe({ id, filtro }) {
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [modo, setModo] = useState('contem');
  const [corresp, setCorresp] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setBuscaAplicada(busca), 250);
    return () => clearTimeout(t);
  }, [busca]);

  const p = queryPeriodo(filtro);
  const { dados, carregando, erro } = useApi(`/api/ads/campanha/${encodeURIComponent(id)}?${p}`, `${id}|${p}`);

  if (erro) return <Estado tipo="erro" titulo="Não foi possível carregar" mensagem={erro} />;
  if (carregando || !dados) return <Esqueleto linhas={4} />;

  const camp = dados.campanha;
  if (!camp) {
    return (
      <Estado
        titulo="Campanha sem dados"
        mensagem="Esta campanha não registrou atividade no período selecionado."
      />
    );
  }

  const termo = buscaAplicada.trim().toLowerCase();
  let palavras = dados.palavras;
  if (termo) {
    palavras = modo === 'exata'
      ? palavras.filter((k) => k.termo.toLowerCase() === termo)
      : palavras.filter((k) => k.termo.toLowerCase().includes(termo));
  }
  if (corresp) palavras = palavras.filter((k) => k.correspondencia === corresp);

  const corresps = [...new Set(dados.palavras.map((k) => k.correspondencia))].sort();

  // Recursos agrupados por tipo.
  const porTipo = new Map();
  for (const r of dados.recursos) {
    const t = r.tipo || 'OUTRO';
    if (!porTipo.has(t)) porTipo.set(t, []);
    porTipo.get(t).push(r);
  }

  const kpis = [
    ['Investimento', fmtBRL(camp.investimento)],
    ['Resultados', fmtDec(camp.resultados)],
    ['Cliques', fmtInt(camp.cliques)],
    ['Impressões', fmtInt(camp.impressoes)],
    ['Orçamento diário', camp.orcamento_diario === null ? '—' : fmtBRL(camp.orcamento_diario)],
  ];

  return (
    <div className="flex flex-col gap-3 py-3">
      <div className="text-[11px] text-tenue">
        {camp.tipo || '—'} · {fmtDiaMes(dados.periodo.de)} a {fmtDiaMes(dados.periodo.ate)}
      </div>

      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(158px,1fr))]">
        {kpis.map(([k, v]) => (
          <Cartao key={k}>
            <div className="text-[11px] text-secundario font-medium">{k}</div>
            <div className="text-lg font-bold tnum">{v}</div>
          </Cartao>
        ))}
      </div>

      <Cartao>
        <div className="text-[13px] font-semibold mb-3">Anúncios e textos</div>
        {dados.anuncios.length ? (
          dados.anuncios.map((a, idx) => (
            <div key={a.id} className={`py-3 ${idx ? 'border-t border-borda' : 'pt-0'}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[13px] font-semibold">{a.grupo}</div>
                  <div className="text-[11px] text-tenue mt-px">
                    {a.tipo || 'Anúncio'} · {a.titulos.length} títulos · {a.descricoes.length} descrições
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-secundario tnum whitespace-nowrap">
                  <PillStatus status={a.status} />
                  <span>{fmtBRL(a.investimento)}</span>
                  <span>{fmtDec(a.resultados)} result.</span>
                </div>
              </div>

              {[['Títulos', a.titulos], ['Descrições', a.descricoes]].map(([rot, itens]) =>
                itens.length ? (
                  <div key={rot} className="mt-2">
                    <div className="text-[10px] uppercase tracking-wider text-tenue mb-1">{rot}</div>
                    {itens.map((t, i) => (
                      <div key={i} className="text-xs text-secundario py-[2px] pl-3 border-l-2 border-borda">
                        {t.texto}
                        {t.fixado && (
                          <span
                            title={`Fixado na posição ${t.fixado}`}
                            className="text-[9px] bg-atencao/12 text-atencao px-[5px] py-px rounded-[8px] ml-[6px]"
                          >
                            fixado
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null,
              )}

              {a.urls.length > 0 && (
                <div className="mt-2">
                  <div className="text-[10px] uppercase tracking-wider text-tenue mb-1">Destino</div>
                  <div className="text-xs text-azul-300 py-[2px] pl-3 border-l-2 border-borda break-all">
                    {a.urls[0]}
                  </div>
                </div>
              )}
            </div>
          ))
        ) : (
          <Estado
            mensagem={
              dados.indisponivel.anuncios
                ? 'Não foi possível carregar os anúncios desta campanha.'
                : 'Nenhum anúncio ativo nesta campanha no período.'
            }
          />
        )}
      </Cartao>

      <Cartao>
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="search"
              placeholder="Buscar palavra-chave…"
              aria-label="Buscar palavra-chave"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="bg-superficie text-primario border border-borda-forte rounded-[8px] px-2 py-[5px] text-xs"
            />
            <Select rotulo="Modo da busca" valor={modo} aoTrocar={setModo} opcoes={OPCOES_MODO} />
            <Select
              rotulo="Filtrar por correspondência"
              valor={corresp}
              aoTrocar={setCorresp}
              opcoes={[['', 'Todas as correspondências'], ...corresps.map((v) => [v, ROTULO_CORRESP[v] || v])]}
            />
          </div>
          <div className="text-[13px] font-semibold tnum">
            {palavras.length} de {dados.palavras.length} palavras-chave
          </div>
        </div>

        {palavras.length ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['Termo', 'Correspondência', 'Estado', 'Grupo', 'Investimento', 'Resultados', 'Cliques'].map((h) => (
                    <th key={h} className="text-left pb-2 px-3 text-[11px] uppercase tracking-wide text-tenue font-semibold whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {palavras.map((k, i) => (
                  <tr key={`${k.termo}-${k.grupo}-${i}`} className="hover:bg-superficie-hover">
                    <td className="py-[7px] px-3 text-xs border-t border-borda">{k.termo}</td>
                    <td className="py-[7px] px-3 text-xs border-t border-borda text-secundario">
                      {ROTULO_CORRESP[k.correspondencia] || k.correspondencia}
                    </td>
                    <td className="py-[7px] px-3 text-xs border-t border-borda"><PillStatus status={k.status} /></td>
                    <td className="py-[7px] px-3 text-xs border-t border-borda text-secundario">{k.grupo}</td>
                    <td className="py-[7px] px-3 text-xs border-t border-borda text-secundario tnum">{fmtBRL(k.investimento)}</td>
                    <td className="py-[7px] px-3 text-xs border-t border-borda text-secundario tnum">{fmtDec(k.resultados)}</td>
                    <td className="py-[7px] px-3 text-xs border-t border-borda text-secundario tnum">{fmtInt(k.cliques)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Estado
            mensagem={
              dados.indisponivel.palavras
                ? 'Não foi possível carregar as palavras-chave.'
                : 'Nenhuma palavra-chave bate os filtros. Campanhas Performance Max e Display não usam palavra-chave.'
            }
          />
        )}
      </Cartao>

      <Cartao>
        <div className="text-[13px] font-semibold mb-3">Recursos da campanha</div>
        {porTipo.size ? (
          [...porTipo.entries()].map(([tipo, itens]) => (
            <div key={tipo} className="mb-3">
              <div className="text-[10px] uppercase tracking-wider text-tenue mb-1">
                {ROTULO_RECURSO[tipo] || tipo} <span className="text-secundario">({itens.length})</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {itens.map((r, i) => (
                  <span
                    key={i}
                    className="text-[11px] px-2 py-[3px] rounded-[8px] bg-elevado text-secundario border border-borda"
                  >
                    {r.texto || '—'}
                  </span>
                ))}
              </div>
            </div>
          ))
        ) : (
          <Estado
            mensagem={
              dados.indisponivel.recursos
                ? 'Não foi possível carregar os recursos.'
                : 'Nenhum recurso associado a esta campanha.'
            }
          />
        )}
      </Cartao>
    </div>
  );
}
