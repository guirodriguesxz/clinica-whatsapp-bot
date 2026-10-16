-- src/db/migrations/016_importacao_excel_ficha.sql
-- Clínica Exemplo Bot — migration 016: coluna tem_ficha em agendamentos_importados,
-- usada pela importação retroativa via Excel (relatório de 3 meses do
-- sistema de agenda anterior, sem telefone/CPF/atendente). Ver spec
-- docs/superpowers/specs/2026-09-01-importacao-excel-historico-3meses-design.md.
-- ATENÇÃO: este projeto não tem banco de dev separado do de produção — só
-- aplicar depois de confirmar com o usuário (ver Task 8 do plano deste
-- sub-projeto).

ALTER TABLE agendamentos_importados
  ADD COLUMN IF NOT EXISTS tem_ficha BOOLEAN;
