# Plano de Implementação — Painel Faculdade IDE

Documento de handoff para o Claude Code. Cobre arquitetura, decisões já fechadas, contratos de dados, schema e ordem de construção. Não redecidir nada que já está marcado como ✅ Decidido — só implementar.

Arquivos de referência que acompanham este plano:
- `ide-painel-design-system.md` — cores, tipografia, espaçamento, componentes
- `ide-painel-tokens.css` — tokens CSS prontos
- `ide-painel-preview-desktop.html` — mockup desktop
- `ide-painel-preview-mobile.html` — mockup mobile
- `ide-painel-n8n-fluxo-conversao.json` — workflow n8n de teste (webhook Rubeus → API Rubeus), já validado e funcionando

---

## 1. Visão geral

Sistema que fecha o loop entre anúncio pago (Google Ads), CRM de admissões (Rubeus), automação (n8n) e um painel de acompanhamento pra liderança da IDE. O Rubeus é a fonte de verdade do funil — dispara eventos em paralelo para o n8n (que aciona conversões no Google Ads) e para o Cloudflare (que armazena histórico e alimenta o painel).

---

## 2. Decisões já fechadas (não reabrir)

| Tema | Decisão |
|---|---|
| Armazenamento do painel | ✅ Cloudflare D1 (SQLite gerenciado). Não usar KV nem banco externo. |
| Escrita no D1 | ✅ Só via Cloudflare Worker — D1 não tem API pública, n8n não escreve direto nele. |
| Evolution API (WhatsApp) | ✅ Aceito o risco de ban. Uso **somente leitura** — captura conversas via webhook, **nenhum disparo** de mensagem sai por aqui. |
| Papel do n8n | ✅ Dois fluxos: (1) reage a webhook de etapa do Rubeus e dispara conversão pro Google Ads; (2) roda agendado, puxa métricas da API do Google Ads (investimento, CPC, CTR, impressões) e envia pro Cloudflare Worker. |
| Papel do Cloudflare Worker | ✅ Recebe webhooks do Rubeus (etapa), da Evolution API (conversas) e do n8n (resultado de conversão + métricas de Ads). Valida origem, grava no D1, serve os dados pro painel. |
| Disparo duplicado do Rubeus | ✅ Cada gatilho de etapa monitorada precisa de **duas** ações de Requisição HTTP no fluxo de automação do Rubeus: uma pro n8n, outra pro Worker. |
| Autenticação da API Rubeus | ✅ POST com `{ id, origem, token }` no corpo JSON — **não** é header. `origem = 222` (canal "Consulta de Contato"). |
| Segurança do Worker | ✅ Header secreto compartilhado (`X-Webhook-Secret`) obrigatório em todo POST recebido, validado antes de gravar qualquer coisa. |
| Design visual | ✅ Fechado em `ide-painel-design-system.md` / `ide-painel-tokens.css`. Preto + azul institucional (`#2B5797`), Inter, grid de 4px, cards `radius-lg`. |
| gclid | ⚠️ Ainda **não existe** no Rubeus. Bloqueia conversão offline por clique até ser criado (ver Fase 0). |
| Login do painel | ✅ Cloudflare Access (Zero Trust) — sem tela de login própria, sem senha compartilhada. Access fica na frente do domínio do painel e barra qualquer request não autorizado antes de chegar no Worker/Pages. |

---

## 3. Pendências que são passo manual, não código

O Claude Code **não** resolve isso escrevendo código — são ações dentro dos painéis do Rubeus/Google Ads que uma pessoa precisa fazer:

1. Criar campo personalizado `gclid` no Rubeus (Cadastros → Campos personalizados).
2. Configurar o site/formulário de inscrição pra capturar `gclid` da URL e enviar no `camposPersonalizados` ao criar/atualizar o contato.
3. Criar as ações de conversão "Importada" no Google Ads (`Oportunidade Paga`, `Matrícula Comercial Concluída`) e pegar o `conversion_action` resource name de cada uma.
4. Configurar, dentro de cada processo (Pós-Graduação, Graduação, Curta e média duração), o fluxo de automação com gatilho na etapa "Oportunidade paga" com os dois HTTP requests (n8n + Worker), canal certo marcado (não só "CRM" — incluir "Ficha de Inscrição" e outros canais reais de origem).
5. Gerar o token de API do canal "Consulta de Contato" e guardar como secret no n8n (não commitar em texto puro).
6. Gerar o `X-Webhook-Secret` e configurar nos headers customizados do Rubeus/Evolution API e como variável de ambiente no Worker.

