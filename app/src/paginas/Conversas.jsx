import {
  Atualizando,
  CabecalhoPagina,
  Cartao,
  CartaoKpi,
  Dica,
  Estado,
  EsqueletoPagina,
  Icone,
  Pill,
  TituloSecao,
} from '../componentes/base';
import { useApi } from '../lib/api';
import { fmtDataHora, fmtDec, fmtInt, iniciais } from '../lib/formato';

/**
 * Status da conversa em pílula: o tempo de resposta quando existe, senão só
 * se foi respondida. "Sem resposta" em âmbar — é o que pede ação.
 */
function StatusResposta({ c }) {
  if (c.tempo_resposta_min != null) {
    return (
      <Pill tom="sucesso" ponto dica="Tempo até a primeira resposta do atendimento">
        <Icone nome="relogio" className="w-3.5 h-3.5" />
        <span className="tnum">{fmtDec(c.tempo_resposta_min)} min</span>
      </Pill>
    );
  }
  if (c.respondida) {
    return (
      <Pill tom="sucesso" ponto>
        respondida
      </Pill>
    );
  }
  return (
    <Pill tom="atencao" ponto dica="Ninguém do atendimento respondeu esta conversa ainda">
      sem resposta
    </Pill>
  );
}

export function Conversas() {
  const { dados, carregando, atualizando, erro } = useApi('/api/conversas?limite=50', 'conversas');

  const cabecalho = (
    <CabecalhoPagina
      titulo="Conversas"
      icone="mensagem"
      subtitulo="WhatsApp · somente leitura"
      descricao="Conversas de WhatsApp recebidas pela Evolution API, com o tempo de resposta do atendimento. Somente leitura: nada é enviado daqui."
    />
  );

  if (erro) return <>{cabecalho}<Cartao><Estado tipo="erro" titulo="Não foi possível carregar" mensagem={erro} /></Cartao></>;
  if (carregando || !dados) return <>{cabecalho}<EsqueletoPagina kpis={3} graficos={0} tabela /></>;

  const r = dados.resumo;
  const taxa = r.total ? (r.respondidas / r.total) * 100 : null;
  return (
    <>
      {cabecalho}
      <Atualizando ativo={atualizando} className="flex flex-col gap-4">
        <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(180px,1fr))] cascata">
          <CartaoKpi
            rotulo="Total de conversas"
            valor={r.total}
            fmt={fmtInt}
            icone="mensagem"
            dica="Conversas registradas pelo Worker a partir dos eventos da Evolution API."
          />
          <CartaoKpi
            rotulo="Respondidas"
            valor={r.respondidas}
            fmt={fmtInt}
            icone="checkCirculo"
            tom="sucesso"
            dica="Conversas que tiveram pelo menos uma resposta do atendimento."
          >
            {taxa !== null && (
              <span className="text-[12.5px] text-secundario tnum">{fmtDec(taxa)}% do total</span>
            )}
          </CartaoKpi>
          <CartaoKpi
            rotulo="Tempo médio de resposta"
            valor={r.total ? r.tempo_medio_min : null}
            fmt={(n) => (n === null || n === undefined ? '—' : `${fmtDec(n)} min`)}
            icone="relogio"
            tom="atencao"
            dica="Média do tempo até a primeira resposta do atendimento, nas conversas que têm esse tempo registrado."
          />
        </div>

        <Cartao>
          <TituloSecao
            titulo="Conversas recentes"
            icone="mensagem"
            dica="As 50 conversas mais recentes."
            extra={dados.itens.length ? <span className="tnum">{fmtInt(dados.itens.length)}</span> : null}
          />
          {dados.itens.length ? (
            <ul className="list-none m-0 p-0 flex flex-col cascata">
              {dados.itens.map((c) => {
                const nome = c.contato_nome || `Contato ${c.contato_id ?? '—'}`;
                return (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-3 py-2.5 px-2 -mx-2 rounded-[10px]
                               border-b border-borda last:border-b-0 transition-colors hover:bg-superficie-hover"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        aria-hidden="true"
                        className="w-9 h-9 rounded-full bg-gradient-to-br from-azul-600 to-azul-400 text-white
                                   flex items-center justify-center text-[13px] font-semibold shrink-0"
                      >
                        {iniciais(c.contato_nome)}
                      </div>
                      <div className="min-w-0">
                        <Dica conteudo={nome} className="min-w-0">
                          <span className="block font-semibold text-[14px] truncate">{nome}</span>
                        </Dica>
                        <div className="text-[12.5px] text-secundario flex items-center gap-1.5 flex-wrap tnum">
                          <span className="inline-flex items-center gap-1">
                            <Icone nome="pessoa" className="w-3.5 h-3.5 text-tenue" />
                            {c.atendente || 'Sem atendente'}
                          </span>
                          <span className="text-tenue">·</span>
                          <span>{fmtDataHora(c.iniciada_em)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0">
                      <StatusResposta c={c} />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Estado
              icone="mensagem"
              titulo="Nenhuma conversa"
              mensagem="As conversas aparecem aqui conforme a Evolution API envia eventos para o Worker."
            />
          )}
        </Cartao>
      </Atualizando>
    </>
  );
}
