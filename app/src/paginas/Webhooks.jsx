import { useEffect, useRef, useState } from 'react';
import {
  Atualizando,
  Botao,
  BotaoIcone,
  CabecalhoPagina,
  Cartao,
  Dica,
  Estado,
  EsqueletoPagina,
  Icone,
  InfoDica,
  Pill,
  Secao,
  TituloSecao,
} from '../componentes/base';
import { invalidar, useApi } from '../lib/api';
import { fmtDataHora, fmtInt } from '../lib/formato';

const ROTULO_CANAL = { rubeus: 'Rubeus', evolution: 'Evolution API', n8n: 'n8n', whatsapp: 'WhatsApp' };

const ROTULO_EVENTO = {
  geral: 'Geral — recebe tudo',
  registro_processo: 'Novo registro de processo',
  ocorrencia_evento: 'Ocorrência de um evento',
  contato_criacao: 'Criação de contato',
  contato_edicao: 'Edição de contato',
  atividade_criacao: 'Criação de atividade',
  atividade_edicao: 'Edição de atividade',
  // Mensagem recebida no atendimento (Blip): lê o protocolo do botão do site.
  mensagem: 'Mensagem recebida (protocolo)',
};

const DESCRICAO_TELA =
  'Um link por funil e por canal. O banco guarda só o hash do token, então o link aparece uma única vez, ao ser gerado. Os leads recebidos ficam em Funil de vendas.';

const DICA_NOVO_FUNIL =
  'O funil nasce com os três canais e sem link: clique em gerar no canal que for usar. As etapas não são cadastradas aqui — são descobertas a partir dos eventos que o Rubeus enviar. Um link por funil, usado em todas as etapas dele: nos gatilhos que permitem escolher o processo — novo registro de processo e ocorrência de um evento — use o link do funil correspondente. Evento que chegar sem etapa é gravado assim mesmo e aparece marcado no histórico do lead, para nenhum se perder.';

const DICA_POR_EVENTO =
  'Para os gatilhos que NÃO deixam escolher o processo. Os que deixam — novo registro de processo e ocorrência de um evento — usam o link do funil, mais abaixo. O "Geral" aceita qualquer payload e nunca recusa: o que ele não souber interpretar fica guardado cru no histórico do lead, para ser tratado depois. Use enquanto o formato de um gatilho ainda não é conhecido.';

/** Onde o cache de leitura desta tela mora — esquecido depois de cada gravação. */
const ROTA_FUNIS = '/api/funis';

/**
 * Situação de um webhook numa pílula com ponto: sem link, esperando o
 * primeiro evento, ou já recebendo. O detalhe (quando foi o último) vai na
 * dica para a pílula caber ao lado do nome.
 */
function StatusWebhook({ w }) {
  if (!w.tem_link) {
    return (
      <Pill ponto tom="atencao" dica="Nenhum link gerado para este canal ainda. Gere e cole no sistema de origem.">
        Sem link
      </Pill>
    );
  }
  if (w.total_recebido > 0) {
    return (
      <Pill
        ponto
        tom="sucesso"
        dica={w.ultimo_uso_em ? `Último evento: ${fmtDataHora(w.ultimo_uso_em)}` : 'Recebendo eventos'}
      >
        <span className="tnum">{fmtInt(w.total_recebido)}</span> evento{w.total_recebido === 1 ? '' : 's'}
      </Pill>
    );
  }
  return (
    <Pill ponto tom="neutro" dica="O link existe, mas nenhum evento chegou por ele ainda.">
      Aguardando 1º evento
    </Pill>
  );
}

/**
 * Caminho do webhook em campo monoespaçado, com botão de copiar.
 *
 * Copia só o caminho — o token não existe em claro no banco, então não há
 * como reexibi-lo. O link completo vai para a área de transferência uma única
 * vez, no botão de gerar; este aqui serve para conferir qual rota é qual.
 */
