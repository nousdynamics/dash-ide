import { Suspense, lazy, useEffect, useState } from 'react';
import { buscar, useCarregandoGlobal } from './lib/api';
import { iniciais } from './lib/formato';
import { filtroPadrao } from './lib/periodo';
import { Dica, EsqueletoPagina, Icone } from './componentes/base';

/*
 * Uma tela por chunk. O peso está concentrado na Visão geral, que é a única
 * que carrega Recharts — sem separar, quem abre Conversas baixa a biblioteca
 * de gráficos inteira sem usar nada dela.
 */
const VisaoGeral = lazy(() => import('./paginas/VisaoGeral').then((m) => ({ default: m.VisaoGeral })));
const Campanhas = lazy(() => import('./paginas/Campanhas').then((m) => ({ default: m.Campanhas })));
const Funil = lazy(() => import('./paginas/Funil').then((m) => ({ default: m.Funil })));
const Conversas = lazy(() => import('./paginas/Conversas').then((m) => ({ default: m.Conversas })));
const Webhooks = lazy(() => import('./paginas/Webhooks').then((m) => ({ default: m.Webhooks })));
const Conversoes = lazy(() => import('./paginas/Conversoes').then((m) => ({ default: m.Conversoes })));
const GoogleConversoes = lazy(() => import('./paginas/GoogleConversoes').then((m) => ({ default: m.GoogleConversoes })));
const Etapas = lazy(() => import('./paginas/Etapas').then((m) => ({ default: m.Etapas })));

const icone = (d) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-[18px] h-[18px] shrink-0 block"
    aria-hidden="true"
  >
    {d}
  </svg>
);

