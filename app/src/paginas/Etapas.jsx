import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Atualizando,
  CabecalhoPagina,
  Cartao,
  Dica,
  Estado,
  EsqueletoPagina,
  Icone,
  InfoDica,
  Pill,
  Select,
  Switch,
} from '../componentes/base';
import { invalidar, useApi } from '../lib/api';

/**
 * Opções do funil consolidado. O rótulo deixa explícito que isto NÃO é o nome
 * da etapa no Rubeus — era a confusão da tela antiga.
 */
const MACRO_OPCOES = [
  ['', 'Não entra no consolidado'],
  ['qualificados', '→ Qualificados'],
  ['oportunidade', '→ Oportunidades'],
  ['inscricao', '→ Inscrições'],
  ['matricula', '→ Matrículas'],
  ['lead', '→ Leads (raro)'],
  ['ignorar', 'Ignorar no Macro'],
];

const MACRO_ROTULO = Object.fromEntries(MACRO_OPCOES);

/**
 * Nome curto e cor de cada degrau, para o cabeçalho dos grupos e o resumo.
 * A cor só identifica o grupo — não diz se a etapa é boa ou ruim.
 */
const MACRO_VISUAL = {
  lead: { nome: 'Leads', cor: 'bg-azul-400' },
  qualificados: { nome: 'Qualificados', cor: 'bg-azul-500' },
  oportunidade: { nome: 'Oportunidades', cor: 'bg-atencao' },
  inscricao: { nome: 'Inscrições', cor: 'bg-azul-700' },
  matricula: { nome: 'Matrículas', cor: 'bg-sucesso' },
  ignorar: { nome: 'Ignoradas no Macro', cor: 'bg-perigo/60' },
  '': { nome: 'Fora do consolidado', cor: 'bg-tenue/50' },
};
const visualMacro = (m) => MACRO_VISUAL[m ?? ''] || { nome: m, cor: 'bg-tenue/50' };

const DESCRICAO_TELA =
  'O nome de cada etapa é o do Rubeus (nunca traduzido). A coluna Macro diz em qual degrau do Funil consolidado a etapa conta. Visível controla a esteira “Por processo”. A ordem aqui é a ordem da esteira.';

/** Colunas da lista no desktop: posição, etapa, macro, esteira, ordem. */
const COLUNAS = 'md:grid-cols-[32px_minmax(0,1.4fr)_minmax(170px,0.9fr)_96px_84px]';

/** Nomes legíveis quando o processo ainda não tem funil cadastrado. */
function nomeProcesso(id, nomeApi) {
  if (nomeApi && nomeApi !== id) return nomeApi;
  const fixos = {
    0: 'Sem processo (legado)',
    7: 'Eventos / processo 7',
  };
  return fixos[String(id)] || `Processo ${id}`;
}

/** Botão de subir/descer com chevron — o glifo de seta dependia da fonte. */
function BotaoOrdem({ direcao, rotulo, desativado, aoClicar }) {
  return (
    <Dica conteudo={direcao === 'cima' ? 'Subir na esteira' : 'Descer na esteira'}>
      <button
        type="button"
        aria-label={rotulo}
        disabled={desativado}
        onClick={aoClicar}
        className="w-8 h-8 rounded-[9px] border border-borda-forte bg-superficie text-secundario
                   flex items-center justify-center cursor-pointer transition-colors
                   hover:bg-superficie-hover hover:text-azul-600 hover:border-azul-400/40
                   disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-superficie disabled:hover:text-secundario"
      >
        <Icone nome="chevronBaixo" className={`w-4 h-4 ${direcao === 'cima' ? 'rotate-180' : ''}`} traco={2.2} />
      </button>
    </Dica>
  );
}

/**
 * Situação do salvamento no cabeçalho: salvando, salvo ou erro.
 * Como os updates são otimistas, é o único sinal de que o servidor aceitou.
 */
