/**
 * Intervalo de datas para agregados do D1 / APIs externas.
 *
 * Aceita `de`+`ate` (yyyy-mm-dd) ou o legado `dias`. Fim do dia atual no
 * intervalo custom: `ate` é inclusivo até 23:59:59 UTC-ish via ISO no fim.
 */

export type Intervalo = {
  de: string;           // yyyy-mm-dd
  ate: string;          // yyyy-mm-dd
  inicioIso: string;
  fimIso: string;
  inicioAnteriorIso: string;
  fimAnteriorIso: string;
  dias: number;
};

const DIA_MS = 86_400_000;

function parseDia(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function intervaloDeQuery(q: {
  de?: string;
  ate?: string;
  dias?: number;
}): Intervalo | { erro: string } {
  if (q.de && q.ate) {
    const ini = parseDia(q.de);
    const fim = parseDia(q.ate);
    if (!ini || !fim) return { erro: 'datas_invalidas' };
    if (fim < ini) return { erro: 'intervalo_invertido' };
    const dias = Math.round((fim.getTime() - ini.getTime()) / DIA_MS) + 1;
    if (dias > 366) return { erro: 'periodo_muito_longo' };

    const fimIso = new Date(fim.getTime() + DIA_MS - 1).toISOString();
    const inicioIso = ini.toISOString();
    const inicioAnterior = new Date(ini.getTime() - dias * DIA_MS);
    const fimAnteriorIso = new Date(ini.getTime() - 1).toISOString();

    return {
      de: q.de,
      ate: q.ate,
      inicioIso,
      fimIso,
      inicioAnteriorIso: inicioAnterior.toISOString(),
      fimAnteriorIso,
      dias,
    };
  }

  const dias = Math.min(365, Math.max(1, Number(q.dias) || 30));
  const agora = new Date();
  const inicio = new Date(agora.getTime() - dias * DIA_MS);
  const inicioAnterior = new Date(agora.getTime() - 2 * dias * DIA_MS);
  const de = inicio.toISOString().slice(0, 10);
  const ate = agora.toISOString().slice(0, 10);
  return {
    de,
    ate,
    inicioIso: inicio.toISOString(),
    fimIso: agora.toISOString(),
    inicioAnteriorIso: inicioAnterior.toISOString(),
    fimAnteriorIso: inicio.toISOString(),
    dias,
  };
}
