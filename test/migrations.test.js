// test/migrations.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION_020 = path.join(ROOT, "src/db/migrations/020_agendamentos_importados_status.sql");
const MIGRATION_021 = path.join(ROOT, "src/db/migrations/021_agendamento_manual_rastreabilidade.sql");
const MIGRATION_022 = path.join(ROOT, "src/db/migrations/022_encaminhamentos_pendentes.sql");
const MIGRATION_023 = path.join(ROOT, "src/db/migrations/023_dados_cadastrais_paciente.sql");
const MIGRATION_024 = path.join(ROOT, "src/db/migrations/024_psicologos.sql");
const MIGRATION_027 = path.join(ROOT, "src/db/migrations/027_agendamento_psicologo.sql");
const MIGRATION_028 = path.join(ROOT, "src/db/migrations/028_convenios.sql");
const MIGRATION_029 = path.join(ROOT, "src/db/migrations/029_paciente_convenio_id.sql");
const MIGRATION_030 = path.join(ROOT, "src/db/migrations/030_dados_prestador.sql");
const MIGRATION_031 = path.join(ROOT, "src/db/migrations/031_convenios_dados_tiss.sql");
const MIGRATION_032 = path.join(ROOT, "src/db/migrations/032_convenio_procedimentos_tuss.sql");
const MIGRATION_033 = path.join(ROOT, "src/db/migrations/033_avaliacoes_fisioterapeuticas.sql");

test("migration 020: adiciona status em agendamentos_importados com os mesmos 5 valores de agendamentos.status", async () => {
  const sql = await readFile(MIGRATION_020, "utf8");

  assert.match(
    sql,
    /ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'confirmado'/
  );
  assert.match(
    sql,
    /CHECK \(status IN \('confirmado', 'cancelado', 'concluido', 'compareceu', 'faltou'\)\)/
  );
});

test("migration 021: adiciona colunas de rastreabilidade nullable em agendamentos e agendamentos_importados", async () => {
  const sql = await readFile(MIGRATION_021, "utf8");

  assert.match(
    sql,
    /ALTER TABLE agendamentos\s+ADD COLUMN IF NOT EXISTS criado_por_usuario_id INTEGER REFERENCES usuarios\(id\),\s+ADD COLUMN IF NOT EXISTS atualizado_por_usuario_id INTEGER REFERENCES usuarios\(id\);/
  );
  assert.match(
    sql,
    /ALTER TABLE agendamentos_importados\s+ADD COLUMN IF NOT EXISTS criado_por_usuario_id INTEGER REFERENCES usuarios\(id\),\s+ADD COLUMN IF NOT EXISTS atualizado_por_usuario_id INTEGER REFERENCES usuarios\(id\);/
  );
  // Sem NOT NULL em nenhuma das quatro — precisam continuar nullable
  // (NULL = criado pelo bot / um dos 327 originais do Excel).
  assert.doesNotMatch(sql, /criado_por_usuario_id[^,]*NOT NULL/);
  assert.doesNotMatch(sql, /atualizado_por_usuario_id[^,]*NOT NULL/);
});

test("migration 022: cria encaminhamentos_pendentes com paciente_id como chave e referência a pacientes", async () => {
  const sql = await readFile(MIGRATION_022, "utf8");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS encaminhamentos_pendentes/);
  assert.match(sql, /paciente_id INTEGER PRIMARY KEY REFERENCES pacientes\(id\)/);
  assert.match(sql, /base64 TEXT NOT NULL/);
  assert.match(sql, /criado_em TIMESTAMPTZ NOT NULL DEFAULT now\(\)/);
});

test("migration 023: adiciona colunas cadastrais nullable em pacientes", async () => {
  const sql = await readFile(MIGRATION_023, "utf8");

  for (const coluna of [
    "rg", "endereco", "numero", "bairro", "cidade", "uf", "cep",
    "estado_civil", "sexo", "profissao", "email", "matricula_convenio",
  ]) {
    assert.match(
      sql,
      new RegExp(`ADD COLUMN IF NOT EXISTS ${coluna} TEXT`),
      `deve adicionar a coluna ${coluna}`
    );
  }
  // Nenhuma delas pode ser NOT NULL — são preenchidas aos poucos.
  assert.doesNotMatch(sql, /TEXT NOT NULL/);
});

test("migration 024: cria psicologos com nome obrigatório e ativo default true", async () => {
  const sql = await readFile(MIGRATION_024, "utf8");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS psicologos/);
  assert.match(sql, /nome TEXT NOT NULL/);
  assert.match(sql, /ativo BOOLEAN NOT NULL DEFAULT true/);
  assert.match(sql, /created_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)/);
});

