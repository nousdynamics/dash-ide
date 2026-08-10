/**
 * Intervalo de datas para agregados do D1 / APIs externas.
 *
 * Aceita `mes` (yyyy-mm), `ano` (yyyy), `de`+`ate` (yyyy-mm-dd) ou o legado
 * `dias`. `ate` é inclusivo: o fim vai até 23:59:59.999 do próprio dia.
 */

export type Intervalo = {
  de: string;           // yyyy-mm-dd
  ate: string;          // yyyy-mm-dd
  inicioIso: string;
  fimIso: string;
  inicioAnteriorIso: string;
  fimAnteriorIso: string;
  dias: number;
  /** Como o período foi pedido — o rótulo da tela sai daqui. */
  tipo: 'mes' | 'ano' | 'intervalo' | 'dias';
  rotulo: string;
};

const DIA_MS = 86_400_000;

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

function parseDia(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Monta o intervalo a partir de dois marcos de calendário já resolvidos.
 *
 * O período anterior chega pronto de quem chamou, e é por isso que esta função
 * existe: para mês e ano ele é o mês/ano de calendário anterior, não "a mesma
 * quantidade de dias para trás". Junho comparado com 2 a 31 de maio — que é o
 * que a subtração de 30 dias devolve — não é comparação com maio.
 */
function montar(
  ini: Date,
  fim: Date,
  iniAnt: Date,
  fimAnt: Date,
  tipo: Intervalo['tipo'],
  rotulo: string,
): Intervalo {
  return {
    de: iso(ini),
    ate: iso(fim),
    inicioIso: ini.toISOString(),
    fimIso: new Date(fim.getTime() + DIA_MS - 1).toISOString(),
    inicioAnteriorIso: iniAnt.toISOString(),
    fimAnteriorIso: new Date(fimAnt.getTime() + DIA_MS - 1).toISOString(),
    dias: Math.round((fim.getTime() - ini.getTime()) / DIA_MS) + 1,
    tipo,
    rotulo,
  };
}

/** Último dia do mês, em UTC. Dia 0 do mês seguinte. */
const fimDoMes = (ano: number, mes0: number) => new Date(Date.UTC(ano, mes0 + 1, 0));

const hojeUtc = () => {
  const a = new Date();
  return new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()));
};

/**
 * Mês ou ano em curso param no dia de hoje, e o período anterior para no mesmo
 * ponto do calendário.
 *
 * Sem isto, "agosto" no dia 10 seria comparado com julho inteiro: dez dias
 * contra trinta e um, e toda métrica despencando por aritmética. O anterior
 * também não pode passar do último dia do próprio mês — 31 de março comparado
 * com fevereiro para no dia 28, não vaza para março.
 */
function recortarAteHoje(ini: Date, fim: Date, iniAnt: Date, fimAntCheio: Date) {
  const hoje = hojeUtc();
  if (fim <= hoje) return { fim, fimAnt: fimAntCheio };

  const diasCorridos = Math.round((hoje.getTime() - ini.getTime()) / DIA_MS);
  const fimAntEquivalente = new Date(iniAnt.getTime() + diasCorridos * DIA_MS);
  return {
    fim: hoje,
    fimAnt: fimAntEquivalente > fimAntCheio ? fimAntCheio : fimAntEquivalente,
  };
}

export function intervaloDeQuery(q: {
  mes?: string;
  ano?: string;
  de?: string;
  ate?: string;
  dias?: number;
}): Intervalo | { erro: string } {
  if (q.mes) {
    const m = /^(\d{4})-(\d{2})$/.exec(q.mes);
    if (!m) return { erro: 'mes_invalido' };
    const ano = Number(m[1]);
    const mes0 = Number(m[2]) - 1;
    if (mes0 < 0 || mes0 > 11) return { erro: 'mes_invalido' };

    const ini = new Date(Date.UTC(ano, mes0, 1));
    const iniAnt = new Date(Date.UTC(ano, mes0 - 1, 1));
    const { fim, fimAnt } = recortarAteHoje(
      ini,
      fimDoMes(ano, mes0),
      iniAnt,
      fimDoMes(ano, mes0 - 1),
    );
    return montar(ini, fim, iniAnt, fimAnt, 'mes', `${MESES[mes0]} de ${ano}`);
  }

  if (q.ano) {
    if (!/^\d{4}$/.test(q.ano)) return { erro: 'ano_invalido' };
    const ano = Number(q.ano);
    const ini = new Date(Date.UTC(ano, 0, 1));
    const iniAnt = new Date(Date.UTC(ano - 1, 0, 1));
    const { fim, fimAnt } = recortarAteHoje(
      ini,
      new Date(Date.UTC(ano, 11, 31)),
      iniAnt,
      new Date(Date.UTC(ano - 1, 11, 31)),
    );
    return montar(ini, fim, iniAnt, fimAnt, 'ano', String(ano));
  }

  if (q.de && q.ate) {
    const ini = parseDia(q.de);
    const fim = parseDia(q.ate);
    if (!ini || !fim) return { erro: 'datas_invalidas' };
    if (fim < ini) return { erro: 'intervalo_invertido' };
    const dias = Math.round((fim.getTime() - ini.getTime()) / DIA_MS) + 1;
    if (dias > 366) return { erro: 'periodo_muito_longo' };

    return montar(
      ini,
      fim,
      new Date(ini.getTime() - dias * DIA_MS),
      new Date(ini.getTime() - DIA_MS),
      'intervalo',
      `${q.de} a ${q.ate}`,
    );
  }

  /*
   * `dias` continua atendido porque outras telas ainda pedem assim. A tela de
   * funil não usa mais — lá o período é mês, ano ou intervalo.
   */
  const dias = Math.min(365, Math.max(1, Number(q.dias) || 30));
  const hoje = new Date();
  const fim = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()));
  const ini = new Date(fim.getTime() - (dias - 1) * DIA_MS);
  return montar(
    ini,
    fim,
    new Date(ini.getTime() - dias * DIA_MS),
    new Date(ini.getTime() - DIA_MS),
    'dias',
    `últimos ${dias} dias`,
  );
}
