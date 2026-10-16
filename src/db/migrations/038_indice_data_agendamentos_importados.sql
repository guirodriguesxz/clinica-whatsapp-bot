-- Clínica Exemplo Bot — migration 038: índice de data em agendamentos_importados
-- Consultas de agenda/"Próximos" e do bot filtram essa tabela por data
-- (WHERE data = $1 ou data >= hoje), mas só havia índice em telefone —
-- table scan que piora conforme a tabela de importados cresce.

CREATE INDEX IF NOT EXISTS idx_agendamentos_importados_data ON agendamentos_importados (data);
