import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Abas, Bloco, Botao, BotaoIcone, Dica, Estado, Icone, InfoDica, Pill, Sanfona } from './base';
import { useApi } from '../lib/api';
import { fmtDataHora, iniciais } from '../lib/formato';

/** Rótulo que o webhook grava quando o aviso chega sem etapa (src/lib/rubeus.ts). */
const NAO_INFORMADA = '(etapa não informada)';
const semEtapa = (etapa) => !etapa || etapa === NAO_INFORMADA;

const DICA_SEM_ETAPA =
  'O aviso do Rubeus chegou sem dizer a etapa — em geral edição de cadastro ou o webhook nativo de registro. ' +
  'O evento aconteceu, mas não move a pessoa no funil; a etapa atual ignora estes passos.';

/** Formata o corpo cru para leitura: JSON indentado ou um campo por linha. */
function corpoLegivel(corpo) {
  if (!corpo) return '';
  try {
    return JSON.stringify(JSON.parse(corpo), null, 2);
  } catch {
    if (corpo.includes('=') && !corpo.trim().startsWith('{')) {
      try {
        return [...new URLSearchParams(corpo).entries()].map(([k, v]) => `${k} = ${v}`).join('\n');
      } catch {
        /* deixa cru */
      }
    }
    return corpo;
  }
}

/**
 * Botão de copiar com confirmação.
 *
 * O "Copiado" por um instante é a única prova de que o clique funcionou — a
 * área de transferência não mostra nada por conta própria. `soIcone` é a versão
 * miúda que fica colada ao e-mail e ao telefone do cabeçalho.
 */
function Copiar({ texto, rotulo = 'Copiar', dica, soIcone = false }) {
  const [copiado, setCopiado] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copiar = () => {
    navigator.clipboard?.writeText(texto);
    setCopiado(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopiado(false), 1500);
  };
  if (soIcone) {
    return (
      <Dica conteudo={copiado ? 'Copiado' : dica || rotulo}>
        <button
          type="button"
          onClick={copiar}
          aria-label={copiado ? 'Copiado' : dica || rotulo}
          className={`w-7 h-7 shrink-0 rounded-[8px] border-0 bg-transparent flex items-center justify-center cursor-pointer
                      transition-colors hover:bg-superficie-hover
                      ${copiado ? 'text-sucesso' : 'text-tenue hover:text-azul-600'}`}
        >
          <Icone nome={copiado ? 'check' : 'copiar'} className="w-[15px] h-[15px]" />
        </button>
      </Dica>
    );
  }
  const botao = (
    <Botao
      tamanho="sm"
      icone={copiado ? 'check' : 'copiar'}
      onClick={copiar}
      className={copiado ? '!text-sucesso !border-sucesso/40' : ''}
    >
      {copiado ? 'Copiado' : rotulo}
    </Botao>
  );
  return dica ? <Dica conteudo={dica}>{botao}</Dica> : botao;
}

/** `{ }` — ícone local do payload; não existe no conjunto de icones.jsx. */
function IconeChaves({ className = 'w-[14px] h-[14px]' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 4H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1" />
      <path d="M16 4h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1" />
    </svg>
  );
}

/** Esqueleto no desenho do painel: destaque, visão por funil e linha do tempo. */
function EsqueletoPainel() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Carregando">
      <div className="rounded-[14px] border border-borda p-4 flex flex-col gap-2">
        <Bloco className="h-3 w-40" />
        <Bloco className="h-6 w-56" />
        <Bloco className="h-3 w-32" />
      </div>
      <div className="flex flex-col gap-2">
        <Bloco className="h-4 w-28" />
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="rounded-[12px] border border-borda p-3 flex items-center gap-3">
            <Bloco className="h-4 w-4 shrink-0" />
            <div className="flex-1 flex flex-col gap-1.5">
              <Bloco className="h-4 w-36" />
              <Bloco className="h-3 w-24" />
            </div>
            <Bloco className="h-5 w-24 !rounded-full" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <Bloco className="h-8 w-64 !rounded-[12px]" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex gap-3 items-center">
            <Bloco className="h-2.5 w-2.5 !rounded-full shrink-0" />
            <Bloco className="h-4 flex-1" />
            <Bloco className="h-3 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Última etapa de verdade do funil — passo sem etapa não move a pessoa. */
