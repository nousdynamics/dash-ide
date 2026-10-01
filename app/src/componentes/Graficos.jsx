import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarraProporcao, Cartao, Estado, InfoDica, NumeroAnimado } from './base';
import { useEffect, useState } from 'react';
import { fmtDiaMes, fmtInt } from '../lib/formato';

/** Em 390px o eixo Y largo come a área de plotagem; aqui ele encolhe. */
function useEstreito() {
  const [estreito, setEstreito] = useState(
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const aoMudar = (e) => setEstreito(e.matches);
    mq.addEventListener('change', aoMudar);
    return () => mq.removeEventListener('change', aoMudar);
  }, []);
  return estreito;
}

const EIXO = { fill: '#7a8596', fontSize: 11.5 };
const GRADE = 'rgba(10,14,20,0.06)';
const CURSOR_BARRA = { fill: 'rgba(79,143,232,0.08)', radius: 6 };
const CURSOR_LINHA = { stroke: 'rgba(43,87,151,0.25)', strokeWidth: 1, strokeDasharray: '3 3' };
const ANIM = { isAnimationActive: true, animationDuration: 700, animationEasing: 'ease-out' };

/**
 * Estatísticas que o card mostra sem exigir hover: média, total e extremos.
 * O gráfico responde "como variou"; estes números respondem "quanto", que é a
 * pergunta que se faz primeiro.
 */
export function estatisticas(dados, chave) {
  const vals = (dados || []).map((d) => Number(d[chave]) || 0);
  if (!vals.length) return null;
  const total = vals.reduce((a, b) => a + b, 0);
  let iMax = 0;
  let iMin = 0;
  vals.forEach((v, i) => {
    if (v > vals[iMax]) iMax = i;
    if (v < vals[iMin]) iMin = i;
  });
  return {
    total,
    media: total / vals.length,
    max: vals[iMax],
    maxData: dados[iMax].data,
    min: vals[iMin],
    minData: dados[iMin].data,
    dias: vals.length,
  };
}

/** Título do gráfico com a explicação no "?" em vez de uma linha miúda embaixo. */
function Titulo({ titulo, dica }) {
  return (
    <div className="text-[14px] font-semibold flex items-center gap-1.5">
      {titulo}
      <InfoDica texto={dica} largura={320} />
    </div>
  );
}

function Cabecalho({ titulo, est, fmt, legenda, dica, fmtRotulo = fmtDiaMes, unidade = 'dias' }) {
  if (!est) return <div className="mb-3"><Titulo titulo={titulo} dica={dica} /></div>;
  return (
    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2 md:gap-4 mb-4">
      <div>
        <Titulo titulo={titulo} dica={dica} />
        <div className="flex items-baseline gap-2 mt-1">
          <NumeroAnimado valor={est.media} fmt={fmt} className="text-[24px] font-bold tracking-tight leading-none" />
          <span className="text-[13px] text-secundario">
            {legenda}
          </span>
        </div>
      </div>
      <div className="flex gap-2 tnum shrink-0">
        <span className="rounded-[10px] bg-elevado px-2.5 py-1.5 text-[12.5px] leading-tight">
          <span className="block text-tenue">Pico · {fmtRotulo(est.maxData)}</span>
          <strong className="font-semibold">{fmt(est.max)}</strong>
        </span>
        <span className="rounded-[10px] bg-elevado px-2.5 py-1.5 text-[12.5px] leading-tight">
          <span className="block text-tenue">Mínimo · {fmtRotulo(est.minData)}</span>
          <strong className="font-semibold">{fmt(est.min)}</strong>
        </span>
        <span className="hidden sm:block rounded-[10px] bg-elevado px-2.5 py-1.5 text-[12.5px] leading-tight">
          <span className="block text-tenue">Total · {est.dias} {unidade}</span>
          <strong className="font-semibold">{fmt(est.total)}</strong>
        </span>
      </div>
    </div>
  );
}

function DicaCustom({ active, payload, label, fmt, fmtRotulo = fmtDiaMes }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-azul-900 text-white rounded-[10px] px-3 py-2 text-[12.5px] shadow-[var(--shadow-flutuante)] min-w-[120px]">
      <div className="text-white/70">{fmtRotulo(label)}</div>
      <div className="font-semibold tnum text-[14px]">{fmt(payload[0].value)}</div>
    </div>
  );
}

