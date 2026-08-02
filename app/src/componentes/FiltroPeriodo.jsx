import { Select, Switch } from './base';
import { PRESETS, resolverPeriodo } from '../lib/periodo';

/** Barra de período compartilhada por todas as telas. */
export function FiltroPeriodo({ filtro, aoTrocar }) {
  const { de, ate } = resolverPeriodo(filtro);

  /*
   * Só aplica a data quando as duas pontas estão preenchidas e na ordem certa.
   * Sem isso, o primeiro caractere digitado já dispararia uma consulta com
   * intervalo inválido.
   */
  const mudarData = (campo, valor) => {
    const proximo = { ...filtro, preset: 'custom', [campo]: valor };
    if (!proximo.de || !proximo.ate || proximo.de > proximo.ate) return;
    aoTrocar(proximo);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Select
        rotulo="Período"
        valor={filtro.preset}
        opcoes={PRESETS.map((p) => [p.id, p.nome])}
        aoTrocar={(v) =>
          aoTrocar({ ...filtro, preset: v, ...(v === 'custom' && !filtro.de ? { de, ate } : {}) })
        }
      />

      {filtro.preset === 'custom' && (
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
