import { useEffect, useState } from 'react';
import { Cartao, Estado, Esqueleto, Pill, Select } from '../componentes/base';
import { GraficoAcumulado } from '../componentes/Graficos';
import { PainelLead } from '../componentes/PainelLead';
import { useApi } from '../lib/api';
import { fmtDataHora, fmtDec, fmtInt, iniciais } from '../lib/formato';

const PERIODOS = [
  ['7', 'Últimos 7 dias'],
  ['30', 'Últimos 30 dias'],
  ['90', 'Últimos 90 dias'],
  ['180', 'Últimos 180 dias'],
];

/**
 * Variação contra o período anterior, em texto solto.
 *
 * Sem fundo de chip, ao contrário do ChipDelta: dentro do cartão de etapa ele
 * ficaria como um segundo bloco disputando atenção com o número grande, que é
 * o que a pessoa foi ali ver. A seta e a cor bastam para dar a direção.
 */
function Variacao({ pct, abs, claro = false }) {
  if (pct === null || pct === undefined) {
    return <span className={`text-[11px] ${claro ? 'text-white/60' : 'text-tenue'}`}>sem base anterior</span>;
  }
  const seta = pct > 0 ? '↑' : pct < 0 ? '↓' : '→';
  const cor =
    pct === 0
      ? claro ? 'text-white/70' : 'text-tenue'
      : pct > 0
        ? 'text-sucesso'
        : 'text-perigo';
  const sinal = abs > 0 ? '+' : abs < 0 ? '−' : '';
  return (
    <span className={`text-[11px] font-semibold tnum ${cor}`}>
      {seta} {fmtDec(Math.abs(pct))}%{' '}
      <span className={claro ? 'text-white/70' : 'text-tenue'}>
        ({sinal}{fmtInt(Math.abs(abs))})
      </span>
    </span>
  );
}

/**
 * Seta de conversão entre duas etapas.
 *
 * O recorte em ponta não é enfeite: ele dá direção à leitura. Uma etiqueta
 * retangular entre dois cartões seria lida como um terceiro cartão.
 */
function SetaConversao({ pct, vertical = false }) {
  const rotulo = pct === null || pct === undefined ? '—' : `${fmtDec(pct)}%`;
  if (vertical) {
    return (
      <div className="flex items-center gap-2 py-[6px] pl-5">
        <span aria-hidden="true" className="w-px h-[14px] bg-borda-forte" />
        <span className="text-[11px] font-semibold text-azul-300 tnum">{rotulo}</span>
        <span className="text-[11px] text-tenue">de conversão para a etapa abaixo</span>
      </div>
    );
  }
  return (
    <div className="relative z-10 self-center shrink-0 -mx-[9px]">
      <span
        title={`${rotulo} de conversão desde a etapa anterior`}
        className="flex items-center justify-center h-[24px] pl-[9px] pr-[15px] text-[11px]
                   font-semibold tnum bg-base text-azul-300"
        style={{ clipPath: 'polygon(0 0, 70% 0, 100% 50%, 70% 100%, 0 100%)' }}
      >
        {rotulo}
      </span>
    </div>
  );
}

