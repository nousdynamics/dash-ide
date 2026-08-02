# Painel Faculdade IDE — Worker + D1

Backend do painel de admissões. Recebe eventos de Rubeus, n8n e Evolution API,
grava no Cloudflare D1 e serve os agregados pro frontend.

Escopo: **só o dashboard**. Quem fala com a API do Google Ads é o fluxo do n8n —
este Worker apenas registra o resultado que o n8n reporta.

Contexto completo em [ide-painel-plano-implementacao.md](ide-painel-plano-implementacao.md).

## Estado

| Fase | Status |
|---|---|
| 1 — Worker + D1 | Implementado, validado localmente. Falta criar o D1 remoto e deployar. |
| 2 — Fluxo n8n de conversão | Não iniciado (4 nodes finais) |
| 3 — Fluxo n8n de métricas | Não iniciado |
| 4 — Frontend + Cloudflare Access | Não iniciado |

## Setup

```bash
npm install
cp .dev.vars.example .dev.vars   # e preencher WEBHOOK_SECRET
npm run db:local                 # aplica as migrations no SQLite local
npm run dev
```

### Deploy

```bash
npx wrangler d1 create dash-ide          # copiar o uuid pro wrangler.jsonc
npx wrangler secret put WEBHOOK_SECRET   # openssl rand -hex 32
npm run db:remote
npm run deploy
```

## Endpoints

Os `POST /webhook/*` exigem o header `X-Webhook-Secret` e ficam **fora** do
Cloudflare Access (são chamadas servidor-a-servidor). Os `GET /api/*` não têm
auth própria — o Access barra antes de chegar no Worker.

| Método | Rota | Origem |
|---|---|---|
| POST | `/webhook/rubeus/etapa` | Fluxo de automação do Rubeus |
| POST | `/webhook/evolution/conversa` | Evolution API (upsert por contato+início) |
| POST | `/webhook/n8n/conversao` | n8n, após tentar o envio ao Google Ads |
| POST | `/webhook/n8n/metricas` | n8n agendado (upsert por data+campanha) |
| GET | `/api/overview?dias=30` | Cards, séries e listas da Visão Geral |
| GET | `/api/funil?processo_id=&dias=90` | Contagem por etapa + taxas |
| GET | `/api/conversoes?limite=&offset=&status=` | Lista paginada |
| GET | `/api/conversas?limite=&offset=` | Lista paginada |
| GET | `/health` | Sonda de deploy e binding do D1 |

Corpo inválido devolve `400` com a lista de campos problemáticos. Nenhuma linha
parcial é gravada.

## Decisões de implementação que não estavam no plano

Registradas aqui porque afetam quem for continuar:

1. **`contato_nome` em `leads_etapa` e `conversoes_ads`** (migration `0002`). O
   schema da seção 4 não guardava o nome do lead em lugar nenhum além de
   `conversas_whatsapp`, mas os mockups exibem o nome nas duas tabelas. O n8n já
   extrai esse campo da API do Rubeus — só precisa repassar no callback.

2. **Índice único em `conversas_whatsapp (contato_id, iniciada_em)`.** A Evolution
   reemite eventos da mesma conversa; sem isso cada mensagem viraria uma linha
   nova em vez de atualizar a existente.

3. **`/api/funil` conta contatos distintos que *passaram* por cada etapa**, não
   quantos estão parados nela agora. É o que faz a taxa entre etapas ser
   comparável e o funil decrescer de forma consistente.

4. **`etapa_maior_queda` ignora etapas com zero.** Nem todo processo usa as oito
   etapas da lista canônica; sem o filtro, uma etapa não utilizada aparece como
   0% e rouba o destaque de um gargalo real.

5. **Parsing de corpo tolerante a `form-urlencoded`.** O Rubeus manda JSON com
   `Content-Type: application/x-www-form-urlencoded` — mesma armadilha já
   contornada no node "Normalizar Payload" do fluxo n8n. Ver `src/lib/corpo.ts`.

6. **Comparação do secret em tempo constante** via SHA-256 + `timingSafeEqual`,
   com falha fechada se `WEBHOOK_SECRET` não estiver configurado.

## Pendências que não são código

Continuam valendo os itens da seção 3 do plano (campo `gclid` no Rubeus, ações
de conversão no Google Ads, tokens). Nenhum valor real foi commitado — os
lugares que precisam de credencial estão marcados com `TODO` no `wrangler.jsonc`
e no `.dev.vars.example`.