function StatusSalvamento({ salvando, ok, erro, aoFecharErro }) {
  if (erro) {
    return (
      <span role="alert" className="inline-flex items-center gap-1.5 animate-escala">
        <Pill tom="perigo" dica="A mudança foi desfeita na tela porque o servidor não aceitou.">
          <Icone nome="alerta" className="w-3.5 h-3.5" />
          {erro}
        </Pill>
        <button
          type="button"
          onClick={aoFecharErro}
          aria-label="Fechar aviso de erro"
          className="w-7 h-7 rounded-[8px] border-0 bg-transparent text-tenue hover:text-primario
                     flex items-center justify-center cursor-pointer"
        >
          <Icone nome="x" className="w-4 h-4" />
        </button>
      </span>
    );
  }
  if (salvando) {
    return (
      <span role="status" className="animate-escala">
        <Pill tom="azul">
          <span
            aria-hidden="true"
            className="w-3 h-3 rounded-full border-2 border-current border-r-transparent animate-spin"
          />
          Salvando…
        </Pill>
      </span>
    );
  }
  if (ok) {
    return (
      <span role="status" className="animate-escala">
        <Pill tom="sucesso">
          <Icone nome="check" className="w-3.5 h-3.5" traco={2.4} />
          {ok}
        </Pill>
      </span>
    );
  }
  return null;
}

/**
 * Admin do mapa processo → etapa → macro.
 *
 * - Nome à esquerda = etapa real do Rubeus (nunca traduzida).
 * - Macro = em qual degrau do consolidado essa etapa conta.
 * - Visível = aparece na esteira “Por processo”.
 * Updates otimistas — sem refetch/skeleton a cada clique.
 *
 * Os grupos por macro seguem a ordem da esteira: etapas vizinhas com o mesmo
 * macro ficam sob um mesmo cabeçalho. Agrupar reordenando esconderia a ordem
 * real, que é justamente o que esta tela edita.
 */
