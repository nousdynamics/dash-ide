import { useState } from 'react';
import {
  Abas,
  Atualizando,
  BarraProporcao,
  CabecalhoPagina,
  Cartao,
  CartaoKpi,
  Dica,
  Estado,
  EsqueletoPagina,
  Secao,
  TituloSecao,
} from '../componentes/base';
import { BarraFiltros } from '../componentes/BarraFiltros';
import { useApi } from '../lib/api';
import { queryPeriodo, resolverPeriodo } from '../lib/periodo';
import { fmtDec, fmtDiaMes, fmtInt } from '../lib/formato';

/**
 * Origens dos leads: de que canal veio quem preencheu formulário.
 *
 * Os três canais que o time acompanha ficam em destaque e separados — Google
 * Ads, Meta Ads e links com UTM divulgados organicamente. Cada pessoa conta uma
 * vez, no canal do último toque (ver src/routes/origens.ts), então os cards
 * somam o total sem sobrar ninguém.
 *
 * A fonte é o script do site instalado pelo GTM, não o Rubeus: o CRM não guarda
 * UTM. Por isso a tela só tem dado a partir do dia em que a captura de origem
 * entrou no ar.
 */

const PRINCIPAIS = [
  { id: 'google_ads', icone: 'dinheiro', dica: 'Chegaram com gclid (auto-tagging) ou UTM paga do Google.' },
  { id: 'meta_ads', icone: 'alvo', dica: 'Chegaram por anúncio do Facebook/Instagram (utm_source=facebook, utm_medium=cpc).' },
  { id: 'utm', icone: 'link', tom: 'sucesso', dica: 'Chegaram por um link com UTM que não é anúncio: bio, post, e-mail, WhatsApp, parceiro.' },
];
const OUTROS = {
  busca: 'Vieram do Google, Bing etc. sem UTM: busca orgânica.',
  social: 'Vieram de uma rede social por link sem UTM.',
  referencia: 'Vieram de outro site por link sem UTM.',
  direto: 'Sem UTM e sem site de origem: digitaram o endereço, favorito ou app que não informa a origem.',
};

