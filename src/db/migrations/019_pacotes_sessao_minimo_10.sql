-- src/db/migrations/019_pacotes_sessao_minimo_10.sql
-- Clínica Exemplo Bot — migration 019: reforça no banco o mínimo de 10 sessões
-- por pacote (código já validava; ver 018_pacotes_sessao.sql).
-- Rodar no SQL Editor do Neon (ou via psql) depois de 018_pacotes_sessao.sql.
-- ATENÇÃO: este projeto não tem banco de dev separado do de produção — só
-- aplicar depois de confirmar com o usuário. Aplicar somente se
-- pacotes_sessoes ainda não tiver linha com quantidade_total < 10 (auditar
-- antes de rodar em qualquer ambiente com dado real).

ALTER TABLE pacotes_sessoes DROP CONSTRAINT IF EXISTS pacotes_sessoes_quantidade_total_check;
ALTER TABLE pacotes_sessoes ADD CONSTRAINT pacotes_sessoes_quantidade_total_check
  CHECK (quantidade_total >= 10);