function CampoCaminho({ caminho }) {
  const [copiado, setCopiado] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(caminho);
      setCopiado(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopiado(false), 1800);
    } catch {
      /* Sem permissão de área de transferência: o caminho continua visível para copiar à mão. */
    }
  };

  return (
    <div className="flex items-center gap-2 min-w-0">
      <Dica conteudo={caminho} className="flex-1 min-w-0">
        <code
          tabIndex={0}
          className="block w-full min-w-0 truncate font-mono text-[12.5px] text-secundario
                     bg-elevado border border-borda rounded-[9px] px-2.5 py-[7px]"
        >
          {caminho}
        </code>
      </Dica>
      <span className="relative shrink-0">
        <BotaoIcone
          aoClicar={copiar}
          icone={copiado ? 'check' : 'copiar'}
          titulo={copiado ? 'Copiado' : 'Copiar caminho (sem o token — o link completo só aparece ao gerar)'}
        />
        {copiado && (
          <span
            role="status"
            className="absolute -top-7 left-1/2 -translate-x-1/2 animate-escala pointer-events-none
                       px-2 py-0.5 rounded-full bg-sucesso text-white text-[12px] font-semibold whitespace-nowrap"
          >
            Copiado
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * Botão de gerar link.
 *
 * Não existe "copiar" o link completo: o banco guarda só o hash do token,
 * então não há valor a reexibir. Quem gera recebe a URL uma vez, na resposta,
 * e ela vai direto para a área de transferência — nunca chega a ser desenhada
 * na tela.
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
      invalidar(ROTA_FUNIS);
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
      <span className="flex items-center gap-2 flex-wrap shrink-0 animate-escala">
        <span className="text-atencao text-[12.5px] font-medium flex items-center gap-1">
          <Icone nome="alerta" className="w-4 h-4" />
          Invalida o link atual
        </span>
        <Botao variante="perigo" tamanho="sm" onClick={gerar}>
          Gerar mesmo assim
        </Botao>
        <Botao variante="fantasma" tamanho="sm" onClick={() => setConfirmando(false)}>
          Cancelar
        </Botao>
      </span>
    );
  }

  if (estado === 'copiado') {
    return (
      <span className="shrink-0 animate-escala">
        <Pill
          tom="sucesso"
          dica="A URL completa foi para a área de transferência. Cole no sistema de origem agora — ela não será exibida de novo."
        >
          <Icone nome="check" className="w-3.5 h-3.5" traco={2.4} />
          URL copiada
        </Pill>
      </span>
    );
  }

  if (estado === 'erro') {
    return (
      <span className="shrink-0 animate-escala">
        <Pill tom="perigo" dica="O servidor recusou ou a área de transferência não estava disponível. Tente de novo.">
          <Icone nome="x" className="w-3.5 h-3.5" traco={2.4} />
          Falhou
        </Pill>
      </span>
    );
  }

  return (
    <Botao
      variante={jaTemLink ? 'secundario' : 'primario'}
      tamanho="sm"
      icone={jaTemLink ? 'atualizar' : 'link'}
      carregando={estado === 'gerando'}
      onClick={() => (jaTemLink ? setConfirmando(true) : gerar())}
      className="shrink-0"
    >
      {estado === 'gerando' ? 'Gerando…' : jaTemLink ? 'Gerar novo link' : 'Gerar link'}
    </Botao>
  );
}

/** Um canal de um funil: nome, situação, caminho e o botão de gerar. */
function LinhaWebhook({ titulo, destaque, w, rota, aoGerar }) {
  return (
    <div className="flex flex-col gap-2 py-3 border-t border-borda first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className={`text-[13.5px] font-semibold flex items-center gap-1.5 min-w-0 ${destaque ? 'text-azul-600' : ''}`}>
          {destaque && <Icone nome="estrela" className="w-4 h-4" />}
          <span className="truncate">{titulo}</span>
        </span>
        <StatusWebhook w={w} />
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex-1 min-w-0">
          <CampoCaminho caminho={w.caminho} />
        </div>
        <BotaoGerar rota={rota} jaTemLink={w.tem_link} aoGerar={aoGerar} />
      </div>
    </div>
  );
}

/** Resumo do funil no cabeçalho do cartão: quantos canais já têm link. */
function StatusFunil({ webhooks }) {
  const total = webhooks.length;
  const comLink = webhooks.filter((w) => w.tem_link).length;
  const recebendo = webhooks.some((w) => w.total_recebido > 0);
  if (!total) return <Pill ponto tom="neutro">Sem canais</Pill>;
  if (!comLink) {
    return (
      <Pill ponto tom="atencao" dica="Nenhum canal tem link gerado — o funil ainda não recebe nada.">
        Sem links
      </Pill>
    );
  }
  return (
    <Pill
      ponto
      tom={recebendo ? 'sucesso' : 'azul'}
      dica={`${comLink} de ${total} canais com link gerado${recebendo ? ', já recebendo eventos' : ', nenhum evento ainda'}.`}
    >
      <span className="tnum">
        {comLink}/{total}
      </span>{' '}
      ativos
    </Pill>
  );
}

