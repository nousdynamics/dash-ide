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


As credenciais do Google Ads e do RD Station estão publicadas como secret do
Worker. Os webhooks não usam secret compartilhado: cada funil × canal tem token
próprio, gerado no painel e guardado no D1, para dar pra revogar um sem derrubar
os outros.

## Acesso

`painel.ide.edu.br` fica atrás do Cloudflare Access (organização
`faculdade-ide.cloudflareaccess.com`), com login por PIN enviado ao e-mail.

| Aplicação | Domínio | Política |
|---|---|---|
| Painel Faculdade IDE | `painel.ide.edu.br` | Allow: `@faculdadeide.edu.br`, `nousdynamicslta@gmail.com`, `mcc@isaacmelo.com` |
| Webhooks (servidor-a-servidor) | `painel.ide.edu.br/webhook` | Bypass |

O caminho mais específico vence, então o app de `/webhook` isenta Rubeus e
Evolution do login — eles se autenticam pelo token do próprio funil, que é o
certo para chamada de máquina.

**O Worker não confia no header de e-mail do Access.** `/api/*` e `/oauth/*`
conferem o JWT assinado (`Cf-Access-Jwt-Assertion`): assinatura contra o JWKS da
organização, `aud` desta aplicação, emissor e validade — e o e-mail do log de
auditoria sai de dentro do token. Sem isso, qualquer requisição que alcançasse o
Worker por fora da política (uma rota nova mal configurada, um Custom Domain
acrescentado depois) seria atendida mandando o header que quisesse — inclusive
para pedir o token de um webhook em `/api/funis/:id/token`. Ver `src/lib/access.ts`.

Em `wrangler dev` não há Access na frente; a brecha é a variável `AMBIENTE=dev`,
que só existe em `.dev.vars` e nunca é publicada. Em produção, a ausência dela é
o que obriga a verificação — falha fechado.

**Segundo nível: `ADMINS`.** O Access libera o domínio inteiro da faculdade, o
que está certo para relatório — investimento, funil e conversas são o trabalho
de todo mundo ali. Funis e webhooks é outra coisa: ela EMITE a credencial que
autoriza escrever no banco. `/api/funis*` exige estar na lista `ADMINS` do
wrangler.jsonc; lista vazia significa que ninguém administra, nunca "todo
mundo". O menu esconde o item para quem não é admin, mas isso é conveniência —
a permissão mora no servidor, e digitar `#/webhooks` na mão só leva ao 403.

**A URL `*.workers.dev` está desligada de propósito** (`workers_dev: false`). O
Access protege a zona `ide.edu.br`, mas não alcança `*.workers.dev`, que não é
uma zona nossa — com ela ligada, qualquer pessoa com o endereço lia o
investimento real da conta sem passar por login.

Consequência operacional: `/health` também ficou atrás do login, então
monitoramento externo de uptime precisaria de uma regra de bypass própria.

## Setup

```bash
npm install
cp .dev.vars.example .dev.vars   # chaves do Google Ads / RD Station + AMBIENTE=dev
npm run db:local                 # aplica as migrations no SQLite local
npm run dev
```

### Deploy

O deploy é automático: o Workers Builds publica a cada push na `main`.
As migrations não são aplicadas pelo build — rodar `npm run db:remote` à mão
quando houver migration nova.

## Endpoints

Os `POST /webhook/*` exigem o token do funil e ficam **fora** do Cloudflare
Access (são chamadas servidor-a-servidor). O token é aceito na query (`?t=`), em
`Authorization: Bearer`, em `X-Webhook-Token` ou em `apikey` — vale qualquer um
que esteja correto, e não o primeiro encontrado: o Rubeus oferece os dois campos
na mesma tela, e um valor velho sobrando no Bearer chegou a anular o token certo
da URL.

Os `GET /api/*` exigem o JWT do Access, verificado no Worker (ver **Acesso**).

