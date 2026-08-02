import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Cartao, Estado } from './base';
import { useEffect, useState } from 'react';
import { fmtDiaMes } from '../lib/formato';

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

const EIXO = { fill: '#626d7d', fontSize: 10 };

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

function Cabecalho({ titulo, est, fmt, legenda }) {
  if (!est) return <div className="text-[13px] font-semibold mb-3">{titulo}</div>;
  return (
    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-1 md:gap-4 mb-3">
      <div>
        <div className="text-[13px] font-semibold">{titulo}</div>
        <div className="text-xl font-bold tnum mt-[2px] tracking-tight">{fmt(est.media)}</div>
        <div className="text-[11px] text-tenue mt-px">
          {legenda} · {est.dias} dias
        </div>
      </div>
      <div className="text-[11px] text-tenue md:text-right leading-relaxed tnum">
        <div>
          Pico <strong className="text-secundario font-semibold">{fmt(est.max)}</strong>{' '}
          ({fmtDiaMes(est.maxData)})
        </div>
        <div>
          Mín. <strong className="text-secundario font-semibold">{fmt(est.min)}</strong>{' '}
          ({fmtDiaMes(est.minData)})
        </div>
      </div>
    </div>
  );
}

function DicaCustom({ active, payload, label, fmt }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-base border border-borda-forte rounded-[8px] px-3 py-2 text-[11px] shadow-lg">
      <div className="text-secundario">{fmtDiaMes(label)}</div>
      <div className="text-primario font-semibold tnum">{fmt(payload[0].value)}</div>
    </div>
  );
}

/** Barras diárias, com grade, média e destaque no pico. */
export function GraficoBarras({ titulo, dados, chave, fmt, fmtEixo, legenda }) {
  const estreito = useEstreito();
  const est = estatisticas(dados, chave);
  if (!est) {
    return (
      <Cartao>
        <div className="text-[13px] font-semibold mb-3">{titulo}</div>
        <Estado mensagem="Sem dados no período selecionado." />
      </Cartao>
    );
  }
  return (
    <Cartao>
      <Cabecalho titulo={titulo} est={est} fmt={fmt} legenda={legenda} />
      <ResponsiveContainer width="100%" height={estreito ? 165 : 190}>
        <BarChart data={dados} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="gradBarra" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4F8FE8" />
              <stop offset="100%" stopColor="#1D4E89" />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis
            dataKey="data"
            tickFormatter={fmtDiaMes}
            tick={EIXO}
            axisLine={false}
            tickLine={false}
            minTickGap={estreito ? 44 : 28}
          />
          <YAxis tickFormatter={fmtEixo} tick={EIXO} axisLine={false} tickLine={false} width={estreito ? 34 : 52} />
          <Tooltip content={<DicaCustom fmt={fmt} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <ReferenceLine
            y={est.media}
            stroke="#626d7d"
            strokeDasharray="4 4"
            label={
              estreito
                ? undefined
                : { value: `média ${fmt(est.media)}`, fill: '#626d7d', fontSize: 10, position: 'right' }
            }
          />
          <Bar dataKey={chave} radius={[4, 4, 0, 0]} maxBarSize={34}>
            {dados.map((d) => (
              // Só a barra do pico muda de cor — destaque seletivo, não arco-íris.
              <Cell key={d.data} fill={d[chave] === est.max ? '#7FB0F2' : 'url(#gradBarra)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Cartao>
  );
}

/** Área/linha diária, com grade e preenchimento em gradiente. */
export function GraficoArea({ titulo, dados, chave, fmt, fmtEixo, legenda }) {
  const estreito = useEstreito();
  const est = estatisticas(dados, chave);
  if (!est) {
    return (
      <Cartao>
        <div className="text-[13px] font-semibold mb-3">{titulo}</div>
        <Estado mensagem="Sem dados no período selecionado." />
      </Cartao>
    );
  }
  return (
    <Cartao>
      <Cabecalho titulo={titulo} est={est} fmt={fmt} legenda={legenda} />
      <ResponsiveContainer width="100%" height={estreito ? 165 : 190}>
        <AreaChart data={dados} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="gradArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4F8FE8" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#4F8FE8" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis
            dataKey="data"
            tickFormatter={fmtDiaMes}
            tick={EIXO}
            axisLine={false}
            tickLine={false}
            minTickGap={estreito ? 44 : 28}
          />
          <YAxis tickFormatter={fmtEixo} tick={EIXO} axisLine={false} tickLine={false} width={estreito ? 34 : 52} />
          <Tooltip content={<DicaCustom fmt={fmt} />} cursor={{ stroke: 'rgba(255,255,255,0.12)' }} />
          <Area
            type="monotone"
            dataKey={chave}
            stroke="#4F8FE8"
            strokeWidth={2}
            fill="url(#gradArea)"
            dot={false}
            activeDot={{ r: 4, stroke: '#0A0E14', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </Cartao>
  );
}
