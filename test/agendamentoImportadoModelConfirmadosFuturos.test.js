import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { buscarAgendamentosImportadosConfirmadosFuturos } from "../src/models/agendamentoImportadoModel.js";

test("buscarAgendamentosImportadosConfirmadosFuturos: filtra por status = 'confirmado' e data futura", async (t) => {
  let sqlRecebido = null;
  t.mock.method(pool, "query", async (sql) => {
    sqlRecebido = sql;
    return { rows: [] };
  });

  await buscarAgendamentosImportadosConfirmadosFuturos("5511999990000");

  assert.match(sqlRecebido, /status = 'confirmado'/);
  assert.match(sqlRecebido, /data >=/);
});

test("buscarAgendamentosImportadosConfirmadosFuturos: retorna várias linhas quando o paciente tem mais de uma consulta confirmada", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      { id: 1, data: "2026-09-15", hora: "09:00:00" },
      { id: 2, data: "2026-09-22", hora: "09:00:00" },
    ],
  }));

  const resultado = await buscarAgendamentosImportadosConfirmadosFuturos("5511999990000");

  assert.equal(resultado.length, 2);
});

test("buscarAgendamentosImportadosConfirmadosFuturos: aceita telefone salvo sem DDI", async (t) => {
  let paramsRecebidos = null;
  t.mock.method(pool, "query", async (_sql, params) => {
    paramsRecebidos = params;
    return { rows: [] };
  });

  await buscarAgendamentosImportadosConfirmadosFuturos("5511999990000");

  assert.deepEqual(paramsRecebidos, ["5511999990000", "11999990000"]);
});