O Claude Code deve deixar esses pontos como `TODO` explícitos no código (variável de ambiente vazia, comentário), nunca inventar um valor placeholder que pareça real.

---

## 4. Schema do Cloudflare D1

```sql
CREATE TABLE leads_etapa (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contato_id TEXT NOT NULL,
  registro_processo_id TEXT,
  processo_id TEXT,
  processo_nome TEXT,
  etapa TEXT NOT NULL,
  status TEXT,
  curso_id TEXT,
  curso_codigo TEXT,
  origem TEXT,
  modalidade TEXT,
  unidade TEXT,
  responsavel_comercial TEXT,
  registrado_em TEXT NOT NULL,      -- timestamp ISO do evento
  criado_em TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_leads_etapa_contato ON leads_etapa (contato_id);
CREATE INDEX idx_leads_etapa_processo ON leads_etapa (processo_id, etapa);

CREATE TABLE conversoes_ads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contato_id TEXT NOT NULL,
  etapa TEXT NOT NULL,               -- 'Oportunidade paga' | 'Matrícula comercial concluída'
  gclid TEXT,
  conversion_action TEXT,
  valor REAL,
  status TEXT NOT NULL,              -- 'enviada' | 'sem_gclid' | 'erro_api' | 'pendente'
  erro_detalhe TEXT,
  enviado_em TEXT,
  criado_em TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_conversoes_status ON conversoes_ads (status);

CREATE TABLE metricas_anuncio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,                -- YYYY-MM-DD
  campanha_id TEXT,
  campanha_nome TEXT,
  investimento REAL,
  impressoes INTEGER,
  cliques INTEGER,
  cpc_medio REAL,
  ctr REAL,
  conversoes_primarias REAL,
  conversoes_secundarias REAL,
  criado_em TEXT DEFAULT (datetime('now')),
  UNIQUE(data, campanha_id)
);

CREATE TABLE conversas_whatsapp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contato_id TEXT,
  contato_nome TEXT,
  atendente TEXT,
  iniciada_em TEXT NOT NULL,
  respondida INTEGER DEFAULT 0,
  tempo_resposta_min REAL,
  criado_em TEXT DEFAULT (datetime('now'))
);
```

---

## 5. Cloudflare Worker — contrato dos endpoints

Todos os endpoints exigem header `X-Webhook-Secret` (exceto os GET usados pelo painel, que usam sessão/token de app separado — definir na Fase 4).

| Método | Rota | Origem | Ação |
|---|---|---|---|
| POST | `/webhook/rubeus/etapa` | Fluxo de automação do Rubeus | Insere em `leads_etapa` |
| POST | `/webhook/evolution/conversa` | Evolution API | Insere/atualiza em `conversas_whatsapp` |
| POST | `/webhook/n8n/conversao` | n8n (após enviar ao Google Ads) | Insere em `conversoes_ads` |
| POST | `/webhook/n8n/metricas` | n8n (polling agendado) | Upsert em `metricas_anuncio` (por `data` + `campanha_id`) |
| GET | `/api/overview` | Painel | Agregados da Visão Geral (cards + gráficos) |
| GET | `/api/funil?processo_id=` | Painel | Contagem por etapa do processo pedido |
| GET | `/api/conversoes` | Painel | Lista paginada de `conversoes_ads` |
| GET | `/api/conversas` | Painel | Lista paginada de `conversas_whatsapp` |

Toda rota POST deve validar schema do corpo antes de gravar (rejeitar campo faltante com 400, nunca gravar linha parcial silenciosamente).

---

## 6. n8n — dois fluxos