| Método | Rota | Origem |
|---|---|---|
| POST | `/webhook/rubeus/:funil?t=` | Fluxo de automação do Rubeus |
| POST | `/webhook/evolution/:funil?t=` | Evolution API (upsert por contato+início) |
| POST | `/webhook/n8n/:funil?t=` | Contingência: reenvio e injeção manual |
| GET/POST/DELETE | `/api/funis…` | Cadastro de funil e gestão dos tokens |
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

**O n8n não alimenta o painel, e não envia mais conversão.** A conversão
offline saiu de lá e virou a tela `#/conversoes` — ver a seção abaixo. A
migration `0003` já havia removido `metricas_anuncio` (substituída pela consulta
ao vivo) e `conversoes_ads` (que só o callback dele preencheria).

O canal `n8n` dos webhooks é **contingência**, não rotina: serve para reenviar
evento perdido e para injetar dado à mão quando o Rubeus ou a Evolution
falham. Não remover achando que é resíduo da arquitetura antiga.

## Conversão offline

Saiu do n8n e virou **duas** telas do painel, ambas só para quem administra:

- **Conversões Ads** (`#/conversoes`) — a instalação: qual etapa do Rubeus vira
  qual evento, e para qual ação do Google Ads cada nível de ensino manda. Decisão
  que se toma uma vez.
- **Google Conversões** (`#/conversoes-google`) — o resultado: o registro do que
  foi enviado, o veredito do Google, a captura do gclid no site e a cópia na
  planilha. Pergunta de todo dia.

Estavam na mesma tela, e a segunda ficava abaixo de quatro blocos de
configuração: conferir o envio de ontem exigia rolar por escolhas que ninguém ia
tomar naquele momento.
O fluxo antigo — "Fluxo Faculdade IDE - Teste Webhook + API Rubeus" — fazia o
mesmo percurso por fora, com uma segunda cópia das credenciais do Google e do
Rubeus, e **nunca enviou nada**: ele procurava um campo personalizado `gclid` no
contato do Rubeus, e esse campo não existia na conta. Toda execução caía no ramo
"sem click ID".

O percurso agora:

```
webhook do Rubeus  →  gatilho (etapa → evento)  →  reserva com orderId único
                   →  enriquece (curso, nível, click id)  →  Data Manager API
                   →  diagnóstico (o veredito, ~30 min depois)
                   →  planilha de backup
```

A última etapa não é enfeite: `events:ingest` responder 200 significa que o
Google **aceitou a requisição**, não que contabilizou a conversão. Ver
**O veredito do Google**, abaixo.

### Duas formas de atribuir, nesta ordem

1. **click id** (`gclid`/`gbraid`/`wbraid`), quando existir;
2. **conversão aprimorada** — e-mail e telefone em SHA-256 hex, que o Rubeus já
   tem hoje para praticamente todo lead.

O segundo é o que faz isto funcionar antes de qualquer mudança no site. Quando
os dois existem, vão juntos no mesmo evento — a Data Manager API permite, e o
Google recomenda.

### Como o gclid chega ao Rubeus

O gclid só existe no navegador de quem clicou no anúncio; o CRM não o vê
sozinho. A ponte tem três tempos, e o painel faz todos:

1. **captura** — `/coleta/ide-clique.js` vai nas páginas do site (via GTM ou
   direto). Guarda o click id da URL do anúncio num cookie de primeira parte e,
   quando a pessoa envia um formulário com e-mail ou telefone, manda os três
   para `/coleta/clique`;
2. **cruzamento** — quando o webhook trouxer aquele lead, o painel acha a
   captura por e-mail/telefone (janela de 90 dias, a mais recente vence);
3. **devolução** — grava o click id no campo personalizado do Rubeus via
   `/api/Contato/cadastro`, para que o CRM passe a ter o dado.

