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
  Secao,
  TituloSecao,
} from '../componentes/base';
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

/**
 * Ranking de ações em barra horizontal: nome longo lê melhor que fatia de rosca.
 *
 * Nome e número em cima, barra embaixo — no celular a linha única espremia o
 * nome da ação em três letras.
 */
function BarrasPorAcao({ acoes }) {
  if (!acoes.itens.length) {
    return <Estado mensagem="Nenhuma conversão registrada no período." />;
  }
  const maior = Math.max(...acoes.itens.map((i) => i.resultados));
  return (
    <div className="flex flex-col gap-3 cascata">
      {acoes.itens.slice(0, 12).map((i) => {
        const primaria = i.tipo === 'primaria';
        return (
          <div key={i.acao} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3 text-[13px]">
              <span className="flex items-center gap-2 min-w-0">
                <Dica conteudo={i.acao} className="min-w-0">
                  <span className="truncate text-primario" tabIndex={0}>{i.acao}</span>
                </Dica>
                <Pill
                  tom={primaria ? 'azul' : 'sucesso'}
                  dica={
                    primaria
                      ? 'Conversão primária: entra em "Conversões" e no custo por conversão, como no gerenciador do Google.'
                      : 'Conversão secundária: ação local (rota, visita ao perfil). Soma só em "Todas as conversões".'
                  }
                >
                  {primaria ? 'primária' : 'secundária'}
                </Pill>
              </span>
              <span className="tnum shrink-0 text-secundario">
                <strong className="text-primario font-semibold">{fmtDec(i.resultados)}</strong>
                <span className="text-tenue"> · {fmtDec(i.participacao_pct)}%</span>
              </span>
            </div>
            <BarraProporcao
              pct={(i.resultados / maior) * 100}
              tom={primaria ? 'azul' : 'sucesso'}
              altura="h-2.5"
              dica={`${i.acao}: ${fmtDec(i.resultados)} resultados — ${fmtDec(i.participacao_pct)}% do total do período`}
            />
          </div>
        );
      })}
    </div>
  );
}

