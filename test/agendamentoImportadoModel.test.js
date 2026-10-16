import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import {
  buscarProximoAgendamentoImportado,
  buscarAgendamentosImportadosSemLembreteVespera,
  buscarAgendamentoImportadoConfirmadoNaData,
  buscarAgendamentosImportadosFuturosCompletos,
} from "../src/models/agendamentoImportadoModel.js";

// Finding 8 do review final: sem filtro de status, o bot podia contar pro
// paciente sobre um agendamento importado que a recepção já cancelou pelo
// dashboard (agendamentos_importados ganhou status na migration 020).
test("buscarProximoAgendamentoImportado: filtra por status = 'confirmado'", async (t) => {
  let sqlRecebido = null;
  t.mock.method(pool, "query", async (sql) => {
    sqlRecebido = sql;
    return { rows: [] };
  });

  await buscarProximoAgendamentoImportado("5511999990000");

  assert.match(sqlRecebido, /status = 'confirmado'/);
});

test("buscarProximoAgendamentoImportado: não retorna um agendamento cancelado (query real simulada)", async (t) => {
  // Simula o comportamento do WHERE: um mock "burro" que devolve linhas
  // filtradas de acordo com o status = 'confirmado' que a query pede,
  // reproduzindo no JS a garantia que o SQL deve dar.
  const linhas = [
    { nome: "Ana", data: "2026-09-10", hora: "10:00:00", status: "cancelado" },
    { nome: "Ana", data: "2026-09-15", hora: "09:00:00", status: "confirmado" },
  ];
  t.mock.method(pool, "query", async (sql) => {
    assert.match(sql, /status = 'confirmado'/, "a query deve filtrar por status no banco");
    const confirmadas = linhas.filter((l) => l.status === "confirmado");
    return { rows: confirmadas };
  });

  const resultado = await buscarProximoAgendamentoImportado("5511999990000");

  assert.equal(resultado.data, "2026-09-15");
});

// Finding 1 (crítico) do review final: sem esse filtro, o lembrete era
// enviado mesmo pra consulta importada que a recepção já cancelou.
test("buscarAgendamentosImportadosSemLembreteVespera: filtra por status = 'confirmado'", async (t) => {
  let sqlRecebido = null;
  t.mock.method(pool, "query", async (sql) => {
    sqlRecebido = sql;
    return { rows: [] };
  });

  await buscarAgendamentosImportadosSemLembreteVespera();

  assert.match(sqlRecebido, /status = 'confirmado'/);
});

test("buscarAgendamentosImportadosSemLembreteVespera: exclui candidato cancelado (query real simulada)", async (t) => {
  const linhas = [
    { id: 1, telefone: "11999990000", status: "cancelado", lembrete_24h_enviado_em: null },
    { id: 2, telefone: "11988880000", status: "confirmado", lembrete_24h_enviado_em: null },
  ];
  t.mock.method(pool, "query", async (sql) => {
    assert.match(sql, /status = 'confirmado'/, "a query deve filtrar por status no banco");
    const confirmadas = linhas.filter((l) => l.status === "confirmado");
    return { rows: confirmadas };
  });

  const resultado = await buscarAgendamentosImportadosSemLembreteVespera();

  assert.deepEqual(
    resultado.map((r) => r.id),
    [2]
  );
});

test("buscarAgendamentoImportadoConfirmadoNaData: acha agendamento confirmado nessa data, aceitando telefone com ou sem DDI", async (t) => {
  let sqlRecebido = null;
  let paramsRecebidos = null;
  t.mock.method(pool, "query", async (sql, params) => {
    sqlRecebido = sql;
    paramsRecebidos = params;
    return { rows: [{ nome: "Fernanda", data: "2026-09-11", hora: "17:00:00", tipo_atendimento: "fisioterapia" }] };
  });

  const resultado = await buscarAgendamentoImportadoConfirmadoNaData("5511999990004", "2026-09-11");

  assert.deepEqual(paramsRecebidos, ["5511999990004", "11999990004", "2026-09-11"]);
  assert.match(sqlRecebido, /status = 'confirmado'/);
  assert.equal(resultado.nome, "Fernanda");
});

test("buscarAgendamentoImportadoConfirmadoNaData: sem agendamento confirmado nessa data, retorna null", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await buscarAgendamentoImportadoConfirmadoNaData("5511999990004", "2026-09-11");

  assert.equal(resultado, null);
});

test("buscarAgendamentosImportadosFuturosCompletos: filtra por status = 'confirmado' e data futura", async (t) => {
  let sqlRecebido = null;
  t.mock.method(pool, "query", async (sql) => {
    sqlRecebido = sql;
    return { rows: [] };
  });

  await buscarAgendamentosImportadosFuturosCompletos("5511999990000");

  assert.match(sqlRecebido, /status = 'confirmado'/);
  assert.match(sqlRecebido, /data >=/);
  assert.doesNotMatch(sqlRecebido, /LIMIT 1/);
});

test("buscarAgendamentosImportadosFuturosCompletos: retorna todas as consultas confirmadas, não só a mais próxima", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      { nome: "Jacqueline", data: "2026-09-11", hora: "14:00:00", tipo_atendimento: "fisioterapia" },
      { nome: "Jacqueline", data: "2026-09-15", hora: "09:00:00", tipo_atendimento: "psicologia" },
    ],
  }));

  const resultado = await buscarAgendamentosImportadosFuturosCompletos("5511999990000");

  assert.equal(resultado.length, 2);
});

test("buscarAgendamentosImportadosFuturosCompletos: aceita telefone salvo sem DDI", async (t) => {
  let paramsRecebidos = null;
  t.mock.method(pool, "query", async (_sql, params) => {
    paramsRecebidos = params;
    return { rows: [] };
  });

  await buscarAgendamentosImportadosFuturosCompletos("5511999990000");

  assert.deepEqual(paramsRecebidos, ["5511999990000", "11999990000"]);
});
