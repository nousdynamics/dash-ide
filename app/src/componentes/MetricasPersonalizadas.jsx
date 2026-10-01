import { useState } from 'react';
import {
  Botao,
  Cartao,
  CartaoKpi,
  Dica,
  Icone,
  InfoDica,
  Pill,
  Select,
  Switch,
  TituloSecao,
} from './base';
import { invalidar } from '../lib/api';
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
    // o motivo inteiro fica na dica, para quem for de fato corrigir.
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
     * para meia tela, e a fileira ficava fora do ritmo das colunas de KPI logo
     * acima. Com auto-fill a coluna tem a mesma largura lá e aqui.
     */
    <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(180px,1fr))] cascata">
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
          /*
            Sem número, o card mostra "—" e o motivo — nunca 0.
            Um "0%" aqui já passou meses sendo lido como resultado quando era
            base faltando, e a métrica só existe para ser levada a sério.

            A descrição e a fórmula, que antes ocupavam o rodapé do card, vão
            para o "?" do rótulo; o "antes" vai para a dica do chip.
          */
          <CartaoKpi
            key={m.id}
            rotulo={m.nome}
            icone={ICONE_FORMATO[m.formato] ?? 'grafico'}
            dica={<DicaMetrica m={m} />}
            texto={tipo === 'ok' ? undefined : '—'}
            valor={valor}
            fmt={fmt}
            inverso={m.inverso}
            delta={tipo === 'ok' && ctxAnterior ? delta : undefined}
            antes={tipo === 'ok' && antes !== null ? fmt(antes) : undefined}
          >
            {tipo !== 'ok' && (
              <span>
                <Pill tom={tipo === 'erro' ? 'perigo' : 'neutro'} dica={motivo}>
                  <Icone nome={tipo === 'erro' ? 'alerta' : 'info'} className="w-3.5 h-3.5" />
                  {resumo}
                </Pill>
              </span>
            )}
          </CartaoKpi>
        );
      })}
    </div>
  );
}

/** Descrição + fórmula, o conteúdo do "?" de cada métrica. */
function DicaMetrica({ m }) {
  return (
    <>
      {m.descricao && <span className="block mb-1">{m.descricao}</span>}
      <span className="block text-white/70">Fórmula</span>
      <code className="block font-mono text-[12px] break-all">{m.formula}</code>
    </>
  );
}

const ICONE_FORMATO = { moeda: 'dinheiro', numero: 'grafico', percentual: 'porcentagem' };

const VAZIA = { nome: '', formula: '', formato: 'numero', descricao: '', inverso: false, ordem: 0 };

const ROTULO_FORMATO = { moeda: 'R$', numero: 'nº', percentual: '%' };
const NOME_FORMATO = { moeda: 'Moeda (R$)', numero: 'Número', percentual: 'Percentual (%)' };

const CLASSE_CAMPO =
  'w-full min-w-0 bg-superficie text-primario border border-borda-forte rounded-[9px] px-2.5 py-[7px] text-[13px] ' +
  'hover:border-azul-400/50 focus:border-azul-400 transition-colors';

