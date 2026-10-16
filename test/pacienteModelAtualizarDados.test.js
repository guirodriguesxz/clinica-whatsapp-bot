// test/pacienteModelAtualizarDados.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { atualizarDadosPaciente } from "../src/models/pacienteModel.js";

test("atualizarDadosPaciente: grava todos os campos novos quando informados", async (t) => {
  let sqlCapturado = null;
  let paramsCapturados = null;
  t.mock.method(pool, "query", async (sql, params) => {
    sqlCapturado = sql;
    paramsCapturados = params;
    return { rows: [] };
  });

  await atualizarDadosPaciente(5, {
    nome: "Ana Silva",
    convenio: "Mar Azul Saúde",
    cpf: "111.111.111-11",
    dataNascimento: "1990-01-01",
    rg: "22.222.222-2",
    endereco: "Rua Teste",
    numero: "123",
    bairro: "Centro",
    cidade: "São Paulo",
    uf: "SP",
    cep: "01000-000",
    estadoCivil: "Solteira",
    sexo: "F",
    profissao: "Professora",
    email: "ana@example.com",
    matriculaConvenio: "999888777",
    cns: "700123456789012",
    observacao: "Alérgica a dipirona.",
  });

  assert.match(sqlCapturado, /UPDATE pacientes SET/);
  assert.deepEqual(paramsCapturados, [
    5, "Ana Silva", "Mar Azul Saúde", "111.111.111-11", "1990-01-01", "22.222.222-2",
    "Rua Teste", "123", "Centro", "São Paulo", "SP", "01000-000",
    "Solteira", "F", "Professora", "ana@example.com", "999888777", null,
    "700123456789012", "Alérgica a dipirona.",
  ]);
});

test("atualizarDadosPaciente: convenioId sincroniza convenio_id e o texto convenio com o nome do convênio", async (t) => {
  let sqlCapturado = null;
  let paramsCapturados = null;
  t.mock.method(pool, "query", async (sql, params) => {
    sqlCapturado = sql;
    paramsCapturados = params;
    return { rows: [] };
  });

  await atualizarDadosPaciente(5, { convenioId: 9 });

  assert.match(sqlCapturado, /convenio = COALESCE\(\(SELECT nome FROM convenios WHERE id = \$18\), \$3, convenio\)/);
  assert.match(sqlCapturado, /convenio_id = COALESCE\(\$18, convenio_id\)/);
  assert.equal(paramsCapturados.at(-3), 9);
});

// Comportamento existente (chamada de criarAgendamento.js, só nome/convenio)
// precisa continuar funcionando sem alterar os demais campos.
test("atualizarDadosPaciente: chamada só com nome/convenio (comportamento existente) grava null nos campos novos", async (t) => {
  let paramsCapturados = null;
  t.mock.method(pool, "query", async (sql, params) => {
    paramsCapturados = params;
    return { rows: [] };
  });

  await atualizarDadosPaciente(5, { nome: "Bruno", convenio: "Particular" });

  assert.equal(paramsCapturados[0], 5);
  assert.equal(paramsCapturados[1], "Bruno");
  assert.equal(paramsCapturados[2], "Particular");
  // Campos novos não informados viram null no parâmetro — o SQL usa
  // COALESCE($n, coluna), então null preserva o valor já gravado no banco,
  // não apaga nada.
  for (let i = 3; i < paramsCapturados.length; i++) {
    assert.equal(paramsCapturados[i], null, `parâmetro índice ${i} deveria ser null`);
  }
});

test("atualizarDadosPaciente: usa COALESCE pra preservar valores não informados", async (t) => {
  let sqlCapturado = null;
  t.mock.method(pool, "query", async (sql) => {
    sqlCapturado = sql;
    return { rows: [] };
  });

  await atualizarDadosPaciente(5, { rg: "1.234.567-8" });

  assert.match(sqlCapturado, /rg = COALESCE\(\$6, rg\)/);
  assert.match(sqlCapturado, /nome = COALESCE\(\$2, nome\)/);
});
