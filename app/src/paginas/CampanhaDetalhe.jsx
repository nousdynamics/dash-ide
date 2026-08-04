import { useEffect, useMemo, useState } from 'react';
import { Cartao, Estado, Esqueleto, PillStatus, Sanfona, Select } from '../componentes/base';
import { useApi } from '../lib/api';
import { queryPeriodo } from '../lib/periodo';
import { ROTULO_CORRESP, ROTULO_RECURSO, fmtBRL, fmtDec, fmtDiaMes, fmtInt } from '../lib/formato';

const OPCOES_MODO = [
  ['contem', 'contém'],
  ['exata', 'exata'],
];

/** Textos de um anúncio: títulos, descrições e destino. */
function TextosDoAnuncio({ anuncio }) {
  return (
    <>
      {[
        ['Títulos', anuncio.titulos],
        ['Descrições', anuncio.descricoes],
      ].map(([rot, itens]) =>
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
      {anuncio.urls.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-wider text-tenue mb-1">Destino</div>
          <div className="text-xs text-azul-300 py-[2px] pl-3 border-l-2 border-borda break-all">
            {anuncio.urls[0]}
          </div>
        </div>
      )}
    </>
  );
}

/** Chips de recurso agrupados por tipo. Serve para campanha e para conjunto. */
function ChipsDeRecurso({ recursos }) {
  const porTipo = new Map();
  for (const r of recursos) {
    const t = r.tipo || 'OUTRO';
    if (!porTipo.has(t)) porTipo.set(t, []);
    porTipo.get(t).push(r);
  }
  return [...porTipo.entries()].map(([tipo, itens]) => (
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
  ));
}

function TabelaPalavras({ palavras }) {
  return (
    <>
      {/* Tabela de 6 colunas não cabe em 390px; no mobile vira lista. */}
      <div className="md:hidden flex flex-col">
        {palavras.map((k, i) => (
          <div key={`m-${k.termo}-${i}`} className={`py-2 ${i ? 'border-t border-borda' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs min-w-0 break-words">{k.termo}</span>
              <PillStatus status={k.status} />
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-tenue tnum">
              <span>{ROTULO_CORRESP[k.correspondencia] || k.correspondencia}</span>
              <span>{fmtBRL(k.investimento)}</span>
              <span>{fmtDec(k.resultados)} conv.</span>
              <span>{fmtInt(k.cliques)} cliques</span>
            </div>
          </div>
        ))}
      </div>
    <div className="hidden md:block overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {['Termo', 'Correspondência', 'Estado', 'Investimento', 'Conversões', 'Cliques'].map((h) => (
              <th
                key={h}
                className="text-left pb-2 px-3 text-[11px] uppercase tracking-wide text-tenue font-semibold whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {palavras.map((k, i) => (
            <tr key={`${k.termo}-${i}`} className="hover:bg-superficie-hover">
              <td className="py-[6px] px-3 text-xs border-t border-borda">{k.termo}</td>
              <td className="py-[6px] px-3 text-xs border-t border-borda text-secundario">
                {ROTULO_CORRESP[k.correspondencia] || k.correspondencia}
              </td>
              <td className="py-[6px] px-3 text-xs border-t border-borda">
                <PillStatus status={k.status} />
              </td>
              <td className="py-[6px] px-3 text-xs border-t border-borda text-secundario tnum">
                {fmtBRL(k.investimento)}
              </td>
              <td className="py-[6px] px-3 text-xs border-t border-borda text-secundario tnum">
                {fmtDec(k.resultados)}
              </td>
              <td className="py-[6px] px-3 text-xs border-t border-borda text-secundario tnum">
                {fmtInt(k.cliques)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

/**
 * Detalhe da campanha, dentro da própria linha da tabela.
 *
 * Organizado por conjunto de anúncios, que é como o Google Ads estrutura a
 * conta: cada conjunto tem seus anúncios E suas palavras-chave. Uma lista plana
 * de termos não responde "qual conjunto está comprando esse termo", que é
 * justamente a pergunta que se faz ao investigar custo.
 */
export function CampanhaDetalhe({ id, filtro }) {
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [modo, setModo] = useState('contem');
  const [corresp, setCorresp] = useState('');
  const [abertos, setAbertos] = useState({});

  useEffect(() => {
    const t = setTimeout(() => setBuscaAplicada(busca), 250);
    return () => clearTimeout(t);
  }, [busca]);

  const p = queryPeriodo(filtro);
  const { dados, carregando, erro } = useApi(
    `/api/ads/campanha/${encodeURIComponent(id)}?${p}`,
    `${id}|${p}`,
  );

  const alternar = (chave) => setAbertos((a) => ({ ...a, [chave]: !a[chave] }));

  /** Junta anúncios e palavras-chave sob o conjunto a que pertencem. */
  const conjuntos = useMemo(() => {
    if (!dados) return [];
    const mapa = new Map();
    const pegar = (nome) => {
      if (!mapa.has(nome)) {
        mapa.set(nome, {
          nome,
          anuncios: [],
          palavras: [],
          recursos: [],
          investimento: 0,
          resultados: 0,
        });
      }
      return mapa.get(nome);
    };
    for (const a of dados.anuncios) {
      const g = pegar(a.grupo);
      g.anuncios.push(a);
      g.investimento += a.investimento;
      g.resultados += a.resultados;
    }
    // Conjunto sem anúncio no período ainda pode ter palavra-chave gastando.
    for (const k of dados.palavras) pegar(k.grupo).palavras.push(k);
    for (const r of dados.recursos_por_conjunto ?? []) pegar(r.grupo).recursos.push(r);
    return [...mapa.values()].sort((a, b) => b.investimento - a.investimento);
  }, [dados]);

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
  const filtrarPalavras = (lista) => {
    let r = lista;
    if (termo) {
      r =
        modo === 'exata'
          ? r.filter((k) => k.termo.toLowerCase() === termo)
          : r.filter((k) => k.termo.toLowerCase().includes(termo));
    }
    if (corresp) r = r.filter((k) => k.correspondencia === corresp);
    return r;
  };

  const corresps = [...new Set(dados.palavras.map((k) => k.correspondencia))].sort();
  const totalFiltradas = conjuntos.reduce((s, c) => s + filtrarPalavras(c.palavras).length, 0);

  const kpis = [
    ['Investimento', fmtBRL(camp.investimento)],
    ['Conversões', fmtDec(camp.resultados)],
    ['Cliques', fmtInt(camp.cliques)],
    ['Impressões', fmtInt(camp.impressoes)],
    ['Orçamento diário', camp.orcamento_diario === null ? '—' : fmtBRL(camp.orcamento_diario)],
  ];

  return (
    <div className="flex flex-col gap-3 py-3">
      <div className="text-[11px] text-tenue">
        {camp.tipo || '—'} · {fmtDiaMes(dados.periodo.de)} a {fmtDiaMes(dados.periodo.ate)} ·{' '}
        {conjuntos.length} conjunto(s)
      </div>

      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(158px,1fr))]">
        {kpis.map(([k, v]) => (
          <Cartao key={k}>
            <div className="text-[11px] text-secundario font-medium">{k}</div>
            <div className="text-lg font-bold tnum">{v}</div>
          </Cartao>
        ))}
      </div>

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
          opcoes={[
            ['', 'Todas as correspondências'],
            ...corresps.map((v) => [v, ROTULO_CORRESP[v] || v]),
          ]}
        />
        {(termo || corresp) && (
          <span className="text-[11px] text-tenue tnum">
            {totalFiltradas} de {dados.palavras.length} palavras-chave
          </span>
        )}
      </div>

      {conjuntos.length ? (
        <div className="flex flex-col gap-2">
          {conjuntos.map((c) => {
            const palavras = filtrarPalavras(c.palavras);
            const chave = `g:${c.nome}`;
            return (
              <Sanfona
                key={c.nome}
                aberta={!!abertos[chave]}
                aoAlternar={() => alternar(chave)}
                titulo={<span className="text-[13px] font-semibold">{c.nome}</span>}
                resumo={`${c.anuncios.length} anúncio(s) · ${c.palavras.length} palavra(s) · ${fmtBRL(c.investimento)} · ${fmtDec(c.resultados)} result.`}
              >
                <Sanfona
                  nivel={2}
                  aberta={!!abertos[`${chave}:ads`]}
                  aoAlternar={() => alternar(`${chave}:ads`)}
                  titulo={<span className="text-xs font-semibold">Anúncios ({c.anuncios.length})</span>}
                >
                  {c.anuncios.length ? (
                    c.anuncios.map((a, i) => (
                      <div key={a.id} className={`py-2 ${i ? 'border-t border-borda' : ''}`}>
                        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-1 md:gap-3">
                          <div className="text-xs text-secundario">
                            {a.tipo || 'Anúncio'} · {a.titulos.length} títulos ·{' '}
                            {a.descricoes.length} descrições
                          </div>
                          <div className="flex items-center gap-3 text-xs text-secundario tnum flex-wrap">
                            <PillStatus status={a.status} />
                            <span>{fmtBRL(a.investimento)}</span>
                            <span>{fmtDec(a.resultados)} conv.</span>
                          </div>
                        </div>
                        <TextosDoAnuncio anuncio={a} />
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-tenue py-2">
                      Nenhum anúncio ativo neste conjunto no período.
                    </div>
                  )}
                </Sanfona>

                <Sanfona
                  nivel={2}
                  aberta={!!abertos[`${chave}:kw`]}
                  aoAlternar={() => alternar(`${chave}:kw`)}
                  titulo={
                    <span className="text-xs font-semibold">
                      Palavras-chave ({palavras.length}
                      {palavras.length !== c.palavras.length ? ` de ${c.palavras.length}` : ''})
                    </span>
                  }
                >
                  {palavras.length ? (
                    <TabelaPalavras palavras={palavras} />
                  ) : (
                    <div className="text-xs text-tenue py-2">
                      {c.palavras.length
                        ? 'Nenhuma palavra-chave deste conjunto bate os filtros.'
                        : 'Este conjunto não usa palavra-chave. Performance Max e Display não usam.'}
                    </div>
                  )}
                </Sanfona>

                <Sanfona
                  nivel={2}
                  aberta={!!abertos[`${chave}:rec`]}
                  aoAlternar={() => alternar(`${chave}:rec`)}
                  titulo={
                    <span className="text-xs font-semibold">Recursos do conjunto ({c.recursos.length})</span>
                  }
                >
                  {c.recursos.length ? (
                    <ChipsDeRecurso recursos={c.recursos} />
                  ) : (
                    <div className="text-xs text-tenue py-2">
                      Nenhum recurso próprio deste conjunto. Os anúncios daqui servem com os
                      recursos da campanha e da conta.
                    </div>
                  )}
                </Sanfona>
              </Sanfona>
            );
          })}
        </div>
      ) : (
        <Estado
          mensagem={
            dados.indisponivel.anuncios
              ? 'Não foi possível carregar os conjuntos desta campanha.'
              : 'Nenhum conjunto com atividade no período.'
          }
        />
      )}

      <Sanfona
        aberta={!!abertos.recursos}
        aoAlternar={() => alternar('recursos')}
        titulo={<span className="text-[13px] font-semibold">Recursos da campanha</span>}
        resumo={`${dados.recursos.length} recurso(s) · valem para todos os conjuntos`}
      >
        {dados.recursos.length ? (
          <ChipsDeRecurso recursos={dados.recursos} />
        ) : (
          <div className="text-xs text-tenue py-2">
            {dados.indisponivel.recursos
              ? 'Não foi possível carregar os recursos.'
              : 'Nenhum recurso associado a esta campanha.'}
          </div>
        )}
      </Sanfona>
    </div>
  );
}