function TabelaUtm({ linhas, vazio }) {
  if (!linhas.length) return <Estado icone="link" mensagem={vazio} />;
  const maior = Math.max(...linhas.map((l) => l.pessoas));
  return (
    <div className="overflow-x-auto">
      <table className="tabela">
        <thead>
          <tr>
            <th>utm_campaign</th>
            <th>utm_source</th>
            <th>utm_medium</th>
            <th className="text-right!"><Dica conteudo="Pessoas que preencheram formulário vindo deste link."><span>Pessoas</span></Dica></th>
            <th className="text-right!"><Dica conteudo="Dessas, quantas existem no Rubeus (mesmo e-mail ou telefone)."><span>Viraram lead</span></Dica></th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={`${l.canal}|${l.fonte}|${l.meio}|${l.campanha}`}>
              <td>
                <Dica conteudo={l.campanha || '(sem campanha)'} className="min-w-0">
                  <span className="block truncate max-w-[360px] text-[13.5px] font-medium">{l.campanha || <span className="text-tenue">(sem campanha)</span>}</span>
                </Dica>
              </td>
              <td className="text-secundario">{l.fonte || '—'}</td>
              <td className="text-secundario">{l.meio || '—'}</td>
              <td className="text-right tnum min-w-[110px]">
                <div className="font-semibold">{fmtInt(l.pessoas)}</div>
                <div className="mt-1.5 ml-auto w-full max-w-[90px]"><BarraProporcao pct={(l.pessoas / maior) * 100} altura="h-[5px]" /></div>
              </td>
              <td className="text-right tnum text-secundario">{fmtInt(l.leads)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Origens({ filtro, setFiltro }) {
  const [aba, setAba] = useState('utm');
  const p = queryPeriodo(filtro);
  const { dados, carregando, atualizando, erro } = useApi(`/api/origens?${p}`, p, { manter: true });
  const { de, ate } = resolverPeriodo(filtro);

  const cabecalho = (
    <>
      <CabecalhoPagina
        titulo="Origens dos leads"
        icone="link"
        subtitulo={`${fmtDiaMes(de)} a ${fmtDiaMes(ate)}`}
        descricao="De que canal veio quem preencheu formulário no site: Google Ads, Meta Ads ou links com UTM divulgados organicamente. Captado no site pelo GTM; cada pessoa conta uma vez, no último canal por onde chegou."
      />
      <BarraFiltros filtro={filtro} aoTrocar={setFiltro} />
    </>
  );

  if (erro) {
    return (<>{cabecalho}<Cartao><Estado tipo="erro" titulo="Não foi possível carregar" mensagem={erro} /></Cartao></>);
  }
  if (carregando || !dados) {
    return (<>{cabecalho}<EsqueletoPagina kpis={3} graficos={0} tabela /></>);
  }

  const porId = Object.fromEntries(dados.canais.map((k) => [k.id, k]));
  const utmOrganico = dados.utms.filter((l) => l.canal === 'utm');
  const utmAnuncios = dados.utms.filter((l) => l.canal !== 'utm');

  const abas = [
    { id: 'utm', nome: 'Links UTM', icone: 'link', contagem: utmOrganico.length },
    { id: 'anuncios', nome: 'UTMs dos anúncios', icone: 'alvo', contagem: utmAnuncios.length },
    { id: 'sem_utm', nome: 'Sem UTM', icone: 'olho', contagem: dados.referencias.length },
  ];

  return (
    <>
      {cabecalho}
      <Atualizando ativo={atualizando} className="flex flex-col gap-5">
        {dados.total === 0 && (
          <Cartao>
            <Estado
              icone="link"
              titulo="Nenhuma origem captada neste período"
              mensagem="A origem é gravada pelo script do site (tag do GTM) no envio do formulário. Ela só aparece a partir da publicação desta versão, e só nas páginas onde a tag está instalada — confira se as landing pages em lp.faculdadeide.edu.br também carregam o contêiner."
            />
          </Cartao>
        )}

        <Secao titulo="Canais de tráfego" icone="alvo" dica="Os três canais acompanhados, sempre separados. Cada pessoa aparece em um só.">
          <div className="grid gap-3 grade-kpi cascata">
            {PRINCIPAIS.map((c) => {
              const k = porId[c.id];
              return (
                <CartaoKpi key={c.id} rotulo={k.nome} valor={k.pessoas} fmt={fmtInt} icone={c.icone} tom={c.tom} dica={c.dica}>
                  <span className="text-[12.5px] text-secundario tnum">
                    {fmtInt(k.leads)} no Rubeus{k.pessoas > 0 ? ` · ${fmtDec((k.leads / k.pessoas) * 100)}%` : ''}
                  </span>
                </CartaoKpi>
              );
            })}
          </div>
        </Secao>

        <Secao titulo="Sem UTM" icone="olho" dica="Quem chegou sem nenhuma marcação, separado pelo site de onde veio.">
          <div className="grid gap-3 grade-kpi cascata">
            {Object.entries(OUTROS).map(([id, dica]) => {
              const k = porId[id];
              return <CartaoKpi key={id} compacto rotulo={k.nome} valor={k.pessoas} fmt={fmtInt} icone="pessoas" dica={dica} />;
            })}
          </div>
        </Secao>

        <section className="flex flex-col gap-3 pt-2">
          <Abas abas={abas} ativa={aba} aoTrocar={setAba} rotulo="Detalhe das origens" />
          <Cartao key={aba} className="animate-aparecer">
            {aba === 'utm' && (
              <>
                <TituloSecao titulo="Links divulgados organicamente" icone="link" dica="Cada combinação de UTM que não é anúncio, com quantas pessoas trouxe." />
                <TabelaUtm linhas={utmOrganico} vazio="Nenhum link com UTM orgânica trouxe formulário neste período." />
              </>
            )}
            {aba === 'anuncios' && (
              <>
                <TituloSecao titulo="UTMs dos anúncios" icone="alvo" dica="Google Ads e Meta Ads, pela UTM da URL. O gclid sem UTM aparece como (sem campanha)." />
                <TabelaUtm linhas={utmAnuncios} vazio="Nenhum anúncio trouxe formulário neste período." />
              </>
            )}
            {aba === 'sem_utm' && (
              <>
                <TituloSecao titulo="De onde veio quem chegou sem UTM" icone="olho" dica="O site anterior (referência), quando o navegador informa." />
                {dados.referencias.length ? (
                  <div className="overflow-x-auto">
                    <table className="tabela">
                      <thead><tr><th>Site de origem</th><th>Canal</th><th className="text-right!">Pessoas</th><th className="text-right!">Viraram lead</th></tr></thead>
                      <tbody>
                        {dados.referencias.map((r) => (
                          <tr key={`${r.canal}|${r.referencia}`}>
                            <td className="font-medium">{r.referencia}</td>
                            <td className="text-secundario">{porId[r.canal]?.nome}</td>
                            <td className="text-right tnum font-semibold">{fmtInt(r.pessoas)}</td>
                            <td className="text-right tnum text-secundario">{fmtInt(r.leads)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Estado icone="olho" mensagem="Ninguém chegou sem UTM neste período." />
                )}
              </>
            )}
          </Cartao>
        </section>
      </Atualizando>
    </>
  );
}
