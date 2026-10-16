-- src/db/migrations/026_pacientes_arquivar.sql
-- Clínica Exemplo Bot — migration 026: arquivar paciente (em vez de excluir de
-- verdade quando há histórico ligado a ele).
--
-- Rodar no SQL Editor do Neon (ou via psql) antes de fazer deploy do código
-- que usa isso — sem essa migration, o UPDATE de arquivamento falha com
-- coluna inexistente.
--
-- ATENÇÃO: este projeto não tem banco de dev separado do de produção — só
-- aplicar depois de confirmar com o usuário.
--
-- Mesmo padrão de usuarios.ativo (migration 009): nunca apaga paciente com
-- histórico (pagamentos, presenças/laudos, pacotes de sessão continuam
-- intactos) — só marca ativo = false pra sumir das listas/busca do
-- dashboard. Default true preserva todo cadastro existente como ativo.

ALTER TABLE pacientes
  ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
