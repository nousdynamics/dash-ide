import { fmtDec } from '../lib/formato';

export function Cartao({ children, className = '' }) {
  return <div className={`cartao ${className}`}>{children}</div>;
}

/**
 * Switch — nunca checkbox, por padrão do projeto.
 *
 * É um <button role="switch">, não um input: o botão já traz ativação por
 * teclado, e o estado em aria-checked é anunciado como ligado/desligado pelo
 * leitor de tela, coisa que um checkbox estilizado com CSS perderia.
 */
export function Switch({ ligado, aoTrocar, children }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      onClick={() => aoTrocar(!ligado)}
      className="inline-flex items-center gap-2 bg-transparent border-0 p-0 cursor-pointer
                 text-xs text-secundario hover:text-primario
                 focus-visible:outline-2 focus-visible:outline-azul-400 focus-visible:outline-offset-4 rounded"
    >
      <span
        aria-hidden="true"
        className={`relative shrink-0 w-[30px] h-[17px] rounded-full border transition-colors
          ${ligado ? 'bg-azul-600 border-azul-600' : 'bg-superficie border-borda-forte'}`}
      >
        <span
          className={`absolute top-[2px] left-[2px] w-[11px] h-[11px] rounded-full transition-transform
            ${ligado ? 'translate-x-[13px] bg-white' : 'bg-tenue'}`}
        />
      </span>
      {children}
    </button>
  );
}

export function Select({ valor, aoTrocar, opcoes, rotulo }) {
  return (
    <select
      aria-label={rotulo}
      value={valor}
      onChange={(e) => aoTrocar(e.target.value)}
      className="bg-superficie text-primario border border-borda-forte rounded-[8px]
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

/**
 * Chip de variação.
 *
 * `inverso` marca métrica em que menor é melhor — custo por resultado e CPC.
 * A seta segue a direção real do número; a cor segue o significado para o
 * negócio, senão uma queda de 25% no custo apareceria em vermelho.
 */
export function ChipDelta({ pct, inverso = false }) {
  if (pct === null || pct === undefined) {
    return (
      <span
        title="Sem período anterior para comparar"
        className="inline-flex items-center gap-[3px] text-[11px] font-semibold px-[6px] py-px
                   rounded-[8px] bg-superficie text-tenue"
      >
        —
      </span>
    );
  }
  const bom = inverso ? pct < 0 : pct > 0;
  const seta = pct > 0 ? '↑' : pct < 0 ? '↓' : '→';
  const cor =
    pct === 0
      ? 'bg-superficie text-tenue'
      : bom
        ? 'bg-sucesso/12 text-sucesso'
        : 'bg-perigo/12 text-perigo';
  return (
    <span
      className={`inline-flex items-center gap-[3px] text-[11px] font-semibold px-[6px] py-px rounded-[8px] ${cor}`}
    >
      {seta} {fmtDec(Math.abs(pct))}%
    </span>
  );
}

export function Pill({ children, tom = 'neutro' }) {
  const cores = {
    sucesso: 'bg-sucesso/12 text-sucesso',
    atencao: 'bg-atencao/12 text-atencao',
    perigo: 'bg-perigo/12 text-perigo',
    neutro: 'bg-superficie text-secundario',
  };
  return (
    <span className={`inline-block px-[10px] py-[3px] rounded-[8px] text-[11px] font-semibold whitespace-nowrap ${cores[tom]}`}>
      {children}
    </span>
  );
}

export const PillStatus = ({ status }) => (
  <Pill tom={status === 'ENABLED' ? 'sucesso' : status === 'PAUSED' ? 'atencao' : 'neutro'}>
    {{ ENABLED: 'Ativa', PAUSED: 'Pausada', REMOVED: 'Excluída' }[status] || status || '—'}
  </Pill>
);

/**
 * Sanfona reutilizável.
 *
 * O cabeçalho é um <button aria-expanded> e o conteúdo só é montado quando
 * aberto — em campanha com muitos conjuntos, montar tudo de uma vez custa caro
 * e nada disso está visível.
 */
export function Sanfona({ titulo, resumo, aberta, aoAlternar, children, nivel = 1 }) {
  return (
    <div className={nivel === 1 ? 'border border-borda rounded-[12px] overflow-hidden' : 'border-t border-borda'}>
      <button
        type="button"
        aria-expanded={aberta}
        onClick={aoAlternar}
        className={`w-full flex flex-col md:flex-row md:items-center md:justify-between gap-1 md:gap-3 text-left cursor-pointer border-0
          ${nivel === 1 ? 'bg-elevado px-3 py-[10px]' : 'bg-transparent px-0 py-2'}
          hover:bg-superficie-hover focus-visible:outline-2 focus-visible:outline-azul-400 focus-visible:-outline-offset-2`}
      >
        <span className="flex items-center gap-2 min-w-0 w-full md:w-auto">
          <span
            aria-hidden="true"
            className={`text-tenue text-[10px] shrink-0 transition-transform motion-reduce:transition-none ${aberta ? 'rotate-90' : ''}`}
          >
            ▶
          </span>
          <span className="min-w-0 truncate">{titulo}</span>
        </span>
        {/* No mobile o resumo quebra em vez de empurrar a largura da linha. */}
        {resumo && (
          <span className="text-[11px] text-tenue tnum pl-[18px] md:pl-0 md:text-right md:whitespace-nowrap md:shrink-0">
            {resumo}
          </span>
        )}
      </button>
      {aberta && <div className={nivel === 1 ? 'px-3 pb-3' : 'pb-2'}>{children}</div>}
    </div>
  );
}

export function Estado({ titulo, mensagem, tipo = 'vazio' }) {
  return (
    <div className="text-center py-10 px-6 text-secundario">
      {titulo && (
        <div className={`font-semibold mb-2 text-[15px] ${tipo === 'erro' ? 'text-perigo' : 'text-primario'}`}>
          {titulo}
        </div>
      )}
      <div className="text-[13px] max-w-[420px] mx-auto">{mensagem}</div>
    </div>
  );
}

export function Esqueleto({ linhas = 3 }) {
  return (
    <Cartao>
      {Array.from({ length: linhas }, (_, i) => (
        <div
          key={i}
          className="h-4 mb-3 rounded-[8px] bg-superficie-hover animate-pulse motion-reduce:animate-none"
        />
      ))}
    </Cartao>
  );
}
