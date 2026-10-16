-- src/db/migrations/031_convenios_dados_tiss.sql
-- Clínica Exemplo Bot — migration 031: dados do convênio na operadora pro TISS eletrônico
--
-- Ver docs/superpowers/specs/2026-09-04-tiss-eletronico-design.md. Nullable:
-- convênio pode continuar existindo no cadastro de repasse sem esses dados
-- até serem levantados na clínica.

ALTER TABLE convenios
  ADD COLUMN IF NOT EXISTS codigo_prestador_na_operadora TEXT,
  ADD COLUMN IF NOT EXISTS numero_contrato TEXT;