test("migration 027: adiciona psicologo_id nullable em agendamentos e agendamentos_importados", async () => {
  const sql = await readFile(MIGRATION_027, "utf8");

  assert.match(
    sql,
    /ALTER TABLE agendamentos\s+ADD COLUMN IF NOT EXISTS psicologo_id INTEGER REFERENCES psicologos\(id\);/
  );
  assert.match(
    sql,
    /ALTER TABLE agendamentos_importados\s+ADD COLUMN IF NOT EXISTS psicologo_id INTEGER REFERENCES psicologos\(id\);/
  );
  assert.doesNotMatch(sql, /psicologo_id[^,;]*NOT NULL/);
});

test("migration 028: cria convenios com nome obrigatório, ativo default true e repasse nullable", async () => {
  const sql = await readFile(MIGRATION_028, "utf8");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS convenios/);
  assert.match(sql, /nome TEXT NOT NULL/);
  assert.match(sql, /ativo BOOLEAN NOT NULL DEFAULT true/);
  assert.match(sql, /valor_repasse_avaliacao NUMERIC\(10,2\)/);
  assert.match(sql, /valor_repasse_sessao NUMERIC\(10,2\)/);
  assert.match(sql, /created_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)/);
  assert.doesNotMatch(sql, /valor_repasse_avaliacao[^,]*NOT NULL/);
  assert.doesNotMatch(sql, /valor_repasse_sessao[^,]*NOT NULL/);
});

test("migration 029: adiciona convenio_id nullable em pacientes, referenciando convenios", async () => {
  const sql = await readFile(MIGRATION_029, "utf8");

  assert.match(sql, /ALTER TABLE pacientes\s+ADD COLUMN IF NOT EXISTS convenio_id INTEGER REFERENCES convenios\(id\);/);
  assert.doesNotMatch(sql, /convenio_id[^,;]*NOT NULL/);
});

test("migration 030: cria dados_prestador com campos nullable", async () => {
  const sql = await readFile(MIGRATION_030, "utf8");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS dados_prestador/);
  assert.match(sql, /cnes TEXT,/);
  assert.match(sql, /razao_social TEXT,/);
  assert.match(sql, /cnpj TEXT,/);
  assert.doesNotMatch(sql, /cnes TEXT NOT NULL/);
});

test("migration 031: adiciona colunas TISS nullable em convenios", async () => {
  const sql = await readFile(MIGRATION_031, "utf8");

  assert.match(sql, /ALTER TABLE convenios/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS codigo_prestador_na_operadora TEXT/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS numero_contrato TEXT/);
});

test("migration 032: cria convenio_procedimentos_tuss com unique por convenio/tipo/categoria", async () => {
  const sql = await readFile(MIGRATION_032, "utf8");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS convenio_procedimentos_tuss/);
  assert.match(sql, /convenio_id INTEGER NOT NULL REFERENCES convenios\(id\)/);
  assert.match(sql, /CHECK \(tipo_atendimento IN \('fisioterapia', 'psicologia'\)\)/);
  assert.match(sql, /CHECK \(categoria IN \('avaliacao', 'sessao'\)\)/);
  assert.match(sql, /codigo_tuss TEXT NOT NULL/);
  assert.match(sql, /UNIQUE \(convenio_id, tipo_atendimento, categoria\)/);
});

test("migration 033: cria avaliacoes_fisioterapeuticas com paciente_id/data_avaliacao obrigatórios e resto nullable", async () => {
  const sql = await readFile(MIGRATION_033, "utf8");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS avaliacoes_fisioterapeuticas/);
  assert.match(sql, /paciente_id INTEGER NOT NULL REFERENCES pacientes\(id\)/);
  assert.match(sql, /data_avaliacao DATE NOT NULL/);
  assert.match(sql, /registrado_por INTEGER NOT NULL REFERENCES usuarios\(id\)/);

  for (const coluna of [
    "esta_gravida", "possui_marcapasso", "possui_protese_metalica_implantes",
    "possui_doencas_cardiacas", "possui_hipertensao_arterial", "possui_diabetes",
    "possui_epilepsia", "possui_historico_cancer", "medicamentos_continuos_quais",
    "cirurgia_qual", "cirurgia_quando", "tempo_ultima_cirurgia", "dor_atual_local",
    "dor_atual_intensidade", "limitacoes_funcionais_quais", "fisioterapia_anteriormente",
    "objetivos_tratamento", "condutas_propostas",
  ]) {
    assert.match(sql, new RegExp(`${coluna} TEXT`));
    assert.doesNotMatch(sql, new RegExp(`${coluna} TEXT NOT NULL`));
  }

  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_avaliacoes_fisioterapeuticas_paciente/);
});
