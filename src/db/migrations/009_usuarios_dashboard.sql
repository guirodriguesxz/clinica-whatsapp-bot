-- Clínica Exemplo Bot — migration 009: usuários do dashboard administrativo.
-- Rodar no SQL Editor do Neon (ou via psql) depois de 008_permite_agendamento_simultaneo.sql.

-- Login individual de cada pessoa da equipe — sem papéis/permissões
-- diferenciadas (todo mundo vê e faz tudo no dashboard). O login existe para
-- registrar quem fez cada ação, não para restringir acesso. Substitui a API
-- key única (ADMIN_API_KEY) usada pelas rotas /admin, que não serve para
-- múltiplas pessoas.
CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mesmo cuidado das migrations anteriores: RLS/REVOKE de "anon"/"authenticated"
-- são específicos do Supabase, guardados atrás de uma checagem pra não dar
-- erro em outro Postgres (ex: Neon) onde essas roles não existem.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON usuarios FROM anon, authenticated;
  END IF;
END $$;
