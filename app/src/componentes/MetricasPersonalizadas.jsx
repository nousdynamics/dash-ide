import { useState } from 'react';
import { Cartao, ChipDelta, Switch } from './base';
import { avaliar, validarFormula } from '../lib/formula';
import { fmtBRL, fmtDec, fmtPct } from '../lib/formato';

const FORMATOS = { moeda: fmtBRL, numero: fmtDec, percentual: fmtPct };

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
    <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(158px,1fr))]">
      {defs.map((m) => {
        let valor = null;
        let erro = null;
        try {
          valor = avaliar(m.formula, ctx);
        } catch (e) {
          erro = e.message;
        }
        /*
         * Fórmula que usa ação de conversão não tem comparação.
         *
         * O endpoint de ações só devolve o período aberto, então o contexto
         * anterior repetiria o valor atual da ação com o investimento antigo —
         * um "antes" que nunca existiu. Melhor não mostrar do que mostrar errado.
         */
        const usaAcao = /\bacao_[a-z0-9_]+/.test(m.formula);
        let antes = null;
        if (ctxAnterior && !usaAcao) {
          try {
            antes = avaliar(m.formula, ctxAnterior);
          } catch {
            /* sem comparação é aceitável; sem valor não é */
          }
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
            {erro ? (
              <div className="text-[11px] text-perigo mt-1">{erro}</div>
            ) : (
              <>
                <div className="text-[21px] font-bold tnum my-[2px] mb-[6px] tracking-tight">
                  {valor === null ? '—' : fmt(valor)}
                </div>
                <ChipDelta pct={delta} inverso={m.inverso} />
                {antes !== null && (
                  <span className="block mt-1 text-[11px] text-tenue">
                    antes: <strong className="text-secundario font-semibold tnum">{fmt(antes)}</strong>
                  </span>
                )}
              </>
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

  let previa = null;
  if (form.formula && !problema) {
    try {
      previa = avaliar(form.formula, ctx);
    } catch {
      previa = null;
    }
  }

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

      {dados.itens.length > 0 && (
        <div className="mt-3 flex flex-col">
          {dados.itens.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-3 py-2 border-t border-borda flex-wrap">
              <div className="min-w-0">
                <div className="text-xs font-semibold">{m.nome}</div>
                <div className="text-[11px] text-tenue font-mono break-all">{m.formula}</div>
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
          ))}
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
            <select
              value={form.formato}
              onChange={(e) => setForm({ ...form, formato: e.target.value })}
              aria-label="Formato"
              className="bg-superficie text-primario border border-borda-forte rounded-[8px] px-2 py-[5px] text-xs cursor-pointer"
            >
              <option value="numero">Número</option>
              <option value="moeda">R$</option>
              <option value="percentual">%</option>
            </select>
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
            ) : previa !== null ? (
              <span className="text-sucesso">
                No período atual daria{' '}
                <strong className="tnum">{(FORMATOS[form.formato] ?? fmtDec)(previa)}</strong>
              </span>
            ) : form.formula ? (
              <span className="text-tenue">Sem valor no período (divisão por zero?)</span>
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
