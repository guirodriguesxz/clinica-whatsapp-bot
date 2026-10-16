-- Clínica Exemplo Bot — migration 042: foto no cadastro de psicólogos
--
-- Foto de perfil opcional pro psicólogo (BYTEA + mime), no mesmo espírito
-- da assinatura eletrônica do fisioterapeuta (migration 040). Diferença:
-- aqui é só identificação visual na tela (não embutida em nenhum
-- documento), então ao contrário da assinatura a foto continua sendo
-- servida mesmo pra um psicólogo inativo.

ALTER TABLE psicologos
  ADD COLUMN IF NOT EXISTS foto_imagem BYTEA,
  ADD COLUMN IF NOT EXISTS foto_mime TEXT;
