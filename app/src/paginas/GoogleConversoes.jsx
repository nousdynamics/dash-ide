import { useCallback, useState } from 'react';
import { Cartao, Estado, Esqueleto, Pill, Switch } from '../componentes/base';
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
            <div className="text-[13px] font-semibold">Captura do clique no site (gclid)</div>
            <div className="text-[11px] text-tenue mt-1 max-w-[640px] leading-relaxed">
              É o que decide a coluna <strong className="text-secundario">Atribuição</strong> acima.
              Sem gclid a conversão sobe por e-mail, telefone ou CEP em hash, e o casamento é
              probabilístico; com gclid o Google liga a matrícula ao clique exato.
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

        <div className="mt-3 pt-3 border-t border-borda grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-3 items-start">
          <div className="min-w-0">
            <div className="text-[12px] font-semibold mb-1">Tag do site</div>
            <code className="block text-[11px] font-mono bg-elevado border border-borda rounded-[8px]
                             px-2 py-[6px] break-all select-all">
              {`<script src="${script_url}" async></script>`}
            </code>
            <div className="text-[11px] text-tenue mt-2">
              Origens aceitas: <span className="font-mono">{config.origensPermitidas || '—'}</span>
            </div>
          </div>

          <div className="flex flex-col gap-2 items-start lg:items-end shrink-0">
            <div className="flex items-center gap-2">
              <Pill tom={captura?.total > 0 ? 'sucesso' : 'neutro'}>
                {fmtInt(captura?.total ?? 0)} clique(s) / 30d
              </Pill>
              <Pill tom={captura?.casados > 0 ? 'sucesso' : 'neutro'}>
                {fmtInt(captura?.casados ?? 0)} cruzado(s)
              </Pill>
            </div>
            <Acao
              titulo="Reconsulta os campos personalizados do Rubeus"
              aoClicar={async () => {
                const r = await fetch('/api/conversoes/campo-rubeus?forcar=1').then((x) => x.json());
                return r.encontrado
                  ? `Campo: ${Object.entries(r.colunas).filter(([, v]) => v).map(([k, v]) => `${k} → ${v}`).join(', ')}`
                  : 'Nenhum campo gclid no Rubeus ainda.';
              }}
            >
              Procurar campo gclid no Rubeus
            </Acao>
          </div>
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
