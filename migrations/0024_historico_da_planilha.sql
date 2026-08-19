-- Os meses fechados da planilha, dentro da ferramenta.
--
-- Até aqui o painel começava em agosto: antes disso os webhooks não entregavam,
-- e a API do Rubeus não tem listagem por período para reconstruir (a seção
-- "Métodos de listagem" da doc tem nove endpoints e nenhum aceita intervalo de
-- datas; o único com `de`/`ate` lista chamadas de API, não registros). Quem
-- abria junho via o topo pelo RD e o resto vazio.
--
-- O que existe de janeiro a junho é a planilha, preenchida à mão por quem opera
-- o CRM. É um agregado por mês — não dá para fundir com `leads_etapa`, que é
-- evento por pessoa: não existem "as 102 pessoas" por trás do 102 de junho.
-- Por isso entra em tabela própria, é exibido com a fonte "Planilha" ao lado do
-- número, e não abre lista — não há quem listar, e um ícone que abrisse gaveta
-- vazia mentiria sobre a natureza do dado.
--
-- Nunca sobrescreve medição. Visitantes e Leads desses meses continuam vindo do
-- RD, que mediu de verdade e continua medindo; a planilha entra só nas quatro
-- etapas de baixo, que são as que ninguém mais sabe informar. Junho fica com
-- 21.695 visitantes do RD e 746 qualificados da planilha, cada um com sua
-- etiqueta, em vez de fingir consenso onde não há.

CREATE TABLE IF NOT EXISTS funil_historico (
  mes   TEXT NOT NULL,              -- 'yyyy-mm'
  etapa TEXT NOT NULL,              -- chave das 6 etapas da planilha
  valor INTEGER NOT NULL,
  PRIMARY KEY (mes, etapa)
);

CREATE TABLE IF NOT EXISTS funil_historico_categoria (
  mes        TEXT NOT NULL,
  categoria  TEXT NOT NULL,
  inscricoes INTEGER NOT NULL DEFAULT 0,
  matriculas INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (mes, categoria)
);

-- As 6 etapas por mês, como a planilha traz.
INSERT OR REPLACE INTO funil_historico (mes, etapa, valor) VALUES
  ('2026-01','visitantes',15000),
  ('2026-01','leads',1241),
  ('2026-01','qualificados',1162),
  ('2026-01','oportunidade',388),
  ('2026-01','inscricao',99),
  ('2026-01','matricula',80),
  ('2026-02','visitantes',14000),
  ('2026-02','leads',958),
  ('2026-02','qualificados',861),
  ('2026-02','oportunidade',293),
  ('2026-02','inscricao',101),
  ('2026-02','matricula',75),
  ('2026-03','visitantes',18000),
  ('2026-03','leads',1122),
  ('2026-03','qualificados',1090),
  ('2026-03','oportunidade',368),
  ('2026-03','inscricao',98),
  ('2026-03','matricula',82),
  ('2026-04','visitantes',20000),
  ('2026-04','leads',2266),
  ('2026-04','qualificados',513),
  ('2026-04','oportunidade',281),
  ('2026-04','inscricao',97),
  ('2026-04','matricula',92),
  ('2026-05','visitantes',18000),
  ('2026-05','leads',787),
  ('2026-05','qualificados',550),
  ('2026-05','oportunidade',278),
  ('2026-05','inscricao',88),
  ('2026-05','matricula',80),
  ('2026-06','visitantes',18000),
  ('2026-06','leads',979),
  ('2026-06','qualificados',746),
  ('2026-06','oportunidade',270),
  ('2026-06','inscricao',121),
  ('2026-06','matricula',102);

-- A tabela de categorias. Em janeiro as sete linhas somam 89 inscrições
-- contra 99 na etapa do funil: a divergência é da planilha, não da importação,
-- e some se alguém "ajustar" um dos dois. Fica como está, e a tela mostra os 10
-- que faltam como não detalhados — nos outros cinco meses fecha exato.
INSERT OR REPLACE INTO funil_historico_categoria (mes, categoria, inscricoes, matriculas) VALUES
  ('2026-01','pos_presencial',70,66),
  ('2026-01','pos_ead',4,1),
  ('2026-01','pos_medicina',12,13),
  ('2026-01','grad_rh_ead',3,0),
  ('2026-02','pos_presencial',41,38),
  ('2026-02','pos_ead',33,18),
  ('2026-02','pos_medicina',8,6),
  ('2026-02','grad_rh_ead',11,11),
  ('2026-02','grad_estetica',2,2),
  ('2026-02','curta_duracao',6,0),
  ('2026-03','pos_presencial',61,44),
  ('2026-03','pos_ead',16,32),
  ('2026-03','pos_medicina',10,3),
  ('2026-03','grad_rh_ead',1,1),
  ('2026-03','grad_estetica',3,2),
  ('2026-03','curta_duracao',7,0),
  ('2026-04','pos_presencial',56,59),
  ('2026-04','pos_ead',8,7),
  ('2026-04','pos_medicina',9,2),
  ('2026-04','curta_duracao',24,24),
  ('2026-05','pos_presencial',52,58),
  ('2026-05','pos_ead',15,12),
  ('2026-05','pos_medicina',9,10),
  ('2026-05','curta_duracao',12,0),
  ('2026-06','pos_presencial',82,81),
  ('2026-06','pos_ead',3,1),
  ('2026-06','pos_medicina',8,5),
  ('2026-06','grad_estetica',1,1),
  ('2026-06','curta_duracao',27,14);
