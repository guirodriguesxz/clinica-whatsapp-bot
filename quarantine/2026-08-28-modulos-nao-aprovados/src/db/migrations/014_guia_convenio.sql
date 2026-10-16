-- src/db/migrations/014_guia_convenio.sql
-- Clínica Exemplo Bot — migration 014: guia de convênio (sub-projeto 6, versão
-- simplificada em PDF — ver docs/superpowers/specs/2026-08-28-guia-convenio-design.md).
-- Rodar no SQL Editor do Neon (ou via psql) depois de 013_laudos.sql.
-- ATENÇÃO: este projeto não tem banco de dev separado do de produção — só
-- aplicar depois de confirmar com o usuário (ver plano/spec deste sub-projeto).

-- Nome real da constraint gerada automaticamente pelo Postgres pro CHECK
-- original — confirmar com \d pagamentos se o nome divergir antes de
-- aplicar em produção (mesma ressalva já usada na migration 011 pro CHECK
-- de agendamentos.status).
ALTER TABLE pagamentos DROP CONSTRAINT IF EXISTS pagamentos_forma_pagamento_check;
ALTER TABLE pagamentos ADD CONSTRAINT pagamentos_forma_pagamento_check
  CHECK (forma_pagamento IN ('pix', 'cartao', 'convenio'));

-- Sem NOT NULL: opcional, pra imprimir na guia quando existir. Não há tela
-- de edição de paciente no dashboard ainda — a coluna fica pronta pra um
-- formulário futuro; até lá só é preenchida direto no banco quando
-- necessário.
ALTER TABLE pacientes
  ADD COLUMN IF NOT EXISTS numero_carteirinha TEXT;

ALTER TABLE agendamentos_importados
  ADD COLUMN IF NOT EXISTS numero_carteirinha TEXT;