`/coleta` fica fora do Cloudflare Access de propósito — quem chama é o navegador
de um visitante anônimo. A porta só aceita entrada, confere o `Origin` contra a
lista de sites permitidos, valida a forma do click id e tem teto diário.

A coluna do campo personalizado **não** é fixa no código: o painel a descobre
pelo nome em `/api/Instituicao/campoPersonalizado`. A coluna do Rubeus
(`campopersonalizado_24_compl_cont`) é um número de slot, e recriar o campo gera
outro número — um valor fixo passaria a escrever em cima de "Profissão" sem
nenhum erro visível.

### Transporte: Data Manager API, não Google Ads API

A primeira versão usava `uploadClickConversions`, como o n8n. O Google recusou,
com todas as letras:

> New integrations for uploading click conversions should use the Data Manager
> API. Usage of ConversionUploadService.UploadClickConversions is limited to
> existing users.

A conta nunca subiu conversão offline, então é integração nova — aquele caminho
está fechado para ela. O envio vai para `datamanager.googleapis.com/v1/events:ingest`,
que exige o escopo `https://www.googleapis.com/auth/datamanager`. Relatório e
cadastro de ações de conversão continuam na Google Ads API.

**O consentimento antigo não cobre esse escopo**, e renová-lo exige passar pela
tela do Google — não há atalho por API.

### Onde o consentimento acontece: na máquina, não no painel

`/oauth/google/*` só responde quando `AMBIENTE=dev`. Em produção devolve 404 com
explicação. Duas razões:

1. **O cliente OAuth desta conta é do tipo Computador** (`omini-traffic`), e
   cliente Desktop só aceita redirect de loopback — `painel.ide.edu.br` seria
   recusado pelo próprio Google. Não há o que registrar: a tela de cliente
   Desktop não tem campo de URI de redirecionamento.
2. **A rota GRAVA credencial** em `credenciais_oauth`, que tem precedência sobre
   o secret. Deixá-la alcançável em produção significaria que um clique trocaria
   a origem da credencial sem ninguém publicar nada, e o painel passaria a usar
   um token que não está nos secrets. Esconder o botão não bastava — quem
   digitasse a URL chegava lá.

O percurso, então:

```bash
# 1. na máquina de quem administra, com o Worker local no ar
npm run dev
# abrir http://127.0.0.1:8790/oauth/google/iniciar e consentir os 4 escopos

# 2. ler o refresh token que o callback gravou no D1 LOCAL
npx wrangler d1 execute dash-ide --local \
  --command "SELECT refresh_token FROM credenciais_oauth WHERE provedor='google'"

# 3. publicar como secret — o valor é colado no prompt, não vai para o histórico
npx wrangler secret put GOOGLE_ADS_REFRESH_TOKEN
```

Em produção `credenciais_oauth` fica vazia de propósito, e o token vem do secret.

### A tela verifica, não lembra

O checklist da tela de conversão perguntava à coluna `credenciais_oauth.escopo`
se o Data Manager estava autorizado. Isso quebra nos dois sentidos com o modelo
acima: a tabela está vazia em produção (diria "falta autorizar" para sempre,
mesmo enviando), e a coluna guarda o que foi concedido um dia — escopo revogado
depois não apareceria.

`estadoDoGoogle()` (`src/lib/google.ts`) renova o access token e pergunta os
escopos dele ao `tokeninfo` do Google. Serve às duas origens — banco em
desenvolvimento, secret em produção — e diz a verdade do momento. A tela também
passa a mostrar de onde veio a credencial.

### O veredito do Google

`events:ingest` valida em *fast-fail*: ou a requisição inteira passa, ou nenhum
evento dela passa — não existe o `partialFailure` da Google Ads API. Duas
consequências, e o painel trata as duas:

- **um evento ruim derruba o lote.** Quando um lote é recusado com `400`, o
  painel reenvia os eventos um a um para isolar o culpado. Sem isso, um gclid
  expirado marcaria como recusadas 59 conversões que o Google teria aceitado, e
  elas voltariam à fila todo dia até estourar o teto de tentativas. Só `400`
  dispara o isolamento: `403` (escopo), `401` e `429` são da conta inteira, e
  isolar ali seria repetir a mesma recusa N vezes.
