-- src/db/migrations/015_estoque.sql
-- Clínica Exemplo Bot — migration 015: estoque/fornecedores/centro de custo (sub-projeto 7).
-- Rodar no SQL Editor do Neon (ou via psql) depois de 014_guia_convenio.sql.
-- ATENÇÃO: este projeto não tem banco de dev separado do de produção — só
-- aplicar depois de confirmar com o usuário (ver spec deste sub-projeto).

CREATE TABLE IF NOT EXISTS fornecedores (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  telefone TEXT,
  observacao TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS centros_custo (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  descricao TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS materiais (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  categoria TEXT,
  unidade_medida TEXT,
  quantidade_em_estoque INTEGER NOT NULL DEFAULT 0 CHECK (quantidade_em_estoque >= 0),
  estoque_minimo INTEGER CHECK (estoque_minimo IS NULL OR estoque_minimo >= 0),
  fornecedor_id INTEGER REFERENCES fornecedores(id),
  centro_custo_id INTEGER REFERENCES centros_custo(id),
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER TABLE fornecedores ENABLE ROW LEVEL SECURITY;
    ALTER TABLE centros_custo ENABLE ROW LEVEL SECURITY;
    ALTER TABLE materiais ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON fornecedores, centros_custo, materiais FROM anon, authenticated;
  END IF;
END $$;
