import { Switch } from './base';
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
    <div className="rounded-[12px] border border-borda bg-elevado px-3 py-2.5">
      <div className="flex items-center gap-x-3 gap-y-2 flex-wrap">
        {/*
          * Segmentado, não dropdown.
          *
          * São três opções fixas e curtas: mostrar as três custa o mesmo espaço
          * que o `<select>` fechado ocupava e economiza um clique em cada troca.
          */}
        <div
          role="tablist"
          aria-label="Tipo de período"
          className="flex gap-1 p-[3px] rounded-[10px] bg-superficie border border-borda shrink-0"
        >
          {MODOS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={modo === m.id}
              onClick={() => mudarModo(m.id)}
              className={`text-[11px] px-2.5 py-[5px] rounded-[7px] border-0 cursor-pointer font-medium
                ${modo === m.id
                  ? 'bg-azul-600 text-white'
                  : 'bg-transparent text-secundario hover:text-primario hover:bg-superficie-hover'}`}
            >
              {m.nome}
            </button>
          ))}
        </div>

        {/* O controle que corresponde ao modo escolhido. */}
        {modo === 'mes' && (
          <span className="inline-flex gap-2 items-center shrink-0">
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
          <SelectCompacto
            rotulo="Ano"
            valor={filtro.ano ?? String(anos[0])}
            opcoes={anos.map((a) => [String(a), String(a)])}
            aoTrocar={(v) => aoTrocar({ ...filtro, modo: 'ano', ano: v })}
          />
        )}

        {modo === 'intervalo' && (
          <span className="inline-flex gap-1.5 items-center shrink-0">
            <input
              type="date"
              aria-label="Data inicial"
              value={filtro.de || de}
              max={filtro.ate || ate}
              onChange={(e) => mudarData('de', e.target.value)}
              className="bg-superficie text-primario border border-borda-forte rounded-[8px]
                         px-2 py-[5px] text-xs"
            />
            <span className="text-tenue text-[11px]">até</span>
            <input
              type="date"
              aria-label="Data final"
              value={filtro.ate || ate}
              min={filtro.de || de}
              onChange={(e) => mudarData('ate', e.target.value)}
              className="bg-superficie text-primario border border-borda-forte rounded-[8px]
                         px-2 py-[5px] text-xs"
            />
          </span>
        )}

        <span className="w-px h-5 bg-borda shrink-0 hidden sm:block" aria-hidden="true" />

        {/* Atalhos: o que antes eram três cliques em dois seletores. */}
        <div className="flex items-center gap-1 flex-wrap">
          {ATALHOS_PERIODO.map((a) => (
            <button
              key={a.id}
              type="button"
              aria-pressed={atalho === a.id}
              onClick={() => aoTrocar({ ...filtro, ...a.monta() })}
              className={`text-[11px] px-2 py-[4px] rounded-[7px] cursor-pointer border
                ${atalho === a.id
                  ? 'border-azul-500 bg-azul-600/10 text-azul-700 font-medium'
                  : 'border-transparent bg-transparent text-tenue hover:text-primario hover:bg-superficie-hover'}`}
            >
              {a.nome}
            </button>
          ))}
        </div>

        {/*
          * O período resolvido, sempre visível.
          *
          * É o que impede a barra de mentir: com atalho aceso ou data escolhida
          * à mão, o intervalo que está sendo consultado aparece por extenso, e
          * não é preciso deduzi-lo dos controles.
          */}
        <span className="ml-auto flex items-center gap-3 shrink-0">
          <span className="text-[11px] text-tenue tnum whitespace-nowrap">
            {fmtDiaMes(de)} a {fmtDiaMes(ate)}
          </span>
          <Switch ligado={filtro.comparar} aoTrocar={(v) => aoTrocar({ ...filtro, comparar: v })}>
            <span className="hidden lg:inline">Comparar com anterior</span>
            <span className="lg:hidden">Comparar</span>
          </Switch>
        </span>
      </div>

      {/* Segunda faixa: filtros da própria tela, dentro da mesma barra. */}
      {children && (
        <div className="mt-2.5 pt-2.5 border-t border-borda">
          <div className="flex items-start justify-between gap-3 mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-tenue">
              Recortar por
            </span>
            {filtrosAtivos > 0 && aoLimpar && (
              <button
                type="button"
                onClick={aoLimpar}
                className="text-[11px] px-2 py-[3px] rounded-[7px] border border-borda-forte
                           bg-superficie text-secundario hover:text-primario hover:bg-superficie-hover
                           cursor-pointer shrink-0"
              >
                Limpar {filtrosAtivos} filtro{filtrosAtivos === 1 ? '' : 's'}
              </button>
            )}
          </div>
          {children}
        </div>
      )}
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
      className="min-w-0 bg-superficie text-primario border border-borda-forte rounded-[8px]
                 px-2 py-[5px] text-xs font-sans cursor-pointer hover:bg-superficie-hover"
    >
      {opcoes.map(([v, r]) => (
        <option key={v} value={v}>
          {r}
        </option>
      ))}
    </select>
  );
}
