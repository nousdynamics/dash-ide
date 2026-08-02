# Design System — Painel Faculdade IDE

Referência de estilo: dashboards fintech dark-mode enviados (Fintrixity + dashboard financeiro pessoal).
Direção de cor: preto como base, azul institucional da IDE como acento (substitui o laranja das referências).

Este documento é a fonte da verdade visual do projeto. Qualquer tela nova deve seguir os tokens e componentes abaixo — não improvisar cor, espaçamento ou raio de borda fora daqui.

---

## 1. Princípio de direção

Painel escuro, denso em dado, com um único acento de cor (azul) reservado para ação primária, destaque de gráfico e estado ativo. Hierarquia por contraste de superfície (preto → cinza-azulado escuro → card), não por sombra pesada. Números grandes carregam a informação; texto de apoio é sempre discreto.

---

## 2. Cor

### 2.1 Base e superfícies

| Token | Hex | Uso |
|---|---|---|
| `--bg-base` | `#0A0E14` | Fundo geral da página |
| `--bg-elevated` | `#10151D` | Sidebar, topbar |
| `--surface-card` | `#161C26` | Fundo de card |
| `--surface-card-hover` | `#1C232F` | Card em hover/seleção |
| `--border-subtle` | `rgba(255,255,255,0.06)` | Borda padrão de card |
| `--border-default` | `rgba(255,255,255,0.10)` | Borda de input, divisor |

### 2.2 Azul institucional (acento)

| Token | Hex | Uso |
|---|---|---|
| `--blue-900` | `#0B2545` | Fundo de badge escuro, gradiente base |
| `--blue-700` | `#1D4E89` | Hover de botão primário |
| `--blue-600` | `#2B5797` | **Âncora de marca IDE** — nav ativo, ícones de destaque |
| `--blue-500` | `#3B74B8` | Estados intermediários |
| `--blue-400` | `#4F8FE8` | Botão primário, linha/barra de gráfico, foco de input |
| `--blue-300` | `#7FB0F2` | Texto de link sobre fundo escuro |

### 2.3 Semânticas (mesma lógica que já vimos no Google Ads: Ativa / Requer atenção / Inativo)

| Token | Hex | Uso |
|---|---|---|
| `--success` | `#3DDC84` | Ativa, Completed, delta positivo |
| `--success-bg` | `rgba(61,220,132,0.12)` | Fundo de pill de sucesso |
| `--warning` | `#F5A623` | Requer atenção |
| `--warning-bg` | `rgba(245,166,35,0.12)` | Fundo de pill de atenção |
| `--danger` | `#F0553F` | Inativo, Perdida, delta negativo |
| `--danger-bg` | `rgba(240,85,63,0.12)` | Fundo de pill de erro |

### 2.4 Glassmorphism

Direção nova: superfícies elevadas (cards, sidebar, topbar) ganham vidro fosco — fundo translúcido + blur do que está atrás — em vez de cor sólida. Isso só funciona se tiver algo colorido pra desfocar atrás; por isso o fundo da página deixa de ser preto liso e ganha dois "blobs" de gradiente azul, fixos, bem desfocados, baixa opacidade — luz ambiente, não decoração chamativa.

| Token | Valor | Uso |
|---|---|---|
| `--glass-bg` | `rgba(22,28,38,0.55)` | Fundo de card |
| `--glass-bg-elevated` | `rgba(16,21,29,0.60)` | Fundo de sidebar/topbar |
| `--glass-border` | `rgba(255,255,255,0.10)` | Borda padrão do vidro |
| `--glass-border-top` | `rgba(255,255,255,0.18)` | Borda superior, mais clara — é o que vende o efeito de vidro pegando luz de cima |
| `--glass-blur` | `24px` | `backdrop-filter: blur()` padrão de card |

Regra de uso — **glass não é pra tudo**:
- ✅ Cards, sidebar, topbar, painéis flutuantes → recebem o tratamento de vidro.
- ❌ Pills de status, badges semânticos (`--success`/`--warning`/`--danger`) → continuam **sólidos tintados**, sem blur. Num painel de admissão a pessoa precisa reconhecer "Ativa" vs "Requer atenção" num piscar de olho — borrar isso pra parecer bonito piora a legibilidade, que é o oposto do que um painel de dado precisa fazer.
- ❌ Texto nunca fica sobre vidro sem um fundo com contraste suficiente por trás — sempre testar contra os dois blobs de fundo, não só contra preto liso.

