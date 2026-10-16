// test/pacienteModelEncontrarOuCriar.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { encontrarOuCriarPaciente } from "../src/models/pacienteModel.js";

function mockarQuery(t, { existente = null, criado } = {}) {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("SELECT * FROM pacientes WHERE telefone")) {
      return { rows: existente ? [existente] : [] };
    }
    return { rows: [criado] };
  });
  return chamadas;
}

test("encontrarOuCriarPaciente: paciente já existente retorna sem inserir de novo", async (t) => {
  const chamadas = mockarQuery(t, { existente: { id: 1, telefone: "5511999990000" } });

  const resultado = await encontrarOuCriarPaciente({ nome: "Ana", telefone: "5511999990000" });

  assert.equal(resultado.id, 1);
  assert.equal(chamadas.length, 1, "não deveria inserir, só a busca por telefone");
});

test("encontrarOuCriarPaciente: sem convenioId (fluxo do bot), grava só o texto livre", async (t) => {
  const chamadas = mockarQuery(t, { criado: { id: 2, nome: "Bruno", convenio: "Mar Azul Saúde" } });

  await encontrarOuCriarPaciente({ nome: "Bruno", telefone: "5511988880000", convenio: "Mar Azul Saúde" });

  const insercao = chamadas.find((c) => c.sql.includes("INSERT INTO pacientes"));
  assert.deepEqual(insercao.params, ["Bruno", "5511988880000", "Mar Azul Saúde", null]);
});

test("encontrarOuCriarPaciente: com convenioId, o texto convenio sincroniza com o nome do convênio", async (t) => {
  const chamadas = mockarQuery(t, { criado: { id: 3, nome: "Carla", convenio: "Bio Vida" } });

  await encontrarOuCriarPaciente({ nome: "Carla", telefone: "5511977770000", convenioId: 4 });

  const insercao = chamadas.find((c) => c.sql.includes("INSERT INTO pacientes"));
  assert.match(insercao.sql, /COALESCE\(\(SELECT nome FROM convenios WHERE id = \$4\), \$3\)/);
  assert.deepEqual(insercao.params, ["Carla", "5511977770000", null, 4]);
});
