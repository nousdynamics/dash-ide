import { Select, Switch } from './base';
import { MESES, MODOS, anosDisponiveis, mesAtual, resolverPeriodo } from '../lib/periodo';

/** Barra de período compartilhada por todas as telas: mês, ano ou intervalo. */
export function FiltroPeriodo({ filtro, aoTrocar }) {
  const { de, ate } = resolverPeriodo(filtro);
  const modo = filtro.modo ?? 'mes';
  const [anoDoMes, mesDoMes] = (filtro.mes || mesAtual()).split('-');
  const anos = anosDisponiveis();

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
    <div className="flex items-center gap-2 flex-wrap">
      <Select
        rotulo="Período"
        valor={modo}
        opcoes={MODOS.map((m) => [m.id, m.nome])}
        aoTrocar={mudarModo}
      />

      {modo === 'mes' && (
        <span className="inline-flex gap-2 items-center">
          <Select
            rotulo="Mês"
            valor={mesDoMes}
            opcoes={MESES.map((nome, i) => [String(i + 1).padStart(2, '0'), nome])}
            aoTrocar={(v) => aoTrocar({ ...filtro, modo: 'mes', mes: `${anoDoMes}-${v}` })}
          />
          <Select
            rotulo="Ano"
            valor={anoDoMes}
            opcoes={anos.map((a) => [String(a), String(a)])}
            aoTrocar={(v) => aoTrocar({ ...filtro, modo: 'mes', mes: `${v}-${mesDoMes}` })}
          />
        </span>
      )}

      {modo === 'ano' && (
        <Select
          rotulo="Ano"
          valor={filtro.ano ?? String(anos[0])}
          opcoes={anos.map((a) => [String(a), String(a)])}
          aoTrocar={(v) => aoTrocar({ ...filtro, modo: 'ano', ano: v })}
        />
      )}

      {modo === 'intervalo' && (
        <span className="inline-flex gap-2 items-center">
          <input
            type="date"
            aria-label="Data inicial"
            value={filtro.de || de}
            onChange={(e) => mudarData('de', e.target.value)}
            className="bg-superficie text-primario border border-borda-forte rounded-[8px] px-2 py-[5px] text-xs"
          />
          <span className="text-tenue text-[11px]">até</span>
          <input
            type="date"
            aria-label="Data final"
            value={filtro.ate || ate}
            onChange={(e) => mudarData('ate', e.target.value)}
            className="bg-superficie text-primario border border-borda-forte rounded-[8px] px-2 py-[5px] text-xs"
          />
        </span>
      )}

      <Switch ligado={filtro.comparar} aoTrocar={(v) => aoTrocar({ ...filtro, comparar: v })}>
        Comparar com período anterior
      </Switch>
    </div>
  );
}
