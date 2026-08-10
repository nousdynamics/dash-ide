import { useEffect, useState } from 'react';
import { Cartao, Estado, Esqueleto, Pill, Select } from '../componentes/base';
import { FiltroPeriodo } from '../componentes/FiltroPeriodo';
import { GraficoAcumulado } from '../componentes/Graficos';
import { PainelLead } from '../componentes/PainelLead';
import { useApi } from '../lib/api';
import { MESES, filtroPadrao, queryPeriodo, resolverPeriodo, rotuloPeriodo } from '../lib/periodo';
import { fmtDataHora, fmtDec, fmtDiaMes, fmtInt, iniciais } from '../lib/formato';

const FONTES = {
  rd_marketing: { rotulo: 'RD Marketing', tom: 'neutro' },
  rubeus: { rotulo: 'Rubeus', tom: 'sucesso' },
  misto: { rotulo: 'RD + Rubeus', tom: 'atencao' },
  indisponivel: { rotulo: 'Indisponível', tom: 'perigo' },
};

/** "2026-06" vira "Junho/2026" — a coluna Mês da planilha, não a chave crua. */
function rotuloMes(chave) {
  const [ano, mes] = String(chave).split('-').map(Number);
  return MESES[mes - 1] ? `${MESES[mes - 1]}/${ano}` : chave;
}

function BadgeFonte({ fonte }) {
  const f = FONTES[fonte] || FONTES.rubeus;
  return <Pill tom={f.tom}>{f.rotulo}</Pill>;
}

function Variacao({ pct, abs, claro = false }) {
  if (pct === null || pct === undefined) {
    return <span className={`text-[11px] ${claro ? 'text-white/60' : 'text-tenue'}`}>sem base anterior</span>;
  }
  const seta = pct > 0 ? '↑' : pct < 0 ? '↓' : '→';
  const cor =
    pct === 0
      ? claro ? 'text-white/70' : 'text-tenue'
      : pct > 0
        ? 'text-sucesso'
        : 'text-perigo';
  const sinal = abs > 0 ? '+' : abs < 0 ? '−' : '';
  return (
    <span className={`text-[11px] font-semibold tnum ${cor}`}>
      {seta} {fmtDec(Math.abs(pct))}%{' '}
      <span className={claro ? 'text-white/70' : 'text-tenue'}>
        ({sinal}{fmtInt(Math.abs(abs))})
      </span>
    </span>
  );
}

function SetaConversao({ pct, vertical = false }) {
  const rotulo = pct === null || pct === undefined ? '—' : `${fmtDec(pct)}%`;
  if (vertical) {
    return (
      <div className="flex items-center gap-2 py-[6px] pl-5">
        <span aria-hidden="true" className="w-px h-[14px] bg-borda-forte" />
        <span className="text-[11px] font-semibold text-azul-300 tnum">{rotulo}</span>
        <span className="text-[11px] text-tenue">de conversão para a etapa abaixo</span>
      </div>
    );
  }
  return (
    <div className="relative z-10 self-center shrink-0 -mx-[9px]">
      <span
        title={`${rotulo} de conversão desde a etapa anterior`}
        className="flex items-center justify-center h-[24px] pl-[9px] pr-[15px] text-[11px]
                   font-semibold tnum bg-base text-azul-300"
        style={{ clipPath: 'polygon(0 0, 70% 0, 100% 50%, 70% 100%, 0 100%)' }}
      >
        {rotulo}
      </span>
    </div>
  );
}

