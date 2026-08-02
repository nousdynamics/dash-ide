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
| Frontend | No ar, em React + Vite + Tailwind + Recharts. |
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

> `/api/ads/anuncios` e `/api/ads/palavras-chave` filtram `cost_micros > 0` na
> origem. Medido nesta conta em 30 dias: 3.721 palavras-chave têm alguma linha e
> 50 gastaram; 1.032 anúncios têm linha e 17 gastaram. Filtrar na origem elimina
> a truncagem silenciosa que o `LIMIT 500` causava e dispensa paginação.

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

React + Vite + Tailwind v4 + Recharts. A fonte fica em `app/`; o build sai em
`public/`, que é o diretório de assets do Worker. Painel e API compartilham
origem — sem CORS e com um só hostname pro Access proteger.

```bash
npm run dev        # Worker na 8790 (API + assets já buildados)
npm run dev:app    # Vite na 5173 com HMR, repassando /api para a 8790
npm run build      # gera public/ a partir de app/
```

**O conteúdo de `public/` é versionado de propósito.** O Workers Builds roda
`npx wrangler deploy` e não executa o build do Vite; commitar o bundle é o que
mantém o deploy automático funcionando sem mexer no CI. Rodar `npm run build`
antes de commitar mudança de frontend é obrigatório.

Cada tela é um chunk carregado sob demanda (`React.lazy`). Recharts pesa quase
todo o bundle e só a Visão geral usa, então quem abre Conversas, Funil ou
Campanhas não baixa a biblioteca de gráficos.

Sem `manualChunks`: forçar Recharts num chunk próprio criou dependência cruzada
com o chunk de vendor, que é carregado sempre, e o resultado foi Recharts virar
import estático da entrada — baixado até por quem nunca abria um gráfico. O
splitting automático segue as fronteiras dos `lazy()` e resolve sozinho.

O detalhe da campanha abre em sanfona dentro da própria lista, não em página
separada: quem olha campanhas está comparando umas com as outras, e sair da
lista custa esse contexto. Dentro dele, o conteúdo é organizado por conjunto de
anúncios — que é como o Google Ads estrutura a conta —, com sub-sanfonas de
anúncios e de palavras-chave em cada um. Lista plana de termos não responde
"qual conjunto está comprando esse termo", que é a pergunta que se faz ao
investigar custo. Cada nível só monta o conteúdo quando aberto.

Navegação por hash (`#/funil`). Não é preferência de estilo: com assets em modo
SPA o roteador devolveria `index.html` para qualquer path sem asset, inclusive
`/api/*` e `/webhook/*`.

Layout dos mockups aprovados. Breakpoint único em 768px. Abaixo dele:

- Tabbar inferior no lugar da sidebar, e funil na vertical.
- **Toda tabela vira lista.** Campanhas tem 7 colunas e palavras-chave tem 6;
  em 390px isso só caberia com rolagem horizontal, que esconde coluna atrás de
  gesto. A lista mostra o mesmo dado empilhado.
- Cabeçalho de sanfona empilha título e resumo, para o nome do conjunto ter a
  linha inteira em vez de truncar em "Enfermagem em D…".
- Eixo Y dos gráficos encolhe de 52px para 34px e o rótulo da média sai: em
  390px a área de plotagem é o recurso escasso.

Verificado com emulação de device em 390px nas quatro telas, com o detalhe da
campanha aberto: nenhuma delas transborda na horizontal.

**Desvio consciente da seção 2.5 do design system:** o fundo da página é chapado
e não tem os dois blobs de gradiente. Decisão do projeto — degradê existe só
dentro dos componentes. Como consequência os cards deixaram de usar
`backdrop-filter` (não havia mais nada colorido pra desfocar) e passaram a
carregar o próprio gradiente sutil, com a borda de topo clara preservando o
efeito de superfície pegando luz.

**Nunca checkbox: todo liga/desliga é switch.** É um `<button role="switch">`
com `aria-checked`, não um input — o botão já traz ativação por teclado e o
estado em `aria-checked` é anunciado como ligado/desligado pelo leitor de tela.

Com a comparação ligada, cada card mostra o valor do período comparado ("antes:
R$ 3.734,71") e o subtítulo nomeia o intervalo. Um chip de "+37,3%" sem âncora
não diz em relação a quê.

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
