import { Cartao, Estado, Esqueleto } from '../componentes/base';
import { useApi } from '../lib/api';
import { fmtDataHora, fmtDec, fmtInt, iniciais } from '../lib/formato';

export function Conversas() {
  const { dados, carregando, erro } = useApi('/api/conversas?limite=50', 'conversas');

  const cabecalho = (
    <div>
      <div className="text-[19px] font-semibold tracking-tight">Conversas</div>
      <div className="text-tenue text-xs mt-[2px]">WhatsApp via Evolution API · somente leitura</div>
    </div>
  );

  if (erro) return <>{cabecalho}<Cartao><Estado tipo="erro" titulo="Não foi possível carregar" mensagem={erro} /></Cartao></>;
  if (carregando || !dados) return <>{cabecalho}<Esqueleto linhas={5} /></>;

  const r = dados.resumo;
  return (
    <>
      {cabecalho}
      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(158px,1fr))]">
        {[
          ['Total de conversas', fmtInt(r.total)],
          ['Respondidas', fmtInt(r.respondidas)],
          ['Tempo médio de resposta', r.total ? `${fmtDec(r.tempo_medio_min)} min` : '—'],
        ].map(([k, v]) => (
          <Cartao key={k}>
            <div className="text-[11px] text-secundario font-medium">{k}</div>
            <div className="text-[21px] font-bold tnum">{v}</div>
          </Cartao>
        ))}
      </div>

      <Cartao>
        <div className="text-[13px] font-semibold mb-3">Conversas recentes</div>
        {dados.itens.length ? (
          dados.itens.map((c, i) => (
            <div
              key={c.id}
              className={`flex items-center justify-between gap-3 py-2 ${i ? 'border-t border-borda' : ''}`}
            >
              <div className="flex items-center gap-[10px] min-w-0">
                <div className="w-6 h-6 rounded-full bg-azul-700 text-white flex items-center justify-center text-[11px] font-semibold shrink-0">
                  {iniciais(c.contato_nome)}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-[13px] truncate">
                    {c.contato_nome || `Contato ${c.contato_id ?? '—'}`}
                  </div>
                  <div className="text-[11px] text-tenue">
                    {c.atendente || 'Sem atendente'} · {fmtDataHora(c.iniciada_em)}
                  </div>
                </div>
              </div>
              <div className="text-xs text-secundario tnum whitespace-nowrap">
                {c.tempo_resposta_min != null
                  ? `${fmtDec(c.tempo_resposta_min)} min`
                  : c.respondida
                    ? 'respondida'
                    : 'sem resposta'}
              </div>
            </div>
          ))
        ) : (
          <Estado
            titulo="Nenhuma conversa"
            mensagem="As conversas aparecem aqui conforme a Evolution API envia eventos para o Worker."
          />
        )}
      </Cartao>
    </>
  );
}
