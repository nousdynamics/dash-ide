import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Abas,
  Botao,
  BotaoIcone,
  CabecalhoPagina,
  Cartao,
  Dica,
  Estado,
  EsqueletoPagina,
  Icone,
  InfoDica,
  Modal,
  Pill,
  Select,
  SetaSanfona,
  Switch,
  TituloSecao,
} from '../componentes/base';
import { invalidar, useApi } from '../lib/api';
import { ROTULO_STATUS, TOM_STATUS } from '../lib/conversao';
import { fmtInt } from '../lib/formato';

/**
 * Conversão offline — o fluxo que saiu do n8n.
 *
 * Só a INSTALAÇÃO: (0) Google pronto → (1) gatilhos por processo → (2) ctId /
 * ação por evento × nível. O resultado — registro, veredito do Google, captura
 * do clique e planilha — mora em "Google Conversões", porque é pergunta de todo
 * dia e esta tela é decisão que se toma uma vez.
 *
 * Os passos 1 e 2 são abas, não blocos empilhados: os dois dependem do processo
 * escolhido na coluna da esquerda, e empilhados obrigavam a rolar a lista de
 * etapas inteira para chegar ao ctId de quem já tinha terminado o passo 1.
 */

async function enviar(rota, corpo, metodo = 'POST') {
  const r = await fetch(rota, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.detalhe || dados.erro || `servidor respondeu ${r.status}`);
  // Toda chamada daqui grava: o cache das telas guarda o estado de antes.
  invalidar();
  return dados;
}

/** Campo de texto no mesmo desenho do `Select` da base — altura e borda iguais na linha. */
const CAMPO =
  'bg-superficie text-primario border border-borda-forte rounded-[9px] px-2.5 py-[6px] text-[13px] '
  + 'hover:border-azul-400/50 focus:border-azul-500 focus:outline-none transition-colors disabled:opacity-55';

/** Rótulo de campo de formulário — legível, sem caixa alta miúda. */
function Rotulo({ children, dica }) {
  return (
    <span className="flex items-center gap-1 text-[12.5px] font-medium text-secundario">
      {children}
      <InfoDica texto={dica} tamanho="w-[13px] h-[13px]" />
    </span>
  );
}

