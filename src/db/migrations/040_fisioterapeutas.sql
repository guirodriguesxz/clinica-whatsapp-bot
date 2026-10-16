-- src/db/migrations/040_fisioterapeutas.sql
-- Clínica Exemplo Bot — migration 040: cadastro de fisioterapeutas com assinatura eletrônica
--
-- Cadastro leve de fisioterapeutas da clínica (nome, Crefito, imagem de
-- assinatura), no mesmo espírito do cadastro de psicólogos (migration 024),
-- com um campo a mais: a imagem da assinatura (BYTEA), pra embutir
-- automaticamente no relatório fisioterapêutico em vez de deixar uma linha
-- em branco pra assinar no papel. Ver spec:
-- docs/superpowers/specs/2026-09-16-assinatura-relatorio-fisioterapeutico-design.md
--
-- crefito e os dois campos de assinatura são nullable — o cadastro pode
-- existir antes de a imagem ser enviada; nesse caso o relatório continua
-- caindo no comportamento atual (linha em branco).
CREATE TABLE IF NOT EXISTS fisioterapeutas (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  crefito TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  assinatura_imagem BYTEA,
  assinatura_mime TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Liga um relatório ao fisioterapeuta selecionado no formulário, pra buscar
-- a assinatura atual dele na hora de gerar o PDF/DOCX. Nullable e sem
-- retroatividade: relatórios já existentes ficam com essa coluna NULL e
-- continuam sendo gerados exatamente como hoje (profissional_responsavel
-- em texto solto, sem assinatura).
ALTER TABLE relatorios_fisioterapeuticos
  ADD COLUMN IF NOT EXISTS fisioterapeuta_id INTEGER REFERENCES fisioterapeutas(id);