export function Webhooks() {
  const [versao, setVersao] = useState(0);
  const [nome, setNome] = useState('');
  const [erroForm, setErroForm] = useState(null);
  const [criando, setCriando] = useState(false);
  const [removendo, setRemovendo] = useState(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [sync, setSync] = useState(null);
  // `manter`: depois de gerar um link o formato da resposta é o mesmo — não há por que piscar o esqueleto.
  const { dados, carregando, atualizando, erro } = useApi(ROTA_FUNIS, `funis-${versao}`, { manter: true });

  const recarregar = () => {
    invalidar(ROTA_FUNIS);
    setVersao((v) => v + 1);
  };

  const syncRubeus = async () => {
    setSincronizando(true);
    setSync(null);
    try {
      const r = await fetch('/api/admin/rubeus/sync', { method: 'POST' });
      const c = await r.json().catch(() => ({}));
      // A sincronização mexe em cursos, ofertas e etapas — dado que várias telas leem.
      invalidar();
      if (!r.ok) {
        setSync({ ok: false, msg: c.detalhe || 'Falha na sincronização' });
        return;
      }
      setSync({
        ok: true,
        msg: `${c.cursos?.cursos ?? 0} cursos, ${c.cursos?.ofertas ?? 0} ofertas e ${c.etapas?.etapas ?? 0} etapas sincronizados.`,
      });
    } catch {
      setSync({ ok: false, msg: 'Não foi possível falar com o servidor.' });
    } finally {
      setSincronizando(false);
    }
  };

  const criar = async (e) => {
    e.preventDefault();
    setErroForm(null);
    setCriando(true);
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
    } finally {
      setCriando(false);
    }
  };

  const remover = async (funilId) => {
    setRemovendo(funilId);
    try {
      await fetch(`/api/funis/${funilId}`, { method: 'DELETE' });
    } finally {
      setRemovendo(null);
      recarregar();
    }
  };

  const cabecalho = (
    <CabecalhoPagina
      titulo="Funis e webhooks"
      icone="link"
      descricao={DESCRICAO_TELA}
      acoes={
        <Dica conteudo="Busca no Rubeus a lista atual de cursos, ofertas e etapas e atualiza o catálogo do painel.">
          <Botao icone="atualizar" carregando={sincronizando} onClick={syncRubeus}>
            {sincronizando ? 'Sincronizando…' : 'Sincronizar Rubeus'}
          </Botao>
        </Dica>
      }
    />
  );

  const avisoSync = sync && (
    <div
      role="status"
      className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-[12px] border text-[13px] animate-surgir
        ${sync.ok ? 'bg-sucesso/8 border-sucesso/30 text-sucesso' : 'bg-perigo/8 border-perigo/30 text-perigo'}`}
    >
      <Icone nome={sync.ok ? 'checkCirculo' : 'alerta'} className="w-[18px] h-[18px]" />
      <span className="flex-1 min-w-0 font-medium">{sync.msg}</span>
      <button
        type="button"
        onClick={() => setSync(null)}
        aria-label="Fechar aviso"
        className="w-7 h-7 rounded-[8px] border-0 bg-transparent text-current opacity-70 hover:opacity-100
                   flex items-center justify-center cursor-pointer"
      >
        <Icone nome="x" className="w-4 h-4" />
      </button>
    </div>
  );

  /* 403 não é falha: é a resposta certa para quem não administra webhooks. */
  if (erro?.includes('403') || erro?.includes('sem_permissao')) {
    return (
      <>
        {cabecalho}
        <Cartao>
          <Estado
            icone="cadeado"
            titulo="Esta tela é restrita"
            mensagem="Ela emite as credenciais que autorizam o Rubeus e a Evolution a gravar no banco, por isso fica com quem administra a integração. As telas de resultado continuam abertas para você."
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

  const porEvento = [...(dados.por_evento ?? [])].sort((a, b) =>
    a.evento === 'geral' ? -1 : b.evento === 'geral' ? 1 : a.evento.localeCompare(b.evento),
  );

  return (
    <>
      {cabecalho}
      {avisoSync}

      <Atualizando ativo={atualizando} className="flex flex-col gap-4">
        <Cartao>
          <TituloSecao titulo="Novo funil" icone="mais" dica={DICA_NOVO_FUNIL} />
          <form onSubmit={criar} className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Nome do novo funil…"
              aria-label="Nome do novo funil"
              className="bg-superficie text-primario border border-borda-forte rounded-[10px] px-3 py-[7px] text-[13.5px]
                         flex-1 min-w-[180px] transition-colors hover:border-azul-400/50
                         focus:outline-none focus:border-azul-500 focus:ring-2 focus:ring-azul-400/25"
            />
            <Botao
              type="submit"
              variante="primario"
              icone="mais"
              carregando={criando}
              disabled={nome.trim().length < 2}
            >
              Adicionar funil
            </Botao>
          </form>
          {erroForm && (
            <div role="alert" className="mt-2 text-[13px] text-perigo flex items-center gap-1.5 animate-surgir">
              <Icone nome="alerta" className="w-4 h-4" />
              {erroForm}
            </div>
          )}
        </Cartao>

        {porEvento.length > 0 && (
          <Secao
            titulo="Webhooks por tipo de evento"
            icone="raio"
            dica={DICA_POR_EVENTO}
            extra={<span className="tnum">{porEvento.length}</span>}
          >
            <div className="grid gap-3 lg:grid-cols-2 cascata">
              {porEvento.map((w) => (
                <Cartao key={w.id} className={w.evento === 'geral' ? 'lg:col-span-2 border-azul-400/40' : ''}>
                  <LinhaWebhook
                    titulo={`${ROTULO_CANAL[w.canal] || w.canal} · ${ROTULO_EVENTO[w.evento] || w.evento}`}
                    destaque={w.evento === 'geral'}
                    w={w}
                    rota={`/api/funis/token-evento/${w.id}`}
                    aoGerar={recarregar}
                  />
                </Cartao>
              ))}
            </div>
          </Secao>
        )}

        <Secao
          titulo="Funis"
          icone="funil"
          dica="Cada funil tem um link por canal (Rubeus, Evolution API, n8n). Desativar preserva o histórico de leads."
          extra={<span className="tnum">{dados.itens.length}</span>}
        >
          {dados.itens.length === 0 ? (
            <Cartao>
              <Estado
                icone="funil"
                titulo="Nenhum funil cadastrado"
                mensagem="Crie o primeiro funil acima para gerar os links de webhook."
              />
            </Cartao>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2 cascata">
              {dados.itens.map((f) => (
                <Cartao key={f.id} className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="w-9 h-9 rounded-[10px] bg-azul-400/14 text-azul-600 flex items-center justify-center shrink-0"
                      >
                        <Icone nome="funil" className="w-[18px] h-[18px]" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Dica conteudo={f.nome} className="min-w-0">
                            <span className="text-[15px] font-semibold truncate">{f.nome}</span>
                          </Dica>
                          <StatusFunil webhooks={f.webhooks} />
                        </div>
                        <Dica conteudo="Identificador do funil na URL do webhook">
                          <span className="text-[12px] text-tenue font-mono">{f.slug}</span>
                        </Dica>
                      </div>
                    </div>
                    <Dica conteudo="Desativa o funil; o histórico de leads é preservado">
                      <Botao
                        variante="perigo"
                        tamanho="sm"
                        icone="lixeira"
                        carregando={removendo === f.id}
                        onClick={() => remover(f.id)}
                      >
                        Desativar
                      </Botao>
                    </Dica>
                  </div>
                  {f.webhooks.length ? (
                    <div className="flex flex-col">
                      {f.webhooks.map((w) => (
                        <LinhaWebhook
                          key={w.canal}
                          titulo={ROTULO_CANAL[w.canal] || w.canal}
                          w={w}
                          rota={`/api/funis/${f.id}/regerar/${w.canal}`}
                          aoGerar={recarregar}
                        />
                      ))}
                    </div>
                  ) : (
                    <Estado icone="link" titulo="Nenhum webhook gerado para este funil" />
                  )}
                </Cartao>
              ))}
            </div>
          )}
        </Secao>
      </Atualizando>
    </>
  );
}
