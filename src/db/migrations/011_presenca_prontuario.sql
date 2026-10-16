-- src/db/migrations/011_presenca_prontuario.sql
-- Clínica Exemplo Bot — migration 011: presença e prontuário leve (sub-projeto 3).
-- Rodar no SQL Editor do Neon (ou via psql) depois de 010_migracao_legado.sql.
-- ATENÇÃO: este projeto não tem banco de dev separado do de produção — só
-- aplicar depois de confirmar com o usuário (ver plano/spec deste sub-projeto).

CREATE TABLE IF NOT EXISTS registros_atendimento (
  id SERIAL PRIMARY KEY,
  agendamento_id INTEGER REFERENCES agendamentos(id),
  agendamento_importado_id INTEGER REFERENCES agendamentos_importados(id),
  presenca TEXT NOT NULL CHECK (presenca IN ('compareceu', 'faltou')),
  observacao_sessao TEXT,
  registrado_por INTEGER NOT NULL REFERENCES usuarios(id),
  registrado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(agendamento_id, agendamento_importado_id) = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_registros_atendimento_agendamento
  ON registros_atendimento (agendamento_id) WHERE agendamento_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_registros_atendimento_importado
  ON registros_atendimento (agendamento_importado_id) WHERE agendamento_importado_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER TABLE registros_atendimento ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON registros_atendimento FROM anon, authenticated;
  END IF;
END $$;

-- agendamentos.status ganha compareceu/faltou (o nome da constraint gerada
-- automaticamente pelo Postgres pro CHECK original — confirmar com
-- \d agendamentos se o nome real divergir antes de aplicar em produção).
ALTER TABLE agendamentos DROP CONSTRAINT IF EXISTS agendamentos_status_check;
ALTER TABLE agendamentos ADD CONSTRAINT agendamentos_status_check
  CHECK (status IN ('confirmado', 'cancelado', 'concluido', 'compareceu', 'faltou'));
