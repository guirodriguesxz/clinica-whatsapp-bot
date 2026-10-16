-- src/db/migrations/021_agendamento_manual_rastreabilidade.sql
-- Clínica Exemplo Bot — migration 021: rastreabilidade de agendamento manual
--
-- A recepção passa a poder criar e editar agendamentos manualmente pelo
-- dashboard (ver docs/superpowers/specs/2026-09-03-agendamento-manual-design.md).
-- NULL continua significando "criado pelo bot" (em agendamentos) ou "um dos
-- 327 originais da migração do Excel, nunca editado" (em
-- agendamentos_importados) — nenhuma linha existente precisa de UPDATE.

ALTER TABLE agendamentos
  ADD COLUMN IF NOT EXISTS criado_por_usuario_id INTEGER REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS atualizado_por_usuario_id INTEGER REFERENCES usuarios(id);

ALTER TABLE agendamentos_importados
  ADD COLUMN IF NOT EXISTS criado_por_usuario_id INTEGER REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS atualizado_por_usuario_id INTEGER REFERENCES usuarios(id);
