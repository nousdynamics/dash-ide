import { useCallback, useState } from 'react';
import {
  Atualizando, Botao, CabecalhoPagina, Cartao, CartaoKpi, Dica, Estado, EsqueletoPagina, Icone,
  InfoDica, Pill, Secao, Select, SetaSanfona, Switch, TituloSecao,
} from '../componentes/base';
import { MonitorConversoes } from './MonitorConversoes';
import { invalidar, useApi } from '../lib/api';
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
 * Google respondeu (o monitor, nas abas Resumo / Envios / Diagnóstico), depois
 * as duas engrenagens que alimentam a qualidade disso — a captura do clique no
 * site e a cópia na planilha —, que ficam numa aba própria.
 */

async function enviar(rota, corpo, metodo = 'POST') {
  const r = await fetch(rota, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.detalhe || dados.erro || `servidor respondeu ${r.status}`);
  // Gravou: o cache das rotas de conversão já não é verdade.
  invalidar('/api/conversoes');
  return dados;
}

/**
 * Botão com estado próprio — o mesmo padrão das outras telas de conversão.
 * O giro do `Botao` desabilita durante o POST: sem isso, o clique duplo criaria
 * duas planilhas.
 */
function Acao({ children, aoClicar, tom = 'neutro', titulo, icone }) {
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

  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <Dica conteudo={titulo}>
        <Botao
          variante={estado === 'erro' ? 'perigo' : tom === 'primario' ? 'primario' : 'secundario'}
          icone={estado === 'ok' ? 'check' : icone}
          carregando={estado === 'rodando'}
          onClick={rodar}
        >
          {estado === 'rodando' ? 'Aguarde…' : estado === 'ok' ? 'Feito' : children}
        </Botao>
      </Dica>
      {msg && (
        <span
          className={`text-[12.5px] max-w-[320px] break-all leading-snug animate-aparecer
            ${estado === 'erro' ? 'text-perigo' : 'text-secundario'}`}
        >
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
    <div className="flex flex-col gap-2 items-start">
      <Botao tamanho="sm" icone="busca" carregando={estado === 'rodando'} onClick={procurar}>
        {estado === 'rodando' ? 'Consultando…' : 'Procurar campo de click id no Rubeus'}
      </Botao>

      {r?.erro && <span className="text-[12.5px] text-perigo max-w-[360px] animate-aparecer">{r.erro}</span>}

      {r && !r.erro && (
        <div className="text-[13px] leading-relaxed max-w-[420px] animate-aparecer">
          {r.encontrado ? (
            <span className="inline-flex items-start gap-1.5 text-sucesso">
              <Icone nome="checkCirculo" className="w-4 h-4 shrink-0 mt-[2px]" />
              <span>
                Encontrado:{' '}
                {Object.entries(r.colunas).filter(([, v]) => v).map(([k, v]) => `${k} → ${v}`).join(', ')}
              </span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-secundario">
              Nenhum campo de click id entre os {r.campos_do_contato?.length ?? 0} campos do Contato.
              <InfoDica texto="O painel funciona sem ele — só não devolve o clique ao CRM." />
            </span>
          )}
          {r.campos_do_contato?.length > 0 && (
            <button
              type="button"
              onClick={() => setVerLista((v) => !v)}
              aria-expanded={verLista}
              className="flex items-center gap-1 mt-1.5 text-azul-600 hover:text-azul-700 bg-transparent border-0 p-0
                         cursor-pointer text-[13px] font-medium"
            >
              <SetaSanfona aberta={verLista} className="!text-azul-600" />
              {verLista ? 'Esconder' : 'Ver os campos que existem'}
            </button>
          )}
          {verLista && (
            <ul
              className="mt-1.5 text-secundario border border-borda rounded-[10px] bg-elevado/50 px-3 py-2
                         max-h-48 overflow-auto m-0 list-none flex flex-col gap-0.5 animate-surgir"
            >
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
      <Botao variante="primario" icone="raio" onClick={() => setAberto(true)} className="self-start">
        Adicionar ao GTM automaticamente
      </Botao>
    );
  }

  return (
    <div className="rounded-[12px] border border-azul-400/40 bg-superficie p-3 flex flex-col gap-2.5 animate-escala">
      <div className="text-[13.5px] font-semibold flex items-center gap-1.5">
        Instalar no contêiner
        <InfoDica
          texto="A tag entra como alteração pendente no workspace padrão, com acionamento em todas as páginas. O painel não publica o contêiner — publicar vale para o site inteiro e levaria junto rascunhos de outras pessoas. Você publica no GTM quando quiser."
          largura={340}
        />
      </div>

      {carregando && (
        <div className="text-[13px] text-secundario flex items-center gap-2">
          <span aria-hidden="true" className="w-3.5 h-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" />
          Buscando contêineres…
        </div>
      )}

      {erro && (
        <div className="text-[13px] text-perigo leading-relaxed flex items-start gap-2">
          <Icone nome="alerta" className="w-4 h-4 shrink-0 mt-[2px]" />
          <span>
            {erro}
            {/*
              * O 403 aqui é escopo, não permissão de contêiner — e a mensagem crua
              * do Google manda procurar no lugar errado.
              */}
            <span className="block text-secundario mt-1">
              Se for permissão do Google: o consentimento precisa incluir o Tag Manager. Refaça o
              consentimento local e republique o secret — ver README.
            </span>
          </span>
        </div>
      )}

      {!carregando && !erro && containers.length === 0 && (
        <div className="text-[13px] text-secundario">
          A conta conectada não enxerga nenhum contêiner web do Tag Manager.
        </div>
      )}

      {containers.length > 0 && (
        <>
          {containers.some((ct) => !ct.provavel) && (
            <div className="text-[13px] text-atencao leading-relaxed flex items-start gap-2 rounded-[10px] bg-atencao/8 px-2.5 py-2">
              <Icone nome="alerta" className="w-4 h-4 shrink-0 mt-[2px]" />
              <span>
                A conta enxerga contêineres de outras operações. Os marcados com ★ casam com os
                sites autorizados — confira antes de instalar.
              </span>
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
            <Botao variante="primario" icone="mais" carregando={estado === 'rodando'} onClick={instalar}>
              {estado === 'rodando' ? 'Instalando…' : 'Criar a tag'}
            </Botao>
            <Botao variante="fantasma" onClick={() => setAberto(false)}>
              Fechar
            </Botao>
          </div>
        </>
      )}

      {msg && (
        <div
          className={`text-[13px] leading-relaxed flex items-start gap-2 animate-aparecer
            ${estado === 'erro' ? 'text-perigo' : 'text-sucesso'}`}
        >
          <Icone nome={estado === 'erro' ? 'alerta' : 'checkCirculo'} className="w-4 h-4 shrink-0 mt-[2px]" />
          <span>
            {msg}
            {erroEscopo && (
              <span className="block text-secundario mt-1">
                Falta o escopo <span className="font-mono">tagmanager</span> na credencial.
              </span>
            )}
          </span>
        </div>
      )}

      {/* O aviso de "não publica" fica curto e visível; o porquê está no "?" acima. */}
      <div className="text-[12.5px] text-secundario border-t border-borda pt-2 flex items-center gap-1.5">
        <Icone nome="info" className="w-4 h-4 shrink-0 text-tenue" />
        O painel <strong className="text-primario font-semibold">não publica</strong> o contêiner — você publica no GTM.
      </div>
    </div>
  );
}

/** Código a colar, com o botão de copiar encostado. */
function Codigo({ codigo }) {
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
    <div className="relative">
      <code
        className="block text-[12.5px] font-mono bg-superficie border border-borda rounded-[10px]
                   px-3 py-2 pr-24 break-all select-all leading-relaxed"
      >
        {codigo}
      </code>
      <Botao
        tamanho="sm"
        icone={copiado ? 'check' : 'copiar'}
        onClick={copiar}
        className={`absolute top-1.5 right-1.5 ${copiado ? '!text-sucesso !border-sucesso/40' : ''}`}
      >
        {copiado ? 'Copiado' : 'Copiar'}
      </Botao>
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
  return (
    <div
      className={`rounded-[12px] border p-4 flex flex-col gap-3
        ${recomendado ? 'border-azul-400/40 bg-azul-50/60' : 'border-borda bg-elevado/50'}`}
    >
      <div className="flex items-center gap-2">
        <span className="text-[14px] font-semibold">{titulo}</span>
        {recomendado && <Pill tom="sucesso">recomendado</Pill>}
      </div>
      <ol className="text-[13px] text-secundario leading-relaxed list-decimal pl-5 m-0 flex flex-col gap-0.5">
        {passos.map((t) => <li key={t}>{t}</li>)}
      </ol>
      <Codigo codigo={codigo} />
    </div>
  );
}

/**
 * A aba "Captura e planilha": as duas engrenagens que decidem a qualidade do
 * que o monitor mostra. Recebe os dados de /api/conversoes já carregados.
 */
function Configuracao({ config, captura, script_url, trocarConfig, recarregar }) {
  const [manualAberto, setManualAberto] = useState(false);
  const tag = `<script src="${script_url}" async></script>`;

  return (
    <>
      {/* -------------------------------------------- captura do clique */}
      <Secao
        titulo="Captura do clique (gclid / gbraid / wbraid)"
        icone="clique"
        dica="É o que decide a coluna Atribuição do monitor. Com click id o Google liga a matrícula ao clique exato; sem ele a conversão sobe por e-mail, telefone ou CEP em hash, e o casamento é probabilístico."
      >
        <div className="grid gap-3 grade-kpi cascata">
          <CartaoKpi
            compacto
            rotulo="Cliques capturados"
            valor={captura?.total ?? 0}
            fmt={fmtInt}
            icone="clique"
            tom={captura?.total > 0 ? 'sucesso' : 'neutro'}
            dica="Click ids que o script do site capturou nos últimos 30 dias."
          />
          <CartaoKpi
            compacto
            rotulo="Cruzados com lead"
            valor={captura?.casados ?? 0}
            fmt={fmtInt}
            icone="pessoas"
            tom={captura?.casados > 0 ? 'sucesso' : 'neutro'}
            dica="Dos cliques capturados em 30 dias, quantos foram ligados a um lead do Rubeus."
          />
          <Cartao className="flex flex-col gap-3 justify-center !p-4">
            <Switch
              ligado={config.capturaLigada}
              aoTrocar={(v) => trocarConfig({ captura_ligada: v })}
              dica="Liga ou desliga o recebimento de click ids vindos do site."
            >
              {config.capturaLigada ? 'Captura ligada' : 'Captura desligada'}
            </Switch>
            <Switch
              ligado={config.escreverNoRubeus}
              aoTrocar={(v) => trocarConfig({ escrever_no_rubeus: v })}
              dica="Grava o click id capturado no campo do Contato no Rubeus."
            >
              {config.escreverNoRubeus ? 'Gravando no Rubeus' : 'Não grava no Rubeus'}
            </Switch>
          </Cartao>
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
          *
          * Fica visível (curto), com a explicação inteira no "?".
          */}
        <div
          className="flex items-start gap-2.5 rounded-[12px] border border-azul-400/30 bg-azul-50 px-3.5 py-2.5
                     text-[13.5px] leading-relaxed"
        >
          <Icone nome="info" className="w-[18px] h-[18px] shrink-0 mt-[2px] text-azul-600" />
          <span className="min-w-0">
            <strong className="font-semibold">Isto cobre só quem chega pelo site.</strong>{' '}
            <span className="text-secundario">
              Telefone, WhatsApp, indicação e feira seguem atribuídos por e-mail, telefone e CEP em hash.
            </span>{' '}
            <InfoDica
              largura={360}
              texto="Lead que entra por telefone, WhatsApp, indicação ou feira nunca teve um click id para capturar — é o desenho, não uma falha. Esses continuam sendo atribuídos por e-mail, telefone e CEP em hash, que é o caminho que já funciona para praticamente toda a base. O click id melhora a precisão de uma fatia; não é pré-requisito de nada."
            />
          </span>
        </div>

        {/* -------------------------------------------------- instalação */}
        <Cartao>
          <TituloSecao
            titulo="Instalar no site"
            icone="link"
            dica="Nos dois casos o script é o mesmo e o endereço do painel já vem embutido nele — dá para colar a tag por src sem configurar mais nada. Ele lê gclid, gbraid e wbraid da URL do anúncio, guarda por 90 dias em cookie de primeira parte, e só envia quando alguém preenche um formulário com e-mail ou telefone."
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/*
              * GTM primeiro, porque é o que esta conta já usa.
              *
              * Uma tag de HTML personalizado disparando em "All Pages" faz o
              * mesmo que colar no <head>, e passa pelo controle de versão e
              * publicação do próprio GTM — que é como o time já mexe no site.
              */}
            <div className="rounded-[12px] border border-azul-400/40 bg-azul-50/60 p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold">Pelo Google Tag Manager</span>
                <Pill tom="sucesso">recomendado</Pill>
                <InfoDica texto="O painel cria a tag no workspace padrão, com acionamento em todas as páginas. Você confere e publica o contêiner no GTM." />
              </div>
              <InstalarNoGtm />
              <div>
                <button
                  type="button"
                  onClick={() => setManualAberto((v) => !v)}
                  aria-expanded={manualAberto}
                  className="flex items-center gap-1.5 text-[13px] text-secundario hover:text-primario bg-transparent
                             border-0 p-0 cursor-pointer"
                >
                  <SetaSanfona aberta={manualAberto} />
                  ou fazer à mão
                </button>
                {manualAberto && (
                  <div className="mt-2 flex flex-col gap-2 animate-surgir">
                    <ol className="text-[13px] text-secundario leading-relaxed list-decimal pl-5 m-0 flex flex-col gap-0.5">
                      <li>Tags → Nova → HTML personalizado</li>
                      <li>Cole o código abaixo</li>
                      <li>Acionamento: All Pages (Todas as páginas)</li>
                      <li>Salvar e publicar o contêiner</li>
                    </ol>
                    <Codigo codigo={tag} />
                  </div>
                )}
              </div>
            </div>

            <BlocoInstalacao
              titulo="Direto no HTML"
              passos={[
                'Cole antes de </head> em todas as páginas',
                'Inclui as landing pages e a página do formulário',
              ]}
              codigo={tag}
            />
          </div>

          <div className="mt-4 pt-3 border-t border-borda flex items-start justify-between gap-4 flex-wrap">
            <div className="text-[13px] text-secundario flex items-center gap-1.5 min-w-0">
              <span className="shrink-0">Origens aceitas:</span>
              <Dica conteudo={config.origensPermitidas || null} largura={360}>
                <span className="font-mono text-[12.5px] text-primario truncate">{config.origensPermitidas || '—'}</span>
              </Dica>
              <InfoDica texto="Sites autorizados a mandar captura para o painel." />
            </div>
            <CampoNoRubeus />
          </div>
        </Cartao>
      </Secao>

      {/* ------------------------------------------- cópia na planilha */}
      <Secao
        titulo="Cópia na planilha"
        icone="lista"
        dica="Uma linha por conversão, inclusive as que não foram enviadas e o motivo. É a cópia que se cruza com o relatório do Google Ads quando os números não batem — por isso ela espera o veredito antes de escrever a linha."
      >
        <Cartao className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <span
              aria-hidden="true"
              className={`w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0
                ${config.planilhaId ? 'bg-sucesso/12 text-sucesso' : 'bg-elevado text-tenue'}`}
            >
              <Icone nome={config.planilhaId ? 'checkCirculo' : 'lista'} className="w-[18px] h-[18px]" />
            </span>
            <div className="min-w-0">
              <div className="text-[14px] font-semibold">
                {config.planilhaId ? 'Planilha conectada' : 'Nenhuma planilha ainda'}
              </div>
              <div className="text-[13px] text-secundario">
                {config.planilhaId ? 'Recebe uma linha por conversão.' : 'Crie para guardar a cópia de cada conversão.'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {config.planilhaUrl && (
              <a
                href={config.planilhaUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-[13px] font-medium px-3.5 py-[7px] rounded-[10px] border
                           border-borda-forte bg-superficie text-primario no-underline
                           hover:bg-superficie-hover hover:border-azul-400/40 transition-colors"
              >
                <Icone nome="externo" className="w-4 h-4" />
                Abrir a planilha
              </a>
            )}
            {!config.planilhaId && (
              <Acao
                tom="primario"
                icone="mais"
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
      </Secao>
    </>
  );
}

export function GoogleConversoes() {
  const [versao, setVersao] = useState(0);
  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  // `manter`: recarregar depois de mudar a configuração busca a mesma coisa de
  // novo — o monitor não pode ser desmontado (e perder os filtros) no meio.
  const { dados, erro, atualizando } = useApi('/api/conversoes', `google-conversoes-${versao}`, { manter: true });

  const cabecalho = (
    <CabecalhoPagina
      titulo="Google Conversões"
      icone="enviar"
      descricao="O que saiu daqui para o Google Ads, e o que o Google fez com aquilo. Para mudar quais etapas viram conversão, veja Conversões Ads."
    />
  );

  if (erro?.includes('403') || erro?.includes('sem_permissao')) {
    return (
      <>
        {cabecalho}
        <Cartao>
          <Estado
            titulo="Esta tela é restrita"
            icone="cadeado"
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
  if (!dados) return <>{cabecalho}<EsqueletoPagina kpis={6} graficos={2} /></>;

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
        * É o motivo de alguém abrir esta tela. As duas engrenagens — captura e
        * planilha — explicam a qualidade do que ele mostra, e por isso vêm
        * depois, na última aba: só se pergunta "por que a atribuição está
        * baixa" depois de ver que ela está baixa.
        */}
      <MonitorConversoes
        configuracao={
          <Atualizando ativo={atualizando} className="flex flex-col gap-4">
            <Configuracao
              config={config}
              captura={captura}
              script_url={script_url}
              trocarConfig={trocarConfig}
              recarregar={recarregar}
            />
          </Atualizando>
        }
      />
    </>
  );
}
