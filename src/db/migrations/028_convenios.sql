-- src/db/migrations/028_convenios.sql
-- Clínica Exemplo Bot — migration 028: cadastro de convênios (Fase 1 de repasse)
--
-- Cadastro simples de convênios da clínica, administrável por qualquer
-- usuário logado (ver docs/superpowers/specs/2026-09-04-cadastro-convenios-design.md).
-- Sem nenhuma ligação com pacientes/pagamentos nesta fase — isso é fase 2
-- (trocar paciente.convenio de texto livre por esta lista) e fase 3
-- (calcular repasse no relatório financeiro).

CREATE TABLE IF NOT EXISTS convenios (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  valor_repasse_avaliacao NUMERIC(10,2),
  valor_repasse_sessao NUMERIC(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
