import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { buscarDadosPrestador, salvarDadosPrestador } from "../src/models/dadosPrestadorModel.js";

test("buscarDadosPrestador: retorna null quando a tabela está vazia", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const resultado = await buscarDadosPrestador();
  assert.equal(resultado, null);
});

test("buscarDadosPrestador: retorna a linha existente", async (t) => {
  const linha = { id: 1, cnes: "123456", razao_social: "Clínica Exemplo", cnpj: "00.000.000/0001-00" };
  t.mock.method(pool, "query", async () => ({ rows: [linha] }));
  const resultado = await buscarDadosPrestador();
  assert.deepEqual(resultado, linha);
});

test("salvarDadosPrestador: sem linha existente, insere", async (t) => {
  let comandoExecutado = "";
  t.mock.method(pool, "query", async (sql) => {
    comandoExecutado += sql.trim().split(" ")[0] + " ";
    if (sql.includes("SELECT")) return { rows: [] };
    return { rows: [{ id: 1, cnes: "123456", razao_social: null, cnpj: null }] };
  });

  const resultado = await salvarDadosPrestador({ cnes: "123456", razaoSocial: null, cnpj: null });

  assert.match(comandoExecutado, /SELECT.*INSERT/);
  assert.equal(resultado.id, 1);
});

test("salvarDadosPrestador: com linha existente, atualiza", async (t) => {
  let comandoExecutado = "";
  t.mock.method(pool, "query", async (sql) => {
    comandoExecutado += sql.trim().split(" ")[0] + " ";
    if (sql.includes("SELECT")) return { rows: [{ id: 5, cnes: "111", razao_social: null, cnpj: null }] };
    return { rows: [{ id: 5, cnes: "222", razao_social: "Clínica Exemplo", cnpj: null }] };
  });

  const resultado = await salvarDadosPrestador({ cnes: "222", razaoSocial: "Clínica Exemplo", cnpj: null });

  assert.match(comandoExecutado, /SELECT.*UPDATE/);
  assert.equal(resultado.cnes, "222");
});

test("salvarDadosPrestador: grava CBO de fisioterapia e psicologia", async (t) => {
  let paramsInsert = null;
  t.mock.method(pool, "query", async (sql, params) => {
    if (sql.includes("SELECT")) return { rows: [] };
    paramsInsert = params;
    return {
      rows: [
        {
          id: 1,
          cnes: null,
          razao_social: null,
          cnpj: null,
          cbo_fisioterapia: "2236-05",
          cbo_psicologia: "2515-05",
        },
      ],
    };
  });

  const resultado = await salvarDadosPrestador({
    cnes: null,
    razaoSocial: null,
    cnpj: null,
    cboFisioterapia: "2236-05",
    cboPsicologia: "2515-05",
  });

  assert.deepEqual(paramsInsert, [null, null, null, "2236-05", "2515-05"]);
  assert.equal(resultado.cbo_fisioterapia, "2236-05");
  assert.equal(resultado.cbo_psicologia, "2515-05");
});
