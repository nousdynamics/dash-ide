-- Dois preços por oferta, e a regra escolhe qual vai ao Google.
--
-- Conferido na API do Rubeus em 22/09/2026 (`/api/Curso/listarOfertas`, 705
-- ofertas): cada oferta traz DOIS valores, e eles significam coisas diferentes.
--
--   complemento = "197,00"   → o valor da INSCRIÇÃO
--   valor       = "6195.00"  → o valor TOTAL do curso
--
-- Reparar nos formatos: um vem com vírgula decimal e o outro com ponto. São
-- campos de texto digitados em telas diferentes do CRM, e tratar os dois com o
-- mesmo `Number()` faria "197,00" virar NaN — silenciosamente, porque valor
-- ausente não quebra o envio, só sobe a conversão valendo o padrão da tela.
--
-- Por que os dois, e não só um: a conversão de "Inscrição concluída" vale o que
-- a pessoa pagou para se inscrever, e a de "Pagamento realizado" vale o curso.
-- Mandar o total nas duas infla o retorno — mandar a inscrição nas duas some com
-- ele. Quem decide isso é a regra do mapa, evento a evento — não o código.

-- --------------------------------------------------------- na oferta
--
-- Guardados separados, e não um campo "valor" que muda de sentido conforme o
-- contexto. O nome da coluna é a documentação que sempre acompanha o dado.
ALTER TABLE curso_ofertas ADD COLUMN valor_total REAL;
ALTER TABLE curso_ofertas ADD COLUMN valor_inscricao REAL;

-- --------------------------------------------------------- na regra
--
-- Qual dos dois esta ação de conversão manda ao Google.
--
--   'total'     — o valor do curso (padrão: é o que o Smart Bidding otimiza)
--   'inscricao' — o valor da inscrição, vindo do complemento da oferta
--   'fixo'      — o número digitado na tela, ignorando o catálogo
--
-- `'total'` como padrão porque é o que as regras existentes já pretendiam
-- representar — nenhuma delas foi criada com a intenção de mandar taxa de
-- inscrição, e mudar o sentido de linha cadastrada seria reescrever o passado.
ALTER TABLE conversao_acoes ADD COLUMN base_valor TEXT NOT NULL DEFAULT 'total';

-- ----------------------------------------------------- no registro
--
-- A conversão guarda os dois valores que TINHA em mãos e qual deles usou.
--
-- Sem isso, "por que esta conversão subiu valendo R$ 197" só se responde
-- reconstituindo o catálogo do dia do envio — que já mudou. O registro existe
-- para não depender de reconstituição.
ALTER TABLE conversoes_offline ADD COLUMN valor_total REAL;
ALTER TABLE conversoes_offline ADD COLUMN valor_inscricao REAL;
ALTER TABLE conversoes_offline ADD COLUMN valor_base TEXT;

/*
 * A resolução do valor entra por `oferta_codigo`, que é a chave que liga a
 * conversão ao catálogo. O índice já existe desde a 0038 — este é o do lado do
 * curso, para a oferta encontrada pelo curso-pai quando o lead não traz oferta.
 */
CREATE INDEX IF NOT EXISTS idx_curso_ofertas_curso_id ON curso_ofertas (curso_id);
