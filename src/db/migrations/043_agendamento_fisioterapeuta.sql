-- src/db/migrations/043_agendamento_fisioterapeuta.sql
-- Clínica Exemplo Bot — migration 043: vincula agendamento de Fisioterapia a um fisioterapeuta
--
-- Mesmo espírito da migration 027 (agendamento de Psicologia vinculado a
-- uma psicóloga) — pedido real: a recepção quer escolher o fisioterapeuta
-- que vai atender na hora de criar/editar o agendamento, igual já fazem no
-- sistema de agenda anterior (tela "Marcação de novo horário" tem um campo
-- "Atendente"). Sempre nullable: o fisioterapeuta é opcional e definido
-- manualmente pela recepção, nunca bloqueia a criação do agendamento
-- (inclusive os que o paciente marca pelo bot, que nascem sem
-- fisioterapeuta). Sem ON DELETE CASCADE — um fisioterapeuta
-- desativado/removido do cadastro nunca deve apagar agendamentos.

ALTER TABLE agendamentos
  ADD COLUMN IF NOT EXISTS fisioterapeuta_id INTEGER REFERENCES fisioterapeutas(id);

ALTER TABLE agendamentos_importados
  ADD COLUMN IF NOT EXISTS fisioterapeuta_id INTEGER REFERENCES fisioterapeutas(id);