function Esteira({ etapas, maiorQueda, selecionada, aoSelecionar, comFonte = false, interativa = true }) {
  const Celula = interativa ? 'button' : 'div';
  return (
    <>
      <div className="hidden md:block overflow-x-auto pb-1">
        <div className="flex items-stretch min-w-full">
          {etapas.map((e, i) => {
            const ativa = interativa && e.etapa === selecionada;
            const vazio = e.total === null || e.total === undefined;
            return (
              <div key={e.etapa} className="flex items-stretch flex-1 min-w-[124px]">
                {i > 0 && <SetaConversao pct={e.taxa_desde_anterior_pct} />}
                <Celula
                  type={interativa ? 'button' : undefined}
                  onClick={interativa ? () => aoSelecionar(e.etapa) : undefined}
                  aria-pressed={interativa ? ativa : undefined}
                  className={`flex-1 min-w-0 flex flex-col justify-center rounded-[12px] px-3 py-4 text-center
                    border transition-colors
                    ${interativa ? 'cursor-pointer focus-visible:outline-2 focus-visible:outline-azul-400 focus-visible:outline-offset-2' : ''}
                    ${ativa
                      ? 'bg-azul-600 border-azul-500 text-white'
                      : 'bg-elevado border-transparent'}
                    ${interativa && !ativa ? 'hover:bg-superficie-hover' : ''}
                    ${!ativa && maiorQueda === e.etapa ? 'border-atencao' : ''}`}
                >
                  <div className={`text-[10px] font-semibold uppercase tracking-wide truncate
                                   ${ativa ? 'text-white/80' : 'text-secundario'}`}>
                    {e.etapa}
                  </div>
                  <div className="text-[24px] font-bold tnum leading-tight mt-[2px]">
                    {vazio ? '—' : fmtInt(e.total)}
                  </div>
                  {comFonte && e.fonte && (
                    <div className="mt-1 flex justify-center">
                      <BadgeFonte fonte={e.fonte} />
                    </div>
                  )}
                  <div className="mt-1">
                    <Variacao pct={e.delta_pct} abs={e.delta_abs} claro={ativa} />
                  </div>
                  {maiorQueda === e.etapa && (
                    <span className={`block text-[10px] font-semibold mt-1 ${ativa ? 'text-white/80' : 'text-atencao'}`}>
                      maior queda
                    </span>
                  )}
                </Celula>
              </div>
            );
          })}
        </div>
      </div>

      <div className="md:hidden flex flex-col">
        {etapas.map((e, i) => {
          const ativa = interativa && e.etapa === selecionada;
          const vazio = e.total === null || e.total === undefined;
          return (
            <div key={e.etapa}>
              {i > 0 && <SetaConversao pct={e.taxa_desde_anterior_pct} vertical />}
              <Celula
                type={interativa ? 'button' : undefined}
                onClick={interativa ? () => aoSelecionar(e.etapa) : undefined}
                aria-pressed={interativa ? ativa : undefined}
                className={`w-full flex items-center justify-between gap-3 p-3 rounded-[12px] text-left
                  border
                  ${interativa ? 'cursor-pointer' : ''}
                  ${ativa ? 'bg-azul-600 border-azul-500 text-white' : 'bg-elevado border-transparent'}
                  ${!ativa && maiorQueda === e.etapa ? 'border-atencao' : ''}`}
              >
                <div className="min-w-0">
                  <div className={`text-[11px] font-semibold ${ativa ? 'text-white/80' : 'text-secundario'}`}>
                    {e.etapa}
                  </div>
                  {comFonte && e.fonte && (
                    <div className="mt-1"><BadgeFonte fonte={e.fonte} /></div>
                  )}
                  <div className="mt-px">
                    <Variacao pct={e.delta_pct} abs={e.delta_abs} claro={ativa} />
                  </div>
                </div>
                <div className="text-[19px] font-bold tnum shrink-0">
                  {vazio ? '—' : fmtInt(e.total)}
                </div>
              </Celula>
            </div>
          );
        })}
      </div>
    </>
  );
}

function CurvaDaEtapa({ funilId, etapa, periodoQs, chave }) {
  const { dados, carregando, erro } = useApi(
    `/api/funil/serie?${periodoQs}` +
      (funilId ? `&funil_id=${encodeURIComponent(funilId)}` : '') +
      (etapa ? `&etapa=${encodeURIComponent(etapa)}` : ''),
    `serie-${funilId}-${etapa}-${chave}`,
  );

  if (erro) return <Cartao><Estado tipo="erro" titulo="Não foi possível carregar a curva" mensagem={erro} /></Cartao>;
  if (carregando || !dados) return <Esqueleto linhas={6} />;

  const novos = dados.serie.reduce((a, d) => a + d.novos, 0);

  return (
    <GraficoAcumulado
      titulo={`${fmtInt(novos)} lead(s) em ${etapa}`}
      subtitulo={`Acumulado no período · ${fmtInt(dados.total_anterior)} no período anterior`}
      dados={dados.serie}
      rotuloAtual="Período atual"
      rotuloAnterior="Período anterior"
    />
  );
}