- **200 não é resultado.** O resultado real sai em
  `requestStatus:retrieve?requestId=…`, cerca de 30 min depois, e é lá que
  aparece `SUCCESS`, `PARTIAL_SUCCESS` ou `FAILED` com a contagem de registros
  por motivo. O `requestId` de cada envio fica em `conversoes_offline.request_id`
  e numa fila própria (`conversao_requisicoes`), consultada com backoff de 1,3×
  a partir de 30 min, teto de 60 min, até 24 h.

Por isso o cron passou a ter dois horários: `0 9 * * *` para a reconciliação
pesada e a planilha, e `0,30 * * * *` para essa passada curta. Com só o diário,
todo veredito chegaria com um dia de atraso — e a tela passaria esse dia dizendo
"enviada" para conversão que o Google descartou.

`PARTIAL_SUCCESS` **não** devolve as linhas à fila automaticamente: o Google diz
quantos registros caíram e por quê, mas não quais. Reenviar o lote duplicaria as
que deram certo. O painel marca, mostra o motivo, e o reenvio é por linha, num
botão.

Modo teste (`validateOnly`) não gera diagnóstico — o Google valida e descarta
sem processar.

### Monitor de conversões

Dentro da mesma tela, abaixo da configuração. Responde o que vem depois de
"está ligado?": o que saiu, de qual curso, com que atribuição, e o que o Google
fez com aquilo.

Três camadas de verdade, deliberadamente em colunas separadas:

| coluna | o que diz |
|---|---|
| `status` | o que o **painel** fez: enviou, não enviou, por quê |
| `diagnostico` | o que o **Google** fez depois de aceitar a requisição |
| `identificadores` | como o lead foi ligado ao clique (gclid, hash, nada) |

Fundir as duas primeiras apagaria a distinção que diz onde está o defeito: "nós
não mandamos" pede correção no mapa de etapas, "mandamos e o Google não
aproveitou" pede correção na qualidade do identificador.

Filtros: período (pela data do **evento**, que é como o Google Ads também as
data), tipo de curso (nível de ensino), curso, evento, processo do Rubeus, ação
de conversão, situação no painel, veredito do Google, atribuição, modo e busca
livre. Multi-seleção viaja em parâmetros repetidos (`curso=A&curso=B`), nunca
separada por vírgula — nome de curso vem de digitação livre no Rubeus e tem
vírgula.

O seletor de curso se estreita ao nível já escolhido, os valores dos seletores
saem do que já foi registrado (curso novo aparece sozinho, sem deploy), e
`GET /api/conversoes/registro.csv` baixa exatamente a janela filtrada — com BOM,
e com `'` na frente de célula que comece com `=`, `+`, `-` ou `@`, porque nome de
lead vem de digitação livre e uma planilha trata isso como fórmula.

### Consentimento

`consent` só é enviado quando a tela afirma tê-lo. O padrão é **não informar**,
que é diferente de negar: omitido, o Google aplica a regra da conta; negado, ele
descarta o identificador e a conversão aprimorada para de casar.

Marcar "concedido" é uma declaração em nome da faculdade sobre um consentimento
que só quem administra a captação pode confirmar — por isso mora na tela, com o
padrão no lado que não afirma nada, em vez de cravado no código.

### O valor do curso

**Correção de 05/09/2026.** Este README afirmava que o Rubeus não tem o preço em
lugar nenhum. Isso é verdade para a **API** — `valorCurso` nulo em todas as
oportunidades conferidas, `valor` nulo nas 689 ofertas, campo personalizado
"VALOR DO CURSO" vazio — e **falso para o webhook**, que manda `valor_do_curso`
no corpo. Conferido nos payloads reais guardados em `eventos_recebidos`. O
parser não lia esse campo, e o valor ia para o lixo na porta de entrada.

