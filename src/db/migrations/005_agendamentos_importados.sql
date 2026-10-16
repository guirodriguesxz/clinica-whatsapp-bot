-- Clínica Exemplo Bot — migration 005: agendamentos importados do sistema de agenda anterior
-- (sistema anterior), só pra contexto/consciência do bot — NÃO é usada pelas
-- functions cancelar_agendamento/remarcar_agendamento, já que a fonte da
-- verdade desses agendamentos, para pedidos feitos pelo próprio paciente via
-- WhatsApp, é o sistema de agenda anterior, não o bot.
--
-- Atualização (migration 020): a recepção passou a poder cancelar e remarcar
-- esses registros direto pelo dashboard, então a tabela deixou de ser só
-- histórico somente-leitura — ganhou o mesmo ciclo de vida por status que
-- agendamentos já tem (confirmado -> cancelado, ou confirmado ->
-- compareceu/faltou via registro de presença).

CREATE TABLE IF NOT EXISTS agendamentos_importados (
  id SERIAL PRIMARY KEY,
  telefone TEXT NOT NULL,
  nome TEXT NOT NULL,
  data DATE NOT NULL,
  hora TIME NOT NULL,
  tipo_atendimento TEXT NOT NULL DEFAULT 'fisioterapia',
  convenio TEXT,
  atendente TEXT,
  google_event_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agendamentos_importados_telefone ON agendamentos_importados (telefone);
