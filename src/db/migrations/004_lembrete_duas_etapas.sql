-- Clínica Exemplo Bot — migration 004: lembrete de consulta em duas etapas
-- (24h antes e 2h antes), em vez de um lembrete único.
-- Rodar no SQL Editor do Neon (ou via psql) depois de 001, 002 e 003.

ALTER TABLE agendamentos
  RENAME COLUMN lembrete_enviado_em TO lembrete_24h_enviado_em;

ALTER TABLE agendamentos
  ADD COLUMN IF NOT EXISTS lembrete_2h_enviado_em TIMESTAMPTZ;
