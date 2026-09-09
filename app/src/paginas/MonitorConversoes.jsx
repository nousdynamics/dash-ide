import { useCallback, useEffect, useMemo, useState } from 'react';
import { Cartao, Estado, Esqueleto, MultiSelect, Pill, Select } from '../componentes/base';
import { GraficoBarras, Ranking } from '../componentes/Graficos';
import { useApi } from '../lib/api';
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
  for (const k of ['status', 'evento', 'nivel', 'curso', 'processo', 'acao', 'diagnostico']) {
    for (const v of f[k] ?? []) p.append(k, v);
  }
  if (f.modo) p.set('modo', f.modo);
  if (f.atribuicao) p.set('atribuicao', f.atribuicao);
  if (f.q?.trim()) p.set('q', f.q.trim());
  return p.toString();
}

function Kpi({ rotulo, valor, detalhe, tom = 'neutro' }) {
  const cor = {
    sucesso: 'text-sucesso',
    atencao: 'text-atencao',
    perigo: 'text-perigo',
    neutro: 'text-primario',
  }[tom];
  return (
    <div className="rounded-[10px] border border-borda bg-elevado/60 px-3 py-2.5 min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-tenue truncate">
        {rotulo}
      </div>
      <div className={`text-[19px] font-semibold tnum mt-0.5 ${cor}`}>{valor}</div>
      {detalhe && <div className="text-[10px] text-tenue mt-0.5 leading-snug">{detalhe}</div>}
    </div>
  );
}

