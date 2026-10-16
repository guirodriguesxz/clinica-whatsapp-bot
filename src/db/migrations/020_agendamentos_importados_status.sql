-- Clínica Exemplo Bot — migration 020: status em agendamentos importados
--
-- Até aqui, agendamentos_importados não tinha status — a tabela era só
-- referência histórica da migração do Excel/sistema de agenda anterior (ver comentário
-- original na migration 005). A recepção agora também cancela e remarca
-- esses registros pelo dashboard, então eles precisam do mesmo ciclo de
-- vida que agendamentos.status já tem: confirmado -> cancelado, ou
-- confirmado -> compareceu/faltou via registro de presença.
--
-- DEFAULT 'confirmado' preenche as 327 linhas já existentes da migração —
-- nenhuma delas estava cancelada, então esse é o estado correto pra todas.

ALTER TABLE agendamentos_importados
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'confirmado';

ALTER TABLE agendamentos_importados DROP CONSTRAINT IF EXISTS agendamentos_importados_status_check;
ALTER TABLE agendamentos_importados ADD CONSTRAINT agendamentos_importados_status_check
  CHECK (status IN ('confirmado', 'cancelado', 'concluido', 'compareceu', 'faltou'));