/** Lista das últimas conversas capturadas pelo WhatsApp. */
function ConversasRecentes({ conversas }) {
  if (!conversas.length) {
    return (
      <Estado
        icone="mensagem"
        mensagem="Nenhuma conversa capturada ainda. Elas chegam pela Evolution API."
      />
    );
  }
  return (
    <div className="flex flex-col cascata">
      {conversas.map((c, i) => {
        const nome = c.contato_nome || `Contato ${c.contato_id ?? '—'}`;
        return (
          <div
            key={`${c.contato_id}-${c.iniciada_em}`}
            className={`flex items-center justify-between gap-3 py-2.5 px-2 -mx-2 rounded-[10px]
                        transition-colors hover:bg-superficie-hover ${i ? 'border-t border-borda' : ''}`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                aria-hidden="true"
                className="w-8 h-8 rounded-full bg-gradient-to-br from-azul-600 to-azul-400 text-white
                           flex items-center justify-center text-[12px] font-semibold shrink-0"
              >
                {iniciais(c.contato_nome)}
              </div>
              <div className="min-w-0">
                <Dica conteudo={nome} className="min-w-0">
                  <div className="font-semibold text-[13.5px] truncate">{nome}</div>
                </Dica>
                <div className="text-[12.5px] text-secundario flex items-center gap-1.5 flex-wrap">
                  <span>{c.atendente || 'Sem atendente'}</span>
                  <span className="text-tenue">·</span>
                  <span className="tnum">{fmtDataHora(c.iniciada_em)}</span>
                </div>
              </div>
            </div>
            {c.tempo_resposta_min != null ? (
              <Pill tom="azul" dica="Tempo até a primeira resposta do atendente">
                <Icone nome="relogio" className="w-3.5 h-3.5" />
                {fmtDec(c.tempo_resposta_min)} min
              </Pill>
            ) : c.respondida ? (
              <Pill tom="sucesso" dica="Conversa respondida, sem tempo de resposta medido">
                <Icone nome="check" className="w-3.5 h-3.5" traco={2.2} />
                respondida
              </Pill>
            ) : (
              <Pill tom="atencao" dica="Ainda sem resposta do atendente">
                sem resposta
              </Pill>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function VisaoGeral({ filtro, setFiltro }) {
  const p = queryPeriodo(filtro);
  // Muda ao criar/editar métrica, para a tela refazer a busca sem F5.
  const [versaoMetricas, setVersaoMetricas] = useState(0);
  // Aba de detalhe aberta; os indicadores do topo ficam fora das abas.
  const [aba, setAba] = useState('evolucao');
  // `manter`: ao trocar o período o formato da resposta é o mesmo, então o
  // número antigo fica esmaecido até o novo chegar em vez de virar esqueleto.
  const { dados, carregando, atualizando, erro } = useApi(
    [
      `/api/ads/overview?${p}${filtro.comparar ? '&comparar=1' : ''}`,
      `/api/overview?dias=${diasDoPeriodo(filtro)}`,
      `/api/ads/resultados-por-acao?${p}`,
      `/api/metricas`,
    ],
    `${p}|${filtro.comparar}|${versaoMetricas}`,
    { manter: true },
  );

  const { de, ate } = resolverPeriodo(filtro);
  const comparacao = dados?.[0]?.comparacao;
  const cabecalho = (
    <>
      <CabecalhoPagina
        titulo="Visão geral"
        icone="grafico"
        descricao="Resumo do Google Ads no período — investimento, conversões e custo — conciliado com os leads que entraram no Rubeus e as conversas do WhatsApp."
        subtitulo={
          <>
            {fmtDiaMes(de)} a {fmtDiaMes(ate)}
            {comparacao &&
              ` · comparado com ${fmtDiaMes(comparacao.periodo.de)} a ${fmtDiaMes(comparacao.periodo.ate)}`}
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
        <Cartao>
          <Estado tipo="erro" titulo="Não foi possível carregar" mensagem={erro} />
        </Cartao>
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

  const [ads, base, acoes, metricas] = dados;
  const t = ads.totais;
  const dl = ads.comparacao?.deltas ?? {};
  // O chip diz "quanto variou"; a dica dele diz "variou em relação a quê".
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

  /*
   * Os textos que antes eram rodapé miúdo embaixo de cada número viraram a
   * `dica` do "?" do rótulo; o "antes" vai para a dica do chip de variação.
   */
  const kpis = [
    { rotulo: 'Investimento', valor: t.investimento, fmt: fmtBRL, delta: dl.investimento, antes: ant && fmtBRL(ant.investimento), dica: 'Quanto foi gasto no Google Ads no período.', icone: 'dinheiro' },
    { rotulo: 'Conversões', valor: t.resultados_primarios, fmt: fmtDec, delta: dl.resultados_primarios, antes: ant && fmtDec(ant.resultados_primarios), dica: 'Só as conversões primárias, como no gerenciador do Google.', icone: 'checkCirculo', tom: 'sucesso' },
    { rotulo: 'Todas as conversões', valor: t.resultados, fmt: fmtDec, delta: dl.resultados, antes: ant && fmtDec(ant.resultados), dica: 'Primárias + secundárias.', icone: 'camadas' },
    { rotulo: 'Conversões secundárias', valor: t.resultados_secundarios, fmt: fmtDec, delta: dl.resultados_secundarios, antes: ant && fmtDec(ant.resultados_secundarios), dica: 'Ações locais: rota no Maps, visita, perfil da empresa. Servem para ver engajamento, não entram no custo por conversão.', icone: 'mapa' },
    { rotulo: 'Custo por conversão', valor: t.custo_por_resultado, fmt: fmtBRL, delta: dl.custo_por_resultado, inverso: true, antes: ant && fmtBRL(ant.custo_por_resultado), dica: 'Investimento ÷ conversões primárias. Menor é melhor.', icone: 'etiqueta', tom: 'atencao' },
    { rotulo: 'Taxa de conversão', valor: t.taxa_conversao, fmt: fmtPct, delta: dl.taxa_conversao, antes: ant && fmtPct(ant.taxa_conversao), dica: 'Conversões primárias ÷ cliques.', icone: 'porcentagem' },
  ];

  const secundarios = [
    { rotulo: 'Impressões', valor: t.impressoes, fmt: fmtInt, delta: dl.impressoes, antes: ant && fmtInt(ant.impressoes), dica: 'Quantas vezes os anúncios foram exibidos.', icone: 'olho' },
    { rotulo: 'Cliques', valor: t.cliques, fmt: fmtInt, delta: dl.cliques, antes: ant && fmtInt(ant.cliques), dica: 'Cliques nos anúncios.', icone: 'clique' },
    { rotulo: 'CPC médio', valor: t.cpc_medio, fmt: fmtBRL, delta: dl.cpc_medio, inverso: true, antes: ant && fmtBRL(ant.cpc_medio), dica: 'Custo por clique: investimento ÷ cliques. Menor é melhor.', icone: 'dinheiro' },
    { rotulo: 'CPM', valor: t.cpm, fmt: fmtBRL, delta: dl.cpm, inverso: true, antes: ant && fmtBRL(ant.cpm), dica: 'Custo por mil impressões: investimento ÷ impressões × 1000. Menor é melhor.', icone: 'etiqueta' },
    { rotulo: 'CTR', valor: t.ctr, fmt: fmtPct, delta: dl.ctr, antes: ant && fmtPct(ant.ctr), dica: 'Taxa de cliques: cliques ÷ impressões.', icone: 'porcentagem' },
  ];

  const temMetricas = (metricas.itens?.length ?? 0) > 0 || metricas.pode_editar;
  const conversas = base.conversas_recentes || [];

  const abas = [
    { id: 'evolucao', nome: 'Evolução', icone: 'tendencia' },
    { id: 'midia_crm', nome: 'Mídia × CRM', icone: 'camadas' },
    { id: 'acoes', nome: 'Conversões por ação', icone: 'alvo', contagem: (acoes.itens || []).length },
    { id: 'conversas', nome: 'Conversas recentes', icone: 'mensagem', contagem: conversas.length },
  ];

  return (
    <>
      {cabecalho}

      <Atualizando ativo={atualizando} className="flex flex-col gap-5">
        <Secao
          titulo="Resultado"
          icone="alvo"
          dica="Os números que respondem se a mídia está entregando: quanto custou e quantas conversões trouxe."
        >
          <div className="grid gap-3 grade-kpi cascata">
            {kpis.map((k) => (
              <CartaoKpi key={k.rotulo} {...k} />
            ))}
          </div>
        </Secao>

        <Secao
          titulo="Alcance e custo"
          icone="olho"
          dica="Quantas pessoas viram e clicaram nos anúncios, e quanto custou cada clique e cada mil exibições."
        >
          <div className="grid gap-3 grade-kpi cascata">
            {secundarios.map((k) => (
              <CartaoKpi key={k.rotulo} compacto {...k} />
            ))}
          </div>
        </Secao>

        {temMetricas && (
          <Secao
            titulo="Métricas personalizadas"
            icone="engrenagem"
            dica="Contas montadas por vocês a partir dos totais do período. O cálculo roda com os mesmos números dos cards acima."
          >
            <CardsPersonalizados defs={metricas.itens} ctx={ctxMetricas} ctxAnterior={ctxAnterior} />
            <EditorMetricas
              dados={{ ...metricas, bases: basesComAcoes }}
              ctx={ctxMetricas}
              aoMudar={() => setVersaoMetricas((v) => v + 1)}
            />
          </Secao>
        )}

        {/*
          * Detalhe em abas.
          *
          * Gráficos, conciliação, ações e conversas empilhados davam uma rolagem
          * de oito telas; os indicadores acima ficam sempre à vista, e o detalhe
          * é escolhido pelo assunto.
          */}
        <section className="flex flex-col gap-3 pt-2">
          <Abas abas={abas} ativa={aba} aoTrocar={setAba} rotulo="Detalhes da visão geral" />

          {aba === 'evolucao' && (
            <div key="evolucao" className="flex flex-col gap-3 animate-aparecer">
              <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
                <GraficoBarras
                  titulo="Investimento diário"
                  dica="Quanto foi gasto em cada dia do período. A barra mais escura é o pico; a linha tracejada é a média."
                  dados={serie}
                  chave="investimento"
                  fmt={fmtBRL}
                  fmtEixo={fmtBRLCurto}
                  legenda="Gasto médio por dia"
                />
                <GraficoArea
                  titulo="Conversões por dia"
                  dica="Conversões primárias registradas em cada dia."
                  dados={serie}
                  chave="resultados_primarios"
                  fmt={fmtDec}
                  fmtEixo={fmtInt}
                  legenda="Média por dia"
                />
              </div>

              <GraficoCombinado
                titulo="Investimento e conversões, lado a lado"
                dica="Se a linha não sobe quando a barra sobe, o dinheiro extra daquele dia não comprou resultado."
                dados={serie}
                barra={{ chave: 'investimento', rotulo: 'Investimento', fmt: fmtBRL, fmtEixo: fmtBRLCurto }}
                linha={{ chave: 'resultados_primarios', rotulo: 'Conversões', fmt: fmtDec, fmtEixo: fmtInt }}
              />

              <div className="grid gap-3 lg:grid-cols-2">
                <GraficoArea
                  titulo="Custo por conversão, dia a dia"
                  dica="Investimento do dia ÷ conversões do dia. Mostra se está encarecendo — coisa que a média do período esconde. Dias sem conversão ficam de fora."
                  dados={serieCusto.filter((d) => d.custo_resultado !== null)}
                  chave="custo_resultado"
                  fmt={fmtBRL}
                  fmtEixo={fmtBRLCurto}
                  legenda="Média dos dias com conversão"
                />
                <GraficoBarras
                  titulo="Cliques por dia"
                  dica="Cliques nos anúncios em cada dia do período."
                  dados={serie}
                  chave="cliques"
                  fmt={fmtInt}
                  fmtEixo={fmtInt}
                  legenda="Média por dia"
                />
              </div>
            </div>
          )}

          {aba === 'midia_crm' && (
            <div key="midia_crm" className="flex flex-col gap-3 animate-aparecer">
              {/* Os dois totais ficam na tela: são o dado que o gráfico concilia. */}
              <div className="grid gap-3 grade-kpi cascata">
                <CartaoKpi
                  compacto
                  rotulo="Conversões (Google)"
                  valor={t.resultados_primarios}
                  fmt={fmtDec}
                  icone="checkCirculo"
                  tom="sucesso"
                  dica="Conversões primárias que a conta de mídia contou no período."
                />
                <CartaoKpi
                  compacto
                  rotulo="Leads (Rubeus)"
                  valor={totalLeadsCrm}
                  fmt={fmtInt}
                  icone="pessoas"
                  dica="Pessoas que entraram no CRM no período."
                />
              </div>

              <GraficoCombinado
                titulo="O que o Google contou × quem entrou no Rubeus"
                dica={`${fmtDec(t.resultados_primarios)} conversões na conta de mídia · ${fmtInt(totalLeadsCrm)} leads no CRM. A diferença é conversão que não virou lead: clique em telefone, conversa iniciada que não avançou, formulário abandonado.`}
                dados={serieConciliacao}
                barra={{ chave: 'resultados_primarios', rotulo: 'Conversões (Google)', fmt: fmtDec, fmtEixo: fmtInt }}
                linha={{ chave: 'leads_crm', rotulo: 'Leads (Rubeus)', fmt: fmtInt, fmtEixo: fmtInt }}
              />

              <div className="grid gap-3 lg:grid-cols-2">
                <Ranking
                  titulo="Origem dos leads, segundo o Rubeus"
                  dica="De onde o lead real diz que veio — não a conversão que o Google atribuiu."
                  itens={base.origens || []}
                  rotulo="origem"
                  valor="total"
                  fmt={fmtInt}
                />
                <GraficoBarras
                  titulo="A que horas o lead chega"
                  dica="Leads que entraram no CRM em cada hora do dia, no horário de Brasília."
                  dados={(base.por_hora || []).map((h) => ({ data: `${String(h.hora).padStart(2, '0')}:00`, total: h.total }))}
                  chave="total"
                  fmt={fmtInt}
                  fmtEixo={fmtInt}
                  legenda="Média por hora · horário de Brasília"
                  unidade="horas"
                  fmtRotulo={(v) => v}
                />
              </div>
            </div>
          )}

          {aba === 'acoes' && (
            <Cartao key="acoes" className="animate-aparecer">
              <TituloSecao
                titulo="De onde vêm as conversões"
                icone="alvo"
                dica="Cada ação de conversão da conta, com o total do período e a participação no todo. Mostra as 12 maiores."
                className="flex-wrap"
                extra={
                  <span className="flex items-center gap-1.5 flex-wrap">
                    <Pill tom="azul" dica="Soma das conversões primárias do período">
                      <span className="tnum">{fmtDec(acoes.total_primarios)}</span> primárias
                    </Pill>
                    <Pill tom="sucesso" dica="Soma das conversões secundárias do período">
                      <span className="tnum">{fmtDec(acoes.total_secundarios)}</span> secundárias
                    </Pill>
                  </span>
                }
              />
              <BarrasPorAcao acoes={acoes} />
              {acoes.itens.length > 12 && (
                <div className="mt-3 pt-3 border-t border-borda text-[13px] text-secundario flex items-center gap-1.5">
                  <Icone nome="info" className="w-4 h-4 text-tenue" />
                  Mostrando as 12 maiores de {acoes.itens.length} ações.
                </div>
              )}
            </Cartao>
          )}

          {aba === 'conversas' && (
            <Cartao key="conversas" className="animate-aparecer">
              <TituloSecao
                titulo="Conversas recentes"
                icone="mensagem"
                dica="As últimas conversas de WhatsApp capturadas, com o atendente e o tempo até a primeira resposta."
              />
              <ConversasRecentes conversas={conversas} />
            </Cartao>
          )}
        </section>
      </Atualizando>
    </>
  );
}
