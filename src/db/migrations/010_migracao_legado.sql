-- Clínica Exemplo Bot — migration 010: migração de dados legados do sistema de agenda anterior.
-- Rodar no SQL Editor do Neon (ou via psql) depois de 009_usuarios_dashboard.sql
-- e 009_remetente_equipe.sql. Pré-requisito: rodar a checagem de colisão do
-- Step 1 do plano antes de aplicar esta migration.

ALTER TABLE pacientes
  ADD COLUMN IF NOT EXISTS cpf TEXT,
  ADD COLUMN IF NOT EXISTS data_nascimento DATE;

-- Campos do export do sistema de agenda anterior sem uso definido no código ainda —
-- guardados brutos (TEXT, sem conversão) pra não perder dado que a clínica
-- já tem, mesmo sem saber ainda pra que serve cada um (ver spec do
-- sub-projeto, seção "Escopo").
ALTER TABLE agendamentos_importados
  ADD COLUMN IF NOT EXISTS tipo TEXT,
  ADD COLUMN IF NOT EXISTS obs TEXT,
  ADD COLUMN IF NOT EXISTS flag_f TEXT,
  ADD COLUMN IF NOT EXISTS flag_c TEXT,
  ADD COLUMN IF NOT EXISTS flag_e TEXT,
  ADD COLUMN IF NOT EXISTS chegou TEXT;

-- Garante idempotência real: rodar o script de migração duas vezes sobre o
-- mesmo lote (ou um lote que se sobreponha) não duplica agendamento nenhum.
-- Inclui `nome` na chave: o mesmo telefone pode pertencer a mais de um
-- paciente (ex: família dividindo número) — telefone+data+hora sozinho
-- colidiria incorretamente entre duas pessoas reais com horário no mesmo
-- minuto (achado real ao checar o banco de desenvolvimento, ver spec).
CREATE UNIQUE INDEX IF NOT EXISTS idx_agendamentos_importados_unico
  ON agendamentos_importados (
    regexp_replace(telefone, '\D', '', 'g'), data, hora, nome
  );