A ordem de precedência do valor da conversão, do mais confiável para o menos:

1. **`valor_do_curso` do webhook** — o preço daquela matrícula;
2. **API do Rubeus** (`valorCurso` / campo personalizado) — hoje sempre nulo,
   mas lida, para migrar sozinho no dia em que for preenchida;
3. **`conversao_acoes`** — o valor digitado na tela, por evento × nível de
   ensino. Deixou de ser a fonte e virou a rede de segurança.

Isso importa para lance: com o valor fixo da tela, o Smart Bidding otimizava
para a média do nível de ensino em vez do preço do curso que foi vendido.

### A contagem de leads estava 45% inflada

Medido em 08/09/2026: o painel mostrava **1.881 leads** onde existem **1.298
pessoas**. 583 que nunca existiram.

A causa era uma linha de SQL repetida em 17 lugares:

```sql
COUNT(DISTINCT COALESCE(email, telefone, contato_id))
```

O `COALESCE` resolve por **linha**, e a mesma pessoa tem várias — uma por etapa.
Quando a linha da inscrição traz e-mail e a do sync do Rubeus não traz (90%
delas não trazem), a primeira é contada pelo e-mail e a segunda pelo
`contato_id`. Duas chaves, uma pessoa. São 584 contatos nessa situação.

A intenção estava certa e continua valendo — quem tem e-mail deve ser contado
pelo e-mail, porque a mesma pessoa às vezes existe sob dois `contato_id` (78
e-mails em produção). O errado era resolver por linha em vez de por pessoa.

`leads_etapa.pessoa_id` (migration 0033) materializa a chave certa: o melhor
identificador que o contato tem em **qualquer** uma de suas linhas. `MIN` e não
"o mais recente" porque a chave precisa ser estável — um alvo que muda quando
chega evento novo faria o mesmo lead ser contado como pessoa diferente antes e
depois, que é o defeito original.

Mantida em dia pelo webhook, não por trigger: um trigger rodaria a agregação por
contato a cada INSERT, dentro do caminho crítico que precisa devolver 201 rápido
para o Rubeus.

### Identidade: uma biblioteca só, e a costura

`src/lib/identidade.ts` é a fonte única da normalização de e-mail, telefone,
CEP e nome. Antes existia **em duplicata** — uma cópia em `schemas.ts` (usada
quando o webhook grava o lead) e outra em `cliques.ts` (usada quando o script do
site grava a captura). As duas precisam produzir a mesma string, porque o
cruzamento entre clique e lead é uma comparação de igualdade entre elas; duas
cópias ficam iguais só até alguém corrigir uma, e o sintoma seria o cruzamento
parar de casar sem erro em lugar nenhum.

**A costura** resolve um problema medido em produção (05/09/2026):

| fonte das linhas de `leads_etapa` | linhas | com e-mail | com telefone |
|---|---|---|---|
| webhook | 3.837 | 2.605 (68%) | 3.709 (97%) |
| sync do Rubeus | 3.510 | 369 (10%) | 457 (13%) |

O parser do webhook está correto — quem chega sem identidade é o sync, que grava
a etapa sem buscar o contato. O ponto é que **o painel já tinha o dado em outra
linha**: 723 contatos nunca tiveram e-mail em nenhuma passagem, mas 410 deles
têm telefone em alguma. `identidadeDoContato()` varre todas as linhas do contato
antes de gastar chamada ao Rubeus — mais barato, e funciona com o CRM fora do ar.

**O contato canônico** resolve o outro lado: 78 e-mails e 79 telefones aparecem
sob `contato_id` diferentes — cerca de 90 cadastros que são a mesma pessoa. Como
o `orderId` é `contato + evento` e o Google deduplica por ele, a mesma matrícula
sob dois ids viraria **duas conversões** na conta de anúncios. O painel passa a
resolver o menor id que compartilha e-mail ou telefone, e usa esse no `orderId`.
Nada é fundido no Rubeus — fundir cadastro é decisão de quem opera o CRM.

