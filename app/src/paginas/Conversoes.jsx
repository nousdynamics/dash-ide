import { useCallback, useEffect, useMemo, useState } from 'react';
import { BotaoIcone, Cartao, Estado, Esqueleto, Modal, Pill, Select, Switch } from '../componentes/base';
import { useApi } from '../lib/api';
import { ROTULO_STATUS, TOM_STATUS } from '../lib/conversao';
import { fmtInt } from '../lib/formato';

/**
 * Conversão offline — o fluxo que saiu do n8n.
 *
 * Só a INSTALAÇÃO: (0) Google pronto → (1) gatilhos por processo → (2) ctId /
 * ação por evento × nível. O resultado — registro, veredito do Google, captura
 * do clique e planilha — mora em "Google Conversões", porque é pergunta de todo
 * dia e esta tela é decisão que se toma uma vez.
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
  /** Qual painel auxiliar está aberto: 'checklist', 'envio' ou nenhum. */
  const [modal, setModal] = useState(null);

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
      <div className="text-[19px] font-semibold tracking-tight">Conversões Ads</div>
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
    config, eventos, gatilhos, acoes, resumo, niveis,
    nivel_padrao, google, metas_google,
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
      /*
       * O envio em modo teste JÁ conta como configuração pronta.
       *
       * Teste não é rascunho: o Google valida o evento inteiro e devolve os
       * mesmos erros, só não contabiliza. Marcar isso como pendência empurraria
       * para o modo real quem ainda está conferindo o mapa de etapas — que é
       * exatamente quem não deveria estar lá.
       */
      ok: config.ligado,
      rotulo: config.modo === 'real'
        ? 'Em operação, enviando conversões reais'
        : 'Em operação, em modo teste',
      falta: 'Sair da pausa em “Ajustes do envio”',
    },
  ];

  const pendencias = checklist.filter((c) => !c.ok).length;

  return (
    <>
      {cabecalho}

      {/*
        * A barra de operação: o que se olha todo dia fica visível, o resto abre.
        *
        * Antes o checklist de configuração e o painel de envio ocupavam duas
        * faixas inteiras no topo — informação que se lê uma vez, na instalação,
        * empurrando para baixo da dobra o mapa de gatilhos, que é o trabalho
        * real da tela. Agora são dois ícones.
        *
        * O interruptor NÃO entra no modal. Ele é a única coisa aqui que muda o
        * que o Google Ads recebe, e esconder atrás de um clique um controle
        * dessa consequência é o oposto do que ele pede: quem abre a tela precisa
        * ver, sem procurar, se está mandando conversão de verdade.
        */}
      <Cartao>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <Switch
              ligado={config.modo === 'real'}
              aoTrocar={(v) => trocarConfig({ ligado: true, modo: v ? 'real' : 'teste' })}
            >
              <span className="sr-only">Enviar conversões reais ao Google Ads</span>
            </Switch>
            <div className="min-w-0">
              <div className={`text-[13px] font-semibold ${config.modo === 'real' ? 'text-sucesso' : 'text-secundario'}`}>
                {config.modo === 'real' ? 'Enviando conversões reais' : 'Somente teste'}
              </div>
              <div className="text-[11px] text-tenue leading-relaxed">
                {config.modo === 'real'
                  ? 'Cada conversão conta na conta de anúncios e influencia o lance das campanhas.'
                  : 'O Google valida cada envio e descarta — nada é contabilizado.'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {resumo.map((r) => (
              <Pill key={r.status} tom={TOM_STATUS[r.status] ?? 'neutro'}>
                {fmtInt(r.total)} {ROTULO_STATUS[r.status] ?? r.status}
              </Pill>
            ))}
            {resumo.length === 0 && (
              <span className="text-[11px] text-tenue">Nenhuma conversão em 30 dias</span>
            )}

            <Acao
              tom="primario"
              titulo="Processa a fila agora"
              aoClicar={async () => {
                const r = await enviar('/api/conversoes/processar');
                recarregar();
                return `${r.enviadas} enviada(s), ${r.falhas} falha(s), ${r.sem_identificador} sem identificador.`;
              }}
            >
              Processar a fila
            </Acao>

            {/*
              * Pendência vira alerta no próprio ícone.
              *
              * Um checklist escondido num modal é um checklist que ninguém abre.
              * O ícone muda de cor quando falta alguma coisa, e é isso que faz o
              * item pendente continuar pedindo atenção depois de sair da tela.
              */}
            <BotaoIcone
              titulo={pendencias ? `Configuração: ${pendencias} item(ns) pendente(s)` : 'Configuração do envio'}
              tom={pendencias ? 'atencao' : 'neutro'}
              aoClicar={() => setModal('checklist')}
            >
              {pendencias ? '!' : '✓'}
            </BotaoIcone>

            <BotaoIcone titulo="Ajustes do envio" aoClicar={() => setModal('envio')}>
              ⚙
            </BotaoIcone>
          </div>
        </div>
      </Cartao>

      <Modal
        aberto={modal === 'checklist'}
        aoFechar={() => setModal(null)}
        titulo="Para o Google receber o evento"
        descricao="O que precisa estar de pé para uma conversão sair daqui e chegar lá."
      >
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

        {!google.tem_datamanager && (
          <div className="mt-3 pt-3 border-t border-borda">
            <div className="text-[12px] font-semibold text-atencao">
              {google.conectado
                ? 'A conta Google conectada não tem o escopo Data Manager'
                : 'Nenhuma conta Google conectada'}
            </div>
            <div className="text-[11px] text-tenue mt-1 leading-relaxed">
              Upload offline de integração nova só entra pela Data Manager API, que exige o escopo{' '}
              <span className="font-mono">datamanager</span>. Sem ele, todo envio volta 403.
              {google.erro && <> <span className="text-atencao">{google.erro}</span>.</>}
              {google.tamanho > 0 && (
                <> Token em uso: <span className="font-mono">{google.tamanho}</span> caracteres.</>
              )}
            </div>
            {/*
              * Sem botão "Conectar Google".
              *
              * Nesta conta o consentimento é feito na máquina de quem administra
              * e o refresh token vai para secret do Worker. `/oauth/google/*` só
              * responde em desenvolvimento — ver `src/routes/oauth.ts`.
              */}
            <div className="text-[11px] text-tenue mt-2 leading-relaxed">
              A credencial é publicada como secret do Worker
              (<span className="font-mono">GOOGLE_ADS_REFRESH_TOKEN</span>), a partir do
              consentimento feito localmente. Ver a seção “Conversão offline” no README.
            </div>
          </div>
        )}
      </Modal>

      <Modal
        aberto={modal === 'envio'}
        aoFechar={() => setModal(null)}
        titulo="Ajustes do envio"
        descricao="Declarações e a chave geral. O modo teste/real fica no interruptor da tela."
      >
        {/*
          * Consentimento é declaração, não ajuste técnico.
          *
          * Marcar "concedido" afirma ao Google, em nome da faculdade, que o
          * titular consentiu com o uso dos dados para anúncios. O padrão não
          * afirma nada — e não afirmar é diferente de negar: omitido, o Google
          * aplica a regra da conta; negado, ele descarta o identificador e a
          * conversão aprimorada para de casar.
          */}
        <div className="text-[12px] font-semibold">Consentimento declarado ao Google</div>
        <div className="text-[11px] text-tenue mt-1 leading-relaxed">
          Só marque <strong className="text-secundario">concedido</strong> se a captação de
          leads de fato coleta esse consentimento — é uma declaração em nome da faculdade.
          O padrão não afirma nada e deixa o Google aplicar a regra da conta;{' '}
          <strong className="text-secundario">negado</strong> faz o Google descartar
          e-mail e telefone, e a conversão aprimorada para de casar.
        </div>
        <div className="mt-2 max-w-[260px]">
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

        {/*
          * A chave geral sobrevive à fusão do interruptor.
          *
          * O interruptor da tela escolhe entre teste e real, e nas duas posições
          * o painel conversa com o Google. Quando algo está errado de verdade —
          * mapa de etapas trocado, Google recusando tudo — é preciso poder parar
          * de conversar, e não só parar de contabilizar. Fica aqui porque é
          * manobra de exceção, não ajuste do dia a dia.
          */}
        <div className="mt-3 pt-3 border-t border-borda">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-[12px] font-semibold">Pausar tudo</div>
              <div className="text-[11px] text-tenue mt-1 leading-relaxed max-w-[360px]">
                Interrompe qualquer conversa com o Google, inclusive as validações do
                modo teste. Os eventos continuam sendo registrados e ficam na fila.
              </div>
            </div>
            <Switch
              ligado={!config.ligado}
              aoTrocar={(v) => trocarConfig({ ligado: !v })}
            >
              {config.ligado ? 'Em operação' : 'Pausado'}
            </Switch>
          </div>
        </div>
      </Modal>

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
            Um bloco por gatilho que você ligou na etapa 1, e dentro dele uma linha por nível
            de ensino. Escolher a ação da conta é o caminho seguro — ctId digitado à mão é aceito
            aqui e só falha na hora do envio. O nível{' '}
            <em className="text-secundario">qualquer</em> recebe quem chegou sem curso identificado.
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
          nivelPadrao={nivel_padrao}
          aoSalvar={recarregar}
        />
      </Cartao>

      {/*
        * Captura do clique, planilha e monitor saíram daqui.
        *
        * Foram para "Google Conversões". O que sobra nesta tela é decisão de
        * instalação — qual etapa vira evento, e para qual ação do Google cada
        * nível manda —, mexida raramente. Misturada com o resultado, obrigava
        * quem só queria conferir o envio de ontem a rolar por escolhas que não
        * ia tomar naquele momento.
        */}
      <Cartao>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">Conferir o que foi enviado</div>
            <div className="text-[11px] text-tenue mt-1 max-w-[620px] leading-relaxed">
              O registro das conversões, o veredito do Google, a captura do gclid no site e a
              cópia na planilha ficam em Google Conversões.
            </div>
          </div>
          <a
            href="#/conversoes-google"
            className="text-[11px] px-3 py-[6px] rounded-[8px] border border-borda-forte bg-superficie
                       text-secundario no-underline shrink-0 hover:bg-superficie-hover hover:text-primario"
          >
            Abrir Google Conversões →
          </a>
        </div>
      </Cartao>
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
/**
 * Etapa 2: a qual ação do Google Ads cada nível de ensino manda a conversão.
 *
 * O desenho anterior empilhava, em cada célula, TRÊS caminhos para a mesma
 * decisão — digitar o ctId à mão, escolher da conta, criar uma nova — todos
 * visíveis ao mesmo tempo. Com dois gatilhos e três níveis eram seis pilhas de
 * quatro controles, nada alinhado entre as linhas, e a pergunta que a tela
 * responde ("este nível já tem ação?") exigia ler tudo para descobrir.
 *
 * Agora é uma tabela: uma linha por nível, colunas alinhadas, e o estado de cada
 * linha visível de relance. Escolher da conta é o caminho principal, porque um
 * ctId digitado errado só falha na hora do envio, longe de quem digitou; colar
 * à mão continua possível, atrás de um clique.
 */
function TabelaAcoes({
  eventos, metas, niveis, acoes, gatilhos, processoId, processoNome, aoSalvar, nivelPadrao,
}) {
  const { dados: doGoogle, erro } = useApi('/api/conversoes/acoes-google', 'acoes-google');
  const { dados: catalogo } = useApi('/api/catalogo/cursos', 'catalogo-cursos');
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

  if (!processoId) return <Estado mensagem="Selecione um processo na etapa 1." />;

  if (!gatilhosDoProcesso.length) {
    return (
      <Estado
        titulo="Nenhum gatilho ativo neste processo"
        mensagem="Na etapa 1, ligue pelo menos uma etapa (ex.: Oportunidade → Inscrição concluída). Só então aparece o campo de ctId aqui."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {erro && (
        <div className="text-[11px] text-atencao">Não listou ações do Google Ads: {erro}</div>
      )}
      {!erro && disponiveis.length === 0 && (
        <div className="text-[11px] text-atencao leading-relaxed">
          Nenhuma ação <span className="font-mono">UPLOAD_CLICKS</span> na conta. Use
          “Criar ação” em cada linha, ou crie no Google Ads.
        </div>
      )}

      {gatilhosDoProcesso.map((g) => {
        const ev = eventos.find((e) => e.id === g.evento);
        if (!ev) return null;

        /*
         * As linhas de base: o curinga e um por nível de ensino do processo.
         * Regras por curso ou oferta não entram aqui — são exceções, e listá-las
         * junto faria a contagem "x de y níveis" mentir.
         */
        const doEvento = niveisDoProcesso.map((nivel) => ({
          nivel,
          atual: acoes.find((a) => a.evento === ev.id && (
            nivel === nivelPadrao ? a.escopo === 'geral' : (a.escopo === 'nivel' && a.alvo === nivel)
          )),
        }));
        const mapeados = doEvento.filter((l) => l.atual?.conversion_action_id).length;

        const especificas = acoes.filter(
          (a) => a.evento === ev.id && (a.escopo === 'oferta' || a.escopo === 'curso'),
        );

        return (
          <div
            key={`${g.processo_id ?? 'g'}::${g.etapa_nome}::${g.evento}`}
            className="rounded-[10px] border border-borda overflow-hidden"
          >
            {/* Cabeçalho do gatilho: a etapa, o evento que ela dispara, e o progresso. */}
            <div className="flex items-center justify-between gap-3 flex-wrap px-3 py-2 bg-elevado border-b border-borda">
              <div className="flex items-center gap-2 min-w-0 text-xs">
                <span className="font-semibold truncate">{g.etapa_nome}</span>
                <span className="text-tenue" aria-hidden="true">→</span>
                <Pill tom="neutro">{ev.rotulo}</Pill>
              </div>
              <span
                className={`text-[11px] tnum shrink-0 ${
                  mapeados === doEvento.length ? 'text-sucesso' : 'text-atencao'
                }`}
              >
                {mapeados} de {doEvento.length} {doEvento.length === 1 ? 'nível mapeado' : 'níveis mapeados'}
              </span>
            </div>

            {/* Cabeçalho das colunas — some no mobile, onde a linha vira bloco. */}
            <div
              className="hidden md:grid gap-3 px-3 py-1.5 border-b border-borda
                         text-[10px] font-semibold uppercase tracking-wide text-tenue
                         grid-cols-[minmax(150px,0.9fr)_minmax(0,1.6fr)_96px_auto]"
            >
              <div>Nível de ensino</div>
              <div>Ação de conversão (ctId)</div>
              <div className="text-right">Valor</div>
              <div />
            </div>

            <div className="flex flex-col">
              {doEvento.map(({ nivel, atual }) => (
                <LinhaAcao
                  key={nivel}
                  evento={ev}
                  escopo={nivel === nivelPadrao ? 'geral' : 'nivel'}
                  alvo={nivel === nivelPadrao ? null : nivel}
                  rotulo={nivel === nivelPadrao
                    ? <em className="text-tenue font-normal">qualquer / não identificado</em>
                    : nivel}
                  metas={metas}
                  atual={atual}
                  disponiveis={disponiveis}
                  aoSalvar={aoSalvar}
                />
              ))}
            </div>

            {/*
              * Exceções por curso ou oferta.
              *
              * A régua do nível de ensino é grossa: um MBA e um curso de curta
              * duração de R$ 300 caem no mesmo balde e sobem com o mesmo valor,
              * e aí o Smart Bidding persegue os dois pelo mesmo preço. Aqui se
              * cadastra a meta do curso que merece tratamento próprio.
              *
              * Fica DEPOIS da tabela e visualmente separado porque é exceção: a
              * regra de nível é o que cobre a base inteira, e ver a exceção
              * primeiro daria a impressão de que é preciso cadastrar uma por
              * curso — 692 ofertas depois, ninguém termina.
              */}
            <Especificas
              evento={ev}
              regras={especificas}
              catalogo={catalogo}
              metas={metas}
              disponiveis={disponiveis}
              aoSalvar={aoSalvar}
            />
          </div>
        );
      })}
    </div>
  );
}

function nomeSugerido(evento, alvo) {
  return `IDE | ${evento.rotulo} | ${alvo || 'Geral'}`;
}

/**
 * Uma linha da tabela: um nível de ensino e a ação que recebe a conversão dele.
 *
 * Dois estados, e a linha mostra só o do momento:
 *
 *   MAPEADA   — o nome da ação, o ctId em fonte monoespaçada e o valor editável
 *               na mesma altura. É o estado de repouso, e ocupa uma linha.
 *   VAZIA     — um seletor com as ações da conta e o atalho para criar uma nova.
 *
 * Colar o ctId à mão fica atrás de "colar ctId". Não é o caminho principal
 * porque um número digitado errado é aceito pela tela e só falha no envio, dias
 * depois — enquanto escolher da conta não tem como errar.
 */
function LinhaAcao({ evento, escopo, alvo, rotulo, metas, atual, disponiveis, aoSalvar }) {
  const [valor, setValor] = useState(atual?.valor ?? 0);
  const [modo, setModo] = useState(null); // 'colar' | 'criar' | null
  const [ctIdManual, setCtIdManual] = useState('');
  const [nomeNovo, setNomeNovo] = useState(() => nomeSugerido(evento, alvo));
  const [metaNova, setMetaNova] = useState(() => evento.categoria || 'DEFAULT');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => setValor(atual?.valor ?? 0), [atual?.valor]);

  useEffect(() => {
    if (modo !== 'criar') return;
    setNomeNovo(nomeSugerido(evento, alvo));
    setMetaNova(evento.categoria || 'DEFAULT');
    setErro('');
  }, [modo, evento, alvo]);

  const mapeada = Boolean(atual?.conversion_action_id);

  const salvar = async (over = {}) => {
    const id = String(over.acaoId ?? atual?.conversion_action_id ?? '').replace(/\D/g, '');
    if (!id) return;
    setOcupado(true);
    setErro('');
    try {
      await enviar('/api/conversoes/acoes', {
        evento: evento.id,
        escopo,
        alvo,
        conversion_action_id: id,
        conversion_action_nome:
          over.nome
          ?? disponiveis.find((d) => d.id === id)?.nome
          ?? atual?.conversion_action_nome
          ?? null,
        valor: Number(over.valor ?? valor) || 0,
        ativo: true,
      });
      setModo(null);
      setCtIdManual('');
      aoSalvar();
    } catch (e) {
      setErro(e.message || 'não deu para salvar');
    } finally {
      setOcupado(false);
    }
  };

  const remover = async () => {
    if (!atual?.id) return;
    setOcupado(true);
    try {
      await enviar(`/api/conversoes/acoes/${atual.id}`, undefined, 'DELETE');
      aoSalvar();
    } catch (e) {
      setErro(e.message || 'não deu para remover');
    } finally {
      setOcupado(false);
    }
  };

  const criarNoGoogle = async () => {
    const nome = nomeNovo.trim();
    if (nome.length < 3) return setErro('Nome com pelo menos 3 caracteres.');
    setOcupado(true);
    setErro('');
    try {
      const r = await enviar('/api/conversoes/acoes-google', {
        nome, evento: evento.id, categoria: metaNova,
      });
      await salvar({ acaoId: r.id, nome });
    } catch (e) {
      setErro(e.message || 'Falha ao criar no Google Ads');
      setOcupado(false);
    }
  };

  return (
    <div className="border-t border-borda/60 first:border-t-0">
      <div
        className="grid gap-2 md:gap-3 items-center px-3 py-2
                   grid-cols-1 md:grid-cols-[minmax(150px,0.9fr)_minmax(0,1.6fr)_96px_auto]"
      >
        <div className="text-xs font-semibold min-w-0 truncate">{rotulo}</div>

        {/* Coluna da ação: o valor mapeado, ou os caminhos para mapear. */}
        <div className="min-w-0">
          {mapeada ? (
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sucesso shrink-0" aria-hidden="true">✓</span>
              <span className="min-w-0">
                {/*
                  * O nome guardado pode estar vazio — regras criadas antes de a
                  * lista da conta terminar de carregar gravaram `null`. A conta
                  * é a fonte da verdade e já está em mãos aqui, então vale mais
                  * do que a cópia velha do banco.
                  */}
                <span className="block text-xs truncate">
                  {disponiveis.find((d) => d.id === atual.conversion_action_id)?.nome
                    || atual.conversion_action_nome
                    || 'ação sem nome na conta'}
                </span>
                <span className="block text-[10px] text-tenue font-mono">
                  {atual.conversion_action_id}
                </span>
              </span>
            </div>
          ) : modo === 'colar' ? (
            <span className="flex items-center gap-1.5">
              <input
                type="text"
                inputMode="numeric"
                autoFocus
                placeholder="ex.: 1234567890"
                value={ctIdManual}
                onChange={(e) => setCtIdManual(e.target.value.replace(/\D/g, ''))}
                aria-label={`ctId de ${evento.rotulo} para ${alvo ?? 'qualquer nível'}`}
                className="bg-superficie text-primario border border-borda-forte rounded-[8px]
                           px-2 py-[5px] text-[11px] font-mono min-w-0 flex-1"
              />
              <BotaoMini onClick={() => salvar({ acaoId: ctIdManual })} disabled={!ctIdManual || ocupado}>
                Salvar
              </BotaoMini>
              <BotaoMini onClick={() => setModo(null)} disabled={ocupado}>Cancelar</BotaoMini>
            </span>
          ) : (
            <Select
              rotulo={`Ação de ${evento.rotulo} para ${alvo ?? 'qualquer nível'}`}
              valor=""
              aoTrocar={(v) => v && salvar({ acaoId: v })}
              opcoes={[
                ['', disponiveis.length ? '— escolher da conta —' : '— nenhuma ação na conta —'],
                ...disponiveis.map((d) => [d.id, `${d.nome} · ${d.id}`]),
              ]}
              className="w-full"
            />
          )}
        </div>

        {/* Valor: só faz sentido depois de haver ação para recebê-lo. */}
        <div className="md:text-right">
          {mapeada ? (
            <label className="inline-flex items-center gap-1 text-[11px] text-tenue">
              R$
              <input
                type="number"
                min="0"
                step="0.01"
                value={valor}
                disabled={ocupado}
                onChange={(e) => setValor(e.target.value)}
                onBlur={() => Number(valor) !== Number(atual?.valor) && salvar()}
                aria-label={`Valor de ${evento.rotulo} para ${alvo ?? 'qualquer nível'}`}
                className="bg-superficie text-primario border border-borda-forte rounded-[8px]
                           px-2 py-[3px] text-[11px] w-[74px] tnum text-right"
              />
            </label>
          ) : (
            <span className="text-[11px] text-tenue">—</span>
          )}
        </div>

        {/* Ações da linha, sempre no mesmo canto. */}
        <div className="flex items-center gap-1 justify-start md:justify-end">
          {mapeada ? (
            <BotaoMini onClick={remover} disabled={ocupado} titulo="Desfaz o mapeamento deste nível">
              Remover
            </BotaoMini>
          ) : (
            <>
              {modo !== 'colar' && (
                <BotaoMini onClick={() => setModo('colar')} disabled={ocupado}>colar ctId</BotaoMini>
              )}
              <BotaoMini
                onClick={() => setModo(modo === 'criar' ? null : 'criar')}
                disabled={ocupado}
                titulo="Cria a ação de conversão na conta do Google Ads"
              >
                {modo === 'criar' ? 'Cancelar' : 'Criar ação'}
              </BotaoMini>
            </>
          )}
        </div>
      </div>

      {/* Criar no Google Ads: escrita real na conta, então abre por clique explícito. */}
      {modo === 'criar' && !mapeada && (
        <div className="px-3 pb-3 -mt-1">
          <div className="rounded-[8px] border border-borda-forte bg-elevado p-2.5 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-0.5 flex-1 min-w-[200px]">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-tenue">
                Nome na conta do Google Ads
              </span>
              <input
                type="text"
                value={nomeNovo}
                maxLength={80}
                onChange={(e) => setNomeNovo(e.target.value)}
                className="bg-superficie text-primario border border-borda-forte rounded-[8px]
                           px-2 py-[5px] text-[11px] w-full"
              />
            </label>
            <label className="flex flex-col gap-0.5 min-w-[170px]">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-tenue">
                Meta (categoria)
              </span>
              <Select
                rotulo="Meta da conversão no Google Ads"
                valor={metaNova}
                aoTrocar={setMetaNova}
                opcoes={(metas?.length
                  ? metas
                  : [{ id: evento.categoria || 'DEFAULT', rotulo: evento.categoria || 'padrão' }]
                ).map((m) => [m.id, m.rotulo])}
                className="w-full"
              />
            </label>
            <button
              type="button"
              disabled={ocupado}
              onClick={criarNoGoogle}
              className="text-[11px] px-3 py-[6px] rounded-[8px] border border-azul-500
                         bg-azul-600 text-white hover:bg-azul-500 cursor-pointer
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {ocupado ? 'Criando…' : 'Criar e mapear'}
            </button>
          </div>
        </div>
      )}

      {erro && <div className="px-3 pb-2 text-[10px] text-perigo">{erro}</div>}
    </div>
  );
}

/**
 * Metas por curso ou oferta — as exceções da régua do nível de ensino.
 *
 * O nível é grosso: um MBA e um curso de curta duração de R$ 300 caem no mesmo
 * balde e sobem com o mesmo valor, e o Smart Bidding passa a perseguir os dois
 * pelo mesmo preço. Aqui se cadastra o curso que merece meta e valor próprios.
 *
 * Fica dobrado por padrão, e depois da tabela de níveis, porque é exceção. Vê-la
 * primeiro daria a impressão de que é preciso cadastrar uma regra por curso —
 * são 692 ofertas no catálogo, e ninguém termina.
 */
function Especificas({ evento, regras, catalogo, metas, disponiveis, aoSalvar }) {
  const [aberto, setAberto] = useState(false);
  const [escopo, setEscopo] = useState('oferta');
  const [alvo, setAlvo] = useState('');
  const [acaoId, setAcaoId] = useState('');
  const [valor, setValor] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  /*
   * Criar contador novo é o caminho ESPERADO aqui, não a exceção.
   *
   * Uma meta específica existe para separar o curso do resto do nível — e ela
   * só separa alguma coisa se tiver ação própria no Google Ads. Apontar a
   * exceção para a mesma ação da regra de nível cria uma linha no painel que
   * não muda nada lá.
   */
  const [criando, setCriando] = useState(false);
  const [nomeNovo, setNomeNovo] = useState('');
  const [metaNova, setMetaNova] = useState(() => evento.categoria || 'DEFAULT');

  const ofertas = catalogo?.itens ?? [];

  /*
   * A lista de cursos sai das ofertas, agrupada por código.
   *
   * Uma linha por curso-pai, e não por turma: escolher "MBA em Gestão" no escopo
   * de curso deve valer para todas as ofertas dele — semestres, campi e turnos —
   * senão a regra teria de ser recadastrada a cada semestre novo.
   */
  const cursos = useMemo(() => {
    const m = new Map();
    for (const o of ofertas) {
      if (!o.curso_codigo || m.has(o.curso_codigo)) continue;
      m.set(o.curso_codigo, { codigo: o.curso_codigo, nome: o.nome, nivel: o.nivel_ensino });
    }
    return [...m.values()].sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
  }, [ofertas]);

  const opcoesAlvo = escopo === 'oferta'
    ? ofertas.filter((o) => o.codigo).map((o) => ({ v: String(o.codigo), r: o.nome || o.codigo }))
    : cursos.map((cu) => ({ v: String(cu.codigo), r: cu.nome || cu.codigo }));

  const rotuloAlvo = opcoesAlvo.find((o) => o.v === alvo)?.r ?? alvo;

  /*
   * O nome sugerido acompanha o alvo até alguém digitar por cima.
   *
   * Sem isso a pessoa escolhe a oferta e o nome continua o da anterior — e o
   * contador nasce com o rótulo errado dentro da conta de anúncios, onde
   * renomear depois não reescreve o histórico do relatório.
   */
  useEffect(() => {
    if (!criando) return;
    setNomeNovo(`IDE | ${evento.rotulo} | ${rotuloAlvo || (escopo === 'oferta' ? 'Oferta' : 'Curso')}`);
  }, [criando, evento, rotuloAlvo, escopo]);

  const limpar = () => {
    setAlvo(''); setAcaoId(''); setValor(''); setErro('');
    setCriando(false);
  };

  const salvar = async (over = {}) => {
    if (!alvo) return setErro('Escolha o curso ou a oferta.');
    const id = over.acaoId ?? acaoId;
    if (!id) return setErro('Escolha a ação de conversão, ou crie uma.');
    setOcupado(true);
    setErro('');
    try {
      await enviar('/api/conversoes/acoes', {
        evento: evento.id,
        escopo,
        alvo,
        alvo_rotulo: rotuloAlvo,
        conversion_action_id: id,
        conversion_action_nome:
          over.nome ?? disponiveis.find((d) => d.id === id)?.nome ?? null,
        valor: Number(valor) || 0,
        ativo: true,
      });
      limpar();
      aoSalvar();
    } catch (e) {
      setErro(e.message || 'não deu para salvar');
    } finally {
      setOcupado(false);
    }
  };

  /** Cria a ação na conta do Google Ads e já a amarra a este alvo. */
  const criarEAdicionar = async () => {
    if (!alvo) return setErro('Escolha o curso ou a oferta antes de criar a ação.');
    const nome = nomeNovo.trim();
    if (nome.length < 3) return setErro('Nome com pelo menos 3 caracteres.');
    setOcupado(true);
    setErro('');
    try {
      const r = await enviar('/api/conversoes/acoes-google', {
        nome, evento: evento.id, categoria: metaNova,
      });
      await salvar({ acaoId: r.id, nome });
    } catch (e) {
      setErro(e.message || 'Falha ao criar no Google Ads');
      setOcupado(false);
    }
  };

  const remover = async (id) => {
    setOcupado(true);
    try {
      await enviar(`/api/conversoes/acoes/${id}`, undefined, 'DELETE');
      aoSalvar();
    } catch (e) {
      setErro(e.message || 'não deu para remover');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="border-t border-borda bg-elevado/40">
      <button
        type="button"
        aria-expanded={aberto}
        onClick={() => setAberto((a) => !a)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-transparent border-0 cursor-pointer
                   text-left hover:bg-superficie-hover"
      >
        <span
          aria-hidden="true"
          className={`text-tenue text-[9px] transition-transform motion-reduce:transition-none ${aberto ? 'rotate-90' : ''}`}
        >
          ▶
        </span>
        <span className="text-[11px] font-semibold text-secundario">
          Metas específicas por curso ou oferta
        </span>
        {regras.length > 0 && <Pill tom="sucesso">{regras.length}</Pill>}
        <span className="text-[10px] text-tenue ml-auto">
          vencem a regra do nível
        </span>
      </button>

      {aberto && (
        <div className="px-3 pb-3">
          {regras.length > 0 && (
            <div className="flex flex-col mb-2">
              {regras.map((r) => (
                <div
                  key={r.id}
                  className="grid gap-2 items-center py-1.5 border-b border-borda/60 last:border-b-0
                             grid-cols-1 md:grid-cols-[76px_minmax(0,1.2fr)_minmax(0,1fr)_86px_auto]"
                >
                  <Pill tom="neutro">{r.escopo === 'oferta' ? 'oferta' : 'curso'}</Pill>
                  <span className="text-xs truncate" title={r.alvo_rotulo || r.alvo}>
                    {r.alvo_rotulo || r.alvo}
                  </span>
                  <span className="text-[11px] text-tenue truncate">
                    {r.conversion_action_nome || r.conversion_action_id}
                  </span>
                  <span className="text-[11px] tnum md:text-right">
                    {r.valor ? `R$ ${Number(r.valor).toFixed(2)}` : '—'}
                  </span>
                  <span className="md:text-right">
                    <BotaoMini onClick={() => remover(r.id)} disabled={ocupado}>Remover</BotaoMini>
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-[8px] border border-borda-forte bg-superficie p-2.5
                          flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-0.5 min-w-[110px]">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-tenue">Escopo</span>
              <Select
                rotulo="Escopo da regra"
                valor={escopo}
                aoTrocar={(v) => { setEscopo(v); setAlvo(''); }}
                opcoes={[['oferta', 'Oferta'], ['curso', 'Curso']]}
                className="w-full"
              />
            </label>

            {/*
              * `datalist` e não `<select>`: são 692 ofertas, e rolar uma lista
              * desse tamanho para achar uma é pior do que digitar três letras.
              * O campo aceita o código direto, para quem já o conhece.
              */}
            <label className="flex flex-col gap-0.5 flex-1 min-w-[220px]">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-tenue">
                {escopo === 'oferta' ? 'Oferta' : 'Curso'} — digite para buscar
              </span>
              <input
                type="text"
                list={`alvos-${evento.id}-${escopo}`}
                value={alvo}
                onChange={(e) => setAlvo(e.target.value)}
                placeholder={escopo === 'oferta' ? 'nome ou código da oferta' : 'nome ou código do curso'}
                className="bg-superficie text-primario border border-borda-forte rounded-[8px]
                           px-2 py-[5px] text-[11px] w-full"
              />
              <datalist id={`alvos-${evento.id}-${escopo}`}>
                {opcoesAlvo.slice(0, 500).map((o) => (
                  <option key={o.v} value={o.v}>{o.r}</option>
                ))}
              </datalist>
            </label>

            {/*
              * `div` e não `label`: o alternador é um <button>, e conteúdo
              * interativo dentro de <label> é inválido — o clique no botão
              * escaparia para o controle rotulado e o focaria junto. Os dois
              * campos abaixo têm `aria-label` próprio, então nada se perde.
              */}
            <div className="flex flex-col gap-0.5 min-w-[190px] flex-1">
              {/*
                * O alternador fica NA LINHA DO RÓTULO, acima do campo.
                *
                * Embaixo ele lia como legenda do que já estava preenchido — e é
                * o contrário: é a escolha entre dois caminhos, que precisa ser
                * vista antes de mexer no campo, não depois.
                */}
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-tenue">
                  Ação de conversão
                </span>
                <button
                  type="button"
                  onClick={() => { setCriando((v) => !v); setErro(''); }}
                  className="text-[10px] text-azul-600 bg-transparent border-0 p-0 cursor-pointer
                             whitespace-nowrap hover:underline"
                >
                  {criando ? 'escolher uma que já existe' : '+ criar uma nova'}
                </button>
              </span>
              {criando ? (
                <input
                  type="text"
                  value={nomeNovo}
                  maxLength={80}
                  onChange={(e) => setNomeNovo(e.target.value)}
                  aria-label="Nome da nova ação no Google Ads"
                  className="bg-superficie text-primario border border-azul-500 rounded-[8px]
                             px-2 py-[5px] text-[11px] w-full"
                />
              ) : (
                <Select
                  rotulo="Ação de conversão da regra"
                  valor={acaoId}
                  aoTrocar={setAcaoId}
                  opcoes={[
                    ['', '— escolher da conta —'],
                    ...disponiveis.map((d) => [d.id, `${d.nome} · ${d.id}`]),
                  ]}
                  className="w-full"
                />
              )}
            </div>

            {/* A meta só é escolhida ao criar — ação existente já tem a sua. */}
            {criando && (
              <label className="flex flex-col gap-0.5 min-w-[150px]">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-tenue">Meta</span>
                <Select
                  rotulo="Meta da nova ação no Google Ads"
                  valor={metaNova}
                  aoTrocar={setMetaNova}
                  opcoes={(metas?.length
                    ? metas
                    : [{ id: evento.categoria || 'DEFAULT', rotulo: evento.categoria || 'padrão' }]
                  ).map((m) => [m.id, m.rotulo])}
                  className="w-full"
                />
              </label>
            )}

            <label className="flex flex-col gap-0.5 w-[92px]">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-tenue">Valor</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="0,00"
                className="bg-superficie text-primario border border-borda-forte rounded-[8px]
                           px-2 py-[5px] text-[11px] w-full tnum text-right"
              />
            </label>

            <button
              type="button"
              disabled={ocupado}
              onClick={() => (criando ? criarEAdicionar() : salvar())}
              className="text-[11px] px-3 py-[6px] rounded-[8px] border border-azul-500
                         bg-azul-600 text-white hover:bg-azul-500 cursor-pointer
                         disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {ocupado
                ? (criando ? 'Criando…' : 'Salvando…')
                : (criando ? 'Criar e adicionar' : 'Adicionar')}
            </button>
          </div>

          {erro && <div className="text-[10px] text-perigo mt-1">{erro}</div>}

          <div className="text-[10px] text-tenue mt-2 leading-relaxed">
            A ordem de resolução é <strong className="text-secundario">oferta → curso → nível → geral</strong>:
            a primeira regra que casar vence. O valor daqui só entra quando o webhook não trouxer
            o preço real da matrícula.
            {' '}Uma meta específica só separa alguma coisa no Google Ads se tiver{' '}
            <strong className="text-secundario">ação própria</strong> — apontar para a mesma ação da
            regra de nível cria uma linha aqui que não muda nada lá.
          </div>
        </div>
      )}
    </div>
  );
}

/** Botão de texto pequeno, o mesmo em toda linha da tabela. */
function BotaoMini({ children, onClick, disabled, titulo }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={titulo}
      className="text-[11px] px-2 py-[4px] rounded-[7px] border border-borda-forte bg-superficie
                 text-secundario hover:bg-superficie-hover hover:text-primario cursor-pointer
                 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}
