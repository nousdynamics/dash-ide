import { useState } from 'react';
import { Cartao, ChipDelta, Switch, Select } from './base';
import { avaliar, validarFormula } from '../lib/formula';
import { fmtBRL, fmtDec, fmtPct } from '../lib/formato';

const FORMATOS = { moeda: fmtBRL, numero: fmtDec, percentual: fmtPct };

/** Mensagens do avaliador que são ausência de dado, não defeito da fórmula. */
const SEM_DADO = /^sem (dado|valor) no período/;

/**
 * O que a fórmula dá agora, ou por que não dá.
 *
 * Devolver o motivo junto com o valor é o que separa "medimos e deu zero" de
 * "não há o que medir" — os dois apareciam como número na tela, e o segundo é
 * o caso do Connect rate quando nenhuma ação de página rodou no período.
 *
 * `tipo` separa ainda ausência de erro: período sem a base não é fórmula
 * quebrada, e pintar os dois de vermelho manda a pessoa procurar defeito onde
 * não tem. Vermelho fica para o que ela pode consertar editando a conta.
 */
function calcular(formula, ctx) {
  const semNumero = (tipo, motivo) => ({
    valor: null,
    tipo,
    motivo,
    // Card e linha têm a largura de uma coluna: o rótulo curto entra na tela e
    // o motivo inteiro fica no title, para quem for de fato corrigir.
    resumo: tipo === 'erro' ? 'fórmula com erro' : 'sem dado no período',
  });
  try {
    const valor = avaliar(formula, ctx);
    if (valor !== null) return { valor, tipo: 'ok', motivo: null, resumo: null };
    return semNumero('sem_dado', 'sem valor no período (divisão por zero?)');
  } catch (e) {
    return semNumero(SEM_DADO.test(e.message) ? 'sem_dado' : 'erro', e.message);
  }
}

/**
 * Cards das métricas que a pessoa montou.
 *
 * A fórmula é avaliada no navegador, com os mesmos totais que os outros cards
 * usam — não há segunda ida ao servidor nem risco de o card divergir do resto
 * da tela por ter lido outro período.
 */
export function CardsPersonalizados({ defs, ctx, ctxAnterior }) {
  if (!defs?.length) return null;
  return (
    /*
     * auto-FILL, não auto-fit: com duas métricas o auto-fit esticava cada card
     * para meia tela, e a fileira ficava fora do ritmo das seis colunas de KPI
     * logo acima. Com auto-fill a coluna tem a mesma largura lá e aqui.
     */
    <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(158px,1fr))]">
      {defs.map((m) => {
        const { valor, tipo, motivo, resumo } = calcular(m.formula, ctx);
        /*
         * Fórmula que depende de ação / visualizações de página não tem "antes".
         * O endpoint de ações só cobre o período aberto.
         */
        const usaAcao =
          /\bacao_[a-z0-9_]+/.test(m.formula) || /\bvisualizacoes_pagina\b/.test(m.formula);
        let antes = null;
        if (ctxAnterior && !usaAcao) {
          antes = calcular(m.formula, ctxAnterior).valor;
        }
        const fmt = FORMATOS[m.formato] ?? fmtDec;
        const delta = antes && antes !== 0 && valor !== null
          ? Number((((valor - antes) / antes) * 100).toFixed(1))
          : null;

        return (
          <Cartao key={m.id}>
            <div
              className="w-[26px] h-[26px] rounded-[8px] flex items-center justify-center text-xs mb-2
                         bg-azul-400/14 text-azul-400"
              aria-hidden="true"
            >
              ƒ
            </div>
            <div className="text-[11px] text-secundario font-medium">{m.nome}</div>
            {/*
              Sem número, o card mostra "—" e o motivo — nunca 0.
              Um "0%" aqui já passou meses sendo lido como resultado quando era
              base faltando, e a métrica só existe para ser levada a sério.
            */}
            <div className="text-[21px] font-bold tnum my-[2px] mb-[6px] tracking-tight">
              {tipo === 'ok' ? fmt(valor) : '—'}
            </div>
            {tipo === 'ok' ? (
              <>
                <ChipDelta pct={delta} inverso={m.inverso} />
                {antes !== null && (
                  <span className="block mt-1 text-[11px] text-tenue">
                    antes: <strong className="text-secundario font-semibold tnum">{fmt(antes)}</strong>
                  </span>
                )}
              </>
            ) : (
              <div
                title={motivo}
                className={`text-[11px] ${tipo === 'erro' ? 'text-perigo' : 'text-tenue'}`}
              >
                {resumo}
              </div>
            )}
            <span className="block mt-2 text-[11px] text-tenue" title={m.formula}>
              {m.descricao || m.formula}
            </span>
          </Cartao>
        );
      })}
    </div>
  );
}

