import { useCallback, useState } from 'react';
import { Cartao, Estado, Esqueleto, Pill, Select, Switch } from '../componentes/base';
import { MonitorConversoes } from './MonitorConversoes';
import { useApi } from '../lib/api';
import { fmtInt } from '../lib/formato';

/**
 * Google Conversões — o resultado, separado da configuração.
 *
 * A tela de Conversões Ads responde "o que vai ser enviado": qual etapa dispara
 * qual evento, e para qual ação do Google cada nível de ensino manda. É uma
 * tela de instalação, mexida raramente e por quem administra a conta.
 *
 * Esta responde "o que saiu, e o que o Google fez com aquilo" — pergunta de
 * todo dia, feita por quem lê o painel. Estavam juntas, e a segunda ficava
 * abaixo de quatro blocos de configuração: para conferir o envio de ontem era
 * preciso rolar por decisões que ninguém ia tomar naquele momento.
 *
 * A ordem aqui segue o caminho do dado: primeiro o que foi enviado e como o
 * Google respondeu (o monitor), depois as duas engrenagens que alimentam a
 * qualidade disso — a captura do clique no site e a cópia na planilha.
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

/** Botão com estado próprio — o mesmo padrão das outras telas de conversão. */
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
    <span className="inline-flex items-center gap-2 flex-wrap">
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

/**
 * O campo de click id no Rubeus: existe? E, se não, o que existe?
 *
 * Um "não encontrado" seco não resolve o caso mais comum — a pessoa criou o
 * campo e o painel não achou. As causas são sempre de cadastro: criado em
 * Oportunidade em vez de Contato, ou com um nome que não contém "gclid"
 * ("ID do clique", "Google Click"). Listar o que de fato está lá responde as
 * duas de uma vez, sem precisar abrir o Rubeus para conferir.
 */
