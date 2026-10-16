-- src/db/migrations/024_psicologos.sql
-- Clínica Exemplo Bot — migration 024: cadastro de psicólogos (Fase 1)
--
-- Cadastro simples de psicólogos da clínica, administrável por qualquer
-- usuário logado (ver docs/superpowers/specs/2026-09-03-cadastro-psicologos-design.md).
-- Sem nenhuma ligação com agendamentos nesta fase — isso é Fase 2, quando
-- a agenda real de Psicologia estiver disponível.

CREATE TABLE IF NOT EXISTS psicologos (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
