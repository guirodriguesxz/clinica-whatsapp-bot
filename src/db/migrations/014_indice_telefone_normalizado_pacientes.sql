-- Clínica Exemplo Bot — migration 014: índice funcional pro telefone normalizado
-- em pacientes. buscarPacientePorTelefoneNormalizado (usada em
-- registrarPagamentoImportado) compara regexp_replace(telefone, '\D', '', 'g')
-- — sem esse índice, o índice comum em `telefone` não serve pra essa
-- comparação e vira scan completo da tabela (mesmo caso da migration 007
-- para agendamentos_importados).

CREATE INDEX IF NOT EXISTS idx_pacientes_telefone_normalizado
  ON pacientes (regexp_replace(telefone, '\D', '', 'g'));
