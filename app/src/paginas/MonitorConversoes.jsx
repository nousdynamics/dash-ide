import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Abas, Atualizando, BarraProporcao, Botao, Cartao, CartaoKpi, Dica, Estado, EsqueletoPagina,
  Esqueleto, Icone, MultiSelect, Pill, Secao, Select, SetaSanfona, TituloSecao,
} from '../componentes/base';
import { GraficoBarras, Ranking } from '../componentes/Graficos';
import { invalidar, useApi } from '../lib/api';
import {
  ROTULO_DIAGNOSTICO, ROTULO_EVENTO, ROTULO_STATUS,
  TOM_DIAGNOSTICO, TOM_STATUS, descreverIdentificadores,
} from '../lib/conversao';
import { densificarPorDia } from '../lib/periodo';
import { fmtBRL, fmtDataHora, fmtDiaMes, fmtInt, fmtPct } from '../lib/formato';

/**
 * Monitor das conversões enviadas ao Google Ads.
 *
 * A tela de configuração responde "o que vai ser enviado". Esta responde a
 * pergunta que vem depois e é a que se faz todo dia: o que REALMENTE saiu, de
 * qual curso, com que atribuição, e o que o Google fez com aquilo.
 *
 * Três camadas de verdade, e a diferença entre elas é o ponto da tela:
 *
 *   1. `status`      — o que o PAINEL fez (enviou, não enviou, por quê);
 *   2. `diagnostico` — o que o GOOGLE fez depois de aceitar a requisição;
 *   3. `identificadores` — como o lead foi ligado ao clique.
 *
 * Um painel que só mostrasse (1) diria "enviada" para conversão que o Google
 * descartou. Um que só mostrasse (3) não explicaria por que o número do Ads não
 * bate com o do funil. É preciso ver as três lado a lado.
 *
 * Organizado em abas: Resumo (volume, curso, oferta), Envios (o registro linha a
 * linha) e Diagnóstico (o veredito do Google). Os filtros e os indicadores ficam
 * acima das três, porque valem para as três. A aba de configuração, quando
 * vem de quem monta a tela, entra por `configuracao` — ela não usa os filtros.
 */

const HOJE = () => new Date().toISOString().slice(0, 10);
const DIAS_ATRAS = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

const ATRIBUICOES = [
  ['', 'Qualquer atribuição'],
  ['clique', 'Por clique (gclid)'],
  ['aprimorada', 'Aprimorada (e-mail, telefone ou CEP)'],
  ['nenhuma', 'Sem atribuição'],
];

const ATALHOS = [
  ['7 dias', 7],
  ['30 dias', 30],
  ['90 dias', 90],
];

const FILTRO_INICIAL = () => ({
  de: DIAS_ATRAS(30),
  ate: HOJE(),
  status: [],
  evento: [],
  nivel: [],
  curso: [],
  oferta: [],
  processo: [],
  acao: [],
  diagnostico: [],
  modo: '',
  atribuicao: '',
  q: '',
});

/**
 * Monta a query só com o que está preenchido.
 *
 * Mandar `nivel=` vazio faria o servidor montar um `IN ()` que não casa com
 * nada, e a tela ficaria em branco por causa de um filtro que ninguém tocou.
 *
 * Multi-seleção vai em parâmetros REPETIDOS (`curso=A&curso=B`), nunca juntos
 * numa string com vírgula: nome de curso vem de digitação livre no Rubeus e tem
 * vírgula — "Recurso de Glosas – Como Fazer, Montar E Administrar Um Setor"
 * viraria dois filtros que não casam com nada.
 */
function query(f) {
  const p = new URLSearchParams();
  if (f.de) p.set('de', f.de);
  if (f.ate) p.set('ate', f.ate);
  for (const k of ['status', 'evento', 'nivel', 'curso', 'oferta', 'processo', 'acao', 'diagnostico']) {
    for (const v of f[k] ?? []) p.append(k, v);
  }
  if (f.modo) p.set('modo', f.modo);
  if (f.atribuicao) p.set('atribuicao', f.atribuicao);
  if (f.q?.trim()) p.set('q', f.q.trim());
  return p.toString();
}

/**
 * Data por extenso para a dica. Na tabela fica o "dd/mm hh:mm", que é o que se
 * lê de relance; o dia da semana e o ano só interessam a quem foi conferir.
 */
function dataCompleta(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' });
}

const CAMPO_DATA =
  'bg-superficie text-primario border border-borda-forte rounded-[9px] px-2.5 py-[6px] text-[13px] ' +
  'hover:border-azul-400/50 transition-colors';