const ICONES = {
  overview: icone(
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  funil: icone(<path d="M3 4h18l-7 8v7l-4 2v-9L3 4Z" />),
  campanhas: icone(<path d="M3 20h4V10H3v10Zm7 0h4V4h-4v16Zm7 0h4v-6h-4v6Z" />),
  conversas: icone(<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.7-.8L3 21l1.9-5.2A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z" />),
  webhooks: icone(
    <>
      <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </>
  ),
  conversoes: icone(
    <>
      <path d="M4 12a8 8 0 0 1 8-8 8 8 0 0 1 7 4" />
      <path d="M19 4v4h-4" />
      <path d="M20 12a8 8 0 0 1-8 8 8 8 0 0 1-7-4" />
      <path d="M5 20v-4h4" />
    </>
  ),
  'conversoes-google': icone(
    <>
      <path d="M12 3v12" />
      <path d="m8 11 4 4 4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </>
  ),
  etapas: icone(
    <>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h10" />
      <circle cx="18" cy="18" r="2" />
    </>
  ),
};

const PAGINAS = [
  { id: 'overview', nome: 'Visão geral', curto: 'Visão', dica: 'Investimento, conversões e custo do Google Ads, lado a lado com os leads do Rubeus' },
  { id: 'funil', nome: 'Funil de vendas', curto: 'Funil', dica: 'Quantos leads chegam a cada etapa do processo seletivo e onde eles param' },
  { id: 'campanhas', nome: 'Campanhas', curto: 'Camp.', dica: 'Desempenho de cada campanha, conjunto e anúncio' },
  { id: 'conversas', nome: 'Conversas', curto: 'Chat', dica: 'Conversas de WhatsApp e tempo de resposta do atendimento' },
  // Emite credencial de webhook: só aparece para quem administra. Esconder o
  // item é conveniência — quem digitar #/webhooks na mão continua batendo no
  // 403 do servidor, que é onde a permissão de verdade mora.
  { id: 'webhooks', nome: 'Funis e webhooks', curto: 'Funis', admin: true, dica: 'Endereços que recebem eventos do Rubeus e o estado de cada funil' },
  // Decide o que o Google Ads recebe, e o que ele recebe muda o lance das
  // campanhas. Mesmo segundo nível de acesso dos webhooks, pelo mesmo motivo:
  // ver o resultado não é a mesma autorização que mexer no que o gera.
  { id: 'conversoes', nome: 'Conversões Ads', curto: 'Conv.', admin: true, dica: 'Regras que decidem quais eventos viram conversão no Google Ads' },
  /*
   * Subpágina de Conversões Ads: o resultado, não a configuração.
   *
   * `pai` só muda o desenho do menu — o item aparece recuado sob o de cima. A
   * rota é de primeiro nível como as outras, porque hash aninhado obrigaria o
   * roteador a entender caminho, e ele existe justamente para não precisar.
   */
  { id: 'conversoes-google', nome: 'Google Conversões', curto: 'Envios', admin: true, pai: 'conversoes', dica: 'O que foi enviado ao Google Ads e o que ele aceitou' },
  // Mapa macro + ordem + ocultar etapas ruidosas — alimenta Macro e Detalhe.
  { id: 'etapas', nome: 'Etapas do processo', curto: 'Etapas', admin: true, dica: 'Ordem e agrupamento das etapas que alimentam o funil' },
];

/*
 * Grupos do menu. Separar o que se lê do que se configura: quem abre o painel
 * para ver número não precisa atravessar a lista de ajustes para achar a tela.
 */
const GRUPOS = [
  { id: 'analise', nome: 'Análise', ids: ['overview', 'funil', 'campanhas', 'conversas'] },
  { id: 'config', nome: 'Configuração', ids: ['webhooks', 'conversoes', 'conversoes-google', 'etapas'] },
];

/** Fio no topo da janela enquanto há busca em andamento — aparece só depois de 250ms. */
function BarraProgresso() {
  const ativo = useCarregandoGlobal();
  const [visivel, setVisivel] = useState(false);
  useEffect(() => {
    if (!ativo) {
      setVisivel(false);
      return undefined;
    }
    const t = setTimeout(() => setVisivel(true), 250);
    return () => clearTimeout(t);
  }, [ativo]);
  return (
    <div
      aria-hidden="true"
      className={`fixed top-0 inset-x-0 h-[3px] z-[90] overflow-hidden pointer-events-none transition-opacity duration-300
        ${visivel ? 'opacity-100' : 'opacity-0'}`}
    >
      <div className="h-full w-full bg-gradient-to-r from-transparent via-azul-400 to-transparent animate-[progresso_1.1s_ease-in-out_infinite]" />
    </div>
  );
}

const CHAVE_RETRAIDA = 'painel-ide:sidebar-retraida';

/**
 * Rota em hash de propósito: o Worker serve /api na mesma
 * origem, e rota por path exigiria o roteador de assets em modo SPA, que
 * devolveria index.html para /api/* também.
 */
function useRota() {
  const ler = () => {
    const r = (location.hash || '').replace(/^#\/?/, '').split('/')[0] || 'overview';
    return { rota: PAGINAS.some((p) => p.id === r) ? r : 'overview' };
  };
  const [rota, setRota] = useState(ler);
  useEffect(() => {
    const aoMudar = () => setRota(ler());
    window.addEventListener('hashchange', aoMudar);
    return () => window.removeEventListener('hashchange', aoMudar);
  }, []);
  return rota;
}

/**
 * Barra inferior do celular.
 *
 * Oito ícones não cabem em 390px sem virar alvo de toque de 40px. As telas de
 * análise ficam fixas; as de configuração moram atrás de "Mais", que é o que
 * se abre de vez em quando.
 */
function NavMobile({ visiveis, rota }) {
  const [mais, setMais] = useState(false);
  const fixas = visiveis.filter((p) => GRUPOS[0].ids.includes(p.id));
  const extras = visiveis.filter((p) => !GRUPOS[0].ids.includes(p.id));
  const extraAtiva = extras.some((p) => p.id === rota);
  const ir = (id) => {
    location.hash = `#/${id}`;
    setMais(false);
  };
  const item = (ativo) =>
    `relative flex-1 flex flex-col items-center gap-1 bg-transparent border-0 cursor-pointer text-[11px] font-medium py-1 transition-colors
     ${ativo ? 'text-azul-600' : 'text-tenue'}`;
  return (
    <>
      {mais && (
        <div className="md:hidden fixed inset-0 z-20 bg-primario/30 backdrop-blur-[2px] animate-aparecer" onClick={() => setMais(false)}>
          <div
            className="absolute bottom-[calc(72px+env(safe-area-inset-bottom))] inset-x-3 rounded-[16px] bg-superficie border border-borda shadow-[var(--shadow-flutuante)] p-2 animate-escala origin-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 pt-1 pb-2 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-tenue">Configuração</div>
            {extras.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => ir(p.id)}
                aria-current={p.id === rota ? 'page' : 'false'}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-[10px] border-0 text-left text-[14px] font-medium cursor-pointer
                  ${p.id === rota ? 'bg-azul-50 text-azul-700' : 'bg-transparent text-primario hover:bg-superficie-hover'}`}
              >
                {ICONES[p.id]}
                <span className="flex-1">{p.nome}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-30 flex bg-superficie/90 backdrop-blur-md border-t border-borda px-2 pt-2 pb-[calc(10px+env(safe-area-inset-bottom))]"
        aria-label="Navegação"
      >
        {fixas.map((p) => {
          const ativo = p.id === rota;
          return (
            <button key={p.id} type="button" aria-current={ativo ? 'page' : 'false'} onClick={() => ir(p.id)} className={item(ativo)}>
              {ativo && <span aria-hidden="true" className="absolute -top-2 w-8 h-[3px] rounded-full bg-azul-600 animate-aparecer" />}
              {ICONES[p.id]}
              {p.curto}
            </button>
          );
        })}
        {extras.length > 0 && (
          <button type="button" aria-expanded={mais} onClick={() => setMais((m) => !m)} className={item(extraAtiva || mais)}>
            {extraAtiva && <span aria-hidden="true" className="absolute -top-2 w-8 h-[3px] rounded-full bg-azul-600" />}
            <Icone nome="engrenagem" className="w-[18px] h-[18px]" />
            Mais
          </button>
        )}
      </nav>
    </>
  );
}

export default function App() {
  const { rota } = useRota();
  const [retraida, setRetraida] = useState(() => {
    try {
      return localStorage.getItem(CHAVE_RETRAIDA) === '1';
    } catch {
      return false;
    }
  });
  const [email, setEmail] = useState(null);
  const [admin, setAdmin] = useState(false);

  // Período vive aqui para não zerar ao trocar de tela.
  const [filtro, setFiltro] = useState(filtroPadrao);

  useEffect(() => {
    buscar('/api/me')
      .then((r) => {
        setEmail(r.email);
        setAdmin(Boolean(r.admin));
      })
      .catch(() => setEmail(null)); // identificação é acessório, não bloqueia o painel
  }, []);

  const alternar = () => {
    const v = !retraida;
    setRetraida(v);
    try {
      localStorage.setItem(CHAVE_RETRAIDA, v ? '1' : '0');
    } catch {
      /* modo restrito */
    }
  };

  // O menu mostra só o que a pessoa pode abrir. A rota em si continua existindo:
  // quem digitar #/webhooks vê a tela pedir permissão, não um menu mentiroso.
  const visiveis = PAGINAS.filter((p) => !p.admin || admin);
  const props = { filtro, setFiltro };

  return (
    <>
    <BarraProgresso />
    <div
      className={`min-h-screen md:grid ${retraida ? 'md:grid-cols-[72px_1fr]' : 'md:grid-cols-[232px_1fr]'} transition-[grid-template-columns] duration-200 motion-reduce:transition-none`}
    >
      <aside className="hidden md:flex sticky top-0 h-screen flex-col gap-7 bg-elevado border-r border-borda px-3 py-5 overflow-y-auto">
        <div className={`flex items-center gap-2 ${retraida ? 'flex-col' : 'justify-between'}`}>
          {retraida ? (
            <div className="w-9 h-9 rounded-[10px] bg-gradient-to-br from-azul-600 to-azul-400 text-white flex items-center justify-center font-bold text-[12px] shadow-[0_4px_12px_rgba(43,87,151,0.3)]">
              IDE
            </div>
          ) : (
            <img src="/logo-IDE-faculdade.svg" alt="Faculdade IDE" className="h-[26px] w-auto" />
          )}
          <button
            type="button"
            onClick={alternar}
            aria-expanded={!retraida}
            aria-label={retraida ? 'Expandir menu' : 'Retrair menu'}
            className="w-7 h-7 shrink-0 rounded-[8px] border border-borda bg-superficie text-secundario
                       flex items-center justify-center cursor-pointer hover:bg-superficie-hover hover:text-primario transition-colors"
          >
            <Icone nome={retraida ? 'chevronDireita' : 'chevronEsquerda'} className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex flex-col gap-5" aria-label="Navegação principal">
          {GRUPOS.map((g) => {
            const itens = visiveis.filter((p) => g.ids.includes(p.id));
            if (!itens.length) return null;
            return (
              <div key={g.id} className="flex flex-col gap-1">
                {retraida ? (
                  <span aria-hidden="true" className="h-px bg-borda mx-2 mb-1 first:hidden" />
                ) : (
                  <span className="px-3 mb-1 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-tenue">
                    {g.nome}
                  </span>
                )}
                {itens.map((p) => {
                  const ativo = p.id === rota;
                  const botao = (
                    <button
                      key={p.id}
                      type="button"
                      aria-label={retraida ? p.nome : undefined}
                      aria-current={ativo ? 'page' : 'false'}
                      onClick={() => {
                        location.hash = `#/${p.id}`;
                      }}
                      className={`group relative flex items-center rounded-[10px] py-[8px] text-[13.5px] font-medium cursor-pointer border-0 w-full text-left
                        transition-[background-color,color,box-shadow] duration-200
                        ${retraida ? 'justify-center px-0' : p.pai ? 'pl-8 pr-3' : 'px-3'}
                        ${ativo
                          ? 'bg-gradient-to-r from-azul-600 to-azul-500 text-white shadow-[0_4px_14px_rgba(43,87,151,0.3)]'
                          : 'bg-transparent text-secundario hover:bg-superficie hover:text-primario hover:shadow-[0_1px_3px_rgba(10,14,20,0.06)]'}`}
                    >
                      {p.pai && !retraida && (
                        <span
                          aria-hidden="true"
                          className={`absolute left-[19px] top-1 bottom-1 w-px ${ativo ? 'bg-white/40' : 'bg-borda-forte'}`}
                        />
                      )}
                      <span className={`flex items-center ${retraida ? 'gap-0' : 'gap-[10px]'} min-w-0`}>
                        <span className={`transition-transform duration-200 ${ativo ? '' : 'group-hover:scale-110'}`}>
                          {ICONES[p.id]}
                        </span>
                        {!retraida && <span className="truncate">{p.nome}</span>}
                      </span>
                    </button>
                  );
                  // Retraído, o nome só existe na dica; aberto, a dica explica a tela.
                  return (
                    <Dica
                      key={p.id}
                      className="w-full"
                      conteudo={retraida ? <><strong className="block">{p.nome}</strong>{p.dica}</> : p.dica}
                      atraso={retraida ? 80 : 600}
                    >
                      {botao}
                    </Dica>
                  );
                })}
              </div>
            );
          })}
        </nav>
      </aside>

      <main className="flex flex-col gap-5 px-4 md:px-8 pt-5 pb-28 md:pb-12 min-w-0 max-w-[1600px] w-full mx-auto">
        {/* Sem campo de busca: era placeholder, nunca chegou a buscar nada. */}
        <div className="flex items-center justify-between gap-4">
          <div className="md:hidden flex items-center gap-2">
            <img src="/logo-IDE-faculdade.svg" alt="Faculdade IDE" className="h-[22px] w-auto" />
          </div>
          <div className="hidden md:block" />
          <Dica conteudo={email ? `Conectado como ${email}` : 'Sem identificação do Access — sessão local'}>
            <div className="flex items-center gap-3 rounded-full pl-1 pr-1 md:pr-3 py-1 border border-borda bg-superficie shadow-[var(--shadow-cartao)]">
              <div className="w-[30px] h-[30px] rounded-full bg-gradient-to-br from-azul-700 to-azul-500 text-white flex items-center justify-center font-semibold text-[12px] shrink-0">
                {email ? iniciais(email.split('@')[0].replace(/[._-]/g, ' ')) : 'ID'}
              </div>
              <div className="hidden md:block leading-tight">
                <div className="font-semibold text-[13px] max-w-[220px] truncate">{email || 'Sessão local'}</div>
                <div className="text-tenue text-[12px]">{admin ? 'Administrador' : 'Faculdade IDE'}</div>
              </div>
            </div>
          </Dica>
        </div>

        {/* `key` remonta o invólucro a cada troca de tela, e a animação de entrada roda de novo. */}
        <Suspense fallback={<EsqueletoPagina />}>
          <div key={rota} className="tela flex flex-col gap-4">
          {rota === 'overview' && <VisaoGeral {...props} />}
          {rota === 'funil' && <Funil {...props} />}
          {rota === 'campanhas' && <Campanhas {...props} />}
          {rota === 'conversas' && <Conversas />}
          {rota === 'webhooks' && <Webhooks />}
          {rota === 'conversoes' && <Conversoes />}
          {rota === 'conversoes-google' && <GoogleConversoes />}
          {rota === 'etapas' && <Etapas />}
          </div>
        </Suspense>
      </main>

      <NavMobile visiveis={visiveis} rota={rota} />
    </div>
    </>
  );
}