/** Rótulo de campo do formulário, com a explicação no "?". */
function Campo({ rotulo, dica, children, className = '' }) {
  return (
    <label className={`flex flex-col gap-1.5 min-w-0 ${className}`}>
      <span className="text-[12.5px] font-medium text-secundario flex items-center gap-1.5">
        {rotulo}
        <InfoDica texto={dica} />
      </span>
      {children}
    </label>
  );
}

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
  const [salvando, setSalvando] = useState(false);
  const [removendo, setRemovendo] = useState(null);
  /*
   * A lista de gerência começa fechada: os cards logo acima já mostram cada
   * métrica com o número; a lista só interessa a quem vai editar.
   */
  const [listaAberta, setListaAberta] = useState(false);

  const bases = dados?.bases ?? [];
  const nomes = bases.map((b) => b.id);
  const problema = form.formula ? validarFormula(form.formula, nomes) : null;

  const previa = form.formula && !problema ? calcular(form.formula, ctx) : null;

  const salvar = async (e) => {
    e.preventDefault();
    setErroServidor(null);
    setSalvando(true);
    try {
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
      // O cache guardaria a lista antiga e a tela voltaria sem a métrica nova.
      invalidar('/api/metricas');
      aoMudar();
    } finally {
      setSalvando(false);
    }
  };

  const remover = async (id) => {
    setRemovendo(id);
    try {
      await fetch(`/api/metricas/${id}`, { method: 'DELETE' });
      invalidar('/api/metricas');
      aoMudar();
    } finally {
      setRemovendo(null);
    }
  };

  if (!dados?.pode_editar) return null;

  const total = dados.itens.length;

  return (
    <Cartao>
      <TituloSecao
        titulo="Gerenciar métricas"
        icone="engrenagem"
        className="!mb-0 flex-wrap"
        dica="Monte a conta que você olha para decidir. Cada métrica aparece como card na Visão geral, calculada com os números do período aberto."
        extra={
          <>
            {total > 0 && (
              <Botao
                variante="fantasma"
                tamanho="sm"
                icone="lista"
                aria-expanded={listaAberta}
                onClick={() => setListaAberta((v) => !v)}
              >
                {listaAberta ? 'Ocultar lista' : `Ver lista (${total})`}
              </Botao>
            )}
            <Botao
              variante={aberto ? 'secundario' : 'primario'}
              tamanho="sm"
              icone={aberto ? 'x' : 'mais'}
              onClick={() => {
                setAberto((v) => !v);
                setEditando(null);
                setForm(VAZIA);
                setErroServidor(null);
              }}
            >
              {aberto ? 'Fechar' : 'Nova métrica'}
            </Botao>
          </>
        }
      />

      {total === 0 && !aberto && (
        <div className="mt-3 pt-3 border-t border-borda text-[13px] text-secundario flex items-center gap-2">
          <Icone nome="info" className="w-4 h-4 text-tenue" />
          Nenhuma métrica ainda. Comece por uma conta que você já faz na mão.
        </div>
      )}

      {total > 0 && listaAberta && (
        <div className="mt-3 border-t border-borda animate-surgir">
          {dados.itens.map((m, i) => {
            const { valor, tipo, motivo, resumo } = calcular(m.formula, ctx);
            const fmt = FORMATOS[m.formato] ?? fmtDec;
            return (
              <div
                key={m.id}
                className={`flex items-center justify-between gap-3 py-2.5 px-1 -mx-1 rounded-[8px] flex-wrap
                            transition-colors hover:bg-superficie-hover ${i ? 'border-t border-borda' : ''}
                            ${editando === m.id ? 'bg-azul-50' : ''}`}
              >
                <div className="min-w-0 flex-1 basis-[220px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13.5px] font-semibold">{m.nome}</span>
                    <Pill tom="neutro" dica={`Formato: ${NOME_FORMATO[m.formato] ?? m.formato}`}>
                      {ROTULO_FORMATO[m.formato] ?? m.formato}
                    </Pill>
                    {m.inverso && (
                      <Pill tom="neutro" dica="Queda aparece como boa na variação — como em custo.">
                        menor é melhor
                      </Pill>
                    )}
                  </div>
                  <code className="block text-[12px] text-secundario font-mono break-all mt-1">{m.formula}</code>
                </div>

                {/*
                  O número do card, na mesma linha da definição que o produz.
                  Sem número vai o rótulo curto, com o motivo inteiro na dica —
                  a linha é de gerência, não é onde se depura a fórmula.
                */}
                <div className="basis-[130px] shrink-0 text-right">
                  {tipo === 'ok' ? (
                    <strong className="text-[16px] font-bold tnum">{fmt(valor)}</strong>
                  ) : (
                    <Pill tom={tipo === 'erro' ? 'perigo' : 'neutro'} dica={motivo}>
                      {resumo}
                    </Pill>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <Botao
                    tamanho="sm"
                    icone="lapis"
                    onClick={() => {
                      setForm({ ...m, descricao: m.descricao ?? '' });
                      setEditando(m.id);
                      setAberto(true);
                      setErroServidor(null);
                    }}
                  >
                    Editar
                  </Botao>
                  <Botao
                    tamanho="sm"
                    variante="perigo"
                    icone="lixeira"
                    carregando={removendo === m.id}
                    onClick={() => remover(m.id)}
                  >
                    Remover
                  </Botao>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {aberto && (
        <form onSubmit={salvar} className="mt-3 pt-4 border-t border-borda flex flex-col gap-3.5 animate-surgir">
          <div className="text-[13px] font-semibold text-primario flex items-center gap-2">
            <Icone nome={editando ? 'lapis' : 'mais'} className="w-4 h-4 text-azul-600" />
            {editando ? `Editando “${form.nome || 'métrica'}”` : 'Nova métrica'}
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Campo rotulo="Nome">
              <input
                type="text"
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                placeholder="ex.: Connect rate"
                className={CLASSE_CAMPO}
              />
            </Campo>
            {/*
              * `Select` do design system, não `<select>` cru.
              *
              * Era o único lugar do painel com um seletor escrito à mão. Ele já
              * tinha divergido: com `w-full` na base, este ficava sem — e no dia
              * em que a base mudou, mudou para todo mundo menos aqui.
              */}
            <Campo rotulo="Formato" dica="Como o número aparece no card: moeda, número ou percentual.">
              <Select
                rotulo="Formato"
                valor={form.formato}
                aoTrocar={(v) => setForm({ ...form, formato: v })}
                opcoes={[['numero', 'Número'], ['moeda', 'R$'], ['percentual', '%']]}
                className="sm:min-w-[140px]"
              />
            </Campo>
          </div>

          <Campo
            rotulo="Fórmula"
            dica="Use os nomes disponíveis abaixo com as operações + − * / e parênteses. Clique num nome para inseri-lo no fim da fórmula."
          >
            <input
              type="text"
              value={form.formula}
              onChange={(e) => setForm({ ...form, formula: e.target.value })}
              placeholder="ex.: conversas_iniciadas / cliques * 100"
              className={`${CLASSE_CAMPO} font-mono`}
            />
          </Campo>

          {/* O resultado aparece enquanto digita, com os números do período aberto. */}
          {(problema || previa) && (
            <div
              className={`flex items-start gap-2 rounded-[10px] px-3 py-2 text-[13px] animate-aparecer
                ${problema || previa?.tipo === 'erro'
                  ? 'bg-perigo/8 text-perigo'
                  : previa?.tipo === 'ok'
                    ? 'bg-sucesso/10 text-sucesso'
                    : 'bg-elevado text-secundario'}`}
            >
              <Icone
                nome={problema || previa?.tipo === 'erro' ? 'alerta' : previa?.tipo === 'ok' ? 'checkCirculo' : 'info'}
                className="w-4 h-4 mt-px"
              />
              {problema ? (
                <span>{problema}</span>
              ) : previa.tipo !== 'ok' ? (
                /* O motivo exato — "sem dado no período para X" separa base que
                   não existe de divisão por zero, que pedem correções diferentes. */
                <span>{previa.motivo}</span>
              ) : (
                <span>
                  No período atual daria{' '}
                  <strong className="tnum">{(FORMATOS[form.formato] ?? fmtDec)(previa.valor)}</strong>
                </span>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-secundario flex items-center gap-1.5">
              Disponíveis
              <InfoDica texto="Totais do período aberto e cada ação de conversão da conta. Passe o mouse num nome para ver o que ele soma; clique para inserir na fórmula. Operações: + − * / e parênteses." />
            </span>
            <div className="flex flex-wrap gap-1.5">
              {bases.map((b) => (
                <Dica key={b.id} conteudo={b.ajuda}>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, formula: `${form.formula}${form.formula ? ' ' : ''}${b.id}` })}
                    className="font-mono text-[12px] text-azul-700 bg-azul-50 border border-azul-400/25 rounded-[7px]
                               px-2 py-[3px] cursor-pointer transition-colors hover:bg-azul-400/20 hover:border-azul-400/50"
                  >
                    {b.id}
                  </button>
                </Dica>
              ))}
            </div>
          </div>

          <Campo rotulo="Descrição" dica="Opcional. Aparece no “?” do card, junto com a fórmula.">
            <input
              type="text"
              value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              placeholder="Descrição curta (opcional)"
              className={CLASSE_CAMPO}
            />
          </Campo>

          <div className="flex items-center gap-x-5 gap-y-3 flex-wrap">
            <Switch
              ligado={form.inverso}
              aoTrocar={(v) => setForm({ ...form, inverso: v })}
              dica="Para métricas de custo: uma queda aparece em verde na variação, e uma alta em vermelho."
            >
              Menor é melhor (custo)
            </Switch>
            <label className="text-[13px] text-secundario flex items-center gap-2">
              Ordem
              <InfoDica texto="Posição do card entre as métricas personalizadas — menor vem primeiro." />
              <input
                type="number"
                value={form.ordem}
                onChange={(e) => setForm({ ...form, ordem: e.target.value })}
                className={`${CLASSE_CAMPO} !w-[72px] !py-[5px]`}
              />
            </label>
            <span className="flex items-center gap-2 ml-auto flex-wrap">
              {erroServidor && (
                <span className="text-[13px] text-perigo flex items-center gap-1.5">
                  <Icone nome="alerta" className="w-4 h-4" />
                  {erroServidor}
                </span>
              )}
              <Botao
                type="submit"
                variante="primario"
                icone="check"
                carregando={salvando}
                disabled={!form.nome.trim() || !form.formula.trim() || Boolean(problema)}
              >
                {editando ? 'Salvar alterações' : 'Criar métrica'}
              </Botao>
            </span>
          </div>
        </form>
      )}
    </Cartao>
  );
}
