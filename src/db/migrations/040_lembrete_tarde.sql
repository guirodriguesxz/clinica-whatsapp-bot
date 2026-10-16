-- Clínica Exemplo Bot — migration 040: lembrete same-day (12h) para pacientes com
-- consulta à tarde (hora >= 12:00), além do lembrete de véspera já existente
-- (lembrete_24h_enviado_em).
--
-- Não reaproveita lembrete_2h_enviado_em (coluna morta do sistema antigo de
-- duas etapas 24h/2h, ver OPERACAO.md — "coluna antiga que não é mais
-- usada"): a semântica aqui é diferente ("sempre às 12h do próprio dia", não
-- "2h antes da consulta"), reaproveitar o nome confundiria mais do que uma
-- coluna nova.
--
-- Recurso vem DESLIGADO por padrão (ver LEMBRETE_TARDE_ATIVADO no
-- .env.example) — rodar essa migration não ativa nada sozinho.

ALTER TABLE agendamentos
  ADD COLUMN IF NOT EXISTS lembrete_tarde_enviado_em TIMESTAMPTZ;

ALTER TABLE agendamentos_importados
  ADD COLUMN IF NOT EXISTS lembrete_tarde_enviado_em TIMESTAMPTZ;
