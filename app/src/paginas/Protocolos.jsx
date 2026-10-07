import { useState } from 'react';
import {
  Atualizando,
  BarraProporcao,
  CabecalhoPagina,
  Cartao,
  CartaoKpi,
  Dica,
  Estado,
  EsqueletoPagina,
  Icone,
  Pill,
  Secao,
  Switch,
  TituloSecao,
} from '../componentes/base';
import { BarraFiltros } from '../componentes/BarraFiltros';
import { PainelLead } from '../componentes/PainelLead';
import { invalidar, useApi } from '../lib/api';
import { queryPeriodo, resolverPeriodo } from '../lib/periodo';
import { fmtDataHora, fmtDec, fmtDiaMes, fmtInt } from '../lib/formato';

/**
 * Protocolos do WhatsApp: o clique no botão do site, a conversa e o lead.
 *
 * O script do site (GTM) acrescenta `[Protocolo: IDE-XXXXXX]` à mensagem pronta
 * do botão e grava o código com a origem da visita. Quando a mensagem chega no
 * atendimento, o webhook da ferramenta (Blip) liga o código ao telefone, e o
 * telefone liga ao lead do Rubeus. Ver src/lib/protocolos.ts.
 *
 * Os degraus vêm separados porque cada um quebra por um motivo diferente: sem
 * protocolo gerado, o problema é o site; gerado sem conversa, é a ferramenta
 * de atendimento; conversa sem lead, é o Rubeus que ainda não tem o contato.
 */

/** O D1 grava `datetime('now')` em UTC sem fuso; sem o Z o navegador leria como hora local. */
const utc = (s) => (s && !/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? `${s.replace(' ', 'T')}Z` : s);
const taxa = (a, b) => (b > 0 ? `${fmtDec((a / b) * 100)}%` : '—');

function SituacaoWebhook({ webhook }) {
  if (!webhook) return <Pill ponto tom="atencao">Webhook não cadastrado — rode a migration 0043</Pill>;
  if (!webhook.tem_link) {
    return (
      <Pill ponto tom="atencao" dica="Gere o link em Funis e webhooks (WhatsApp · Mensagem recebida) e cole na ferramenta de atendimento.">
        Sem link gerado
      </Pill>
    );
  }
  if (!webhook.total_recebido) {
    return <Pill ponto tom="neutro" dica="O link existe, mas a ferramenta de atendimento ainda não mandou nenhuma mensagem.">Aguardando 1ª mensagem</Pill>;
  }
  return (
    <Pill ponto tom="sucesso" dica={`Última mensagem: ${fmtDataHora(utc(webhook.ultimo_uso_em))}`}>
      <span className="tnum">{fmtInt(webhook.total_recebido)}</span> mensagens recebidas
    </Pill>
  );
}

function Configuracao({ dados, aoTrocar }) {
  return (
    <Secao
      titulo="Instalação"
      icone="engrenagem"
      dica="O carimbo vai pela mesma tag do GTM da captura do clique. Ligar muda a mensagem que o aluno vê; vale em até 1 hora para quem já está com o site aberto."
    >
      <Cartao className="flex flex-col gap-3">
        <div className="flex items-center gap-3 flex-wrap justify-between">
          <Switch
            ligado={dados.ligado}
            desativado={!dados.admin}
            aoTrocar={aoTrocar}
            dica={dados.admin
              ? 'Acrescenta [Protocolo: IDE-XXXXXX] à mensagem dos botões de WhatsApp do site.'
              : 'Só quem administra o painel liga ou desliga.'}
          >
            {dados.ligado ? 'Protocolo na mensagem: ligado' : 'Protocolo na mensagem: desligado'}
          </Switch>
          <SituacaoWebhook webhook={dados.webhook} />
        </div>
        <p className="text-[12.5px] text-secundario leading-relaxed m-0">
          Leitura das mensagens: <code>POST /webhook/whatsapp/evento/mensagem?t=…</code>. Feito para o Blip,
          mas aceita qualquer ferramenta: basta mandar o corpo da mensagem recebida, ou{' '}
          <code>{'{ "telefone": "5581…", "texto": "… [Protocolo: IDE-XXXXXX]" }'}</code>.
        </p>
      </Cartao>
    </Secao>
  );
}