### 6.1 Fluxo "Conversão por etapa" (evolução do `ide-painel-n8n-fluxo-conversao.json`)
Já existe e já foi validado ponta a ponta: Webhook → Normalizar Payload → Filtrar etapa → Buscar Contato (API Rubeus) → Extrair dados do contato.
**Falta adicionar** (novos nodes no final da cadeia):
1. **IF: tem gclid?** → se não tiver, POST pro Worker com `status: "sem_gclid"` e para.
2. **Montar ClickConversion** (Code node) — payload pro Google Ads API:
```json
{
  "conversion_action": "customers/{customer_id}/conversionActions/{conversion_action_id}",
  "gclid": "{{ $json.gclid }}",
  "conversion_date_time": "{{ $json.consultado_em }} -03:00",
  "conversion_value": 0,
  "currency_code": "BRL",
  "order_id": "{{ $json.contato_id }}-{{ $json.etapa_atual }}"
}
```
3. **HTTP Request → Google Ads API** (`POST /customers/{id}/conversionUploads:uploadClickConversions`, auth OAuth2 + developer token — credenciais entram como credencial nativa do n8n, nunca hardcoded).
4. **HTTP Request → Worker** (`/webhook/n8n/conversao`) gravando o resultado (sucesso ou erro) — sempre executa, tanto no caminho de sucesso quanto no de erro (usar branch de erro do node anterior).

### 6.2 Fluxo "Métricas agendadas" (novo, do zero)
Schedule Trigger (a cada 1h) → HTTP Request (Google Ads Reporting API, `campaign` report com métricas do dia) → Code node (normaliza por campanha) → HTTP Request → Worker (`/webhook/n8n/metricas`).

---

## 7. Frontend do painel

Usar `ide-painel-preview-desktop.html` e `ide-painel-preview-mobile.html` como referência de verdade — não redesenhar do zero, só trocar dado mockado por chamada real aos endpoints GET do Worker (seção 5). Manter breakpoint único (< 768px = layout mobile da seção do preview mobile; ≥768px = layout desktop).

Páginas, na ordem de prioridade:
1. Visão geral (`/api/overview`)
2. Funil por processo (`/api/funil`) — seletor pra trocar entre os processos
3. Conversões enviadas (`/api/conversoes`)
4. Conversas (`/api/conversas`)

---

## 8. Ordem de implementação

**Fase 0 — Desbloqueio (manual, seção 3)**
Sem isso, nada de conversão real funciona. Pode ser feito em paralelo às fases técnicas, mas nenhuma conversão real dispara antes disso estar pronto.

**Fase 1 — Cloudflare Worker + D1**
Criar schema (seção 4), implementar os endpoints POST (seção 5) com validação de `X-Webhook-Secret`, deploy.

**Fase 2 — Completar o fluxo n8n de conversão**
Adicionar os 4 nodes da seção 6.1 ao workflow existente. Testar com um lead de teste real chegando em "Oportunidade paga" (mesmo sem gclid ainda — validar que cai certinho no branch "sem_gclid" e grava no Worker).

**Fase 3 — Fluxo de métricas agendado**
Seção 6.2, do zero.

**Fase 4 — Frontend + Cloudflare Access**
Ligar os mockups HTML às rotas GET do Worker. Configurar Cloudflare Access no domínio do painel:
- Application no Zero Trust apontando pro domínio/subdomínio do painel.
- Policy de acesso por e-mail (lista de e-mails da liderança IDE) ou por domínio de e-mail corporativo (`@faculdadeide.edu.br`), o que cobrir todo mundo sem manter lista manual.
- As rotas GET do Worker (seção 5) não precisam de lógica de autenticação própria — o Access já barra tudo que não estiver autenticado antes de chegar no Worker. Se precisar saber *quem* está acessando (auditoria, personalização), o Worker pode ler o header `Cf-Access-Authenticated-User-Email` que o Access injeta automaticamente — não precisa validar JWT manualmente a menos que quiéra uma segunda camada de verificação.
- Os endpoints POST (seção 5, usados por Rubeus/n8n/Evolution) ficam **fora** do Access — continuam protegidos só pelo `X-Webhook-Secret`, já que são chamadas de servidor pra servidor, não de humano logando.

**Fase 5 — Ponta a ponta**
Só depois da Fase 0 concluída: lead real passa por todo o funil, conversão chega no Google Ads com gclid de verdade, aparece no painel com status "Enviada".

---

## 9. O que o Claude Code não deve inventar

- Credenciais, tokens, secrets ou IDs de conversion action reais — sempre variável de ambiente vazia com comentário indicando onde pegar o valor.
- Nomes de etapa/processo diferentes dos reais do Rubeus (usar exatamente: Novo Lead, Conexão, Em qualificação, Inscrito parcial, Oportunidade, Oportunidade paga, Aptos para matrícula, Matrícula comercial concluída — e os nomes de coluna específicos por processo, como "Iniciou o processo de inscrição" em Qualificação de Leads).
- Cores ou espaçamentos fora do `ide-painel-tokens.css`.
