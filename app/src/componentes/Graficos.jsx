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
import { Cartao, Estado } from './base';
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

function Cabecalho({ titulo, est, fmt, legenda, fmtRotulo = fmtDiaMes, unidade = 'dias' }) {
  if (!est) return <div className="text-[13px] font-semibold mb-3">{titulo}</div>;
  return (
    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-1 md:gap-4 mb-3">
      <div>
        <div className="text-[13px] font-semibold">{titulo}</div>
        <div className="text-xl font-bold tnum mt-[2px] tracking-tight">{fmt(est.media)}</div>
        <div className="text-[11px] text-tenue mt-px">
          {legenda} · {est.dias} {unidade}
        </div>
      </div>
      <div className="text-[11px] text-tenue md:text-right leading-relaxed tnum">
        <div>
          Pico <strong className="text-secundario font-semibold">{fmt(est.max)}</strong>{' '}
          ({fmtRotulo(est.maxData)})
        </div>
        <div>
          Mín. <strong className="text-secundario font-semibold">{fmt(est.min)}</strong>{' '}
          ({fmtRotulo(est.minData)})
        </div>
      </div>
    </div>
  );
}

function DicaCustom({ active, payload, label, fmt, fmtRotulo = fmtDiaMes }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-base border border-borda-forte rounded-[8px] px-3 py-2 text-[11px] shadow-lg">
      <div className="text-secundario">{fmtRotulo(label)}</div>
      <div className="text-primario font-semibold tnum">{fmt(payload[0].value)}</div>
    </div>
  );
}

/**
 * Barras diárias, com grade, média e destaque no pico.
 *
 * `fmtRotulo` existe porque o eixo nem sempre é data: o gráfico de horário usa
 * a mesma peça com "08:00" no lugar de "04/08".
 */
