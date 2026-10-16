-- Clínica Exemplo Bot — migration 013: laudos/relatório de atendimento (sub-projeto 5).
-- Rodar no SQL Editor do Neon (ou via psql) depois de 012_financeiro.sql.
-- ATENÇÃO: este projeto não tem banco de dev separado do de produção — só
-- aplicar depois de confirmar com o usuário (ver plano/spec deste sub-projeto).

-- Sem NOT NULL: retroativo (registros já existentes ficam com NULL) e
-- opcional daqui pra frente (não bloqueia o fluxo de marcar presença pra
-- quem não preencher).
ALTER TABLE registros_atendimento
  ADD COLUMN IF NOT EXISTS profissional_responsavel TEXT;
