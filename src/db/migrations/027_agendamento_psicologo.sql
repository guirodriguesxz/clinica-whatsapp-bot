-- src/db/migrations/027_agendamento_psicologo.sql
-- Clínica Exemplo Bot — migration 027: vincula agendamento de Psicologia a uma psicóloga
--
-- Fase 2 do cadastro de psicólogos (ver
-- docs/superpowers/specs/2026-09-04-agenda-por-psicologa-design.md). Sempre
-- nullable: a psicóloga é opcional e definida manualmente pela recepção,
-- nunca bloqueia a criação do agendamento (inclusive os que o paciente
-- marca pelo bot, que nascem sem psicóloga). Sem ON DELETE CASCADE — uma
-- psicóloga desativada/removida do cadastro nunca deve apagar agendamentos.

ALTER TABLE agendamentos
  ADD COLUMN IF NOT EXISTS psicologo_id INTEGER REFERENCES psicologos(id);

ALTER TABLE agendamentos_importados
  ADD COLUMN IF NOT EXISTS psicologo_id INTEGER REFERENCES psicologos(id);
