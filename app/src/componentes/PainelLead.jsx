import { useEffect, useRef, useState } from 'react';
import { Bloco, Botao, BotaoIcone, Dica, Estado, Icone, InfoDica, Pill } from './base';
import { useApi } from '../lib/api';
import { fmtDataHora, iniciais } from '../lib/formato';

/** Formata o corpo cru para leitura: JSON indentado ou um campo por linha. */
function corpoLegivel(corpo) {
  if (!corpo) return '';
  try {
    return JSON.stringify(JSON.parse(corpo), null, 2);
  } catch {
    if (corpo.includes('=') && !corpo.trim().startsWith('{')) {
      try {
        return [...new URLSearchParams(corpo).entries()].map(([k, v]) => `${k} = ${v}`).join('\n');
      } catch {
        /* deixa cru */
      }
    }
    return corpo;
  }
}

/**
 * Botão de copiar com confirmação.
 *
 * O "Copiado" por um instante é a única prova de que o clique funcionou — a
 * área de transferência não mostra nada por conta própria.
 */
function Copiar({ texto, rotulo = 'Copiar', dica }) {
  const [copiado, setCopiado] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const botao = (
    <Botao
      tamanho="sm"
      icone={copiado ? 'check' : 'copiar'}
      onClick={() => {
        navigator.clipboard.writeText(texto);
        setCopiado(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopiado(false), 1500);
      }}
      className={copiado ? '!text-sucesso !border-sucesso/40' : ''}
    >
      {copiado ? 'Copiado' : rotulo}
    </Botao>
  );
  return dica ? <Dica conteudo={dica}>{botao}</Dica> : botao;
}

/** Esqueleto no desenho do painel: grade de dados e uma trilha de passos. */
function EsqueletoPainel() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Carregando">
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="rounded-[12px] border border-borda p-3 flex gap-2.5">
            <Bloco className="h-8 w-8 !rounded-[9px] shrink-0" />
            <div className="flex-1 flex flex-col gap-1.5">
              <Bloco className="h-3 w-16" />
              <Bloco className="h-4 w-4/5" />
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <Bloco className="h-4 w-32" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex gap-3">
            <Bloco className="h-6 w-6 !rounded-full shrink-0" />
            <div className="flex-1 flex flex-col gap-1.5 pb-2">
              <Bloco className="h-4 w-40" />
              <Bloco className="h-3 w-28" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Painel lateral do lead.
 *
 * Gaveta à direita em vez de página: o usuário está lendo a lista do funil e
 * quer espiar uma pessoa sem perder o lugar. Fecha no Esc e no clique fora,
 * que é o que se espera de sobreposição.
 */