Quando os dois cadastros têm metade do dado cada (um com o e-mail do formulário,
outro com o telefone e o CEP da ficha), a costura varre os dois.

### Três vias de atribuição, não duas

O identificador de **endereço** entrou como terceira via, e alcança justamente o
lead sem gclid e sem e-mail. Exige os quatro juntos — nome, sobrenome, país e
CEP —, e o formato não é uniforme: nome e sobrenome vão em SHA-256, país e CEP
vão **em claro**. Hashear os quatro é o engano natural e faz o Google aceitar o
evento sem casar com ninguém.

O CEP chega na Ficha de Inscrição do Rubeus (`cep`, `cidade`, `estado` no
corpo) e é espalhado para as outras passagens do mesmo lead pelo webhook.

### Duplicatas em `leads_etapa`

321 linhas exatamente duplicadas (162 grupos) — mesmo contato, etapa,
`registrado_em` e processo. Nada impedia a segunda gravação.

A prevenção está em `src/routes/webhooks.ts`, que consulta antes de gravar, e
**não** num índice UNIQUE: o índice não pode nascer sobre dados que já o violam,
e a migration falharia no meio do deploy. Quando as 321 forem revisadas e
removidas, `idx_leads_repetido` vira UNIQUE numa migration de uma linha e a
regra sai do código para o banco, que é o lugar dela.

O funil conta contatos distintos por etapa, então essas linhas não estão
inflando número hoje — por isso a limpeza pode esperar revisão humana.

### Segurança do que sai

- Nasce **desligado e em modo teste**. Em teste o envio usa `validateOnly`: o
  Google valida tudo, devolve os mesmos erros e não contabiliza nada. Passar
  para real reenvia o que foi simulado na janela, porque nunca chegou a contar.
- `orderId` estável por (contato, evento, registro de processo) — o Rubeus
  reemite gatilho, e sem isso a mesma matrícula contaria várias vezes.
- Escrever no Rubeus é interruptor separado, desligado por padrão:
  `/api/Contato/cadastro` é o mesmo endpoint que cria contato, e errar ali
  altera cadastro real em vez de devolver erro.
- Teto de cinco tentativas por linha: gclid expirado falha para sempre, e
  reencostar nele todo dia só gastaria cota.

## Funis e webhooks

Cada funil tem três links, um por canal, com token independente — dá para
revogar um sem derrubar os outros, e o evento chega sabendo a qual funil
pertence em vez de precisar ser casado por `processo_id` depois.

**Funis são cadastráveis; etapas não.** O Rubeus é a fonte da verdade das
etapas e cada processo usa um conjunto diferente; lista manual paralela vira
segunda verdade que diverge no primeiro rename feito lá. O que justifica
cadastrar o funil é a URL do webhook precisar existir antes do primeiro evento.

**O token não é guardado, só o hash dele.** Não dá para ter link com segredo e
"sem expor" ao mesmo tempo — o segredo está no link. O que dá é não guardar o
segredo: o D1 tem o SHA-256, que serve para conferir um token apresentado e não
para recuperá-lo. Um dump do banco deixou de conter credencial.

Consequência aceita: **não existe "copiar link"**. A URL completa aparece uma
única vez, na resposta de `POST /api/funis/:id/regerar/:canal`, e vai direto
para o clipboard sem ser desenhada na tela. Link perdido é regerado, não
reexibido — e regerar invalida o anterior na hora, então quem gera precisa
recolar no Rubeus. Cada geração fica no log com o e-mail de quem clicou.

Webhook sem link gerado é estado legítimo, não pendência: o funil existe, o
canal existe, a credencial só é emitida quando alguém for usar aquele canal.

