// test/convenioProcedimentoTussModel.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { listarProcedimentosTuss, salvarProcedimentosTuss } from "../src/models/convenioProcedimentoTussModel.js";

test("listarProcedimentosTuss: retorna as linhas cadastradas do convênio", async (t) => {
  const linhas = [{ tipo_atendimento: "fisioterapia", categoria: "sessao", codigo_tuss: "10101012", descricao_tuss: "Sessão de fisioterapia" }];
  t.mock.method(pool, "query", async () => ({ rows: linhas }));

  const resultado = await listarProcedimentosTuss(5);
  assert.deepEqual(resultado, linhas);
});

test("salvarProcedimentosTuss: linha com código faz upsert (INSERT ... ON CONFLICT)", async (t) => {
  const comandos = [];
  const clienteFalso = {
    query: async (sql, parametros) => { comandos.push({ sql, parametros }); return { rows: [] }; },
    release: () => {},
  };
  t.mock.method(pool, "connect", async () => clienteFalso);

  await salvarProcedimentosTuss(5, [
    { tipoAtendimento: "fisioterapia", categoria: "sessao", codigoTuss: "10101012", descricaoTuss: "Sessão" },
  ]);

  assert.equal(comandos[0].sql, "BEGIN");
  assert.match(comandos[1].sql, /INSERT INTO convenio_procedimentos_tuss/);
  assert.match(comandos[1].sql, /ON CONFLICT \(convenio_id, tipo_atendimento, categoria\)/);
  assert.deepEqual(comandos[1].parametros, [5, "fisioterapia", "sessao", "10101012", "Sessão"]);
  assert.equal(comandos[2].sql, "COMMIT");
});

test("salvarProcedimentosTuss: linha sem código remove o mapeamento existente (DELETE)", async (t) => {
  const comandos = [];
  const clienteFalso = {
    query: async (sql, parametros) => { comandos.push({ sql, parametros }); return { rows: [] }; },
    release: () => {},
  };
  t.mock.method(pool, "connect", async () => clienteFalso);

  await salvarProcedimentosTuss(5, [
    { tipoAtendimento: "psicologia", categoria: "avaliacao", codigoTuss: null, descricaoTuss: null },
  ]);

  assert.match(comandos[1].sql, /DELETE FROM convenio_procedimentos_tuss/);
  assert.deepEqual(comandos[1].parametros, [5, "psicologia", "avaliacao"]);
});

test("salvarProcedimentosTuss: erro no meio faz ROLLBACK e relança", async (t) => {
  const comandos = [];
  const clienteFalso = {
    query: async (sql) => {
      comandos.push(sql);
      if (sql.startsWith("INSERT")) throw new Error("falha simulada");
      return { rows: [] };
    },
    release: () => {},
  };
  t.mock.method(pool, "connect", async () => clienteFalso);

  await assert.rejects(
    () => salvarProcedimentosTuss(5, [
      { tipoAtendimento: "fisioterapia", categoria: "sessao", codigoTuss: "1", descricaoTuss: null },
    ]),
    /falha simulada/
  );
  assert.ok(comandos.includes("ROLLBACK"));
});
