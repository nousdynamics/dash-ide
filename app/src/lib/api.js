import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

export class ErroApi extends Error {}

/*
 * Requisições em voo, para a barra de progresso do topo.
 *
 * Contador global em vez de estado por tela: a barra responde "o painel está
 * buscando alguma coisa?", e quem busca pode ser a tela, um painel lateral ou
 * um modal — nenhum deles precisa saber que a barra existe.
 */
let emVoo = 0;
const ouvintes = new Set();
const avisar = () => ouvintes.forEach((f) => f());
function inscrever(f) {
  ouvintes.add(f);
  return () => ouvintes.delete(f);
}
export function useCarregandoGlobal() {
  return useSyncExternalStore(inscrever, () => emVoo > 0);
}

export async function buscar(caminho) {
  emVoo += 1;
  avisar();
  try {
    return await buscarSemContar(caminho);
  } finally {
    emVoo -= 1;
    avisar();
  }
}

/*
 * Depois de uma gravação, as próximas buscas pedem ao Worker que pule o cache
 * de borda (ver src/lib/cacheBorda.ts). Sem isto, ocultar uma etapa e voltar
 * ao Funil mostraria a esteira de antes por até cinco minutos.
 */
let semCacheAte = 0;

async function buscarSemContar(caminho) {
  let resp;
  try {
    const headers = { Accept: 'application/json' };
    if (Date.now() < semCacheAte) headers['X-Sem-Cache'] = '1';
    resp = await fetch(caminho, { headers });
  } catch {
    throw new ErroApi('Não foi possível falar com o servidor. Verifique a conexão.');
  }
  if (resp.status === 401 || resp.status === 403) {
    throw new ErroApi('Sessão expirada. Recarregue a página para autenticar de novo.');
  }
  if (!resp.ok) {
    let detalhe = '';
    try {
      detalhe = (await resp.json()).erro || '';
    } catch {
      /* corpo não-JSON */
    }
    throw new ErroApi(`O servidor respondeu ${resp.status}${detalhe ? ` (${detalhe})` : ''}.`);
  }
  return resp.json();
}

/*
 * Última resposta de cada rota, em memória.
 *
 * Voltar para uma tela já vista mostra o que ela tinha na hora, e a busca nova
 * corre por trás e substitui quando chega. Sem isso, cada troca de menu era um
 * esqueleto inteiro de novo, mesmo com o dado de trinta segundos atrás na mão.
 * Nada disso dispensa a busca: o cache só decide o que aparece enquanto ela
 * não volta.
 */
const cache = new Map();
const LIMITE_CACHE = 80;

/*
 * Ordem das respostas no cache.
 *
 * Cada busca recebe um número ao sair. Uma resposta só entra no cache se
 * nenhuma busca mais nova da mesma rota já tiver entrado, e se não houve
 * `invalidar` depois que ela saiu — sem isso, o GET lento disparado antes de
 * uma gravação chegava depois do `invalidar` e devolvia ao cache o dado velho.
 */
let seqBusca = 0;
let ultimaInvalidacao = 0;
const seqGuardado = new Map();
const guardadoEm = new Map();

/*
 * Resposta com menos de um minuto não é buscada de novo ao abrir a tela.
 *
 * Cada busca custa leitura no D1, e a cota diária é o limite real do painel —
 * foi ela que derrubou todas as telas com 500. Ir e voltar entre Funil e
 * Visão geral refazia todas as consultas a cada troca de menu.
 */
const FRESCO_MS = 60_000;
function guardar(caminho, dados, seq) {
  if (seq < ultimaInvalidacao || seq < (seqGuardado.get(caminho) ?? 0)) return;
  seqGuardado.set(caminho, seq);
  guardadoEm.set(caminho, Date.now());
  cache.delete(caminho);
  cache.set(caminho, dados);
  if (cache.size > LIMITE_CACHE) {
    const velho = cache.keys().next().value;
    cache.delete(velho);
    seqGuardado.delete(velho);
  }
}