const VAZIA = { nome: '', formula: '', formato: 'numero', descricao: '', inverso: false, ordem: 0 };

const ROTULO_FORMATO = { moeda: 'R$', numero: 'nº', percentual: '%' };


/**
 * Editor de métrica.
 *
 * Mostra o resultado com os números do período aberto enquanto a pessoa digita.
 * Sem isso, "conversas_iniciadas / cliques * 100" é um palpite até salvar — e o
 * erro só apareceria no card, depois, para quem não escreveu a fórmula.
 */
export function EditorMetricas({ dados, ctx, aoMudar }) {
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState(VAZIA);
  const [editando, setEditando] = useState(null);
  const [erroServidor, setErroServidor] = useState(null);

  const bases = dados?.bases ?? [];
  const nomes = bases.map((b) => b.id);
  const problema = form.formula ? validarFormula(form.formula, nomes) : null;

  const previa = form.formula && !problema ? calcular(form.formula, ctx) : null;

  const salvar = async (e) => {
    e.preventDefault();
    setErroServidor(null);
    const rota = editando ? `/api/metricas/${editando}` : '/api/metricas';
    const r = await fetch(rota, {
      method: editando ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, ordem: Number(form.ordem) || 0 }),
    });
    if (!r.ok) {
      const c = await r.json().catch(() => ({}));
      setErroServidor(
        c.erro === 'nome_ja_existe' ? 'Já existe uma métrica com esse nome.'
        : c.detalhe ? String(c.detalhe) : 'Não foi possível salvar.',
      );
      return;
    }
    setForm(VAZIA);
    setEditando(null);
    setAberto(false);
    aoMudar();
  };

  const remover = async (id) => {
    await fetch(`/api/metricas/${id}`, { method: 'DELETE' });
    aoMudar();
  };

  if (!dados?.pode_editar) return null;

  return (
    <Cartao>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[13px] font-semibold">Métricas personalizadas</div>
          <div className="text-[11px] text-tenue mt-px">
            Monte a conta que você olha para decidir. Aparece como card na Visão geral.
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setAberto((v) => !v);
            setEditando(null);
            setForm(VAZIA);
          }}
          className="text-xs px-3 py-[6px] rounded-[8px] bg-azul-600 text-white border-0 cursor-pointer hover:bg-azul-500"
        >
          {aberto ? 'Fechar' : 'Nova métrica'}
        </button>
      </div>

      {dados.itens.length > 0 ? (
        <div className="mt-3 border-t border-borda">
          {dados.itens.map((m, i) => {
            const { valor, tipo, motivo, resumo } = calcular(m.formula, ctx);
            const fmt = FORMATOS[m.formato] ?? fmtDec;
            return (
              <div
                key={m.id}
                className={`flex items-start justify-between gap-3 py-[10px] flex-wrap
                            ${i ? 'border-t border-borda' : ''}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold">{m.nome}</span>
                    <span
                      title={`Formato: ${m.formato}`}
                      className="text-[10px] font-semibold px-[5px] py-px rounded-[6px] bg-superficie text-tenue"
                    >
                      {ROTULO_FORMATO[m.formato] ?? m.formato}
                    </span>
                    {m.inverso && (
                      <span
                        title="Menor é melhor"
                        className="text-[10px] font-semibold px-[5px] py-px rounded-[6px] bg-superficie text-tenue"
                      >
                        menor é melhor
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-tenue font-mono break-all mt-px">{m.formula}</div>
                </div>

                {/*
                  O número do card, na mesma linha da definição que o produz.
                  Sem número vai o rótulo curto, com o motivo inteiro no title —
                  a linha é de gerência, não é onde se depura a fórmula.
                */}
                <div className="basis-[130px] shrink-0 text-right">
                  {tipo === 'ok' ? (
                    <strong className="text-[15px] font-bold tnum">{fmt(valor)}</strong>
                  ) : (
                    <span
                      title={motivo}
                      className={`text-[11px] ${tipo === 'erro' ? 'text-perigo' : 'text-tenue'}`}
                    >
                      {resumo}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setForm({ ...m, descricao: m.descricao ?? '' });
                      setEditando(m.id);
                      setAberto(true);
                    }}
                    className="text-[11px] px-2 py-[5px] rounded-[8px] border border-borda-forte bg-superficie text-secundario cursor-pointer hover:bg-superficie-hover"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => remover(m.id)}
                    className="text-[11px] px-2 py-[5px] rounded-[8px] border border-perigo/40 bg-perigo/12 text-perigo cursor-pointer"
                  >
                    Remover
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-3 pt-3 border-t border-borda text-[11px] text-tenue">
          Nenhuma métrica ainda. Comece por uma conta que você já faz na mão.
        </div>
      )}

      {aberto && (
        <form onSubmit={salvar} className="mt-3 pt-3 border-t border-borda flex flex-col gap-2">
          <div className="flex gap-2 flex-wrap">
            <input
              type="text"
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="Nome — ex.: Connect rate"
              aria-label="Nome da métrica"
              className="bg-superficie text-primario border border-borda-forte rounded-[8px] px-2 py-[5px] text-xs flex-1 min-w-[170px]"
            />
            {/*
              * `Select` do design system, não `<select>` cru.
              *
              * Era o único lugar do painel com um seletor escrito à mão. Ele já
              * tinha divergido: com `w-full` na base, este ficava sem — e no dia
              * em que a base mudou, mudou para todo mundo menos aqui.
              */}
            <Select
              rotulo="Formato"
              valor={form.formato}
              aoTrocar={(v) => setForm({ ...form, formato: v })}
              opcoes={[['numero', 'Número'], ['moeda', 'R$'], ['percentual', '%']]}
            />
          </div>

          <input
            type="text"
            value={form.formula}
            onChange={(e) => setForm({ ...form, formula: e.target.value })}
            placeholder="Fórmula — ex.: conversas_iniciadas / cliques * 100"
            aria-label="Fórmula"
            className="bg-superficie text-primario border border-borda-forte rounded-[8px] px-2 py-[6px] text-xs font-mono"
          />

          {/* O resultado aparece enquanto digita, com os números do período aberto. */}
          <div className="text-[11px] min-h-[16px]">
            {problema ? (
              <span className="text-perigo">{problema}</span>
            ) : previa && previa.tipo !== 'ok' ? (
              /* O motivo exato — "sem dado no período para X" separa base que
                 não existe de divisão por zero, que pedem correções diferentes. */
              <span className={previa.tipo === 'erro' ? 'text-perigo' : 'text-tenue'}>{previa.motivo}</span>
            ) : previa ? (
              <span className="text-sucesso">
                No período atual daria{' '}
                <strong className="tnum">{(FORMATOS[form.formato] ?? fmtDec)(previa.valor)}</strong>
              </span>
            ) : null}
          </div>

          <input
            type="text"
            value={form.descricao}
            onChange={(e) => setForm({ ...form, descricao: e.target.value })}
            placeholder="Descrição curta, que aparece embaixo do número (opcional)"
            aria-label="Descrição"
            className="bg-superficie text-primario border border-borda-forte rounded-[8px] px-2 py-[5px] text-xs"
          />

          <div className="flex items-center gap-4 flex-wrap">
            <Switch ligado={form.inverso} aoTrocar={(v) => setForm({ ...form, inverso: v })}>
              Menor é melhor (custo)
            </Switch>
            <label className="text-[11px] text-tenue flex items-center gap-2">
              Ordem
              <input
                type="number"
                value={form.ordem}
                onChange={(e) => setForm({ ...form, ordem: e.target.value })}
                className="bg-superficie text-primario border border-borda-forte rounded-[8px] px-2 py-[3px] text-xs w-[64px]"
              />
            </label>
            <button
              type="submit"
              disabled={!form.nome.trim() || !form.formula.trim() || Boolean(problema)}
              className="text-xs px-3 py-[6px] rounded-[8px] bg-azul-600 text-white border-0 cursor-pointer
                         disabled:opacity-40 disabled:cursor-not-allowed hover:bg-azul-500"
            >
              {editando ? 'Salvar alterações' : 'Criar métrica'}
            </button>
            {erroServidor && <span className="text-[11px] text-perigo">{erroServidor}</span>}
          </div>

          <div className="text-[11px] text-tenue leading-relaxed mt-1">
            <strong className="text-secundario">Disponíveis:</strong>{' '}
            {bases.map((b, i) => (
              <span key={b.id}>
                {i > 0 && ' · '}
                <button
                  type="button"
                  title={b.ajuda}
                  onClick={() => setForm({ ...form, formula: `${form.formula}${form.formula ? ' ' : ''}${b.id}` })}
                  className="font-mono text-azul-300 bg-transparent border-0 p-0 cursor-pointer hover:underline"
                >
                  {b.id}
                </button>
              </span>
            ))}
            <br />
            Operações: <span className="font-mono">+ − * /</span> e parênteses.
          </div>
        </form>
      )}
    </Cartao>
  );
}
