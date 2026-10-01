import { useLayoutEffect, useRef, useState } from 'react';
import { Botao, Dica, Icone, Switch } from './base';
import {
  ATALHOS_PERIODO,
  MESES,
  MODOS,
  anosDisponiveis,
  atalhoAtivo,
  mesAtual,
  resolverPeriodo,
} from '../lib/periodo';
import { fmtDiaMes } from '../lib/formato';

/**
 * A barra de filtros do painel.
 *
 * Substitui o `FiltroPeriodo`, que era uma fileira solta de controles jogada
 * entre o título e o conteúdo. Três problemas, e a barra existe para resolver
 * os três:
 *
 *   LUGAR — os controles flutuavam sem nada que os contivesse, e em Funil ainda
 *     havia uma SEGUNDA leva de filtros dentro do cartão de baixo. Quem queria
 *     recortar o número procurava em dois lugares. Aqui tudo que filtra a tela
 *     mora numa faixa só, ancorada logo abaixo do título.
 *
 *   RECURSOS — dava para escolher mês, ano ou intervalo, e nada mais. "Mês
 *     passado" custava três cliques em dois seletores, que é justamente a
 *     comparação mais feita. Os atalhos resolvem em um.
 *
 *   ESPAÇAMENTO — o seletor de modo nascia com `w-full` e ocupava a largura da
 *     tela sozinho, empurrando o resto para uma segunda linha. Aqui não há
 *     `<select>` para o modo: virou um segmentado, que mostra as três opções de
 *     uma vez e troca com um clique em vez de dois.
 *
 * `children` é a extensão para filtros da própria tela — as seis listas do
 * Funil entram por ali, numa segunda faixa separada por um traço, sem sair da
 * barra.
 */
