-- src/db/migrations/018_pacotes_sessao.sql
-- Clínica Exemplo Bot — migration 018: pacotes de sessão de Fisioterapia.
-- Rodar no SQL Editor do Neon (ou via psql) depois de 017_laudos.sql.
-- ATENÇÃO: este projeto não tem banco de dev separado do de produção — só
-- aplicar depois de confirmar com o usuário (ver spec deste sub-projeto:
-- docs/superpowers/specs/2026-09-01-pacotes-sessao-design.md).

CREATE TABLE IF NOT EXISTS pacotes_sessoes (
  id SERIAL PRIMARY KEY,
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id),
  quantidade_total INTEGER NOT NULL CHECK (quantidade_total > 0),
  cancelado BOOLEAN NOT NULL DEFAULT false,
  criado_por INTEGER NOT NULL REFERENCES usuarios(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sem coluna de "sessões usadas" ou "status": ambas são sempre calculadas a
-- partir de registros_atendimento.pacote_id (ver spec, seção "Modelo de
-- dados") — corrigir uma presença nunca deixa a contagem inconsistente.

ALTER TABLE registros_atendimento
  ADD COLUMN IF NOT EXISTS pacote_id INTEGER REFERENCES pacotes_sessoes(id);

CREATE INDEX IF NOT EXISTS idx_pacotes_sessoes_paciente
  ON pacotes_sessoes (paciente_id);

CREATE INDEX IF NOT EXISTS idx_registros_atendimento_pacote
  ON registros_atendimento (pacote_id) WHERE pacote_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER TABLE pacotes_sessoes ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON pacotes_sessoes FROM anon, authenticated;
  END IF;
END $$;