function etapaReal(f) {
  for (let i = f.passos.length - 1; i >= 0; i -= 1) {
    if (!semEtapa(f.passos[i].etapa)) return { etapa: f.passos[i].etapa, desde: f.passos[i].registrado_em };
  }
  return { etapa: f.etapa_atual || NAO_INFORMADA, desde: f.ultimo_em };
}

/**
 * Junta passos consecutivos da mesma etapa num grupo ("Inscrito Parcial ×2").
 * O Rubeus reenvia a mesma etapa quando o cadastro muda; em linhas separadas
 * isso parecia movimento.
 */
function agrupar(passos) {
  const grupos = [];
  for (const p of passos) {
    const g = grupos[grupos.length - 1];
    if (g && g.etapa === p.etapa) g.passos.push(p);
    else grupos.push({ etapa: p.etapa, passos: [p] });
  }
  return grupos;
}

/** Botão discreto `{ }` que abre o payload do passo. */
function BotaoPayload({ aberto, aoAlternar, controla }) {
  return (
    <Dica conteudo={aberto ? 'Esconder o que o Rubeus enviou' : 'Ver o que o Rubeus enviou neste passo'}>
      <button
        type="button"
        aria-expanded={aberto}
        aria-controls={controla}
        aria-label={aberto ? 'Esconder payload' : 'Ver payload'}
        onClick={aoAlternar}
        className={`w-7 h-7 shrink-0 rounded-[8px] border-0 flex items-center justify-center cursor-pointer transition-colors
          ${aberto ? 'bg-azul-50 text-azul-600' : 'bg-transparent text-tenue hover:bg-superficie-hover hover:text-azul-600'}`}
      >
        <IconeChaves />
      </button>
    </Dica>
  );
}

/** Corpo(s) recebido(s) pelo webhook num grupo de passos. */
function CorpoPayloads({ id, itens }) {
  return (
    <div id={id} className="basis-full mt-1.5 mb-1 flex flex-col gap-2 animate-surgir">
      {itens.map(({ texto, em }, i) => (
        <div key={i} className="rounded-[10px] border border-borda bg-elevado overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-borda">
            <span className="text-[12px] text-secundario tnum">
              Corpo do webhook{itens.length > 1 ? ` · ${fmtDataHora(em)}` : ''}
            </span>
            <Copiar texto={texto} rotulo="Copiar" dica="Copiar o payload deste passo" />
          </div>
          <pre
            className="m-0 text-[12px] leading-relaxed text-secundario whitespace-pre-wrap break-all
                       p-2.5 max-h-56 overflow-auto font-mono"
          >
            {texto}
          </pre>
        </div>
      ))}
    </div>
  );
}