**A tela inteira é administrativa.** `/api/funis*` exige estar em `ADMINS`
(wrangler.jsonc), não só passar pelo Access — ver **Acesso**.

**O fluxo de automação do Rubeus não manda a etapa no corpo.** Ele dispara por
gatilho de etapa, mas o payload que monta traz só dados do contato — a etapa
está no fluxo, não no dado. Por isso ela vai na URL: `…?t=<token>&etapa=Oportunidade`.
Um link por etapa que se queira monitorar, que é o próprio modelo de rastrear a
jornada. O corpo vence a query quando os dois trazem o campo: dado real do
evento é mais confiável que valor fixo na URL.

O corpo pode chegar como `application/x-www-form-urlencoded` — é o que o Rubeus
manda de fato — e os nomes de campo são os que quem configurou escolheu, então
o Worker reconhece apelidos (`id`, `nome`, `canal`, `cidade`, `etapa_atual`…).

Reenviar o mesmo evento é seguro: o funil conta contatos distintos por etapa,
então duplicata não infla número, e conversa é upsert.

"Resultados" é a soma de TODAS as conversões que a plataforma reporta — sem
allowlist de ação e sem usar `primary_for_goal`, que nesta conta marca como
primária inscrição em canal do YouTube e como secundária o "Concluiu Inscrição".
A métrica já nasce agregável por plataforma, para o Meta Ads somar depois.

## Filtros

Uma barra só, ancorada abaixo do título (`app/src/componentes/BarraFiltros.jsx`).
Substituiu o `FiltroPeriodo`, que era uma fileira solta de controles entre o
título e o conteúdo. Três problemas, três correções:

- **Lugar** — no Funil havia uma SEGUNDA leva de filtros dentro do cartão de
  baixo, com conjuntos diferentes conforme a aba (seis listas na consolidada,
  quatro na por processo). Quem queria recortar o número procurava em dois
  lugares. Agora tudo que filtra a tela mora na mesma faixa.
- **Recursos** — dava para escolher mês, ano ou intervalo e nada mais. "Mês
  passado" custava três cliques em dois seletores, e é a comparação mais feita.
  Entraram atalhos: Este mês, Mês passado, 7 dias, 30 dias, Este ano. O atalho
  acende comparando o período **resolvido**, então escolher 01/09–08/09 à mão
  acende "Este mês" — a barra não mente sobre o que está mostrando.
- **Espaçamento** — o seletor de modo era um `<select>` que nascia com `w-full`
  e ocupava a largura da tela sozinho, empurrando o resto para outra linha.
  Virou um segmentado: mostra as três opções de uma vez e troca com um clique.

O `w-full` do `Select` era a causa raiz e afetava toda barra de filtros do
painel. A base não impõe mais largura; quem precisa preencher a célula pede
`className="w-full"` — exceção declarada em vez de regra imposta.

De quebra, o Funil pedia `/api/catalogo/cursos` e `/api/catalogo/filtros` em
cada aba, montando as mesmas listas duas vezes. A busca subiu para o componente
pai e as duas abas leem do mesmo lugar.

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
- **O funil é sempre de um só.** Somar funis gera taxa acima de 100%, porque
  cada um usa um conjunto diferente de etapas. Na primeira visita o painel
  assume o de maior volume.
- **As etapas vêm do dado, não de lista fixa no código.** A lista canônica de
  oito nomes que existia aqui estava errada para três dos quatro funis reais, e
  qualquer rename feito no Rubeus quebraria em silêncio. A ordem sai da
  contagem de contatos distintos em ordem decrescente — a própria semântica de
  funil — e se autocorrige conforme o dado chega.

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

6. **Token de webhook por funil × canal**, opaco, de 32 bytes de
   `crypto.getRandomValues`, guardado só como SHA-256. Sem sal e sem KDF de
   propósito: sal protege contra tabela pré-computada e KDF lento contra força
   bruta, e nenhum dos dois alcança 32 bytes de CSPRNG — só somariam latência em
   todo webhook recebido.

