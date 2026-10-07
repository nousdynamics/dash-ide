import { useState } from 'react';
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
  Pill,
  PillStatus,
  Secao,
  Switch,
  TituloSecao,
} from '../componentes/base';
import { BarraFiltros } from '../componentes/BarraFiltros';
import { GraficoArea, GraficoBarras, GraficoCombinado } from '../componentes/Graficos';
import { useApi } from '../lib/api';
import { densificarPorDia, queryPeriodo, resolverPeriodo } from '../lib/periodo';
import { fmtBRL, fmtBRLCurto, fmtDec, fmtDiaMes, fmtInt, fmtPct } from '../lib/formato';

/**
 * Meta Ads, em tela própria.
 *
 * Canal separado de propósito: nada daqui soma com o Google Ads. Cada
 * plataforma conta conversão de um jeito, e misturar as duas num custo por
 * conversão só esconderia qual delas está cara.
 *
 * Conversão no Meta = lead (pixel + formulário) + conversa iniciada no
 * WhatsApp/Direct. O `click_cta`, que é o que os conjuntos otimizam, aparece
 * como secundária: é clique em botão, não contato deixado. Ver src/lib/metaAds.ts.
 */

const DICA_PRIMARIA = 'Conversão: lead do pixel/formulário ou conversa iniciada. Entra no custo por conversão.';
const DICA_SECUNDARIA = 'Secundária: clique no botão da landing (click_cta), o evento que os conjuntos otimizam. Não entra no custo por conversão.';

function BarrasPorAcao({ acoes }) {
  if (!acoes.itens.length) return <Estado mensagem="Nenhuma conversão registrada no período." />;
  const maior = Math.max(...acoes.itens.map((i) => i.resultados));
  return (
    <div className="flex flex-col gap-3 cascata">
      {acoes.itens.map((i) => {
        const primaria = i.tipo === 'primaria';
        return (
          <div key={i.codigo} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3 text-[13px]">
              <span className="flex items-center gap-2 min-w-0">
                <span className="truncate text-primario">{i.acao}</span>
                <Pill tom={primaria ? 'azul' : 'sucesso'} dica={primaria ? DICA_PRIMARIA : DICA_SECUNDARIA}>
                  {primaria ? 'conversão' : 'secundária'}
                </Pill>
              </span>
              <span className="tnum shrink-0 text-secundario">
                <strong className="text-primario font-semibold">{fmtInt(i.resultados)}</strong>
                <span className="text-tenue"> · {fmtDec(i.participacao_pct)}%</span>
              </span>
            </div>
            <BarraProporcao pct={(i.resultados / maior) * 100} tom={primaria ? 'azul' : 'sucesso'} altura="h-2.5" />
          </div>
        );
      })}
    </div>
  );
}