### 2.5 Blobs de fundo

Dois elementos fixos, atrás de todo o conteúdo (`z-index: 0`), grandes (~600px), `border-radius: 50%`, `filter: blur(60-80px)`, gradiente radial saindo do azul e sumindo em transparente. Um no canto superior-esquerdo, outro no inferior-direito, opacidade baixa (~30-35% no centro do gradiente). Não anima — luz ambiente parada, não efeito de fundo "vivo".

### 2.6 Texto

| Token | Hex | Uso |
|---|---|---|
| `--text-primary` | `#F5F7FA` | Números grandes, títulos |
| `--text-secondary` | `#9AA5B4` | Labels, legendas de gráfico |
| `--text-muted` | `#626D7D` | Texto terciário, placeholder |

---

## 3. Tipografia

**Família:** Inter (UI e números). Se a IDE tiver uma fonte de marca confirmada depois, ela entra só em títulos de página — números e UI continuam em Inter por legibilidade em telas densas.
Números financeiros/métricas sempre com `font-feature-settings: "tnum"` (tabular, não "dança" ao atualizar).

| Estilo | Tamanho / Altura | Peso | Uso |
|---|---|---|---|
| `display-lg` | 36px / 44px | 700 | Número principal do card (ex: valor investido) |
| `display-md` | 28px / 36px | 700 | Números secundários de destaque |
| `h1` | 24px / 32px | 600 | Título de página ("Visão geral") |
| `h2` | 18px / 26px | 600 | Título de card/seção |
| `body` | 14px / 20px | 400 | Texto padrão |
| `label` | 13px / 18px | 500 | Rótulo de campo, cabeçalho de tabela |
| `caption` | 12px / 16px | 400 | Legenda, timestamp, texto auxiliar |

---

## 4. Espaçamento

Grid de 4px. Usar só estes valores — nunca números soltos:

`4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64`

Padding interno padrão de card: `24px`. Gap entre cards no grid: `16px` (mobile) / `24px` (desktop).

---

## 5. Raio e elevação

| Token | Valor | Uso |
|---|---|---|
| `--radius-sm` | 8px | Pills pequenas, chips |
| `--radius-md` | 12px | Botões, inputs |
| `--radius-lg` | 20px | Cards |
| `--radius-full` | 999px | Avatar, badge redondo, botão pill |

Sem sombra pesada. Elevação é só troca de superfície (`--surface-card` sobre `--bg-base`) + borda sutil. Se precisar de destaque extra num card (ex: card selecionado), usar `--border-default` + leve glow azul (`box-shadow: 0 0 0 1px var(--blue-600)`), nunca drop-shadow preto.

---

## 6. Componentes

### 6.1 Sidebar de navegação
Vidro (`--glass-bg-elevated` + `backdrop-filter: blur(var(--glass-blur))`), borda `--glass-border` com topo em `--glass-border-top`. Item ativo: pill com fundo `--blue-600` a 100% (sólido — item ativo não é vidro, precisa ser o ponto mais opaco da tela), texto branco. Itens inativos: ícone + label em `--text-secondary`. Badge de contagem (número) alinhado à direita do item, fundo `--surface-card`, texto `--text-secondary`.

### 6.2 Topbar
Mesmo vidro da sidebar. Input de busca em pill (`--surface-card` sólido — não vidro, pra não competir com o blur de fundo em cima do blur da topbar), placeholder `--text-muted`, atalho de teclado à direita em chip discreto. Ícones de ação (ajuda, notificação, tema) em botão circular `--surface-card`. Avatar + nome do usuário à direita.

### 6.3 Card de estatística (grid de 3)
Vidro (`--glass-bg` + blur). Ícone em quadrado arredondado (`--radius-md`) com fundo tintado na cor semântica ou azul — esse ícone continua sólido, é ponto focal, não pode desbotar. Label eyebrow em `--text-secondary`. Número em `display-md` ou `display-lg`. Chip de delta (`--success`/`--danger`) ao lado do número — sólido tintado, mesma regra de pills. Link de rodapé ("Ver detalhes →") em `--blue-300`.

**Aplicação no projeto:** Investimento total, Conversões (Primárias), Conversões (Secundárias), Custo por conversão, Leads no período.

### 6.4 Card de gráfico — barras (estilo "Cash Flow")
Toggle de período em pills (Mensal/Anual) no canto superior direito. Barras com gradiente vertical na cor azul, uma barra em destaque (maior contraste) com tooltip flutuante ao hover mostrando data + valor + variação.

