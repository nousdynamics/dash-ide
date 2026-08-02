import { useEffect, useState } from 'react';

export class ErroApi extends Error {}

export async function buscar(caminho) {
  let resp;
  try {
    resp = await fetch(caminho, { headers: { Accept: 'application/json' } });
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

/**
 * Busca uma ou várias rotas e devolve { dados, carregando, erro }.
 *
 * `chave` controla o refetch: mudou o período ou o filtro, refaz. Um contador
 * de requisição descarta resposta de chamada antiga — sem isso, trocar o
 * período duas vezes rápido pode deixar a resposta lenta da primeira
 * sobrescrever a da segunda.
 */
export function useApi(caminhos, chave) {
  const [estado, setEstado] = useState({ dados: null, carregando: true, erro: null });

  useEffect(() => {
    let atual = true;
    setEstado((e) => ({ ...e, carregando: true, erro: null }));

    const lista = Array.isArray(caminhos) ? caminhos : [caminhos];
    Promise.all(lista.map(buscar))
      .then((r) => {
        if (!atual) return;
        setEstado({ dados: Array.isArray(caminhos) ? r : r[0], carregando: false, erro: null });
      })
      .catch((e) => {
        if (!atual) return;
        setEstado({ dados: null, carregando: false, erro: e.message });
      });

    return () => {
      atual = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  return estado;
}
