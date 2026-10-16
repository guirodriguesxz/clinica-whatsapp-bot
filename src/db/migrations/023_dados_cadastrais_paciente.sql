-- Clínica Exemplo Bot — migration 023: dados cadastrais completos do paciente
--
-- A ficha do paciente passa a ter uma seção de dados cadastrais completos,
-- editável pela recepção, no formato do sistema antigo da clínica (ver
-- docs/superpowers/specs/2026-09-03-ficha-impressao-paciente-design.md).
-- Todos os campos são opcionais — preenchidos aos poucos pela recepção,
-- não em massa. cpf e data_nascimento já existem (migration 010) e passam
-- a ser exibidos/editáveis pela primeira vez, sem mudança de schema aqui.

ALTER TABLE pacientes
  ADD COLUMN IF NOT EXISTS rg TEXT,
  ADD COLUMN IF NOT EXISTS endereco TEXT,
  ADD COLUMN IF NOT EXISTS numero TEXT,
  ADD COLUMN IF NOT EXISTS bairro TEXT,
  ADD COLUMN IF NOT EXISTS cidade TEXT,
  ADD COLUMN IF NOT EXISTS uf TEXT,
  ADD COLUMN IF NOT EXISTS cep TEXT,
  ADD COLUMN IF NOT EXISTS estado_civil TEXT,
  ADD COLUMN IF NOT EXISTS sexo TEXT,
  ADD COLUMN IF NOT EXISTS profissao TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS matricula_convenio TEXT;
