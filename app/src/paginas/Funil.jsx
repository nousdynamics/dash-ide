import { useState } from 'react';
import { Cartao, Estado, Esqueleto, Select } from '../componentes/base';
import { useApi } from '../lib/api';
import { fmtDec, fmtInt } from '../lib/formato';

/**
 * O funil é sempre de UM processo. Somar processos produz taxa acima de 100%:
 * cada processo usa um conjunto diferente de etapas, e uma etapa que existe em
 * dois deles acumula mais contatos que a etapa anterior, que existe só em um.
 */
export function Funil() {
  const [funil, setFunil] = useState(null);
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
    </>
  );
}
