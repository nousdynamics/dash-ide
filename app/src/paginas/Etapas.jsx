import { useEffect, useMemo, useRef, useState } from 'react';
import { Cartao, Estado, Esqueleto, Select, Switch } from '../componentes/base';
import { useApi } from '../lib/api';

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

/** Nomes legíveis quando o processo ainda não tem funil cadastrado. */
function nomeProcesso(id, nomeApi) {
  if (nomeApi && nomeApi !== id) return nomeApi;
  const fixos = {
    0: 'Sem processo (legado)',
    7: 'Eventos / processo 7',
  };
  return fixos[String(id)] || `Processo ${id}`;
}

/**
 * Admin do mapa processo → etapa → macro.
 *
 * - Nome à esquerda = etapa real do Rubeus (nunca traduzida).
 * - Macro = em qual degrau do consolidado essa etapa conta.
 * - Visível = aparece na esteira “Por processo”.
 * Updates otimistas — sem refetch/skeleton a cada clique.
 */
export function Etapas() {
  const { dados, carregando, erro } = useApi('/api/catalogo/etapas', 'etapas-admin');
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

  if (erro) {
    return (
      <Cartao>
        <Estado tipo="erro" titulo="Não foi possível carregar as etapas" mensagem={erro} />
      </Cartao>
    );
  }
  if (carregando || !dados) return <Esqueleto linhas={8} />;

  if (!dados.pode_editar) {
    return (
      <Cartao>
        <Estado
          titulo="Acesso restrito"
          mensagem="Só quem administra o painel pode mapear, ocultar ou reordenar etapas."
        />
      </Cartao>
    );
  }

  return (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[19px] font-semibold tracking-tight">Etapas do processo</div>
          <div className="text-tenue text-xs mt-[2px] leading-relaxed max-w-[560px]">
            O nome à esquerda é o do <strong className="text-secundario">Rubeus</strong>. A coluna
            Macro diz em qual degrau do Funil consolidado a etapa conta. Visível controla a
            esteira “Por processo”.
          </div>
        </div>
        {(okFlash || erroAcao) && (
          <div
            className={`text-[11px] px-3 py-1.5 rounded-[8px] border shrink-0
              ${erroAcao
                ? 'text-perigo bg-superficie border-borda'
                : 'text-sucesso bg-superficie border-borda'}`}
          >
            {erroAcao || okFlash}
          </div>
        )}
      </div>

      {grupos.length === 0 ? (
        <Cartao>
          <Estado
            titulo="Nenhuma etapa cadastrada"
            mensagem="As etapas aparecem quando o Rubeus dispara eventos ou quando o sync de oportunidades roda."
          />
        </Cartao>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-3 items-start">
          <Cartao className="!p-2 sticky top-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-tenue px-2 py-1.5">
              Processos
            </div>
            <nav className="flex flex-col gap-0.5" aria-label="Processos">
              {grupos.map((g) => {
                const ativo = g.processo_id === processoAtivo;
                const ocultas = g.etapas.filter((e) => !e.visivel).length;
                return (
                  <button
                    key={g.processo_id}
                    type="button"
                    onClick={() => setProcessoAtivo(g.processo_id)}
                    className={`text-left rounded-[8px] px-2.5 py-2 border-0 cursor-pointer
                      ${ativo
                        ? 'bg-azul-600 text-white'
                        : 'bg-transparent text-secundario hover:bg-superficie-hover hover:text-primario'}`}
                  >
                    <div className="text-xs font-semibold truncate">{g.processo_nome}</div>
                    <div className={`text-[10px] mt-0.5 ${ativo ? 'text-white/70' : 'text-tenue'}`}>
                      {g.etapas.length} etapa{g.etapas.length === 1 ? '' : 's'}
                      {ocultas ? ` · ${ocultas} oculta${ocultas === 1 ? '' : 's'}` : ''}
                    </div>
                  </button>
                );
              })}
            </nav>
          </Cartao>

          {grupo && (
            <Cartao>
              <div className="flex items-baseline justify-between gap-3 mb-4 flex-wrap">
                <div>
                  <div className="text-[15px] font-semibold">{grupo.processo_nome}</div>
                  <div className="text-[11px] text-tenue mt-0.5">
                    ID do processo no Rubeus:{' '}
                    <span className="font-mono text-secundario">{grupo.processo_id}</span>
                  </div>
                </div>
              </div>

              {/* Cabeçalho das colunas — só desktop */}
              <div
                className="hidden md:grid gap-3 px-1 pb-2 mb-1 border-b border-borda
                           text-[10px] font-semibold uppercase tracking-wide text-tenue
                           grid-cols-[minmax(0,1.4fr)_minmax(160px,0.9fr)_100px_72px]"
              >
                <div>Etapa no Rubeus</div>
                <div>Macro (consolidado)</div>
                <div className="text-center">Na esteira</div>
                <div className="text-center">Ordem</div>
              </div>

              <ul className="flex flex-col">
                {grupo.etapas.map((e, i) => {
                  const chave = `${e.processo_id}::${e.etapa_nome}`;
                  const busy = salvando === chave || salvando === `ordem::${grupo.processo_id}`;
                  return (
                    <li
                      key={chave}
                      className={`grid gap-2 md:gap-3 items-center py-2.5 border-b border-borda/70 last:border-b-0
                                  grid-cols-1
                                  md:grid-cols-[minmax(0,1.4fr)_minmax(160px,0.9fr)_100px_72px]
                                  ${e.visivel ? '' : 'opacity-50'}
                                  ${busy ? 'pointer-events-none' : ''}`}
                    >
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-primario leading-snug">
                          {e.etapa_nome}
                        </div>
                        <div className="text-[10px] text-tenue mt-0.5 flex flex-wrap gap-x-2">
                          {!e.visivel && <span className="text-atencao">oculta na esteira</span>}
                          {e.macro_etapa == null && (
                            <span>fora do consolidado</span>
                          )}
                          {e.etapa_id ? (
                            <span className="font-mono">id {e.etapa_id}</span>
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
                            <span
                              className="text-atencao"
                              title="A API do Rubeus nunca confirmou esta etapa. Pode ser etapa real que ninguém percorreu ultimamente, ou nome que o webhook mandou em outro campo (resumo, situação). Confira antes de classificar."
                            >
                              sem id do Rubeus
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="min-w-0">
                        <div className="md:hidden text-[10px] font-semibold uppercase text-tenue mb-1">
                          Macro
                        </div>
                        <Select
                          rotulo={`Macro de ${e.etapa_nome}`}
                          valor={e.macro_etapa ?? ''}
                          aoTrocar={(v) =>
                            patch(
                              e.processo_id,
                              e.etapa_nome,
                              { macro_etapa: v === '' ? null : v },
                              { macro_etapa: e.macro_etapa },
                            )
                          }
                          opcoes={MACRO_OPCOES}
                          className="w-full"
                          className="w-full"
                        />
                        <div className="sr-only">
                          {MACRO_ROTULO[e.macro_etapa ?? ''] || 'Sem macro'}
                        </div>
                      </div>

                      <div className="flex md:justify-center">
                        <Switch
                          ligado={Boolean(e.visivel)}
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
                        <button
                          type="button"
                          title="Subir"
                          aria-label={`Subir ${e.etapa_nome}`}
                          disabled={busy || i === 0}
                          onClick={() => reordenar(grupo.processo_id, grupo.etapas, i, i - 1)}
                          className="w-7 h-7 rounded-[8px] border border-borda-forte bg-superficie
                                     text-secundario cursor-pointer hover:bg-superficie-hover
                                     disabled:opacity-35 disabled:cursor-not-allowed"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          title="Descer"
                          aria-label={`Descer ${e.etapa_nome}`}
                          disabled={busy || i === grupo.etapas.length - 1}
                          onClick={() => reordenar(grupo.processo_id, grupo.etapas, i, i + 1)}
                          className="w-7 h-7 rounded-[8px] border border-borda-forte bg-superficie
                                     text-secundario cursor-pointer hover:bg-superficie-hover
                                     disabled:opacity-35 disabled:cursor-not-allowed"
                        >
                          ↓
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Cartao>
          )}
        </div>
      )}
    </>
  );
}
