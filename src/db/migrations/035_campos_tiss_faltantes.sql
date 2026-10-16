-- src/db/migrations/035_campos_tiss_faltantes.sql
-- Clínica Exemplo Bot — migration 035: campos faltantes pro TISS eletrônico
--
-- Fecha 2 das lacunas documentadas no topo de src/services/tissXmlService.js
-- (sexo do paciente já existia desde a migration 023): CNS do paciente e
-- CBO da clínica por especialidade. Caráter do atendimento (eletiva/
-- urgência) não persiste — é escolhido na hora de gerar o lote, na tela
-- /financeiro/tiss. Todos os campos nullable, mesmo padrão de 023/030: pode
-- ficar vazio até alguém preencher com dado real levantado na clínica.

ALTER TABLE pacientes
  ADD COLUMN IF NOT EXISTS cns TEXT;

ALTER TABLE dados_prestador
  ADD COLUMN IF NOT EXISTS cbo_fisioterapia TEXT,
  ADD COLUMN IF NOT EXISTS cbo_psicologia TEXT;
