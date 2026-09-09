import { useCallback, useEffect, useMemo, useState } from 'react';
import { Cartao, Estado, Esqueleto, Pill, Select, Switch } from '../componentes/base';
import { useApi } from '../lib/api';
import { ROTULO_STATUS, TOM_STATUS } from '../lib/conversao';
import { MonitorConversoes } from './MonitorConversoes';
import { fmtInt } from '../lib/formato';

/**
 * Conversão offline — o fluxo que saiu do n8n.
 *
 * Organização: (0) Google pronto → (1) gatilhos por processo → (2) ctId / ação
 * por evento × nível → (3) captura do clique → (4) planilha → registro.
 */

async function enviar(rota, corpo, metodo = 'POST') {
  const r = await fetch(rota, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.detalhe || dados.erro || `servidor respondeu ${r.status}`);
  return dados;
}

function Acao({ children, aoClicar, tom = 'neutro', titulo }) {
  const [estado, setEstado] = useState('pronto');
  const [msg, setMsg] = useState('');

  const rodar = async () => {
    setEstado('rodando');
    setMsg('');
    try {
      const r = await aoClicar();
      setEstado('ok');
      if (typeof r === 'string') setMsg(r);
      setTimeout(() => setEstado('pronto'), 4000);
    } catch (e) {
      setEstado('erro');
      setMsg(e.message);
    }
  };

  const cor = estado === 'erro'
    ? 'border-perigo/40 bg-perigo/12 text-perigo'
    : estado === 'ok'
      ? 'border-sucesso/40 bg-sucesso/12 text-sucesso'
      : tom === 'primario'
        ? 'border-azul-500 bg-azul-600 text-white hover:bg-azul-500'
        : 'border-borda-forte bg-superficie text-secundario hover:bg-superficie-hover hover:text-primario';

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        title={titulo}
        onClick={rodar}
        disabled={estado === 'rodando'}
        className={`text-[11px] px-2 py-[5px] rounded-[8px] border cursor-pointer shrink-0
                    disabled:opacity-50 disabled:cursor-not-allowed ${cor}`}
      >
        {estado === 'rodando' ? 'Aguarde…' : estado === 'ok' ? 'Feito' : children}
      </button>
      {msg && (
        <span className={`text-[10px] max-w-[320px] ${estado === 'erro' ? 'text-perigo' : 'text-tenue'}`}>
          {msg}
        </span>
      )}
    </span>
  );
}

function nomeProcesso(id, nome) {
  if (nome && nome !== id) return nome;
  const fixos = { 0: 'Sem processo (legado)', 7: 'Eventos / processo 7' };
  return fixos[String(id)] || `Processo ${id}`;
}

