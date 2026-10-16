-- src/db/migrations/034_base_conhecimento_gestao.sql
-- Clínica Exemplo Bot — migration 034: gestão da base de conhecimento no dashboard
--
-- A base de conhecimento (respostas do bot pra FAQs) só tinha INSERT via
-- curl (POST /admin/base-conhecimento). Essas colunas dão suporte a
-- soft-delete (desativar sem apagar, reversível) e a saber quando uma
-- resposta foi corrigida pela última vez — ver
-- docs/superpowers/plans/2026-09-07-crud-base-conhecimento-dashboard.md.

ALTER TABLE base_conhecimento
  ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
