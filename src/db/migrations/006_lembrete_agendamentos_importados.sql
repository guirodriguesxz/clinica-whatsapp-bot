-- Clínica Exemplo Bot — migration 006: lembrete de consulta (24h/2h) também pros
-- agendamentos importados do sistema de agenda anterior, não só os feitos pelo bot.

ALTER TABLE agendamentos_importados
  ADD COLUMN IF NOT EXISTS lembrete_24h_enviado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lembrete_2h_enviado_em TIMESTAMPTZ;
