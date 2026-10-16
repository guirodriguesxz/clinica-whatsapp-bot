-- src/db/migrations/022_encaminhamentos_pendentes.sql
-- Clínica Exemplo Bot — migration 022: fotos de encaminhamento médico pendentes
--
-- Guarda a foto de encaminhamento médico que o paciente manda pelo
-- WhatsApp, para juntar numa mensagem só com a notificação de agendamento
-- pra recepção (ver
-- docs/superpowers/specs/2026-09-03-notificacao-recepcao-agendamento-design.md).
-- No máximo uma foto pendente por paciente — uma foto nova substitui a
-- anterior. A linha é apagada assim que a foto é enviada (junto com um
-- agendamento, junto com um encaminhamento humano, ou sozinha pelo job de
-- expiração em server.js) — esta tabela nunca é histórico, só fila.

CREATE TABLE IF NOT EXISTS encaminhamentos_pendentes (
  paciente_id INTEGER PRIMARY KEY REFERENCES pacientes(id),
  base64 TEXT NOT NULL,
  mimetype TEXT,
  legenda_paciente TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
