-- src/db/migrations/032_convenio_procedimentos_tuss.sql
-- Clínica Exemplo Bot — migration 032: mapeamento de código TUSS por convênio
--
-- Ver docs/superpowers/specs/2026-09-04-tiss-eletronico-design.md. Cruza
-- tipo_atendimento (fisioterapia/psicologia) com categoria (avaliacao/
-- sessao, mesma distinção de agendamentos.primeira_consulta usada no
-- cálculo de repasse) — no máximo 4 linhas por convênio.

CREATE TABLE IF NOT EXISTS convenio_procedimentos_tuss (
  id SERIAL PRIMARY KEY,
  convenio_id INTEGER NOT NULL REFERENCES convenios(id),
  tipo_atendimento TEXT NOT NULL CHECK (tipo_atendimento IN ('fisioterapia', 'psicologia')),
  categoria TEXT NOT NULL CHECK (categoria IN ('avaliacao', 'sessao')),
  codigo_tuss TEXT NOT NULL,
  descricao_tuss TEXT,
  UNIQUE (convenio_id, tipo_atendimento, categoria)
);
