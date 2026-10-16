-- src/db/migrations/025_guia_convenio.sql
-- Clínica Exemplo Bot — migration 025: guia de convênio (sub-projeto "Guia de
-- convênio", ver docs/superpowers/specs/2026-09-03-guia-convenio-design.md).
-- Rodar no SQL Editor do Neon (ou via psql) antes de fazer deploy do código
-- que usa isso — sem essa migration, registrar um pagamento com
-- forma_pagamento = 'convenio' falha com violação de CHECK.
--
-- ATENÇÃO: este projeto não tem banco de dev separado do de produção — só
-- aplicar depois de confirmar com o usuário.
--
-- O nome real da constraint (gerada automaticamente pelo Postgres) precisa
-- ser confirmado com `\d pagamentos` antes de rodar em produção — mesma
-- ressalva já usada nas migrations 011 e 013. Se o nome divergir de
-- `pagamentos_forma_pagamento_check`, ajuste o DROP CONSTRAINT abaixo pelo
-- nome real antes de aplicar.

ALTER TABLE pagamentos DROP CONSTRAINT IF EXISTS pagamentos_forma_pagamento_check;
ALTER TABLE pagamentos ADD CONSTRAINT pagamentos_forma_pagamento_check
  CHECK (forma_pagamento IN ('pix', 'cartao', 'convenio'));