/** Tabela de campanhas, ordenada por investimento (já vem assim da API). */
function TabelaCampanhas({ itens }) {
  const [soComGasto, setSoComGasto] = useState(true);
  const semGasto = itens.filter((i) => !(i.investimento > 0)).length;
  const lista = soComGasto ? itens.filter((i) => i.investimento > 0) : itens;
  const maiorInv = Math.max(...lista.map((i) => i.investimento), 0);

  return (
    <Cartao className="animate-aparecer">
      <TituloSecao
        titulo="Campanhas"
        icone="alvo"
        dica="Campanhas do Meta Ads no período, da que mais gastou para a que menos gastou."
        extra={
          <span className="flex items-center gap-2">
            <Switch ligado={soComGasto} aoTrocar={setSoComGasto} dica="Esconde as campanhas que não gastaram nada no período.">
              Só com investimento
            </Switch>
            {soComGasto && semGasto > 0 && (
              <span className="text-[12.5px] text-tenue tnum">{fmtInt(semGasto)} sem gasto ocultas</span>
            )}
          </span>
        }
        className="flex-wrap"
      />
      {!lista.length ? (
        <Estado icone="alvo" titulo="Nenhuma campanha" mensagem="Nenhuma campanha do Meta gastou neste período." />
      ) : (
        <>
          <div className="hidden md:block overflow-x-auto">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Campanha</th>
                  <th>Status</th>
                  <th className="text-right!">Investimento</th>
                  <th className="text-right!"><Dica conteudo={DICA_PRIMARIA}><span>Conversões</span></Dica></th>
                  <th className="text-right!">Custo/conv.</th>
                  <th className="text-right!"><Dica conteudo="Cliques no link — os que levam à página."><span>Cliques</span></Dica></th>
                  <th className="text-right!">CTR</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <Dica conteudo={i.nome} className="min-w-0">
                        <span className="block truncate max-w-[380px] text-[13.5px] font-medium">{i.nome}</span>
                      </Dica>
                    </td>
                    <td><PillStatus status={i.status} /></td>
                    <td className="text-right tnum min-w-[130px]">
                      <div className="font-semibold">{fmtBRL(i.investimento)}</div>
                      {maiorInv > 0 && i.investimento > 0 && (
                        <div className="mt-1.5 ml-auto w-full max-w-[110px]">
                          <BarraProporcao pct={(i.investimento / maiorInv) * 100} altura="h-[5px]" />
                        </div>
                      )}
                    </td>
                    <td className="text-right tnum">
                      <Dica conteudo={`${fmtInt(i.resultados_secundarios)} cliques no botão (click_cta)`}>
                        <span className="text-primario font-medium">{fmtInt(i.resultados_primarios)}</span>
                      </Dica>
                    </td>
                    <td className="text-right tnum text-secundario">{fmtBRL(i.custo_por_resultado)}</td>
                    <td className="text-right tnum text-secundario">{fmtInt(i.cliques)}</td>
                    <td className="text-right tnum text-secundario">{fmtPct(i.ctr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="md:hidden flex flex-col">
            {lista.map((i) => (
              <div key={i.id} className="border-t border-borda first:border-t-0 py-3 px-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[13.5px] font-medium min-w-0 break-words">{i.nome}</span>
                  <span className="text-[13.5px] font-semibold tnum shrink-0">{fmtBRL(i.investimento)}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-secundario tnum">
                  <PillStatus status={i.status} />
                  <span>{fmtInt(i.resultados_primarios)} conv.</span>
                  <span>{fmtBRL(i.custo_por_resultado)}/conv.</span>
                  <span>{fmtInt(i.cliques)} cliques</span>
                  <span>CTR {fmtPct(i.ctr)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Cartao>
  );
}

export function MetaAds({ filtro, setFiltro }) {
  const [aba, setAba] = useState('evolucao');
  const p = queryPeriodo(filtro);
  const { dados, carregando, atualizando, erro } = useApi(
    [
      `/api/meta/overview?${p}${filtro.comparar ? '&comparar=1' : ''}`,
      `/api/meta/resultados-por-acao?${p}`,
      `/api/meta/campanhas?${p}`,
    ],
    `${p}|${filtro.comparar}`,
    { manter: true },
  );

  const { de, ate } = resolverPeriodo(filtro);
  const comparacao = dados?.[0]?.comparacao;
  const cabecalho = (
    <>
      <CabecalhoPagina
        titulo="Meta Ads"
        icone="alvo"
        descricao="Facebook e Instagram, em canal próprio: investimento, conversões e custo do Meta Ads. Nada aqui soma com o Google Ads."
        subtitulo={
          <>
            Meta Ads · {fmtDiaMes(de)} a {fmtDiaMes(ate)}
            {comparacao && ` · comparado com ${fmtDiaMes(comparacao.periodo.de)} a ${fmtDiaMes(comparacao.periodo.ate)}`}
          </>
        }
      />
      <BarraFiltros filtro={filtro} aoTrocar={setFiltro} />
    </>
  );

  if (erro) {
    return (
      <>
        {cabecalho}
        <Cartao><Estado tipo="erro" titulo="Não foi possível carregar o Meta Ads" mensagem={erro} /></Cartao>
      </>
    );
  }
  if (carregando || !dados) {
    return (
      <>
        {cabecalho}
        <EsqueletoPagina kpis={6} graficos={2} />
      </>
    );
  }

  const [ov, acoes, campanhas] = dados;
  const t = ov.totais;
  const dl = ov.comparacao?.deltas ?? {};
  const ant = ov.comparacao?.totais ?? null;
  const serie = densificarPorDia(ov.serie_diaria, ov.periodo.de, ov.periodo.ate);
  const serieCusto = serie
    .map((d) => ({ ...d, custo_resultado: d.resultados_primarios > 0 ? d.investimento / d.resultados_primarios : null }))
    .filter((d) => d.custo_resultado !== null);

  const kpis = [
    { rotulo: 'Investimento', valor: t.investimento, fmt: fmtBRL, delta: dl.investimento, antes: ant && fmtBRL(ant.investimento), dica: 'Quanto foi gasto no Meta Ads no período.', icone: 'dinheiro' },
    { rotulo: 'Conversões', valor: t.resultados_primarios, fmt: fmtInt, delta: dl.resultados_primarios, antes: ant && fmtInt(ant.resultados_primarios), dica: 'Leads (pixel + formulário) + conversas iniciadas no WhatsApp/Direct.', icone: 'checkCirculo', tom: 'sucesso' },
    { rotulo: 'Custo por conversão', valor: t.custo_por_resultado, fmt: fmtBRL, delta: dl.custo_por_resultado, inverso: true, antes: ant && fmtBRL(ant.custo_por_resultado), dica: 'Investimento ÷ conversões. Menor é melhor.', icone: 'etiqueta', tom: 'atencao' },
    { rotulo: 'Cliques no botão (click_cta)', valor: t.resultados_secundarios, fmt: fmtInt, delta: dl.resultados_secundarios, antes: ant && fmtInt(ant.resultados_secundarios), dica: DICA_SECUNDARIA, icone: 'clique' },
    { rotulo: 'Taxa de conversão', valor: t.taxa_conversao, fmt: fmtPct, delta: dl.taxa_conversao, antes: ant && fmtPct(ant.taxa_conversao), dica: 'Conversões ÷ cliques no link.', icone: 'porcentagem' },
  ];
  const secundarios = [
    { rotulo: 'Alcance', valor: t.alcance, fmt: fmtInt, delta: dl.alcance, antes: ant && fmtInt(ant.alcance), dica: 'Pessoas únicas que viram os anúncios no período.', icone: 'pessoas' },
    { rotulo: 'Impressões', valor: t.impressoes, fmt: fmtInt, delta: dl.impressoes, antes: ant && fmtInt(ant.impressoes), dica: 'Quantas vezes os anúncios foram exibidos.', icone: 'olho' },
    { rotulo: 'Cliques no link', valor: t.cliques, fmt: fmtInt, delta: dl.cliques, antes: ant && fmtInt(ant.cliques), dica: 'Cliques que levaram à página ou ao WhatsApp. Não conta curtida nem abrir perfil.', icone: 'clique' },
    { rotulo: 'CPC médio', valor: t.cpc_medio, fmt: fmtBRL, delta: dl.cpc_medio, inverso: true, antes: ant && fmtBRL(ant.cpc_medio), dica: 'Investimento ÷ cliques no link. Menor é melhor.', icone: 'dinheiro' },
    { rotulo: 'CPM', valor: t.cpm, fmt: fmtBRL, delta: dl.cpm, inverso: true, antes: ant && fmtBRL(ant.cpm), dica: 'Custo por mil impressões. Menor é melhor.', icone: 'etiqueta' },
    { rotulo: 'CTR', valor: t.ctr, fmt: fmtPct, delta: dl.ctr, antes: ant && fmtPct(ant.ctr), dica: 'Cliques no link ÷ impressões.', icone: 'porcentagem' },
  ];

  const comGasto = campanhas.itens.filter((i) => i.investimento > 0).length;
  const abas = [
    { id: 'evolucao', nome: 'Evolução', icone: 'tendencia' },
    { id: 'campanhas', nome: 'Campanhas', icone: 'alvo', contagem: comGasto },
    { id: 'acoes', nome: 'Conversões por ação', icone: 'camadas', contagem: acoes.itens.length },
  ];

  return (
    <>
      {cabecalho}
      <Atualizando ativo={atualizando} className="flex flex-col gap-5">
        <Secao titulo="Resultado" icone="alvo" dica="Quanto o Meta Ads custou e quantas pessoas deixaram contato.">
          <div className="grid gap-3 grade-kpi cascata">
            {kpis.map((k) => <CartaoKpi key={k.rotulo} {...k} />)}
          </div>
        </Secao>

        <Secao titulo="Alcance e custo" icone="olho" dica="Quantas pessoas viram e clicaram, e quanto custou cada clique e cada mil exibições.">
          <div className="grid gap-3 grade-kpi cascata">
            {secundarios.map((k) => <CartaoKpi key={k.rotulo} compacto {...k} />)}
          </div>
        </Secao>

        <section className="flex flex-col gap-3 pt-2">
          <Abas abas={abas} ativa={aba} aoTrocar={setAba} rotulo="Detalhes do Meta Ads" />

          {aba === 'evolucao' && (
            <div key="evolucao" className="flex flex-col gap-3 animate-aparecer">
              <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
                <GraficoBarras titulo="Investimento diário" dica="Quanto foi gasto em cada dia do período." dados={serie} chave="investimento" fmt={fmtBRL} fmtEixo={fmtBRLCurto} legenda="Gasto médio por dia" />
                <GraficoArea titulo="Conversões por dia" dica="Leads + conversas iniciadas em cada dia." dados={serie} chave="resultados_primarios" fmt={fmtInt} fmtEixo={fmtInt} legenda="Média por dia" />
              </div>
              <GraficoCombinado
                titulo="Investimento e conversões, lado a lado"
                dica="Se a linha não sobe quando a barra sobe, o dinheiro extra daquele dia não comprou resultado."
                dados={serie}
                barra={{ chave: 'investimento', rotulo: 'Investimento', fmt: fmtBRL, fmtEixo: fmtBRLCurto }}
                linha={{ chave: 'resultados_primarios', rotulo: 'Conversões', fmt: fmtInt, fmtEixo: fmtInt }}
              />
              <div className="grid gap-3 lg:grid-cols-2">
                <GraficoArea titulo="Custo por conversão, dia a dia" dica="Investimento do dia ÷ conversões do dia. Dias sem conversão ficam de fora." dados={serieCusto} chave="custo_resultado" fmt={fmtBRL} fmtEixo={fmtBRLCurto} legenda="Média dos dias com conversão" />
                <GraficoBarras titulo="Cliques no link por dia" dica="Cliques que levaram à página ou ao WhatsApp." dados={serie} chave="cliques" fmt={fmtInt} fmtEixo={fmtInt} legenda="Média por dia" />
              </div>
            </div>
          )}

          {aba === 'campanhas' && <TabelaCampanhas key="campanhas" itens={campanhas.itens} />}

          {aba === 'acoes' && (
            <Cartao key="acoes" className="animate-aparecer">
              <TituloSecao
                titulo="De onde vêm as conversões"
                icone="camadas"
                dica="As ações de captação do Meta no período e a participação de cada uma."
                className="flex-wrap"
                extra={
                  <span className="flex items-center gap-1.5 flex-wrap">
                    <Pill tom="azul" dica={DICA_PRIMARIA}><span className="tnum">{fmtInt(acoes.total_primarios)}</span> conversões</Pill>
                    <Pill tom="sucesso" dica={DICA_SECUNDARIA}><span className="tnum">{fmtInt(acoes.total_secundarios)}</span> secundárias</Pill>
                  </span>
                }
              />
              <BarrasPorAcao acoes={acoes} />
              <div className="mt-3 pt-3 border-t border-borda text-[13px] text-secundario flex items-center gap-1.5">
                <Icone nome="info" className="w-4 h-4 text-tenue" />
                Curtidas, salvamentos e cliques no link ficam fora: não dizem se alguém deixou contato.
              </div>
            </Cartao>
          )}
        </section>
      </Atualizando>
    </>
  );
}