const POR_PAGINA = 24;

function LeadsDoFunil({ funilId, aoAbrir }) {
  const [busca, setBusca] = useState('');
  const [aplicada, setAplicada] = useState('');
  const [pagina, setPagina] = useState(1);

  const { dados, carregando } = useApi(
    `/api/funil/leads?pagina=${pagina}&por_pagina=${POR_PAGINA}` +
      (funilId ? `&funil_id=${encodeURIComponent(funilId)}` : '') +
      (aplicada.trim() ? `&busca=${encodeURIComponent(aplicada.trim())}` : ''),
    `leads-${funilId}-${pagina}-${aplicada}`,
  );

  useEffect(() => {
    const t = setTimeout(() => setAplicada(busca), 250);
    return () => clearTimeout(t);
  }, [busca]);

  /*
   * Busca nova e troca de funil voltam para a primeira página.
   * Ficar na página 5 de um resultado que agora tem 2 mostraria tela vazia com
   * leads existindo logo atrás.
   */
  useEffect(() => {
    setPagina(1);
  }, [aplicada, funilId]);

  if (carregando || !dados) return <Esqueleto linhas={4} />;

  const itens = dados.itens;

  if (!dados.total && !dados.busca) {
    return (
      <Estado
        titulo="Nenhum lead neste funil ainda"
        mensagem="Os leads aparecem assim que o Rubeus disparar eventos para o webhook deste funil."
      />
    );
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar lead por nome, id ou curso…"
          aria-label="Buscar lead"
          className="bg-superficie text-primario border border-borda-forte rounded-[8px]
                     px-2 py-[5px] text-xs flex-1 min-w-[200px]"
        />
        <span className="text-[11px] text-tenue tnum">
          {dados.total} lead(s){dados.busca ? ' encontrados' : ''}
          {dados.paginas > 1 && ` · página ${dados.pagina} de ${dados.paginas}`}
        </span>
      </div>

      <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
        {itens.map((l) => (
          <button
            key={l.quem}
            type="button"
            onClick={() => aoAbrir(l.contato_id)}
            className="text-left bg-superficie border border-borda rounded-[12px] p-3
                       hover:bg-superficie-hover hover:border-borda-forte cursor-pointer
                       focus-visible:outline-2 focus-visible:outline-azul-400"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-7 h-7 rounded-full bg-azul-700 text-white flex items-center
                               justify-center text-[10px] font-semibold shrink-0">
                {iniciais(l.contato_nome)}
              </span>
              <span className="text-xs font-semibold truncate">
                {l.contato_nome || `Contato ${l.contato_id}`}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <Pill tom="sucesso">{l.etapa}</Pill>
              {l.curso_codigo && <Pill tom="neutro">{l.curso_codigo}</Pill>}
              {/* Processo repetido é jornada legítima — a mesma pessoa pode se
                  inscrever em dois cursos. Fica visível em vez de somado. */}
              {l.processos > 1 && <Pill tom="atencao">{l.processos} processos</Pill>}
            </div>
            <div className="text-[11px] text-tenue mt-2">
              {l.eventos} evento(s) · {fmtDataHora(l.registrado_em)}
              {l.ids_no_crm > 1 && (
                <span title="O Rubeus emitiu mais de um id de contato para esta pessoa; o painel juntou pelo e-mail">
                  {' '}· {l.ids_no_crm} cadastros no CRM
                </span>
              )}
            </div>
            {l.email && (
              <div className="text-[11px] text-tenue truncate" title={l.email}>{l.email}</div>
            )}
          </button>
        ))}
      </div>

      {/* Busca sem resultado é diferente de funil vazio — o texto tem de dizer qual é. */}
      {!itens.length && (
        <Estado
          titulo="Nenhum lead com esse termo"
          mensagem="A busca procura em nome, e-mail, código do curso e id, no funil inteiro — não só nesta página."
        />
      )}

      {dados.paginas > 1 && (
        <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-borda">
          <button
            type="button"
            onClick={() => setPagina((p) => Math.max(1, p - 1))}
            disabled={dados.pagina <= 1}
            className="text-xs px-3 py-[6px] rounded-[8px] border border-borda-forte bg-superficie
                       text-secundario cursor-pointer hover:bg-superficie-hover hover:text-primario
                       disabled:opacity-35 disabled:cursor-not-allowed"
          >
            ← Anteriores
          </button>
          <span className="text-[11px] text-tenue tnum">
            {(dados.pagina - 1) * dados.por_pagina + 1}–
            {Math.min(dados.pagina * dados.por_pagina, dados.total)} de {dados.total}
          </span>
          <button
            type="button"
            onClick={() => setPagina((p) => Math.min(dados.paginas, p + 1))}
            disabled={dados.pagina >= dados.paginas}
            className="text-xs px-3 py-[6px] rounded-[8px] border border-borda-forte bg-superficie
                       text-secundario cursor-pointer hover:bg-superficie-hover hover:text-primario
                       disabled:opacity-35 disabled:cursor-not-allowed"
          >
            Próximos →
          </button>
        </div>
      )}
    </>
  );
}

