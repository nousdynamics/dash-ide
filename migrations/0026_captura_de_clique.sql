-- Captura do gclid antes do lead existir.
--
-- O problema que esta tabela resolve: o gclid só existe no navegador de quem
-- clicou no anúncio. O Rubeus nunca o vê, porque ninguém o entrega — o campo
-- personalizado pode existir no CRM e continuar vazio para sempre. Foi
-- exatamente o que aconteceu com o fluxo do n8n, que procurava um gclid que
-- nada nunca gravou.
--
-- O caminho, então, é capturar no lugar onde o dado ainda está vivo: a página.
-- Um script de primeira parte guarda o click id do visitante e, no momento em
-- que ele digita e-mail ou telefone num formulário, manda os três juntos para
-- cá. Quando o webhook do Rubeus trouxer esse mesmo lead, o painel cruza pelo
-- e-mail/telefone, recupera o click id, escreve de volta no campo do Rubeus e
-- envia a conversão com atribuição de clique em vez de só e-mail em hash.
--
-- A captura é auxiliar, não pré-requisito: sem nada aqui, a conversão continua
-- sendo enviada por e-mail/telefone em hash. Isto melhora a atribuição, não a
-- destrava.

CREATE TABLE cliques_capturados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  click_id_tipo TEXT NOT NULL,      -- 'gclid' | 'gbraid' | 'wbraid'
  click_id_valor TEXT NOT NULL,

  /*
   * A chave do cruzamento, já normalizada na entrada.
   *
   * Mesma normalização de schemas.ts — e-mail em minúsculas, telefone só com
   * dígitos e DDI. Guardar como veio da tela faria "Joao@" e "joao@" virarem
   * duas pessoas, e o cruzamento falharia justamente nos leads que o script
   * capturou certo.
   */
  email TEXT,
  telefone TEXT,

  pagina TEXT,                      -- onde a captura aconteceu, para diagnóstico
  origem_site TEXT,                 -- host que enviou, conferido contra a lista

  capturado_em TEXT DEFAULT (datetime('now')),

  /* Preenchidos quando o clique encontra o lead correspondente. */
  contato_id TEXT,
  casado_em TEXT,
  escrito_no_rubeus_em TEXT
);

/*
 * Deduplicação da própria captura.
 *
 * O script dispara a cada envio de formulário, e a mesma pessoa reenvia — erro
 * de validação, dois cursos, volta e refaz. Sem isto, uma tarde de navegação
 * viraria dezenas de linhas do mesmo clique e o cruzamento teria de escolher
 * entre cópias idênticas.
 */
CREATE UNIQUE INDEX idx_clique_unico
  ON cliques_capturados (click_id_valor, COALESCE(email, ''), COALESCE(telefone, ''));

-- O cruzamento entra por e-mail ou por telefone, sempre pegando o mais recente.
CREATE INDEX idx_clique_email ON cliques_capturados (email, capturado_em);
CREATE INDEX idx_clique_telefone ON cliques_capturados (telefone, capturado_em);

/*
 * Escrever de volta no Rubeus nasce DESLIGADO.
 *
 * `/api/Contato/cadastro` é o mesmo endpoint que cria e atualiza contato: um
 * corpo errado não devolve erro, atualiza o cadastro real de uma pessoa no CRM
 * de onde sai a operação comercial inteira. Ligar isso é decisão de quem
 * administra, tomada depois de ver o cruzamento funcionando na tela — não um
 * efeito colateral de instalar o script.
 *
 * `clickid_coluna` fica vazio de propósito: o painel descobre a coluna
 * consultando os campos personalizados do Rubeus pelo nome. Fixar
 * `campopersonalizado_24_compl_cont` aqui quebraria no dia em que o campo fosse
 * recriado, e quebraria calado.
 */
INSERT INTO conversao_config (chave, valor) VALUES
  ('captura_ligada', '0'),
  ('escrever_no_rubeus', '0'),
  ('clickid_coluna', ''),
  ('origens_permitidas', 'faculdadeide.edu.br,curtaduracao.faculdadeide.edu.br,crmide.apprubeus.com.br');