function Tabela({ linhas, aoAbrirLead }) {
  if (!linhas.length) return <Estado icone="mensagem" mensagem="Nenhum protocolo encontrado." />;
  return (
    <div className="overflow-x-auto">
      <table className="tabela">
        <thead>
          <tr>
            <th>Protocolo</th>
            <th>Clique</th>
            <th>Origem</th>
            <th><Dica conteudo="Quando a mensagem com o código chegou no atendimento."><span>Conversa</span></Dica></th>
            <th><Dica conteudo="Etapa do evento mais recente do Rubeus para esse telefone."><span>Lead / etapa</span></Dica></th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((p) => (
            <tr key={p.codigo}>
              <td className="font-mono text-[13px] font-semibold whitespace-nowrap">{p.codigo}</td>
              <td className="text-secundario whitespace-nowrap">
                <Dica conteudo={p.pagina || '—'}>
                  <span className="tnum">{fmtDataHora(utc(p.gerado_em))}</span>
                </Dica>
              </td>
              <td>
                <div className="text-[13px]">{p.utm_campaign || p.canal_nome}</div>
                {p.utm_campaign && <div className="text-[12px] text-tenue">{p.canal_nome}</div>}
              </td>
              <td className="whitespace-nowrap">
                {p.telefone ? (
                  <>
                    <div className="text-[13px] tnum">{fmtDataHora(utc(p.mensagem_em))}</div>
                    <div className="text-[12px] text-tenue">{p.contato_nome || `…${p.telefone.slice(-4)}`}</div>
                  </>
                ) : (
                  <span className="text-tenue">Não chegou</span>
                )}
              </td>
              <td>
                {p.contato_id ? (
                  <button
                    type="button"
                    onClick={() => aoAbrirLead(p.contato_id)}
                    className="text-left bg-transparent border-0 p-0 cursor-pointer group"
                  >
                    <div className="text-[13px] font-medium group-hover:text-azul-400">{p.lead_nome || p.contato_id}</div>
                    <div className="text-[12px] text-secundario">{p.etapa}{p.funil ? ` · ${p.funil}` : ''}</div>
                  </button>
                ) : (
                  <span className="text-tenue">{p.telefone ? 'Não está no Rubeus' : '—'}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Protocolos({ filtro, setFiltro }) {
  const [busca, setBusca] = useState('');
  const [versao, setVersao] = useState(0);
  const [leadAberto, setLeadAberto] = useState(null);
  const [erroTroca, setErroTroca] = useState(null);

  const p = queryPeriodo(filtro);
  const q = busca.trim().length >= 3 ? `&q=${encodeURIComponent(busca.trim())}` : '';
  const caminho = `/api/protocolos?${p}${q}`;
  const { dados, carregando, atualizando, erro } = useApi(caminho, `${caminho}#${versao}`, { manter: true });
  const { de, ate } = resolverPeriodo(filtro);

  const trocar = async (ligado) => {
    setErroTroca(null);
    const r = await fetch('/api/protocolos/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ligado }),
    });
    if (!r.ok) setErroTroca(`Não foi possível gravar (servidor respondeu ${r.status}).`);
    invalidar('/api/protocolos');
    setVersao((v) => v + 1);
  };

  const cabecalho = (
    <>
      <CabecalhoPagina
        titulo="Protocolos do WhatsApp"
        icone="mensagem"
        subtitulo={q ? `Busca: ${busca.trim()}` : `${fmtDiaMes(de)} a ${fmtDiaMes(ate)}`}
        descricao="Cada clique no botão de WhatsApp do site gera um protocolo na mensagem pronta. Quando a mensagem chega no atendimento, o protocolo liga a conversa à origem do clique e ao lead do Rubeus."
      />
      <BarraFiltros filtro={filtro} aoTrocar={setFiltro} />
    </>
  );

  if (erro) return (<>{cabecalho}<Cartao><Estado tipo="erro" titulo="Não foi possível carregar" mensagem={erro} /></Cartao></>);
  if (carregando || !dados) return (<>{cabecalho}<EsqueletoPagina kpis={3} graficos={0} tabela /></>);

  const { resumo } = dados;
  const nomeCanal = Object.fromEntries(dados.canais.map((c) => [c.canal, c.nome]));
  const linhas = dados.protocolos.map((l) => ({ ...l, canal_nome: nomeCanal[l.canal] || l.canal || 'Direto' }));
  const maior = Math.max(1, ...dados.canais.map((c) => c.gerados));

  return (
    <>
      {cabecalho}
      <Atualizando ativo={atualizando} className="flex flex-col gap-5">
        <Configuracao dados={dados} aoTrocar={trocar} />
        {erroTroca && <Cartao><Estado tipo="erro" mensagem={erroTroca} /></Cartao>}

        <Secao titulo="Do clique ao lead" icone="funil" dica="Cada degrau quebra por um motivo diferente: site, ferramenta de atendimento ou Rubeus.">
          <div className="grid gap-3 grade-kpi cascata">
            <CartaoKpi rotulo="Cliques no botão" valor={resumo.gerados} fmt={fmtInt} icone="clique"
              dica="Protocolos gerados pelo script do site." />
            <CartaoKpi rotulo="Viraram conversa" valor={resumo.conversas} fmt={fmtInt} icone="mensagem"
              dica="A mensagem com o protocolo chegou no atendimento.">
              <span className="text-[12.5px] text-secundario tnum">{taxa(resumo.conversas, resumo.gerados)} dos cliques</span>
            </CartaoKpi>
            <CartaoKpi rotulo="Estão no Rubeus" valor={resumo.leads} fmt={fmtInt} icone="pessoas" tom="sucesso"
              dica="O telefone da conversa existe no Rubeus (com ou sem o nono dígito).">
              <span className="text-[12.5px] text-secundario tnum">{taxa(resumo.leads, resumo.conversas)} das conversas</span>
            </CartaoKpi>
          </div>
        </Secao>

        {dados.canais.length > 0 && (
          <Cartao>
            <TituloSecao titulo="Por origem do clique" icone="alvo" dica="Canal da visita no momento do clique, pela mesma regra da tela Origens." />
            <div className="overflow-x-auto">
              <table className="tabela">
                <thead><tr><th>Canal</th><th className="text-right!">Cliques</th><th className="text-right!">Conversas</th><th className="text-right!">No Rubeus</th></tr></thead>
                <tbody>
                  {dados.canais.map((c) => (
                    <tr key={c.canal}>
                      <td className="font-medium">{c.nome}</td>
                      <td className="text-right tnum min-w-[110px]">
                        <div className="font-semibold">{fmtInt(c.gerados)}</div>
                        <div className="mt-1.5 ml-auto w-full max-w-[90px]"><BarraProporcao pct={(c.gerados / maior) * 100} altura="h-[5px]" /></div>
                      </td>
                      <td className="text-right tnum text-secundario">{fmtInt(c.conversas)}</td>
                      <td className="text-right tnum text-secundario">{fmtInt(c.leads)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Cartao>
        )}

        <Cartao>
          <div className="flex items-center gap-2 flex-wrap justify-between pb-3 mb-3 border-b border-borda">
            <TituloSecao titulo="Protocolos" icone="lista" className="!mb-0" extra={<span className="tnum">{fmtInt(linhas.length)}</span>} />
            <label className="relative inline-flex items-center w-[240px] max-w-full">
              <Icone nome="busca" className="w-4 h-4 absolute left-2.5 text-tenue pointer-events-none" />
              <input
                type="search"
                placeholder="Código ou telefone…"
                aria-label="Buscar protocolo por código ou telefone"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="w-full bg-superficie text-primario border border-borda-forte rounded-[9px]
                           pl-8 pr-2.5 py-[6px] text-[13px] hover:border-azul-400/50 transition-colors"
              />
            </label>
          </div>
          {resumo.gerados === 0 && !q ? (
            <Estado
              icone="mensagem"
              titulo="Nenhum protocolo neste período"
              mensagem={dados.ligado
                ? 'O interruptor está ligado. Os protocolos aparecem quando alguém clicar num botão de WhatsApp de uma página com a tag do GTM — e em até 1 hora para quem já estava com o site aberto.'
                : 'O protocolo está desligado: os botões de WhatsApp do site continuam com a mensagem original.'}
            />
          ) : (
            <Tabela linhas={linhas} aoAbrirLead={setLeadAberto} />
          )}
        </Cartao>
      </Atualizando>

      {leadAberto && <PainelLead contatoId={leadAberto} aoFechar={() => setLeadAberto(null)} />}
    </>
  );
}
