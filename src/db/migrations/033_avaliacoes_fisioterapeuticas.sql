-- src/db/migrations/033_avaliacoes_fisioterapeuticas.sql
-- Clínica Exemplo Bot — migration 033: ficha de avaliação fisioterapêutica
--
-- Digitaliza a ficha em papel usada na consulta de avaliação (ver
-- docs/superpowers/specs/2026-09-04-avaliacao-fisioterapeutica-design.md).
-- Um paciente pode ter várias avaliações ao longo do tempo — cada linha é
-- uma avaliação independente, sem vínculo com agendamento. Todos os
-- campos de conteúdo são texto livre nullable (decisão do usuário: sem
-- checkbox, sem lógica condicional — a recepção digita a resposta como
-- está escrita no papel).

CREATE TABLE IF NOT EXISTS avaliacoes_fisioterapeuticas (
  id SERIAL PRIMARY KEY,
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id),
  data_avaliacao DATE NOT NULL,

  esta_gravida TEXT,
  possui_marcapasso TEXT,
  possui_protese_metalica_implantes TEXT,
  possui_doencas_cardiacas TEXT,
  possui_hipertensao_arterial TEXT,
  possui_diabetes TEXT,
  possui_epilepsia TEXT,
  possui_historico_cancer TEXT,
  medicamentos_continuos_quais TEXT,
  cirurgia_qual TEXT,
  cirurgia_quando TEXT,
  tempo_ultima_cirurgia TEXT,
  dor_atual_local TEXT,
  dor_atual_intensidade TEXT,
  limitacoes_funcionais_quais TEXT,
  fisioterapia_anteriormente TEXT,

  objetivos_tratamento TEXT,
  condutas_propostas TEXT,

  registrado_por INTEGER NOT NULL REFERENCES usuarios(id),
  registrado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_avaliacoes_fisioterapeuticas_paciente
  ON avaliacoes_fisioterapeuticas (paciente_id, data_avaliacao DESC);
