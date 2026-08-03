import { useState } from 'react';
import { Cartao, Estado, Esqueleto, Pill, Sanfona } from '../componentes/base';
import { buscar, useApi } from '../lib/api';
import { fmtDataHora, fmtInt, iniciais } from '../lib/formato';

/** Copia um texto qualquer, com retorno visual curto. */
function BotaoCopiarTexto({ texto, rotulo = 'Copiar payload' }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(texto);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 2000);
      }}
      className={`text-[10px] px-2 py-[3px] rounded-[8px] border cursor-pointer shrink-0
        ${copiado
          ? 'border-sucesso/40 bg-sucesso/12 text-sucesso'
          : 'border-borda-forte bg-superficie text-secundario hover:bg-superficie-hover'}`}
    >
      {copiado ? 'Copiado' : rotulo}
    </button>
  );
}

/** Tenta formatar o corpo como JSON legível; se não for, devolve como veio. */
function corpoLegivel(corpo) {
  if (!corpo) return '';
  try {
    return JSON.stringify(JSON.parse(corpo), null, 2);
  } catch {
    // Form-urlencoded: uma linha por campo lê melhor que uma linha só.
    if (corpo.includes('=') && !corpo.trim().startsWith('{')) {
      try {
        return [...new URLSearchParams(corpo).entries()]
          .map(([k, v]) => `${k} = ${v}`)
          .join('\n');
      } catch {
        /* deixa cru */
      }
    }
    return corpo;
  }
}

const IconeDoc = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
       className="w-[14px] h-[14px] shrink-0" aria-hidden="true">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </svg>
);

function EventoDoLead({ e }) {
  const [aberto, setAberto] = useState(false);
  const texto = corpoLegivel(e.corpo);
  const tom = e.status === 'aceito' ? 'sucesso' : e.status === 'aceito_sem_etapa' ? 'atencao' : 'perigo';
  return (
    <Sanfona
      nivel={2}
      aberta={aberto}
      aoAlternar={() => setAberto((v) => !v)}
      titulo={
        <span className="flex items-center gap-2 min-w-0 text-xs">
          <IconeDoc />
          <span className="truncate">{e.etapa || '(sem etapa)'}</span>
          <Pill tom={tom}>{e.status.replace(/_/g, ' ')}</Pill>
        </span>
      }
      resumo={`${e.canal} · ${fmtDataHora(e.recebido_em)}`}
    >
      {e.detalhe && <div className="text-[11px] text-atencao mb-1">{e.detalhe}</div>}
      <div className="flex justify-end mb-1">
        <BotaoCopiarTexto texto={texto} />
      </div>
      <pre className="text-[10px] text-secundario whitespace-pre-wrap break-all bg-elevado
                      rounded-[8px] p-2 max-h-72 overflow-auto">
        {texto || '(corpo vazio)'}
      </pre>
    </Sanfona>
  );
}

/**
 * Histórico por lead.
 *
 * A leitura útil não é cronológica, é por pessoa: o que já chegou deste lead,
 * na ordem, com o corpo cru de cada passagem de etapa. É o que reconstrói a
 * jornada e permite copiar o payload inteiro quando algo não mapeia.
 */
function HistoricoPorLead({ versao }) {
  const [abertos, setAbertos] = useState({});
  const { dados, carregando } = useApi('/api/funis/eventos-por-lead?leads=40', `lead-${versao}`);

  if (carregando || !dados) return <Esqueleto linhas={3} />;
  if (!dados.leads.length && !dados.sem_contato.length) {
    return (
      <Estado
        titulo="Nenhum evento recebido ainda"
        mensagem="Assim que o Rubeus ou a Evolution dispararem, cada lead aparece aqui com o histórico completo do que chegou."
      />
    );
  }

  const alternar = (k) => setAbertos((a) => ({ ...a, [k]: !a[k] }));

  return (
    <div className="flex flex-col gap-2">
      {dados.leads.map((l) => {
        const todos = JSON.stringify(l.eventos.map((e) => e.corpo), null, 2);
        return (
          <Sanfona
            key={l.contato_id}
            aberta={!!abertos[l.contato_id]}
            aoAlternar={() => alternar(l.contato_id)}
            titulo={
              <span className="flex items-center gap-2 min-w-0">
                <span className="w-6 h-6 rounded-full bg-azul-700 text-white flex items-center
                                 justify-center text-[10px] font-semibold shrink-0">
                  {iniciais(l.contato_nome)}
                </span>
                <span className="text-[13px] font-semibold truncate">
                  {l.contato_nome || `Contato ${l.contato_id}`}
                </span>
              </span>
            }
            resumo={`${l.eventos.length} evento(s) · ${l.funil_slug} · ${fmtDataHora(l.ultimo_em)}`}
          >
            <div className="flex justify-end mb-1">
              <BotaoCopiarTexto texto={todos} rotulo="Copiar todos os payloads" />
            </div>
            {l.eventos.map((e, i) => (
              <EventoDoLead key={i} e={e} />
            ))}
          </Sanfona>
        );
      })}

      {dados.sem_contato.length > 0 && (
        <Sanfona
          aberta={!!abertos.__orfaos}
          aoAlternar={() => alternar('__orfaos')}
          titulo={<span className="text-[13px] font-semibold">Sem contato identificado</span>}
          resumo={`${dados.sem_contato.length} evento(s)`}
        >
          {dados.sem_contato.map((e, i) => (
            <EventoDoLead key={i} e={{ ...e, etapa: e.etapa || '(recusado)' }} />
          ))}
        </Sanfona>
      )}
    </div>
  );
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

      <div className="flex items-center gap-2 shrink-0 flex-wrap">
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
        <div className="text-[11px] text-tenue mt-2 leading-relaxed">
          Ao criar, os três links já são gerados. As etapas do funil não são cadastradas aqui —
          são descobertas a partir dos eventos que o Rubeus enviar.
          <br />
          <strong className="text-secundario">Um link por funil, usado em todas as etapas dele.</strong>{' '}
          No fluxo de automação do Rubeus, inclua um parâmetro com a etapa nos "Enviar parâmetros"
          da ação HTTP — o sistema separa as etapas depois de receber. Evento que chegar sem etapa
          é gravado assim mesmo e aparece marcado no diário abaixo, para nenhum lead se perder.
        </div>
      </Cartao>

      <Cartao>
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="text-[13px] font-semibold">Eventos recebidos, por lead</div>
          <button
            type="button"
            onClick={recarregar}
            className="text-[11px] px-2 py-[5px] rounded-[8px] border border-borda-forte bg-superficie
                       text-secundario hover:bg-superficie-hover cursor-pointer"
          >
            Atualizar
          </button>
        </div>
        <HistoricoPorLead versao={versao} />
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
