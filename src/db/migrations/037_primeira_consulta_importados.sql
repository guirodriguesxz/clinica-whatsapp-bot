-- Clínica Exemplo Bot — migration 037: primeira_consulta em agendamentos importados
--
-- O campo `tipo` trazido bruto do sistema de agenda anterior (migration 010) codifica
-- o tipo da consulta no prefixo antes da barra: "AVAL/OK" = avaliação,
-- "RETORNO/OK" = retorno (a parte depois da barra indica presença, já
-- tratada por `status`/`registros_atendimento`, migration 020). Confirmado
-- com a clínica em 2026-09-10. Adiciona a mesma coluna booleana que
-- `agendamentos.primeira_consulta` já tem, pra permitir que o filtro de
-- avaliação/retorno (dashboardController) também alcance os agendamentos
-- importados — até aqui esse filtro só funcionava pra bot/manual.

ALTER TABLE agendamentos_importados
  ADD COLUMN IF NOT EXISTS primeira_consulta BOOLEAN;

UPDATE agendamentos_importados
SET primeira_consulta = CASE
  WHEN split_part(tipo, '/', 1) ILIKE 'AVAL' THEN true
  WHEN split_part(tipo, '/', 1) ILIKE 'RETORNO' THEN false
  ELSE NULL
END
WHERE primeira_consulta IS NULL AND tipo IS NOT NULL;
