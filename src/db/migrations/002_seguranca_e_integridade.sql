-- Clínica Exemplo Bot — migration 002: integridade contra corrida de agendamento
-- e idempotência de webhook. Rodar no SQL Editor do Neon (ou via psql)
-- depois de 001_init.sql.

-- Índice único parcial: impede dois agendamentos CONFIRMADOS no mesmo
-- horário exato. A geração de horários (slotsLivresDoDia em
-- calendarService.js) já trabalha numa grade fixa a partir do horário de
-- abertura, então uma colisão real só acontece quando duas requisições
-- concorrentes disputam o EXATO mesmo slot da grade. O app já rechecka
-- disponibilidade no Google Calendar antes de inserir (ver
-- criarEventoAgendamento), mas duas requisições podem passar por essa
-- checagem ao mesmo tempo — este índice é a rede de segurança que garante
-- que só uma delas consegue COMMIT; a outra recebe unique_violation (23505),
-- tratado em src/functions/criarAgendamento.js.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agendamentos_slot_unico
  ON agendamentos (data, hora)
  WHERE status = 'confirmado';

-- Idempotência de webhook: a Evolution API reenvia o mesmo evento
-- (messages.upsert) se não receber 2xx rápido o suficiente — e pode
-- reentregar por instabilidade de rede mesmo depois de já termos
-- respondido 200. Sem isso, a mesma mensagem do paciente seria processada
-- (e respondida, e potencialmente agendada) mais de uma vez. Ver
-- src/models/webhookModel.js e src/controllers/webhookController.js.
CREATE TABLE IF NOT EXISTS webhook_mensagens_processadas (
  wa_message_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mesmo cuidado do 001_init.sql: RLS/REVOKE de "anon"/"authenticated" são
-- específicos do Supabase, guardados atrás de uma checagem pra não dar erro
-- em outro Postgres (ex: Neon) onde essas roles não existem.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER TABLE webhook_mensagens_processadas ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON webhook_mensagens_processadas FROM anon, authenticated;
  END IF;
END $$;