export function GraficoBarras({ titulo, dados, chave, fmt, fmtEixo, legenda, fmtRotulo = fmtDiaMes, unidade }) {
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
      <Cabecalho titulo={titulo} est={est} fmt={fmt} legenda={legenda} fmtRotulo={fmtRotulo} unidade={unidade} />
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
            tickFormatter={fmtRotulo}
            tick={EIXO}
            axisLine={false}
            tickLine={false}
            minTickGap={estreito ? 44 : 28}
          />
          <YAxis tickFormatter={fmtEixo} tick={EIXO} axisLine={false} tickLine={false} width={estreito ? 34 : 52} />
          <Tooltip content={<DicaCustom fmt={fmt} fmtRotulo={fmtRotulo} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
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

/**
 * Duas métricas de grandezas diferentes no mesmo eixo do tempo.
 *
 * Investimento em reais e resultados em unidades não cabem numa escala só — uma
 * some contra a outra. Dois eixos Y resolvem, e a pergunta que o gráfico
 * responde é a que ninguém consegue fazer olhando dois cards separados: gastar
 * mais naquele dia produziu mais?
 */
export function GraficoCombinado({ titulo, subtitulo, dados, barra, linha }) {
  const estreito = useEstreito();
  if (!dados?.length) {
    return (
      <Cartao>
        <div className="text-[13px] font-semibold mb-3">{titulo}</div>
        <Estado mensagem="Sem dados no período selecionado." />
      </Cartao>
    );
  }
  return (
    <Cartao>
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2 mb-3">
        <div>
          <div className="text-[13px] font-semibold">{titulo}</div>
          {subtitulo && <div className="text-[11px] text-tenue mt-px">{subtitulo}</div>}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-tenue shrink-0">
          <span className="inline-flex items-center gap-[6px]">
            <span aria-hidden="true" className="w-[10px] h-[10px] rounded-[3px] bg-azul-600" />
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
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="data" tickFormatter={fmtDiaMes} tick={EIXO} axisLine={false} tickLine={false} minTickGap={estreito ? 44 : 28} />
          <YAxis yAxisId="e" tickFormatter={barra.fmtEixo} tick={EIXO} axisLine={false} tickLine={false} width={estreito ? 34 : 52} />
          <YAxis yAxisId="d" orientation="right" tickFormatter={linha.fmtEixo} tick={EIXO} axisLine={false} tickLine={false} width={estreito ? 28 : 40} />
          <Tooltip content={<DicaDupla barra={barra} linha={linha} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <Bar yAxisId="e" dataKey={barra.chave} fill="#2B5797" radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Line yAxisId="d" type="monotone" dataKey={linha.chave} stroke="#3DDC84" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: '#0A0E14', strokeWidth: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </Cartao>
  );
}

function DicaDupla({ active, payload, label, barra, linha }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload ?? {};
  return (
    <div className="bg-base border border-borda-forte rounded-[8px] px-3 py-2 text-[11px] shadow-lg">
      <div className="text-secundario mb-1">{fmtDiaMes(label)}</div>
      <div className="text-azul-300 font-semibold tnum">{barra.rotulo}: {barra.fmt(p[barra.chave])}</div>
      <div className="text-sucesso font-semibold tnum">{linha.rotulo}: {linha.fmt(p[linha.chave])}</div>
    </div>
  );
}

/**
 * Ranking horizontal — nome à esquerda, barra proporcional, valor à direita.
 *
 * Sem SVG: são poucas linhas com rótulo longo, e um gráfico de barras de
 * verdade cortaria "Ficha de Inscrição" no eixo ou exigiria rotacionar texto.
 */
export function Ranking({ titulo, subtitulo, itens, rotulo, valor, fmt }) {
  if (!itens?.length) {
    return (
      <Cartao>
        <div className="text-[13px] font-semibold mb-3">{titulo}</div>
        <Estado mensagem="Nenhum lead no período." />
      </Cartao>
    );
  }
  const max = Math.max(...itens.map((i) => Number(i[valor]) || 0), 1);
  const soma = itens.reduce((a, i) => a + (Number(i[valor]) || 0), 0);
  return (
    <Cartao>
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div>
          <div className="text-[13px] font-semibold">{titulo}</div>
          {subtitulo && <div className="text-[11px] text-tenue mt-px">{subtitulo}</div>}
        </div>
        <div className="text-[11px] text-tenue tnum shrink-0">{fmt(soma)} no total</div>
      </div>
      <div className="flex flex-col gap-[6px]">
        {itens.map((i) => {
          const v = Number(i[valor]) || 0;
          return (
            <div key={i[rotulo]} className="flex items-center gap-3">
              <span className="text-[11px] text-secundario w-[38%] md:w-[30%] shrink-0 truncate" title={i[rotulo]}>
                {i[rotulo]}
              </span>
              <span className="flex-1 h-[14px] rounded-[4px] bg-superficie overflow-hidden">
                <span
                  className="block h-full rounded-[4px] bg-gradient-to-r from-azul-700 to-azul-400"
                  style={{ width: `${Math.max(2, (v / max) * 100)}%` }}
                />
              </span>
              <span className="text-[11px] font-semibold tnum shrink-0 w-[62px] text-right">
                {fmt(v)} · {soma ? Math.round((v / soma) * 100) : 0}%
              </span>
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
export function GraficoAcumulado({ titulo, subtitulo, dados, rotuloAtual, rotuloAnterior }) {
  const estreito = useEstreito();
  if (!dados?.length) {
    return (
      <Cartao>
        <div className="text-[13px] font-semibold mb-3">{titulo}</div>
        <Estado mensagem="Sem dados no período selecionado." />
      </Cartao>
    );
  }

  return (
    <Cartao>
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2 mb-3">
        <div>
          <div className="text-[13px] font-semibold">{titulo}</div>
          {subtitulo && <div className="text-[11px] text-tenue mt-px">{subtitulo}</div>}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-tenue shrink-0">
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
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis
            dataKey="data"
            tickFormatter={fmtDiaMes}
            tick={EIXO}
            axisLine={false}
            tickLine={false}
            minTickGap={estreito ? 44 : 28}
          />
          <YAxis tick={EIXO} axisLine={false} tickLine={false} width={estreito ? 30 : 44} allowDecimals={false} />
          <Tooltip content={<DicaAcumulado />} cursor={{ stroke: 'rgba(255,255,255,0.12)' }} />
          {/* O anterior entra primeiro para ficar atrás — é referência, não protagonista. */}
          <Area
            type="monotone"
            dataKey="anterior"
            stroke="#626d7d"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            fill="rgba(255,255,255,0.03)"
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
            activeDot={{ r: 4, stroke: '#0A0E14', strokeWidth: 2 }}
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
    <div className="bg-base border border-borda-forte rounded-[8px] px-3 py-2 text-[11px] shadow-lg">
      <div className="text-secundario mb-1">{fmtDiaMes(label)}</div>
      <div className="text-primario font-semibold tnum">
        {fmtInt(p.atual)} acumulados
        {p.novos > 0 && <span className="text-tenue font-normal"> · +{fmtInt(p.novos)} no dia</span>}
      </div>
      <div className="text-tenue tnum">
        {fmtInt(p.anterior)} no anterior ({fmtDiaMes(p.data_anterior)})
      </div>
    </div>
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
