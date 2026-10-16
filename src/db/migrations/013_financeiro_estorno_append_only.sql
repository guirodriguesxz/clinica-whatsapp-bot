-- Clínica Exemplo Bot — migration 013: estorno financeiro append-only.
-- Rodar no SQL Editor do Neon (ou via psql) depois de 012_financeiro.sql.
-- ATENÇÃO: este projeto não tem banco de dev separado do de produção — só
-- aplicar depois de confirmar com o usuário e concluir auditoria somente
-- leitura do schema e dos registros de produção.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pagamentos
    WHERE status = 'estornado'
  ) THEN
    RAISE EXCEPTION
      'Migration 013 interrompida: existem pagamentos legados com status = estornado; audite e defina a conversão antes de continuar.';
  END IF;
END $$;

ALTER TABLE pagamentos
  ADD COLUMN IF NOT EXISTS tipo_lancamento TEXT NOT NULL DEFAULT 'pagamento',
  ADD COLUMN IF NOT EXISTS pagamento_origem_id INTEGER REFERENCES pagamentos(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pagamentos_tipo_lancamento_check'
      AND conrelid = 'pagamentos'::regclass
  ) THEN
    ALTER TABLE pagamentos
      ADD CONSTRAINT pagamentos_tipo_lancamento_check
      CHECK (tipo_lancamento IN ('pagamento', 'estorno'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pagamentos_estorno_origem_check'
      AND conrelid = 'pagamentos'::regclass
  ) THEN
    ALTER TABLE pagamentos
      ADD CONSTRAINT pagamentos_estorno_origem_check
      CHECK (
        (tipo_lancamento = 'pagamento' AND pagamento_origem_id IS NULL)
        OR
        (tipo_lancamento = 'estorno' AND pagamento_origem_id IS NOT NULL)
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pagamentos_estorno_unico
  ON pagamentos (pagamento_origem_id)
  WHERE pagamento_origem_id IS NOT NULL;
