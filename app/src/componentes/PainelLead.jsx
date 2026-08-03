import { useEffect } from 'react';
import { Estado, Esqueleto, Pill } from './base';
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

function Copiar({ texto, rotulo = 'Copiar' }) {
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard.writeText(texto)}
      className="text-[10px] px-2 py-[3px] rounded-[8px] border border-borda-forte bg-superficie
                 text-secundario hover:bg-superficie-hover cursor-pointer shrink-0"
    >
      {rotulo}
    </button>
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

  const jornada = dados?.jornada ?? [];

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

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="flex-1 bg-black/60"
        onClick={aoFechar}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Detalhes do lead"
        className="w-full md:w-[520px] h-full bg-elevado border-l border-borda
                   overflow-y-auto shadow-2xl flex flex-col"
      >
        <div className="sticky top-0 bg-elevado border-b border-borda px-4 py-3 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-azul-700 text-white flex items-center
                            justify-center text-xs font-semibold shrink-0">
              {iniciais(dados?.contato_nome)}
            </div>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold truncate">
                {dados?.contato_nome || `Contato ${contatoId}`}
              </div>
              <div className="text-[11px] text-tenue">id {contatoId}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="w-7 h-7 shrink-0 rounded-[8px] border border-borda bg-superficie
                       text-secundario hover:bg-superficie-hover cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="p-4 flex flex-col gap-4">
          {erro && <Estado tipo="erro" titulo="Não foi possível carregar" mensagem={erro} />}
          {carregando && !dados && <Esqueleto linhas={4} />}

          {dados && (
            <>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['Etapa atual', dados.etapa_atual],
                  ['Funil', dados.processo_nome],
                  ['Origem', dados.origem],
                  ['Unidade', dados.unidade],
                  ['Curso', dados.curso_codigo],
                  ['Responsável', dados.responsavel_comercial],
                  ['Primeiro evento', dados.primeiro_em && fmtDataHora(dados.primeiro_em)],
                  ['Último evento', dados.ultimo_em && fmtDataHora(dados.ultimo_em)],
                ]
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k} className="bg-superficie border border-borda rounded-[8px] p-2">
                      <div className="text-[10px] text-tenue uppercase tracking-wide">{k}</div>
                      <div className="text-xs mt-[2px] break-words">{v}</div>
                    </div>
                  ))}
              </div>

              <div>
                <div className="text-[13px] font-semibold mb-2">
                  Jornada <span className="text-tenue font-normal">({jornada.length} passo(s))</span>
                </div>
                {jornada.length ? (
                  <ol className="flex flex-col">
                    {jornada.map((p, i) => {
                      const bruto = payloadDoPasso(p.etapa);
                      const texto = corpoLegivel(bruto?.corpo);
                      return (
                        <li key={i} className="flex gap-3">
                          {/* Trilho vertical: a linha some no último passo. */}
                          <div className="flex flex-col items-center shrink-0">
                            <span
                              className={`w-[9px] h-[9px] rounded-full mt-[6px]
                                ${i === jornada.length - 1 ? 'bg-azul-400' : 'bg-borda-forte'}`}
                            />
                            {i < jornada.length - 1 && <span className="w-px flex-1 bg-borda" />}
                          </div>
                          <div className="pb-3 min-w-0 flex-1">
                            <div className="text-xs font-semibold">{p.etapa}</div>
                            <div className="text-[11px] text-tenue">
                              {fmtDataHora(p.registrado_em)}
                              {p.origem ? ` · ${p.origem}` : ''}
                            </div>
                            {texto && (
                              <details className="mt-1">
                                <summary className="text-[11px] text-azul-300 cursor-pointer">
                                  ver payload
                                </summary>
                                <div className="flex justify-end mt-1">
                                  <Copiar texto={texto} rotulo="Copiar payload" />
                                </div>
                                <pre className="text-[10px] text-secundario whitespace-pre-wrap break-all
                                                bg-superficie rounded-[8px] p-2 mt-1 max-h-56 overflow-auto">
                                  {texto}
                                </pre>
                              </details>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <Estado mensagem="Nenhum passo registrado para este lead." />
                )}
              </div>

              {dados.payloads.length > 0 && (
                <div className="flex justify-end">
                  <Copiar
                    texto={JSON.stringify(dados, null, 2)}
                    rotulo="Copiar tudo deste lead"
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
