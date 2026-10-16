-- Clínica Exemplo Bot — migration 003: suporte a lembrete automático de consulta.
-- Rodar no SQL Editor do Neon (ou via psql) depois de 001 e 002.
-- Recurso vem DESLIGADO por padrão (ver LEMBRETE_CONSULTA_ATIVADO no
-- .env.example) — rodar essa migration não ativa nada sozinho.

-- Marca quando o lembrete foi enviado para esse agendamento, evitando que o
-- job rode de novo (ex: a cada 15 minutos) e mande a mesma mensagem várias
-- vezes para o paciente.
ALTER TABLE agendamentos
  ADD COLUMN IF NOT EXISTS lembrete_enviado_em TIMESTAMPTZ;
