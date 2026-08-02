# Painel Faculdade IDE — Worker + D1

Painel de acompanhamento de admissões. Recebe eventos do Rubeus e da Evolution
API, guarda no Cloudflare D1, consulta a API do Google Ads ao vivo e serve o
frontend — tudo no mesmo Worker.

Contexto completo em [ide-painel-plano-implementacao.md](ide-painel-plano-implementacao.md).

## Estado

| Fase | Status |
|---|---|
| Worker + D1 | No ar. Só `leads_etapa` e `conversas_whatsapp`. |
| Google Ads | No ar. Consulta ao vivo em `/api/ads/*`, sem n8n. |
| Frontend | No ar (JS puro). Port para React/Recharts em andamento. |
| Cloudflare Access | No ar. `painel.ide.edu.br` exige login. |


O `WEBHOOK_SECRET` e as credenciais do Google Ads já estão publicados como
secret. Falta configurar o mesmo `X-Webhook-Secret` nos headers customizados do
Rubeus e da Evolution API — sem isso os webhooks devolvem 401 e nada é gravado.

## Acesso

`painel.ide.edu.br` fica atrás do Cloudflare Access (organização
`faculdade-ide.cloudflareaccess.com`), com login por PIN enviado ao e-mail.

| Aplicação | Domínio | Política |
|---|---|---|
| Painel Faculdade IDE | `painel.ide.edu.br` | Allow: `@faculdadeide.edu.br` + `nousdynamicslta@gmail.com` |
| Webhooks (servidor-a-servidor) | `painel.ide.edu.br/webhook` | Bypass |

O caminho mais específico vence, então o app de `/webhook` isenta Rubeus e
Evolution do login — eles continuam guardados só pelo `X-Webhook-Secret`, que é
o certo para chamada de máquina.

**A URL `*.workers.dev` está desligada de propósito** (`workers_dev: false`). O
Access protege a zona `ide.edu.br`, mas não alcança `*.workers.dev`, que não é
uma zona nossa — com ela ligada, qualquer pessoa com o endereço lia o
investimento real da conta sem passar por login.

Consequência operacional: `/health` também ficou atrás do login, então
monitoramento externo de uptime precisaria de uma regra de bypass própria.

## Setup

```bash
npm install
cp .dev.vars.example .dev.vars   # preencher WEBHOOK_SECRET e as chaves do Google Ads
npm run db:local                 # aplica as migrations no SQLite local
npm run dev
```

### Deploy

O deploy é automático: o Workers Builds publica a cada push na `main`.
As migrations não são aplicadas pelo build — rodar `npm run db:remote` à mão
quando houver migration nova.

## Endpoints

Os `POST /webhook/*` exigem o header `X-Webhook-Secret` e ficam **fora** do
Cloudflare Access (são chamadas servidor-a-servidor). Os `GET /api/*` não têm
auth própria — o Access barra antes de chegar no Worker.

| Método | Rota | Origem |
|---|---|---|
| POST | `/webhook/rubeus/etapa` | Fluxo de automação do Rubeus |
| POST | `/webhook/evolution/conversa` | Evolution API (upsert por contato+início) |
| GET | `/api/overview?dias=30` | Leads e conversas (D1) |
| GET | `/api/funil?processo_id=&dias=90` | Contagem por etapa + taxas (D1) |
| GET | `/api/conversas?limite=&offset=` | Lista paginada (D1) |
| GET | `/api/me` | E-mail injetado pelo Cloudflare Access |
| GET | `/api/ads/overview?de=&ate=&comparar=1` | Cards, comparação e série diária |
| GET | `/api/ads/campanhas?de=&ate=` | Tabela de campanhas |
| GET | `/api/ads/resultados-por-acao?de=&ate=` | De onde vêm os resultados |
| GET | `/api/ads/anuncios?de=&ate=` | Desempenho por anúncio |
| GET | `/api/ads/palavras-chave?de=&ate=` | Termos comprados |
| GET | `/health` | Sonda de deploy e binding do D1 |

> `/api/ads/anuncios` e `/api/ads/palavras-chave` ainda usam `LIMIT 500`, e a
> conta já bate nesse teto. Trocar por paginação server-side quando as tabelas
> ganharem paginação de verdade.

Corpo inválido devolve `400` com a lista de campos problemáticos. Nenhuma linha
parcial é gravada.

## Origem de cada número

| Dado | Vem de |
|---|---|
| Investimento, resultados, cliques, impressões, CPC, CTR | API do Google Ads, ao vivo (`/api/ads/*`) |
| Campanhas, anúncios, palavras-chave, resultados por ação | API do Google Ads, ao vivo |
| Funil por etapa | D1 `leads_etapa`, alimentado pelo webhook do Rubeus |
| Conversas de WhatsApp | D1 `conversas_whatsapp`, alimentado pela Evolution API |

**O n8n não faz parte desta ferramenta.** Ele segue existindo para enviar
conversão offline ao Google Ads, mas não escreve nem lê nada aqui. Por isso a
migration `0003` removeu `metricas_anuncio` (substituída pela consulta ao vivo)
e `conversoes_ads` (que só o callback do n8n preencheria).

"Resultados" é a soma de TODAS as conversões que a plataforma reporta — sem
allowlist de ação e sem usar `primary_for_goal`, que nesta conta marca como
primária inscrição em canal do YouTube e como secundária o "Concluiu Inscrição".
A métrica já nasce agregável por plataforma, para o Meta Ads somar depois.

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

1. **`contato_nome` em `leads_etapa`** (migration `0002`). O schema da seção 4
   não guardava o nome do lead em lugar nenhum além de `conversas_whatsapp`,
   mas os mockups exibem o nome nas listas. O Rubeus precisa mandar esse campo
   no payload da etapa.

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
   contornada no node "Normalizar Payload" do fluxo n8n original, e que vale
   igual aqui porque o Rubeus dispara para os dois destinos. Ver `src/lib/corpo.ts`.

6. **Comparação do secret em tempo constante** via SHA-256 + `timingSafeEqual`,
   com falha fechada se `WEBHOOK_SECRET` não estiver configurado.

## Pendências que não são código

Continuam valendo os itens da seção 3 do plano (campo `gclid` no Rubeus, ações
de conversão no Google Ads, tokens). Nenhum valor real foi commitado — os
lugares que precisam de credencial estão marcados com `TODO` no `wrangler.jsonc`
e no `.dev.vars.example`.