export function Etapas() {
  const { dados, carregando, atualizando, erro } = useApi('/api/catalogo/etapas', 'etapas-admin');
  const [itens, setItens] = useState([]);
  const [processoAtivo, setProcessoAtivo] = useState(null);
  const [salvando, setSalvando] = useState(null);
  const [erroAcao, setErroAcao] = useState(null);
  const [okFlash, setOkFlash] = useState(null);
  const okTimer = useRef(null);

  useEffect(() => {
    if (dados?.itens) setItens(dados.itens);
  }, [dados]);

  useEffect(() => () => {
    if (okTimer.current) window.clearTimeout(okTimer.current);
  }, []);

  const grupos = useMemo(() => {
    const map = new Map();
    for (const e of itens) {
      const k = String(e.processo_id);
      if (!map.has(k)) {
        map.set(k, {
          processo_id: k,
          processo_nome: nomeProcesso(k, e.processo_nome),
          etapas: [],
        });
      }
      map.get(k).etapas.push(e);
    }
    for (const g of map.values()) {
      g.etapas.sort((a, b) => (a.ordem - b.ordem) || String(a.etapa_nome).localeCompare(b.etapa_nome, 'pt-BR'));
    }
    return [...map.values()].sort((a, b) =>
      String(a.processo_nome).localeCompare(String(b.processo_nome), 'pt-BR'),
    );
  }, [itens]);

  useEffect(() => {
    if (!grupos.length) return;
    if (processoAtivo && grupos.some((g) => g.processo_id === processoAtivo)) return;
    // Prefere processos com funil nomeado (não só id numérico).
    const preferido =
      grupos.find((g) => !/^(Processo |\d+$)/.test(g.processo_nome) && g.processo_id !== '0') ||
      grupos[0];
    setProcessoAtivo(preferido.processo_id);
  }, [grupos, processoAtivo]);

  const grupo = grupos.find((g) => g.processo_id === processoAtivo) ?? null;

  /*
   * Blocos de etapas consecutivas com o mesmo macro — o agrupamento visual.
   * Guarda o índice de início para os botões de ordem continuarem usando a
   * posição na lista inteira.
   */
  const blocos = useMemo(() => {
    if (!grupo) return [];
    const r = [];
    grupo.etapas.forEach((e, i) => {
      const m = e.macro_etapa ?? '';
      const ultimo = r[r.length - 1];
      if (ultimo && ultimo.macro === m) ultimo.etapas.push({ e, i });
      else r.push({ macro: m, etapas: [{ e, i }] });
    });
    return r;
  }, [grupo]);

  /** Quantas etapas o processo tem em cada macro, na ordem do funil. */
  const resumoMacro = useMemo(() => {
    if (!grupo) return [];
    const cont = new Map();
    for (const e of grupo.etapas) {
      const m = e.macro_etapa ?? '';
      cont.set(m, (cont.get(m) || 0) + 1);
    }
    return Object.keys(MACRO_VISUAL)
      .filter((m) => cont.has(m))
      .concat([...cont.keys()].filter((m) => !(m in MACRO_VISUAL)))
      .map((m) => ({ macro: m, n: cont.get(m) }));
  }, [grupo]);

  const marcarOk = (msg) => {
    setOkFlash(msg);
    if (okTimer.current) window.clearTimeout(okTimer.current);
    okTimer.current = window.setTimeout(() => setOkFlash(null), 1800);
  };

  const patchLocal = (processoId, etapaNome, mudanca) => {
    setItens((prev) =>
      prev.map((e) =>
        String(e.processo_id) === String(processoId) && e.etapa_nome === etapaNome
          ? { ...e, ...mudanca }
          : e,
      ),
    );
  };

  const patch = async (processoId, etapaNome, corpo, estadoAnterior) => {
    const chave = `${processoId}::${etapaNome}`;
    setSalvando(chave);
    setErroAcao(null);
    patchLocal(processoId, etapaNome, corpo);
    try {
      const r = await fetch('/api/catalogo/etapas', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ processo_id: processoId, etapa_nome: etapaNome, ...corpo }),
      });
      if (!r.ok) {
        const c = await r.json().catch(() => ({}));
        throw new Error(c.erro || String(r.status));
      }
      // O macro e a visibilidade mudam o que o funil e a esteira mostram — o cache inteiro fica velho.
      invalidar();
      marcarOk('Salvo');
    } catch (e) {
      if (estadoAnterior) patchLocal(processoId, etapaNome, estadoAnterior);
      setErroAcao(e.message || 'Falha ao salvar');
    } finally {
      setSalvando(null);
    }
  };

  const reordenar = async (processoId, etapas, de, para) => {
    if (para < 0 || para >= etapas.length) return;
    const copia = [...etapas];
    const [movida] = copia.splice(de, 1);
    copia.splice(para, 0, movida);
    const itensOrdem = copia.map((e, i) => ({ etapa_nome: e.etapa_nome, ordem: (i + 1) * 10 }));

    const antes = new Map(etapas.map((e) => [e.etapa_nome, e.ordem]));
    setItens((prev) =>
      prev.map((e) => {
        if (String(e.processo_id) !== String(processoId)) return e;
        const novo = itensOrdem.find((x) => x.etapa_nome === e.etapa_nome);
        return novo ? { ...e, ordem: novo.ordem } : e;
      }),
    );

    setSalvando(`ordem::${processoId}`);
    setErroAcao(null);
    try {
      const r = await fetch('/api/catalogo/etapas/ordem', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ processo_id: processoId, itens: itensOrdem }),
      });
      if (!r.ok) {
        const c = await r.json().catch(() => ({}));
        throw new Error(c.erro || String(r.status));
      }
      invalidar();
      marcarOk('Ordem atualizada');
    } catch (e) {
      setItens((prev) =>
        prev.map((row) => {
          if (String(row.processo_id) !== String(processoId)) return row;
          const ordem = antes.get(row.etapa_nome);
          return ordem != null ? { ...row, ordem } : row;
        }),
      );
      setErroAcao(e.message || 'Falha ao reordenar');
    } finally {
      setSalvando(null);
    }
  };

  const cabecalho = (
    <CabecalhoPagina
      titulo="Etapas do processo"
      icone="camadas"
      descricao={DESCRICAO_TELA}
      acoes={
        <StatusSalvamento
          salvando={Boolean(salvando)}
          ok={okFlash}
          erro={erroAcao}
          aoFecharErro={() => setErroAcao(null)}
        />
      }
    />
  );

  if (erro) {
    return (
      <>
        {cabecalho}
        <Cartao>
          <Estado tipo="erro" titulo="Não foi possível carregar as etapas" mensagem={erro} />
        </Cartao>
      </>
    );
  }
  if (carregando || !dados) {
    return (
      <>
        {cabecalho}
        <EsqueletoPagina kpis={0} graficos={0} tabela />
      </>
    );
  }

  if (!dados.pode_editar) {
    return (
      <>
        {cabecalho}
        <Cartao>
          <Estado
            icone="cadeado"
            titulo="Acesso restrito"
            mensagem="Só quem administra o painel pode mapear, ocultar ou reordenar etapas."
          />
        </Cartao>
      </>
    );
  }

  return (
    <>
      {cabecalho}

      {grupos.length === 0 ? (
        <Cartao>
          <Estado
            icone="camadas"
            titulo="Nenhuma etapa cadastrada"
            mensagem="As etapas aparecem quando o Rubeus dispara eventos ou quando o sync de oportunidades roda."
          />
        </Cartao>
      ) : (
        /*
          * Travado enquanto o cache é substituído pela busca nova: a resposta
          * que chega sobrescreve `itens`, e um clique otimista feito antes dela
          * seria desfeito na tela sem aviso.
          */
        <Atualizando ativo={atualizando}>
        <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] gap-3 items-start">
          <Cartao className="!p-2 lg:sticky lg:top-3">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-tenue px-2 py-1.5 flex items-center gap-1.5">
              Processos
              <InfoDica texto="Cada processo do Rubeus tem a própria esteira de etapas. Escolha um para editar." />
            </div>
            <nav className="flex flex-col gap-0.5 cascata max-h-[280px] lg:max-h-none overflow-y-auto" aria-label="Processos">
              {grupos.map((g) => {
                const ativo = g.processo_id === processoAtivo;
                const ocultas = g.etapas.filter((e) => !e.visivel).length;
                return (
                  <button
                    key={g.processo_id}
                    type="button"
                    aria-current={ativo ? 'true' : undefined}
                    onClick={() => setProcessoAtivo(g.processo_id)}
                    className={`text-left rounded-[9px] px-2.5 py-2 border-0 cursor-pointer transition-colors
                      ${ativo
                        ? 'bg-azul-600 text-white shadow-[0_2px_8px_rgba(43,87,151,0.25)]'
                        : 'bg-transparent text-secundario hover:bg-superficie-hover hover:text-primario'}`}
                  >
                    <Dica conteudo={g.processo_nome} className="w-full">
                      <span className="block text-[13px] font-semibold truncate">{g.processo_nome}</span>
                    </Dica>
                    <div className={`text-[12px] mt-0.5 tnum ${ativo ? 'text-white/75' : 'text-tenue'}`}>
                      {g.etapas.length} etapa{g.etapas.length === 1 ? '' : 's'}
                      {ocultas ? ` · ${ocultas} oculta${ocultas === 1 ? '' : 's'}` : ''}
                    </div>
                  </button>
                );
              })}
            </nav>
          </Cartao>

          {grupo && (
            <Cartao key={grupo.processo_id} className="animate-surgir">
              <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                <div className="min-w-0">
                  <h2 className="m-0 text-[16px] font-semibold flex items-center gap-2">
                    {grupo.processo_nome}
                  </h2>
                  <div className="mt-1">
                    <Pill tom="neutro" dica="ID do processo no Rubeus">
                      <span className="font-mono">id {grupo.processo_id}</span>
                    </Pill>
                  </div>
                </div>
                <span className="text-[13px] text-secundario tnum">
                  {grupo.etapas.length} etapa{grupo.etapas.length === 1 ? '' : 's'}
                </span>
              </div>

              {/* Resumo: quantas etapas caem em cada degrau do consolidado. */}
              <div className="flex flex-wrap gap-1.5 mb-4">
                {resumoMacro.map(({ macro, n }) => {
                  const v = visualMacro(macro);
                  return (
                    <span
                      key={macro || 'nenhum'}
                      className="inline-flex items-center gap-1.5 px-2.5 py-[3px] rounded-full bg-elevado
                                 text-[12.5px] text-secundario font-medium"
                    >
                      <span aria-hidden="true" className={`w-2 h-2 rounded-full ${v.cor}`} />
                      {v.nome}
                      <span className="tnum font-semibold text-primario">{n}</span>
                    </span>
                  );
                })}
              </div>

              {/* Cabeçalho das colunas — só desktop */}
              <div
                className={`hidden md:grid gap-3 px-2 pb-2 border-b border-borda
                           text-[12px] font-semibold text-tenue ${COLUNAS}`}
              >
                <div className="text-center">#</div>
                <div>Etapa no Rubeus</div>
                <div className="flex items-center gap-1">
                  Macro (consolidado)
                  <InfoDica texto="Em qual degrau do Funil consolidado a etapa conta. Não é o nome da etapa no Rubeus." />
                </div>
                <div className="flex items-center justify-center gap-1">
                  Na esteira
                  <InfoDica texto="Ligado: a etapa aparece na esteira “Por processo”." />
                </div>
                <div className="text-center">Ordem</div>
              </div>

              <div className="flex flex-col gap-2 mt-2">
                {blocos.map((b) => {
                  const v = visualMacro(b.macro);
                  return (
                    <section
                      key={`${b.macro}-${b.etapas[0].i}`}
                      className="relative rounded-[12px] border border-borda overflow-hidden"
                    >
                      <span aria-hidden="true" className={`absolute left-0 top-0 bottom-0 w-[3px] ${v.cor}`} />
                      <div className="flex items-center gap-2 pl-3.5 pr-2.5 py-1.5 bg-elevado border-b border-borda">
                        <span aria-hidden="true" className={`w-2 h-2 rounded-full ${v.cor}`} />
                        <span className="text-[12.5px] font-semibold text-secundario">{v.nome}</span>
                        <span className="text-[12px] text-tenue tnum">
                          {b.etapas.length} etapa{b.etapas.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <ul className="flex flex-col m-0 p-0 list-none">
                        {b.etapas.map(({ e, i }) => {
                          const chave = `${e.processo_id}::${e.etapa_nome}`;
                          const salvandoLinha = salvando === chave;
                          const busy = salvandoLinha || salvando === `ordem::${grupo.processo_id}`;
                          return (
                            <li
                              key={chave}
                              className={`grid gap-2 md:gap-3 items-center pl-3.5 pr-2.5 py-2.5
                                          border-b border-borda/70 last:border-b-0 grid-cols-1 ${COLUNAS}
                                          transition-[background-color,opacity] duration-200 hover:bg-superficie-hover
                                          ${e.visivel ? '' : 'opacity-55'}
                                          ${busy ? 'pointer-events-none' : ''}`}
                            >
                              <div className="hidden md:flex justify-center">
                                <span className="w-6 h-6 rounded-full bg-elevado text-[12px] font-semibold text-secundario tnum flex items-center justify-center">
                                  {i + 1}
                                </span>
                              </div>

                              <div className="min-w-0">
                                <div className="text-[13.5px] font-semibold text-primario leading-snug flex items-center gap-2">
                                  <span className="md:hidden text-tenue tnum">{i + 1}.</span>
                                  <span className="min-w-0 break-words">{e.etapa_nome}</span>
                                  {salvandoLinha && (
                                    <span
                                      aria-label="Salvando"
                                      className="w-3.5 h-3.5 shrink-0 rounded-full border-2 border-azul-500 border-r-transparent animate-spin"
                                    />
                                  )}
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                  {!e.visivel && <Pill tom="atencao">Oculta na esteira</Pill>}
                                  {e.macro_etapa == null && <Pill tom="neutro">Fora do consolidado</Pill>}
                                  {e.etapa_id ? (
                                    <span className="text-[12px] text-tenue font-mono">id {e.etapa_id}</span>
                                  ) : (
                                    /*
                                     * Sem id: a etapa nunca foi confirmada pela API.
                                     *
                                     * O id só entra quando a etapa aparece em
                                     * listarOportunidades. Sem ele, ou é etapa real que
                                     * ninguém percorreu ultimamente ("Pré- Matriculado"),
                                     * ou é nome que o webhook pôs no campo errado — foi
                                     * assim que "Não contactado", que é o resumo da
                                     * oportunidade, virou etapa em cinco processos.
                                     *
                                     * A tela promete "o nome à esquerda é o do Rubeus";
                                     * estas são as linhas em que ela não pode garantir.
                                     * Marca sem acusar: quem opera o CRM sabe qual é qual.
                                     */
                                    <Pill
                                      tom="atencao"
                                      dica="A API do Rubeus nunca confirmou esta etapa. Pode ser etapa real que ninguém percorreu ultimamente, ou nome que o webhook mandou em outro campo (resumo, situação). Confira antes de classificar."
                                    >
                                      <Icone nome="alerta" className="w-3.5 h-3.5" />
                                      Sem id do Rubeus
                                    </Pill>
                                  )}
                                </div>
                              </div>

                              <div className="min-w-0">
                                <div className="md:hidden text-[12px] font-semibold text-tenue mb-1">Macro</div>
                                <Select
                                  rotulo={`Macro de ${e.etapa_nome}`}
                                  valor={e.macro_etapa ?? ''}
                                  aoTrocar={(val) =>
                                    patch(
                                      e.processo_id,
                                      e.etapa_nome,
                                      { macro_etapa: val === '' ? null : val },
                                      { macro_etapa: e.macro_etapa },
                                    )
                                  }
                                  opcoes={MACRO_OPCOES}
                                  className="w-full"
                                />
                                <div className="sr-only">
                                  {MACRO_ROTULO[e.macro_etapa ?? ''] || 'Sem macro'}
                                </div>
                              </div>

                              <div className="flex md:justify-center">
                                <Switch
                                  ligado={Boolean(e.visivel)}
                                  dica={e.visivel ? 'Visível na esteira — clique para ocultar' : 'Oculta na esteira — clique para mostrar'}
                                  aoTrocar={(visivel) =>
                                    patch(
                                      e.processo_id,
                                      e.etapa_nome,
                                      { visivel },
                                      { visivel: e.visivel },
                                    )
                                  }
                                >
                                  <span className="md:sr-only">Visível na esteira</span>
                                </Switch>
                              </div>

                              <div className="flex items-center gap-1 md:justify-center">
                                <BotaoOrdem
                                  direcao="cima"
                                  rotulo={`Subir ${e.etapa_nome}`}
                                  desativado={busy || i === 0}
                                  aoClicar={() => reordenar(grupo.processo_id, grupo.etapas, i, i - 1)}
                                />
                                <BotaoOrdem
                                  direcao="baixo"
                                  rotulo={`Descer ${e.etapa_nome}`}
                                  desativado={busy || i === grupo.etapas.length - 1}
                                  aoClicar={() => reordenar(grupo.processo_id, grupo.etapas, i, i + 1)}
                                />
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  );
                })}
              </div>
            </Cartao>
          )}
        </div>
        </Atualizando>
      )}
    </>
  );
}