**Aplicação:** Investimento diário, Leads captados por dia, Conversas iniciadas por dia.

### 6.5 Card de gráfico — área/linha (estilo "Total Balance")
Toggle de intervalo (1 ano / 6 meses / 3 meses / 1 mês). Linha com preenchimento em gradiente azul (100% → transparente). Tooltip flutuante no ponto de hover. Legenda de rodapé com bolinha colorida + label + estatística agregada (ex: "Taxa média mensal").

**Aplicação:** Evolução de conversões ao longo do tempo, custo por conversão histórico.

### 6.6 Funil por etapa — componente novo (não está nas referências)
Faixa horizontal com um bloco por etapa do processo (Inscrito Parcial → Oportunidade → Oportunidade paga → Aptos para matrícula → Matrícula concluída). Cada bloco: número absoluto + label da etapa. Entre blocos, uma seta fina com a taxa de conversão percentual entre as duas etapas. Cor do bloco: `--surface-card` padrão; o bloco da etapa com maior queda percentual pode ganhar um contorno `--warning` sutil como alerta visual — sem exagerar, é um destaque, não um alarme.

**Aplicação:** Visão de funil por processo (Qualificação de Leads, Pós-Graduação, Graduação, Curta e média duração), replicando os nomes de etapa reais do Rubeus.

### 6.7 Pill de status
Sempre com fundo tintado + texto na cor semântica (nunca cor sólida cobrindo texto branco — mantém legibilidade em qualquer tema). Mapeamento direto do que já existe no Google Ads:
- `Ativa` / `Completed` → `--success` / `--success-bg`
- `Requer atenção` → `--warning` / `--warning-bg`
- `Inativo` / `Perdida` → `--danger` / `--danger-bg`

### 6.8 Tabela de atividade (estilo "Recent Activities")
Linha com: ícone/avatar da origem, nome/descrição, colunas de metadado em `--text-secondary`, valor alinhado à direita em `tnum`, pill de status na última coluna. Hover de linha: `--surface-card-hover`.

**Aplicação:** Lista de leads recentes por etapa, lista de conversões enviadas ao Google Ads (com status de sucesso/erro do envio).

### 6.9 Lista de conversa (estilo "Recent Transactions")
Avatar circular com iniciais (sem foto real — LGPD, é lead, não cliente confirmado), nome do contato + timestamp, métrica à direita (tempo de resposta, canal, atendente responsável).

**Aplicação:** Conversas do WhatsApp (via Evolution API) — só leitura, sem ação de disparo, como já alinhado.

### 6.10 Botões
- **Primário:** fundo `--blue-400`, texto branco, `--radius-full` ou `--radius-md`, hover escurece para `--blue-600`.
- **Secundário:** borda `--border-default`, fundo transparente, texto `--text-primary`, hover ganha `--surface-card-hover`.
- **Ghost/ícone:** círculo `--surface-card`, ícone `--text-secondary`, hover `--surface-card-hover`.

### 6.11 Card promocional / estado vazio
Fundo com imagem escura + overlay, texto branco, CTA em botão branco sólido (única exceção ao azul — usado só aqui, pra não competir com dado real). Reaproveitar para onboarding: "Nenhuma conversão offline configurada ainda → Configurar agora".

---

## 7. Regras de aplicação (para o Claude Code seguir)

1. Nunca usar cor fora da tabela da seção 2. Se precisar de uma variação, derive por opacidade (`rgba()`), não invente hex novo.
2. Todo número financeiro/métrica usa `font-feature-settings: "tnum" 1`.
3. Pills de status usam sempre fundo tintado (`-bg`) + texto na cor cheia — nunca fundo sólido.
4. Espaçamento só nos valores da seção 4.
5. Cards sempre `--radius-lg` (20px); nunca variar raio de card por tela.
6. O azul (`--blue-400`) é o único acento vibrante do sistema — não introduzir laranja, roxo ou outras cores de destaque além das semânticas (verde/âmbar/vermelho).
7. Superfícies elevadas (card/sidebar/topbar) usam vidro (`--glass-bg` + `backdrop-filter: blur(24px)`); pills, badges, ícones de destaque e o item de nav ativo continuam sólidos — vidro nunca cobre um elemento que precisa ser lido rápido.
8. Todo fundo de página precisa dos dois blobs (seção 2.5) fixos atrás do conteúdo — sem eles o vidro não tem o que desfocar e vira só uma cor semitransparente sem graça.
