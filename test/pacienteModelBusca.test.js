import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { buscarPacientesPorNomeOuTelefone } from "../src/models/pacienteModel.js";

test("buscarPacientesPorNomeOuTelefone: termo vazio não consulta o banco e retorna lista vazia", async (t) => {
  let consultou = false;
  t.mock.method(pool, "query", async () => ((consultou = true), { rows: [] }));

  const resultado = await buscarPacientesPorNomeOuTelefone("");
  assert.deepEqual(resultado, []);
  assert.equal(consultou, false);
});

test("buscarPacientesPorNomeOuTelefone: busca por nome (ILIKE) e telefone (dígitos) e limita a 10", async (t) => {
  let sqlCapturado = null;
  let paramsCapturados = null;
  t.mock.method(pool, "query", async (sql, params) => {
    sqlCapturado = sql;
    paramsCapturados = params;
    return { rows: [] };
  });

  await buscarPacientesPorNomeOuTelefone("Ana 11999");

  assert.match(sqlCapturado, /ILIKE/);
  assert.match(sqlCapturado, /LIMIT 10/);
  assert.match(sqlCapturado, /p\.ativo/, "paciente arquivado não deve aparecer no autocomplete");
  assert.equal(paramsCapturados[0], "%Ana 11999%");
  assert.equal(paramsCapturados[1], "11999");
});

test("buscarPacientesPorNomeOuTelefone: também busca por CPF (mesmos dígitos usados pro telefone)", async (t) => {
  let sqlCapturado = null;
  t.mock.method(pool, "query", async (sql) => {
    sqlCapturado = sql;
    return { rows: [] };
  });

  await buscarPacientesPorNomeOuTelefone("12345678900");

  assert.match(sqlCapturado, /p\.cpf/, "deveria comparar contra o CPF do paciente também");
});

test("buscarPacientesPorNomeOuTelefone: quando o termo não tem nenhum dígito, o parâmetro de telefone vai como null", async (t) => {
  let paramsCapturados = null;
  t.mock.method(pool, "query", async (sql, params) => {
    paramsCapturados = params;
    return { rows: [] };
  });

  await buscarPacientesPorNomeOuTelefone("Ana Paula");
  assert.equal(paramsCapturados[1], null);
});

test("buscarPacientesPorNomeOuTelefone: retorna total_consultas e ultima_consulta por paciente", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      { id: 1, nome: "Ana", telefone: "5511999990000", convenio: "Mar Azul Saúde", total_consultas: 3, ultima_consulta: "2026-08-20" },
    ],
  }));

  const resultado = await buscarPacientesPorNomeOuTelefone("Ana");
  assert.equal(resultado[0].total_consultas, 3);
  assert.equal(resultado[0].ultima_consulta, "2026-08-20");
});
