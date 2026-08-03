import { useState } from 'react';
import { Cartao, Estado, Esqueleto, Pill } from '../componentes/base';
import { buscar, useApi } from '../lib/api';
import { fmtDataHora, fmtInt } from '../lib/formato';

/**
 * Diário de bordo: o que chegou de fato, aceito ou recusado.
 *
 * Responde "o Rubeus está mandando?" e, se está, "por que foi recusado?".
 * Sem isso o diagnóstico de integração vira tentativa e erro às cegas.
 */
function DiarioDeBordo({ versao }) {
  const { dados, carregando } = useApi('/api/funis/eventos?limite=30', `eventos-${versao}`);
  if (carregando || !dados) return <Esqueleto linhas={3} />;
  if (!dados.itens.length) {
    return (
      <Estado
        titulo="Nenhum evento recebido ainda"
        mensagem="Assim que o Rubeus ou a Evolution dispararem para algum link, o payload aparece aqui — aceito ou recusado, com o motivo."
      />
    );
  }
  return dados.itens.map((e, i) => (
    <div key={i} className={`py-2 ${i ? 'border-t border-borda' : ''}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <Pill tom={e.status === 'aceito' ? 'sucesso' : 'perigo'}>
          {e.status === 'aceito' ? 'aceito' : 'recusado'}
        </Pill>
        <span className="text-[11px] text-secundario">
          {e.canal} · {e.funil_slug}
        </span>
        <span className="text-[11px] text-tenue">{fmtDataHora(e.recebido_em)}</span>
      </div>
      {e.detalhe && <div className="text-[11px] text-perigo mt-1">{e.detalhe}</div>}
      {e.corpo && (
        <pre className="text-[10px] text-tenue mt-1 whitespace-pre-wrap break-all bg-elevado rounded-[8px] p-2 max-h-32 overflow-auto">
          {e.corpo}
        </pre>
      )}
    </div>
  ));
}

const ROTULO_CANAL = { rubeus: 'Rubeus', evolution: 'Evolution API', n8n: 'n8n' };

/**
 * Botão de copiar.
 *
 * O token nunca vem na listagem: é buscado aqui, no clique, e vai direto para a
 * área de transferência. Assim ele não fica no HTML, não aparece em screenshot
 * e não é lido por quem olha a tela por cima do ombro.
 */
function BotaoCopiar({ funilId, canal }) {
  const [estado, setEstado] = useState('pronto');

  const copiar = async () => {
    setEstado('buscando');
    try {
      const { url } = await buscar(`/api/funis/${funilId}/token/${canal}`);
      await navigator.clipboard.writeText(url);
      setEstado('copiado');
      setTimeout(() => setEstado('pronto'), 2000);
    } catch {
      setEstado('erro');
      setTimeout(() => setEstado('pronto'), 3000);
    }
  };

  const rotulo = { pronto: 'Copiar link', buscando: 'Copiando…', copiado: 'Copiado', erro: 'Falhou' }[estado];

  return (
    <button
      type="button"
      onClick={copiar}
      disabled={estado === 'buscando'}
      className={`inline-flex items-center gap-[6px] text-[11px] px-2 py-[5px] rounded-[8px] border cursor-pointer
        ${estado === 'copiado'
          ? 'border-sucesso/40 bg-sucesso/12 text-sucesso'
          : estado === 'erro'
            ? 'border-perigo/40 bg-perigo/12 text-perigo'
            : 'border-borda-forte bg-superficie text-secundario hover:bg-superficie-hover hover:text-primario'}`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-[13px] h-[13px]" aria-hidden="true">
        {estado === 'copiado' ? (
          <path d="M20 6 9 17l-5-5" />
        ) : (
          <>
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h8" />
          </>
        )}
      </svg>
      {rotulo}
    </button>
  );
}

function LinhaWebhook({ funilId, w, aoRegerar }) {
  const [confirmando, setConfirmando] = useState(false);

  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 py-2 border-t border-borda first:border-t-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold">{ROTULO_CANAL[w.canal] || w.canal}</span>
          {w.total_recebido > 0 ? (
            <Pill tom="sucesso">{fmtInt(w.total_recebido)} evento(s)</Pill>
          ) : (
            <Pill tom="neutro">sem evento ainda</Pill>
          )}
        </div>
        <div className="text-[11px] text-tenue mt-1 font-mono break-all">
          {w.caminho}?t=<span className="text-tenue/70">••••••••••••</span>
        </div>
        {w.ultimo_uso_em && (
          <div className="text-[11px] text-tenue mt-px">Último evento: {fmtDataHora(w.ultimo_uso_em)}</div>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <BotaoCopiar funilId={funilId} canal={w.canal} />
        {confirmando ? (
          <span className="flex items-center gap-2 text-[11px]">
            <button
              type="button"
              onClick={() => {
                aoRegerar(funilId, w.canal);
                setConfirmando(false);
              }}
              className="px-2 py-[5px] rounded-[8px] border border-perigo/40 bg-perigo/12 text-perigo cursor-pointer"
            >
              Confirmar
            </button>
            <button
              type="button"
              onClick={() => setConfirmando(false)}
              className="px-2 py-[5px] rounded-[8px] border border-borda-forte bg-superficie text-secundario cursor-pointer"
            >
              Cancelar
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmando(true)}
            title="Gera um token novo e invalida o atual na hora"
            className="text-[11px] px-2 py-[5px] rounded-[8px] border border-borda-forte bg-superficie
                       text-secundario hover:bg-superficie-hover cursor-pointer"
          >
            Regerar
          </button>
        )}
      </div>
    </div>
  );
}

export function Webhooks() {
  const [versao, setVersao] = useState(0);
  const [nome, setNome] = useState('');
  const [erroForm, setErroForm] = useState(null);
  const { dados, carregando, erro } = useApi('/api/funis', `funis-${versao}`);

  const recarregar = () => setVersao((v) => v + 1);

  const criar = async (e) => {
    e.preventDefault();
    setErroForm(null);
    try {
      const r = await fetch('/api/funis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome }),
      });
      if (!r.ok) {
        const c = await r.json().catch(() => ({}));
        setErroForm(c.erro === 'funil_ja_existe' ? 'Já existe um funil com esse nome.' : 'Não foi possível criar.');
        return;
      }
      setNome('');
      recarregar();
    } catch {
      setErroForm('Não foi possível falar com o servidor.');
    }
  };

  const regerar = async (funilId, canal) => {
    await fetch(`/api/funis/${funilId}/regerar/${canal}`, { method: 'POST' });
    recarregar();
  };

  const remover = async (funilId) => {
    await fetch(`/api/funis/${funilId}`, { method: 'DELETE' });
    recarregar();
  };

  const cabecalho = (
    <div>
      <div className="text-[19px] font-semibold tracking-tight">Funis e webhooks</div>
      <div className="text-tenue text-xs mt-[2px]">
        Um link por funil e por canal. O token nunca aparece na tela — o botão copia direto.
      </div>
    </div>
  );

  if (erro) return <>{cabecalho}<Cartao><Estado tipo="erro" titulo="Não foi possível carregar" mensagem={erro} /></Cartao></>;
  if (carregando || !dados) return <>{cabecalho}<Esqueleto linhas={5} /></>;

  return (
    <>
      {cabecalho}

      <Cartao>
        <form onSubmit={criar} className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome do novo funil…"
            aria-label="Nome do novo funil"
            className="bg-superficie text-primario border border-borda-forte rounded-[8px] px-2 py-[5px] text-xs flex-1 min-w-[180px]"
          />
          <button
            type="submit"
            disabled={nome.trim().length < 2}
            className="text-xs px-3 py-[6px] rounded-[8px] bg-azul-600 text-white border-0 cursor-pointer
                       disabled:opacity-40 disabled:cursor-not-allowed hover:bg-azul-500"
          >
            Adicionar funil
          </button>
          {erroForm && <span className="text-[11px] text-perigo">{erroForm}</span>}
        </form>
        <div className="text-[11px] text-tenue mt-2">
          Ao criar, os três links já são gerados. As etapas do funil não são cadastradas aqui —
          são descobertas a partir dos eventos que o Rubeus enviar, que é a fonte da verdade delas.
        </div>
      </Cartao>

      <Cartao>
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="text-[13px] font-semibold">Últimos eventos recebidos</div>
          <button
            type="button"
            onClick={recarregar}
            className="text-[11px] px-2 py-[5px] rounded-[8px] border border-borda-forte bg-superficie
                       text-secundario hover:bg-superficie-hover cursor-pointer"
          >
            Atualizar
          </button>
        </div>
        <DiarioDeBordo versao={versao} />
      </Cartao>

      {dados.itens.map((f) => (
        <Cartao key={f.id}>
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <div className="text-[13px] font-semibold">{f.nome}</div>
              <div className="text-[11px] text-tenue font-mono">{f.slug}</div>
            </div>
            <button
              type="button"
              onClick={() => remover(f.id)}
              title="Desativa o funil; o histórico de leads é preservado"
              className="text-[11px] px-2 py-[5px] rounded-[8px] border border-borda-forte bg-superficie
                         text-secundario hover:bg-superficie-hover cursor-pointer shrink-0"
            >
              Desativar
            </button>
          </div>
          {f.webhooks.length ? (
            f.webhooks.map((w) => (
              <LinhaWebhook key={w.canal} funilId={f.id} w={w} aoRegerar={regerar} />
            ))
          ) : (
            <div className="text-xs text-tenue py-2">Nenhum webhook gerado para este funil.</div>
          )}
        </Cartao>
      ))}
    </>
  );
}
