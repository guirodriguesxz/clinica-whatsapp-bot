-- Clínica Exemplo Bot — migration 008: permite mais de um paciente no mesmo
-- horário. A clínica atende em paralelo (mais de um profissional/sala), então
-- o slot (data, hora) não é mais exclusivo de um único agendamento confirmado
-- — remove a rede de segurança criada em 002_seguranca_e_integridade.sql, que
-- tratava isso como uma corrida a ser bloqueada.
DROP INDEX IF EXISTS idx_agendamentos_slot_unico;
