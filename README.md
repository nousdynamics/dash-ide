# Painel Faculdade IDE — Worker + D1

Backend do painel de admissões. Recebe eventos de Rubeus, n8n e Evolution API,
grava no Cloudflare D1 e serve os agregados pro frontend.

Escopo: **só o dashboard**. Quem fala com a API do Google Ads é o fluxo do n8n —
este Worker apenas registra o resultado que o n8n reporta.

Contexto completo em [ide-painel-plano-implementacao.md](ide-painel-plano-implementacao.md).

## Estado

| Fase | Status |
|---|---|
| 1 — Worker + D1 | No ar. D1 `dash-ide` criado, migrations aplicadas. |
| 2 — Fluxo n8n de conversão | Não iniciado (4 nodes finais) |
| 3 — Fluxo n8n de métricas | Não iniciado |
| 4 — Frontend | No ar. Falta configurar o Cloudflare Access na frente do domínio. |

Pendente pra tudo funcionar de ponta a ponta: publicar o `WEBHOOK_SECRET`
(`npx wrangler secret put WEBHOOK_SECRET`) e replicar o mesmo valor no header
`X-Webhook-Secret` do Rubeus, do n8n e da Evolution API.

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

## Frontend

Servido como asset estático pelo mesmo Worker (`public/`), então painel e API
compartilham origem — sem CORS e com um só hostname pro Access proteger.

Navegação por hash (`#/funil`). Não é preferência de estilo: com assets em modo
SPA o roteador devolveria `index.html` para qualquer path sem asset, inclusive
`/api/*` e `/webhook/*`.

Layout dos mockups aprovados. Breakpoint único em 768px: abaixo vira tabbar
inferior, funil vertical e listas no lugar da tabela.

**Desvio consciente da seção 2.5 do design system:** o fundo da página é chapado
e não tem os dois blobs de gradiente. Decisão do projeto — degradê existe só
dentro dos componentes. Como consequência os cards deixaram de usar
`backdrop-filter` (não havia mais nada colorido pra desfocar) e passaram a
carregar o próprio gradiente sutil, com a borda de topo clara preservando o
efeito de superfície pegando luz.

A sidebar retrai para uma trilha de 72px só com ícones; a preferência fica em
`localStorage`. Os ícones são SVG inline com `currentColor`, não emoji — emoji
vem colorido e com métrica própria de cada sistema, o que desalinha numa fileira
vertical de ícones.

A logo tem duas variantes: `logo-IDE-faculdade.svg` (original, para fundo claro)
e `logo-IDE-faculdade-dark.svg`, usada no painel. O azul-marinho da marca
(`#01335e`) rende ~1,4:1 de contraste sobre o fundo escuro — ilegível —, então
na variante escura ele vira branco de texto. O teal do brasão tem contraste
suficiente e permanece.

Dois detalhes de leitura de dado que valem saber:

- **As séries dos gráficos são preenchidas com zero nos dias sem registro.** A
  API só devolve dias que têm linha; plotar isso direto espaça os pontos por
  índice em vez de por data, e a linha mente sobre o ritmo.
- **O funil é sempre de um processo só.** Somar processos gera taxa acima de
  100%, porque cada processo usa um conjunto diferente de etapas. Na primeira
  visita o painel assume o processo com mais leads.

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
