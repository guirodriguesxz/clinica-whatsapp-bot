-- src/db/migrations/012_financeiro.sql
-- Clínica Exemplo Bot — migration 012: financeiro (sub-projeto 4).
-- Rodar no SQL Editor do Neon (ou via psql) depois de 011_presenca_prontuario.sql.
-- ATENÇÃO: este projeto não tem banco de dev separado do de produção — só
-- aplicar depois de confirmar com o usuário (ver plano/spec deste sub-projeto).

CREATE TABLE IF NOT EXISTS pagamentos (
  id SERIAL PRIMARY KEY,
  agendamento_id INTEGER REFERENCES agendamentos(id),
  agendamento_importado_id INTEGER REFERENCES agendamentos_importados(id),
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id),
  valor NUMERIC(10,2) NOT NULL,
  forma_pagamento TEXT NOT NULL CHECK (forma_pagamento IN ('pix', 'cartao')),
  parcelas INTEGER,
  valor_acrescimo NUMERIC(10,2),
  status TEXT NOT NULL CHECK (status IN ('pago', 'pendente', 'aguardando_reembolso', 'estornado')),
  data DATE NOT NULL,
  observacao TEXT,
  registrado_por INTEGER NOT NULL REFERENCES usuarios(id),
  registrado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(agendamento_id, agendamento_importado_id) = 1),
  CHECK (parcelas IS NULL OR forma_pagamento = 'cartao'),
  CHECK (valor_acrescimo IS NULL OR forma_pagamento = 'cartao'),
  CHECK (valor > 0),
  CHECK (valor_acrescimo IS NULL OR valor_acrescimo >= 0),
  CHECK (parcelas IS NULL OR parcelas > 0)
);

CREATE INDEX IF NOT EXISTS idx_pagamentos_agendamento
  ON pagamentos (agendamento_id);

CREATE INDEX IF NOT EXISTS idx_pagamentos_importado
  ON pagamentos (agendamento_importado_id);

CREATE INDEX IF NOT EXISTS idx_pagamentos_data
  ON pagamentos (data);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER TABLE pagamentos ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON pagamentos FROM anon, authenticated;
  END IF;
END $$;