/** Uma linha da linha do tempo: um grupo de passos da mesma etapa. */
function LinhaGrupo({ grupo: g, agora, ultimoGrupo, origemTexto, payloads }) {
  const [aberto, setAberto] = useState(false);
  const id = useId();
  const vago = semEtapa(g.etapa);
  const primeiro = g.passos[0];
  const fim = g.passos[g.passos.length - 1];
  const datas = g.passos.length > 1 ? (
    <span className="block tnum">
      <span className="block font-semibold mb-0.5">{g.passos.length} avisos seguidos desta etapa</span>
      {g.passos.map((p, k) => (
        <span key={k} className="block text-white/85">
          {fmtDataHora(p.registrado_em)}
        </span>
      ))}
    </span>
  ) : null;

  const nomeEtapa = (
    <span
      className={`text-[13.5px] leading-6 min-w-0 break-words
        ${vago ? 'text-tenue italic font-normal' : agora ? 'font-semibold text-azul-700' : 'font-medium text-primario'}`}
    >
      {vago ? 'Etapa não informada' : g.etapa}
    </span>
  );

  return (
    <li className={`flex gap-3 ${vago ? 'opacity-75' : ''}`}>
      {/* Trilho: ponto por grupo, linha até o próximo. */}
      <div className="flex flex-col items-center shrink-0 w-3 pt-[7px]" aria-hidden="true">
        <span
          className={`rounded-full shrink-0
            ${agora
              ? 'w-3 h-3 bg-azul-600 shadow-[0_0_0_4px_rgba(79,143,232,0.18)]'
              : vago
                ? 'w-2.5 h-2.5 border-2 border-dashed border-tenue/60 bg-base'
                : 'w-2.5 h-2.5 bg-azul-400/60'}`}
        />
        {!ultimoGrupo && <span className="w-0.5 flex-1 min-h-2 bg-azul-400/20 rounded-full mt-1" />}
      </div>
      <div className={`min-w-0 flex-1 flex flex-wrap items-start gap-x-2 ${ultimoGrupo ? 'pb-0' : 'pb-2.5'}`}>
        <div className="min-w-0 flex-1 flex items-center gap-x-1.5 flex-wrap">
          {vago ? (
            <Dica conteudo={DICA_SEM_ETAPA} tocavel>
              <span tabIndex={0} className="inline-flex items-center gap-1 rounded cursor-help">
                {nomeEtapa}
                <Icone nome="info" className="w-3.5 h-3.5 text-tenue" />
              </span>
            </Dica>
          ) : (
            nomeEtapa
          )}
          {g.passos.length > 1 && (
            <Dica conteudo={datas} tocavel>
              <span
                tabIndex={0}
                className="text-[12px] font-semibold tnum px-1.5 rounded-full bg-elevado text-secundario cursor-help"
                aria-label={`${g.passos.length} vezes`}
              >
                ×{g.passos.length}
              </span>
            </Dica>
          )}
          {agora && <span className="text-[12px] font-semibold text-azul-600">agora</span>}
        </div>
        <span className="flex items-center gap-0.5 shrink-0">
          <Dica conteudo={g.passos.length > 1 ? `Primeiro aviso em ${fmtDataHora(primeiro.registrado_em)}` : null}>
            <time
              dateTime={fim.registrado_em || undefined}
              className="text-[12.5px] text-secundario tnum leading-7 whitespace-nowrap"
            >
              {fmtDataHora(fim.registrado_em)}
            </time>
          </Dica>
          {payloads.length > 0 && (
            <BotaoPayload aberto={aberto} aoAlternar={() => setAberto((v) => !v)} controla={id} />
          )}
        </span>
        {origemTexto && (
          <span className="basis-full text-[12px] text-tenue flex items-center gap-1 -mt-0.5 min-w-0">
            <Icone nome="link" className="w-3 h-3 shrink-0" />
            <span className="truncate">via {origemTexto}</span>
          </span>
        )}
        {aberto && <CorpoPayloads id={id} itens={payloads} />}
      </div>
    </li>
  );
}

/**
 * Linha do tempo compacta de um funil.
 *
 * Uma linha por grupo de etapa: nome e data/hora. A origem só aparece quando
 * muda em relação ao passo anterior — repetir "Ficha de Inscrição" em toda
 * linha era o que mais pesava na leitura.
 */
function LinhaDoTempo({ funil, payloadDe }) {
  const grupos = agrupar(funil.passos);
  let atual = -1;
  for (let i = grupos.length - 1; i >= 0; i -= 1) {
    if (!semEtapa(grupos[i].etapa)) {
      atual = i;
      break;
    }
  }
  let origemAnterior = null;

  return (
    <ol className="m-0 p-0 list-none flex flex-col" aria-label={`Passos em ${funil.funil}`}>
      {grupos.map((g, i) => {
        const origens = [...new Set(g.passos.map((p) => p.origem).filter(Boolean))];
        const origemTexto = origens.join(' · ');
        const mostraOrigem = origemTexto && origemTexto !== origemAnterior;
        if (origemTexto) origemAnterior = origemTexto;
        const payloads = g.passos
          .map((p) => ({ texto: corpoLegivel(payloadDe(p)?.corpo), em: p.registrado_em }))
          .filter((x) => x.texto);
        return (
          <LinhaGrupo
            key={i}
            grupo={g}
            agora={i === atual}
            ultimoGrupo={i === grupos.length - 1}
            origemTexto={mostraOrigem ? origemTexto : null}
            payloads={payloads}
          />
        );
      })}
    </ol>
  );
}

