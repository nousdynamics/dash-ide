import { useState } from 'react';
import { Cartao, Estado, Esqueleto, Pill } from '../componentes/base';
import { useApi } from '../lib/api';
import { fmtDataHora, fmtInt } from '../lib/formato';

const ROTULO_CANAL = { rubeus: 'Rubeus', evolution: 'Evolution API', n8n: 'n8n' };

const ROTULO_EVENTO = {
  geral: 'Geral — recebe tudo',
  registro_processo: 'Novo registro de processo',
  ocorrencia_evento: 'Ocorrência de um evento',
  contato_criacao: 'Criação de contato',
  contato_edicao: 'Edição de contato',
  atividade_criacao: 'Criação de atividade',
  atividade_edicao: 'Edição de atividade',
};

/**
 * Botão de gerar link.
 *
 * Não existe mais "copiar": o banco guarda só o hash do token, então não há
 * valor a reexibir. Quem gera recebe a URL uma vez, na resposta, e ela vai
 * direto para a área de transferência — nunca chega a ser desenhada na tela.
 *
 * Trocar de link exige confirmação porque invalida o anterior na hora: o que
 * estiver colado no Rubeus para de funcionar até ser substituído.
 */
function BotaoGerar({ rota, jaTemLink, aoGerar }) {
  const [estado, setEstado] = useState('pronto');
  const [confirmando, setConfirmando] = useState(false);

  const gerar = async () => {
    setConfirmando(false);
    setEstado('gerando');
    try {
      const r = await fetch(rota, { method: 'POST' });
      if (!r.ok) throw new Error(String(r.status));
      const { url } = await r.json();
      await navigator.clipboard.writeText(url);
      setEstado('copiado');
      aoGerar?.();
      setTimeout(() => setEstado('pronto'), 4000);
    } catch {
      setEstado('erro');
      setTimeout(() => setEstado('pronto'), 4000);
    }
  };

  if (confirmando) {
    return (
      <span className="flex items-center gap-2 text-[11px] shrink-0">
        <span className="text-atencao">Invalida o link atual.</span>
        <button
          type="button"
          onClick={gerar}
          className="px-2 py-[5px] rounded-[8px] border border-perigo/40 bg-perigo/12 text-perigo cursor-pointer"
        >
          Gerar mesmo assim
        </button>
        <button
          type="button"
          onClick={() => setConfirmando(false)}
          className="px-2 py-[5px] rounded-[8px] border border-borda-forte bg-superficie text-secundario cursor-pointer"
        >
          Cancelar
        </button>
      </span>
    );
  }

  const rotulo = {
    pronto: jaTemLink ? 'Gerar novo link' : 'Gerar link',
    gerando: 'Gerando…',
    copiado: 'Copiado para a área de transferência',
    erro: 'Falhou',
  }[estado];

  return (
    <button
      type="button"
      onClick={() => (jaTemLink ? setConfirmando(true) : gerar())}
      disabled={estado === 'gerando'}
      className={`inline-flex items-center gap-[6px] text-[11px] px-2 py-[5px] rounded-[8px] border cursor-pointer shrink-0
        ${estado === 'copiado'
          ? 'border-sucesso/40 bg-sucesso/12 text-sucesso'
          : estado === 'erro'
            ? 'border-perigo/40 bg-perigo/12 text-perigo'
            : jaTemLink
              ? 'border-borda-forte bg-superficie text-secundario hover:bg-superficie-hover hover:text-primario'
              : 'border-azul-500 bg-azul-600 text-white hover:bg-azul-500'}`}
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

/** Estado do link, no lugar dos bullets que antes fingiam mostrar o token. */
function LinhaWebhook({ funilId, w, aoGerar }) {
  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 py-2 border-t border-borda first:border-t-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold">{ROTULO_CANAL[w.canal] || w.canal}</span>
          {!w.tem_link ? (
            <Pill tom="atencao">sem link gerado</Pill>
          ) : w.total_recebido > 0 ? (
            <Pill tom="sucesso">{fmtInt(w.total_recebido)} evento(s)</Pill>
          ) : (
            <Pill tom="neutro">sem evento ainda</Pill>
          )}
        </div>
        <div className="text-[11px] text-tenue mt-1 font-mono break-all">{w.caminho}</div>
        {w.ultimo_uso_em && (
          <div className="text-[11px] text-tenue mt-px">Último evento: {fmtDataHora(w.ultimo_uso_em)}</div>
        )}
      </div>

      <BotaoGerar
        rota={`/api/funis/${funilId}/regerar/${w.canal}`}
        jaTemLink={w.tem_link}
        aoGerar={aoGerar}
      />
    </div>
  );
}

export function Webhooks() {
  const [versao, setVersao] = useState(0);
  const [nome, setNome] = useState('');
  const [erroForm, setErroForm] = useState(null);
  const [syncMsg, setSyncMsg] = useState(null);
  const { dados, carregando, erro } = useApi('/api/funis', `funis-${versao}`);

  const recarregar = () => setVersao((v) => v + 1);

  const syncRubeus = async () => {
    setSyncMsg('Sincronizando…');
    try {
      const r = await fetch('/api/admin/rubeus/sync', { method: 'POST' });
      const c = await r.json().catch(() => ({}));
      if (!r.ok) {
        setSyncMsg(c.detalhe || 'Falha na sincronização');
        return;
      }
      setSyncMsg(
        `OK: ${c.cursos?.cursos ?? 0} cursos, ${c.cursos?.ofertas ?? 0} ofertas, ${c.etapas?.etapas ?? 0} etapas.`,
      );
    } catch {
      setSyncMsg('Não foi possível falar com o servidor.');
    }
  };

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

  const remover = async (funilId) => {
    await fetch(`/api/funis/${funilId}`, { method: 'DELETE' });
    recarregar();
  };

  const cabecalho = (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <div className="text-[19px] font-semibold tracking-tight">Funis e webhooks</div>
        <div className="text-tenue text-xs mt-[2px]">
          Um link por funil e por canal. O banco guarda só o hash do token, então o link aparece
          uma única vez, ao ser gerado. Os leads recebidos ficam em{' '}
          <strong className="text-secundario">Funil de vendas</strong>.
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={syncRubeus}
          className="text-xs px-3 py-[6px] rounded-[8px] bg-superficie border border-borda-forte
                     text-secundario cursor-pointer hover:bg-superficie-hover hover:text-primario"
        >
          Sincronizar cursos/etapas (Rubeus)
        </button>
        {syncMsg && <span className="text-[11px] text-tenue max-w-[280px] text-right">{syncMsg}</span>}
      </div>
    </div>
  );

  /* 403 não é falha: é a resposta certa para quem não administra webhooks. */
  if (erro?.includes('403') || erro?.includes('sem_permissao')) {
    return (
      <>
        {cabecalho}
        <Cartao>
          <Estado
            titulo="Esta tela é restrita"
            mensagem="Ela emite as credenciais que autorizam o Rubeus e a Evolution a gravar no banco, por isso fica com quem administra a integração. As telas de resultado continuam abertas para você."
          />
        </Cartao>
      </>
    );
  }

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
        <div className="text-[11px] text-tenue mt-2 leading-relaxed">
          O funil nasce com os três canais e <strong className="text-secundario">sem link</strong>:
          clique em gerar no canal que for usar. As etapas não são cadastradas aqui — são
          descobertas a partir dos eventos que o Rubeus enviar.
          <br />
          <strong className="text-secundario">Um link por funil, usado em todas as etapas dele.</strong>{' '}
          Nos gatilhos que permitem escolher o processo — novo registro de processo e ocorrência de
          um evento — use o link do funil correspondente. Evento que chegar sem etapa é gravado
          assim mesmo e aparece marcado no histórico do lead, para nenhum se perder.
        </div>
      </Cartao>

      {dados.por_evento?.length > 0 && (
        <Cartao>
          <div className="text-[13px] font-semibold">Webhooks por tipo de evento</div>
          <div className="text-[11px] text-tenue mt-1 mb-2 leading-relaxed">
            Para os gatilhos que <strong className="text-secundario">não</strong> deixam escolher o
            processo. Os que deixam — novo registro de processo e ocorrência de um evento — usam o
            link do funil, mais abaixo.
            <br />
            <strong className="text-secundario">O "Geral" aceita qualquer payload e nunca recusa</strong>:
            o que ele não souber interpretar fica guardado cru no histórico do lead, para ser tratado
            depois. Use enquanto o formato de um gatilho ainda não é conhecido.
          </div>
          {[...dados.por_evento].sort((a, b) =>
            a.evento === 'geral' ? -1 : b.evento === 'geral' ? 1 : a.evento.localeCompare(b.evento),
          ).map((w) => (
            <div key={w.id} className="flex flex-col md:flex-row md:items-center md:justify-between
                                       gap-2 py-2 border-t border-borda">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-semibold ${w.evento === 'geral' ? 'text-azul-300' : ''}`}>
                    {ROTULO_CANAL[w.canal] || w.canal} · {ROTULO_EVENTO[w.evento] || w.evento}
                  </span>
                  {!w.tem_link
                    ? <Pill tom="atencao">sem link gerado</Pill>
                    : w.total_recebido > 0
                      ? <Pill tom="sucesso">{fmtInt(w.total_recebido)} evento(s)</Pill>
                      : <Pill tom="neutro">sem evento ainda</Pill>}
                </div>
                <div className="text-[11px] text-tenue mt-1 font-mono break-all">{w.caminho}</div>
                {w.ultimo_uso_em && (
                  <div className="text-[11px] text-tenue mt-px">Último: {fmtDataHora(w.ultimo_uso_em)}</div>
                )}
              </div>
              <BotaoGerar
                rota={`/api/funis/token-evento/${w.id}`}
                jaTemLink={w.tem_link}
                aoGerar={recarregar}
              />
            </div>
          ))}
        </Cartao>
      )}

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
              <LinhaWebhook key={w.canal} funilId={f.id} w={w} aoGerar={recarregar} />
            ))
          ) : (
            <div className="text-xs text-tenue py-2">Nenhum webhook gerado para este funil.</div>
          )}
        </Cartao>
      ))}
    </>
  );
}