/** Esquece o cache de rotas que começam com `prefixo` — use depois de gravar. */
export function invalidar(prefixo = '') {
  ultimaInvalidacao = ++seqBusca;
  semCacheAte = Date.now() + 15_000;
  for (const k of [...cache.keys()]) if (k.startsWith(prefixo)) cache.delete(k);
}

/**
 * Busca uma ou várias rotas e devolve { dados, carregando, atualizando, erro }.
 *
 * `chave` controla o refetch: mudou o período ou o filtro, refaz. Um contador
 * de requisição descarta resposta de chamada antiga — sem isso, trocar o
 * período duas vezes rápido pode deixar a resposta lenta da primeira
 * sobrescrever a da segunda.
 *
 * `carregando` só é verdadeiro quando não há NADA para mostrar — é o sinal
 * para o esqueleto. `atualizando` diz que há dado na tela e um mais novo a
 * caminho — é o sinal para esmaecer, não para apagar.
 *
 * `manter: true` segura os dados da busca anterior enquanto a nova não chega.
 * É para filtro e período, em que o formato da resposta não muda. Não use onde
 * a chave troca de entidade (outro lead, outra campanha): ali o dado velho é
 * de outra coisa, e mostrá-lo seria mentir por meio segundo.
 */
export function useApi(caminhos, chave, { manter = false } = {}) {
  const lerCache = () => {
    const lista = (Array.isArray(caminhos) ? caminhos : [caminhos]).filter(Boolean);
    if (!lista.length || !lista.every((c) => cache.has(c))) return null;
    const r = lista.map((c) => cache.get(c));
    return Array.isArray(caminhos) ? r : r[0];
  };
  const [estado, setEstado] = useState(() => {
    const c = lerCache();
    return { dados: c, carregando: !c, atualizando: Boolean(c), erro: null };
  });

  /*
   * Só a busca da chave com que a tela abriu pode ser poupada; troca de chave
   * sempre busca (é assim que as telas recarregam depois de gravar). Compara
   * a chave em vez de contar execuções porque o StrictMode roda o efeito duas
   * vezes na montagem.
   */
  const ultimaChave = useRef(chave);

  useEffect(() => {
    let atual = true;
    const primeira = ultimaChave.current === chave;
    ultimaChave.current = chave;

    /*
     * Caminho nulo é "não busque ainda", não um erro.
     *
     * Deixa a tela adiar uma consulta cara até alguém precisar dela — a lista de
     * contêineres do GTM, por exemplo, custa duas idas ao Google por conta e só
     * interessa a quem abriu o bloco de instalação. Sem esta guarda, o `null`
     * virava `fetch(null)`, que busca a URL relativa "/null" e devolve 404.
     */
    const lista = (Array.isArray(caminhos) ? caminhos : [caminhos]).filter(Boolean);
    if (!lista.length) {
      setEstado({ dados: null, carregando: false, atualizando: false, erro: null });
      return undefined;
    }

    const doCache = lerCache();
    if (primeira && doCache && lista.every((c) => Date.now() - (guardadoEm.get(c) ?? 0) < FRESCO_MS)) {
      setEstado({ dados: doCache, carregando: false, atualizando: false, erro: null });
      return undefined;
    }
    setEstado((e) => {
      if (doCache) return { dados: doCache, carregando: false, atualizando: true, erro: null };
      if (manter && e.dados) return { ...e, carregando: false, atualizando: true, erro: null };
      return { dados: null, carregando: true, atualizando: false, erro: null };
    });
    const seq = ++seqBusca;
    Promise.all(lista.map(buscar))
      .then((r) => {
        lista.forEach((c, i) => guardar(c, r[i], seq));
        if (!atual) return;
        setEstado({ dados: Array.isArray(caminhos) ? r : r[0], carregando: false, atualizando: false, erro: null });
      })
      .catch((e) => {
        if (!atual) return;
        setEstado({ dados: null, carregando: false, atualizando: false, erro: e.message });
      });

    return () => {
      atual = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  return estado;
}