/**
 * Painel lateral do lead.
 *
 * Gaveta à direita em vez de página: o usuário está lendo a lista do funil e
 * quer espiar uma pessoa sem perder o lugar. Fecha no Esc e no clique fora,
 * que é o que se espera de sobreposição.
 *
 * Leitura de cima para baixo: quem é → onde está no funil do card → onde está
 * em cada funil → como chegou lá (passos, uma aba por funil) → cadastro.
 */
export function PainelLead({ contatoId, funilId = '', aoFechar }) {
  // Sem `manter`: a chave troca de pessoa, e o dado anterior é de outro lead.
  // `funilId`: aberto de um card de funil, o resumo segue esse funil (ver a rota).
  const { dados, carregando, erro } = useApi(
    `/api/funil/lead/${encodeURIComponent(contatoId)}` +
      (funilId ? `?funil_id=${encodeURIComponent(funilId)}` : ''),
    `lead-${contatoId}-${funilId}`,
  );

  // Aba escolhida pelo usuário; vazia, vale o funil do card.
  const [abaEscolhida, setAbaEscolhida] = useState(null);
  const [cadastroAberto, setCadastroAberto] = useState(false);
  const detalheRef = useRef(null);
  useEffect(() => setAbaEscolhida(null), [contatoId, funilId]);

  useEffect(() => {
    const aoTeclar = (e) => e.key === 'Escape' && aoFechar();
    document.addEventListener('keydown', aoTeclar);
    // Trava o scroll do fundo enquanto a gaveta está aberta.
    const antes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      document.body.style.overflow = antes;
    };
  }, [aoFechar]);

  const funis = useMemo(() => dados?.funis ?? [], [dados]);

  /*
   * Parear por etapa e ordem, não por timestamp.
   *
   * `leads_etapa.registrado_em` vem do payload (ISO) e `eventos_recebidos.recebido_em`
   * é a hora em que o Worker gravou — são grandezas diferentes e nunca batem
   * exatamente. Como as duas listas vêm ordenadas, a n-ésima ocorrência de uma
   * etapa na jornada corresponde à n-ésima daquela etapa nos payloads.
   *
   * O pareamento corre uma vez, sobre todos os passos em ordem cronológica, e
   * não no render: com abas só um funil aparece por vez, e parear na ordem de
   * desenho daria a cada aba os payloads de outra.
   */
  const payloadDe = useMemo(() => {
    const fila = new Map();
    for (const p of dados?.payloads ?? []) {
      const k = p.etapa ?? '(sem etapa)';
      if (!fila.has(k)) fila.set(k, []);
      fila.get(k).push(p);
    }
    const usados = new Map();
    const tirar = (k) => {
      const lista = fila.get(k);
      const i = usados.get(k) ?? 0;
      if (!lista || i >= lista.length) return undefined;
      usados.set(k, i + 1);
      return lista[i];
    };
    const todos = funis.flatMap((f) => f.passos);
    // `sort` é estável: empates de horário mantêm a ordem que a rota mandou.
    todos.sort((a, b) => String(a.registrado_em ?? '').localeCompare(String(b.registrado_em ?? '')));
    const mapa = new Map();
    for (const p of todos) {
      const achado = tirar(p.etapa ?? '(sem etapa)') ?? (semEtapa(p.etapa) ? tirar('(sem etapa)') : undefined);
      if (achado) mapa.set(p, achado);
    }
    return (p) => mapa.get(p);
  }, [dados, funis]);

  const foco = funis.find((f) => f.em_foco) ?? null;
  const ativa = funis.some((f) => f.funil === abaEscolhida) ? abaEscolhida : (foco ?? funis[0])?.funil;
  const funilAtivo = funis.find((f) => f.funil === ativa);

  const nome = dados?.contato_nome || `Contato ${contatoId}`;
  // E-mail/telefone: do resumo, se a rota mandar; senão o mais recente da jornada.
  const jornada = dados?.jornada ?? [];
  const ultimoCom = (campo) => {
    if (dados?.[campo]) return dados[campo];
    for (let i = jornada.length - 1; i >= 0; i -= 1) if (jornada[i]?.[campo]) return jornada[i][campo];
    return null;
  };
  const email = ultimoCom('email');
  const telefone = ultimoCom('telefone');

  // Destaque: a etapa do funil do card; sem card, a mais recente de todas.
  const destaque = foco ? etapaReal(foco) : dados ? { etapa: dados.etapa_atual, desde: dados.ultimo_em } : null;

  const abrirFunil = (f) => {
    setAbaEscolhida(f.funil);
    detalheRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const cadastro = dados
    ? [
        ['Curso / oferta', dados.oferta_nome || dados.oferta_codigo || dados.curso_codigo, 'capelo'],
        ['Unidade', dados.unidade, 'mapa'],
        ['Responsável', dados.responsavel_comercial, 'pessoa'],
        ['Origem', dados.origem, 'link'],
        ['Primeiro evento', dados.primeiro_em && fmtDataHora(dados.primeiro_em), 'calendario'],
        ['Último evento', dados.ultimo_em && fmtDataHora(dados.ultimo_em), 'relogio'],
      ].filter(([, v]) => v)
    : [];

  /*
   * Portal no <body>, não no lugar em que a tela monta o painel.
   *
   * O wrapper `.tela` anima a entrada com `transform`. Ancestral com
   * `transform` vira o bloco de contenção de `position: fixed`: a gaveta deixava
   * de cobrir a janela e passava a cobrir a página inteira, ancorada no topo
   * dela. Aberta a partir de "Leads deste funil", lá no fim da página, o conteúdo
   * ficava centenas de pixels acima da área visível e o painel parecia vazio.
   * As animações já não deixam o `transform` aplicado (ver estilos.css), mas
   * qualquer ancestral com transform, filtro ou `contain` traria o bug de volta —
   * no `body` a gaveta não depende disso.
   */
  return createPortal(
    <div className="fixed inset-0 z-50 flex">
      <div
        className="flex-1 bg-azul-900/35 backdrop-blur-[2px] animate-aparecer"
        onClick={aoFechar}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={dados ? `Detalhes do lead ${nome}` : 'Detalhes do lead'}
        className="w-full md:w-[520px] h-full bg-base border-l border-borda
                   overflow-y-auto shadow-[var(--shadow-flutuante)] flex flex-col animate-surgir"
      >
        {/* Cabeçalho: quem é a pessoa e como falar com ela. */}
        <div className="sticky top-0 z-[2] bg-base/95 backdrop-blur border-b border-borda px-4 sm:px-5 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div
                aria-hidden="true"
                className="w-10 h-10 rounded-full bg-gradient-to-br from-azul-600 to-azul-400 text-white flex items-center
                           justify-center text-[14px] font-semibold shrink-0 shadow-[0_4px_12px_rgba(43,87,151,0.25)]"
              >
                {dados ? iniciais(dados.contato_nome) : <Icone nome="pessoa" className="w-5 h-5" />}
              </div>
              <div className="min-w-0">
                <Dica conteudo={nome.length > 30 ? nome : null} className="w-full">
                  <h2 className="m-0 text-[16px] font-semibold truncate">{nome}</h2>
                </Dica>
                <div className="text-[12px] text-tenue tnum flex items-center gap-1 mt-0.5">
                  <span>id {contatoId}</span>
                  <Copiar texto={String(contatoId)} soIcone dica="Copiar o id do contato no Rubeus" />
                </div>
              </div>
            </div>
            <BotaoIcone aoClicar={aoFechar} titulo="Fechar" icone="x" />
          </div>
          {(email || telefone) && (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 sm:pl-[52px] text-[12.5px] text-secundario">
              {email && (
                <span className="inline-flex items-center gap-1 min-w-0 max-w-full">
                  <Icone nome="mensagem" className="w-3.5 h-3.5 text-tenue shrink-0" />
                  <span className="truncate">{email}</span>
                  <Copiar texto={email} soIcone dica="Copiar e-mail" />
                </span>
              )}
              {telefone && (
                <span className="inline-flex items-center gap-1 tnum">
                  <Icone nome="telefone" className="w-3.5 h-3.5 text-tenue shrink-0" />
                  {telefone}
                  <Copiar texto={telefone} soIcone dica="Copiar telefone" />
                </span>
              )}
            </div>
          )}
        </div>

        <div className="p-4 sm:p-5 flex flex-col gap-5">
          {erro && <Estado tipo="erro" titulo="Não foi possível carregar" mensagem={erro} />}
          {carregando && !dados && <EsqueletoPainel />}

          {dados && (
            <>
              {/* Destaque: onde a pessoa está no funil do card. */}
              {destaque?.etapa && (
                <div
                  className="rounded-[14px] border border-azul-400/40 bg-azul-50 px-4 py-3.5 animate-surgir"
                  aria-live="polite"
                >
                  <div className="text-[12px] font-medium text-azul-700 flex items-center gap-1.5 min-w-0">
                    <Icone nome="alvo" className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">
                      {foco ? `Etapa atual em ${foco.funil}` : 'Etapa mais recente'}
                    </span>
                  </div>
                  <div
                    className={`mt-1 text-[19px] leading-tight font-semibold break-words
                      ${semEtapa(destaque.etapa) ? 'text-tenue italic' : 'text-azul-900'}`}
                  >
                    {semEtapa(destaque.etapa) ? 'Etapa não informada' : destaque.etapa}
                  </div>
                  {destaque.desde && (
                    <div className="mt-1 text-[12.5px] text-secundario tnum">
                      desde {fmtDataHora(destaque.desde)}
                      {foco && ` · ${foco.passos.length} passo${foco.passos.length === 1 ? '' : 's'}`}
                    </div>
                  )}
                </div>
              )}

              {/* Visão por funil: leitura de cinco segundos. */}
              {funis.length > 0 && (
                <section className="flex flex-col gap-2" aria-labelledby="pl-visao">
                  <h3 id="pl-visao" className="m-0 text-[13px] font-semibold text-secundario flex items-center gap-1.5">
                    Por funil
                    <InfoDica texto="Onde a pessoa está em cada funil em que entrou. Clique para ver os passos daquele funil." />
                  </h3>
                  <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
                    {funis.map((f) => {
                      const { etapa } = etapaReal(f);
                      const on = f.funil === ativa;
                      return (
                        <li key={f.funil}>
                          <button
                            type="button"
                            onClick={() => abrirFunil(f)}
                            aria-current={on ? 'true' : undefined}
                            className={`w-full text-left rounded-[12px] border px-3 py-2.5 flex items-center gap-3 cursor-pointer
                              transition-colors bg-superficie hover:bg-superficie-hover
                              ${f.em_foco ? 'border-azul-400/50' : 'border-borda'}
                              ${on ? 'shadow-[var(--shadow-cartao)]' : ''}`}
                          >
                            <Icone
                              nome="funil"
                              className={`w-4 h-4 shrink-0 ${f.em_foco ? 'text-azul-600' : 'text-tenue'}`}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13.5px] font-semibold truncate">{f.funil}</span>
                              {/* "este funil" na linha de baixo: ao lado do nome, cortava o nome no celular. */}
                              <span className="block text-[12px] text-secundario tnum mt-0.5">
                                {f.em_foco && <span className="font-semibold text-azul-600">este funil · </span>}
                                {f.passos.length} passo{f.passos.length === 1 ? '' : 's'} ·{' '}
                                <span className="whitespace-nowrap">última {fmtDataHora(f.ultimo_em)}</span>
                              </span>
                            </span>
                            <span className="shrink-0 max-w-[45%] flex justify-end">
                              {semEtapa(etapa) ? (
                                <Pill tom="neutro" dica={DICA_SEM_ETAPA}>
                                  sem etapa
                                </Pill>
                              ) : (
                                // Pill própria: a de base.jsx não corta, e etapa longa empurrava a linha.
                                <span
                                  title={etapa}
                                  className={`inline-flex items-center gap-1.5 max-w-full px-2.5 py-[3px] rounded-full text-[12px] font-semibold
                                    ${f.em_foco ? 'bg-azul-400/14 text-azul-700' : 'bg-elevado text-secundario'}`}
                                >
                                  <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
                                  <span className="truncate">{etapa}</span>
                                </span>
                              )}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {/* Passos: uma aba por funil, a do card selecionada. */}
              <section className="flex flex-col gap-3 scroll-mt-24" ref={detalheRef} aria-labelledby="pl-passos">
                <h3 id="pl-passos" className="m-0 text-[13px] font-semibold text-secundario flex items-center gap-1.5">
                  Passos
                  <InfoDica texto="Do primeiro ao último aviso do Rubeus, por funil. Avisos seguidos da mesma etapa viram uma linha (×2). A origem só aparece quando muda. O ícone { } mostra o payload recebido." />
                </h3>
                {/*
                  Um funil por vez: um lead de Pós também entra em Qualificação
                  de Leads, e as etapas dos dois não são a mesma sequência.
                  Misturar faria parecer que ele voltou de etapa.
                */}
                {funis.length > 1 && (
                  <Abas
                    rotulo="Funis do lead"
                    abas={funis.map((f) => ({ id: f.funil, nome: f.funil, contagem: f.passos.length }))}
                    ativa={ativa}
                    aoTrocar={setAbaEscolhida}
                    className="self-start"
                  />
                )}
                {funilAtivo ? (
                  <div role={funis.length > 1 ? 'tabpanel' : undefined} aria-label={funilAtivo.funil} key={funilAtivo.funil} className="animate-aparecer">
                    {funis.length === 1 && (
                      <div className="text-[13px] font-semibold text-azul-700 flex items-center gap-1.5 mb-2">
                        <Icone nome="funil" className="w-4 h-4 shrink-0" />
                        <span className="truncate">{funilAtivo.funil}</span>
                      </div>
                    )}
                    <LinhaDoTempo funil={funilAtivo} payloadDe={payloadDe} />
                  </div>
                ) : (
                  <Estado icone="relogio" mensagem="Nenhum passo registrado para este lead." />
                )}
              </section>

              {/* Cadastro: abaixo e fechado, para não competir com as etapas. */}
              {cadastro.length > 0 && (
                <Sanfona
                  titulo={<span className="font-semibold">Cadastro</span>}
                  resumo={dados.oferta_nome || dados.oferta_codigo || dados.curso_codigo || null}
                  aberta={cadastroAberto}
                  aoAlternar={() => setCadastroAberto((v) => !v)}
                >
                  <dl className="m-0 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5 pt-1">
                    {cadastro.map(([k, v, icone]) => (
                      <div key={k} className="flex items-start gap-2 min-w-0">
                        <Icone nome={icone} className="w-3.5 h-3.5 text-tenue shrink-0 mt-[3px]" />
                        <div className="min-w-0">
                          <dt className="text-[12px] text-secundario">{k}</dt>
                          <dd className="m-0 text-[13px] break-words leading-snug tnum">{v}</dd>
                        </div>
                      </div>
                    ))}
                  </dl>
                  {foco && (
                    <p className="m-0 mt-3 text-[12px] text-tenue">
                      Dados do funil {foco.funil}, o do card que você abriu.
                    </p>
                  )}
                </Sanfona>
              )}

              {dados.payloads?.length > 0 && (
                <div className="flex justify-end pt-1 border-t border-borda">
                  <Copiar
                    texto={JSON.stringify(dados, null, 2)}
                    rotulo="Copiar tudo deste lead"
                    dica="Copia os dados e todos os payloads deste lead em JSON"
                  />
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
