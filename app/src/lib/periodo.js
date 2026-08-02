export const PRESETS = [
  { id: '7d', nome: 'Últimos 7 dias' },
  { id: '30d', nome: 'Últimos 30 dias' },
  { id: '90d', nome: 'Últimos 90 dias' },
  { id: 'mes', nome: 'Este mês' },
  { id: 'mes_anterior', nome: 'Mês passado' },
  { id: 'custom', nome: 'Período personalizado' },
];

const isoDia = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Traduz o filtro em datas concretas.
 *
 * "Últimos N dias" termina ONTEM, não hoje: o Google Ads fecha o dia no fuso da
 * conta, e o parcial de hoje entraria como queda falsa no último ponto da série.
 */
export function resolverPeriodo(filtro) {
  const hoje = new Date();
  const ontem = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);

  /*
   * Trava de sanidade: nenhum preset devolve início depois do fim. O caso real
   * é "Este mês" no dia 1º — o mês começa hoje mas "ontem" ainda é do mês
   * anterior, e o intervalo saía invertido (ex.: 01/08 a 31/07).
   */
  const ordenado = (de, ate) => (de > ate ? { de, ate: de } : { de, ate });

  if (filtro.preset === 'custom' && filtro.de && filtro.ate) return ordenado(filtro.de, filtro.ate);

  if (filtro.preset === 'mes') {
    return ordenado(isoDia(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), isoDia(ontem));
  }
  if (filtro.preset === 'mes_anterior') {
    const ini = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    const fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
    return ordenado(isoDia(ini), isoDia(fim));
  }

  const dias = { '7d': 7, '30d': 30, '90d': 90 }[filtro.preset] ?? 30;
  const ini = new Date(ontem.getFullYear(), ontem.getMonth(), ontem.getDate() - (dias - 1));
  return ordenado(isoDia(ini), isoDia(ontem));
}

export const queryPeriodo = (filtro) => {
  const { de, ate } = resolverPeriodo(filtro);
  return `de=${de}&ate=${ate}`;
};

/** O /api/overview do D1 ainda raciocina em dias, não em intervalo. */
export function diasDoPeriodo(filtro) {
  const { de, ate } = resolverPeriodo(filtro);
  const d =
    Math.round((new Date(`${ate}T00:00:00Z`) - new Date(`${de}T00:00:00Z`)) / 86400000) + 1;
  return Math.min(365, Math.max(1, d));
}

/**
 * Preenche com zero os dias sem registro dentro da janela.
 *
 * A API só devolve dias que têm linha. Plotar direto espaça os pontos por
 * índice em vez de por data: três dias sem conversão viram o mesmo passo
 * horizontal que um dia, e a linha mente sobre o ritmo.
 */
export function densificarPorDia(dados, de, ate) {
  if (!dados?.length) return [];
  const porData = new Map(dados.map((d) => [String(d.data).slice(0, 10), d]));
  const ini = new Date(`${de}T00:00:00`);
  const fim = new Date(`${ate}T00:00:00`);
  if (Number.isNaN(ini) || Number.isNaN(fim) || fim < ini) return dados;

  const chaves = Object.keys(dados[0]).filter((k) => k !== 'data');
  const saida = [];
  for (const d = new Date(ini); d <= fim; d.setDate(d.getDate() + 1)) {
    const iso = isoDia(d);
    const linha = porData.get(iso);
    saida.push(linha ?? { data: iso, ...Object.fromEntries(chaves.map((k) => [k, 0])) });
  }
  return saida;
}
