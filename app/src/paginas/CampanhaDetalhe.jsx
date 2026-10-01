import { useEffect, useMemo, useState } from 'react';
import {
  Abas,
  CartaoKpi,
  Dica,
  Estado,
  EsqueletoPagina,
  Icone,
  InfoDica,
  Pill,
  PillStatus,
  Sanfona,
  Select,
} from '../componentes/base';
import { useApi } from '../lib/api';
import { queryPeriodo } from '../lib/periodo';
import { ROTULO_CORRESP, ROTULO_RECURSO, fmtBRL, fmtDec, fmtDiaMes, fmtInt } from '../lib/formato';

const OPCOES_MODO = [
  ['contem', 'contém'],
  ['exata', 'exata'],
];

/** Rótulo de bloco dentro do detalhe — substitui o antigo caixa-alta de 10px. */
function Rotulo({ children, extra }) {
  return (
    <div className="text-[12.5px] font-semibold text-secundario mb-1.5 flex items-center gap-1.5">
      {children}
      {extra}
    </div>
  );
}

/** Texto curto de estado vazio dentro de um bloco — sem ícone, para não pesar. */
function Vazio({ children }) {
  return <div className="text-[13px] text-tenue py-2">{children}</div>;
}

/** Textos de um anúncio: títulos, descrições e destino. */
function TextosDoAnuncio({ anuncio }) {
  return (
    <>
      {[
        ['Títulos', anuncio.titulos],
        ['Descrições', anuncio.descricoes],
      ].map(([rot, itens]) =>
        itens.length ? (
          <div key={rot} className="mt-2.5">
            <Rotulo extra={<span className="text-tenue font-normal tnum">({itens.length})</span>}>{rot}</Rotulo>
            <div className="flex flex-col gap-0.5">
              {itens.map((t, i) => (
                <div key={i} className="text-[13px] text-primario py-[3px] pl-3 border-l-2 border-azul-400/30">
                  {t.texto}
                  {t.fixado && (
                    <span className="ml-2 inline-flex align-middle">
                      <Pill tom="atencao" dica={`Fixado na posição ${t.fixado}`}>
                        <Icone nome="cadeado" className="w-3 h-3" />
                        fixado
                      </Pill>
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : null,
      )}
      {anuncio.urls.length > 0 && (
        <div className="mt-2.5">
          <Rotulo>Destino</Rotulo>
          <div className="text-[13px] text-azul-600 py-[3px] pl-3 border-l-2 border-azul-400/30 break-all flex items-start gap-1.5">
            <Icone nome="link" className="w-3.5 h-3.5 mt-[3px] shrink-0" />
            {anuncio.urls[0]}
          </div>
        </div>
      )}
    </>
  );
}

/** Um anúncio: cabeçalho com status e números, e os textos embaixo. */
function Anuncio({ anuncio: a, mostrarConjunto = false }) {
  return (
    <div className="py-3 first:pt-1">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-1.5 md:gap-3">
        <div className="text-[13px] text-secundario flex items-center gap-2 flex-wrap min-w-0">
          <span className="font-semibold text-primario">{a.tipo || 'Anúncio'}</span>
          {mostrarConjunto && (
            <Pill tom="azul" dica="Conjunto de anúncios">
              <Icone nome="camadas" className="w-3 h-3" />
              {a.grupo}
            </Pill>
          )}
          <span className="tnum">
            {a.titulos.length} títulos · {a.descricoes.length} descrições
          </span>
        </div>
        <div className="flex items-center gap-3 text-[13px] tnum flex-wrap">
          <PillStatus status={a.status} />
          <span className="font-semibold">{fmtBRL(a.investimento)}</span>
          <span className="text-secundario">{fmtDec(a.resultados)} conv.</span>
        </div>
      </div>
      <TextosDoAnuncio anuncio={a} />
    </div>
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
    <div key={tipo} className="mb-3 last:mb-0">
      <Rotulo extra={<span className="text-tenue font-normal tnum">({itens.length})</span>}>
        {ROTULO_RECURSO[tipo] || tipo}
      </Rotulo>
      <div className="flex flex-wrap gap-1.5">
        {itens.map((r, i) => (
          <span
            key={i}
            className="text-[12.5px] px-2.5 py-1 rounded-[8px] bg-superficie text-primario border border-borda"
          >
            {r.texto || '—'}
          </span>
        ))}
      </div>
    </div>
  ));
}

/**
 * Tabela de palavras-chave. `mostrarConjunto` acrescenta a coluna do conjunto
 * — na aba de lista plana é ela que responde "qual conjunto compra esse termo".
 */
function TabelaPalavras({ palavras, mostrarConjunto = false }) {
  return (
    <>
      {/* Tabela de 6 colunas não cabe em 390px; no mobile vira lista. */}
      <div className="md:hidden flex flex-col">
        {palavras.map((k, i) => (
          <div key={`m-${k.termo}-${i}`} className={`py-2.5 ${i ? 'border-t border-borda' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <span className="text-[13.5px] font-medium min-w-0 break-words">{k.termo}</span>
              <PillStatus status={k.status} />
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-secundario tnum">
              <span>{ROTULO_CORRESP[k.correspondencia] || k.correspondencia}</span>
              {mostrarConjunto && <span>{k.grupo}</span>}
              <span className="text-primario font-semibold">{fmtBRL(k.investimento)}</span>
              <span>{fmtDec(k.resultados)} conv.</span>
              <span>{fmtInt(k.cliques)} cliques</span>
            </div>
          </div>
        ))}
      </div>
      <div className="hidden md:block overflow-x-auto rounded-[10px] border border-borda bg-superficie">
        <table className="tabela">
          <thead>
            <tr>
              <th>Termo</th>
              {mostrarConjunto && <th>Conjunto</th>}
              <th>
                <span className="inline-flex items-center gap-1">
                  Correspondência
                  <InfoDica texto="Exata: só a busca idêntica. Frase: buscas que contêm a frase. Ampla: buscas relacionadas ao termo." />
                </span>
              </th>
              <th>Estado</th>
              <th className="text-right!">Investimento</th>
              <th className="text-right!">Conversões</th>
              <th className="text-right!">Cliques</th>
            </tr>
          </thead>
          <tbody>
            {palavras.map((k, i) => (
              <tr key={`${k.termo}-${i}`}>
                <td className="font-medium">{k.termo}</td>
                {mostrarConjunto && (
                  <td className="text-secundario">
                    <Dica conteudo={k.grupo} className="max-w-[220px]">
                      <span className="truncate">{k.grupo}</span>
                    </Dica>
                  </td>
                )}
                <td className="text-secundario">{ROTULO_CORRESP[k.correspondencia] || k.correspondencia}</td>
                <td>
                  <PillStatus status={k.status} />
                </td>
                <td className="text-right tnum font-semibold">{fmtBRL(k.investimento)}</td>
                <td className="text-right tnum text-secundario">{fmtDec(k.resultados)}</td>
                <td className="text-right tnum text-secundario">{fmtInt(k.cliques)}</td>
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
 *
 * Por isso "Conjuntos" é a aba de entrada. As outras abas são atalhos para
 * quem já sabe o que procura — todas as palavras-chave, todos os anúncios —, e
 * as listas planas trazem o conjunto de cada linha para não perder aquela
 * resposta.
 */
export function CampanhaDetalhe({ id, filtro }) {
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [modo, setModo] = useState('contem');
  const [corresp, setCorresp] = useState('');
  const [abertos, setAbertos] = useState({});
  const [aba, setAba] = useState('conjuntos');

  useEffect(() => {
    const t = setTimeout(() => setBuscaAplicada(busca), 250);
    return () => clearTimeout(t);
  }, [busca]);

  const p = queryPeriodo(filtro);
  // Sem `manter`: a chave troca de campanha, e o dado velho seria de outra.
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
  if (carregando || !dados) {
    return (
      <div className="py-4">
        <EsqueletoPagina kpis={5} graficos={0} tabela />
      </div>
    );
  }

  const camp = dados.campanha;
  if (!camp) {
    return (
      <Estado
        icone="calendario"
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
  const maiorConjunto = Math.max(...conjuntos.map((c) => c.investimento), 0);

  const abas = [
    { id: 'conjuntos', nome: 'Conjuntos', icone: 'camadas', contagem: conjuntos.length },
    { id: 'palavras', nome: 'Palavras-chave', icone: 'chave', contagem: dados.palavras.length },
    { id: 'anuncios', nome: 'Anúncios', icone: 'mensagem', contagem: dados.anuncios.length },
    { id: 'recursos', nome: 'Recursos', icone: 'etiqueta', contagem: dados.recursos.length },
  ];

  // Os filtros de palavra-chave valem para as duas abas que mostram termos.
  const filtros = (
    <div className="flex items-center gap-2 flex-wrap">
      <label className="relative inline-flex items-center w-[220px] max-w-full">
        <Icone nome="busca" className="w-4 h-4 absolute left-2.5 text-tenue pointer-events-none" />
        <input
          type="search"
          placeholder="Buscar palavra-chave…"
          aria-label="Buscar palavra-chave"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="w-full bg-superficie text-primario border border-borda-forte rounded-[9px]
                     pl-8 pr-2.5 py-[6px] text-[13px] hover:border-azul-400/50 transition-colors"
        />
      </label>
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
        <Pill tom="azul">
          <Icone nome="filtro" className="w-3 h-3" />
          {totalFiltradas} de {dados.palavras.length} palavras-chave
        </Pill>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-3 py-4">
      <div className="flex items-center gap-2 flex-wrap text-[13px] text-secundario">
        <Pill tom="azul" dica="Tipo de campanha no Google Ads">
          {camp.tipo || '—'}
        </Pill>
        <span className="inline-flex items-center gap-1.5 tnum">
          <Icone nome="calendario" className="w-3.5 h-3.5 text-tenue" />
          {fmtDiaMes(dados.periodo.de)} a {fmtDiaMes(dados.periodo.ate)}
        </span>
      </div>

      <div className="grid gap-3 grade-kpi cascata">
        <CartaoKpi compacto rotulo="Investimento" valor={camp.investimento} fmt={fmtBRL} icone="dinheiro" />
        <CartaoKpi
          compacto
          rotulo="Conversões"
          valor={camp.resultados}
          fmt={fmtDec}
          icone="checkCirculo"
          tom="sucesso"
        />
        <CartaoKpi compacto rotulo="Cliques" valor={camp.cliques} fmt={fmtInt} icone="clique" />
        <CartaoKpi compacto rotulo="Impressões" valor={camp.impressoes} fmt={fmtInt} icone="olho" tom="neutro" />
        <CartaoKpi
          compacto
          rotulo="Orçamento diário"
          valor={camp.orcamento_diario}
          fmt={fmtBRL}
          icone="calendario"
          tom="neutro"
          dica="Limite de gasto por dia configurado na campanha."
        />
      </div>

      <Abas abas={abas} ativa={aba} aoTrocar={setAba} rotulo="Blocos da campanha" className="self-start" />

      <div key={aba} className="flex flex-col gap-3 animate-aparecer">
        {(aba === 'conjuntos' || aba === 'palavras') && filtros}

        {aba === 'conjuntos' &&
          (conjuntos.length ? (
            <div className="flex flex-col gap-2 cascata">
              {conjuntos.map((c) => {
                const palavras = filtrarPalavras(c.palavras);
                const chave = `g:${c.nome}`;
                return (
                  <div key={c.nome} className="bg-superficie rounded-[12px]">
                    <Sanfona
                      aberta={!!abertos[chave]}
                      aoAlternar={() => alternar(chave)}
                      titulo={
                        <span className="inline-flex flex-col gap-1.5 min-w-0 w-full md:w-[260px]">
                          <span className="text-[13.5px] font-semibold truncate">{c.nome}</span>
                          {c.investimento > 0 && (
                            <BarraConjunto
                              pct={maiorConjunto ? (c.investimento / maiorConjunto) * 100 : 0}
                            />
                          )}
                        </span>
                      }
                      resumo={
                        <span className="inline-flex items-center gap-3 flex-wrap md:justify-end">
                          <span>{c.anuncios.length} anúncio(s)</span>
                          <span>{c.palavras.length} palavra(s)</span>
                          <span className="text-primario font-semibold">{fmtBRL(c.investimento)}</span>
                          <span>{fmtDec(c.resultados)} conv.</span>
                        </span>
                      }
                    >
                      <Sanfona
                        nivel={2}
                        aberta={!!abertos[`${chave}:ads`]}
                        aoAlternar={() => alternar(`${chave}:ads`)}
                        titulo={
                          <span className="text-[13px] font-semibold">Anúncios ({c.anuncios.length})</span>
                        }
                      >
                        {c.anuncios.length ? (
                          <div className="flex flex-col divide-y divide-borda">
                            {c.anuncios.map((a) => (
                              <Anuncio key={a.id} anuncio={a} />
                            ))}
                          </div>
                        ) : (
                          <Vazio>Nenhum anúncio ativo neste conjunto no período.</Vazio>
                        )}
                      </Sanfona>

                      <Sanfona
                        nivel={2}
                        aberta={!!abertos[`${chave}:kw`]}
                        aoAlternar={() => alternar(`${chave}:kw`)}
                        titulo={
                          <span className="text-[13px] font-semibold">
                            Palavras-chave ({palavras.length}
                            {palavras.length !== c.palavras.length ? ` de ${c.palavras.length}` : ''})
                          </span>
                        }
                      >
                        {palavras.length ? (
                          <TabelaPalavras palavras={palavras} />
                        ) : (
                          <Vazio>
                            {c.palavras.length
                              ? 'Nenhuma palavra-chave deste conjunto bate os filtros.'
                              : 'Este conjunto não usa palavra-chave. Performance Max e Display não usam.'}
                          </Vazio>
                        )}
                      </Sanfona>

                      <Sanfona
                        nivel={2}
                        aberta={!!abertos[`${chave}:rec`]}
                        aoAlternar={() => alternar(`${chave}:rec`)}
                        titulo={
                          <span className="text-[13px] font-semibold inline-flex items-center gap-1.5">
                            Recursos do conjunto ({c.recursos.length})
                          </span>
                        }
                      >
                        {c.recursos.length ? (
                          <ChipsDeRecurso recursos={c.recursos} />
                        ) : (
                          <Vazio>
                            Nenhum recurso próprio deste conjunto. Os anúncios daqui servem com os
                            recursos da campanha e da conta.
                          </Vazio>
                        )}
                      </Sanfona>
                    </Sanfona>
                  </div>
                );
              })}
            </div>
          ) : (
            <Estado
              icone="camadas"
              tipo={dados.indisponivel.anuncios ? 'erro' : 'vazio'}
              mensagem={
                dados.indisponivel.anuncios
                  ? 'Não foi possível carregar os conjuntos desta campanha.'
                  : 'Nenhum conjunto com atividade no período.'
              }
            />
          ))}

        {aba === 'palavras' &&
          (() => {
            const lista = filtrarPalavras(dados.palavras);
            if (lista.length) return <TabelaPalavras palavras={lista} mostrarConjunto />;
            return (
              <Estado
                icone="chave"
                mensagem={
                  dados.palavras.length
                    ? 'Nenhuma palavra-chave bate os filtros.'
                    : 'Esta campanha não usa palavra-chave. Performance Max e Display não usam.'
                }
              />
            );
          })()}

        {aba === 'anuncios' &&
          (dados.anuncios.length ? (
            <div className="flex flex-col divide-y divide-borda rounded-[12px] border border-borda bg-superficie px-4">
              {[...dados.anuncios]
                .sort((a, b) => b.investimento - a.investimento)
                .map((a) => (
                  <Anuncio key={a.id} anuncio={a} mostrarConjunto />
                ))}
            </div>
          ) : (
            <Estado
              icone="mensagem"
              tipo={dados.indisponivel.anuncios ? 'erro' : 'vazio'}
              mensagem={
                dados.indisponivel.anuncios
                  ? 'Não foi possível carregar os anúncios desta campanha.'
                  : 'Nenhum anúncio com atividade no período.'
              }
            />
          ))}

        {aba === 'recursos' && (
          <div className="rounded-[12px] border border-borda bg-superficie p-4">
            <div className="text-[14px] font-semibold flex items-center gap-1.5 mb-3">
              Recursos da campanha
              <InfoDica texto="Recursos associados à campanha inteira. Valem para todos os conjuntos." />
            </div>
            {dados.recursos.length ? (
              <ChipsDeRecurso recursos={dados.recursos} />
            ) : (
              <Vazio>
                {dados.indisponivel.recursos
                  ? 'Não foi possível carregar os recursos.'
                  : 'Nenhum recurso associado a esta campanha.'}
              </Vazio>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Barra fina sob o nome do conjunto, contra o conjunto que mais gastou.
 * Sem dica própria: ela vive dentro do botão da sanfona, e o valor em reais
 * já está escrito ao lado.
 */
function BarraConjunto({ pct }) {
  const largura = Math.max(0, Math.min(100, pct));
  return (
    <span className="block w-full h-[4px] rounded-full bg-elevado overflow-hidden" aria-hidden="true">
      <span
        className="block h-full rounded-full barra-cresce bg-gradient-to-r from-azul-600 to-azul-400"
        style={{ width: `${Math.max(1.5, largura)}%` }}
      />
    </span>
  );
}