/** Esteira de etapas: cada cartão seleciona a etapa que o gráfico abaixo detalha. */
function Esteira({ etapas, maiorQueda, selecionada, aoSelecionar }) {
  return (
    <>
      {/* Larga demais para caber, rola dentro do próprio bloco — a página não. */}
      <div className="hidden md:block overflow-x-auto pb-1">
        <div className="flex items-stretch min-w-full">
          {etapas.map((e, i) => {
            const ativa = e.etapa === selecionada;
            return (
              <div key={e.etapa} className="flex items-stretch flex-1 min-w-[124px]">
                {i > 0 && <SetaConversao pct={e.taxa_desde_anterior_pct} />}
                <button
                  type="button"
                  onClick={() => aoSelecionar(e.etapa)}
                  aria-pressed={ativa}
                  className={`flex-1 min-w-0 flex flex-col justify-center rounded-[12px] px-3 py-4 text-center
                    cursor-pointer border transition-colors
                    focus-visible:outline-2 focus-visible:outline-azul-400 focus-visible:outline-offset-2
                    ${ativa
                      ? 'bg-azul-600 border-azul-500 text-white'
                      : 'bg-elevado border-transparent hover:bg-superficie-hover'}
                    ${!ativa && maiorQueda === e.etapa ? 'border-atencao' : ''}`}
                >
                  <div className={`text-[10px] font-semibold uppercase tracking-wide truncate
                                   ${ativa ? 'text-white/80' : 'text-secundario'}`}>
                    {e.etapa}
                  </div>
                  <div className="text-[24px] font-bold tnum leading-tight mt-[2px]">{fmtInt(e.total)}</div>
                  <div className="mt-1">
                    <Variacao pct={e.delta_pct} abs={e.delta_abs} claro={ativa} />
                  </div>
                  {maiorQueda === e.etapa && (
                    <span className={`block text-[10px] font-semibold mt-1 ${ativa ? 'text-white/80' : 'text-atencao'}`}>
                      maior queda
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="md:hidden flex flex-col">
        {etapas.map((e, i) => {
          const ativa = e.etapa === selecionada;
          return (
            <div key={e.etapa}>
              {i > 0 && <SetaConversao pct={e.taxa_desde_anterior_pct} vertical />}
              <button
                type="button"
                onClick={() => aoSelecionar(e.etapa)}
                aria-pressed={ativa}
                className={`w-full flex items-center justify-between gap-3 p-3 rounded-[12px] text-left
                  cursor-pointer border
                  ${ativa ? 'bg-azul-600 border-azul-500 text-white' : 'bg-elevado border-transparent'}
                  ${!ativa && maiorQueda === e.etapa ? 'border-atencao' : ''}`}
              >
                <div className="min-w-0">
                  <div className={`text-[11px] font-semibold ${ativa ? 'text-white/80' : 'text-secundario'}`}>
                    {e.etapa}
                  </div>
                  <div className="mt-px">
                    <Variacao pct={e.delta_pct} abs={e.delta_abs} claro={ativa} />
                  </div>
                </div>
                <div className="text-[19px] font-bold tnum shrink-0">{fmtInt(e.total)}</div>
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

/**
 * Curva acumulada da etapa selecionada.
 *
 * Em componente próprio para que trocar de etapa refaça só esta consulta — a
 * esteira e a lista de leads não mudam, e remontá-las piscaria a tela inteira.
 */
function CurvaDaEtapa({ funilId, etapa, dias }) {
  const { dados, carregando, erro } = useApi(
    `/api/funil/serie?dias=${dias}` +
      (funilId ? `&funil_id=${encodeURIComponent(funilId)}` : '') +
      (etapa ? `&etapa=${encodeURIComponent(etapa)}` : ''),
    `serie-${funilId}-${etapa}-${dias}`,
  );

  if (erro) return <Cartao><Estado tipo="erro" titulo="Não foi possível carregar a curva" mensagem={erro} /></Cartao>;
  if (carregando || !dados) return <Esqueleto linhas={6} />;

  const novos = dados.serie.reduce((a, d) => a + d.novos, 0);

  return (
    <GraficoAcumulado
      titulo={`${fmtInt(novos)} lead(s) em ${etapa}`}
      subtitulo={`Acumulado no período · ${fmtInt(dados.total_anterior)} no período anterior`}
      dados={dados.serie}
      rotuloAtual="Período atual"
      rotuloAnterior="Período anterior"
    />
  );
}

/**
 * Cartões de lead do funil selecionado.
 *
 * Fica aqui, e não na tela de webhooks: quem olha o funil quer ver quem está
 * dentro dele. A tela de webhooks é de configuração, não de operação.
 */
function LeadsDoFunil({ funilId, aoAbrir }) {
  const [busca, setBusca] = useState('');
  const [aplicada, setAplicada] = useState('');
  const { dados, carregando } = useApi(
    `/api/funil/leads${funilId ? `?funil_id=${encodeURIComponent(funilId)}` : ''}`,
    `leads-${funilId}`,
  );

  useEffect(() => {
    const t = setTimeout(() => setAplicada(busca), 250);
    return () => clearTimeout(t);
  }, [busca]);

  if (carregando || !dados) return <Esqueleto linhas={4} />;

  const termo = aplicada.trim().toLowerCase();
  const itens = termo
    ? dados.itens.filter(
        (l) =>
          (l.contato_nome || '').toLowerCase().includes(termo) ||
          String(l.contato_id).includes(termo),
      )
    : dados.itens;

  if (!dados.itens.length) {
    return (
      <Estado
        titulo="Nenhum lead neste funil ainda"
        mensagem="Os leads aparecem assim que o Rubeus disparar eventos para o webhook deste funil."
      />
    );
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar lead por nome ou id…"
          aria-label="Buscar lead"
          className="bg-superficie text-primario border border-borda-forte rounded-[8px]
                     px-2 py-[5px] text-xs flex-1 min-w-[200px]"
        />
        <span className="text-[11px] text-tenue tnum">
          {itens.length} de {dados.itens.length} lead(s)
        </span>
      </div>

      <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
        {itens.map((l) => (
          <button
            key={l.contato_id}
            type="button"
            onClick={() => aoAbrir(l.contato_id)}
            className="text-left bg-superficie border border-borda rounded-[12px] p-3
                       hover:bg-superficie-hover hover:border-borda-forte cursor-pointer
                       focus-visible:outline-2 focus-visible:outline-azul-400"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-7 h-7 rounded-full bg-azul-700 text-white flex items-center
                               justify-center text-[10px] font-semibold shrink-0">
                {iniciais(l.contato_nome)}
              </span>
              <span className="text-xs font-semibold truncate">
                {l.contato_nome || `Contato ${l.contato_id}`}
              </span>
            </div>
            <div className="mt-2">
              <Pill tom="sucesso">{l.etapa}</Pill>
            </div>
            <div className="text-[11px] text-tenue mt-2">
              {l.eventos} evento(s) · {fmtDataHora(l.registrado_em)}
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

/**
 * O funil é sempre de UM processo. Somar processos produz taxa acima de 100%:
 * cada processo usa um conjunto diferente de etapas, e uma etapa que existe em
 * dois deles acumula mais contatos que a etapa anterior, que existe só em um.
 */
export function Funil() {
  const [funil, setFunil] = useState(null);
  const [dias, setDias] = useState('30');
  const [etapaSel, setEtapaSel] = useState(null);
  const [leadAberto, setLeadAberto] = useState(null);
  const { dados, carregando, erro } = useApi(
    `/api/funil?dias=${dias}${funil ? `&funil_id=${encodeURIComponent(funil)}` : ''}`,
    `${funil}-${dias}`,
  );

  const cabecalho = (
    <div>
      <div className="text-[19px] font-semibold tracking-tight">Funil de leads</div>
      <div className="text-tenue text-xs mt-[2px]">
        Etapas descobertas a partir dos eventos do Rubeus · comparado com o período anterior
      </div>
    </div>
  );

  if (erro) return <>{cabecalho}<Cartao><Estado tipo="erro" titulo="Não foi possível carregar" mensagem={erro} /></Cartao></>;
  if (carregando || !dados) return <>{cabecalho}<Esqueleto /></>;

  const funis = dados.funis_disponiveis || [];
  // Na primeira visita assume o funil com mais leads.
  if (!funil && funis.length) {
    setFunil(String(funis[0].id));
    return <>{cabecalho}<Esqueleto /></>;
  }

  const comDado = dados.etapas.filter((e) => e.total > 0);
  /*
   * A etapa do gráfico segue a seleção enquanto ela existir neste recorte.
   * Trocar de funil ou de período pode fazer a etapa escolhida sumir; nesse
   * caso cai no topo do funil, que é o começo natural da leitura.
   */
  const etapa = comDado.some((e) => e.etapa === etapaSel) ? etapaSel : comDado[0]?.etapa ?? null;

  return (
    <>
      {cabecalho}

      <Cartao>
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="text-[13px] font-semibold">Etapas do Rubeus</div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select rotulo="Período" valor={dias} aoTrocar={setDias} opcoes={PERIODOS} />
            {funis.length > 0 && (
              <Select
                rotulo="Filtrar por funil"
                valor={funil ?? ''}
                aoTrocar={(v) => setFunil(v)}
                opcoes={funis.map((f) => [String(f.id), `${f.nome} (${fmtInt(f.leads)})`])}
              />
            )}
          </div>
        </div>

        {comDado.length ? (
          <>
            <Esteira
              etapas={dados.etapas}
              maiorQueda={dados.etapa_maior_queda}
              selecionada={etapa}
              aoSelecionar={setEtapaSel}
            />
            <div className="text-[11px] text-tenue mt-3 leading-relaxed">
              O número é de contatos distintos que passaram pela etapa; a seta entre os cartões é a
              conversão desde a etapa anterior, e a variação embaixo compara com os {dias} dias
              anteriores. Clique numa etapa para ver a curva dela.
            </div>
          </>
        ) : (
          <Estado
            titulo="Nenhum lead neste recorte"
            mensagem="Cole o link deste funil no Rubeus, em Funis e webhooks. As etapas aparecem sozinhas conforme os eventos chegam."
          />
        )}
      </Cartao>

      {etapa && <CurvaDaEtapa funilId={funil} etapa={etapa} dias={dias} />}

      <Cartao>
        <div className="text-[13px] font-semibold mb-3">Leads deste funil</div>
        <LeadsDoFunil funilId={funil} aoAbrir={setLeadAberto} />
      </Cartao>

      {leadAberto && (
        <PainelLead contatoId={leadAberto} aoFechar={() => setLeadAberto(null)} />
      )}
    </>
  );
}
