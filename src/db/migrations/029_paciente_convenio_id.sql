-- src/db/migrations/029_paciente_convenio_id.sql
-- Clínica Exemplo Bot — migration 029: liga paciente à lista de convênios (Fase 2 de repasse)
--
-- Ver docs/superpowers/specs/2026-09-04-paciente-convenio-lista-design.md.
-- A coluna de texto pacientes.convenio continua existindo e sendo a fonte
-- de leitura de todo o resto do sistema (Calendar, PDF de guia, relatório
-- financeiro, ficha) — nullable e sem migração em massa: pacientes já
-- cadastrados ficam com convenio_id NULL até correção manual.

ALTER TABLE pacientes
  ADD COLUMN IF NOT EXISTS convenio_id INTEGER REFERENCES convenios(id);