/**
 * Barras diárias, com grade, média e destaque no pico.
 *
 * `fmtRotulo` existe porque o eixo nem sempre é data: o gráfico de horário usa
 * a mesma peça com "08:00" no lugar de "04/08".
 */
export function GraficoBarras({ titulo, dica, dados, chave, fmt, fmtEixo, legenda, fmtRotulo = fmtDiaMes, unidade }) {
  const estreito = useEstreito();
  const est = estatisticas(dados, chave);
  if (!est) {
    return (
      <Cartao>
        <div className="mb-3"><Titulo titulo={titulo} dica={dica} /></div>
        <Estado mensagem="Sem dados no período selecionado." />
      </Cartao>
    );
  }
  return (
    <Cartao>
      <Cabecalho titulo={titulo} dica={dica} est={est} fmt={fmt} legenda={legenda} fmtRotulo={fmtRotulo} unidade={unidade} />
      <ResponsiveContainer width="100%" height={estreito ? 165 : 190}>
        <BarChart data={dados} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="gradBarra" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4F8FE8" stopOpacity={0.85} />
              <stop offset="100%" stopColor="#2B5797" stopOpacity={0.7} />
            </linearGradient>
            <linearGradient id="gradPico" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2B5797" />
              <stop offset="100%" stopColor="#0B2545" />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRADE} vertical={false} />
          <XAxis
            dataKey="data"
            tickFormatter={fmtRotulo}
            tick={EIXO}
            axisLine={false}
            tickLine={false}
            minTickGap={estreito ? 44 : 28}
          />
          <YAxis tickFormatter={fmtEixo} tick={EIXO} axisLine={false} tickLine={false} width={estreito ? 34 : 52} />
          <Tooltip content={<DicaCustom fmt={fmt} fmtRotulo={fmtRotulo} />} cursor={CURSOR_BARRA} />
          <ReferenceLine
            y={est.media}
            stroke="#7a8596"
            strokeDasharray="4 4"
            label={
              estreito
                ? undefined
                : { value: `média ${fmt(est.media)}`, fill: '#7a8596', fontSize: 11, position: 'insideTopRight' }
            }
          />
          <Bar dataKey={chave} radius={[6, 6, 0, 0]} maxBarSize={34} {...ANIM}>
            {dados.map((d) => (
              // Só a barra do pico muda de cor — destaque seletivo, não arco-íris.
              <Cell key={d.data} fill={d[chave] === est.max ? 'url(#gradPico)' : 'url(#gradBarra)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Cartao>
  );
}

/**
 * Duas métricas de grandezas diferentes no mesmo eixo do tempo.
 *
 * Investimento em reais e resultados em unidades não cabem numa escala só — uma
 * some contra a outra. Dois eixos Y resolvem, e a pergunta que o gráfico
 * responde é a que ninguém consegue fazer olhando dois cards separados: gastar
 * mais naquele dia produziu mais?
 */
export function GraficoCombinado({ titulo, subtitulo, dica = subtitulo, dados, barra, linha }) {
  const estreito = useEstreito();
  if (!dados?.length) {
    return (
      <Cartao>
        <div className="mb-3"><Titulo titulo={titulo} dica={dica} /></div>
        <Estado mensagem="Sem dados no período selecionado." />
      </Cartao>
    );
  }
  return (
    <Cartao>
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2 mb-3">
        <Titulo titulo={titulo} dica={dica} />
        <div className="flex items-center gap-3 text-[12.5px] text-secundario shrink-0">
          <span className="inline-flex items-center gap-[6px]">
            <span aria-hidden="true" className="w-[10px] h-[10px] rounded-[3px] bg-azul-400/75" />
            {barra.rotulo}
          </span>
          <span className="inline-flex items-center gap-[6px]">
            <span aria-hidden="true" className="w-[14px] h-[2px] rounded bg-sucesso" />
            {linha.rotulo}
          </span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={estreito ? 190 : 230}>
        <ComposedChart data={dados} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRADE} vertical={false} />
          <XAxis dataKey="data" tickFormatter={fmtDiaMes} tick={EIXO} axisLine={false} tickLine={false} minTickGap={estreito ? 44 : 28} />
          <YAxis yAxisId="e" tickFormatter={barra.fmtEixo} tick={EIXO} axisLine={false} tickLine={false} width={estreito ? 34 : 52} />
          <YAxis yAxisId="d" orientation="right" tickFormatter={linha.fmtEixo} tick={EIXO} axisLine={false} tickLine={false} width={estreito ? 28 : 40} />
          <Tooltip content={<DicaDupla barra={barra} linha={linha} />} cursor={CURSOR_BARRA} />
          <Bar yAxisId="e" dataKey={barra.chave} fill="#4F8FE8" fillOpacity={0.75} radius={[6, 6, 0, 0]} maxBarSize={28} {...ANIM} />
          <Line yAxisId="d" type="monotone" dataKey={linha.chave} stroke="#1a9f5c" strokeWidth={2.5} dot={false} {...ANIM} activeDot={{ r: 5, stroke: '#ffffff', strokeWidth: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </Cartao>
  );
}

function DicaDupla({ active, payload, label, barra, linha }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload ?? {};
  return (
    <div className="bg-azul-900 text-white rounded-[10px] px-3 py-2 text-[12.5px] shadow-[var(--shadow-flutuante)] min-w-[120px]">
      <div className="text-white/70 mb-1">{fmtDiaMes(label)}</div>
      <div className="flex items-center gap-2 font-semibold tnum"><span className="w-2.5 h-2.5 rounded-[3px] bg-azul-400" />{barra.rotulo}: {barra.fmt(p[barra.chave])}</div>
      <div className="flex items-center gap-2 font-semibold tnum"><span className="w-2.5 h-[3px] rounded bg-[#5fd49a]" />{linha.rotulo}: {linha.fmt(p[linha.chave])}</div>
    </div>
  );
}

/**
 * Ranking horizontal — nome à esquerda, barra proporcional, valor à direita.
 *
 * Sem SVG: são poucas linhas com rótulo longo, e um gráfico de barras de
 * verdade cortaria "Ficha de Inscrição" no eixo ou exigiria rotacionar texto.
 */
export function Ranking({ titulo, subtitulo, dica = subtitulo, itens, rotulo, valor, fmt }) {
  if (!itens?.length) {
    return (
      <Cartao>
        <div className="mb-3"><Titulo titulo={titulo} dica={dica} /></div>
        <Estado mensagem="Nenhum lead no período." />
      </Cartao>
    );
  }
  const max = Math.max(...itens.map((i) => Number(i[valor]) || 0), 1);
  const soma = itens.reduce((a, i) => a + (Number(i[valor]) || 0), 0);
  return (
    <Cartao>
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <Titulo titulo={titulo} dica={dica} />
        <div className="text-[13px] text-secundario tnum shrink-0">
          <strong className="text-primario font-semibold">{fmt(soma)}</strong> no total
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        {itens.map((i) => {
          const v = Number(i[valor]) || 0;
          const pct = soma ? (v / soma) * 100 : 0;
          return (
            <div key={i[rotulo]} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="truncate text-primario">{i[rotulo]}</span>
                <span className="tnum shrink-0">
                  <strong className="font-semibold">{fmt(v)}</strong>
                  <span className="text-tenue"> · {Math.round(pct)}%</span>
                </span>
              </div>
              <BarraProporcao
                pct={(v / max) * 100}
                tom="azul"
                dica={`${i[rotulo]}: ${fmt(v)} — ${pct.toFixed(1).replace('.', ',')}% do total`}
              />
            </div>
          );
        })}
      </div>
    </Cartao>
  );
}

/**
 * Curva acumulada do período contra a do período anterior.
 *
 * Duas curvas subindo lado a lado dizem de relance se este período está
 * adiantado ou atrasado — leitura que o gráfico de barras diárias não dá sem
 * somar de cabeça. O eixo X é o período atual; a série anterior vem pareada por
 * índice do dia, e a data real dela aparece na dica.
 */
export function GraficoAcumulado({ titulo, subtitulo, dica = subtitulo, dados, rotuloAtual, rotuloAnterior }) {
  const estreito = useEstreito();
  if (!dados?.length) {
    return (
      <Cartao>
        <div className="mb-3"><Titulo titulo={titulo} dica={dica} /></div>
        <Estado mensagem="Sem dados no período selecionado." />
      </Cartao>
    );
  }

  return (
    <Cartao>
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2 mb-3">
        <Titulo titulo={titulo} dica={dica} />
        <div className="flex items-center gap-3 text-[12.5px] text-secundario shrink-0">
          <span className="inline-flex items-center gap-[6px]">
            <span aria-hidden="true" className="w-[14px] h-[2px] rounded bg-azul-400" />
            {rotuloAtual}
          </span>
          <span className="inline-flex items-center gap-[6px]">
            <span aria-hidden="true" className="w-[14px] h-[2px] rounded bg-tenue" />
            {rotuloAnterior}
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={estreito ? 190 : 240}>
        <AreaChart data={dados} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="gradAcum" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4F8FE8" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#4F8FE8" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRADE} vertical={false} />
          <XAxis
            dataKey="data"
            tickFormatter={fmtDiaMes}
            tick={EIXO}
            axisLine={false}
            tickLine={false}
            minTickGap={estreito ? 44 : 28}
          />
          <YAxis tick={EIXO} axisLine={false} tickLine={false} width={estreito ? 30 : 44} allowDecimals={false} />
          <Tooltip content={<DicaAcumulado />} cursor={CURSOR_LINHA} />
          {/* O anterior entra primeiro para ficar atrás — é referência, não protagonista. */}
          <Area
            type="monotone"
            dataKey="anterior"
            stroke="#7a8596"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            fill="rgba(10,14,20,0.03)"
            dot={false}
            activeDot={{ r: 3 }}
          />
          <Area
            type="monotone"
            dataKey="atual"
            stroke="#4F8FE8"
            strokeWidth={2}
            fill="url(#gradAcum)"
            dot={false}
            {...ANIM}
            activeDot={{ r: 5, stroke: '#ffffff', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </Cartao>
  );
}

function DicaAcumulado({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload ?? {};
  return (
    <div className="bg-azul-900 text-white rounded-[10px] px-3 py-2 text-[12.5px] shadow-[var(--shadow-flutuante)] min-w-[120px]">
      <div className="text-white/70 mb-1">{fmtDiaMes(label)}</div>
      <div className="font-semibold tnum">
        {fmtInt(p.atual)} acumulados
        {p.novos > 0 && <span className="text-white/70 font-normal"> · +{fmtInt(p.novos)} no dia</span>}
      </div>
      <div className="text-white/70 tnum">
        {fmtInt(p.anterior)} no anterior ({fmtDiaMes(p.data_anterior)})
      </div>
    </div>
  );
}

/** Área/linha diária, com grade e preenchimento em gradiente. */
export function GraficoArea({ titulo, dica, dados, chave, fmt, fmtEixo, legenda }) {
  const estreito = useEstreito();
  const est = estatisticas(dados, chave);
  if (!est) {
    return (
      <Cartao>
        <div className="mb-3"><Titulo titulo={titulo} dica={dica} /></div>
        <Estado mensagem="Sem dados no período selecionado." />
      </Cartao>
    );
  }
  return (
    <Cartao>
      <Cabecalho titulo={titulo} dica={dica} est={est} fmt={fmt} legenda={legenda} />
      <ResponsiveContainer width="100%" height={estreito ? 165 : 190}>
        <AreaChart data={dados} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="gradArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4F8FE8" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#4F8FE8" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRADE} vertical={false} />
          <XAxis
            dataKey="data"
            tickFormatter={fmtDiaMes}
            tick={EIXO}
            axisLine={false}
            tickLine={false}
            minTickGap={estreito ? 44 : 28}
          />
          <YAxis tickFormatter={fmtEixo} tick={EIXO} axisLine={false} tickLine={false} width={estreito ? 34 : 52} />
          <Tooltip content={<DicaCustom fmt={fmt} />} cursor={CURSOR_LINHA} />
          <Area
            type="monotone"
            dataKey={chave}
            stroke="#4F8FE8"
            strokeWidth={2}
            fill="url(#gradArea)"
            dot={false}
            {...ANIM}
            activeDot={{ r: 5, stroke: '#ffffff', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </Cartao>
  );
}
