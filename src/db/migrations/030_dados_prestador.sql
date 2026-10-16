-- src/db/migrations/030_dados_prestador.sql
-- Clínica Exemplo Bot — migration 030: dados do prestador (clínica) pro TISS eletrônico
--
-- Tabela de linha única (não por convênio) com os dados cadastrais da
-- própria clínica exigidos no cabeçalho do XML de lote TISS (ver
-- docs/superpowers/specs/2026-09-04-tiss-eletronico-design.md). Todos os
-- campos nullable — pode existir a linha vazia até alguém preencher com
-- dado real levantado na clínica.

CREATE TABLE IF NOT EXISTS dados_prestador (
  id SERIAL PRIMARY KEY,
  cnes TEXT,
  razao_social TEXT,
  cnpj TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