export function Conversoes() {
  const [versao, setVersao] = useState(0);
  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  const { dados, carregando, erro } = useApi('/api/conversoes', `conversoes-${versao}`);
  const [processoAtivo, setProcessoAtivo] = useState(null);

  const pipelinesOrd = useMemo(() => {
    const lista = (dados?.pipelines ?? []).map((p) => ({
      ...p,
      processo_nome: nomeProcesso(p.processo_id, p.processo_nome),
    }));
    return lista.sort((a, b) =>
      String(a.processo_nome).localeCompare(String(b.processo_nome), 'pt-BR'),
    );
  }, [dados?.pipelines]);

  useEffect(() => {
    if (!pipelinesOrd.length) return;
    if (processoAtivo && pipelinesOrd.some((p) => p.processo_id === processoAtivo)) return;
    const preferido =
      pipelinesOrd.find((p) => !/^(Processo |\d+$)/.test(p.processo_nome) && p.processo_id !== '0')
      || pipelinesOrd[0];
    setProcessoAtivo(preferido.processo_id);
  }, [pipelinesOrd, processoAtivo]);

  const cabecalho = (
    <div>
      <div className="text-[19px] font-semibold tracking-tight">Conversão offline</div>
      <div className="text-tenue text-xs mt-[2px] max-w-[720px] leading-relaxed">
        Mapeia etapa do Rubeus → evento → ação do Google Ads (ctId). Quando o lead muda de etapa,
        o painel envia a conversão com o identificador do clique (ou e-mail/telefone em hash).
      </div>
    </div>
  );

  if (erro?.includes('403') || erro?.includes('sem_permissao')) {
    return (
      <>
        {cabecalho}
        <Cartao>
          <Estado
            titulo="Esta tela é restrita"
            mensagem="Ela decide o que o Google Ads recebe. Fica com quem administra a conta de anúncios."
          />
        </Cartao>
      </>
    );
  }
  if (erro) {
    return (
      <>
        {cabecalho}
        <Cartao>
          <Estado tipo="erro" titulo="Não foi possível carregar" mensagem={erro} />
        </Cartao>
      </>
    );
  }
  if (carregando || !dados) return <>{cabecalho}<Esqueleto linhas={8} /></>;

  const {
    config, eventos, gatilhos, acoes, resumo, niveis, captura,
    nivel_padrao, script_url, google, metas_google,
  } = dados;

  const pipeline = pipelinesOrd.find((p) => p.processo_id === processoAtivo) ?? null;

  const trocarConfig = async (mudanca) => {
    await enviar('/api/conversoes/config', mudanca, 'PUT');
    recarregar();
  };

  const checklist = [
    {
      ok: google.conectado && google.tem_datamanager,
      rotulo: google.origem === 'secret'
        ? 'Google com escopo Data Manager (secret do Worker)'
        : 'Google com escopo Data Manager',
      falta: google.conectado
        ? 'A conta conectada não concedeu o escopo datamanager'
        : 'Publicar GOOGLE_ADS_REFRESH_TOKEN com o escopo datamanager',
    },
    {
      ok: (gatilhos ?? []).some((g) => g.ativo),
      rotulo: 'Pelo menos 1 gatilho ativo (etapa → evento)',
      falta: 'Ligar gatilho na seção 1',
    },
    {
      ok: (acoes ?? []).some((a) => a.ativo && a.conversion_action_id),
      rotulo: 'ctId / ação de conversão mapeada',
      falta: 'Colar ou criar ctId na seção 2',
    },
    {
      ok: config.ligado,
      rotulo: 'Envio ligado',
      falta: 'Ligar o interruptor abaixo',
    },
  ];

  return (
    <>
      {cabecalho}

      {/* Checklist do que falta para enviar */}
      <Cartao>
        <div className="text-[13px] font-semibold mb-2">Para o Google receber o evento</div>
        <ul className="flex flex-col gap-1.5">
          {checklist.map((c) => (
            <li key={c.rotulo} className="flex items-start gap-2 text-xs">
              <span className={c.ok ? 'text-sucesso' : 'text-atencao'} aria-hidden="true">
                {c.ok ? '✓' : '○'}
              </span>
              <span className={c.ok ? 'text-secundario' : 'text-primario'}>
                {c.ok ? c.rotulo : <><strong>{c.falta}</strong></>}
              </span>
            </li>
          ))}
        </ul>
        <div className="text-[11px] text-tenue mt-3 pt-3 border-t border-borda leading-relaxed">
          Em cada envio o Google exige ainda: <strong className="text-secundario">identificador</strong>{' '}
          (gclid/gbraid/wbraid <em>ou</em> e-mail/telefone em hash) +{' '}
          <strong className="text-secundario">timestamp</strong> +{' '}
          <strong className="text-secundario">ctId</strong> da ação. Valor (R$) é opcional no protocolo,
          mas necessário para Smart Bidding.
        </div>
      </Cartao>

      {!google.tem_datamanager && (
        <Cartao>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-atencao">
              {google.conectado
                ? 'A conta Google conectada não tem o escopo Data Manager'
                : 'Nenhuma conta Google conectada'}
            </div>
            <div className="text-[11px] text-tenue mt-1 max-w-[680px] leading-relaxed">
              Upload offline de integração nova só entra pela Data Manager API, que exige o escopo{' '}
              <span className="font-mono">datamanager</span>. Sem ele, todo envio volta 403.
              {google.erro && (
                <> O Google respondeu: <span className="text-atencao">{google.erro}</span>.</>
              )}
            </div>
            {/*
              * Sem botão "Conectar Google" aqui.
              *
              * Nesta conta o consentimento é feito na máquina de quem administra,
              * contra o Worker local, e o refresh token é publicado como secret.
              * O painel em produção não expõe o fluxo de conexão — um botão que
              * grava credencial no banco daria um segundo caminho, com precedência
              * sobre o secret, e a origem da credencial deixaria de ser óbvia.
              */}
            <div className="text-[11px] text-tenue mt-2 leading-relaxed max-w-[680px]">
              A credencial é publicada como secret do Worker
              (<span className="font-mono">GOOGLE_ADS_REFRESH_TOKEN</span>), a partir do
              consentimento feito localmente. Ver a seção “Conversão offline” no README.
            </div>
          </div>
        </Cartao>
      )}

      <Cartao>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">Envio para o Google Ads</div>
            <div className="text-[11px] text-tenue mt-1 max-w-[560px] leading-relaxed">
              Em <strong className="text-secundario">teste</strong> o Google valida e não contabiliza.
              Em <strong className="text-secundario">real</strong>, conta na conta de anúncios.
            </div>
          </div>
          <div className="flex flex-col gap-2 items-end shrink-0">
            <Switch ligado={config.ligado} aoTrocar={(v) => trocarConfig({ ligado: v })}>
              {config.ligado ? 'Envio ligado' : 'Envio desligado'}
            </Switch>
            <Select
              rotulo="Modo de envio"
              valor={config.modo}
              aoTrocar={(v) => trocarConfig({ modo: v })}
              opcoes={[['teste', 'Modo teste'], ['real', 'Modo real']]}
            />
          </div>
        </div>

        {/*
          * Consentimento é declaração, não ajuste técnico.
          *
          * Marcar "concedido" afirma ao Google, em nome da faculdade, que o
          * titular consentiu com o uso dos dados para anúncios. O padrão não
          * afirma nada — e não afirmar é diferente de negar: omitido, o Google
          * aplica a regra da conta; negado, ele descarta o identificador e a
          * conversão aprimorada para de casar.
          */}
        <div className="flex items-start justify-between gap-4 flex-wrap mt-3 pt-3 border-t border-borda">
          <div className="min-w-0">
            <div className="text-[12px] font-semibold">Consentimento declarado ao Google</div>
            <div className="text-[11px] text-tenue mt-1 max-w-[560px] leading-relaxed">
              Só marque <strong className="text-secundario">concedido</strong> se a captação de
              leads de fato coleta esse consentimento — é uma declaração em nome da faculdade.
              O padrão não afirma nada e deixa o Google aplicar a regra da conta;{' '}
              <strong className="text-secundario">negado</strong> faz o Google descartar
              e-mail e telefone, e a conversão aprimorada para de casar.
            </div>
          </div>
          <div className="shrink-0 min-w-[210px]">
            <Select
              rotulo="Consentimento de dados do usuário"
              valor={config.consentimento ?? 'nao_informado'}
              aoTrocar={(v) => trocarConfig({ consentimento: v })}
              opcoes={[
                ['nao_informado', 'Não informar (padrão)'],
                ['concedido', 'Concedido'],
                ['negado', 'Negado'],
              ]}
              className="w-full"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap mt-3 pt-3 border-t border-borda">
          {resumo.length === 0
            ? <span className="text-[11px] text-tenue">Nenhuma conversão nos últimos 30 dias.</span>
            : resumo.map((r) => (
              <Pill key={r.status} tom={TOM_STATUS[r.status] ?? 'neutro'}>
                {fmtInt(r.total)} {ROTULO_STATUS[r.status] ?? r.status}
              </Pill>
            ))}
          <span className="ml-auto">
            <Acao
              tom="primario"
              titulo="Processa a fila agora"
              aoClicar={async () => {
                const r = await enviar('/api/conversoes/processar');
                recarregar();
                return `${r.enviadas} enviada(s), ${r.falhas} falha(s), ${r.sem_identificador} sem identificador.`;
              }}
            >
              Processar a fila agora
            </Acao>
          </span>
        </div>
      </Cartao>

      {/* 1. Gatilhos por processo */}
      <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-3 items-start">
        <Cartao className="!p-2 sticky top-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-tenue px-2 py-1.5">
            1 · Processos
          </div>
          <nav className="flex flex-col gap-0.5" aria-label="Processos para gatilho">
            {pipelinesOrd.map((p) => {
              const ativo = p.processo_id === processoAtivo;
              const ligados = (gatilhos ?? []).filter(
                (g) => String(g.processo_id) === String(p.processo_id) && g.ativo,
              ).length;
              return (
                <button
                  key={p.processo_id}
                  type="button"
                  onClick={() => setProcessoAtivo(p.processo_id)}
                  className={`text-left rounded-[8px] px-2.5 py-2 border-0 cursor-pointer
                    ${ativo
                      ? 'bg-azul-600 text-white'
                      : 'bg-transparent text-secundario hover:bg-superficie-hover hover:text-primario'}`}
                >
                  <div className="text-xs font-semibold truncate">{p.processo_nome}</div>
                  <div className={`text-[10px] mt-0.5 ${ativo ? 'text-white/70' : 'text-tenue'}`}>
                    {p.etapas.length} etapa{p.etapas.length === 1 ? '' : 's'}
                    {ligados ? ` · ${ligados} gatilho${ligados === 1 ? '' : 's'}` : ''}
                  </div>
                </button>
              );
            })}
          </nav>
        </Cartao>

        <Cartao>
          {!pipeline ? (
            <Estado
              titulo="Nenhuma etapa no catálogo"
              mensagem="As etapas aparecem quando o Rubeus dispara eventos ou o sync roda."
            />
          ) : (
            <>
              <div className="mb-3">
                <div className="text-[13px] font-semibold">
                  Gatilhos · {pipeline.processo_nome}
                </div>
                <div className="text-[11px] text-tenue mt-1 leading-relaxed max-w-[640px]">
                  Cada linha é uma etapa <strong className="text-secundario">deste</strong> processo
                  no Rubeus. Escolha qual evento do Google ela dispara. A regra fica ligada a este
                  processo (ID <span className="font-mono">{pipeline.processo_id}</span>).
                </div>
              </div>

              <div
                className="hidden md:grid gap-3 px-1 pb-2 mb-1 border-b border-borda
                           text-[10px] font-semibold uppercase tracking-wide text-tenue
                           grid-cols-[minmax(0,1.2fr)_minmax(180px,1fr)_88px]"
              >
                <div>Etapa no Rubeus</div>
                <div>Evento (Google)</div>
                <div className="text-center">Ativo</div>
              </div>

              <ul className="flex flex-col">
                {pipeline.etapas.map((e) => {
                  const atual = (gatilhos ?? []).find(
                    (g) =>
                      String(g.processo_id) === String(pipeline.processo_id)
                      && g.etapa_nome === e.nome,
                  ) ?? (gatilhos ?? []).find(
                    (g) => !g.processo_id && g.etapa_nome === e.nome,
                  );
                  return (
                    <LinhaGatilho
                      key={`${pipeline.processo_id}::${e.nome}`}
                      processoId={pipeline.processo_id}
                      etapa={e.nome}
                      atual={atual}
                      eventos={eventos}
                      aoSalvar={recarregar}
                    />
                  );
                })}
              </ul>
            </>
          )}
        </Cartao>
      </div>

      {/* 2. ctId — um bloco por gatilho ativo do processo selecionado na etapa 1 */}
      <Cartao>
        <div className="mb-3">
          <div className="text-[13px] font-semibold">
            2. ctId do Google · {pipeline?.processo_nome || 'escolha o processo acima'}
          </div>
          <div className="text-[11px] text-tenue mt-1 leading-relaxed max-w-[720px]">
            Usa o <strong className="text-secundario">mesmo processo</strong> da etapa 1.
            Cada bloco é um gatilho que você ligou (ex.: Oportunidade). Dentro dele, cole o ctId
            por modalidade do curso (Presencial / EAD / …).
          </div>
        </div>
        <TabelaAcoes
          eventos={eventos}
          metas={metas_google ?? []}
          niveis={[nivel_padrao, ...(niveis ?? []).map((n) => n.nivel)]}
          acoes={acoes}
          gatilhos={gatilhos}
          processoId={processoAtivo}
          processoNome={pipeline?.processo_nome}
          aoSalvar={recarregar}
        />
      </Cartao>

      {/* 3. Captura */}
      <Cartao>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">3. Identificador do clique (gclid)</div>
            <div className="text-[11px] text-tenue mt-1 max-w-[640px] leading-relaxed">
              Sem gclid o envio usa e-mail/telefone em hash (conversão aprimorada). Com gclid a
              atribuição fica exata.
            </div>
          </div>
          <div className="flex flex-col gap-2 items-end shrink-0">
            <Switch ligado={config.capturaLigada} aoTrocar={(v) => trocarConfig({ captura_ligada: v })}>
              {config.capturaLigada ? 'Captura no site ligada' : 'Captura no site desligada'}
            </Switch>
            <Switch ligado={config.escreverNoRubeus} aoTrocar={(v) => trocarConfig({ escrever_no_rubeus: v })}>
              {config.escreverNoRubeus ? 'Gravando no Rubeus' : 'Não grava no Rubeus'}
            </Switch>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-borda">
          <div className="text-[12px] font-semibold mb-1">Tag do site</div>
          <code className="block text-[11px] font-mono bg-elevado border border-borda rounded-[8px]
                           px-2 py-[6px] break-all select-all">
            {`<script src="${script_url}" async></script>`}
          </code>
          <div className="text-[11px] text-tenue mt-2">
            Origens: <span className="font-mono">{config.origensPermitidas ?? '—'}</span>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-borda flex items-center gap-3 flex-wrap">
          <Pill tom={captura?.total > 0 ? 'sucesso' : 'neutro'}>
            {fmtInt(captura?.total ?? 0)} clique(s) / 30d
          </Pill>
          <Pill tom={captura?.casados > 0 ? 'sucesso' : 'neutro'}>
            {fmtInt(captura?.casados ?? 0)} cruzado(s)
          </Pill>
          <span className="ml-auto">
            <Acao
              titulo="Reconsulta campos personalizados do Rubeus"
              aoClicar={async () => {
                const r = await fetch('/api/conversoes/campo-rubeus?forcar=1').then((x) => x.json());
                return r.encontrado
                  ? `Campo: ${Object.entries(r.colunas).filter(([, v]) => v).map(([k, v]) => `${k} → ${v}`).join(', ')}`
                  : 'Nenhum campo gclid no Rubeus ainda.';
              }}
            >
              Procurar campo gclid no Rubeus
            </Acao>
          </span>
        </div>
      </Cartao>

      {/* 4. Planilha */}
      <Cartao>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">4. Planilha de backup</div>
            <div className="text-[11px] text-tenue mt-1 max-w-[640px] leading-relaxed">
              Uma linha por conversão, inclusive as que não foram enviadas (com motivo).
            </div>
            {config.planilhaUrl && (
              <a
                href={config.planilhaUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-azul-600 mt-2 inline-block break-all"
              >
                Abrir a planilha
              </a>
            )}
          </div>
          {!config.planilhaId && (
            <Acao
              tom="primario"
              titulo="Cria a planilha no Drive"
              aoClicar={async () => {
                const r = await enviar('/api/conversoes/planilha');
                recarregar();
                return r.url;
              }}
            >
              Criar a planilha
            </Acao>
          )}
        </div>
      </Cartao>

      <MonitorConversoes />
    </>
  );
}

function LinhaGatilho({ processoId, etapa, atual, eventos, aoSalvar }) {
  const [salvando, setSalvando] = useState(false);
  const evento = atual?.evento ?? '';
  const ativo = Boolean(atual?.ativo);

  const salvar = async (mudanca) => {
    setSalvando(true);
    try {
      await enviar('/api/conversoes/gatilhos', {
        processo_id: String(processoId),
        etapa_nome: etapa,
        evento: mudanca.evento ?? evento,
        ativo: mudanca.ativo ?? ativo,
      });
      aoSalvar();
    } finally {
      setSalvando(false);
    }
  };

  return (
    <li
      className="grid gap-2 md:gap-3 items-center py-2.5 border-b border-borda/70 last:border-b-0
                 grid-cols-1 md:grid-cols-[minmax(0,1.2fr)_minmax(180px,1fr)_88px]"
    >
      <div className="min-w-0">
        <div className="text-[13px] font-semibold truncate">{etapa}</div>
        {atual?.processo_id == null && evento && (
          <div className="text-[10px] text-atencao mt-0.5">regra global antiga — salve de novo neste processo</div>
        )}
      </div>
      <div className="min-w-0">
        <Select
          rotulo={`Evento para ${etapa}`}
          valor={evento}
          aoTrocar={(v) => (v ? salvar({ evento: v, ativo: true }) : null)}
          opcoes={[['', 'Não dispara'], ...eventos.map((e) => [e.id, e.rotulo])]}
          className="w-full"
        />
      </div>
      <div className="flex md:justify-center">
        {evento ? (
          <Switch ligado={ativo} aoTrocar={(v) => salvar({ ativo: v })}>
            <span className="md:sr-only">{salvando ? '…' : ativo ? 'ativo' : 'inativo'}</span>
          </Switch>
        ) : (
          <span className="text-[10px] text-tenue">—</span>
        )}
      </div>
    </li>
  );
}

/** Família do nível a partir do nome do processo (Pós, Graduação, Curta…). */
function familiaDoProcesso(processoNome) {
  if (!processoNome) return null;
  const n = processoNome.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (n.includes('pos')) return 'pos';
  if (n.includes('graduacao') && !n.includes('pos')) return 'grad';
  if (n.includes('curta')) return 'curta';
  if (n.includes('extens')) return 'ext';
  if (n.includes('qualific') || n.includes('lead')) return 'geral';
  return null;
}

function familiaNivel(nivel) {
  if (!nivel || nivel === '*') return { id: 'geral', rotulo: 'Geral / não identificado' };
  const n = nivel.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (n.includes('pos-graduacao') || n.includes('pos graduacao')) {
    return { id: 'pos', rotulo: 'Pós-Graduação' };
  }
  if (n.includes('graduacao')) return { id: 'grad', rotulo: 'Graduação' };
  if (n.includes('curta')) return { id: 'curta', rotulo: 'Curta e média duração' };
  if (n.includes('extensao')) return { id: 'ext', rotulo: 'Extensão' };
  if (n.includes('aperfeicoamento')) return { id: 'aperf', rotulo: 'Aperfeiçoamento' };
  return { id: 'outros', rotulo: 'Outros' };
}

/**
 * Etapa 2: um bloco por gatilho ativo do processo (Oportunidade, Oportunidade paga…).
 * Dentro de cada bloco, ctId por modalidade do curso.
 */
function TabelaAcoes({
  eventos, metas, niveis, acoes, gatilhos, processoId, processoNome, aoSalvar,
}) {
  const { dados: doGoogle, erro } = useApi('/api/conversoes/acoes-google', 'acoes-google');
  const disponiveis = doGoogle?.itens ?? [];

  const gatilhosDoProcesso = useMemo(() => {
    const lista = (gatilhos ?? []).filter(
      (g) => g.ativo && g.evento && String(g.processo_id) === String(processoId ?? ''),
    );
    // Fallback: regras globais (processo_id null) com mesmo nome de etapa.
    if (lista.length) return lista;
    return (gatilhos ?? []).filter((g) => g.ativo && g.evento && !g.processo_id);
  }, [gatilhos, processoId]);

  const familia = familiaDoProcesso(processoNome);
  const niveisDoProcesso = useMemo(() => {
    const filtrados = niveis.filter((nivel) => {
      if (nivel === '*') return true;
      const f = familiaNivel(nivel).id;
      if (!familia) return true;
      if (familia === 'geral') return f === 'geral' || nivel === '*';
      return f === familia || nivel === '*';
    });
    // * primeiro, depois o resto
    return filtrados.sort((a, b) => {
      if (a === '*') return -1;
      if (b === '*') return 1;
      return String(a).localeCompare(String(b), 'pt-BR');
    });
  }, [niveis, familia]);

  if (!processoId) {
    return <Estado mensagem="Selecione um processo na etapa 1." />;
  }

  if (!gatilhosDoProcesso.length) {
    return (
      <Estado
        titulo="Nenhum gatilho ativo neste processo"
        mensagem="Na etapa 1, ligue pelo menos uma etapa (ex.: Oportunidade → Inscrição concluída). Só então aparece o campo de ctId aqui."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {erro && (
        <div className="text-[11px] text-atencao">
          Não listou ações do Google Ads: {erro}
        </div>
      )}
      {!erro && disponiveis.length === 0 && (
        <div className="text-[11px] text-atencao leading-relaxed">
          Nenhuma ação <span className="font-mono">UPLOAD_CLICKS</span> na conta. Crie no Google Ads
          ou use “Criar no Google Ads” em cada linha.
        </div>
      )}

      {gatilhosDoProcesso.map((g) => {
        const ev = eventos.find((e) => e.id === g.evento);
        if (!ev) return null;
        return (
          <div
            key={`${g.processo_id ?? 'g'}::${g.etapa_nome}::${g.evento}`}
            className="rounded-[10px] border border-borda bg-elevado/60 p-3"
          >
            <div className="mb-3 pb-2 border-b border-borda">
              <div className="text-[14px] font-semibold text-primario">
                {g.etapa_nome}
              </div>
              <div className="text-[11px] text-tenue mt-0.5">
                dispara → <strong className="text-secundario">{ev.rotulo}</strong>
                {' '}· cole o ctId abaixo por modalidade
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {niveisDoProcesso.map((nivel) => (
                <div
                  key={nivel}
                  className="grid grid-cols-1 md:grid-cols-[minmax(140px,0.45fr)_minmax(0,1fr)]
                             gap-2 md:gap-3 items-start py-2 border-t border-borda/60 first:border-t-0 first:pt-0"
                >
                  <div className="text-xs font-semibold pt-1">
                    {nivel === '*'
                      ? <em className="text-tenue font-normal">qualquer / não identificado</em>
                      : nivel}
                  </div>
                  <CelulaAcao
                    evento={ev}
                    nivel={nivel}
                    metas={metas}
                    atual={acoes.find((a) => a.evento === ev.id && a.nivel_ensino === nivel)}
                    disponiveis={disponiveis}
                    aoSalvar={aoSalvar}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function nomeSugerido(evento, nivel) {
  return `IDE | ${evento.rotulo} | ${nivel === '*' ? 'Geral' : nivel}`;
}

function CelulaAcao({ evento, nivel, metas, atual, disponiveis, aoSalvar }) {
  const [acaoId, setAcaoId] = useState(atual?.conversion_action_id ?? '');
  const [valor, setValor] = useState(atual?.valor ?? 0);
  const [formAberto, setFormAberto] = useState(false);
  const [nomeNovo, setNomeNovo] = useState(() => nomeSugerido(evento, nivel));
  const [metaNova, setMetaNova] = useState(() => evento.categoria || 'DEFAULT');
  const [criando, setCriando] = useState(false);
  const [erroCriar, setErroCriar] = useState('');

  useEffect(() => {
    setAcaoId(atual?.conversion_action_id ?? '');
    setValor(atual?.valor ?? 0);
  }, [atual?.conversion_action_id, atual?.valor]);

  useEffect(() => {
    if (!formAberto) return;
    setNomeNovo(nomeSugerido(evento, nivel));
    setMetaNova(evento.categoria || 'DEFAULT');
    setErroCriar('');
  }, [formAberto, evento, nivel]);

  const salvar = async (sobrescrever = {}) => {
    const id = String(sobrescrever.acaoId ?? acaoId).replace(/\D/g, '');
    if (!id) return;
    await enviar('/api/conversoes/acoes', {
      evento: evento.id,
      nivel_ensino: nivel,
      conversion_action_id: id,
      conversion_action_nome:
        sobrescrever.nome
        ?? disponiveis.find((d) => d.id === id)?.nome
        ?? atual?.conversion_action_nome
        ?? null,
      valor: Number(sobrescrever.valor ?? valor) || 0,
      ativo: true,
    });
    aoSalvar();
  };

  const criarNoGoogle = async () => {
    const nome = nomeNovo.trim();
    if (nome.length < 3) {
      setErroCriar('Nome com pelo menos 3 caracteres.');
      return;
    }
    if (!metaNova) {
      setErroCriar('Escolha a meta.');
      return;
    }
    setCriando(true);
    setErroCriar('');
    try {
      const r = await enviar('/api/conversoes/acoes-google', {
        nome,
        evento: evento.id,
        categoria: metaNova,
      });
      setAcaoId(r.id);
      setFormAberto(false);
      await salvar({ acaoId: r.id, nome });
    } catch (e) {
      setErroCriar(e.message || 'Falha ao criar no Google Ads');
    } finally {
      setCriando(false);
    }
  };

  const opcoesMeta = (metas?.length
    ? metas
    : [{ id: evento.categoria || 'DEFAULT', rotulo: evento.categoria || 'padrão' }]
  ).map((m) => [m.id, m.rotulo]);

  return (
    <div className="flex flex-col gap-1.5 min-w-[240px]">
      <label className="flex flex-col gap-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-tenue">ctId</span>
        <input
          type="text"
          inputMode="numeric"
          placeholder="ex.: 1234567890"
          value={acaoId}
          onChange={(ev) => setAcaoId(ev.target.value.replace(/\D/g, ''))}
          onBlur={() => {
            if (acaoId && acaoId !== (atual?.conversion_action_id ?? '')) salvar();
          }}
          aria-label={`ctId de ${evento.rotulo} para ${nivel}`}
          className="bg-superficie text-primario border border-borda-forte rounded-[8px]
                     px-2 py-[5px] text-[11px] font-mono w-full"
        />
      </label>

      <Select
        rotulo={`Ação de ${evento.rotulo} para ${nivel}`}
        valor={acaoId}
        aoTrocar={(v) => {
          setAcaoId(v);
          if (v) salvar({ acaoId: v });
        }}
        opcoes={[
          ['', '— escolher na conta —'],
          ...disponiveis.map((d) => [d.id, `${d.nome} · ${d.id}`]),
        ]}
        className="w-full"
      />

      {acaoId && (
        <label className="flex items-center gap-1 text-[11px] text-tenue">
          R$
          <input
            type="number"
            min="0"
            step="0.01"
            value={valor}
            onChange={(ev) => setValor(ev.target.value)}
            onBlur={() => salvar()}
            aria-label={`Valor de ${evento.rotulo} para ${nivel}`}
            className="bg-superficie text-primario border border-borda-forte rounded-[8px]
                       px-2 py-[3px] text-[11px] w-[90px] tnum"
          />
        </label>
      )}

      {!acaoId && !formAberto && (
        <button
          type="button"
          onClick={() => setFormAberto(true)}
          className="text-[11px] px-2 py-[5px] rounded-[8px] border border-borda-forte
                     bg-superficie text-secundario hover:bg-superficie-hover hover:text-primario
                     cursor-pointer self-start"
        >
          Criar no Google Ads
        </button>
      )}

      {!acaoId && formAberto && (
        <div className="mt-1 p-2.5 rounded-[8px] border border-borda-forte bg-superficie flex flex-col gap-2">
          <div className="text-[11px] font-semibold text-primario">Nova ação no Google Ads</div>

          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-tenue">Nome</span>
            <input
              type="text"
              value={nomeNovo}
              onChange={(ev) => setNomeNovo(ev.target.value)}
              maxLength={80}
              aria-label="Nome da conversão no Google Ads"
              className="bg-elevado text-primario border border-borda-forte rounded-[8px]
                         px-2 py-[5px] text-[11px] w-full"
            />
          </label>

          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-tenue">
              Meta (categoria)
            </span>
            <Select
              rotulo="Meta da conversão no Google Ads"
              valor={metaNova}
              aoTrocar={setMetaNova}
              opcoes={opcoesMeta}
              className="w-full"
            />
          </label>

          {erroCriar && (
            <div className="text-[10px] text-perigo leading-snug">{erroCriar}</div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              disabled={criando}
              onClick={criarNoGoogle}
              className="text-[11px] px-2 py-[5px] rounded-[8px] border border-azul-500
                         bg-azul-600 text-white hover:bg-azul-500 cursor-pointer
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {criando ? 'Criando…' : 'Criar ação'}
            </button>
            <button
              type="button"
              disabled={criando}
              onClick={() => setFormAberto(false)}
              className="text-[11px] px-2 py-[5px] rounded-[8px] border border-borda-forte
                         bg-transparent text-secundario hover:text-primario cursor-pointer
                         disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
