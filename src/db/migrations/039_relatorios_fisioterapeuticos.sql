-- src/db/migrations/039_relatorios_fisioterapeuticos.sql
-- Clínica Exemplo Bot — migration 039: relatório fisioterapêutico
--
-- Digitaliza o relatório em papel entregue ao paciente/responsável (uma
-- declaração assinada pela fisioterapeuta sobre o andamento do
-- tratamento). Um paciente pode ter vários relatórios ao longo do tempo —
-- cada linha é um relatório independente, sem vínculo com agendamento.
-- Mesma decisão da ficha de avaliação (migration 033): campos de conteúdo
-- são texto livre nullable, sem checkbox, sem lógica condicional. Não há
-- cadastro de profissionais com Crefito no sistema, então quem assina o
-- relatório é digitado como texto livre a cada relatório.

CREATE TABLE IF NOT EXISTS relatorios_fisioterapeuticos (
  id SERIAL PRIMARY KEY,
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id),
  data_relatorio DATE NOT NULL,

  diagnostico_motivo TEXT,
  conduta_evolucao TEXT,
  consideracoes_finais TEXT,
  profissional_responsavel TEXT,

  registrado_por INTEGER NOT NULL REFERENCES usuarios(id),
  registrado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_relatorios_fisioterapeuticos_paciente
  ON relatorios_fisioterapeuticos (paciente_id, data_relatorio DESC);
