-- Clínica Exemplo Bot — migration 007: índice funcional pro telefone normalizado
-- em agendamentos_importados. buscarProximoAgendamentoImportado (chamada em
-- toda mensagem de paciente) compara regexp_replace(telefone, '\D', '', 'g')
-- — sem esse índice, o índice comum em `telefone` (migration 005) não serve
-- pra essa comparação e vira scan completo da tabela.

CREATE INDEX IF NOT EXISTS idx_agendamentos_importados_telefone_normalizado
  ON agendamentos_importados (regexp_replace(telefone, '\D', '', 'g'));
