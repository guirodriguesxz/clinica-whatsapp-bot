-- Clínica Exemplo Bot — migration 009: permite registrar mensagens manuais da
-- equipe (não pelo bot) no histórico da conversa. Até aqui, quando a equipe
-- respondia manualmente uma conversa pausada, o bot só usava isso pra saber
-- que devia ficar quieto (ver webhookController.js) — o texto em si nunca
-- era guardado. Agora é guardado com remetente = 'equipe', usado pelo
-- detector de agendamento combinado manualmente (ver
-- detectorAgendamentoManualService.js).
ALTER TABLE conversas DROP CONSTRAINT conversas_remetente_check;
ALTER TABLE conversas ADD CONSTRAINT conversas_remetente_check
  CHECK (remetente IN ('paciente', 'bot', 'equipe'));
