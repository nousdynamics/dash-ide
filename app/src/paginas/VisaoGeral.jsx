import { useState } from 'react';
import { Cartao, ChipDelta, Estado, Esqueleto } from '../componentes/base';
import { BarraFiltros } from '../componentes/BarraFiltros';
import { GraficoArea, GraficoBarras, GraficoCombinado, Ranking } from '../componentes/Graficos';
import { CardsPersonalizados, EditorMetricas } from '../componentes/MetricasPersonalizadas';
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
  // Muda ao criar/editar métrica, para a tela refazer a busca sem F5.
  const [versaoMetricas, setVersaoMetricas] = useState(0);
  const { dados, carregando, erro } = useApi(
    [
      `/api/ads/overview?${p}${filtro.comparar ? '&comparar=1' : ''}`,
      `/api/overview?dias=${diasDoPeriodo(filtro)}`,
      `/api/ads/resultados-por-acao?${p}`,
      `/api/metricas`,
    ],
    `${p}|${filtro.comparar}|${versaoMetricas}`
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
      <BarraFiltros filtro={filtro} aoTrocar={setFiltro} />
    </>
  );

  if (erro) return <>{cabecalho}<Cartao><Estado tipo="erro" titulo="Não foi possível carregar" mensagem={erro} /></Cartao></>;
  if (carregando || !dados) return <>{cabecalho}<Esqueleto linhas={5} /></>;

  const [ads, base, acoes, metricas] = dados;
  const t = ads.totais;
  const dl = ads.comparacao?.deltas ?? {};
  // O chip diz "quanto variou"; esta linha diz "variou em relação a quê".
  const ant = ads.comparacao?.totais ?? null;

  const serie = densificarPorDia(ads.serie_diaria, ads.periodo.de, ads.periodo.ate);

  /*
   * Custo por resultado dia a dia.
   *
   * O card mostra a média do período, que esconde a tendência: uma semana boa
   * seguida de uma ruim dá a mesma média que duas medianas. Aqui dá para ver se
   * está encarecendo. Dia sem resultado fica `null` — dividir por zero viraria
   * um pico infinito que achata o resto do gráfico.
   */
  const serieCusto = serie.map((d) => ({
    ...d,
    custo_resultado: d.resultados_primarios > 0 ? d.investimento / d.resultados_primarios : null,
  }));

  /*
   * Leads do CRM colados na série do Google, por data.
   *
   * É a conciliação que separa "conversão que o Google contou" de "pessoa que
   * entrou no Rubeus" — e metade dos Resultados da conta são ações locais
   * (rota no Maps, visita ao perfil), que nunca viram lead.
   */
  const leadsPorDia = new Map((base.serie_leads || []).map((l) => [l.dia, l.leads]));
  const serieConciliacao = serie.map((d) => ({
    ...d,
    leads_crm: leadsPorDia.get(d.data) ?? 0,
  }));
  const totalLeadsCrm = (base.serie_leads || []).reduce((a, l) => a + l.leads, 0);

  /*
   * Contexto das fórmulas.
   *
   * Cada ação de conversão vira `acao_<nome>` a partir do dado real da API.
   */
  const idDaAcao = (nome) =>
    'acao_' +
    (nome || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

  /*
   * `visualizacoes_pagina` sai da categoria + origem da ação, não do nome dela.
   *
   * Antes esta soma procurava "visualização de página" / "page view" no nome.
   * Na conta da IDE as ações com esse nome foram removidas há tempo, então nada
   * casava, a soma dava 0, e o Connect rate exibia "0%" — que se lê como
   * "medimos e deu zero", não como "não achei nada para medir".
   *
   * Categoria e origem vêm do Google e são estáveis: renomear a ação não muda
   * nenhuma das duas. A origem importa porque PAGE_VIEW sozinho ainda pega
   * "Local actions - Menu views", que é visualização no Perfil da Empresa, não
   * na landing — e Connect rate é clique que chegou na página.
   */
  const ehVisualizacaoPagina = (i) => i.categoria === 'PAGE_VIEW' && i.origem === 'WEBSITE';

  const porAcao = {};
  const acoesDePagina = [];
  for (const i of acoes.itens || []) {
    porAcao[idDaAcao(i.acao)] = i.resultados;
    if (ehVisualizacaoPagina(i)) acoesDePagina.push(i);
  }

  /*
   * Sem nenhuma ação de página no período, o valor é `null`, não 0: o card
   * mostra o motivo em vez de um zero que parece medição. Ver formula.js.
   */
  const visualizacoesPagina = acoesDePagina.length
    ? acoesDePagina.reduce((s, i) => s + i.resultados, 0)
    : null;

  const ctxMetricas = {
    investimento: t.investimento,
    conversoes: t.resultados_primarios,
    todas_conversoes: t.resultados,
    conversoes_secundarias: t.resultados_secundarios,
    cliques: t.cliques,
    impressoes: t.impressoes,
    leads_crm: totalLeadsCrm,
    visualizacoes_pagina: visualizacoesPagina,
    ...porAcao,
  };

  const basesComAcoes = [
    ...(metricas.bases || []).map((b) =>
      b.id === 'visualizacoes_pagina'
        ? {
            ...b,
            ajuda: acoesDePagina.length
              ? `Soma das ações de página do site: ${acoesDePagina.map((i) => i.acao).join(', ')}`
              : 'Nenhuma ação de visualização de página do site registrou resultado no período',
          }
        : b,
    ),
    ...(acoes.itens || []).map((i) => ({
      id: idDaAcao(i.acao),
      rotulo: i.acao,
      ajuda: `Ação de conversão "${i.acao}" — ${i.tipo} · ${i.resultados.toFixed(1)} no período`,
    })),
  ];

  // Só totais Ads no período anterior — ações atuais não podem vazar no "antes".
  const ctxAnterior = ant
    ? {
        investimento: ant.investimento,
        conversoes: ant.resultados_primarios,
        todas_conversoes: ant.resultados,
        conversoes_secundarias: ant.resultados_secundarios,
        cliques: ant.cliques,
        impressoes: ant.impressoes,
      }
    : null;

  const kpis = [
    { rotulo: 'Investimento', valor: fmtBRL(t.investimento), delta: dl.investimento, antes: ant && fmtBRL(ant.investimento), rodape: 'Google Ads', icone: '💰' },
    { rotulo: 'Conversões', valor: fmtDec(t.resultados_primarios), delta: dl.resultados_primarios, antes: ant && fmtDec(ant.resultados_primarios), rodape: 'Só as primárias, como no gerenciador', icone: '✓', tom: 'sucesso' },
    { rotulo: 'Todas as conversões', valor: fmtDec(t.resultados), delta: dl.resultados, antes: ant && fmtDec(ant.resultados), rodape: 'Primárias + secundárias', icone: '◆' },
    { rotulo: 'Conversões secundárias', valor: fmtDec(t.resultados_secundarios), delta: dl.resultados_secundarios, antes: ant && fmtDec(ant.resultados_secundarios), rodape: 'Ações locais: rota, visita, perfil', icone: '◇' },
    { rotulo: 'Custo por conversão', valor: fmtBRL(t.custo_por_resultado), delta: dl.custo_por_resultado, inverso: true, antes: ant && fmtBRL(ant.custo_por_resultado), rodape: 'Investimento ÷ conversões', icone: '⊘' },
    { rotulo: 'Taxa de conversão', valor: fmtPct(t.taxa_conversao), delta: dl.taxa_conversao, antes: ant && fmtPct(ant.taxa_conversao), rodape: 'Conversões ÷ cliques', icone: '◐' },
  ];

  const secundarios = [
    ['Impressões', fmtInt(t.impressoes), ant && fmtInt(ant.impressoes)],
    ['Cliques', fmtInt(t.cliques), ant && fmtInt(ant.cliques)],
    ['CPC médio', fmtBRL(t.cpc_medio), ant && fmtBRL(ant.cpc_medio)],
    ['CPM', fmtBRL(t.cpm), ant && fmtBRL(ant.cpm)],
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

      <CardsPersonalizados defs={metricas.itens} ctx={ctxMetricas} ctxAnterior={ctxAnterior} />

      <EditorMetricas
        dados={{ ...metricas, bases: basesComAcoes }}
        ctx={ctxMetricas}
        aoMudar={() => setVersaoMetricas((v) => v + 1)}
      />

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
          titulo="Conversões por dia"
          dados={serie}
          chave="resultados_primarios"
          fmt={fmtDec}
          fmtEixo={fmtInt}
          legenda="Média por dia"
        />
      </div>

      <GraficoCombinado
        titulo="Investimento e conversões, lado a lado"
        subtitulo="Se a linha não sobe quando a barra sobe, o dinheiro extra daquele dia não comprou resultado."
        dados={serie}
        barra={{ chave: 'investimento', rotulo: 'Investimento', fmt: fmtBRL, fmtEixo: fmtBRLCurto }}
        linha={{ chave: 'resultados_primarios', rotulo: 'Conversões', fmt: fmtDec, fmtEixo: fmtInt }}
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <GraficoArea
          titulo="Custo por conversão, dia a dia"
          dados={serieCusto.filter((d) => d.custo_resultado !== null)}
          chave="custo_resultado"
          fmt={fmtBRL}
          fmtEixo={fmtBRLCurto}
          legenda="Média dos dias com conversão"
        />
        <GraficoBarras
          titulo="Cliques por dia"
          dados={serie}
          chave="cliques"
          fmt={fmtInt}
          fmtEixo={fmtInt}
          legenda="Média por dia"
        />
      </div>

      <GraficoCombinado
        titulo="O que o Google contou × quem entrou no Rubeus"
        subtitulo={`${fmtDec(t.resultados_primarios)} conversões na conta de mídia · ${fmtInt(totalLeadsCrm)} leads no CRM. A diferença é conversão que não virou lead: clique em telefone, conversa iniciada que não avançou, formulário abandonado.`}
        dados={serieConciliacao}
        barra={{ chave: 'resultados_primarios', rotulo: 'Conversões (Google)', fmt: fmtDec, fmtEixo: fmtInt }}
        linha={{ chave: 'leads_crm', rotulo: 'Leads (Rubeus)', fmt: fmtInt, fmtEixo: fmtInt }}
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <Ranking
          titulo="Origem dos leads, segundo o Rubeus"
          subtitulo="De onde o lead real diz que veio — não a conversão que o Google atribuiu."
          itens={base.origens || []}
          rotulo="origem"
          valor="total"
          fmt={fmtInt}
        />
        <GraficoBarras
          titulo="A que horas o lead chega"
          dados={(base.por_hora || []).map((h) => ({ data: `${String(h.hora).padStart(2, '0')}:00`, total: h.total }))}
          chave="total"
          fmt={fmtInt}
          fmtEixo={fmtInt}
          legenda="Média por hora · horário de Brasília"
          unidade="horas"
          fmtRotulo={(v) => v}
        />
      </div>

      <Cartao>
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="text-[13px] font-semibold">De onde vêm as conversões</div>
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