export function MonitorConversoes({ configuracao = null }) {
  const [filtro, setFiltro] = useState(FILTRO_INICIAL);
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(0);
  const [versao, setVersao] = useState(0);
  const [aberta, setAberta] = useState(null);
  const [aba, setAba] = useState('resumo');

  /*
   * Depois de uma gravação (reenvio, consulta de veredito), o cache em memória
   * ainda tem a resposta de antes — sem esquecê-lo, a tela mostraria o dado
   * velho até a busca nova voltar.
   */
  const recarregar = useCallback(() => {
    invalidar('/api/conversoes');
    setVersao((v) => v + 1);
  }, []);

  /*
   * A busca só vira filtro depois que a digitação para.
   *
   * Sem isso, "Maria" dispara cinco consultas — uma por letra — e as quatro
   * primeiras são jogadas fora. Em cima de uma tabela que cresce todo dia, é
   * carga no D1 para produzir resultado que ninguém chegou a ler.
   */
  useEffect(() => {
    const t = setTimeout(() => setFiltro((f) => (f.q === busca ? f : { ...f, q: busca })), 350);
    return () => clearTimeout(t);
  }, [busca]);

  const qs = useMemo(() => query(filtro), [filtro]);

  // Trocar o filtro volta para a primeira página: a página 3 do filtro antigo
  // não existe no novo, e a tabela apareceria vazia com o total dizendo 400.
  useEffect(() => setPagina(0), [qs]);

  // `manter`: a chave troca de filtro, período ou página — a resposta tem o mesmo
  // formato, então o número antigo fica esmaecido em vez de virar esqueleto.
  const monitor = useApi(`/api/conversoes/monitor?${qs}`, `monitor-${qs}-${versao}`, { manter: true });
  const registro = useApi(
    `/api/conversoes/registro?${qs}&limite=50&pagina=${pagina}`,
    `registro-${qs}-${pagina}-${versao}`,
    { manter: true },
  );

  const d = monitor.dados;
  const g = d?.geral ?? {};
  const opcoes = d?.opcoes ?? {};

  /*
   * Cursos filtrados pelo nível já escolhido.
   *
   * Sem isso o seletor de curso lista as centenas de cursos da base inteira
   * mesmo com "Pós-Graduação" marcado ao lado — e escolher um curso de outro
   * nível devolveria zero linhas sem explicar por quê.
   */
  const cursosVisiveis = useMemo(() => {
    const cursos = opcoes.cursos ?? [];
    if (!filtro.nivel.length) return cursos;
    return cursos.filter((c) => filtro.nivel.includes(c.nivel));
  }, [opcoes.cursos, filtro.nivel]);

  /*
   * Ofertas do curso escolhido.
   *
   * Comparar ofertas só faz sentido dentro de um curso — é ali que elas
   * disputam a mesma verba com preços diferentes. Com um curso marcado, o
   * seletor mostra só as dele.
   */
  const ofertasVisiveis = useMemo(() => {
    const ofertas = opcoes.ofertas ?? [];
    if (!filtro.curso.length) return ofertas;
    const daLista = new Set(
      (d?.por_oferta ?? [])
        .filter((o) => filtro.curso.includes(o.curso))
        .map((o) => o.codigo),
    );
    return ofertas.filter((o) => daLista.has(o.codigo));
  }, [opcoes.ofertas, filtro.curso, d?.por_oferta]);

  const serie = useMemo(
    () => densificarPorDia(d?.por_dia ?? [], filtro.de, filtro.ate),
    [d?.por_dia, filtro.de, filtro.ate],
  );

  const total = Number(g.total) || 0;
  const comClique = Number(g.com_clique) || 0;
  const comHash = Number(g.com_hash) || 0;
  const atribuidos = comClique + comHash;
  const recusadas = (Number(g.recusadas) || 0) + (Number(g.google_falhou) || 0);

  const mudar = (mudanca) => setFiltro((f) => ({ ...f, ...mudanca }));

  const limpar = () => {
    setBusca('');
    setFiltro(FILTRO_INICIAL());
  };

  const filtrosAtivos =
    filtro.status.length + filtro.evento.length + filtro.nivel.length + filtro.curso.length
    + filtro.oferta.length
    + filtro.processo.length + filtro.acao.length + filtro.diagnostico.length
    + (filtro.modo ? 1 : 0) + (filtro.atribuicao ? 1 : 0) + (filtro.q ? 1 : 0);

  const abas = [
    { id: 'resumo', nome: 'Resumo', icone: 'grafico' },
    { id: 'envios', nome: 'Envios', icone: 'lista', contagem: registro.dados ? fmtInt(registro.dados.total) : undefined },
    {
      id: 'diagnostico',
      nome: 'Diagnóstico',
      icone: 'escudo',
      contagem: d && Number(g.google_aguardando) > 0 ? fmtInt(g.google_aguardando) : undefined,
    },
    ...(configuracao ? [{ id: 'config', nome: 'Captura e planilha', icone: 'engrenagem' }] : []),
  ];

  return (
    <>
      <Abas abas={abas} ativa={aba} aoTrocar={setAba} rotulo="Seções de Google Conversões" className="self-start" />

      {aba === 'config' ? (
        <div key="config" className="flex flex-col gap-4 animate-surgir">{configuracao}</div>
      ) : (
        <>
          {/* ----------------------------------------------------------- filtros */}
          <Cartao>
            <TituloSecao
              titulo="Filtros"
              icone="filtro"
              dica="Valem para as três abas — Resumo, Envios e Diagnóstico — e para o CSV."
              extra={
                <>
                  {filtrosAtivos > 0 && (
                    <Botao variante="fantasma" tamanho="sm" icone="x" onClick={limpar}>
                      Limpar ({filtrosAtivos})
                    </Botao>
                  )}
                  <Dica conteudo="Baixa o registro com os filtros atuais, em CSV">
                    <a
                      href={`/api/conversoes/registro.csv?${qs}`}
                      className="inline-flex items-center gap-1.5 text-[12.5px] font-medium px-2.5 py-1 rounded-[8px] border
                                 border-borda-forte bg-superficie text-primario no-underline
                                 hover:bg-superficie-hover hover:border-azul-400/40 transition-colors"
                    >
                      <Icone nome="baixar" className="w-4 h-4" />
                      Baixar CSV
                    </a>
                  </Dica>
                </>
              }
            />

            <div className="flex items-center gap-2 flex-wrap pb-3 mb-3 border-b border-borda">
              <input
                type="date"
                aria-label="Data inicial"
                value={filtro.de}
                max={filtro.ate}
                onChange={(e) => mudar({ de: e.target.value })}
                className={CAMPO_DATA}
              />
              <span className="text-secundario text-[13px]">até</span>
              <input
                type="date"
                aria-label="Data final"
                value={filtro.ate}
                min={filtro.de}
                onChange={(e) => mudar({ ate: e.target.value })}
                className={CAMPO_DATA}
              />
              <div className="inline-flex gap-1 p-0.5 rounded-[10px] bg-elevado border border-borda">
                {ATALHOS.map(([rotulo, dias]) => {
                  const ativo = filtro.de === DIAS_ATRAS(dias) && filtro.ate === HOJE();
                  return (
                    <button
                      key={dias}
                      type="button"
                      aria-pressed={ativo}
                      onClick={() => mudar({ de: DIAS_ATRAS(dias), ate: HOJE() })}
                      className={`text-[12.5px] px-2.5 py-1 rounded-[8px] border-0 cursor-pointer transition-colors
                        ${ativo
                          ? 'bg-superficie text-primario font-medium shadow-[0_1px_3px_rgba(10,14,20,0.12)]'
                          : 'bg-transparent text-secundario hover:text-primario'}`}
                    >
                      {rotulo}
                    </button>
                  );
                })}
              </div>

              <span className="relative flex-1 min-w-[180px] max-w-[300px]">
                <Icone
                  nome="busca"
                  className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-tenue pointer-events-none"
                />
                <input
                  type="search"
                  placeholder="Nome, e-mail, contato ou curso…"
                  aria-label="Buscar no registro"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  className="w-full bg-superficie text-primario border border-borda-forte rounded-[9px]
                             pl-8 pr-2.5 py-[6px] text-[13px] hover:border-azul-400/50 transition-colors"
                />
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
              <MultiSelect
                rotulo="Tipo de curso (nível de ensino)"
                rotuloVazio="Todos os níveis"
                valores={filtro.nivel}
                aoTrocar={(v) => mudar({ nivel: v, curso: [] })}
                opcoes={(opcoes.niveis ?? []).map((n) => [n, n === '—' ? 'Não identificado' : n])}
              />
              <MultiSelect
                rotulo="Curso"
                rotuloVazio="Todos os cursos"
                valores={filtro.curso}
                aoTrocar={(v) => mudar({ curso: v })}
                opcoes={cursosVisiveis.map((c) => [c.nome, c.nome === '—' ? 'Não identificado' : c.nome])}
              />
              <MultiSelect
                rotulo="Oferta"
                rotuloVazio="Todas as ofertas"
                valores={filtro.oferta}
                aoTrocar={(v) => mudar({ oferta: v })}
                opcoes={ofertasVisiveis.map((o) => [o.codigo, o.nome])}
              />
              <MultiSelect
                rotulo="Evento"
                rotuloVazio="Todos os eventos"
                valores={filtro.evento}
                aoTrocar={(v) => mudar({ evento: v })}
                opcoes={(opcoes.eventos ?? []).map((e) => [e.id, e.rotulo])}
              />
              <MultiSelect
                rotulo="Processo do Rubeus"
                rotuloVazio="Todos os processos"
                valores={filtro.processo}
                aoTrocar={(v) => mudar({ processo: v })}
                opcoes={(opcoes.processos ?? []).map((p) => [p.id, p.nome])}
              />
              <MultiSelect
                rotulo="Situação no painel"
                rotuloVazio="Todas as situações"
                valores={filtro.status}
                aoTrocar={(v) => mudar({ status: v })}
                opcoes={Object.entries(ROTULO_STATUS)}
              />
              <MultiSelect
                rotulo="Veredito do Google"
                rotuloVazio="Qualquer veredito"
                valores={filtro.diagnostico}
                aoTrocar={(v) => mudar({ diagnostico: v })}
                opcoes={Object.entries(ROTULO_DIAGNOSTICO)}
              />
              <MultiSelect
                rotulo="Ação de conversão"
                rotuloVazio="Todas as ações"
                valores={filtro.acao}
                aoTrocar={(v) => mudar({ acao: v })}
                opcoes={(opcoes.acoes ?? []).map((a) => [a.id, a.nome])}
              />
              <Select
                rotulo="Atribuição"
                valor={filtro.atribuicao}
                aoTrocar={(v) => mudar({ atribuicao: v })}
                opcoes={ATRIBUICOES}
                className="w-full"
              />
              <Select
                rotulo="Modo"
                valor={filtro.modo}
                aoTrocar={(v) => mudar({ modo: v })}
                opcoes={[['', 'Teste e real'], ['real', 'Só modo real'], ['teste', 'Só modo teste']]}
                className="w-full"
              />
            </div>
          </Cartao>

          {monitor.erro && (
            <Cartao>
              <Estado tipo="erro" titulo="Não foi possível carregar o monitor" mensagem={monitor.erro} />
            </Cartao>
          )}

          {monitor.carregando && !d && <EsqueletoPagina kpis={6} graficos={aba === 'resumo' ? 2 : 0} />}

          {/* ------------------------------------------------------------ KPIs */}
          {d && (
            <Atualizando ativo={monitor.atualizando}>
              <div className="grid gap-3 grade-kpi cascata">
                <CartaoKpi
                  rotulo="Conversões no período"
                  valor={total}
                  fmt={fmtInt}
                  icone="camadas"
                  dica="Todas as conversões que o painel decidiu no período — tentadas, enviadas ou não."
                />
                <CartaoKpi
                  rotulo="Entregues ao Google"
                  valor={Number(g.enviadas) || 0}
                  fmt={fmtInt}
                  icone="enviar"
                  tom={Number(g.enviadas) > 0 ? 'sucesso' : 'neutro'}
                  dica="Conversões que saíram do painel e foram aceitas na chamada à API do Google."
                >
                  {total > 0 && (
                    <BarraProporcao
                      pct={(Number(g.enviadas) / total) * 100}
                      tom="sucesso"
                      dica={`${fmtPct((Number(g.enviadas) / total) * 100)} do total do período`}
                    />
                  )}
                </CartaoKpi>
                <CartaoKpi
                  rotulo="Valor entregue"
                  valor={Number(g.valor_enviado) || 0}
                  fmt={fmtBRL}
                  icone="dinheiro"
                  dica="Soma do valor das conversões entregues ao Google."
                />
                <CartaoKpi
                  rotulo="Atribuição por clique"
                  valor={atribuidos ? (comClique / atribuidos) * 100 : 0}
                  fmt={fmtPct}
                  icone="clique"
                  tom={comClique > 0 ? 'sucesso' : 'atencao'}
                  dica="Das conversões atribuídas, quantas foram ligadas ao clique exato (gclid) em vez de e-mail ou telefone em hash."
                >
                  <span className="text-[12.5px] text-secundario tnum">
                    {fmtInt(comClique)} por gclid · {fmtInt(comHash)} por e-mail/telefone
                  </span>
                </CartaoKpi>
                <CartaoKpi
                  rotulo="Não atribuídas"
                  valor={Number(g.sem_identificador) || 0}
                  fmt={fmtInt}
                  icone="alerta"
                  tom={Number(g.sem_identificador) > 0 ? 'atencao' : 'neutro'}
                  dica="Sem gclid e sem e-mail: não há nada para ligar a um clique."
                />
                <CartaoKpi
                  rotulo="Recusadas"
                  valor={recusadas}
                  fmt={fmtInt}
                  icone="x"
                  tom={recusadas > 0 ? 'perigo' : 'neutro'}
                  dica="Recusadas pela API na chamada, somadas às que o Google descartou no processamento."
                >
                  <span className="text-[12.5px] text-secundario tnum">
                    {fmtInt(g.recusadas)} na chamada · {fmtInt(g.google_falhou)} no processamento
                  </span>
                </CartaoKpi>
              </div>
            </Atualizando>
          )}

          {/* ------------------------------------------------------ as abas */}
          {aba === 'resumo' && d && (
            <Atualizando key="resumo" ativo={monitor.atualizando} className="flex flex-col gap-4 animate-surgir">
              <AbaResumo d={d} serie={serie} />
            </Atualizando>
          )}

          {aba === 'diagnostico' && d && (
            <Atualizando key="diagnostico" ativo={monitor.atualizando} className="flex flex-col gap-4 animate-surgir">
              <AbaDiagnostico d={d} g={g} aoConcluir={recarregar} />
            </Atualizando>
          )}

          {aba === 'envios' && (
            <div key="envios" className="animate-surgir">
              <Cartao>
                <TituloSecao
                  titulo={
                    <>
                      Registro de envios
                      {registro.dados && (
                        <span className="text-secundario font-normal tnum">
                          {' '}· {fmtInt(registro.dados.total)}{' '}
                          {registro.dados.total === 1 ? 'conversão' : 'conversões'}
                        </span>
                      )}
                    </>
                  }
                  icone="lista"
                  dica="Tudo que o painel decidiu sobre uma conversão — inclusive o que não foi enviado, e o motivo. A coluna “Google” é o veredito do processamento, que chega cerca de 30 min depois do envio. Clique numa linha para ver os detalhes."
                  extra={
                    <Paginacao
                      pagina={pagina}
                      limite={registro.dados?.limite ?? 50}
                      total={registro.dados?.total ?? 0}
                      aoTrocar={setPagina}
                    />
                  }
                />

                {registro.carregando && !registro.dados && <Esqueleto linhas={5} />}
                {registro.erro && <Estado tipo="erro" titulo="Falha ao carregar" mensagem={registro.erro} />}
                {registro.dados && !registro.dados.itens.length && (
                  <Estado
                    titulo="Nada nesta janela"
                    mensagem="Nenhuma conversão bate com os filtros. Amplie o período ou limpe os filtros."
                  />
                )}

                {registro.dados?.itens?.length > 0 && (
                  <Atualizando ativo={registro.atualizando}>
                    <div className="overflow-x-auto">
                      <table className="tabela w-full">
                        <thead>
                          <tr>
                            <th>Quando</th>
                            <th>Lead</th>
                            <th>Curso / nível</th>
                            <th>Etapa → evento</th>
                            <th className="text-right">Valor</th>
                            <th>Atribuição</th>
                            <th>Painel</th>
                            <th>Google</th>
                          </tr>
                        </thead>
                        <tbody>
                          {registro.dados.itens.map((l) => (
                            <Linha
                              key={l.id}
                              l={l}
                              aberta={aberta === l.id}
                              aoAbrir={() => setAberta(aberta === l.id ? null : l.id)}
                              aoReenviar={recarregar}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Atualizando>
                )}
              </Cartao>
            </div>
          )}
        </>
      )}
    </>
  );
}

/** Aba Resumo: volume por dia, por curso, por oferta e por evento. */
function AbaResumo({ d, serie }) {
  const porEvento = d.por_evento ?? [];
  return (
    <>
      {/* ------------------------------------------------------- gráficos */}
      {serie.length > 1 && (
        <GraficoBarras
          titulo="Conversões por dia"
          dica="Pela data do evento no Rubeus, que é como o Google Ads também as datará."
          dados={serie}
          chave="total"
          fmt={fmtInt}
          fmtEixo={fmtInt}
          fmtRotulo={fmtDiaMes}
          legenda="média por dia"
          unidade="conversões"
        />
      )}

      <Secao titulo="Por curso" icone="capelo">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
          <Ranking
            titulo="Por tipo de curso"
            subtitulo="Nível de ensino — é ele que escolhe a ação de conversão"
            itens={(d.por_nivel ?? []).map((n) => ({
              ...n,
              nivel: n.nivel === '—' ? 'Não identificado' : n.nivel,
            }))}
            rotulo="nivel"
            valor="total"
            fmt={fmtInt}
          />
          <Ranking
            titulo="Por curso"
            subtitulo="Os 40 com mais conversões na janela filtrada"
            itens={(d.por_curso ?? []).slice(0, 12).map((cur) => ({
              ...cur,
              curso: cur.curso === '—' ? 'Não identificado' : cur.curso,
            }))}
            rotulo="curso"
            valor="total"
            fmt={fmtInt}
          />
        </div>
      </Secao>

      {/*
        * Ofertas do mesmo curso lado a lado.
        *
        * O ranking por curso responde "o que vende"; este responde "qual
        * turma vende" — e é ele que diz onde colocar verba, porque é a
        * oferta que tem preço, data e vaga própria.
        */}
      {(d.por_oferta ?? []).length > 0 && (
        <Cartao>
          <TituloSecao
            titulo="Por oferta"
            icone="etiqueta"
            dica="Turmas do mesmo curso competem aqui — cada uma com seu preço."
            extra={
              <span className="tnum">
                {fmtInt(d.por_oferta.length)} oferta(s) com conversão
              </span>
            }
          />
          <div className="overflow-x-auto">
            <table className="tabela w-full">
              <thead>
                <tr>
                  <th>Oferta</th>
                  <th>Curso</th>
                  <th className="text-right">Conversões</th>
                  <th className="text-right">Entregues</th>
                  <th className="text-right">Inscrição</th>
                  <th className="text-right">Total do curso</th>
                  <th className="text-right">Valor enviado</th>
                </tr>
              </thead>
              <tbody>
                {d.por_oferta.map((o) => (
                  <tr key={`${o.codigo}-${o.oferta}`}>
                    <td>
                      <Dica conteudo={o.oferta}>
                        <span className="block truncate max-w-[220px]">{o.oferta}</span>
                      </Dica>
                      {o.codigo && (
                        <div className="text-[12px] text-tenue font-mono">{o.codigo}</div>
                      )}
                    </td>
                    <td className="text-secundario">
                      <Dica conteudo={o.curso}>
                        <span className="block truncate max-w-[180px]">{o.curso}</span>
                      </Dica>
                    </td>
                    <td className="text-right tnum">{fmtInt(o.total)}</td>
                    <td className="text-right tnum">{fmtInt(o.enviadas)}</td>
                    <td className="text-right tnum text-secundario">
                      {o.preco_inscricao != null ? fmtBRL(o.preco_inscricao) : '—'}
                    </td>
                    <td className="text-right tnum text-secundario">
                      {o.preco_total != null ? fmtBRL(o.preco_total) : '—'}
                    </td>
                    <td className="text-right tnum font-semibold">
                      {fmtBRL(Number(o.valor) || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Cartao>
      )}

      <Cartao>
        <TituloSecao
          titulo="Por evento"
          icone="raio"
          dica="Quantas conversões de cada evento houve no período, e quantas delas chegaram ao Google."
        />
        <div className="flex flex-col gap-3 cascata">
          {porEvento.map((e) => {
            const tot = Number(e.total) || 0;
            const env = Number(e.enviadas) || 0;
            return (
              <div key={e.evento} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 flex-wrap text-[13.5px]">
                  <span className="font-semibold mr-auto">{ROTULO_EVENTO[e.evento] ?? e.evento}</span>
                  <Pill>{fmtInt(e.total)} no total</Pill>
                  <Pill ponto tom={env > 0 ? 'sucesso' : 'neutro'}>{fmtInt(e.enviadas)} entregues</Pill>
                  <span className="text-secundario tnum font-medium">{fmtBRL(Number(e.valor) || 0)}</span>
                </div>
                <BarraProporcao
                  pct={tot ? (env / tot) * 100 : 0}
                  tom="sucesso"
                  altura="h-1.5"
                  dica={tot ? `${fmtPct((env / tot) * 100)} entregues ao Google` : 'Sem conversões'}
                />
              </div>
            );
          })}
          {!porEvento.length && <Estado mensagem="Nenhuma conversão nesta janela." />}
        </div>
      </Cartao>
    </>
  );
}

/** Aba Diagnóstico: o veredito do Google e as últimas requisições. */
function AbaDiagnostico({ d, g, aoConcluir }) {
  const requisicoes = d.requisicoes ?? [];
  return (
    <>
      {/* --------------------------------------------- veredito do Google */}
      <Secao
        titulo="O que o Google fez com o que recebeu"
        icone="escudo"
        dica="Aceitar a requisição não é contabilizar a conversão. O veredito real sai no diagnóstico da Data Manager API, cerca de 30 minutos depois — e é ele que diz se o e-mail em hash casou com alguém. Modo teste não gera diagnóstico: o Google valida e descarta sem processar."
        extra={<AcaoDiagnostico aoConcluir={aoConcluir} />}
      >
        <div className="grid gap-3 grade-kpi cascata">
          <CartaoKpi
            compacto
            rotulo="Processadas"
            valor={Number(g.google_ok) || 0}
            fmt={fmtInt}
            icone="checkCirculo"
            tom={Number(g.google_ok) > 0 ? 'sucesso' : 'neutro'}
            dica="O Google processou e contabilizou."
          />
          <CartaoKpi
            compacto
            rotulo="Aproveitadas em parte"
            valor={Number(g.google_parcial) || 0}
            fmt={fmtInt}
            icone="alerta"
            tom={Number(g.google_parcial) > 0 ? 'atencao' : 'neutro'}
            dica="Parte dos registros da requisição foi aproveitada; o resto voltou com motivo."
          />
          <CartaoKpi
            compacto
            rotulo="Descartadas"
            valor={Number(g.google_falhou) || 0}
            fmt={fmtInt}
            icone="x"
            tom={Number(g.google_falhou) > 0 ? 'perigo' : 'neutro'}
            dica="O Google aceitou a chamada, mas descartou no processamento."
          />
          <CartaoKpi
            compacto
            rotulo="Aguardando veredito"
            valor={Number(g.google_aguardando) || 0}
            fmt={fmtInt}
            icone="relogio"
            tom="neutro"
            dica="Enviadas e ainda sem diagnóstico — ele chega cerca de 30 minutos depois do envio."
          />
        </div>
      </Secao>

      <Cartao>
        <TituloSecao
          titulo="Últimas requisições à Data Manager API"
          icone="enviar"
          extra={requisicoes.length > 0 && <span className="tnum">{fmtInt(requisicoes.length)}</span>}
        />
        {requisicoes.length === 0 ? (
          <Estado mensagem="Nenhuma requisição nesta janela." />
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela w-full">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Ação</th>
                  <th className="text-right">Eventos</th>
                  <th>Veredito</th>
                  <th>Motivos</th>
                </tr>
              </thead>
              <tbody>
                {requisicoes.map((r) => {
                  const texto = motivos(r.erros) || motivos(r.avisos);
                  return (
                    <tr key={r.request_id} className="align-top">
                      <td className="whitespace-nowrap text-secundario tnum">
                        <Dica conteudo={dataCompleta(r.criado_em)}>
                          <span>{fmtDataHora(r.criado_em)}</span>
                        </Dica>
                      </td>
                      <td>
                        <span className="flex items-center gap-2 min-w-0">
                          <Dica conteudo={r.conversion_action_nome}>
                            <span className="block truncate max-w-[220px]">{r.conversion_action_nome || '—'}</span>
                          </Dica>
                          {r.modo === 'teste' && <Pill>teste</Pill>}
                        </span>
                      </td>
                      <td className="text-right tnum">{fmtInt(r.eventos)}</td>
                      <td>
                        <Pill ponto tom={TOM_DIAGNOSTICO[r.status] ?? 'neutro'}>
                          {ROTULO_DIAGNOSTICO[r.status] ?? r.status ?? 'aguardando'}
                        </Pill>
                      </td>
                      <td className="text-secundario">
                        {texto ? (
                          <Dica conteudo={texto} largura={360}>
                            <span className="block truncate max-w-[280px]">{texto}</span>
                          </Dica>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>
    </>
  );
}

/** Lê a lista JSON de motivos que o Google devolve no diagnóstico. */
function motivos(bruto) {
  if (!bruto) return '';
  try {
    const lista = JSON.parse(bruto);
    if (!Array.isArray(lista) || !lista.length) return '';
    return lista.map((x) => `${x.motivo} (${x.registros})`).join(', ');
  } catch {
    return String(bruto).slice(0, 120);
  }
}

function Paginacao({ pagina, limite, total, aoTrocar }) {
  const paginas = Math.ceil(total / limite) || 1;
  if (paginas <= 1) return null;
  return (
    <div className="flex items-center gap-2">
      <Botao
        tamanho="sm"
        icone="chevronEsquerda"
        disabled={pagina === 0}
        onClick={() => aoTrocar(pagina - 1)}
        aria-label="Página anterior"
      >
        <span className="hidden sm:inline">Anterior</span>
      </Botao>
      <span className="text-secundario tnum text-[13px]">
        {pagina + 1} de {paginas}
      </span>
      <Botao
        tamanho="sm"
        disabled={pagina + 1 >= paginas}
        onClick={() => aoTrocar(pagina + 1)}
        aria-label="Próxima página"
      >
        <span className="hidden sm:inline">Próxima</span>
        <Icone nome="chevronDireita" className="w-4 h-4" />
      </Botao>
    </div>
  );
}

/**
 * Uma linha do registro, com detalhe que abre.
 *
 * O detalhe existe porque o que explica uma conversão recusada — a mensagem do
 * Google, o aviso de campo, o requestId — é longo demais para caber na tabela e
 * curto demais para justificar outra tela. Fica dobrado até alguém precisar.
 * A pílula de situação já adianta o motivo na dica, para quem só quer saber
 * "por quê" sem abrir a linha.
 */
function Linha({ l, aberta, aoAbrir, aoReenviar }) {
  const quando = l.ocorrido_em || l.criado_em;
  return (
    <>
      <tr
        className={`align-top cursor-pointer transition-colors ${aberta ? '!bg-azul-50' : ''}`}
        onClick={aoAbrir}
        aria-expanded={aberta}
      >
        <td className="whitespace-nowrap text-secundario tnum">
          <span className="flex items-start gap-1.5">
            <SetaSanfona aberta={aberta} className="mt-[3px]" />
            <span>
              <Dica conteudo={dataCompleta(quando)}>
                <span>{fmtDataHora(quando)}</span>
              </Dica>
              {l.modo === 'teste' && (
                <span className="block mt-1">
                  <Pill>modo teste</Pill>
                </span>
              )}
            </span>
          </span>
        </td>
        <td className="min-w-[140px]">
          <Dica conteudo={l.contato_nome || l.contato_id}>
            <span className="block truncate max-w-[190px] font-medium">{l.contato_nome || l.contato_id}</span>
          </Dica>
          {l.email && (
            <Dica conteudo={l.email}>
              <span className="block text-[12px] text-tenue truncate max-w-[190px]">{l.email}</span>
            </Dica>
          )}
        </td>
        <td className="min-w-[130px]">
          <Dica conteudo={l.curso_nome}>
            <span className="block truncate max-w-[180px]">{l.curso_nome || '—'}</span>
          </Dica>
          <div className="text-[12px] text-tenue truncate max-w-[180px]">{l.nivel_ensino || '—'}</div>
        </td>
        <td>
          <Dica conteudo={l.etapa}>
            <span className="block truncate max-w-[170px]">{l.etapa}</span>
          </Dica>
          <div className="text-[12px] text-tenue">{ROTULO_EVENTO[l.evento] ?? l.evento}</div>
        </td>
        <td className="tnum whitespace-nowrap text-right font-medium">
          {l.valor != null ? fmtBRL(Number(l.valor)) : '—'}
        </td>
        <td className="text-secundario whitespace-nowrap">
          {l.click_id_tipo ? (
            <span className="inline-flex items-center gap-1 text-sucesso font-medium">
              <Icone nome="clique" className="w-3.5 h-3.5" />
              {l.click_id_tipo}
            </span>
          ) : (
            descreverIdentificadores(l.identificadores) || '—'
          )}
        </td>
        <td>
          <Pill
            ponto
            tom={TOM_STATUS[l.status] ?? 'neutro'}
            dica={l.erro_detalhe ? `Motivo: ${l.erro_detalhe}` : undefined}
          >
            {ROTULO_STATUS[l.status] ?? l.status}
          </Pill>
        </td>
        <td>
          {l.diagnostico ? (
            <Pill
              ponto
              tom={TOM_DIAGNOSTICO[l.diagnostico] ?? 'neutro'}
              dica={l.avisos ? `Avisos do Google: ${l.avisos}` : undefined}
            >
              {ROTULO_DIAGNOSTICO[l.diagnostico] ?? l.diagnostico}
            </Pill>
          ) : l.request_id ? (
            <Pill ponto dica="Enviada; o veredito do Google chega cerca de 30 minutos depois.">aguardando</Pill>
          ) : (
            <span className="text-tenue">—</span>
          )}
        </td>
      </tr>

      {aberta && (
        <tr className="!bg-elevado/50 hover:!bg-elevado/50">
          <td colSpan={8} className="!px-4 !py-4">
            <div className="animate-surgir">
              <dl className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-[13px] m-0">
                <Campo rotulo="Order ID (deduplicação)" valor={l.order_id} mono />
                <Campo rotulo="Request ID (Data Manager)" valor={l.request_id} mono />
                <Campo rotulo="Ação de conversão" valor={l.conversion_action_nome || l.conversion_action_id} />
                <Campo rotulo="Processo" valor={l.processo_nome || l.processo_id} />
                <Campo rotulo="Telefone" valor={l.telefone} />
                <Campo rotulo="Identificadores usados" valor={l.identificadores} />
                <Campo rotulo="Tentativas" valor={l.tentativas} />
                <Campo rotulo="Enviado em" valor={l.enviado_em ? fmtDataHora(l.enviado_em) : null} />
                <Campo
                  rotulo="Veredito em"
                  valor={l.diagnostico_em ? fmtDataHora(l.diagnostico_em) : null}
                />
                <Campo rotulo="Cópia na planilha" valor={l.backup_em ? fmtDataHora(l.backup_em) : 'ainda não'} />
              </dl>

              {l.erro_detalhe && (
                <div className="mt-3 flex items-start gap-2 text-[13px] text-perigo leading-relaxed max-w-[760px]
                                rounded-[10px] bg-perigo/8 border border-perigo/20 px-3 py-2">
                  <Icone nome="alerta" className="w-4 h-4 shrink-0 mt-[2px]" />
                  <span><strong>Motivo:</strong> {l.erro_detalhe}</span>
                </div>
              )}
              {l.avisos && (
                <div className="mt-2 flex items-start gap-2 text-[13px] text-atencao leading-relaxed max-w-[760px]
                                rounded-[10px] bg-atencao/8 border border-atencao/20 px-3 py-2">
                  <Icone nome="info" className="w-4 h-4 shrink-0 mt-[2px]" />
                  <span><strong>Avisos do Google:</strong> {l.avisos}</span>
                </div>
              )}

              {l.status !== 'enviada' && (
                <div className="mt-3">
                  <BotaoReenviar id={l.id} aoConcluir={aoReenviar} />
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Campo({ rotulo, valor, mono = false }) {
  const vazio = valor === null || valor === undefined || valor === '';
  const texto = vazio ? '—' : String(valor);
  return (
    <div className="min-w-0">
      <dt className="text-tenue text-[12px] font-medium">{rotulo}</dt>
      <dd className="m-0 min-w-0">
        <Dica conteudo={vazio ? null : texto} largura={360}>
          <span className={`block truncate ${mono ? 'font-mono text-[12.5px]' : ''}`}>{texto}</span>
        </Dica>
      </dd>
    </div>
  );
}

/**
 * Botão com estado próprio — o mesmo padrão da tela de configuração.
 *
 * O giro do `Botao` desabilita durante a chamada, o que impede o clique duplo
 * que mandaria a mesma conversão duas vezes. A resposta fica ao lado, visível:
 * é resultado de uma ação que a pessoa acabou de pedir.
 */
function BotaoAcao({ children, aoClicar, titulo, icone }) {
  const [estado, setEstado] = useState('pronto');
  const [msg, setMsg] = useState('');

  const rodar = async (e) => {
    e.stopPropagation();
    setEstado('rodando');
    setMsg('');
    try {
      const r = await aoClicar();
      setEstado('ok');
      if (typeof r === 'string') setMsg(r);
      setTimeout(() => setEstado('pronto'), 4000);
    } catch (erro) {
      setEstado('erro');
      setMsg(erro.message);
    }
  };

  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <Dica conteudo={titulo}>
        <Botao
          tamanho="sm"
          variante={estado === 'erro' ? 'perigo' : 'secundario'}
          icone={estado === 'ok' ? 'check' : icone}
          carregando={estado === 'rodando'}
          onClick={rodar}
          className={estado === 'ok' ? '!text-sucesso !border-sucesso/40 !bg-sucesso/12' : ''}
        >
          {estado === 'rodando' ? 'Aguarde…' : estado === 'ok' ? 'Feito' : children}
        </Botao>
      </Dica>
      {msg && (
        <span
          className={`text-[12.5px] max-w-[360px] leading-snug animate-aparecer
            ${estado === 'erro' ? 'text-perigo' : 'text-secundario'}`}
        >
          {msg}
        </span>
      )}
    </span>
  );
}

async function chamar(rota) {
  const r = await fetch(rota, { method: 'POST', headers: { Accept: 'application/json' } });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.detalhe || dados.erro || `servidor respondeu ${r.status}`);
  // Gravou: o cache das rotas de conversão já não é verdade.
  invalidar('/api/conversoes');
  return dados;
}

function BotaoReenviar({ id, aoConcluir }) {
  return (
    <BotaoAcao
      titulo="Devolve esta conversão à fila e tenta agora"
      icone="atualizar"
      aoClicar={async () => {
        const r = await chamar(`/api/conversoes/registro/${id}/reenviar`);
        aoConcluir();
        return r.processado
          ? `${r.enviadas ?? 0} enviada(s), ${r.falhas ?? 0} falha(s).`
          : r.detalhe;
      }}
    >
      Reenviar esta conversão
    </BotaoAcao>
  );
}

function AcaoDiagnostico({ aoConcluir }) {
  return (
    <BotaoAcao
      titulo="Consulta o resultado do processamento das requisições já enviadas"
      icone="atualizar"
      aoClicar={async () => {
        const r = await chamar('/api/conversoes/diagnosticos');
        aoConcluir();
        return r.consultadas
          ? `${r.consultadas} requisição(ões) consultada(s), ${r.concluidas} com veredito.`
          : 'Nenhuma requisição aguardando veredito agora.';
      }}
    >
      Conferir veredito agora
    </BotaoAcao>
  );
}
