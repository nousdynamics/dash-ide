import { Cartao, ChipDelta, Estado, Esqueleto } from '../componentes/base';
import { FiltroPeriodo } from '../componentes/FiltroPeriodo';
import { GraficoArea, GraficoBarras } from '../componentes/Graficos';
import { useApi } from '../lib/api';
import { densificarPorDia, diasDoPeriodo, queryPeriodo, resolverPeriodo } from '../lib/periodo';
import {
  fmtBRL,
  fmtBRLCurto,
  fmtDataHora,
  fmtDec,
  fmtDiaMes,
  fmtInt,
  fmtPct,
  iniciais,
} from '../lib/formato';

function CartaoKpi({ rotulo, valor, delta, inverso, antes, rodape, icone, tom }) {
  return (
    <Cartao>
      <div
        className={`w-[26px] h-[26px] rounded-[8px] flex items-center justify-center text-xs mb-2
          ${tom === 'sucesso' ? 'bg-sucesso/12 text-sucesso' : 'bg-azul-400/14 text-azul-400'}`}
        aria-hidden="true"
      >
        {icone}
      </div>
      <div className="text-[11px] text-secundario font-medium">{rotulo}</div>
      <div className="text-[21px] font-bold tnum my-[2px] mb-[6px] tracking-tight">{valor}</div>
      <ChipDelta pct={delta} inverso={inverso} />
      {antes && (
        <span className="block mt-1 text-[11px] text-tenue">
          antes: <strong className="text-secundario font-semibold tnum">{antes}</strong>
        </span>
      )}
      <span className="block mt-2 text-[11px] text-tenue">{rodape}</span>
    </Cartao>
  );
}

/** Ranking de ações em barra horizontal: nome longo lê melhor que fatia de rosca. */
function BarrasPorAcao({ acoes }) {
  if (!acoes.itens.length) {
    return <Estado mensagem="Nenhuma conversão registrada no período." />;
  }
  const maior = Math.max(...acoes.itens.map((i) => i.resultados));
  return (
    <>
      {acoes.itens.slice(0, 12).map((i) => (
        <div key={i.acao} className="flex items-center gap-3 py-[5px]">
          <div className="basis-[40%] min-w-0 text-xs truncate" title={i.acao}>
            {i.acao}
            <span
              className={`inline-block text-[9px] px-[5px] py-px rounded-[8px] ml-[6px] align-[1px]
                ${i.tipo === 'primaria' ? 'bg-azul-400/16 text-azul-300' : 'bg-sucesso/12 text-sucesso'}`}
            >
              {i.tipo === 'primaria' ? 'primária' : 'secundária'}
            </span>
          </div>
          <div className="flex-1 h-4 bg-elevado rounded-[8px] overflow-hidden">
            <div
              className={`h-full rounded-[8px] ${
                i.tipo === 'secundaria'
                  ? 'bg-gradient-to-r from-[#1f5f52] to-sucesso opacity-85'
                  : 'bg-gradient-to-r from-azul-700 to-azul-400'
              }`}
              style={{ width: `${((i.resultados / maior) * 100).toFixed(1)}%` }}
            />
          </div>
          <div className="basis-[108px] text-right text-xs text-secundario tnum">
            <strong className="text-primario font-semibold">{fmtDec(i.resultados)}</strong> ·{' '}
            {fmtDec(i.participacao_pct)}%
          </div>
        </div>
      ))}
    </>
  );
}