function CampoNoRubeus() {
  const [r, setR] = useState(null);
  const [estado, setEstado] = useState('pronto');
  const [verLista, setVerLista] = useState(false);

  const procurar = async () => {
    setEstado('rodando');
    try {
      const d = await fetch('/api/conversoes/campo-rubeus?forcar=1').then((x) => x.json());
      setR(d);
      setEstado(d.erro ? 'erro' : 'ok');
    } catch (e) {
      setR({ erro: e.message });
      setEstado('erro');
    }
  };

  return (
    <div className="flex flex-col gap-1.5 items-start lg:items-end">
      <button
        type="button"
        onClick={procurar}
        disabled={estado === 'rodando'}
        className="text-[11px] px-2 py-[5px] rounded-[8px] border border-borda-forte bg-superficie
                   text-secundario hover:bg-superficie-hover hover:text-primario cursor-pointer
                   disabled:opacity-50"
      >
        {estado === 'rodando' ? 'Consultando…' : 'Procurar campo de click id no Rubeus'}
      </button>

      {r?.erro && <span className="text-[10px] text-perigo max-w-[300px]">{r.erro}</span>}

      {r && !r.erro && (
        <div className="text-[10px] leading-relaxed lg:text-right max-w-[320px]">
          {r.encontrado ? (
            <span className="text-sucesso">
              Encontrado:{' '}
              {Object.entries(r.colunas).filter(([, v]) => v).map(([k, v]) => `${k} → ${v}`).join(', ')}
            </span>
          ) : (
            <span className="text-tenue">
              Nenhum campo de click id entre os {r.campos_do_contato?.length ?? 0} campos do Contato.
              O painel funciona sem ele — só não devolve o clique ao CRM.
            </span>
          )}
          {r.campos_do_contato?.length > 0 && (
            <button
              type="button"
              onClick={() => setVerLista((v) => !v)}
              className="block ml-auto mt-1 text-azul-600 bg-transparent border-0 p-0 cursor-pointer text-[10px]"
            >
              {verLista ? 'esconder' : 'ver os campos que existem'}
            </button>
          )}
          {verLista && (
            <ul className="mt-1 text-tenue lg:text-left border-t border-borda pt-1 max-h-40 overflow-auto">
              {r.campos_do_contato.map((f) => (
                <li key={f.coluna} className="truncate">{f.nome}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Instala a tag no GTM sem sair do painel.
 *
 * Faz os cinco passos manuais — criar a tag de HTML personalizado, apontar o
 * acionamento de todas as páginas, nomear, anotar e salvar — e para antes do
 * sexto. **Não publica o contêiner**: a publicação vale para o site inteiro e
 * levaria junto qualquer rascunho que outra pessoa tenha deixado no workspace.
 * Fica onde já estava, com quem já decide isso.
 *
 * A lista de contêineres só é buscada quando alguém abre o bloco: são duas
 * chamadas ao Google por conta, e a maioria de quem passa por esta tela veio
 * conferir o monitor, não instalar tag.
 */
function InstalarNoGtm() {
  const [aberto, setAberto] = useState(false);
  const [container, setContainer] = useState('');
  const [estado, setEstado] = useState('pronto');
  const [msg, setMsg] = useState('');
  const [erroEscopo, setErroEscopo] = useState(false);

  const { dados, carregando, erro } = useApi(aberto ? '/api/conversoes/gtm' : null, `gtm-${aberto}`);
  const containers = dados?.itens ?? [];

  const instalar = async () => {
    if (!container) return setMsg('Escolha o contêiner.');
    setEstado('rodando');
    setMsg('');
    setErroEscopo(false);
    try {
      const r = await enviar('/api/conversoes/gtm', { container });
      setEstado('ok');
      setMsg(r.criada
        ? 'Tag criada no workspace padrão. Falta publicar o contêiner no GTM.'
        : 'A tag já existia e foi atualizada. Falta publicar o contêiner no GTM.');
    } catch (e) {
      setEstado('erro');
      setErroEscopo(/Tag Manager|escopo|permissão/i.test(e.message || ''));
      setMsg(e.message);
    }
  };

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="text-[11px] px-3 py-[6px] rounded-[8px] border border-azul-500 bg-azul-600
                   text-white hover:bg-azul-500 cursor-pointer"
      >
        Adicionar ao GTM automaticamente
      </button>
    );
  }

  return (
    <div className="rounded-[8px] border border-azul-500/40 bg-superficie p-2.5 flex flex-col gap-2">
      <div className="text-[11px] font-semibold">Instalar no contêiner</div>

      {carregando && <div className="text-[11px] text-tenue">Buscando contêineres…</div>}

      {erro && (
        <div className="text-[11px] text-perigo leading-relaxed">
          {erro}
          {/*
            * O 403 aqui é escopo, não permissão de contêiner — e a mensagem crua
            * do Google manda procurar no lugar errado.
            */}
          <div className="text-tenue mt-1">
            Se for permissão do Google: o consentimento precisa incluir o Tag Manager. Refaça o
            consentimento local e republique o secret — ver README.
          </div>
        </div>
      )}

      {!carregando && !erro && containers.length === 0 && (
        <div className="text-[11px] text-tenue">
          A conta conectada não enxerga nenhum contêiner web do Tag Manager.
        </div>
      )}

      {containers.length > 0 && (
        <>
          {containers.some((ct) => !ct.provavel) && (
            <div className="text-[10px] text-atencao leading-relaxed">
              A conta Google enxerga contêineres de outras operações. Os marcados com ★ casam com os
              sites autorizados a mandar captura — confira antes de instalar.
            </div>
          )}
          <Select
            rotulo="Contêiner do Tag Manager"
            valor={container}
            aoTrocar={setContainer}
            opcoes={[
              ['', '— escolher contêiner —'],
              /*
                * A marca nos prováveis não é enfeite: esta conta Google enxerga
                * contêineres de outros clientes, e instalar a tag no lugar
                * errado publica código nosso no site de terceiro.
                */
              ...containers.map((ct) => [
                ct.path,
                `${ct.provavel ? '★ ' : ''}${ct.publicId} · ${ct.nome} (${ct.conta})`,
              ]),
            ]}
            className="w-full"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              disabled={estado === 'rodando'}
              onClick={instalar}
              className="text-[11px] px-3 py-[6px] rounded-[8px] border border-azul-500 bg-azul-600
                         text-white hover:bg-azul-500 cursor-pointer
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {estado === 'rodando' ? 'Instalando…' : 'Criar a tag'}
            </button>
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="text-[11px] px-2 py-[5px] rounded-[8px] border border-borda-forte
                         bg-superficie text-secundario hover:text-primario cursor-pointer"
            >
              Fechar
            </button>
          </div>
        </>
      )}

      {msg && (
        <div className={`text-[11px] leading-relaxed ${estado === 'erro' ? 'text-perigo' : 'text-sucesso'}`}>
          {msg}
          {erroEscopo && (
            <span className="block text-tenue mt-1">
              Falta o escopo <span className="font-mono">tagmanager</span> na credencial.
            </span>
          )}
        </div>
      )}

      <div className="text-[10px] text-tenue leading-relaxed border-t border-borda pt-2">
        A tag entra como alteração pendente no <strong className="text-secundario">workspace
        padrão</strong>, com acionamento em todas as páginas. O painel{' '}
        <strong className="text-secundario">não publica</strong> o contêiner — publicar vale para o
        site inteiro e levaria junto rascunhos de outras pessoas. Você publica no GTM quando quiser.
      </div>
    </div>
  );
}

/**
 * Um caminho de instalação: os passos e o código a colar.
 *
 * "Copiar" em vez de só `select-all` porque o destino é o campo de outra
 * ferramenta — no GTM, colar meio código é um erro que só aparece semanas
 * depois, quando a atribuição não melhora e ninguém lembra da tag.
 */
function BlocoInstalacao({ titulo, passos, codigo, recomendado = false }) {
  const [copiado, setCopiado] = useState(false);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      /* sem permissão de área de transferência: o código continua selecionável */
    }
  };

  return (
    <div className={`rounded-[10px] border p-3 ${recomendado ? 'border-azul-500/40 bg-azul-600/5' : 'border-borda bg-elevado/50'}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[12px] font-semibold">{titulo}</span>
        {recomendado && <Pill tom="sucesso">recomendado</Pill>}
      </div>
      <ol className="text-[11px] text-tenue leading-relaxed list-decimal pl-4 mb-2 flex flex-col gap-0.5">
        {passos.map((t) => <li key={t}>{t}</li>)}
      </ol>
      <div className="relative">
        <code className="block text-[10px] font-mono bg-superficie border border-borda rounded-[8px]
                         px-2 py-[6px] pr-16 break-all select-all">
          {codigo}
        </code>
        <button
          type="button"
          onClick={copiar}
          className="absolute top-1 right-1 text-[10px] px-2 py-[3px] rounded-[6px] border
                     border-borda-forte bg-superficie text-secundario hover:text-primario
                     cursor-pointer"
        >
          {copiado ? 'copiado' : 'copiar'}
        </button>
      </div>
    </div>
  );
}

export function GoogleConversoes() {
  const [versao, setVersao] = useState(0);
  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  const { dados, carregando, erro } = useApi('/api/conversoes', `google-conversoes-${versao}`);

  const cabecalho = (
    <div className="min-w-0">
      <div className="text-[19px] font-semibold tracking-tight">Google Conversões</div>
      <div className="text-tenue text-xs mt-[2px] max-w-[760px] leading-relaxed">
        O que saiu daqui para o Google Ads, e o que o Google fez com aquilo. Para mudar
        quais etapas viram conversão, veja <strong className="text-secundario">Conversões Ads</strong>.
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
            mensagem="Ela mostra dado de lead e o que foi enviado à conta de anúncios. Fica com quem administra."
          />
        </Cartao>
      </>
    );
  }
  if (erro) {
    return (
      <>
        {cabecalho}
        <Cartao><Estado tipo="erro" titulo="Não foi possível carregar" mensagem={erro} /></Cartao>
      </>
    );
  }
  if (carregando || !dados) return <>{cabecalho}<Esqueleto linhas={6} /></>;

  const { config, captura, script_url } = dados;

  const trocarConfig = async (mudanca) => {
    await enviar('/api/conversoes/config', mudanca, 'PUT');
    recarregar();
  };

  return (
    <>
      {cabecalho}

      {/*
        * O monitor primeiro.
        *
        * É o motivo de alguém abrir esta tela. As duas engrenagens abaixo —
        * captura e planilha — explicam a qualidade do que ele mostra, e por isso
        * vêm depois: só se pergunta "por que a atribuição está baixa" depois de
        * ver que ela está baixa.
        */}
      <MonitorConversoes />

      {/* -------------------------------------------- captura do clique */}
      <Cartao>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">Captura do clique (gclid / gbraid / wbraid)</div>
            <div className="text-[11px] text-tenue mt-1 max-w-[680px] leading-relaxed">
              É o que decide a coluna <strong className="text-secundario">Atribuição</strong> acima.
              Com click id o Google liga a matrícula ao clique exato; sem ele a conversão sobe por
              e-mail, telefone ou CEP em hash, e o casamento é probabilístico.
            </div>
          </div>
          <div className="flex flex-col gap-2 items-end shrink-0">
            <Switch ligado={config.capturaLigada} aoTrocar={(v) => trocarConfig({ captura_ligada: v })}>
              {config.capturaLigada ? 'Captura ligada' : 'Captura desligada'}
            </Switch>
            <Switch ligado={config.escreverNoRubeus} aoTrocar={(v) => trocarConfig({ escrever_no_rubeus: v })}>
              {config.escreverNoRubeus ? 'Gravando no Rubeus' : 'Não grava no Rubeus'}
            </Switch>
          </div>
        </div>

        {/*
          * A expectativa, dita antes de ensinar a instalar.
          *
          * O click id só existe no navegador de quem clicou no anúncio. Lead que
          * chega por telefone, WhatsApp, indicação ou feira nunca vai ter um — e
          * isso não é falha da captura, é o desenho. Sem dizer isso aqui, a
          * primeira leitura da coluna "Atribuição" vira caça a um defeito que
          * não existe, e o caminho que de fato melhora esses leads — e-mail,
          * telefone e CEP em hash — parece o plano B quando é o principal.
          */}
        <div className="mt-3 pt-3 border-t border-borda text-[11px] text-tenue leading-relaxed max-w-[760px]">
          <strong className="text-secundario">Isto cobre só quem chega pelo site.</strong>{' '}
          Lead que entra por telefone, WhatsApp, indicação ou feira nunca teve um click id para
          capturar — é o desenho, não uma falha. Esses continuam sendo atribuídos por e-mail,
          telefone e CEP em hash, que é o caminho que já funciona para praticamente toda a base.
          O click id melhora a precisão de uma fatia; não é pré-requisito de nada.
        </div>

        {/* -------------------------------------------------- instalação */}
        <div className="mt-3 pt-3 border-t border-borda">
          <div className="text-[12px] font-semibold mb-2">Instalar no site</div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/*
              * GTM primeiro, porque é o que esta conta já usa.
              *
              * Uma tag de HTML personalizado disparando em "All Pages" faz o
              * mesmo que colar no <head>, e passa pelo controle de versão e
              * publicação do próprio GTM — que é como o time já mexe no site.
              */}
            <div className="rounded-[10px] border border-azul-500/40 bg-azul-600/5 p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[12px] font-semibold">Pelo Google Tag Manager</span>
                <Pill tom="sucesso">recomendado</Pill>
              </div>
              <div className="text-[11px] text-tenue leading-relaxed mb-2">
                O painel cria a tag no workspace padrão, com acionamento em todas as páginas.
                Você confere e publica o contêiner no GTM.
              </div>
              <InstalarNoGtm />
              <details className="mt-2">
                <summary className="text-[10px] text-tenue cursor-pointer select-none">
                  ou fazer à mão
                </summary>
                <ol className="text-[11px] text-tenue leading-relaxed list-decimal pl-4 mt-1.5 mb-2 flex flex-col gap-0.5">
                  <li>Tags → Nova → HTML personalizado</li>
                  <li>Cole o código abaixo</li>
                  <li>Acionamento: All Pages (Todas as páginas)</li>
                  <li>Salvar e publicar o contêiner</li>
                </ol>
                <code className="block text-[10px] font-mono bg-superficie border border-borda rounded-[8px]
                                 px-2 py-[6px] break-all select-all">
                  {`<script src="${script_url}" async></script>`}
                </code>
              </details>
            </div>

            <BlocoInstalacao
              titulo="Direto no HTML"
              passos={[
                'Cole antes de </head> em todas as páginas',
                'Inclui as landing pages e a página do formulário',
              ]}
              codigo={`<script src="${script_url}" async></script>`}
            />
          </div>

          <div className="text-[11px] text-tenue mt-2 leading-relaxed max-w-[760px]">
            Nos dois casos o script é o mesmo e o endereço do painel já vem embutido nele — dá para
            colar a tag por <span className="font-mono">src</span> sem configurar mais nada. Ele lê{' '}
            <span className="font-mono">gclid</span>, <span className="font-mono">gbraid</span> e{' '}
            <span className="font-mono">wbraid</span> da URL do anúncio, guarda por 90 dias em cookie
            de primeira parte, e só envia quando alguém preenche um formulário com e-mail ou telefone.
          </div>

          <div className="text-[11px] text-tenue mt-2">
            Origens aceitas: <span className="font-mono">{config.origensPermitidas || '—'}</span>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-borda flex items-center gap-3 flex-wrap">
          <Pill tom={captura?.total > 0 ? 'sucesso' : 'neutro'}>
            {fmtInt(captura?.total ?? 0)} clique(s) capturado(s) / 30d
          </Pill>
          <Pill tom={captura?.casados > 0 ? 'sucesso' : 'neutro'}>
            {fmtInt(captura?.casados ?? 0)} cruzado(s) com lead
          </Pill>
          <span className="ml-auto">
            <CampoNoRubeus />
          </span>
        </div>
      </Cartao>

      {/* ------------------------------------------- cópia na planilha */}
      <Cartao>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">Cópia na planilha</div>
            <div className="text-[11px] text-tenue mt-1 max-w-[640px] leading-relaxed">
              Uma linha por conversão, inclusive as que <strong className="text-secundario">não</strong>{' '}
              foram enviadas e o motivo. É a cópia que se cruza com o relatório do Google Ads quando
              os números não batem — por isso ela espera o veredito antes de escrever a linha.
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
    </>
  );
}
