-- Clínica Exemplo Bot — migration 017: laudos/relatório de atendimento.
-- Rodar no SQL Editor do Neon (ou via psql) depois de 016_importacao_excel_ficha.sql.
-- ATENÇÃO: este projeto não tem banco de dev separado do de produção — só
-- aplicar depois de confirmar com o usuário.
--
-- Coluna opcional e retroativa: registros já existentes ficam com NULL, e o
-- fluxo de marcar presença continua funcionando sem preenchê-la. O laudo em
-- si nunca é persistido — é gerado sob demanda a partir de
-- registros_atendimento + pacientes/agendamentos_importados, sempre do zero.

ALTER TABLE registros_atendimento
  ADD COLUMN IF NOT EXISTS profissional_responsavel TEXT;
