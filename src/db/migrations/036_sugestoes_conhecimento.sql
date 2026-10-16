-- src/db/migrations/036_sugestoes_conhecimento.sql
-- Clínica Exemplo Bot — migration 036: sugestões de conhecimento
--
-- Quando o bot encaminha uma conversa pra humano com categoria "outro"
-- (dúvida que a base de conhecimento não resolveu — ver
-- src/functions/encaminharHumano.js), a pergunta do paciente é registrada
-- aqui como candidata a virar uma entrada nova na base de conhecimento.
-- Fica pendente até alguém da equipe revisar no dashboard: aprovar (escreve
-- a resposta e cria a entrada de verdade em base_conhecimento) ou descartar.
-- Nunca vira resposta automática sozinha — zero risco de informação errada
-- ir pro ar sem revisão humana.

CREATE TABLE IF NOT EXISTS sugestoes_conhecimento (
  id SERIAL PRIMARY KEY,
  pergunta TEXT NOT NULL,
  paciente_telefone TEXT,
  paciente_nome TEXT,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovada', 'descartada')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sugestoes_conhecimento_status ON sugestoes_conhecimento (status);
