-- Clínica Exemplo Bot — schema inicial
-- Rodar no SQL Editor do Neon (ou via psql) antes de subir a aplicação.

CREATE TABLE IF NOT EXISTS pacientes (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  telefone TEXT NOT NULL UNIQUE,
  convenio TEXT,
  etapa_atual TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agendamentos (
  id SERIAL PRIMARY KEY,
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id),
  data DATE NOT NULL,
  hora TIME NOT NULL,
  tipo_atendimento TEXT NOT NULL CHECK (tipo_atendimento IN ('fisioterapia', 'psicologia')),
  status TEXT NOT NULL DEFAULT 'confirmado' CHECK (status IN ('confirmado', 'cancelado', 'concluido')),
  google_event_id TEXT,
  primeira_consulta BOOLEAN,
  queixa_principal TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversas (
  id SERIAL PRIMARY KEY,
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id),
  mensagem TEXT NOT NULL,
  remetente TEXT NOT NULL CHECK (remetente IN ('paciente', 'bot')),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS base_conhecimento (
  id SERIAL PRIMARY KEY,
  pergunta TEXT NOT NULL,
  resposta TEXT NOT NULL,
  categoria TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversas_paciente_id ON conversas (paciente_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_agendamentos_data ON agendamentos (data, tipo_atendimento);

-- O Supabase expõe toda tabela via API REST pública (roles "anon"/
-- "authenticated") por padrão — nosso backend conecta direto no Postgres
-- (usuário/senha), então não precisa dessa API. Isso é específico do
-- Supabase: em qualquer outro Postgres (Neon, local, etc.) essas roles nem
-- existem, então o bloco abaixo só age quando detecta que está rodando lá —
-- em qualquer outro lugar, roda sem fazer nada (e sem dar erro).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER TABLE pacientes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE agendamentos ENABLE ROW LEVEL SECURITY;
    ALTER TABLE conversas ENABLE ROW LEVEL SECURITY;
    ALTER TABLE base_conhecimento ENABLE ROW LEVEL SECURITY;
    -- Reforço extra: o Supabase concede acesso total nas tabelas do schema
    -- "public" para "anon"/"authenticated" por padrão. O RLS acima já
    -- bloqueia o acesso de qualquer forma, mas revogar a permissão elimina
    -- essa camada redundante — mesmo que o RLS seja desligado sem querer no
    -- futuro (ex: no painel do Supabase), essas roles continuam sem acesso.
    REVOKE ALL ON pacientes, agendamentos, conversas, base_conhecimento FROM anon, authenticated;
  END IF;
END $$;
