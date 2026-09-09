import { useEffect, useRef, useState } from 'react';
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

/**
 * Sem largura na base — o `<select>` se ajusta ao conteúdo.
 *
 * Tinha `w-full`, e isso quebrava toda barra de filtros: dentro de um
 * `flex-wrap`, largura 100% obriga cada controle a ocupar a linha sozinho. Era
 * o que fazia o seletor de mês atravessar a tela inteira em Campanhas e os três
 * filtros empilharem um embaixo do outro.
 *
 * Quem precisa preencher a célula — grade de filtros, campo de formulário —
 * pede `className="w-full"`. É a exceção declarada no lugar de a regra
 * imposta a todo mundo.
 */
export function Select({ valor, aoTrocar, opcoes, rotulo, className = '' }) {
  return (
    <select
      aria-label={rotulo}
      value={valor}
      onChange={(e) => aoTrocar(e.target.value)}
      className={`min-w-0 bg-superficie text-primario border border-borda-forte rounded-[8px]
                 px-2 py-[5px] text-xs font-sans cursor-pointer hover:bg-superficie-hover ${className}`}
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
 * Multi-seleção com checkboxes — um filtro pode somar várias opções (ex.: Pós + Qualificação).
 * `valores` é string[]; vazio = “todas”.
 */
export function MultiSelect({
  valores = [],
  aoTrocar,
  opcoes,
  rotulo,
  rotuloVazio = 'Todas',
  className = '',
}) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef(null);

  useEffect(() => {
    if (!aberto) return undefined;
    const fechar = (e) => {
      if (raiz.current && !raiz.current.contains(e.target)) setAberto(false);
    };
    const esc = (e) => {
      if (e.key === 'Escape') setAberto(false);
    };
    document.addEventListener('mousedown', fechar);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fechar);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);

  const selecionados = new Set((valores ?? []).map(String).filter(Boolean));
  const rotulosSel = opcoes
    .filter(([v]) => v !== '' && selecionados.has(String(v)))
    .map(([, r]) => r);

  let texto = rotuloVazio;
  if (rotulosSel.length === 1) texto = rotulosSel[0];
  else if (rotulosSel.length === 2) texto = rotulosSel.join(', ');
  else if (rotulosSel.length > 2) texto = `${rotulosSel.length} selecionados`;

  const alternar = (v) => {
    const id = String(v);
    if (!id) {
      aoTrocar([]);
      return;
    }
    const prox = new Set(selecionados);
    if (prox.has(id)) prox.delete(id);
    else prox.add(id);
    aoTrocar([...prox]);
  };

  return (
    <div ref={raiz} className={`relative min-w-0 ${className}`}>
      <button
        type="button"
        aria-label={rotulo}
        aria-expanded={aberto}
        aria-haspopup="listbox"
        onClick={() => setAberto((a) => !a)}
        className="w-full min-w-0 flex items-center justify-between gap-1 bg-superficie text-primario
                   border border-borda-forte rounded-[8px] px-2 py-[5px] text-xs font-sans
                   cursor-pointer hover:bg-superficie-hover text-left"
      >
        <span className="truncate">{texto}</span>
        <span className="text-tenue shrink-0 text-[10px]" aria-hidden="true">
          {aberto ? '▴' : '▾'}
        </span>
      </button>
      {aberto && (
        <div
          role="listbox"
          aria-multiselectable="true"
          aria-label={rotulo}
          className="absolute z-40 left-0 right-0 mt-1 max-h-56 overflow-auto rounded-[8px]
                     border border-borda-forte bg-elevado shadow-lg py-1"
        >
          <button
            type="button"
            role="option"
            aria-selected={selecionados.size === 0}
            onClick={() => {
              aoTrocar([]);
              setAberto(false);
            }}
            className={`w-full text-left px-2.5 py-1.5 text-xs border-0 cursor-pointer
              ${selecionados.size === 0 ? 'bg-azul-600/15 text-azul-700' : 'bg-transparent text-secundario hover:bg-superficie-hover hover:text-primario'}`}
          >
            {rotuloVazio}
          </button>
          {opcoes
            .filter(([v]) => v !== '')
            .map(([v, r]) => {
              const on = selecionados.has(String(v));
              return (
                <button
                  key={v}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => alternar(v)}
                  className={`w-full flex items-center gap-2 text-left px-2.5 py-1.5 text-xs border-0 cursor-pointer
                    ${on ? 'bg-azul-600/15 text-primario' : 'bg-transparent text-secundario hover:bg-superficie-hover hover:text-primario'}`}
                >
                  <span
                    aria-hidden="true"
                    className={`shrink-0 w-3.5 h-3.5 rounded-[4px] border flex items-center justify-center text-[9px]
                      ${on ? 'bg-azul-600 border-azul-600 text-white' : 'border-borda-forte bg-superficie'}`}
                  >
                    {on ? '✓' : ''}
                  </span>
                  <span className="truncate">{r}</span>
                </button>
              );
            })}
        </div>
      )}
    </div>
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
 * Seta de abrir/fechar.
 *
 * Era o caractere "▶" — o único ícone destas telas desenhado com glifo de
 * fonte, e o triângulo cheio pesava ao lado do texto, que é o que a pessoa está
 * lendo. Pior: U+25B6 tem variante de emoji, então em parte dos aparelhos a
 * lista aparecia com um triângulo colorido no começo de cada linha.
 *
 * Chevron em SVG, no mesmo traço dos ícones da navegação (24×24, pontas
 * arredondadas): acompanha `currentColor`, não depende de fonte instalada e
 * some visualmente até a hora em que é procurado.
 *
 * Mora aqui, e não na tela de Campanhas, porque a linha da campanha e a sanfona
 * de dentro dela aparecem uma embaixo da outra — duas setas diferentes no mesmo
 * quadro se leem como dois controles diferentes.
 */
export function SetaSanfona({ aberta, className = '' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`w-[13px] h-[13px] shrink-0 text-tenue transition-transform
        motion-reduce:transition-none ${aberta ? 'rotate-90' : ''} ${className}`}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

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
          <SetaSanfona aberta={aberta} />
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

/**
 * Diálogo modal — usado para tirar da tela o que só se lê de vez em quando.
 *
 * `<dialog>` nativo em vez de div com overlay: ele traz de fábrica o que uma
 * reimplementação sempre esquece — foco preso dentro do diálogo, Esc fechando,
 * o resto da página marcado como inerte para leitor de tela e a pilha de
 * empilhamento acima de qualquer `z-index` da página.
 *
 * O `::backdrop` é estilizado no CSS global, que é o único lugar de onde ele
 * pode ser alcançado.
 */
export function Modal({ aberto, aoFechar, titulo, descricao, children, largura = '640px' }) {
  const ref = useRef(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return undefined;
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) d.close();
    return undefined;
  }, [aberto]);

  /*
   * `close` cobre as saídas que não passam pelo botão — Esc, e o clique fora
   * tratado abaixo. Sem escutar o evento, o estado do pai continuaria "aberto"
   * e o diálogo não reabriria no clique seguinte.
   */
  useEffect(() => {
    const d = ref.current;
    if (!d) return undefined;
    const aoCancelar = () => aoFechar();
    d.addEventListener('close', aoCancelar);
    return () => d.removeEventListener('close', aoCancelar);
  }, [aoFechar]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-titulo"
      onClick={(e) => {
        // Clique no backdrop: o alvo é o próprio <dialog>, não o conteúdo.
        if (e.target === ref.current) aoFechar();
      }}
      className="m-auto p-0 border-0 bg-transparent max-h-[85vh] w-[calc(100vw-2rem)]"
      style={{ maxWidth: largura }}
    >
      <div className="bg-superficie border border-borda rounded-[12px] shadow-xl overflow-hidden">
        <div className="flex items-start justify-between gap-4 px-4 py-3 border-b border-borda bg-elevado">
          <div className="min-w-0">
            <h2 id="modal-titulo" className="text-[13px] font-semibold m-0">{titulo}</h2>
            {descricao && <p className="text-[11px] text-tenue mt-1 mb-0 leading-relaxed">{descricao}</p>}
          </div>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="w-7 h-7 shrink-0 rounded-[8px] border border-borda bg-superficie text-secundario
                       flex items-center justify-center cursor-pointer text-[15px] leading-none
                       hover:bg-superficie-hover hover:text-primario"
          >
            ×
          </button>
        </div>
        <div className="px-4 py-3 overflow-y-auto max-h-[calc(85vh-56px)]">{children}</div>
      </div>
    </dialog>
  );
}

/** Botão só de ícone, com rótulo acessível — abre painéis auxiliares. */
export function BotaoIcone({ aoClicar, titulo, children, tom = 'neutro' }) {
  const cor = tom === 'atencao'
    ? 'border-atencao/40 bg-atencao/12 text-atencao hover:bg-atencao/20'
    : 'border-borda-forte bg-superficie text-secundario hover:bg-superficie-hover hover:text-primario';
  return (
    <button
      type="button"
      onClick={aoClicar}
      title={titulo}
      aria-label={titulo}
      className={`w-8 h-8 shrink-0 rounded-[8px] border flex items-center justify-center
                  cursor-pointer ${cor}`}
    >
      {children}
    </button>
  );
}