export function PainelLead({ contatoId, aoFechar }) {
  // Sem `manter`: a chave troca de pessoa, e o dado anterior é de outro lead.
  const { dados, carregando, erro } = useApi(
    `/api/funil/lead/${encodeURIComponent(contatoId)}`,
    `lead-${contatoId}`,
  );

  useEffect(() => {
    const aoTeclar = (e) => e.key === 'Escape' && aoFechar();
    document.addEventListener('keydown', aoTeclar);
    // Trava o scroll do fundo enquanto a gaveta está aberta.
    const antes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      document.body.style.overflow = antes;
    };
  }, [aoFechar]);

  const funis = dados?.funis ?? [];

  /*
   * Parear por etapa e ordem, não por timestamp.
   *
   * `leads_etapa.registrado_em` vem do payload (ISO) e `eventos_recebidos.recebido_em`
   * é a hora em que o Worker gravou — são grandezas diferentes e nunca batem
   * exatamente. Como as duas listas vêm ordenadas, a n-ésima ocorrência de uma
   * etapa na jornada corresponde à n-ésima daquela etapa nos payloads.
   */
  const filaPorEtapa = new Map();
  for (const p of dados?.payloads ?? []) {
    const k = p.etapa ?? '(sem etapa)';
    if (!filaPorEtapa.has(k)) filaPorEtapa.set(k, []);
    filaPorEtapa.get(k).push(p);
  }
  const usados = new Map();
  const payloadDoPasso = (etapa) => {
    const fila = filaPorEtapa.get(etapa) ?? [];
    const i = usados.get(etapa) ?? 0;
    usados.set(etapa, i + 1);
    return fila[i];
  };

  const nome = dados?.contato_nome || `Contato ${contatoId}`;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="flex-1 bg-azul-900/35 backdrop-blur-[2px] animate-aparecer"
        onClick={aoFechar}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Detalhes do lead"
        className="w-full md:w-[520px] h-full bg-base border-l border-borda
                   overflow-y-auto shadow-[var(--shadow-flutuante)] flex flex-col animate-surgir"
      >
        <div
          className="sticky top-0 z-[2] bg-base/95 backdrop-blur border-b border-borda px-5 py-4
                     flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              aria-hidden="true"
              className="w-11 h-11 rounded-full bg-gradient-to-br from-azul-600 to-azul-400 text-white flex items-center
                         justify-center text-[14px] font-semibold shrink-0 shadow-[0_4px_12px_rgba(43,87,151,0.25)]"
            >
              {dados ? iniciais(dados.contato_nome) : <Icone nome="pessoa" className="w-5 h-5" />}
            </div>
            <div className="min-w-0">
              <Dica conteudo={nome.length > 32 ? nome : null} className="w-full">
                <div className="text-[16px] font-semibold truncate">{nome}</div>
              </Dica>
              <div className="text-[12.5px] text-secundario tnum flex items-center gap-1.5 mt-0.5">
                <span>id {contatoId}</span>
                <Dica conteudo="Id do contato no Rubeus">
                  <Icone nome="info" className="w-3.5 h-3.5 text-tenue" />
                </Dica>
              </div>
            </div>
          </div>
          <BotaoIcone aoClicar={aoFechar} titulo="Fechar" icone="x" />
        </div>

        <div className="p-5 flex flex-col gap-5">
          {erro && <Estado tipo="erro" titulo="Não foi possível carregar" mensagem={erro} />}
          {carregando && !dados && <EsqueletoPainel />}

          {dados && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 cascata">
                {[
                  ['Funis', funis.map((f) => f.funil).join(', '), 'funil'],
                  ['Origem', dados.origem, 'link'],
                  ['Unidade', dados.unidade, 'mapa'],
                  ['Oferta', dados.oferta_nome || dados.oferta_codigo || dados.curso_codigo, 'capelo'],
                  ['Responsável', dados.responsavel_comercial, 'pessoa'],
                  ['Primeiro evento', dados.primeiro_em && fmtDataHora(dados.primeiro_em), 'calendario'],
                  ['Último evento', dados.ultimo_em && fmtDataHora(dados.ultimo_em), 'relogio'],
                ]
                  .filter(([, v]) => v)
                  .map(([k, v, icone]) => (
                    <div
                      key={k}
                      className="bg-superficie border border-borda rounded-[12px] p-3 flex items-start gap-2.5 min-w-0"
                    >
                      <span
                        aria-hidden="true"
                        className="w-8 h-8 rounded-[9px] bg-azul-50 text-azul-600 flex items-center justify-center shrink-0"
                      >
                        <Icone nome={icone} className="w-4 h-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-[12px] text-secundario font-medium">{k}</div>
                        <div className="text-[13.5px] mt-0.5 break-words leading-snug tnum">{v}</div>
                      </div>
                    </div>
                  ))}
              </div>

              <section className="flex flex-col gap-3">
                <h3 className="m-0 text-[15px] font-semibold flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="w-6 h-6 rounded-[7px] bg-azul-50 text-azul-600 flex items-center justify-center"
                  >
                    <Icone nome="tendencia" className="w-[14px] h-[14px]" />
                  </span>
                  Jornada
                  <Pill tom="neutro">
                    {funis.length} funil{funis.length === 1 ? '' : 's'}
                  </Pill>
                  <InfoDica texto="Uma trilha por funil, do primeiro ao último evento. O ponto em destaque é a etapa em que o lead está agora. Abra o payload de um passo para ver o que o Rubeus enviou." />
                </h3>
                {/*
                  Uma trilha por funil: um lead de Pós também entra em
                  Qualificação de Leads, e as etapas dos dois não são a mesma
                  sequência. Misturar faria parecer que ele voltou de etapa.
                */}
                {funis.length ? funis.map((f) => (
                  <div key={f.funil} className="rounded-[14px] border border-borda bg-superficie p-4 animate-surgir">
                    <div className="flex items-start justify-between gap-2 mb-3 flex-wrap">
                      <span className="text-[13.5px] font-semibold text-azul-700 flex items-center gap-1.5 min-w-0">
                        <Icone nome="funil" className="w-4 h-4 shrink-0" />
                        <span className="truncate">{f.funil}</span>
                      </span>
                      <span className="flex items-center gap-1.5 flex-wrap">
                        <Pill tom="neutro">{f.passos.length} passo(s)</Pill>
                        <Pill tom="azul" ponto dica="Etapa em que o lead está agora neste funil">
                          {f.etapa_atual}
                        </Pill>
                      </span>
                    </div>
                    <ol className="flex flex-col m-0 p-0 list-none">
                      {f.passos.map((p, i) => {
                        const bruto = payloadDoPasso(p.etapa);
                        const texto = corpoLegivel(bruto?.corpo);
                        const ultimo = i === f.passos.length - 1;
                        return (
                          <li key={i} className="flex gap-3">
                            {/* Trilho vertical: a linha some no último passo. */}
                            <div className="flex flex-col items-center shrink-0">
                              {ultimo ? (
                                <span
                                  aria-hidden="true"
                                  className="w-6 h-6 rounded-full bg-azul-600 text-white flex items-center justify-center
                                             shadow-[0_0_0_4px_rgba(79,143,232,0.18)]"
                                >
                                  <Icone nome="alvo" className="w-3.5 h-3.5" traco={2.2} />
                                </span>
                              ) : (
                                <span
                                  aria-hidden="true"
                                  className="w-6 h-6 rounded-full bg-superficie border-2 border-azul-400/60 text-azul-600
                                             flex items-center justify-center"
                                >
                                  <Icone nome="check" className="w-3 h-3" traco={2.6} />
                                </span>
                              )}
                              {!ultimo && <span className="w-0.5 flex-1 min-h-3 bg-azul-400/25 rounded-full my-0.5" />}
                            </div>
                            <div className={`min-w-0 flex-1 ${ultimo ? 'pb-0' : 'pb-4'}`}>
                              <div className="text-[13.5px] font-semibold leading-6 flex items-center gap-2 flex-wrap">
                                {p.etapa}
                                {ultimo && <span className="text-[12px] font-medium text-azul-600">agora</span>}
                              </div>
                              <div className="text-[12.5px] text-secundario flex flex-wrap items-center gap-x-2.5 gap-y-0.5 tnum">
                                <span className="inline-flex items-center gap-1">
                                  <Icone nome="relogio" className="w-3.5 h-3.5 text-tenue" />
                                  {fmtDataHora(p.registrado_em)}
                                </span>
                                {p.origem && (
                                  <span className="inline-flex items-center gap-1">
                                    <Icone nome="link" className="w-3.5 h-3.5 text-tenue" />
                                    {p.origem}
                                  </span>
                                )}
                              </div>
                              {texto && (
                                <details className="group mt-1.5">
                                  <summary
                                    className="list-none [&::-webkit-details-marker]:hidden inline-flex items-center gap-1
                                               text-[12.5px] font-medium text-azul-600 hover:text-azul-700 cursor-pointer
                                               rounded-[6px] px-1 -mx-1"
                                  >
                                    <Icone
                                      nome="chevronDireita"
                                      className="w-3.5 h-3.5 transition-transform duration-200 group-open:rotate-90"
                                    />
                                    Ver payload
                                  </summary>
                                  <div className="mt-2 rounded-[10px] border border-borda bg-elevado overflow-hidden animate-surgir">
                                    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-borda">
                                      <span className="text-[12px] text-secundario">Corpo recebido pelo webhook</span>
                                      <Copiar texto={texto} rotulo="Copiar" dica="Copiar o payload deste passo" />
                                    </div>
                                    <pre className="m-0 text-[12px] leading-relaxed text-secundario whitespace-pre-wrap break-all
                                                    p-2.5 max-h-56 overflow-auto font-mono">
                                      {texto}
                                    </pre>
                                  </div>
                                </details>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                )) : (
                  <Estado icone="relogio" mensagem="Nenhum passo registrado para este lead." />
                )}
              </section>

              {dados.payloads.length > 0 && (
                <div className="flex justify-end pt-1 border-t border-borda">
                  <Copiar
                    texto={JSON.stringify(dados, null, 2)}
                    rotulo="Copiar tudo deste lead"
                    dica="Copia os dados e todos os payloads deste lead em JSON"
                  />
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