function MacroView({ filtro, categoria, curso, aoTrocarCategoria, aoTrocarCurso }) {
  const p = queryPeriodo(filtro);
  const qs =
    `${p}` +
    (categoria ? `&categoria=${encodeURIComponent(categoria)}` : '') +
    (curso ? `&curso_codigo=${encodeURIComponent(curso)}` : '') +
    `&comparar=${filtro.comparar ? '1' : '0'}`;

  const { dados, carregando, erro } = useApi(`/api/funil/macro?${qs}`, `macro-${qs}`);
  const { dados: catalogo } = useApi('/api/catalogo/cursos', 'catalogo-cursos');

  if (erro) return <Cartao><Estado tipo="erro" titulo="Não foi possível carregar o funil macro" mensagem={erro} /></Cartao>;
  if (carregando || !dados) return <Esqueleto linhas={8} />;

  const categorias = catalogo?.categorias ?? [];
  const cursos = catalogo?.itens ?? [];
  const semCat = dados.por_categoria_sem_curso ?? { inscricoes: 0, matriculas: 0 };
  const temSemCategoria = semCat.inscricoes > 0 || semCat.matriculas > 0;

  return (
    <>
      <Cartao>
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div>
            <div className="text-[13px] font-semibold">Funil consolidado</div>
            <div className="text-[11px] text-tenue mt-[2px]">
              Espelha a planilha: RD Marketing no topo, Rubeus da qualificação à matrícula
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select
              rotulo="Categoria"
              valor={categoria}
              aoTrocar={aoTrocarCategoria}
              opcoes={[
                ['', 'Todas as categorias'],
                ...categorias.map((c) => [c.id, c.rotulo]),
              ]}
            />
            <Select
              rotulo="Curso"
              valor={curso}
              aoTrocar={aoTrocarCurso}
              opcoes={[
                ['', 'Todos os cursos'],
                ...cursos
                  .filter((c) => c.codigo)
                  .slice(0, 200)
                  .map((c) => [c.codigo, `${c.nome || c.codigo}${c.codigo ? ` (${c.codigo})` : ''}`]),
              ]}
            />
          </div>
        </div>

        {!dados.rd?.ok && (
          <div className="mb-3 text-[11px] text-atencao bg-superficie border border-borda rounded-[8px] px-3 py-2">
            Visitantes/Leads do RD Marketing indisponíveis: {dados.rd?.motivo || 'conecte o OAuth ou verifique o plano Analysis.'}
            {' '}Qualificação em diante segue com dados do Rubeus.
          </div>
        )}

        <Esteira
          etapas={dados.etapas}
          maiorQueda={null}
          selecionada={null}
          aoSelecionar={() => {}}
          comFonte
          interativa={false}
        />

        <div className="text-[11px] text-tenue mt-3 leading-relaxed">
          Contagem acumulada, como na planilha: quem se matriculou também conta como inscrito,
          oportunidade e qualificado. A taxa entre duas etapas é a segunda dividida pela primeira.
        </div>
      </Cartao>

      <Cartao>
        <div className="text-[13px] font-semibold mb-3">Inscrições e matrículas por categoria</div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-tenue border-b border-borda">
                <th className="py-2 pr-3 font-medium">Categoria</th>
                <th className="py-2 pr-3 font-medium tnum">Inscrições</th>
                <th className="py-2 font-medium tnum">Matrículas</th>
              </tr>
            </thead>
            <tbody>
              {dados.por_categoria.map((r) => (
                <tr key={r.categoria} className="border-b border-borda/60">
                  <td className="py-2 pr-3">{r.rotulo}</td>
                  <td className="py-2 pr-3 tnum">{fmtInt(r.inscricoes)}</td>
                  <td className="py-2 tnum">{fmtInt(r.matriculas)}</td>
                </tr>
              ))}
              {/*
                * Sem curso conhecido é linha, não arredondamento.
                *
                * O Rubeus manda inscrição e matrícula sem curso nenhum; o curso
                * só aparece no evento de qualificação, e nem toda pessoa passa
                * por um. Somar essa gente em "Curta duração" ou sumir com ela
                * faria a tabela fechar bonito e mentir — a soma das categorias
                * bateria com o funil sem que ninguém soubesse o que entrou.
                */}
              {temSemCategoria && (
                <tr className="border-b border-borda/60 text-tenue">
                  <td className="py-2 pr-3 italic">Sem curso identificado</td>
                  <td className="py-2 pr-3 tnum">{fmtInt(semCat.inscricoes)}</td>
                  <td className="py-2 tnum">{fmtInt(semCat.matriculas)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {temSemCategoria && (
          <div className="text-[11px] text-tenue mt-2 leading-relaxed">
            O Rubeus não envia o curso nos eventos de inscrição e matrícula. O painel recupera o
            curso pela própria pessoa, quando ela passou por alguma etapa que o traga — o resto fica
            nesta linha em vez de ser distribuído por chute.
          </div>
        )}
      </Cartao>

      {dados.evolucao?.length > 0 && (
        <Cartao>
          <div className="text-[13px] font-semibold mb-3">Evolução mês a mês (Rubeus)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-tenue border-b border-borda">
                  <th className="py-2 pr-3 font-medium">Mês</th>
                  <th className="py-2 pr-3 font-medium tnum">Qualificados</th>
                  <th className="py-2 pr-3 font-medium tnum">Oportunidades</th>
                  <th className="py-2 pr-3 font-medium tnum">Inscrições</th>
                  <th className="py-2 pr-3 font-medium tnum">Matrículas</th>
                  {/* A conversão de ponta a ponta é a leitura que a planilha
                      cobra do mês: de qualificado a matriculado. */}
                  <th className="py-2 font-medium tnum">Qualif. → Matríc.</th>
                </tr>
              </thead>
              <tbody>
                {dados.evolucao.map((r) => (
                  <tr key={r.mes} className="border-b border-borda/60">
                    <td className="py-2 pr-3">{rotuloMes(r.mes)}</td>
                    <td className="py-2 pr-3 tnum">{fmtInt(r.qualificados)}</td>
                    <td className="py-2 pr-3 tnum">{fmtInt(r.oportunidades)}</td>
                    <td className="py-2 pr-3 tnum">{fmtInt(r.inscricoes)}</td>
                    <td className="py-2 pr-3 tnum">{fmtInt(r.matriculas)}</td>
                    <td className="py-2 tnum text-azul-300 font-semibold">
                      {r.qualificados > 0 ? `${fmtDec((r.matriculas / r.qualificados) * 100)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Cartao>
      )}
    </>
  );
}

function DetalheRubeus({ filtro }) {
  const [funil, setFunil] = useState(null);
  const [etapaSel, setEtapaSel] = useState(null);
  const [leadAberto, setLeadAberto] = useState(null);
  const p = queryPeriodo(filtro);
  const chave = p;
  const { dados, carregando, erro } = useApi(
    `/api/funil?${p}${funil ? `&funil_id=${encodeURIComponent(funil)}` : ''}`,
    `detalhe-${funil}-${chave}`,
  );

  if (erro) return <Cartao><Estado tipo="erro" titulo="Não foi possível carregar" mensagem={erro} /></Cartao>;
  if (carregando || !dados) return <Esqueleto />;

  const funis = dados.funis_disponiveis || [];
  if (!funil && funis.length) {
    setFunil(String(funis[0].id));
    return <Esqueleto />;
  }

  const comDado = dados.etapas.filter((e) => e.total > 0);
  const etapa = comDado.some((e) => e.etapa === etapaSel) ? etapaSel : comDado[0]?.etapa ?? null;

  return (
    <>
      <Cartao>
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="text-[13px] font-semibold">Etapas do processo (Rubeus)</div>
          <div className="flex items-center gap-2 flex-wrap">
            {funis.length > 0 && (
              <Select
                rotulo="Filtrar por funil"
                valor={funil ?? ''}
                aoTrocar={(v) => setFunil(v)}
                opcoes={funis.map((f) => [String(f.id), `${f.nome} (${fmtInt(f.leads)})`])}
              />
            )}
          </div>
        </div>

        {comDado.length ? (
          <>
            <Esteira
              etapas={dados.etapas}
              maiorQueda={dados.etapa_maior_queda}
              selecionada={etapa}
              aoSelecionar={setEtapaSel}
              comFonte
            />
            <div className="text-[11px] text-tenue mt-3 leading-relaxed">
              Ordem preferencial vem do catálogo validado no Rubeus; sem mapeamento, ordena por volume.
            </div>
          </>
        ) : (
          <Estado
            titulo="Nenhum lead neste recorte"
            mensagem="Cole o link deste funil no Rubeus, em Funis e webhooks. As etapas aparecem sozinhas conforme os eventos chegam."
          />
        )}
      </Cartao>

      {etapa && <CurvaDaEtapa funilId={funil} etapa={etapa} periodoQs={p} chave={chave} />}

      <Cartao>
        <div className="text-[13px] font-semibold mb-3">Leads deste funil</div>
        <LeadsDoFunil funilId={funil} aoAbrir={setLeadAberto} />
      </Cartao>

      {leadAberto && (
        <PainelLead contatoId={leadAberto} aoFechar={() => setLeadAberto(null)} />
      )}
    </>
  );
}

/**
 * Funil automático no estilo da planilha 2026.
 * Macro (RD + Rubeus) é a view default; detalhe por processo fica secundário.
 */
export function Funil({ filtro, setFiltro }) {
  const [aba, setAba] = useState('macro');
  const [categoria, setCategoria] = useState('');
  const [curso, setCurso] = useState('');
  const filtroLocal = filtro ?? filtroPadrao();
  const { de, ate } = resolverPeriodo(filtroLocal);
  const setFiltroLocal = setFiltro ?? (() => {});

  return (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[19px] font-semibold tracking-tight">Funil de vendas</div>
          <div className="text-tenue text-xs mt-[2px]">
            {rotuloPeriodo(filtroLocal)} · {fmtDiaMes(de)} a {fmtDiaMes(ate)} · RD Marketing + Rubeus
          </div>
        </div>
        <FiltroPeriodo filtro={filtroLocal} aoTrocar={setFiltroLocal} />
      </div>

      <div className="flex gap-1 p-[3px] rounded-[10px] bg-elevado border border-borda w-fit">
        {[
          ['macro', 'Visão consolidada'],
          ['detalhe', 'Por processo (Rubeus)'],
        ].map(([id, nome]) => (
          <button
            key={id}
            type="button"
            onClick={() => setAba(id)}
            className={`text-xs px-3 py-[6px] rounded-[8px] border-0 cursor-pointer
              ${aba === id ? 'bg-azul-600 text-white' : 'bg-transparent text-secundario hover:text-primario'}`}
          >
            {nome}
          </button>
        ))}
      </div>

      {aba === 'macro' ? (
        <MacroView
          filtro={filtroLocal}
          categoria={categoria}
          curso={curso}
          aoTrocarCategoria={setCategoria}
          aoTrocarCurso={setCurso}
        />
      ) : (
        <DetalheRubeus filtro={filtroLocal} />
      )}
    </>
  );
}
