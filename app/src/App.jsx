import { Suspense, lazy, useEffect, useState } from 'react';
import { buscar } from './lib/api';
import { iniciais } from './lib/formato';
import { Esqueleto } from './componentes/base';

/*
 * Uma tela por chunk. O peso está concentrado na Visão geral, que é a única
 * que carrega Recharts — sem separar, quem abre Conversas baixa a biblioteca
 * de gráficos inteira sem usar nada dela.
 */
const VisaoGeral = lazy(() => import('./paginas/VisaoGeral').then((m) => ({ default: m.VisaoGeral })));
const Campanhas = lazy(() => import('./paginas/Campanhas').then((m) => ({ default: m.Campanhas })));
const Funil = lazy(() => import('./paginas/Funil').then((m) => ({ default: m.Funil })));
const Conversas = lazy(() => import('./paginas/Conversas').then((m) => ({ default: m.Conversas })));

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
};

const PAGINAS = [
  { id: 'overview', nome: 'Visão geral', curto: 'Visão' },
  { id: 'funil', nome: 'Funil de leads', curto: 'Funil' },
  { id: 'campanhas', nome: 'Campanhas', curto: 'Camp.' },
  { id: 'conversas', nome: 'Conversas', curto: 'Chat' },
];

const CHAVE_RETRAIDA = 'painel-ide:sidebar-retraida';

/**
 * Rota em hash (#/campanhas/123) de propósito: o Worker serve /api na mesma
 * origem, e rota por path exigiria o roteador de assets em modo SPA, que
 * devolveria index.html para /api/* também.
 */
function useRota() {
  const ler = () => {
    const bruto = (location.hash || '').replace(/^#\/?/, '') || 'overview';
    const [r, param] = bruto.split('/');
    return { rota: PAGINAS.some((p) => p.id === r) ? r : 'overview', param: param || null };
  };
  const [rota, setRota] = useState(ler);
  useEffect(() => {
    const aoMudar = () => setRota(ler());
    window.addEventListener('hashchange', aoMudar);
    return () => window.removeEventListener('hashchange', aoMudar);
  }, []);
  return rota;
}

export default function App() {
  const { rota, param } = useRota();
  const [retraida, setRetraida] = useState(() => {
    try {
      return localStorage.getItem(CHAVE_RETRAIDA) === '1';
    } catch {
      return false;
    }
  });
  const [email, setEmail] = useState(null);

  // Período vive aqui para não zerar ao trocar de tela.
  const [filtro, setFiltro] = useState({ preset: '30d', de: null, ate: null, comparar: true });

  useEffect(() => {
    buscar('/api/me')
      .then((r) => setEmail(r.email))
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

  const atual = PAGINAS.find((p) => p.id === rota);
  const props = { filtro, setFiltro };

  return (
    <div
      className={`min-h-screen md:grid ${retraida ? 'md:grid-cols-[72px_1fr]' : 'md:grid-cols-[208px_1fr]'} transition-[grid-template-columns] duration-200 motion-reduce:transition-none`}
    >
      <aside className="hidden md:flex sticky top-0 h-screen flex-col gap-6 bg-elevado border-r border-borda px-3 py-5">
        <div className={`flex items-center gap-2 ${retraida ? 'flex-col' : 'justify-between'}`}>
          {retraida ? (
            <div className="w-8 h-8 rounded-[8px] bg-azul-600 text-white flex items-center justify-center font-bold text-[13px]">
              IDE
            </div>
          ) : (
            <img src="/logo-IDE-faculdade-dark.svg" alt="Faculdade IDE" className="h-[26px] w-auto" />
          )}
          <button
            type="button"
            onClick={alternar}
            aria-expanded={!retraida}
            title={retraida ? 'Expandir menu' : 'Retrair menu'}
            aria-label={retraida ? 'Expandir menu' : 'Retrair menu'}
            className="w-7 h-7 shrink-0 rounded-[8px] border border-borda bg-superficie text-secundario
                       flex items-center justify-center cursor-pointer text-[13px] hover:bg-superficie-hover hover:text-primario"
          >
            {retraida ? '»' : '«'}
          </button>
        </div>

        <nav className="flex flex-col gap-1" aria-label="Navegação principal">
          {PAGINAS.map((p) => {
            const ativo = p.id === rota;
            return (
              <button
                key={p.id}
                type="button"
                title={p.nome}
                aria-current={ativo ? 'page' : 'false'}
                onClick={() => {
                  location.hash = `#/${p.id}`;
                }}
                className={`flex items-center rounded-[8px] py-[7px] text-[13px] font-medium cursor-pointer border-0 w-full text-left
                  ${retraida ? 'justify-center px-0' : 'px-3'}
                  ${ativo ? 'bg-azul-600 text-white' : 'bg-transparent text-secundario hover:bg-superficie-hover hover:text-primario'}`}
              >
                <span className={`flex items-center ${retraida ? 'gap-0' : 'gap-[10px]'} min-w-0`}>
                  {ICONES[p.id]}
                  {!retraida && <span className="truncate">{p.nome}</span>}
                </span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="flex flex-col gap-4 px-4 md:px-6 pt-5 pb-24 md:pb-10">
        <div className="flex items-center justify-between gap-4">
          <div className="hidden md:flex justify-between gap-2 bg-superficie border border-borda rounded-full px-3 py-[6px] text-xs text-tenue w-[240px]">
            <span>Buscar lead, curso, processo…</span>
            <span className="bg-elevado px-[6px] rounded text-[11px]">⌘K</span>
          </div>
          <div className="md:hidden font-semibold text-[15px]">{atual?.nome}</div>
          <div className="flex items-center gap-3">
            <div className="w-[30px] h-[30px] rounded-full bg-azul-700 text-white flex items-center justify-center font-semibold text-[13px] shrink-0">
              {email ? iniciais(email.split('@')[0].replace(/[._-]/g, ' ')) : 'ID'}
            </div>
            <div className="hidden md:block">
              <div className="font-semibold text-[13px]">{email || 'Sessão local'}</div>
              <div className="text-tenue text-xs">Faculdade IDE</div>
            </div>
          </div>
        </div>

        <Suspense fallback={<Esqueleto linhas={5} />}>
          {rota === 'overview' && <VisaoGeral {...props} />}
          {rota === 'funil' && <Funil />}
          {rota === 'campanhas' && <Campanhas {...props} />}
          {rota === 'conversas' && <Conversas />}
        </Suspense>
      </main>

      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-10 flex bg-elevado border-t border-borda px-2 pt-[10px] pb-[calc(14px+env(safe-area-inset-bottom))]"
        aria-label="Navegação"
      >
        {PAGINAS.map((p) => {
          const ativo = p.id === rota;
          return (
            <button
              key={p.id}
              type="button"
              aria-current={ativo ? 'page' : 'false'}
              onClick={() => {
                location.hash = `#/${p.id}`;
              }}
              className={`flex-1 flex flex-col items-center gap-1 bg-transparent border-0 cursor-pointer text-[10px] font-medium
                ${ativo ? 'text-azul-400' : 'text-tenue'}`}
            >
              {ICONES[p.id]}
              {p.curto}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