export function MonitorConversoes() {
  const [filtro, setFiltro] = useState(FILTRO_INICIAL);
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(0);
  const [versao, setVersao] = useState(0);
  const [aberta, setAberta] = useState(null);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

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

  const monitor = useApi(`/api/conversoes/monitor?${qs}`, `monitor-${qs}-${versao}`);
  const registro = useApi(
    `/api/conversoes/registro?${qs}&limite=50&pagina=${pagina}`,
    `registro-${qs}-${pagina}-${versao}`,
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

  const serie = useMemo(
    () => densificarPorDia(d?.por_dia ?? [], filtro.de, filtro.ate),
    [d?.por_dia, filtro.de, filtro.ate],
  );

  const total = Number(g.total) || 0;
  const comClique = Number(g.com_clique) || 0;
  const comHash = Number(g.com_hash) || 0;
  const atribuidos = comClique + comHash;

  const mudar = (mudanca) => setFiltro((f) => ({ ...f, ...mudanca }));

  const limpar = () => {
    setBusca('');
    setFiltro(FILTRO_INICIAL());
  };

  const filtrosAtivos =
    filtro.status.length + filtro.evento.length + filtro.nivel.length + filtro.curso.length
    + filtro.processo.length + filtro.acao.length + filtro.diagnostico.length
    + (filtro.modo ? 1 : 0) + (filtro.atribuicao ? 1 : 0) + (filtro.q ? 1 : 0);

  return (
    <>
      <Cartao>
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">Monitor de conversões enviadas</div>
            <div className="text-[11px] text-tenue mt-1 max-w-[640px] leading-relaxed">
              Tudo que o painel decidiu sobre uma conversão — inclusive o que{' '}
              <strong className="text-secundario">não</strong> foi enviado, e o motivo. A coluna
              “Google” é o veredito do processamento, que chega cerca de 30 min depois do envio.
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {filtrosAtivos > 0 && (
              <button
                type="button"
                onClick={limpar}
                className="text-[11px] px-2 py-[5px] rounded-[8px] border border-borda-forte
                           bg-superficie text-secundario hover:bg-superficie-hover hover:text-primario cursor-pointer"
              >
                Limpar filtros ({filtrosAtivos})
              </button>
            )}
            <a
              href={`/api/conversoes/registro.csv?${qs}`}
              className="text-[11px] px-2 py-[5px] rounded-[8px] border border-borda-forte
                         bg-superficie text-secundario no-underline hover:bg-superficie-hover hover:text-primario"
            >
              Baixar CSV
            </a>
          </div>
        </div>

        {/* ----------------------------------------------------------- filtros */}
        <div className="flex items-center gap-2 flex-wrap pb-3 mb-3 border-b border-borda">
          <input
            type="date"
            aria-label="Data inicial"
            value={filtro.de}
            max={filtro.ate}
            onChange={(e) => mudar({ de: e.target.value })}
            className="bg-superficie text-primario border border-borda-forte rounded-[8px] px-2 py-[5px] text-xs"
          />
          <span className="text-tenue text-[11px]">até</span>
          <input
            type="date"
            aria-label="Data final"
            value={filtro.ate}
            min={filtro.de}
            onChange={(e) => mudar({ ate: e.target.value })}
            className="bg-superficie text-primario border border-borda-forte rounded-[8px] px-2 py-[5px] text-xs"
          />
          {ATALHOS.map(([rotulo, dias]) => (
            <button
              key={dias}
              type="button"
              onClick={() => mudar({ de: DIAS_ATRAS(dias), ate: HOJE() })}
              className="text-[11px] px-2 py-[5px] rounded-[8px] border border-borda bg-transparent
                         text-tenue hover:text-primario hover:bg-superficie-hover cursor-pointer"
            >
              {rotulo}
            </button>
          ))}

          <input
            type="search"
            placeholder="Nome, e-mail, contato ou curso…"
            aria-label="Buscar no registro"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="bg-superficie text-primario border border-borda-forte rounded-[8px]
                       px-2 py-[5px] text-xs min-w-[180px] flex-1 max-w-[280px]"
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
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

      {monitor.carregando && !d && <Esqueleto linhas={4} />}

      {d && (
        <>
          {/* ------------------------------------------------------------ KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            <Kpi rotulo="Conversões no período" valor={fmtInt(total)} detalhe="tentadas, enviadas ou não" />
            <Kpi
              rotulo="Entregues ao Google"
              valor={fmtInt(g.enviadas)}
              tom={Number(g.enviadas) > 0 ? 'sucesso' : 'neutro'}
              detalhe={total ? `${fmtPct((Number(g.enviadas) / total) * 100)} do total` : null}
            />
            <Kpi
              rotulo="Valor entregue"
              valor={fmtBRL(Number(g.valor_enviado) || 0)}
              detalhe="soma do valor das entregues"
            />
            <Kpi
              rotulo="Atribuição por clique"
              valor={fmtPct(atribuidos ? (comClique / atribuidos) * 100 : 0)}
              tom={comClique > 0 ? 'sucesso' : 'atencao'}
              detalhe={`${fmtInt(comClique)} por gclid · ${fmtInt(comHash)} por e-mail/telefone`}
            />
            <Kpi
              rotulo="Não atribuídas"
              valor={fmtInt(g.sem_identificador)}
              tom={Number(g.sem_identificador) > 0 ? 'atencao' : 'neutro'}
              detalhe="sem gclid e sem e-mail: nada a ligar a um clique"
            />
            <Kpi
              rotulo="Recusadas"
              valor={fmtInt((Number(g.recusadas) || 0) + (Number(g.google_falhou) || 0))}
              tom={
                (Number(g.recusadas) || 0) + (Number(g.google_falhou) || 0) > 0 ? 'perigo' : 'neutro'
              }
              detalhe={`${fmtInt(g.recusadas)} na chamada · ${fmtInt(g.google_falhou)} no processamento`}
            />
          </div>

          {/* --------------------------------------------- veredito do Google */}
          <Cartao>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold">O que o Google fez com o que recebeu</div>
                <div className="text-[11px] text-tenue mt-1 max-w-[620px] leading-relaxed">
                  Aceitar a requisição não é contabilizar a conversão. O veredito real sai no
                  diagnóstico da Data Manager API, cerca de 30 minutos depois — e é ele que diz se o
                  e-mail em hash casou com alguém.{' '}
                  <strong className="text-secundario">Modo teste não gera diagnóstico</strong>: o
                  Google valida e descarta sem processar.
                </div>
              </div>
              <span className="shrink-0">
                <AcaoDiagnostico aoConcluir={recarregar} />
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap mt-3 pt-3 border-t border-borda">
              <Pill tom={Number(g.google_ok) > 0 ? 'sucesso' : 'neutro'}>
                {fmtInt(g.google_ok)} processadas
              </Pill>
              <Pill tom={Number(g.google_parcial) > 0 ? 'atencao' : 'neutro'}>
                {fmtInt(g.google_parcial)} aproveitadas em parte
              </Pill>
              <Pill tom={Number(g.google_falhou) > 0 ? 'perigo' : 'neutro'}>
                {fmtInt(g.google_falhou)} descartadas
              </Pill>
              <Pill>{fmtInt(g.google_aguardando)} aguardando veredito</Pill>
            </div>

            {(d.requisicoes ?? []).length > 0 && (
              <div className="mt-3 pt-3 border-t border-borda">
                <div className="text-[11px] font-semibold text-secundario mb-2">
                  Últimas requisições à Data Manager API
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] border-collapse">
                    <thead>
                      <tr className="text-tenue text-left">
                        <th className="py-1 pr-3 font-medium">Quando</th>
                        <th className="py-1 pr-3 font-medium">Ação</th>
                        <th className="py-1 pr-3 font-medium">Eventos</th>
                        <th className="py-1 pr-3 font-medium">Veredito</th>
                        <th className="py-1 pr-3 font-medium">Motivos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.requisicoes.map((r) => (
                        <tr key={r.request_id} className="border-t border-borda align-top">
                          <td className="py-1.5 pr-3 whitespace-nowrap text-tenue">
                            {fmtDataHora(r.criado_em)}
                          </td>
                          <td className="py-1.5 pr-3 truncate max-w-[200px]">
                            {r.conversion_action_nome || '—'}
                            {r.modo === 'teste' && (
                              <span className="text-tenue"> · teste</span>
                            )}
                          </td>
                          <td className="py-1.5 pr-3 tnum">{fmtInt(r.eventos)}</td>
                          <td className="py-1.5 pr-3">
                            <Pill tom={TOM_DIAGNOSTICO[r.status] ?? 'neutro'}>
                              {ROTULO_DIAGNOSTICO[r.status] ?? r.status ?? 'aguardando'}
                            </Pill>
                          </td>
                          <td className="py-1.5 pr-3 text-tenue max-w-[280px]">
                            {motivos(r.erros) || motivos(r.avisos) || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Cartao>

          {/* ------------------------------------------------------- gráficos */}
          {serie.length > 1 && (
            <GraficoBarras
              titulo="Conversões por dia"
              dados={serie}
              chave="total"
              fmt={fmtInt}
              fmtEixo={fmtInt}
              fmtRotulo={fmtDiaMes}
              legenda="Pela data do evento no Rubeus, que é como o Google Ads também as datará."
              unidade="conversões"
            />
          )}

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

          <Cartao>
            <div className="text-[13px] font-semibold mb-2">Por evento</div>
            <div className="flex flex-col gap-2">
              {(d.por_evento ?? []).map((e) => (
                <div key={e.evento} className="flex items-center gap-3 flex-wrap text-xs">
                  <span className="font-semibold min-w-[160px]">
                    {ROTULO_EVENTO[e.evento] ?? e.evento}
                  </span>
                  <Pill>{fmtInt(e.total)} no total</Pill>
                  <Pill tom={Number(e.enviadas) > 0 ? 'sucesso' : 'neutro'}>
                    {fmtInt(e.enviadas)} entregues
                  </Pill>
                  <span className="text-tenue tnum">{fmtBRL(Number(e.valor) || 0)}</span>
                </div>
              ))}
              {!(d.por_evento ?? []).length && (
                <Estado mensagem="Nenhuma conversão nesta janela." />
              )}
            </div>
          </Cartao>
        </>
      )}

      {/* --------------------------------------------------------- a tabela */}
      <Cartao>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
          <div className="text-[13px] font-semibold">
            Registro
            {registro.dados && (
              <span className="text-tenue font-normal">
                {' '}· {fmtInt(registro.dados.total)}{' '}
                {registro.dados.total === 1 ? 'conversão' : 'conversões'}
              </span>
            )}
          </div>
          <Paginacao
            pagina={pagina}
            limite={registro.dados?.limite ?? 50}
            total={registro.dados?.total ?? 0}
            aoTrocar={setPagina}
          />
        </div>

        {registro.carregando && !registro.dados && <Esqueleto linhas={3} />}
        {registro.erro && <Estado tipo="erro" titulo="Falha ao carregar" mensagem={registro.erro} />}
        {registro.dados && !registro.dados.itens.length && (
          <Estado
            titulo="Nada nesta janela"
            mensagem="Nenhuma conversão bate com os filtros. Amplie o período ou limpe os filtros."
          />
        )}

        {registro.dados?.itens?.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-tenue text-[11px] text-left">
                  <th className="py-1 pr-3 font-medium">Quando</th>
                  <th className="py-1 pr-3 font-medium">Lead</th>
                  <th className="py-1 pr-3 font-medium">Curso / nível</th>
                  <th className="py-1 pr-3 font-medium">Etapa → evento</th>
                  <th className="py-1 pr-3 font-medium">Valor</th>
                  <th className="py-1 pr-3 font-medium">Atribuição</th>
                  <th className="py-1 pr-3 font-medium">Painel</th>
                  <th className="py-1 pr-3 font-medium">Google</th>
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
    <div className="flex items-center gap-2 text-[11px]">
      <button
        type="button"
        disabled={pagina === 0}
        onClick={() => aoTrocar(pagina - 1)}
        className="px-2 py-[4px] rounded-[8px] border border-borda-forte bg-superficie text-secundario
                   hover:text-primario cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >
        ‹ Anterior
      </button>
      <span className="text-tenue tnum">
        {pagina + 1} de {paginas}
      </span>
      <button
        type="button"
        disabled={pagina + 1 >= paginas}
        onClick={() => aoTrocar(pagina + 1)}
        className="px-2 py-[4px] rounded-[8px] border border-borda-forte bg-superficie text-secundario
                   hover:text-primario cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Próxima ›
      </button>
    </div>
  );
}

/**
 * Uma linha do registro, com detalhe que abre.
 *
 * O detalhe existe porque o que explica uma conversão recusada — a mensagem do
 * Google, o aviso de campo, o requestId — é longo demais para caber na tabela e
 * curto demais para justificar outra tela. Fica dobrado até alguém precisar.
 */
function Linha({ l, aberta, aoAbrir, aoReenviar }) {
  return (
    <>
      <tr
        className={`border-t border-borda align-top cursor-pointer hover:bg-superficie-hover
                    ${aberta ? 'bg-superficie-hover' : ''}`}
        onClick={aoAbrir}
      >
        <td className="py-2 pr-3 whitespace-nowrap text-tenue">
          {fmtDataHora(l.ocorrido_em || l.criado_em)}
          {l.modo === 'teste' && <div className="text-[10px]">modo teste</div>}
        </td>
        <td className="py-2 pr-3 min-w-[140px]">
          <div className="truncate max-w-[190px]">{l.contato_nome || l.contato_id}</div>
          {l.email && <div className="text-[10px] text-tenue truncate max-w-[190px]">{l.email}</div>}
        </td>
        <td className="py-2 pr-3 min-w-[130px]">
          <div className="truncate max-w-[180px]">{l.curso_nome || '—'}</div>
          <div className="text-[10px] text-tenue truncate max-w-[180px]">{l.nivel_ensino || '—'}</div>
        </td>
        <td className="py-2 pr-3">
          <div className="truncate max-w-[170px]">{l.etapa}</div>
          <div className="text-[10px] text-tenue">{ROTULO_EVENTO[l.evento] ?? l.evento}</div>
        </td>
        <td className="py-2 pr-3 tnum whitespace-nowrap">
          {l.valor != null ? fmtBRL(Number(l.valor)) : '—'}
        </td>
        <td className="py-2 pr-3 text-tenue whitespace-nowrap">
          {l.click_id_tipo
            ? <span className="text-sucesso">{l.click_id_tipo}</span>
            : descreverIdentificadores(l.identificadores) || '—'}
        </td>
        <td className="py-2 pr-3">
          <Pill tom={TOM_STATUS[l.status] ?? 'neutro'}>{ROTULO_STATUS[l.status] ?? l.status}</Pill>
        </td>
        <td className="py-2 pr-3">
          {l.diagnostico ? (
            <Pill tom={TOM_DIAGNOSTICO[l.diagnostico] ?? 'neutro'}>
              {ROTULO_DIAGNOSTICO[l.diagnostico] ?? l.diagnostico}
            </Pill>
          ) : (
            <span className="text-[10px] text-tenue">
              {l.request_id ? 'aguardando' : '—'}
            </span>
          )}
        </td>
      </tr>

      {aberta && (
        <tr className="border-t border-borda/50 bg-elevado/40">
          <td colSpan={8} className="px-3 py-3">
            <dl className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 text-[11px]">
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
              <div className="mt-3 text-[11px] text-perigo leading-relaxed max-w-[720px]">
                <strong>Motivo:</strong> {l.erro_detalhe}
              </div>
            )}
            {l.avisos && (
              <div className="mt-2 text-[11px] text-atencao leading-relaxed max-w-[720px]">
                <strong>Avisos do Google:</strong> {l.avisos}
              </div>
            )}

            {l.status !== 'enviada' && (
              <div className="mt-3">
                <BotaoReenviar id={l.id} aoConcluir={aoReenviar} />
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function Campo({ rotulo, valor, mono = false }) {
  return (
    <div className="min-w-0">
      <dt className="text-tenue text-[10px] uppercase tracking-wide">{rotulo}</dt>
      <dd className={`truncate ${mono ? 'font-mono text-[10px]' : ''}`} title={valor ?? ''}>
        {valor === null || valor === undefined || valor === '' ? '—' : String(valor)}
      </dd>
    </div>
  );
}

/** Botão com estado próprio — o mesmo padrão da tela de configuração. */
function BotaoAcao({ children, aoClicar, titulo }) {
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

  const cor = estado === 'erro'
    ? 'border-perigo/40 bg-perigo/12 text-perigo'
    : estado === 'ok'
      ? 'border-sucesso/40 bg-sucesso/12 text-sucesso'
      : 'border-borda-forte bg-superficie text-secundario hover:bg-superficie-hover hover:text-primario';

  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <button
        type="button"
        title={titulo}
        onClick={rodar}
        disabled={estado === 'rodando'}
        className={`text-[11px] px-2 py-[5px] rounded-[8px] border cursor-pointer shrink-0
                    disabled:opacity-50 disabled:cursor-not-allowed ${cor}`}
      >
        {estado === 'rodando' ? 'Aguarde…' : estado === 'ok' ? 'Feito' : children}
      </button>
      {msg && (
        <span className={`text-[10px] max-w-[360px] ${estado === 'erro' ? 'text-perigo' : 'text-tenue'}`}>
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
  return dados;
}

function BotaoReenviar({ id, aoConcluir }) {
  return (
    <BotaoAcao
      titulo="Devolve esta conversão à fila e tenta agora"
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
