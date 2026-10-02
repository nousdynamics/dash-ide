import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fmtDec } from '../lib/formato';
import { Icone } from './icones';

export { Icone } from './icones';

/**
 * Cartão base.
 *
 * `interativo` é só para cartão que responde a clique: ele sobe no hover, e
 * levantar o que não reage promete uma ação que não existe. O resto das props
 * passa direto para a `<div>` — `style`, `onClick`, `role`, o que a tela
 * precisar.
 */
export function Cartao({ children, className = '', interativo = false, ...resto }) {
  return (
    <div className={`cartao ${interativo ? 'cartao-interativo' : ''} ${className}`} {...resto}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Dica (tooltip)                                                           */
/* ------------------------------------------------------------------------ */

/**
 * Dica flutuante — o lugar da explicação que antes ocupava a tela como texto
 * miúdo embaixo de cada número.
 *
 * Portal no `body` com posição fixa: dentro do cartão ela seria cortada por
 * qualquer `overflow: hidden` do caminho (tabela rolável, sanfona). Abre por
 * cima e vira para baixo quando não cabe; encosta nas bordas da janela em vez
 * de sair dela.
 *
 * Abre com o mouse e com o foco do teclado — dica que só o mouse vê some para
 * quem navega por Tab. `aria-describedby` liga o texto ao elemento para o
 * leitor de tela.
 *
 * Sem `conteudo`, devolve o filho sem embrulho: quem monta a dica condicional
 * não precisa de um `if` em volta.
 */
export function Dica({ conteudo, children, lado = 'cima', atraso = 150, largura = 280, className = '', tocavel = false }) {
  const id = useId();
  const ancora = useRef(null);
  const balao = useRef(null);
  const timer = useRef(null);
  const [aberta, setAberta] = useState(false);
  const [pos, setPos] = useState(null);

  const abrir = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setAberta(true), atraso);
  }, [atraso]);
  const fechar = useCallback(() => {
    clearTimeout(timer.current);
    setAberta(false);
    setPos(null);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  // Mede depois de montar: a altura do balão depende do texto.
  useLayoutEffect(() => {
    if (!aberta || !ancora.current || !balao.current) return;
    const a = ancora.current.getBoundingClientRect();
    const b = balao.current.getBoundingClientRect();
    const margem = 8;
    let emCima = lado === 'cima';
    if (emCima && a.top - b.height - margem < 4) emCima = false;
    if (!emCima && a.bottom + b.height + margem > window.innerHeight - 4 && a.top - b.height - margem > 4) emCima = true;
    const top = emCima ? a.top - b.height - margem : a.bottom + margem;
    let left = a.left + a.width / 2 - b.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - b.width - 8));
    const seta = Math.max(12, Math.min(a.left + a.width / 2 - left, b.width - 12));
    setPos({ top, left, emCima, seta });
  }, [aberta, lado, conteudo]);

  // Rolar a página com a dica aberta a deixaria solta no lugar antigo.
  useEffect(() => {
    if (!aberta) return undefined;
    const aoRolar = () => fechar();
    const aoTeclar = (e) => e.key === 'Escape' && fechar();
    const aoClicarFora = (e) => {
      if (ancora.current && !ancora.current.contains(e.target)) fechar();
    };
    window.addEventListener('scroll', aoRolar, true);
    window.addEventListener('keydown', aoTeclar);
    if (tocavel) document.addEventListener('pointerdown', aoClicarFora);
    return () => {
      window.removeEventListener('scroll', aoRolar, true);
      window.removeEventListener('keydown', aoTeclar);
      document.removeEventListener('pointerdown', aoClicarFora);
    };
  }, [aberta, fechar, tocavel]);

  if (conteudo === null || conteudo === undefined || conteudo === '' || conteudo === false) return children;

  return (
    <span
      ref={ancora}
      className={`inline-flex max-w-full ${className}`}
      onMouseEnter={abrir}
      onMouseLeave={fechar}
      onFocus={abrir}
      onBlur={fechar}
      // Toque abre (celular não tem hover); fecha pelo toque fora, Esc ou rolagem.
      onClick={tocavel ? () => setAberta(true) : undefined}
      aria-describedby={aberta ? id : undefined}
    >
      {children}
      {aberta &&
        createPortal(
          <div
            ref={balao}
            id={id}
            role="tooltip"
            style={{
              position: 'fixed',
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              maxWidth: largura,
              visibility: pos ? 'visible' : 'hidden',
            }}
            className="z-[100] pointer-events-none px-3 py-2 rounded-[10px] bg-azul-900 text-white
                       text-[12.5px] leading-snug font-normal shadow-[var(--shadow-flutuante)]
                       animate-escala whitespace-normal text-left"
          >
            {conteudo}
            {pos && (
              <span
                aria-hidden="true"
                className="absolute w-2 h-2 bg-azul-900 rotate-45"
                style={{ left: pos.seta - 4, [pos.emCima ? 'bottom' : 'top']: -4 }}
              />
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}

/**
 * Ícone de ajuda com dica — o "?" discreto ao lado de um título ou número.
 *
 * É um `<button>` para receber foco e abrir no toque: no celular não há hover,
 * e a explicação precisa continuar alcançável.
 */
export function InfoDica({ texto, titulo, className = '', tamanho = 'w-[15px] h-[15px]', largura }) {
  if (!texto) return null;
  const conteudo = titulo ? (
    <>
      <span className="block font-semibold mb-0.5">{titulo}</span>
      <span className="block text-white/85">{texto}</span>
    </>
  ) : (
    texto
  );
  return (
    <Dica conteudo={conteudo} tocavel largura={largura}>
      <button
        type="button"
        aria-label={typeof texto === 'string' ? `Ajuda: ${texto}` : 'Ajuda'}
        className={`inline-flex items-center justify-center p-0 border-0 bg-transparent cursor-help
                    text-tenue hover:text-azul-600 transition-colors rounded-full align-middle ${className}`}
      >
        <Icone nome="ajuda" className={tamanho} traco={2} />
      </button>
    </Dica>
  );
}

/* ------------------------------------------------------------------------ */
/* Números                                                                   */
/* ------------------------------------------------------------------------ */

const semMovimento = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Número que conta até o valor novo em vez de trocar de uma vez.
 *
 * Parte do valor anterior, não do zero: ao trocar o período, o KPI desliza de
 * R$ 12 mil para R$ 15 mil, e o movimento em si já diz "subiu". Valor vazio
 * (null/NaN) passa direto pelo `fmt`, que desenha o "—".
 */
export function NumeroAnimado({ valor, fmt = (n) => String(n), duracao = 700, className = '' }) {
  const n = Number(valor);
  const valido = valor !== null && valor !== undefined && Number.isFinite(n);
  // Começa do zero na primeira montagem: o número "sobe" ao chegar.
  const [exibido, setExibido] = useState(valido ? (semMovimento() ? n : 0) : null);
  const anterior = useRef(valido ? 0 : null);

  useEffect(() => {
    if (!valido) {
      setExibido(null);
      return undefined;
    }
    const de = anterior.current ?? 0;
    anterior.current = n;
    if (semMovimento() || de === n) {
      setExibido(n);
      return undefined;
    }
    let quadro;
    const inicio = performance.now();
    const passo = (agora) => {
      const t = Math.min(1, (agora - inicio) / duracao);
      const e = 1 - Math.pow(1 - t, 3);
      setExibido(de + (n - de) * e);
      if (t < 1) quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [n, valido, duracao]);

  return <span className={`tnum ${className}`}>{fmt(valido ? exibido : valor)}</span>;
}

/* ------------------------------------------------------------------------ */
/* Cabeçalhos e agrupamento                                                  */
/* ------------------------------------------------------------------------ */

/**
 * Título da tela. A explicação do que a tela faz vai na dica, não num
 * parágrafo abaixo do título — quem abre a tela todo dia já sabe, e quem não
 * sabe tem o "?" ao lado.
 */
export function CabecalhoPagina({ titulo, descricao, subtitulo, acoes, icone }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 animate-surgir">
      <div className="min-w-0 flex items-center gap-3">
        {icone && (
          <span
            aria-hidden="true"
            className="hidden sm:flex w-10 h-10 rounded-[12px] items-center justify-center shrink-0
                       bg-gradient-to-br from-azul-600 to-azul-400 text-white shadow-[0_6px_16px_rgba(43,87,151,0.28)]"
          >
            <Icone nome={icone} className="w-5 h-5" />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="m-0 text-[22px] font-semibold tracking-tight flex items-center gap-2 leading-tight">
            {titulo}
            <InfoDica texto={descricao} tamanho="w-[17px] h-[17px]" largura={340} />
          </h1>
          {subtitulo && <div className="text-secundario text-[13px] mt-0.5 tnum">{subtitulo}</div>}
        </div>
      </div>
      {acoes && <div className="flex items-center gap-2 flex-wrap shrink-0">{acoes}</div>}
    </div>
  );
}

/** Título de cartão ou de bloco, com a explicação na dica. */
export function TituloSecao({ titulo, dica, extra, icone, className = '', como: Tag = 'h2' }) {
  return (
    <div className={`flex items-center justify-between gap-3 mb-3 ${className}`}>
      <Tag className="m-0 text-[14px] font-semibold flex items-center gap-1.5 min-w-0">
        {icone && (
          <span className="text-azul-600">
            <Icone nome={icone} className="w-4 h-4" />
          </span>
        )}
        <span className="truncate">{titulo}</span>
        <InfoDica texto={dica} />
      </Tag>
      {extra && <div className="shrink-0 flex items-center gap-2 text-[13px] text-secundario">{extra}</div>}
    </div>
  );
}

/**
 * Grupo de conteúdo com rótulo — separa "o que é resultado" de "o que é
 * alcance" sem precisar de um cartão em volta de cartões.
 */
export function Secao({ titulo, dica, extra, icone, children, className = '' }) {
  return (
    <section className={`flex flex-col gap-3 ${className}`}>
      {titulo && (
        <div className="flex items-center justify-between gap-3 pt-2">
          <h2 className="m-0 text-[15px] font-semibold flex items-center gap-2 text-primario">
            {icone && (
              <span className="w-6 h-6 rounded-[7px] bg-azul-50 text-azul-600 flex items-center justify-center">
                <Icone nome={icone} className="w-[14px] h-[14px]" />
              </span>
            )}
            {titulo}
            <InfoDica texto={dica} />
          </h2>
          {extra && <div className="flex items-center gap-2 text-[13px] text-secundario">{extra}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * Cartão de indicador.
 *
 * `valor` é número cru + `fmt`, para o número poder contar até o valor novo.
 * Quem só tem texto pronto passa `texto` no lugar.
 *
 * O que antes eram duas linhas de texto miúdo embaixo do número — "antes: X" e
 * o rodapé explicando a fórmula — vira dica: no chip de variação e no "?" do
 * rótulo.
 */
export function CartaoKpi({
  rotulo,
  valor,
  fmt,
  texto,
  delta,
  inverso,
  antes,
  dica,
  icone,
  tom = 'azul',
  aoClicar,
  compacto = false,
  children,
}) {
  const tons = {
    azul: 'bg-azul-400/14 text-azul-600',
    sucesso: 'bg-sucesso/12 text-sucesso',
    atencao: 'bg-atencao/12 text-atencao',
    perigo: 'bg-perigo/12 text-perigo',
    neutro: 'bg-elevado text-secundario',
  };
  return (
    <Cartao
      interativo={Boolean(aoClicar)}
      onClick={aoClicar}
      className={`@container flex flex-col ${compacto ? 'gap-1.5 !p-4' : 'gap-2'}`}
    >
      <div className="flex items-center justify-between gap-2">
        {/* Quebra em duas linhas em vez de cortar: "Custo por conversão" virava "Custo por …". */}
        <span className="text-[13px] text-secundario font-medium flex items-center gap-1.5 min-w-0 leading-tight">
          <span className="line-clamp-2">{rotulo}</span>
          <InfoDica texto={dica} />
        </span>
        {icone && (
          <span
            aria-hidden="true"
            className={`w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 ${tons[tom] || tons.azul}`}
          >
            <Icone nome={icone} className="w-[17px] h-[17px]" />
          </span>
        )}
      </div>
      {/* Tamanho pela largura do cartão, não da tela: na fileira de seis o cartão é estreito até no desktop. */}
      <div
        className={`${compacto ? 'text-[18px] @[200px]:text-[20px]' : 'text-[19px] @[190px]:text-[22px] @[230px]:text-[26px]'} font-bold tracking-tight leading-none tnum whitespace-nowrap`}
      >
        {texto !== undefined ? texto : <NumeroAnimado valor={valor} fmt={fmt} />}
      </div>
      {(delta !== undefined || antes) && (
        <div className="flex items-center gap-2 flex-wrap">
          {delta !== undefined && <ChipDelta pct={delta} inverso={inverso} antes={antes} />}
        </div>
      )}
      {children}
    </Cartao>
  );
}

/**
 * Abas em pílula com o indicador deslizando até a aba ativa.
 *
 * Para agrupar conteúdo da mesma tela ("Resumo / Por curso / Por origem") em
 * vez de empilhar tudo numa rolagem sem fim.
 */
export function Abas({ abas, ativa, aoTrocar, rotulo = 'Seções', className = '' }) {
  const refs = useRef({});
  const [ind, setInd] = useState(null);

  useLayoutEffect(() => {
    const el = refs.current[ativa];
    if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth });
  }, [ativa, abas.length]);

  return (
    <div
      role="tablist"
      aria-label={rotulo}
      className={`relative inline-flex gap-1 p-1 rounded-[12px] bg-elevado border border-borda max-w-full overflow-x-auto ${className}`}
    >
      {ind && (
        <span
          aria-hidden="true"
          className="absolute top-1 bottom-1 rounded-[9px] bg-superficie shadow-[0_1px_3px_rgba(10,14,20,0.12)]
                     transition-all duration-300 ease-[var(--ease-saida)]"
          style={{ left: ind.left, width: ind.width }}
        />
      )}
      {abas.map((a) => {
        const on = a.id === ativa;
        return (
          <button
            key={a.id}
            ref={(el) => (refs.current[a.id] = el)}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => aoTrocar(a.id)}
            className={`relative z-[1] flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-[9px]
                        text-[13px] font-medium border-0 bg-transparent cursor-pointer transition-colors
                        ${on ? 'text-primario' : 'text-secundario hover:text-primario'}`}
          >
            {a.icone && <Icone nome={a.icone} className="w-[15px] h-[15px]" />}
            {a.nome}
            {a.contagem !== undefined && a.contagem !== null && (
              <span
                className={`text-[11.5px] tnum px-1.5 rounded-full ${on ? 'bg-azul-600 text-white' : 'bg-borda text-secundario'}`}
              >
                {a.contagem}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Barra proporcional — o traço de ranking, participação e progresso.
 * Cresce da esquerda ao montar; `dica` explica o número ao passar o mouse.
 */
export function BarraProporcao({ pct, tom = 'azul', altura = 'h-2', dica, className = '' }) {
  const cores = {
    azul: 'bg-gradient-to-r from-azul-600 to-azul-400',
    sucesso: 'bg-gradient-to-r from-[#137a47] to-sucesso',
    atencao: 'bg-gradient-to-r from-[#9c6308] to-atencao',
    perigo: 'bg-gradient-to-r from-[#a8321f] to-perigo',
    neutro: 'bg-tenue/60',
  };
  const largura = Math.max(0, Math.min(100, Number(pct) || 0));
  const barra = (
    <span className={`block w-full ${altura} rounded-full bg-elevado overflow-hidden ${className}`}>
      <span
        className={`block h-full rounded-full barra-cresce ${cores[tom] || cores.azul}`}
        style={{ width: `${largura > 0 ? Math.max(1.5, largura) : 0}%` }}
      />
    </span>
  );
  return dica ? (
    <Dica conteudo={dica} className="w-full">
      {barra}
    </Dica>
  ) : (
    barra
  );
}

/* ------------------------------------------------------------------------ */
/* Controles                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * Switch — nunca checkbox, por padrão do projeto.
 *
 * É um <button role="switch">, não um input: o botão já traz ativação por
 * teclado, e o estado em aria-checked é anunciado como ligado/desligado pelo
 * leitor de tela, coisa que um checkbox estilizado com CSS perderia.
 */
export function Switch({ ligado, aoTrocar, children, dica, desativado = false }) {
  const botao = (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      disabled={desativado}
      onClick={() => aoTrocar(!ligado)}
      className="inline-flex items-center gap-2 bg-transparent border-0 p-0 cursor-pointer
                 text-[13px] text-secundario hover:text-primario disabled:opacity-50 disabled:cursor-not-allowed
                 focus-visible:outline-2 focus-visible:outline-azul-400 focus-visible:outline-offset-4 rounded"
    >
      <span
        aria-hidden="true"
        className={`relative shrink-0 w-[34px] h-[20px] rounded-full border transition-colors duration-200
          ${ligado ? 'bg-azul-600 border-azul-600' : 'bg-elevado border-borda-forte'}`}
      >
        <span
          className={`absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full shadow-sm transition-transform duration-200 ease-[var(--ease-saida)]
            ${ligado ? 'translate-x-[14px] bg-white' : 'bg-white border border-borda-forte'}`}
        />
      </span>
      {children}
    </button>
  );
  return dica ? <Dica conteudo={dica}>{botao}</Dica> : botao;
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
    <span className={`relative inline-flex min-w-0 ${className}`}>
      <select
        aria-label={rotulo}
        value={valor}
        onChange={(e) => aoTrocar(e.target.value)}
        className="w-full min-w-0 appearance-none bg-superficie text-primario border border-borda-forte rounded-[9px]
                   pl-2.5 pr-7 py-[6px] text-[13px] font-sans cursor-pointer hover:bg-superficie-hover
                   hover:border-azul-400/50 transition-colors"
      >
        {opcoes.map(([v, r]) => (
          <option key={v} value={v}>
            {r}
          </option>
        ))}
      </select>
      <Icone
        nome="chevronBaixo"
        className="w-[14px] h-[14px] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-tenue"
      />
    </span>
  );
}

/** Minúsculas e sem acento — "estetica" acha "Estética". */
const normalizar = (t) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Rótulo com o trecho buscado em negrito — mostra por que a opção apareceu. */
function Realce({ texto, termo }) {
  const t = String(texto ?? '');
  if (!termo) return t;
  const i = normalizar(t).indexOf(normalizar(termo));
  if (i < 0) return t;
  return (
    <>
      {t.slice(0, i)}
      <mark className="bg-azul-400/20 text-inherit rounded-[3px] px-px">{t.slice(i, i + termo.length)}</mark>
      {t.slice(i + termo.length)}
    </>
  );
}

/**
 * Multi-seleção — um filtro pode somar várias opções (ex.: Pós + Qualificação).
 * `valores` é string[]; vazio = "todas".
 *
 * `opcoes` aceita `[valor, rotulo]` ou `[valor, rotulo, { grupo, detalhe, busca }]`:
 * `grupo` separa a lista em blocos com título, `detalhe` é a linha cinza abaixo
 * do rótulo e `busca` é texto extra que a digitação também encontra (código,
 * modalidade) sem precisar aparecer.
 *
 * A lista abre em portal, com posição fixa. Dentro da barra de filtros ela
 * ficava presa no empilhamento do cartão: as abas que vinham depois na página
 * eram pintadas por cima e cobriam as opções. No `body` não há nada acima dela.
 *
 * A marca de selecionado é um ✓ solto, não uma caixinha: caixa com check lê
 * como checkbox, e o painel não usa checkbox.
 */
export function MultiSelect({
  valores = [],
  aoTrocar,
  opcoes,
  rotulo,
  rotuloVazio = 'Todas',
  className = '',
  buscavel,
  placeholderBusca = 'Digite para buscar…',
}) {
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState('');
  const [foco, setFoco] = useState(-1);
  const [pos, setPos] = useState(null);
  const gatilho = useRef(null);
  const painel = useRef(null);
  const campo = useRef(null);
  const lista = useRef(null);
  const idLista = useId();

  const todas = opcoes.filter(([v]) => v !== '' && v !== null && v !== undefined);
  // Com poucas opções a busca só ocupa espaço; com muitas, é o jeito de achar.
  const comBusca = buscavel ?? todas.length > 7;

  const selecionados = new Set((valores ?? []).map(String).filter(Boolean));
  const rotulosSel = todas.filter(([v]) => selecionados.has(String(v))).map(([, r]) => r);

  let texto = rotuloVazio;
  if (rotulosSel.length === 1) texto = rotulosSel[0];
  else if (rotulosSel.length === 2) texto = rotulosSel.join(', ');
  else if (rotulosSel.length > 2) texto = `${rotulosSel.length} selecionados`;
  // Valor salvo que não está mais entre as opções (ex.: oferta fora da categoria escolhida).
  else if (selecionados.size > 0) texto = `${selecionados.size} selecionado${selecionados.size > 1 ? 's' : ''}`;

  const t = normalizar(termo.trim());
  const visiveis = t
    ? todas.filter(([v, r, extra]) => normalizar(`${r} ${extra?.detalhe ?? ''} ${extra?.busca ?? ''} ${v}`).includes(t))
    : todas;

  const fechar = useCallback(() => {
    setAberto(false);
    setTermo('');
    setFoco(-1);
    setPos(null);
  }, []);

  const medir = useCallback(() => {
    const g = gatilho.current;
    if (!g) return;
    const a = g.getBoundingClientRect();
    const largura = Math.min(Math.max(a.width, 300), 420, window.innerWidth - 16);
    const alturaMax = 380;
    const abaixo = window.innerHeight - a.bottom - 12;
    const acima = a.top - 12;
    const paraCima = abaixo < 260 && acima > abaixo;
    const left = Math.max(8, Math.min(a.left, window.innerWidth - largura - 8));
    setPos({
      left,
      largura,
      paraCima,
      top: paraCima ? undefined : a.bottom + 6,
      bottom: paraCima ? window.innerHeight - a.top + 6 : undefined,
      altura: Math.min(alturaMax, paraCima ? acima : abaixo),
    });
  }, []);

  useLayoutEffect(() => {
    if (aberto) medir();
  }, [aberto, medir]);

  useEffect(() => {
    if (!aberto) return undefined;
    const aoClicarFora = (e) => {
      if (gatilho.current?.contains(e.target) || painel.current?.contains(e.target)) return;
      fechar();
    };
    // Acompanha a página em vez de fechar: rolar com a lista aberta é comum em tela longa.
    window.addEventListener('scroll', medir, true);
    window.addEventListener('resize', medir);
    document.addEventListener('pointerdown', aoClicarFora);
    return () => {
      window.removeEventListener('scroll', medir, true);
      window.removeEventListener('resize', medir);
      document.removeEventListener('pointerdown', aoClicarFora);
    };
  }, [aberto, medir, fechar, comBusca]);

  // Foca a busca só depois de medir: antes disso o painel está `hidden` e recusa foco.
  const medido = Boolean(pos);
  useEffect(() => {
    if (aberto && medido && comBusca) campo.current?.focus({ preventScroll: true });
  }, [aberto, medido, comBusca]);

  // Mantém a opção destacada pelo teclado dentro da área visível da lista.
  useEffect(() => {
    if (foco < 0) return;
    lista.current?.querySelector(`[data-indice="${foco}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [foco]);

  const alternar = (v) => {
    const id = String(v);
    const prox = new Set(selecionados);
    if (prox.has(id)) prox.delete(id);
    else prox.add(id);
    aoTrocar([...prox]);
  };

  const selecionarVisiveis = () => {
    const prox = new Set(selecionados);
    visiveis.forEach(([v]) => prox.add(String(v)));
    aoTrocar([...prox]);
  };

  const aoTeclar = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      fechar();
      gatilho.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFoco((f) => Math.min(visiveis.length - 1, f + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFoco((f) => Math.max(0, f - 1));
    } else if (e.key === 'Enter' && foco >= 0 && visiveis[foco]) {
      e.preventDefault();
      alternar(visiveis[foco][0]);
    }
  };

  const ativo = selecionados.size > 0;

  // Agrupa preservando a ordem em que os grupos aparecem nas opções.
  const blocos = [];
  visiveis.forEach((o, i) => {
    const g = o[2]?.grupo ?? '';
    let b = blocos[blocos.length - 1];
    if (!b || b.grupo !== g) {
      b = blocos.find((x) => x.grupo === g);
      if (!b) {
        b = { grupo: g, itens: [] };
        blocos.push(b);
      }
    }
    b.itens.push([o, i]);
  });

  return (
    <div className={`relative min-w-0 ${className}`}>
      <button
        ref={gatilho}
        type="button"
        aria-label={rotulo}
        aria-expanded={aberto}
        aria-haspopup="listbox"
        aria-controls={aberto ? idLista : undefined}
        onClick={() => (aberto ? fechar() : setAberto(true))}
        onKeyDown={(e) => {
          if (!aberto && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setAberto(true);
          } else if (aberto) aoTeclar(e);
        }}
        className={`w-full min-w-0 flex items-center justify-between gap-1.5 text-primario
                   border rounded-[9px] px-2.5 py-[6px] text-[13px] font-sans
                   cursor-pointer text-left transition-colors
                   ${aberto ? 'ring-2 ring-azul-400/30 border-azul-400/60' : ''}
                   ${ativo ? 'bg-azul-50 border-azul-400/50' : 'bg-superficie border-borda-forte hover:bg-superficie-hover'}`}
      >
        <span className={`truncate ${ativo ? 'font-medium text-azul-700' : ''}`}>{texto}</span>
        <span className="flex items-center gap-1 shrink-0">
          {selecionados.size > 1 && (
            <span className="text-[11.5px] tnum px-1.5 rounded-full bg-azul-600 text-white">{selecionados.size}</span>
          )}
          <Icone
            nome="chevronBaixo"
            className={`w-[14px] h-[14px] text-tenue transition-transform duration-200 ${aberto ? 'rotate-180' : ''}`}
          />
        </span>
      </button>

      {aberto &&
        createPortal(
          <div
            ref={painel}
            onKeyDown={aoTeclar}
            style={{
              position: 'fixed',
              left: pos?.left ?? -9999,
              top: pos?.top,
              bottom: pos?.bottom,
              width: pos?.largura ?? 300,
              maxHeight: pos?.altura ?? 380,
              visibility: pos ? 'visible' : 'hidden',
            }}
            className={`z-[95] flex flex-col rounded-[12px] border border-borda-forte bg-superficie
                        shadow-[var(--shadow-flutuante)] overflow-hidden animate-escala
                        ${pos?.paraCima ? 'origin-bottom' : 'origin-top'}`}
          >
            {comBusca && (
              <div className="p-2 border-b border-borda">
                <div className="relative">
                  <Icone nome="busca" className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-tenue pointer-events-none" />
                  <input
                    ref={campo}
                    type="search"
                    value={termo}
                    onChange={(e) => {
                      setTermo(e.target.value);
                      setFoco(0);
                    }}
                    placeholder={placeholderBusca}
                    aria-label={`Buscar em ${rotulo}`}
                    aria-controls={idLista}
                    className="w-full bg-elevado border border-borda rounded-[8px] pl-8 pr-2 py-[7px] text-[13px]
                               outline-none focus:border-azul-400/60 focus:bg-superficie"
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-borda text-[12.5px] text-secundario">
              <span className="tnum">
                {t ? `${visiveis.length} de ${todas.length}` : `${todas.length} opç${todas.length === 1 ? 'ão' : 'ões'}`}
                {ativo && <> · <strong className="text-azul-700 font-semibold">{selecionados.size} marcada{selecionados.size > 1 ? 's' : ''}</strong></>}
              </span>
              <span className="flex items-center gap-1">
                {visiveis.length > 1 && (
                  <button
                    type="button"
                    onClick={selecionarVisiveis}
                    className="px-1.5 py-0.5 rounded-[6px] border-0 bg-transparent text-azul-600 hover:bg-azul-50 cursor-pointer font-medium"
                  >
                    {t ? 'Marcar estes' : 'Marcar todas'}
                  </button>
                )}
                {ativo && (
                  <button
                    type="button"
                    onClick={() => aoTrocar([])}
                    className="px-1.5 py-0.5 rounded-[6px] border-0 bg-transparent text-secundario hover:text-perigo hover:bg-perigo/8 cursor-pointer font-medium"
                  >
                    Limpar
                  </button>
                )}
              </span>
            </div>

            <div
              ref={lista}
              id={idLista}
              role="listbox"
              aria-multiselectable="true"
              aria-label={rotulo}
              className="overflow-y-auto overscroll-contain p-1 flex-1 min-h-0"
            >
              {!t && (
                <button
                  type="button"
                  role="option"
                  aria-selected={!ativo}
                  onClick={() => {
                    aoTrocar([]);
                    fechar();
                  }}
                  className={`w-full flex items-center gap-2 text-left px-2.5 py-1.5 rounded-[7px] text-[13px] border-0 cursor-pointer
                    ${!ativo ? 'bg-azul-50 text-azul-700 font-medium' : 'bg-transparent text-secundario hover:bg-superficie-hover hover:text-primario'}`}
                >
                  <span className="w-4 shrink-0 text-azul-600">{!ativo && <Icone nome="check" className="w-4 h-4" traco={2.2} />}</span>
                  {rotuloVazio}
                </button>
              )}

              {visiveis.length === 0 && (
                <div className="px-3 py-6 text-center text-[13px] text-secundario">
                  Nada encontrado para “{termo.trim()}”.
                </div>
              )}

              {blocos.map((b) => (
                <div key={b.grupo || '_'} role={b.grupo ? 'group' : undefined} aria-label={b.grupo || undefined}>
                  {b.grupo && (
                    <div className="sticky top-0 z-[1] bg-superficie/95 backdrop-blur-sm px-2.5 pt-2 pb-1 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-tenue">
                      {b.grupo} <span className="font-normal normal-case tracking-normal">· {b.itens.length}</span>
                    </div>
                  )}
                  {b.itens.map(([[v, r, extra], i]) => {
                    const on = selecionados.has(String(v));
                    return (
                      <button
                        key={v}
                        type="button"
                        role="option"
                        aria-selected={on}
                        data-indice={i}
                        onClick={() => alternar(v)}
                        onMouseEnter={() => setFoco(i)}
                        className={`w-full flex items-start gap-2 text-left px-2.5 py-1.5 rounded-[7px] text-[13px] border-0 cursor-pointer
                          ${foco === i ? 'bg-superficie-hover' : on ? 'bg-azul-50' : 'bg-transparent'}
                          ${on ? 'text-primario font-medium' : 'text-secundario hover:text-primario'}`}
                      >
                        <span className="w-4 shrink-0 text-azul-600 mt-px">{on && <Icone nome="check" className="w-4 h-4" traco={2.2} />}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block leading-snug break-words">
                            <Realce texto={r} termo={termo.trim()} />
                          </span>
                          {extra?.detalhe && (
                            <span className="block text-[12px] text-tenue font-normal leading-snug mt-0.5">
                              <Realce texto={extra.detalhe} termo={termo.trim()} />
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Pílulas e chips                                                           */
/* ------------------------------------------------------------------------ */

/**
 * Chip de variação.
 *
 * `inverso` marca métrica em que menor é melhor — custo por resultado e CPC.
 * A seta segue a direção real do número; a cor segue o significado para o
 * negócio, senão uma queda de 25% no custo apareceria em vermelho.
 *
 * `antes` (o valor do período anterior, já formatado) vai na dica do chip — a
 * variação responde "quanto", a dica responde "em relação a quê".
 */
export function ChipDelta({ pct, inverso = false, antes }) {
  if (pct === null || pct === undefined) {
    return (
      <Dica conteudo={antes ? `Período anterior: ${antes}` : 'Sem período anterior para comparar'}>
        <span
          className="inline-flex items-center gap-[3px] text-[12px] font-semibold px-2 py-0.5
                     rounded-full bg-elevado text-tenue"
        >
          —
        </span>
      </Dica>
    );
  }
  const bom = inverso ? pct < 0 : pct > 0;
  const cor =
    pct === 0
      ? 'bg-elevado text-tenue'
      : bom
        ? 'bg-sucesso/12 text-sucesso'
        : 'bg-perigo/12 text-perigo';
  const icone = pct > 0 ? 'tendencia' : pct < 0 ? 'queda' : null;
  return (
    <Dica
      conteudo={
        <>
          {pct > 0 ? 'Subiu' : pct < 0 ? 'Caiu' : 'Estável'} {fmtDec(Math.abs(pct))}% em relação ao período anterior
          {antes && (
            <>
              {' '}
              (<strong className="font-semibold tnum">{antes}</strong>)
            </>
          )}
          {pct !== 0 && <span className="block text-white/70 mt-0.5">{bom ? 'Movimento bom para o negócio' : 'Movimento ruim para o negócio'}</span>}
        </>
      }
    >
      <span className={`inline-flex items-center gap-1 text-[12px] font-semibold px-2 py-0.5 rounded-full tnum ${cor}`}>
        {icone ? <Icone nome={icone} className="w-3.5 h-3.5" traco={2.2} /> : '→'}
        {fmtDec(Math.abs(pct))}%
      </span>
    </Dica>
  );
}

export function Pill({ children, tom = 'neutro', dica, ponto = false }) {
  const cores = {
    sucesso: 'bg-sucesso/12 text-sucesso',
    atencao: 'bg-atencao/12 text-atencao',
    perigo: 'bg-perigo/12 text-perigo',
    azul: 'bg-azul-400/14 text-azul-700',
    neutro: 'bg-elevado text-secundario',
  };
  const pill = (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-[3px] rounded-full text-[12px] font-semibold whitespace-nowrap ${cores[tom] || cores.neutro}`}
    >
      {ponto && <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
  return dica ? <Dica conteudo={dica}>{pill}</Dica> : pill;
}

export const PillStatus = ({ status }) => (
  <Pill ponto tom={status === 'ENABLED' ? 'sucesso' : status === 'PAUSED' ? 'atencao' : 'neutro'}>
    {{ ENABLED: 'Ativa', PAUSED: 'Pausada', REMOVED: 'Excluída' }[status] || status || '—'}
  </Pill>
);

/* ------------------------------------------------------------------------ */
/* Sanfona                                                                   */
/* ------------------------------------------------------------------------ */

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
      className={`w-[14px] h-[14px] shrink-0 text-tenue transition-transform duration-200
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
    <div
      className={
        nivel === 1
          ? `border rounded-[12px] overflow-hidden transition-[border-color,box-shadow] duration-200
             ${aberta ? 'border-azul-400/40 shadow-[var(--shadow-cartao)]' : 'border-borda'}`
          : 'border-t border-borda'
      }
    >
      <button
        type="button"
        aria-expanded={aberta}
        onClick={aoAlternar}
        className={`w-full flex flex-col md:flex-row md:items-center md:justify-between gap-1 md:gap-3 text-left cursor-pointer border-0
          text-[13.5px] transition-colors
          ${nivel === 1 ? `${aberta ? 'bg-azul-50' : 'bg-elevado'} px-3.5 py-[11px]` : 'bg-transparent px-0 py-2'}
          hover:bg-superficie-hover focus-visible:outline-2 focus-visible:outline-azul-400 focus-visible:-outline-offset-2`}
      >
        <span className="flex items-center gap-2 min-w-0 w-full md:w-auto">
          <SetaSanfona aberta={aberta} />
          <span className="min-w-0 truncate">{titulo}</span>
        </span>
        {/* No mobile o resumo quebra em vez de empurrar a largura da linha. */}
        {resumo && (
          <span className="text-[12.5px] text-secundario tnum pl-[22px] md:pl-0 md:text-right md:whitespace-nowrap md:shrink-0">
            {resumo}
          </span>
        )}
      </button>
      {aberta && <div className={`animate-surgir ${nivel === 1 ? 'px-3.5 pb-3.5 pt-1' : 'pb-2'}`}>{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Estados                                                                   */
/* ------------------------------------------------------------------------ */

export function Estado({ titulo, mensagem, tipo = 'vazio', icone, acao }) {
  const nome = icone || (tipo === 'erro' ? 'alerta' : 'caixa');
  return (
    <div className="flex flex-col items-center text-center py-10 px-6 text-secundario animate-aparecer">
      <span
        aria-hidden="true"
        className={`w-11 h-11 rounded-full flex items-center justify-center mb-3
          ${tipo === 'erro' ? 'bg-perigo/10 text-perigo' : 'bg-elevado text-tenue'}`}
      >
        <Icone nome={nome} className="w-5 h-5" />
      </span>
      {titulo && (
        <div className={`font-semibold mb-1 text-[15px] ${tipo === 'erro' ? 'text-perigo' : 'text-primario'}`}>
          {titulo}
        </div>
      )}
      {mensagem && <div className="text-[13.5px] max-w-[440px] mx-auto">{mensagem}</div>}
      {acao && <div className="mt-4">{acao}</div>}
    </div>
  );
}

/** Retângulo de esqueleto com brilho — a peça dos esqueletos maiores. */
export function Bloco({ className = 'h-4 w-full', style }) {
  return <span aria-hidden="true" style={style} className={`block rounded-[8px] brilho ${className}`} />;
}

export function Esqueleto({ linhas = 3 }) {
  return (
    <Cartao aria-busy="true" aria-label="Carregando">
      {Array.from({ length: linhas }, (_, i) => (
        <Bloco key={i} className={`h-4 mb-3 last:mb-0 ${['w-full', 'w-11/12', 'w-4/5', 'w-2/3'][i % 4]}`} />
      ))}
    </Cartao>
  );
}

/**
 * Esqueleto no formato da tela — fileira de indicadores e blocos de gráfico.
 *
 * O esqueleto genérico de linhas cinzas não parece com nada que vem depois, e
 * a tela "pula" quando o conteúdo chega. Este tem o desenho aproximado do
 * painel: a troca vira um preenchimento, não uma mudança de layout.
 */
export function EsqueletoPagina({ kpis = 4, graficos = 2, tabela = false }) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Carregando">
      {kpis > 0 && (
        <div className="grid gap-3 grade-kpi">
          {Array.from({ length: kpis }, (_, i) => (
            <Cartao key={i} className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <Bloco className="h-3.5 w-24" />
                <Bloco className="h-8 w-8 !rounded-[10px]" />
              </div>
              <Bloco className="h-7 w-28" />
              <Bloco className="h-5 w-16 !rounded-full" />
            </Cartao>
          ))}
        </div>
      )}
      {graficos > 0 && (
        <div className={`grid gap-3 ${graficos > 1 ? 'lg:grid-cols-2' : ''}`}>
          {Array.from({ length: graficos }, (_, i) => (
            <Cartao key={i} className="flex flex-col gap-3">
              <Bloco className="h-4 w-40" />
              <div className="flex items-end gap-2 h-[170px]">
                {[45, 70, 55, 85, 60, 95, 50, 75, 65, 80, 40, 70].map((h, j) => (
                  <Bloco key={j} className="flex-1 !rounded-[4px]" style={{ height: `${h}%` }} />
                ))}
              </div>
            </Cartao>
          ))}
        </div>
      )}
      {tabela && (
        <Cartao className="flex flex-col gap-3">
          <Bloco className="h-4 w-48" />
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Bloco className="h-8 w-8 !rounded-full" />
              <Bloco className="h-4 flex-1" />
              <Bloco className="h-4 w-20" />
            </div>
          ))}
        </Cartao>
      )}
    </div>
  );
}

/**
 * Véu de "atualizando" sobre conteúdo que já está na tela.
 *
 * Ao trocar o filtro, o número antigo fica visível (esmaecido) até o novo
 * chegar — em vez de a tela inteira virar esqueleto e perder o lugar de quem
 * estava lendo.
 */
export function Atualizando({ ativo, children, className = '' }) {
  return (
    <div
      aria-busy={ativo || undefined}
      className={`transition-opacity duration-300 ${ativo ? 'opacity-55 pointer-events-none' : 'opacity-100'} ${className}`}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Modal e botões                                                            */
/* ------------------------------------------------------------------------ */

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
  const idTitulo = useId();

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
      aria-labelledby={idTitulo}
      onClick={(e) => {
        // Clique no backdrop: o alvo é o próprio <dialog>, não o conteúdo.
        if (e.target === ref.current) aoFechar();
      }}
      className="m-auto p-0 border-0 bg-transparent max-h-[85vh] w-[calc(100vw-2rem)] overflow-visible"
      style={{ maxWidth: largura }}
    >
      <div className="bg-superficie border border-borda rounded-[16px] shadow-[var(--shadow-flutuante)] overflow-hidden">
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-borda bg-elevado">
          <div className="min-w-0">
            <h2 id={idTitulo} className="text-[15px] font-semibold m-0">{titulo}</h2>
            {descricao && <p className="text-[13px] text-secundario mt-1 mb-0 leading-relaxed">{descricao}</p>}
          </div>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="w-8 h-8 shrink-0 rounded-[9px] border border-borda bg-superficie text-secundario
                       flex items-center justify-center cursor-pointer
                       hover:bg-superficie-hover hover:text-primario transition-colors"
          >
            <Icone nome="x" className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto max-h-[calc(85vh-64px)]">{children}</div>
      </div>
    </dialog>
  );
}

/** Botão só de ícone, com rótulo acessível e dica — abre painéis auxiliares. */
export function BotaoIcone({ aoClicar, titulo, children, tom = 'neutro', icone }) {
  const cor = tom === 'atencao'
    ? 'border-atencao/40 bg-atencao/12 text-atencao hover:bg-atencao/20'
    : 'border-borda-forte bg-superficie text-secundario hover:bg-superficie-hover hover:text-primario hover:border-azul-400/40';
  return (
    <Dica conteudo={titulo}>
      <button
        type="button"
        onClick={aoClicar}
        aria-label={titulo}
        className={`w-9 h-9 shrink-0 rounded-[10px] border flex items-center justify-center
                    cursor-pointer transition-colors ${cor}`}
      >
        {icone ? <Icone nome={icone} className="w-[17px] h-[17px]" /> : children}
      </button>
    </Dica>
  );
}

/**
 * Botão padrão do painel. `variante`: primario | secundario | fantasma | perigo.
 * `carregando` troca o ícone por um giro e desabilita — evita o clique duplo
 * que manda o mesmo envio duas vezes.
 */
export function Botao({
  children,
  variante = 'secundario',
  icone,
  carregando = false,
  disabled,
  className = '',
  tamanho = 'md',
  type = 'button',
  ...resto
}) {
  const variantes = {
    primario:
      'bg-azul-600 text-white border-azul-600 hover:bg-azul-700 hover:border-azul-700 shadow-[0_2px_8px_rgba(43,87,151,0.25)]',
    secundario: 'bg-superficie text-primario border-borda-forte hover:bg-superficie-hover hover:border-azul-400/40',
    fantasma: 'bg-transparent text-secundario border-transparent hover:bg-superficie-hover hover:text-primario',
    perigo: 'bg-superficie text-perigo border-perigo/30 hover:bg-perigo/8 hover:border-perigo/50',
  };
  const tamanhos = {
    sm: 'text-[12.5px] px-2.5 py-1 gap-1.5 rounded-[8px]',
    md: 'text-[13px] px-3.5 py-[7px] gap-2 rounded-[10px]',
  };
  return (
    <button
      type={type}
      disabled={disabled || carregando}
      className={`inline-flex items-center justify-center font-medium border cursor-pointer whitespace-nowrap
                  transition-[background-color,border-color,box-shadow,transform] duration-150 active:scale-[0.98]
                  disabled:opacity-55 disabled:cursor-not-allowed disabled:active:scale-100
                  ${variantes[variante] || variantes.secundario} ${tamanhos[tamanho] || tamanhos.md} ${className}`}
      {...resto}
    >
      {carregando ? (
        <span
          aria-hidden="true"
          className="w-3.5 h-3.5 rounded-full border-2 border-current border-r-transparent animate-spin"
        />
      ) : (
        icone && <Icone nome={icone} className="w-4 h-4" />
      )}
      {children}
    </button>
  );
}