7. **JWT do Access verificado no Worker**, com `alg` fixo em RS256 — aceitar o
   algoritmo que o token pede é deixar o atacante escolher o cadeado.

8. **CSP com `connect-src 'self'`** nos assets (`app/public/_headers`). Script
   injetado por dependência comprometida ou extensão não tem para onde mandar o
   que ler na tela. `Referrer-Policy: no-referrer` impede que o `?t=` de um
   webhook escape no cabeçalho Referer, e `no-store` mantém dado de lead fora de
   qualquer cache no caminho.

## Pendências que não são código

Nenhum valor real foi commitado — os lugares que precisam de credencial estão
marcados com `TODO` no `wrangler.jsonc` e no `.dev.vars.example`.

Para a conversão offline entrar em operação, nesta ordem:

1. **Registrar o redirect** `https://painel.ide.edu.br/oauth/google/callback` no
   cliente OAuth do Google Cloud Console, e habilitar a **Data Manager API** no
   projeto. Depois, "Conectar Google" na tela — sem isso todo envio volta 403.
   Confirmado em 05/09/2026 com uma chamada real em `validateOnly`: a Data
   Manager API respondeu `403 ACCESS_TOKEN_SCOPE_INSUFFICIENT` — "Request had
   insufficient authentication scopes". O transporte está pronto e o token
   atual, herdado do secret, não carrega `datamanager`. É o único passo que
   falta para o primeiro envio sair.
2. **Aceitar os termos de dados do cliente** no Google Ads (Ferramentas →
   Conversões). É o que autoriza a conversão aprimorada por e-mail/telefone.
3. **Criar as ações de conversão** por evento × nível de ensino. A conta tem 45
   ações, e nenhuma é do tipo `UPLOAD_CLICKS` — as existentes são de página, de
   chamada ou do GA4, e não aceitam envio offline. A tela cria pela API, uma por
   célula da grade.
4. **Criar o campo personalizado de gclid** no Rubeus (em Contato) e apertar
   "Procurar o campo de gclid" na tela. Conferido em 19/08/2026: os 45 campos da
   conta não incluem gclid, gbraid, wbraid nem UTM.
5. **Colar a tag** `/coleta/ide-clique.js` nas landing pages e na página do
   formulário, e ligar a captura.

Os passos 4 e 5 melhoram a atribuição; **não** são pré-requisito. Com 1 a 3
feitos, a conversão já sai por e-mail/telefone em hash.

## Checklist operacional (pós-reunião Nathália × Ryan)

Itens que **não** entram no repositório — ficam com operação / marketing / CRM:

1. **Reunião Rubeus** — alinhar etapas canônicas por processo e o que deve
   aparecer no funil (qualificados vs intenção). O mapa no painel (`#/etapas`)
   só aplica a decisão; não a inventa.
2. **Tags RD Marketing** — revisar automações e tags que inflacionam leads (pico
   artificial). O Macro alerta quando leads RD > 2× a média histórica; o número
   continua visível.
3. **gclid no site** — garantir captura na landing e devolução ao Rubeus (campo
   personalizado + tag `/coleta/ide-clique.js`). Ver pendências de conversão
   offline acima.
4. **Ações Google Ads** — criar/confirmar ações `UPLOAD_CLICKS` por evento ×
   nível; aceitar termos de dados do cliente.

### Limitação: fichas duplicadas no CRM

O Rubeus às vezes emite **mais de um id de contato** para a mesma pessoa
(e-mail/telefone repetidos). O painel junta pelo e-mail/telefone quando consegue,
e marca "N cadastros no CRM" na lista de leads — mas **não deduplica fichas no
Rubeus**. Contagens de funil podem ainda refletir a duplicata se os ids não
compartilham identificador. Limpeza de cadastro é operação no CRM, não neste
painel.