export function BarraFiltros({ filtro, aoTrocar, children, aoLimpar, filtrosAtivos = 0 }) {
  const { de, ate } = resolverPeriodo(filtro);
  const modo = filtro.modo ?? 'mes';
  const [anoDoMes, mesDoMes] = (filtro.mes || mesAtual()).split('-');
  const anos = anosDisponiveis();
  const atalho = atalhoAtivo(filtro);

  /*
   * Só aplica a data quando as duas pontas estão preenchidas e na ordem certa.
   * Sem isso, o primeiro caractere digitado já dispararia uma consulta com
   * intervalo inválido.
   */
  const mudarData = (campo, valor) => {
    const proximo = { ...filtro, modo: 'intervalo', [campo]: valor };
    if (!proximo.de || !proximo.ate || proximo.de > proximo.ate) return;
    aoTrocar(proximo);
  };

  /*
   * Trocar de modo já leva o período resolvido junto. Ir para Intervalo sem
   * isso abriria dois campos vazios e a tela ficaria sem dados até alguém
   * preencher os dois.
   */
  const mudarModo = (v) =>
    aoTrocar({
      ...filtro,
      modo: v,
      ...(v === 'intervalo' && !filtro.de ? { de, ate } : {}),
      ...(v === 'mes' && !filtro.mes ? { mes: mesAtual() } : {}),
      ...(v === 'ano' && !filtro.ano ? { ano: String(anos[0]) } : {}),
    });

  return (
    <div className="rounded-[14px] border border-borda bg-elevado px-3 py-2.5 shadow-[var(--shadow-cartao)] animate-surgir">
      <div className="flex items-center gap-x-3 gap-y-2.5 flex-wrap">
        {/*
          * Segmentado, não dropdown.
          *
          * São três opções fixas e curtas: mostrar as três custa o mesmo espaço
          * que o `<select>` fechado ocupava e economiza um clique em cada troca.
          * O fundo branco desliza até a opção ativa — o movimento mostra de onde
          * para onde a troca foi, em vez de a cor pular de um botão para outro.
          */}
        <Segmentado opcoes={MODOS} ativo={modo} aoTrocar={mudarModo} />

        {/* O controle que corresponde ao modo escolhido. */}
        {modo === 'mes' && (
          <span className="inline-flex gap-2 items-center shrink-0 animate-aparecer">
            <SelectCompacto
              rotulo="Mês"
              valor={mesDoMes}
              opcoes={MESES.map((nome, i) => [String(i + 1).padStart(2, '0'), nome])}
              aoTrocar={(v) => aoTrocar({ ...filtro, modo: 'mes', mes: `${anoDoMes}-${v}` })}
            />
            <SelectCompacto
              rotulo="Ano"
              valor={anoDoMes}
              opcoes={anos.map((a) => [String(a), String(a)])}
              aoTrocar={(v) => aoTrocar({ ...filtro, modo: 'mes', mes: `${v}-${mesDoMes}` })}
            />
          </span>
        )}

        {modo === 'ano' && (
          <span className="inline-flex shrink-0 animate-aparecer">
            <SelectCompacto
              rotulo="Ano"
              valor={filtro.ano ?? String(anos[0])}
              opcoes={anos.map((a) => [String(a), String(a)])}
              aoTrocar={(v) => aoTrocar({ ...filtro, modo: 'ano', ano: v })}
            />
          </span>
        )}

        {modo === 'intervalo' && (
          <span className="inline-flex gap-2 items-center shrink-0 flex-wrap animate-aparecer">
            <input
              type="date"
              aria-label="Data inicial"
              value={filtro.de || de}
              max={filtro.ate || ate}
              onChange={(e) => mudarData('de', e.target.value)}
              className={CLASSE_CAMPO}
            />
            <span className="text-secundario text-[13px]">até</span>
            <input
              type="date"
              aria-label="Data final"
              value={filtro.ate || ate}
              min={filtro.de || de}
              onChange={(e) => mudarData('ate', e.target.value)}
              className={CLASSE_CAMPO}
            />
          </span>
        )}

        <span className="w-px h-6 bg-borda shrink-0 hidden sm:block" aria-hidden="true" />

        {/* Atalhos: o que antes eram três cliques em dois seletores. */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {ATALHOS_PERIODO.map((a) => {
            const on = atalho === a.id;
            return (
              <button
                key={a.id}
                type="button"
                aria-pressed={on}
                onClick={() => aoTrocar({ ...filtro, ...a.monta() })}
                className={`inline-flex items-center gap-1 text-[12.5px] px-2.5 py-[4px] rounded-full cursor-pointer border
                  transition-colors duration-150
                  ${on
                    ? 'border-azul-400/50 bg-azul-50 text-azul-700 font-medium'
                    : 'border-borda bg-superficie text-secundario hover:text-primario hover:border-azul-400/40 hover:bg-superficie-hover'}`}
              >
                {on && <Icone nome="check" className="w-3.5 h-3.5" traco={2.2} />}
                {a.nome}
              </button>
            );
          })}
        </div>

        {/*
          * O período resolvido, sempre visível.
          *
          * É o que impede a barra de mentir: com atalho aceso ou data escolhida
          * à mão, o intervalo que está sendo consultado aparece por extenso, e
          * não é preciso deduzi-lo dos controles.
          */}
        <span className="ml-auto flex items-center gap-3 shrink-0 flex-wrap">
          <Dica conteudo="Intervalo que está sendo consultado agora, já resolvido a partir do modo ou do atalho escolhido.">
            <span
              tabIndex={0}
              className="inline-flex items-center gap-1.5 text-[13px] text-primario font-medium tnum whitespace-nowrap
                         px-2.5 py-[4px] rounded-full bg-superficie border border-borda"
            >
              <Icone nome="calendario" className="w-[15px] h-[15px] text-azul-600" />
              {fmtDiaMes(de)} a {fmtDiaMes(ate)}
            </span>
          </Dica>
          <Switch
            ligado={filtro.comparar}
            aoTrocar={(v) => aoTrocar({ ...filtro, comparar: v })}
            dica="Busca também o período imediatamente anterior, com a mesma duração, e mostra em cada número quanto ele subiu ou caiu. Passe o mouse no chip de variação para ver o valor de antes."
          >
            <span className="hidden lg:inline">Comparar com anterior</span>
            <span className="lg:hidden">Comparar</span>
          </Switch>
        </span>
      </div>

      {/* Segunda faixa: filtros da própria tela, dentro da mesma barra. */}
      {children && (
        <div className="mt-2.5 pt-2.5 border-t border-borda">
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-secundario">
              <Icone nome="filtro" className="w-[15px] h-[15px] text-azul-600" />
              Recortar por
              {filtrosAtivos > 0 && (
                <span className="text-[12px] tnum px-1.5 rounded-full bg-azul-600 text-white font-semibold">
                  {filtrosAtivos}
                </span>
              )}
            </span>
            {filtrosAtivos > 0 && aoLimpar && (
              <Botao variante="fantasma" tamanho="sm" icone="x" onClick={aoLimpar} className="shrink-0">
                Limpar {filtrosAtivos} filtro{filtrosAtivos === 1 ? '' : 's'}
              </Botao>
            )}
          </div>
          {children}
        </div>
      )}
    </div>
  );
}

const CLASSE_CAMPO =
  'bg-superficie text-primario border border-borda-forte rounded-[9px] px-2.5 py-[5px] text-[13px] font-sans ' +
  'hover:border-azul-400/50 transition-colors';

/**
 * Segmentado com indicador deslizante — o mesmo gesto das `Abas`, no tamanho
 * da barra de filtros.
 *
 * Mede a posição do botão ativo depois de montar: a largura de "Intervalo" e
 * de "Mês" depende da fonte, e um indicador de largura fixa ficaria torto.
 */
function Segmentado({ opcoes, ativo, aoTrocar }) {
  const refs = useRef({});
  const [ind, setInd] = useState(null);

  useLayoutEffect(() => {
    const el = refs.current[ativo];
    if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth });
  }, [ativo, opcoes.length]);

  return (
    <div
      role="tablist"
      aria-label="Tipo de período"
      className="relative flex gap-0.5 p-[3px] rounded-[11px] bg-superficie-hover border border-borda shrink-0"
    >
      {ind && (
        <span
          aria-hidden="true"
          className="absolute top-[3px] bottom-[3px] rounded-[8px] bg-superficie border border-azul-400/30
                     shadow-[0_1px_3px_rgba(10,14,20,0.12)] transition-all duration-300 ease-[var(--ease-saida)]"
          style={{ left: ind.left, width: ind.width }}
        />
      )}
      {opcoes.map((m) => {
        const on = ativo === m.id;
        return (
          <button
            key={m.id}
            ref={(el) => (refs.current[m.id] = el)}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => aoTrocar(m.id)}
            className={`relative z-[1] text-[13px] px-3 py-[4px] rounded-[8px] border-0 bg-transparent cursor-pointer
                        font-medium transition-colors
                        ${on ? 'text-azul-700' : 'text-secundario hover:text-primario'}`}
          >
            {m.nome}
          </button>
        );
      })}
    </div>
  );
}

/**
 * `<select>` da barra, com rótulo acessível e sem largura imposta.
 *
 * Não usa o `Select` do design system porque ali o rótulo é só `aria-label` e
 * aqui a barra precisa de controles que encolham ao conteúdo dentro de um
 * `flex` apertado — a diferença é de largura, não de aparência.
 */
function SelectCompacto({ valor, aoTrocar, opcoes, rotulo }) {
  return (
    <select
      aria-label={rotulo}
      value={valor}
      onChange={(e) => aoTrocar(e.target.value)}
      className="min-w-0 bg-superficie text-primario border border-borda-forte rounded-[9px]
                 px-2.5 py-[5px] text-[13px] font-sans cursor-pointer hover:bg-superficie-hover
                 hover:border-azul-400/50 transition-colors"
    >
      {opcoes.map(([v, r]) => (
        <option key={v} value={v}>
          {r}
        </option>
      ))}
    </select>
  );
}
