-- Clínica Exemplo Bot — migration 015: login por nome de usuário e papéis do dashboard.
-- Arquivo local. Não executar sem auditoria das contas existentes e autorização explícita.

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS nome_usuario TEXT,
  ADD COLUMN IF NOT EXISTS papel TEXT,
  ADD COLUMN IF NOT EXISTS sessao_versao INTEGER NOT NULL DEFAULT 0;

-- Contas novas do dashboard usam nome de usuário, não e-mail. Registros
-- antigos preservam o e-mail já existente; a coluna continua disponível, mas
-- deixa de bloquear a criação das contas de recepção.
ALTER TABLE usuarios
  ALTER COLUMN email DROP NOT NULL;

ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_nome_usuario_formato_chk
  CHECK (nome_usuario IS NULL OR nome_usuario ~ '^[a-z0-9][a-z0-9._-]{2,31}$');

ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_papel_chk
  CHECK (papel IS NULL OR papel IN ('administradora', 'recepcao'));

CREATE UNIQUE INDEX IF NOT EXISTS usuarios_nome_usuario_unico_idx
  ON usuarios (nome_usuario)
  WHERE nome_usuario IS NOT NULL;
