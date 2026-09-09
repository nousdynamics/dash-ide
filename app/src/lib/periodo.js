/*
 * Período é mês, ano ou intervalo — as três formas que a planilha usa.
 *
 * "Últimos 30 dias" saiu: a planilha fecha por mês, e uma janela deslizante
 * nunca bate com a linha de junho da planilha nem com o mês que a diretoria
 * cobra. Quem quiser a janela solta usa Intervalo, que dá o mesmo e diz a data.
 */
export const MODOS = [
  { id: 'mes', nome: 'Mês' },
  { id: 'ano', nome: 'Ano' },
  { id: 'intervalo', nome: 'Intervalo' },
];

export const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const isoDia = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Anos oferecidos no seletor: o corrente e os dois anteriores. */
export function anosDisponiveis() {
  const atual = new Date().getFullYear();
  return [atual, atual - 1, atual - 2];
}

export const mesAtual = () => {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`;
};

/** Filtro inicial das telas. */
export const filtroPadrao = () => ({
  modo: 'mes',
  mes: mesAtual(),
  ano: String(new Date().getFullYear()),
  de: null,
  ate: null,
  comparar: true,
});

/**
 * Traduz o filtro em datas concretas.
 *
 * Mês e ano em curso param HOJE, não no fim do calendário: pedir até 31 de
 * agosto no dia 10 mandaria o Google Ads somar três semanas que não
 * aconteceram, e a série terminaria em três semanas de zero.
 */
export function resolverPeriodo(filtro) {
  const hoje = new Date();
  const ordenado = (de, ate) => (de > ate ? { de, ate: de } : { de, ate });
  const naoFuturo = (d) => (d > hoje ? hoje : d);

  if (filtro?.modo === 'ano' && filtro.ano) {
    const ano = Number(filtro.ano);
    return ordenado(
      isoDia(new Date(ano, 0, 1)),
      isoDia(naoFuturo(new Date(ano, 11, 31))),
    );
  }

  if (filtro?.modo === 'intervalo' && filtro.de && filtro.ate) {
    return ordenado(filtro.de, filtro.ate);
  }

  const [ano, mes] = (filtro?.mes || mesAtual()).split('-').map(Number);
  return ordenado(
    isoDia(new Date(ano, mes - 1, 1)),
    isoDia(naoFuturo(new Date(ano, mes, 0))),
  );
}

/** Rótulo curto do período, para cabeçalho de tela. */
export function rotuloPeriodo(filtro) {
  if (filtro?.modo === 'ano' && filtro.ano) return filtro.ano;
  if (filtro?.modo === 'intervalo') {
    const { de, ate } = resolverPeriodo(filtro);
    return `${de} a ${ate}`;
  }
  const [ano, mes] = (filtro?.mes || mesAtual()).split('-').map(Number);
  return `${MESES[mes - 1]} de ${ano}`;
}

/*
 * `de`/`ate` sempre vão, porque as rotas do Google Ads só entendem intervalo.
 * `mes`/`ano` viajam junto para quem entende calendário — é o que deixa o
 * período anterior ser o mês anterior de verdade, e não trinta dias atrás.
 */
export const queryPeriodo = (filtro) => {
  const { de, ate } = resolverPeriodo(filtro);
  const base = `de=${de}&ate=${ate}`;
  if (filtro?.modo === 'ano' && filtro.ano) return `${base}&ano=${filtro.ano}`;
  if (filtro?.modo === 'intervalo') return base;
  return `${base}&mes=${filtro?.mes || mesAtual()}`;
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

/**
 * Atalhos de período.
 *
 * Existem porque o caminho para "mês passado" eram três cliques em dois
 * seletores — escolher o modo, achar o mês, conferir o ano —, e essa é a
 * comparação que mais se faz. Um atalho é um clique e não deixa escolher um
 * intervalo impossível.
 *
 * Cada um devolve um filtro inteiro, não um pedaço: aplicar atalho troca o modo
 * junto, senão "30 dias" ficaria em modo mês e o seletor de mês continuaria
 * mandando no resultado.
 */
export const ATALHOS_PERIODO = [
  {
    id: 'este_mes',
    nome: 'Este mês',
    monta: () => ({ modo: 'mes', mes: mesAtual() }),
  },
  {
    id: 'mes_passado',
    nome: 'Mês passado',
    monta: () => {
      const h = new Date();
      const d = new Date(h.getFullYear(), h.getMonth() - 1, 1);
      return { modo: 'mes', mes: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` };
    },
  },
  {
    id: 'ultimos_7',
    nome: '7 dias',
    monta: () => janelaDeDias(7),
  },
  {
    id: 'ultimos_30',
    nome: '30 dias',
    monta: () => janelaDeDias(30),
  },
  {
    id: 'este_ano',
    nome: 'Este ano',
    monta: () => ({ modo: 'ano', ano: String(new Date().getFullYear()) }),
  },
];

/**
 * Janela que termina HOJE, não ontem.
 *
 * O padrão do Google Ads é encerrar ontem, porque o dado de hoje ainda está
 * incompleto. Aqui o atalho é explícito — quem clica em "7 dias" espera os sete
 * dias até agora —, e o card já mostra a data resolvida ao lado.
 */
function janelaDeDias(n) {
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - (n - 1) * 86_400_000);
  const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { modo: 'intervalo', de: iso(inicio), ate: iso(hoje) };
}

/**
 * Qual atalho corresponde ao filtro atual, se algum.
 *
 * Compara o período RESOLVIDO, não os campos: "01/09 a 08/09" escolhido à mão
 * no modo intervalo é o mesmo período que "Este mês", e marcar o atalho aceso
 * nos dois casos é o que faz a barra dizer a verdade sobre o que está sendo
 * mostrado.
 */
export function atalhoAtivo(filtro) {
  const atual = resolverPeriodo(filtro);
  return ATALHOS_PERIODO.find((a) => {
    const p = resolverPeriodo({ ...filtro, ...a.monta() });
    return p.de === atual.de && p.ate === atual.ate;
  })?.id ?? null;
}