function Acao({ children, aoClicar, variante = 'secundario', titulo, icone }) {
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

  // O resultado fica no próprio botão por alguns segundos: verde deu certo, vermelho não.
  const realce = estado === 'ok'
    ? '!bg-sucesso/12 !text-sucesso !border-sucesso/40 !shadow-none'
    : '';

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Dica conteudo={titulo}>
        <Botao
          variante={estado === 'erro' ? 'perigo' : variante}
          icone={estado === 'ok' ? 'check' : estado === 'erro' ? 'alerta' : icone}
          carregando={estado === 'rodando'}
          onClick={rodar}
          className={realce}
        >
          {estado === 'rodando' ? 'Aguarde…' : estado === 'ok' ? 'Feito' : children}
        </Botao>
      </Dica>
      {msg && (
        <span
          className={`text-[12px] max-w-[320px] leading-snug animate-aparecer ${estado === 'erro' ? 'text-perigo' : 'text-secundario'}`}
        >
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

const DESCRICAO_TELA =
  'Mapeia etapa do Rubeus → evento → ação do Google Ads (ctId). Quando o lead muda de etapa, '
  + 'o painel envia a conversão com o identificador do clique (ou e-mail/telefone em hash).';

export function Conversoes() {
  const [versao, setVersao] = useState(0);
  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  const { dados, carregando, erro } = useApi('/api/conversoes', `conversoes-${versao}`);
  const [processoAtivo, setProcessoAtivo] = useState(null);
  /** Qual painel auxiliar está aberto: 'checklist', 'envio' ou nenhum. */
  const [modal, setModal] = useState(null);
  /** Passo à mostra: 'gatilhos' (etapa → evento) ou 'acoes' (evento → ctId). */
  const [aba, setAba] = useState('gatilhos');

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

  /*
   * Quanto do volume real ficaria sem destino com o mapa de hoje.
   *
   * Mesma regra do envio: a ação do nível exato, senão a curinga do evento. É o
   * número que separa "configurado" de "configurado e cobrindo o que chega".
   *
   * Calculado antes dos retornos antecipados de erro/carregamento: hook depois
   * de `return` muda a quantidade de hooks entre um render e outro, e o React
   * derruba a tela na hora em que os dados chegam.
   */
  const acoesDados = dados?.acoes;
  const coberturaDados = dados?.cobertura;
  const { volumeTotal, descobertoTotal } = useMemo(() => {
    let total = 0;
    let descoberto = 0;
    const curingaDe = new Map(
      (acoesDados ?? [])
        .filter((a) => a.ativo && a.escopo === 'geral' && a.conversion_action_id)
        .map((a) => [a.evento, true]),
    );
    for (const c of coberturaDados ?? []) {
      const n = Number(c.leads) || 0;
      total += n;
      if (curingaDe.has(c.evento)) continue;
      const temRegra = (acoesDados ?? []).some(
        (a) => a.ativo && a.conversion_action_id && a.evento === c.evento
          && a.escopo === 'nivel' && a.alvo === c.nivel,
      );
      if (!temRegra) descoberto += n;
    }
    return { volumeTotal: total, descobertoTotal: descoberto };
  }, [coberturaDados, acoesDados]);

  /*
   * Captura do clique, planilha e monitor saíram daqui.
   *
   * Foram para "Google Conversões". O que sobra nesta tela é decisão de
   * instalação — qual etapa vira evento, e para qual ação do Google cada
   * nível manda —, mexida raramente. Misturada com o resultado, obrigava
   * quem só queria conferir o envio de ontem a rolar por escolhas que não
   * ia tomar naquele momento. O atalho mora no cabeçalho, sempre à mão.
   */
  const cabecalho = (
    <CabecalhoPagina
      titulo="Conversões Ads"
      icone="alvo"
      descricao={DESCRICAO_TELA}
      acoes={
        <Dica
          conteudo="O registro das conversões, o veredito do Google, a captura do gclid no site e a cópia na planilha ficam em Google Conversões."
        >
          <a
            href="#/conversoes-google"
            className="inline-flex items-center gap-2 text-[13px] font-medium px-3.5 py-[7px] rounded-[10px]
                       border border-borda-forte bg-superficie text-primario no-underline whitespace-nowrap
                       hover:bg-superficie-hover hover:border-azul-400/40 transition-colors"
          >
            <Icone nome="olho" className="w-4 h-4" />
            Conferir o que foi enviado
            <Icone nome="setaDireita" className="w-4 h-4 text-tenue" />
          </a>
        </Dica>
      }
    />
  );

  if (erro?.includes('403') || erro?.includes('sem_permissao')) {
    return (
      <>
        {cabecalho}
        <Cartao>
          <Estado
            icone="cadeado"
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
  if (carregando || !dados) {
    return (
      <>
        {cabecalho}
        <EsqueletoPagina kpis={0} graficos={0} tabela />
      </>
    );
  }

  const {
    config, eventos, gatilhos, acoes, resumo, niveis, cobertura,
    nivel_padrao, google, metas_google, bases_valor,
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
      falta: 'Ligar gatilho na aba “1 · Gatilhos”',
    },
    {
      /*
       * Verde só quando TODO o volume tem destino.
       *
       * Antes bastava existir uma regra qualquer, e o checklist ficava verde com
       * 14% dos leads caindo em `sem_acao`. Um checklist que aprova o estado
       * incompleto é pior do que não existir: ele afirma que está pronto.
       *
       * A conta é em leads dos últimos 60 dias, por evento. O curinga cobre tudo
       * do evento dele — é para isso que ele existe.
       */
      ok: descobertoTotal === 0 && (acoes ?? []).some((a) => a.ativo && a.conversion_action_id),
      rotulo: descobertoTotal === 0 && volumeTotal > 0
        ? `ctId mapeado para 100% dos leads (${fmtInt(volumeTotal)} em 60 d)`
        : 'ctId / ação de conversão mapeada',
      falta: descobertoTotal > 0
        ? `${fmtInt(descobertoTotal)} lead(s) sem ação — mapeie o nível “qualquer” na aba “2 · Ações do Google”`
        : 'Colar ou criar ctId na aba “2 · Ações do Google”',
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

  const gatilhosLigados = (processoId) => (gatilhos ?? []).filter(
    (g) => String(g.processo_id) === String(processoId) && g.ativo,
  ).length;

  const abas = [
    {
      id: 'gatilhos',
      nome: '1 · Gatilhos',
      icone: 'raio',
      contagem: pipeline ? gatilhosLigados(pipeline.processo_id) : undefined,
    },
    { id: 'acoes', nome: '2 · Ações do Google', icone: 'alvo' },
  ];

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
      <Cartao className="animate-surgir">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <Switch
              ligado={config.modo === 'real'}
              aoTrocar={(v) => trocarConfig({ ligado: true, modo: v ? 'real' : 'teste' })}
            >
              <span className="sr-only">Enviar conversões reais ao Google Ads</span>
            </Switch>
            <div className="min-w-0 flex items-center gap-2 flex-wrap">
              <span
                className={`text-[14px] font-semibold ${config.modo === 'real' ? 'text-sucesso' : 'text-primario'}`}
              >
                {config.modo === 'real' ? 'Enviando conversões reais' : 'Somente teste'}
              </span>
              <InfoDica
                texto={config.modo === 'real'
                  ? 'Cada conversão conta na conta de anúncios e influencia o lance das campanhas.'
                  : 'O Google valida cada envio e descarta — nada é contabilizado.'}
              />
              {!config.ligado && (
                <Pill
                  tom="perigo"
                  ponto
                  dica="A chave geral está desligada: nenhuma conversa com o Google, nem as validações do modo teste. Religue em “Ajustes do envio”."
                >
                  Pausado
                </Pill>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {resumo.map((r) => (
              <Pill
                key={r.status}
                tom={TOM_STATUS[r.status] ?? 'neutro'}
                dica="Conversões dos últimos 30 dias, pelo que o painel fez com cada uma."
              >
                <span className="tnum">{fmtInt(r.total)}</span> {ROTULO_STATUS[r.status] ?? r.status}
              </Pill>
            ))}
            {resumo.length === 0 && (
              <Pill tom="neutro">Nenhuma conversão em 30 dias</Pill>
            )}

            <Acao
              variante="primario"
              icone="enviar"
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
              icone={pendencias ? 'alerta' : 'checkCirculo'}
              aoClicar={() => setModal('checklist')}
            />

            <BotaoIcone titulo="Ajustes do envio" icone="engrenagem" aoClicar={() => setModal('envio')} />
          </div>
        </div>
      </Cartao>

      <Modal
        aberto={modal === 'checklist'}
        aoFechar={() => setModal(null)}
        titulo="Para o Google receber o evento"
        descricao="O que precisa estar de pé para uma conversão sair daqui e chegar lá."
      >
        <ul className="flex flex-col gap-2 m-0 p-0 list-none">
          {checklist.map((c) => (
            <li
              key={c.rotulo}
              className={`flex items-start gap-2.5 text-[13.5px] rounded-[10px] px-3 py-2.5 border
                ${c.ok ? 'border-borda bg-elevado' : 'border-atencao/30 bg-atencao/8'}`}
            >
              <span className={`mt-px shrink-0 ${c.ok ? 'text-sucesso' : 'text-atencao'}`} aria-hidden="true">
                <Icone nome={c.ok ? 'checkCirculo' : 'alerta'} className="w-[18px] h-[18px]" />
              </span>
              <span className={c.ok ? 'text-secundario' : 'text-primario font-semibold'}>
                {c.ok ? c.rotulo : c.falta}
              </span>
            </li>
          ))}
        </ul>

        <div className="flex items-start gap-2 text-[13px] text-secundario mt-4 pt-3 border-t border-borda leading-relaxed">
          <Icone nome="info" className="w-4 h-4 mt-0.5 shrink-0 text-azul-600" />
          <span>
            Em cada envio o Google exige ainda: <strong className="text-primario">identificador</strong>{' '}
            (gclid/gbraid/wbraid <em>ou</em> e-mail/telefone em hash) +{' '}
            <strong className="text-primario">timestamp</strong> +{' '}
            <strong className="text-primario">ctId</strong> da ação. Valor (R$) é opcional no protocolo,
            mas necessário para Smart Bidding.
          </span>
        </div>

        {!google.tem_datamanager && (
          <div className="mt-4 rounded-[10px] border border-atencao/30 bg-atencao/8 p-3">
            <div className="text-[13.5px] font-semibold text-atencao flex items-center gap-2">
              <Icone nome="chave" className="w-4 h-4" />
              {google.conectado
                ? 'A conta Google conectada não tem o escopo Data Manager'
                : 'Nenhuma conta Google conectada'}
            </div>
            <div className="text-[13px] text-secundario mt-1.5 leading-relaxed">
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
            <div className="text-[13px] text-secundario mt-2 leading-relaxed">
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
        <div className="flex flex-col divide-y divide-borda">
          {/*
            * Consentimento é declaração, não ajuste técnico.
            *
            * Marcar "concedido" afirma ao Google, em nome da faculdade, que o
            * titular consentiu com o uso dos dados para anúncios. O padrão não
            * afirma nada — e não afirmar é diferente de negar: omitido, o Google
            * aplica a regra da conta; negado, ele descarta o identificador e a
            * conversão aprimorada para de casar.
            */}
          <div className="flex items-center justify-between gap-4 flex-wrap pb-4">
            <div className="min-w-0">
              <div className="text-[14px] font-semibold flex items-center gap-1.5">
                Consentimento declarado ao Google
                <InfoDica
                  largura={340}
                  texto="O padrão não afirma nada e deixa o Google aplicar a regra da conta; “negado” faz o Google descartar e-mail e telefone, e a conversão aprimorada para de casar."
                />
              </div>
              <div className="text-[13px] text-secundario mt-0.5 max-w-[360px] leading-snug">
                Só marque <strong className="text-primario">concedido</strong> se a captação de leads de
                fato coleta esse consentimento — é uma declaração em nome da faculdade.
              </div>
            </div>
            <Select
              rotulo="Consentimento de dados do usuário"
              valor={config.consentimento ?? 'nao_informado'}
              aoTrocar={(v) => trocarConfig({ consentimento: v })}
              opcoes={[
                ['nao_informado', 'Não informar (padrão)'],
                ['concedido', 'Concedido'],
                ['negado', 'Negado'],
              ]}
              className="w-full sm:w-[220px]"
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
          <div className="flex items-center justify-between gap-4 flex-wrap pt-4">
            <div className="min-w-0">
              <div className="text-[14px] font-semibold flex items-center gap-1.5">
                Pausar tudo
                <InfoDica texto="Interrompe qualquer conversa com o Google, inclusive as validações do modo teste. Os eventos continuam sendo registrados e ficam na fila." />
              </div>
              <div className="mt-1">
                <Pill tom={config.ligado ? 'sucesso' : 'perigo'} ponto>
                  {config.ligado ? 'Em operação' : 'Pausado'}
                </Pill>
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

      {/*
        * Processo à esquerda, passos à direita.
        *
        * O processo escolhido vale para as duas abas — o ctId da aba 2 é o dos
        * gatilhos ligados na aba 1 —, então a lista fica fora delas e continua
        * visível ao trocar de passo.
        */}
      <div className="grid grid-cols-1 lg:grid-cols-[230px_minmax(0,1fr)] gap-4 items-start">
        <Cartao className="!p-2 lg:sticky lg:top-3">
          <div className="text-[12.5px] font-semibold text-secundario px-2.5 pt-1.5 pb-2 flex items-center gap-1.5">
            <Icone nome="camadas" className="w-4 h-4 text-azul-600" />
            Processos
            <InfoDica texto="Cada processo do Rubeus tem suas próprias etapas. Escolha um para configurar os gatilhos e as ações dele." />
          </div>
          <nav className="flex flex-col gap-0.5 max-h-[60vh] lg:max-h-none overflow-y-auto" aria-label="Processos para gatilho">
            {pipelinesOrd.map((p) => {
              const ativo = p.processo_id === processoAtivo;
              const ligados = gatilhosLigados(p.processo_id);
              return (
                <button
                  key={p.processo_id}
                  type="button"
                  aria-current={ativo ? 'true' : undefined}
                  onClick={() => setProcessoAtivo(p.processo_id)}
                  className={`text-left rounded-[9px] px-2.5 py-2 border-0 cursor-pointer transition-colors
                    ${ativo
                      ? 'bg-azul-600 text-white shadow-[0_2px_8px_rgba(43,87,151,0.25)]'
                      : 'bg-transparent text-secundario hover:bg-superficie-hover hover:text-primario'}`}
                >
                  <Dica conteudo={p.processo_nome} className="w-full">
                    <span className="block text-[13px] font-semibold truncate">{p.processo_nome}</span>
                  </Dica>
                  <span className={`flex items-center gap-1.5 text-[12px] mt-0.5 tnum ${ativo ? 'text-white/80' : 'text-tenue'}`}>
                    {p.etapas.length} etapa{p.etapas.length === 1 ? '' : 's'}
                    {ligados > 0 && (
                      <span className={`inline-flex items-center gap-0.5 ${ativo ? 'text-white' : 'text-azul-600'}`}>
                        · <Icone nome="raio" className="w-3 h-3" /> {ligados}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </nav>
        </Cartao>

        <div className="flex flex-col gap-3 min-w-0">
          <Abas abas={abas} ativa={aba} aoTrocar={setAba} rotulo="Passos da configuração" className="self-start" />

          {aba === 'gatilhos' && (
            <Cartao key={`g-${processoAtivo}`} className="animate-surgir">
              {!pipeline ? (
                <Estado
                  titulo="Nenhuma etapa no catálogo"
                  mensagem="As etapas aparecem quando o Rubeus dispara eventos ou o sync roda."
                />
              ) : (
                <>
                  <TituloSecao
                    titulo={`Gatilhos · ${pipeline.processo_nome}`}
                    icone="raio"
                    dica={`Cada linha é uma etapa deste processo no Rubeus. Escolha qual evento do Google ela dispara. A regra fica ligada a este processo (ID ${pipeline.processo_id}).`}
                    extra={<Pill tom="neutro">ID <span className="font-mono">{pipeline.processo_id}</span></Pill>}
                  />

                  <div className="overflow-x-auto -mx-[18px]">
                    <table className="tabela min-w-[520px]">
                      <thead>
                        <tr>
                          <th>Etapa no Rubeus</th>
                          <th className="w-[260px]">Evento (Google)</th>
                          <th className="w-[110px] !text-center">Ativo</th>
                        </tr>
                      </thead>
                      <tbody>
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
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </Cartao>
          )}

          {/* 2. ctId — um bloco por gatilho ativo do processo selecionado na aba 1 */}
          {aba === 'acoes' && (
            <Cartao key={`a-${processoAtivo}`} className="animate-surgir">
              <TituloSecao
                titulo={`ctId do Google · ${pipeline?.processo_nome || 'escolha o processo'}`}
                icone="alvo"
                dica="Um bloco por gatilho que você ligou na aba 1, e dentro dele uma linha por nível de ensino. Escolher a ação da conta é o caminho seguro — ctId digitado à mão é aceito aqui e só falha na hora do envio. O nível “qualquer” recebe quem chegou sem curso identificado."
                extra={descobertoTotal > 0 && (
                  <Pill
                    tom="atencao"
                    ponto
                    dica="Leads dos últimos 60 dias, em todos os processos, que hoje não teriam ação de conversão para onde ir."
                  >
                    {fmtInt(descobertoTotal)} sem destino
                  </Pill>
                )}
              />
              <TabelaAcoes
                eventos={eventos}
                metas={metas_google ?? []}
                bases={bases_valor ?? []}
                niveis={[nivel_padrao, ...(niveis ?? []).map((n) => n.nivel)]}
                acoes={acoes}
                gatilhos={gatilhos}
                processoId={processoAtivo}
                processoNome={pipeline?.processo_nome}
                nivelPadrao={nivel_padrao}
                cobertura={cobertura ?? []}
                aoSalvar={recarregar}
                aoIrGatilhos={() => setAba('gatilhos')}
              />
            </Cartao>
          )}
        </div>
      </div>
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
    <tr>
      <td className="max-w-0 w-full">
        <Dica conteudo={etapa} className="w-full">
          <span className="block text-[13.5px] font-semibold truncate">{etapa}</span>
        </Dica>
        {atual?.processo_id == null && evento && (
          <span className="inline-flex items-center gap-1 text-[12px] text-atencao mt-0.5">
            <Icone nome="alerta" className="w-3.5 h-3.5" />
            regra global antiga — salve de novo neste processo
          </span>
        )}
      </td>
      <td>
        <Select
          rotulo={`Evento para ${etapa}`}
          valor={evento}
          aoTrocar={(v) => (v ? salvar({ evento: v, ativo: true }) : null)}
          opcoes={[['', 'Não dispara'], ...eventos.map((e) => [e.id, e.rotulo])]}
          className="w-full min-w-[200px]"
        />
      </td>
      <td>
        <div className="flex justify-center">
          {evento ? (
            <Switch
              ligado={ativo}
              desativado={salvando}
              aoTrocar={(v) => salvar({ ativo: v })}
              dica={salvando ? 'Salvando…' : ativo ? 'Dispara o evento quando o lead chega nesta etapa' : 'Gatilho desligado'}
            >
              <span className="sr-only">{salvando ? 'salvando' : ativo ? 'ativo' : 'inativo'}</span>
            </Switch>
          ) : (
            <span className="text-[13px] text-tenue">—</span>
          )}
        </div>
      </td>
    </tr>
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

/** Aviso que pede ação — fica na tela, com ícone, em vez de linha miúda colorida. */
function Aviso({ children }) {
  return (
    <div
      className="flex items-start gap-2 text-[13px] text-primario leading-relaxed rounded-[10px]
                 border border-atencao/30 bg-atencao/8 px-3 py-2 animate-aparecer"
    >
      <Icone nome="alerta" className="w-4 h-4 mt-0.5 shrink-0 text-atencao" />
      <span>{children}</span>
    </div>
  );
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
  eventos, metas, bases, niveis, acoes, gatilhos, processoId, processoNome, aoSalvar, nivelPadrao, cobertura,
  aoIrGatilhos,
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

  /**
   * Quantos leads cada nível trouxe, por evento, nos últimos 60 dias.
   *
   * `''` é o nível não identificado, que no envio cai no curinga — por isso ele
   * vira a contagem da linha `qualquer`.
   */
  const volumePorEvento = useMemo(() => {
    const m = new Map();
    for (const c of cobertura ?? []) {
      if (!m.has(c.evento)) m.set(c.evento, new Map());
      m.get(c.evento).set(c.nivel || nivelPadrao, Number(c.leads) || 0);
    }
    return m;
  }, [cobertura, nivelPadrao]);

  /**
   * Quais linhas mostrar para um evento.
   *
   * Antes a lista vinha do NOME do processo: "Pós-Graduação" mostrava só níveis
   * de pós. Isso escondia o que de fato chega — na etapa de Oportunidade entram
   * também Graduação e Extensão —, e nível escondido não é mapeado. A conversão
   * então fica presa em `sem_acao` sem ninguém perceber, que foi exatamente o
   * que aconteceu com as duas primeiras conversões reais desta conta.
   *
   * Agora a lista é a união de dois conjuntos:
   *
   *   1. os níveis que REALMENTE chegaram nesse evento — a verdade medida;
   *   2. os do catálogo que combinam com o processo — para dar para mapear
   *      antes de o primeiro lead chegar.
   *
   * Ordenadas por volume: quem manda mais lead aparece antes, e o curinga
   * sempre no topo, porque é a rede que segura todo o resto.
   */
  const linhasDoEvento = useMemo(() => (eventoId) => {
    const volumes = volumePorEvento.get(eventoId) ?? new Map();

    const doCatalogo = niveis.filter((nivel) => {
      if (nivel === nivelPadrao) return true;
      if (!familia) return true;
      const f = familiaNivel(nivel).id;
      if (familia === 'geral') return f === 'geral';
      return f === familia;
    });

    const todos = new Set([nivelPadrao, ...volumes.keys(), ...doCatalogo]);

    return [...todos]
      .map((nivel) => ({ nivel, leads: volumes.get(nivel) ?? 0 }))
      .sort((a, b) => {
        if (a.nivel === nivelPadrao) return -1;
        if (b.nivel === nivelPadrao) return 1;
        if (a.leads !== b.leads) return b.leads - a.leads;
        return String(a.nivel).localeCompare(String(b.nivel), 'pt-BR');
      });
  }, [volumePorEvento, niveis, familia, nivelPadrao]);

  if (!processoId) return <Estado mensagem="Selecione um processo na lista ao lado." />;

  if (!gatilhosDoProcesso.length) {
    return (
      <Estado
        icone="raio"
        titulo="Nenhum gatilho ativo neste processo"
        mensagem="Na aba “1 · Gatilhos”, ligue pelo menos uma etapa (ex.: Oportunidade → Inscrição concluída). Só então aparece o campo de ctId aqui."
        acao={aoIrGatilhos && (
          <Botao icone="raio" onClick={aoIrGatilhos}>Ir para Gatilhos</Botao>
        )}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {erro && <Aviso>Não listou ações do Google Ads: {erro}</Aviso>}
      {!erro && disponiveis.length === 0 && (
        <Aviso>
          Nenhuma ação <span className="font-mono">UPLOAD_CLICKS</span> na conta. Use
          “Criar ação” em cada linha, ou crie no Google Ads.
        </Aviso>
      )}

      {gatilhosDoProcesso.map((g) => {
        const ev = eventos.find((e) => e.id === g.evento);
        if (!ev) return null;

        /*
         * As linhas de base: o curinga e um por nível de ensino do processo.
         * Regras por curso ou oferta não entram aqui — são exceções, e listá-las
         * junto faria a contagem "x de y níveis" mentir.
         */
        const doEvento = linhasDoEvento(ev.id).map(({ nivel, leads }) => ({
          nivel,
          leads,
          atual: acoes.find((a) => a.evento === ev.id && (
            nivel === nivelPadrao ? a.escopo === 'geral' : (a.escopo === 'nivel' && a.alvo === nivel)
          )),
        }));

        /*
         * Cobertura em LEADS, não em linhas.
         *
         * "1 de 4 níveis mapeados" tratava um nível com 3 leads e outro com 194
         * como se pesassem o mesmo. O número que importa é quanto do volume real
         * tem para onde ir — e o curinga, quando mapeado, cobre tudo, porque é
         * ele que recebe o que nenhuma regra específica pegou.
         */
        const curinga = doEvento.find((l) => l.nivel === nivelPadrao)?.atual?.conversion_action_id;
        const totalLeads = doEvento.reduce((n, l) => n + l.leads, 0);
        const leadsCobertos = curinga
          ? totalLeads
          : doEvento.reduce((n, l) => n + (l.atual?.conversion_action_id ? l.leads : 0), 0);
        const pctCoberto = totalLeads ? Math.round((leadsCobertos / totalLeads) * 100) : null;
        const descobertos = totalLeads - leadsCobertos;

        const especificas = acoes.filter(
          (a) => a.evento === ev.id && (a.escopo === 'oferta' || a.escopo === 'curso'),
        );

        return (
          <div
            key={`${g.processo_id ?? 'g'}::${g.etapa_nome}::${g.evento}`}
            className="rounded-[12px] border border-borda overflow-hidden"
          >
            {/* Cabeçalho do gatilho: a etapa, o evento que ela dispara, e o progresso. */}
            <div className="flex items-center justify-between gap-3 flex-wrap px-3.5 py-2.5 bg-elevado border-b border-borda">
              <div className="flex items-center gap-2 min-w-0 text-[13.5px]">
                <span className="font-semibold truncate">{g.etapa_nome}</span>
                <Icone nome="setaDireita" className="w-4 h-4 text-tenue shrink-0" />
                <Pill tom="azul">{ev.rotulo}</Pill>
              </div>
              <span className="flex items-center gap-1.5 flex-wrap shrink-0">
                {pctCoberto === null ? (
                  <Pill tom="neutro">sem lead nesta etapa em 60 d</Pill>
                ) : (
                  <>
                    <Pill
                      tom={pctCoberto === 100 ? 'sucesso' : 'atencao'}
                      ponto
                      dica={`${fmtInt(leadsCobertos)} de ${fmtInt(totalLeads)} leads dos últimos 60 dias têm ação de conversão para onde ir.`}
                    >
                      cobre {pctCoberto}% dos leads
                    </Pill>
                    {descobertos > 0 && (
                      <Pill tom="perigo" dica="Leads que hoje ficariam em “sem ação cadastrada”. Mapear o nível “qualquer” cobre todos.">
                        {fmtInt(descobertos)} sem destino
                      </Pill>
                    )}
                  </>
                )}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="tabela min-w-[720px]">
                <thead>
                  <tr>
                    <th className="w-[200px]">Nível de ensino</th>
                    <th>Ação de conversão (ctId)</th>
                    <th className="w-[190px]">
                      <span className="inline-flex items-center gap-1">
                        Valor
                        <InfoDica texto="Qual preço vai ao Google: o total do curso, a inscrição (os dois vêm da oferta que o lead escolheu) ou um valor fixo desta regra." />
                      </span>
                    </th>
                    <th className="w-[1%]"><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {doEvento.map(({ nivel, leads, atual }) => (
                    <LinhaAcao
                      key={nivel}
                      evento={ev}
                      escopo={nivel === nivelPadrao ? 'geral' : 'nivel'}
                      alvo={nivel === nivelPadrao ? null : nivel}
                      rotulo={nivel === nivelPadrao
                        ? <em className="text-secundario font-medium">qualquer / não identificado</em>
                        : nivel}
                      dicaRotulo={nivel === nivelPadrao
                        ? 'Recebe quem chegou sem curso identificado — e todo nível que não tem regra própria.'
                        : nivel}
                      leads={leads}
                      metas={metas}
                      bases={bases}
                      atual={atual}
                      disponiveis={disponiveis}
                      aoSalvar={aoSalvar}
                    />
                  ))}
                </tbody>
              </table>
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
              bases={bases}
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
/**
 * Fallback das bases, para a tela funcionar antes de a API responder.
 * A fonte é `bases_valor` do servidor — ver BASES_VALOR em routes/conversoes.ts.
 */
/** Nome curto de cada base, para o aviso de divergência caber numa linha. */
const ROTULO_EVENTO_BASE = {
  total: 'Valor total do curso',
  inscricao: 'Valor da inscrição',
  fixo: 'Valor fixo',
};

const BASES_PADRAO = [
  { id: 'total', rotulo: 'Valor total do curso' },
  { id: 'inscricao', rotulo: 'Valor da inscrição' },
  { id: 'fixo', rotulo: 'Valor fixo desta regra' },
];

function LinhaAcao({
  evento, escopo, alvo, rotulo, dicaRotulo, leads = 0, metas, bases, atual, disponiveis, aoSalvar,
}) {
  const [valor, setValor] = useState(atual?.valor ?? 0);
  const [base, setBase] = useState(atual?.base_valor ?? evento.base_valor ?? 'total');
  const [modo, setModo] = useState(null); // 'colar' | 'criar' | null
  const [ctIdManual, setCtIdManual] = useState('');
  const [nomeNovo, setNomeNovo] = useState(() => nomeSugerido(evento, alvo));
  const [metaNova, setMetaNova] = useState(() => evento.categoria || 'DEFAULT');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => setValor(atual?.valor ?? 0), [atual?.valor]);
  useEffect(
    () => setBase(atual?.base_valor ?? evento.base_valor ?? 'total'),
    [atual?.base_valor, evento.base_valor],
  );

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
        base_valor: over.base_valor ?? base,
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

  const nomeAcao = mapeada
    ? (disponiveis.find((d) => d.id === atual.conversion_action_id)?.nome
      || atual.conversion_action_nome
      || 'ação sem nome na conta')
    : '';

  return (
    <Fragment>
      <tr className={ocupado ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        <td className="align-top">
          <Dica conteudo={dicaRotulo} className="w-full">
            <span className="block text-[13.5px] font-semibold truncate max-w-[200px]">{rotulo}</span>
          </Dica>
          {/*
            * O volume ao lado do nome: é o que separa a linha que precisa ser
            * mapeada hoje da que só existe no catálogo.
            */}
          <span
            className={`flex items-center gap-1 text-[12px] mt-0.5 tnum ${leads > 0 && !atual?.conversion_action_id ? 'text-atencao font-medium' : 'text-tenue'}`}
          >
            {leads > 0 && !atual?.conversion_action_id && <Icone nome="alerta" className="w-3.5 h-3.5" />}
            {leads > 0 ? `${fmtInt(leads)} lead(s) / 60d` : 'sem lead em 60 d'}
          </span>
        </td>

        {/* Coluna da ação: o valor mapeado, ou os caminhos para mapear. */}
        <td className="align-top max-w-0">
          {mapeada ? (
            <div className="flex items-center gap-2 min-w-0">
              <Icone nome="checkCirculo" className="w-[18px] h-[18px] text-sucesso shrink-0" />
              <span className="min-w-0 flex-1">
                {/*
                  * O nome guardado pode estar vazio — regras criadas antes de a
                  * lista da conta terminar de carregar gravaram `null`. A conta
                  * é a fonte da verdade e já está em mãos aqui, então vale mais
                  * do que a cópia velha do banco.
                  */}
                <Dica conteudo={nomeAcao} className="w-full">
                  <span className="block text-[13px] truncate">{nomeAcao}</span>
                </Dica>
                <span className="block text-[12px] text-tenue font-mono">
                  {atual.conversion_action_id}
                </span>
              </span>
            </div>
          ) : modo === 'colar' ? (
            <span className="flex items-center gap-1.5 animate-aparecer">
              <input
                type="text"
                inputMode="numeric"
                autoFocus
                placeholder="ex.: 1234567890"
                value={ctIdManual}
                onChange={(e) => setCtIdManual(e.target.value.replace(/\D/g, ''))}
                aria-label={`ctId de ${evento.rotulo} para ${alvo ?? 'qualquer nível'}`}
                className={`${CAMPO} font-mono min-w-0 flex-1`}
              />
              <Botao
                variante="primario"
                tamanho="sm"
                carregando={ocupado}
                onClick={() => salvar({ acaoId: ctIdManual })}
                disabled={!ctIdManual}
              >
                Salvar
              </Botao>
              <Botao variante="fantasma" tamanho="sm" onClick={() => setModo(null)} disabled={ocupado}>
                Cancelar
              </Botao>
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
        </td>

        {/*
          * Qual preço vai ao Google — não quanto.
          *
          * A oferta do Rubeus guarda os dois: total do curso e inscrição. Antes
          * havia só um campo de reais digitado à mão, e ele obrigava a escolher
          * um número para o nível inteiro — a mesma cifra para um MBA e para um
          * curso de R$ 300. Aqui se escolhe a FONTE, e o preço vem da oferta que
          * o lead de fato escolheu.
          *
          * O campo de reais sobrevive como "fixo", para o caso de o catálogo não
          * ter preço — e é o que as regras antigas continuam usando.
          */}
        <td className="align-top">
          {mapeada ? (
            <div className="flex flex-col gap-1.5">
              <Select
                rotulo={`Base do valor de ${evento.rotulo} para ${alvo ?? 'qualquer nível'}`}
                valor={base}
                aoTrocar={(v) => { setBase(v); salvar({ base_valor: v }); }}
                opcoes={(bases?.length ? bases : BASES_PADRAO).map((b) => [b.id, b.rotulo])}
                className="w-full"
              />
              {/*
                * Divergir da recomendação é permitido e às vezes certo — mas
                * precisa ser visível. Taxa de inscrição e valor de curso diferem
                * por um fator de trinta nesta conta: trocar um pelo outro sem
                * perceber multiplica ou divide o retorno da campanha.
                */}
              {evento.base_valor && base !== evento.base_valor && (
                <Dica
                  conteudo={`${ROTULO_EVENTO_BASE[evento.base_valor] ?? evento.base_valor} é o recomendado para “${evento.rotulo}”.`}
                >
                  <span className="inline-flex items-center gap-1 text-[12px] text-atencao font-medium cursor-help">
                    <Icone nome="alerta" className="w-3.5 h-3.5" />
                    fora do recomendado
                  </span>
                </Dica>
              )}
              {base === 'fixo' && (
                <label className="inline-flex items-center gap-1.5 text-[13px] text-secundario">
                  R$
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={valor}
                    disabled={ocupado}
                    onChange={(e) => setValor(e.target.value)}
                    onBlur={() => Number(valor) !== Number(atual?.valor) && salvar()}
                    aria-label={`Valor fixo de ${evento.rotulo} para ${alvo ?? 'qualquer nível'}`}
                    className={`${CAMPO} w-full tnum text-right`}
                  />
                </label>
              )}
            </div>
          ) : (
            <span className="text-[13px] text-tenue">—</span>
          )}
        </td>

        {/* Ações da linha, sempre no mesmo canto. */}
        <td className="align-top">
          <div className="flex items-center gap-1 justify-end">
            {mapeada ? (
              <BotaoMini
                onClick={remover}
                disabled={ocupado}
                titulo="Desfaz o mapeamento deste nível"
                icone="lixeira"
                variante="perigo"
              >
                Remover
              </BotaoMini>
            ) : (
              <>
                {modo !== 'colar' && (
                  <BotaoMini
                    onClick={() => setModo('colar')}
                    disabled={ocupado}
                    icone="copiar"
                    titulo="Digitar o ctId à mão — só falha na hora do envio se estiver errado"
                  >
                    colar ctId
                  </BotaoMini>
                )}
                <BotaoMini
                  onClick={() => setModo(modo === 'criar' ? null : 'criar')}
                  disabled={ocupado}
                  icone={modo === 'criar' ? 'x' : 'mais'}
                  titulo="Cria a ação de conversão na conta do Google Ads"
                >
                  {modo === 'criar' ? 'Cancelar' : 'Criar ação'}
                </BotaoMini>
              </>
            )}
          </div>
        </td>
      </tr>

      {/* Criar no Google Ads: escrita real na conta, então abre por clique explícito. */}
      {modo === 'criar' && !mapeada && (
        <tr>
          <td colSpan={4} className="!pt-0">
            <div className="rounded-[10px] border border-azul-400/30 bg-azul-50 p-3 flex flex-wrap items-end gap-3 animate-surgir">
              <label className="flex flex-col gap-1 flex-1 min-w-[220px]">
                <Rotulo>Nome na conta do Google Ads</Rotulo>
                <input
                  type="text"
                  value={nomeNovo}
                  maxLength={80}
                  onChange={(e) => setNomeNovo(e.target.value)}
                  className={`${CAMPO} w-full`}
                />
              </label>
              <label className="flex flex-col gap-1 min-w-[180px]">
                <Rotulo>Meta (categoria)</Rotulo>
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
              <Botao variante="primario" icone="mais" carregando={ocupado} onClick={criarNoGoogle}>
                {ocupado ? 'Criando…' : 'Criar e mapear'}
              </Botao>
            </div>
          </td>
        </tr>
      )}

      {erro && (
        <tr>
          <td colSpan={4} className="!pt-0">
            <span className="flex items-center gap-1.5 text-[12.5px] text-perigo animate-aparecer">
              <Icone nome="alerta" className="w-4 h-4" />
              {erro}
            </span>
          </td>
        </tr>
      )}
    </Fragment>
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
function Especificas({ evento, regras, catalogo, metas, bases, disponiveis, aoSalvar }) {
  const [aberto, setAberto] = useState(false);
  const [escopo, setEscopo] = useState('oferta');
  const [alvo, setAlvo] = useState('');
  const [acaoId, setAcaoId] = useState('');
  const [valor, setValor] = useState('');
  const [base, setBase] = useState(evento.base_valor ?? 'total');
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
    setBase(evento.base_valor ?? 'total'); setCriando(false);
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
        base_valor: base,
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
      {/*
        * A explicação da ordem de resolução mora no "?" do cabeçalho, fora do
        * botão de abrir: botão dentro de botão é HTML inválido, e o toque no
        * "?" abriria a sanfona junto.
        */}
      <div className="flex items-center gap-2 pr-3.5">
        <button
          type="button"
          aria-expanded={aberto}
          onClick={() => setAberto((a) => !a)}
          className="flex-1 min-w-0 flex items-center gap-2 pl-3.5 py-2.5 bg-transparent border-0 cursor-pointer
                     text-left transition-colors hover:text-primario text-secundario"
        >
          <SetaSanfona aberta={aberto} />
          <span className="text-[13px] font-semibold truncate">
            Metas específicas por curso ou oferta
          </span>
          {regras.length > 0 && <Pill tom="sucesso">{regras.length}</Pill>}
        </button>
        <InfoDica
          largura={360}
          titulo="Vencem a regra do nível"
          texto="A ordem de resolução é oferta → curso → nível → geral: a primeira regra que casar vence. O valor daqui só entra quando o webhook não trouxer o preço real da matrícula. Uma meta específica só separa alguma coisa no Google Ads se tiver ação própria — apontar para a mesma ação da regra de nível cria uma linha aqui que não muda nada lá."
        />
      </div>

      {aberto && (
        <div className="px-3.5 pb-3.5 flex flex-col gap-3 animate-surgir">
          {regras.length > 0 && (
            <div className="overflow-x-auto rounded-[10px] border border-borda bg-superficie">
              <table className="tabela min-w-[600px]">
                <thead>
                  <tr>
                    <th className="w-[90px]">Escopo</th>
                    <th>Curso / oferta</th>
                    <th>Ação de conversão</th>
                    <th className="w-[110px] !text-right">Valor fixo</th>
                    <th className="w-[1%]"><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {regras.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Pill tom="azul">{r.escopo === 'oferta' ? 'oferta' : 'curso'}</Pill>
                      </td>
                      <td className="max-w-0">
                        <Dica conteudo={r.alvo_rotulo || r.alvo} className="w-full">
                          <span className="block truncate">{r.alvo_rotulo || r.alvo}</span>
                        </Dica>
                      </td>
                      <td className="max-w-0">
                        <Dica conteudo={r.conversion_action_nome || r.conversion_action_id} className="w-full">
                          <span className="block text-secundario truncate">
                            {r.conversion_action_nome || r.conversion_action_id}
                          </span>
                        </Dica>
                      </td>
                      <td className="tnum text-right">
                        {r.valor ? `R$ ${Number(r.valor).toFixed(2)}` : '—'}
                      </td>
                      <td>
                        <BotaoMini
                          onClick={() => remover(r.id)}
                          disabled={ocupado}
                          icone="lixeira"
                          variante="perigo"
                        >
                          Remover
                        </BotaoMini>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="rounded-[10px] border border-borda-forte bg-superficie p-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 min-w-[120px]">
              <Rotulo>Escopo</Rotulo>
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
            {/*
              * `div` e não `label`: o "?" do rótulo é um <button>, e dentro de
              * <label> ele viraria o controle rotulado — o clique no texto
              * acionaria a dica em vez de focar o campo. O campo leva `aria-label`.
              */}
            <div className="flex flex-col gap-1 flex-1 min-w-[220px]">
              <Rotulo dica="Digite para buscar pelo nome, ou cole o código direto.">
                {escopo === 'oferta' ? 'Oferta' : 'Curso'}
              </Rotulo>
              <span className="relative">
                <Icone
                  nome="busca"
                  className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-tenue pointer-events-none"
                />
                <input
                  type="text"
                  list={`alvos-${evento.id}-${escopo}`}
                  value={alvo}
                  onChange={(e) => setAlvo(e.target.value)}
                  placeholder={escopo === 'oferta' ? 'nome ou código da oferta' : 'nome ou código do curso'}
                  aria-label={`${escopo === 'oferta' ? 'Oferta' : 'Curso'} — digite para buscar`}
                  className={`${CAMPO} w-full !pl-8`}
                />
              </span>
              <datalist id={`alvos-${evento.id}-${escopo}`}>
                {opcoesAlvo.slice(0, 500).map((o) => (
                  <option key={o.v} value={o.v}>{o.r}</option>
                ))}
              </datalist>
            </div>

            {/*
              * `div` e não `label`: o alternador é um <button>, e conteúdo
              * interativo dentro de <label> é inválido — o clique no botão
              * escaparia para o controle rotulado e o focaria junto. Os dois
              * campos abaixo têm `aria-label` próprio, então nada se perde.
              */}
            <div className="flex flex-col gap-1 min-w-[200px] flex-1">
              {/*
                * O alternador fica NA LINHA DO RÓTULO, acima do campo.
                *
                * Embaixo ele lia como legenda do que já estava preenchido — e é
                * o contrário: é a escolha entre dois caminhos, que precisa ser
                * vista antes de mexer no campo, não depois.
                */}
              <span className="flex items-center justify-between gap-2">
                <Rotulo>Ação de conversão</Rotulo>
                <button
                  type="button"
                  onClick={() => { setCriando((v) => !v); setErro(''); }}
                  className="inline-flex items-center gap-1 text-[12.5px] font-medium text-azul-600 bg-transparent
                             border-0 p-0 cursor-pointer whitespace-nowrap hover:underline"
                >
                  <Icone nome={criando ? 'lista' : 'mais'} className="w-3.5 h-3.5" />
                  {criando ? 'escolher uma que já existe' : 'criar uma nova'}
                </button>
              </span>
              {criando ? (
                <input
                  type="text"
                  value={nomeNovo}
                  maxLength={80}
                  onChange={(e) => setNomeNovo(e.target.value)}
                  aria-label="Nome da nova ação no Google Ads"
                  className={`${CAMPO} w-full !border-azul-500`}
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
              <label className="flex flex-col gap-1 min-w-[160px] animate-aparecer">
                <Rotulo>Meta</Rotulo>
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

            {/*
              * A base do valor importa mais aqui do que na linha de nível.
              *
              * Meta específica existe para separar um curso do resto — e o que
              * separa de verdade é o preço dele. A oferta do Rubeus já guarda os
              * dois, então escolher a FONTE evita digitar cifra que envelhece no
              * dia em que o curso reajusta.
              */}
            <label className="flex flex-col gap-1 min-w-[170px]">
              <Rotulo>Valor enviado</Rotulo>
              <Select
                rotulo="Base do valor desta regra"
                valor={base}
                aoTrocar={setBase}
                opcoes={(bases?.length ? bases : BASES_PADRAO).map((b) => [b.id, b.rotulo])}
                className="w-full"
              />
            </label>

            {base === 'fixo' && (
              <label className="flex flex-col gap-1 w-[110px] animate-aparecer">
                <Rotulo>R$</Rotulo>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  placeholder="0,00"
                  className={`${CAMPO} w-full tnum text-right`}
                />
              </label>
            )}

            <Botao
              variante="primario"
              icone="mais"
              carregando={ocupado}
              onClick={() => (criando ? criarEAdicionar() : salvar())}
            >
              {ocupado
                ? (criando ? 'Criando…' : 'Salvando…')
                : (criando ? 'Criar e adicionar' : 'Adicionar')}
            </Botao>
          </div>

          {erro && (
            <span className="flex items-center gap-1.5 text-[12.5px] text-perigo animate-aparecer">
              <Icone nome="alerta" className="w-4 h-4" />
              {erro}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Botão pequeno, o mesmo em toda linha da tabela — a explicação vai na dica. */
function BotaoMini({ children, onClick, disabled, titulo, icone, variante = 'secundario' }) {
  return (
    <Dica conteudo={titulo}>
      <Botao tamanho="sm" variante={variante} icone={icone} onClick={onClick} disabled={disabled}>
        {children}
      </Botao>
    </Dica>
  );
}
