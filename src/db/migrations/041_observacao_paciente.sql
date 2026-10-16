-- Clínica Exemplo Bot — migration 041: observação geral na ficha do paciente
--
-- Campo de texto livre (avisos gerais, alergias, preferências) editável pela
-- recepção junto com os demais dados cadastrais (ver migration 023) e
-- exibido na ficha do paciente.

ALTER TABLE pacientes
  ADD COLUMN IF NOT EXISTS observacao TEXT;
