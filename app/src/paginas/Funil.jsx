import { useEffect, useState } from 'react';
import { Cartao, Estado, Esqueleto, Pill, Select } from '../componentes/base';
import { PainelLead } from '../componentes/PainelLead';
import { useApi } from '../lib/api';
import { fmtDataHora, fmtDec, fmtInt, iniciais } from '../lib/formato';

/**
 * O funil é sempre de UM processo. Somar processos produz taxa acima de 100%:
 * cada processo usa um conjunto diferente de etapas, e uma etapa que existe em
 * dois deles acumula mais contatos que a etapa anterior, que existe só em um.
 */
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

export function Funil() {
  const [funil, setFunil] = useState(null);
  const [leadAberto, setLeadAberto] = useState(null);
  const { dados, carregando, erro } = useApi(
    `/api/funil?dias=90${funil ? `&funil_id=${encodeURIComponent(funil)}` : ''}`,
    funil ?? 'inicial',
  );

  const cabecalho = (
    <div>
      <div className="text-[19px] font-semibold tracking-tight">Funil de leads</div>
      <div className="text-tenue text-xs mt-[2px]">
        Etapas descobertas a partir dos eventos do Rubeus · últimos 90 dias
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

  return (
    <>
      {cabecalho}
      <Cartao>
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="text-[13px] font-semibold">Etapas do Rubeus</div>
          {funis.length > 0 && (
            <Select
              rotulo="Filtrar por funil"
              valor={funil ?? ''}
              aoTrocar={setFunil}
              opcoes={funis.map((f) => [String(f.id), `${f.nome} (${fmtInt(f.leads)})`])}
            />
          )}
        </div>

        {comDado.length ? (
          <>
            <div className="hidden md:flex items-stretch">
              {dados.etapas.map((e, i) => (
                <div key={e.etapa} className="flex items-stretch flex-1">
                  {i > 0 && (
                    <div className="flex flex-col items-center justify-center px-2 min-w-[56px]">
                      <span className="text-tenue text-sm" aria-hidden="true">→</span>
                      <span className="text-[11px] font-semibold text-azul-300 tnum">
                        {e.taxa_desde_anterior_pct === null ? '—' : `${fmtDec(e.taxa_desde_anterior_pct)}%`}
                      </span>
                    </div>
                  )}
                  <div
                    className={`flex-1 flex flex-col justify-center bg-elevado rounded-[12px] p-4 text-center
                      ${dados.etapa_maior_queda === e.etapa ? 'border border-atencao' : ''}`}
                  >
                    <div className="text-[22px] font-bold tnum">{fmtInt(e.total)}</div>
                    <div className="text-[11px] text-secundario mt-1">{e.etapa}</div>
                    {dados.etapa_maior_queda === e.etapa && (
                      <span className="block text-[10px] text-atencao font-semibold mt-1">maior queda</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="md:hidden flex flex-col">
              {dados.etapas.map((e, i) => (
                <div key={e.etapa}>
                  {i > 0 && (
                    <div className="flex items-center gap-2 py-[6px] pl-5">
                      <span className="w-px h-[14px] bg-borda-forte" />
                      <span className="text-[11px] font-semibold text-azul-300 tnum">
                        {e.taxa_desde_anterior_pct === null ? '—' : `${fmtDec(e.taxa_desde_anterior_pct)}%`}
                      </span>
                    </div>
                  )}
                  <div
                    className={`flex items-center justify-between p-3 bg-elevado rounded-[12px]
                      ${dados.etapa_maior_queda === e.etapa ? 'border border-atencao' : ''}`}
                  >
                    <div>
                      <div className="text-[11px] text-secundario">{e.etapa}</div>
                      {dados.etapa_maior_queda === e.etapa && (
                        <span className="text-[10px] text-atencao font-semibold">maior queda</span>
                      )}
                    </div>
                    <div className="text-[17px] font-bold tnum">{fmtInt(e.total)}</div>
                  </div>
                </div>
              ))}
            </div>

            {dados.etapa_maior_queda && (
              <div className="text-xs text-secundario mt-3">
                Maior queda entre etapas: <strong>{dados.etapa_maior_queda}</strong>
              </div>
            )}
          </>
        ) : (
          <Estado
            titulo="Nenhum lead neste recorte"
            mensagem="Cole o link deste funil no Rubeus, em Funis e webhooks. As etapas aparecem sozinhas conforme os eventos chegam."
          />
        )}
      </Cartao>

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