export function VisaoGeral({ filtro, setFiltro }) {
  const p = queryPeriodo(filtro);
  const { dados, carregando, erro } = useApi(
    [
      `/api/ads/overview?${p}${filtro.comparar ? '&comparar=1' : ''}`,
      `/api/overview?dias=${diasDoPeriodo(filtro)}`,
      `/api/ads/resultados-por-acao?${p}`,
    ],
    `${p}|${filtro.comparar}`
  );

  const { de, ate } = resolverPeriodo(filtro);
  const cabecalho = (
    <>
      <div>
        <div className="text-[19px] font-semibold tracking-tight">Visão geral</div>
        <div className="text-tenue text-xs mt-[2px]">
          {fmtDiaMes(de)} a {fmtDiaMes(ate)}
          {dados?.[0]?.comparacao &&
            ` · comparado com ${fmtDiaMes(dados[0].comparacao.periodo.de)} a ${fmtDiaMes(dados[0].comparacao.periodo.ate)}`}
        </div>
      </div>
      <FiltroPeriodo filtro={filtro} aoTrocar={setFiltro} />
    </>
  );

  if (erro) return <>{cabecalho}<Cartao><Estado tipo="erro" titulo="Não foi possível carregar" mensagem={erro} /></Cartao></>;
  if (carregando || !dados) return <>{cabecalho}<Esqueleto linhas={5} /></>;

  const [ads, base, acoes] = dados;
  const t = ads.totais;
  const dl = ads.comparacao?.deltas ?? {};
  // O chip diz "quanto variou"; esta linha diz "variou em relação a quê".
  const ant = ads.comparacao?.totais ?? null;
  const leads = base.cards.leads_periodo;

  const serie = densificarPorDia(ads.serie_diaria, ads.periodo.de, ads.periodo.ate);

  const kpis = [
    { rotulo: 'Investimento', valor: fmtBRL(t.investimento), delta: dl.investimento, antes: ant && fmtBRL(ant.investimento), rodape: 'Google Ads', icone: '💰' },
    { rotulo: 'Resultados', valor: fmtDec(t.resultados), delta: dl.resultados, antes: ant && fmtDec(ant.resultados), rodape: 'Todas as conversões', icone: '✓', tom: 'sucesso' },
    { rotulo: 'Conversões primárias', valor: fmtDec(t.resultados_primarios), delta: dl.resultados_primarios, antes: ant && fmtDec(ant.resultados_primarios), rodape: 'Ações principais', icone: '◆' },
    { rotulo: 'Conversões secundárias', valor: fmtDec(t.resultados_secundarios), delta: dl.resultados_secundarios, antes: ant && fmtDec(ant.resultados_secundarios), rodape: 'Demais ações', icone: '◇' },
    { rotulo: 'Custo / resultado', valor: fmtBRL(t.custo_por_resultado), delta: dl.custo_por_resultado, inverso: true, antes: ant && fmtBRL(ant.custo_por_resultado), rodape: 'Investimento ÷ resultados', icone: '⊘' },
    { rotulo: 'Taxa de conversão', valor: fmtPct(t.taxa_conversao), delta: dl.taxa_conversao, antes: ant && fmtPct(ant.taxa_conversao), rodape: 'Resultados ÷ cliques', icone: '◐' },
    { rotulo: 'Leads no período', valor: fmtInt(leads.valor), delta: leads.delta_pct, rodape: 'Contatos no Rubeus', icone: '◎' },
  ];

  const secundarios = [
    ['Impressões', fmtInt(t.impressoes), ant && fmtInt(ant.impressoes)],
    ['Cliques', fmtInt(t.cliques), ant && fmtInt(ant.cliques)],
    ['CPC médio', fmtBRL(t.cpc_medio), ant && fmtBRL(ant.cpc_medio)],
    ['CTR', fmtPct(t.ctr), ant && fmtPct(ant.ctr)],
  ];

  return (
    <>
      {cabecalho}

      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(158px,1fr))]">
        {kpis.map((k) => (
          <CartaoKpi key={k.rotulo} {...k} />
        ))}
      </div>

      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(158px,1fr))]">
        {secundarios.map(([r, v, a]) => (
          <Cartao key={r}>
            <div className="text-[11px] text-secundario font-medium">{r}</div>
            <div className="text-lg font-bold tnum">{v}</div>
            {a && (
              <span className="block mt-1 text-[11px] text-tenue">
                antes: <strong className="text-secundario font-semibold tnum">{a}</strong>
              </span>
            )}
          </Cartao>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
        <GraficoBarras
          titulo="Investimento diário"
          dados={serie}
          chave="investimento"
          fmt={fmtBRL}
          fmtEixo={fmtBRLCurto}
          legenda="Gasto médio por dia"
        />
        <GraficoArea
          titulo="Resultados por dia"
          dados={serie}
          chave="resultados"
          fmt={fmtDec}
          fmtEixo={fmtInt}
          legenda="Média por dia"
        />
      </div>

      <Cartao>
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="text-[13px] font-semibold">De onde vêm os resultados</div>
          <div className="text-[11px] text-tenue tnum">
            {fmtDec(acoes.total_primarios)} primárias · {fmtDec(acoes.total_secundarios)} secundárias
          </div>
        </div>
        <BarrasPorAcao acoes={acoes} />
      </Cartao>

      <Cartao>
        <div className="text-[13px] font-semibold mb-3">Conversas recentes</div>
        {base.conversas_recentes.length ? (
          base.conversas_recentes.map((c, i) => (
            <div
              key={`${c.contato_id}-${c.iniciada_em}`}
              className={`flex items-center justify-between gap-3 py-2 ${i ? 'border-t border-borda' : ''}`}
            >
              <div className="flex items-center gap-[10px] min-w-0">
                <div className="w-6 h-6 rounded-full bg-azul-700 text-white flex items-center justify-center text-[11px] font-semibold shrink-0">
                  {iniciais(c.contato_nome)}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-[13px] truncate">
                    {c.contato_nome || `Contato ${c.contato_id ?? '—'}`}
                  </div>
                  <div className="text-[11px] text-tenue">
                    {c.atendente || 'Sem atendente'} · {fmtDataHora(c.iniciada_em)}
                  </div>
                </div>
              </div>
              <div className="text-xs text-secundario tnum whitespace-nowrap">
                {c.tempo_resposta_min != null
                  ? `${fmtDec(c.tempo_resposta_min)} min`
                  : c.respondida
                    ? 'respondida'
                    : 'sem resposta'}
              </div>
            </div>
          ))
        ) : (
          <Estado mensagem="Nenhuma conversa capturada ainda. Elas chegam pela Evolution API." />
        )}
      </Cartao>
    </>
  );
}
