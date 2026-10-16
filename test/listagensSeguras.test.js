import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { listarAgendamentos } from "../src/models/agendamentoModel.js";
import { listarPacientes } from "../src/models/pacienteModel.js";
import { listarPresenca } from "../src/models/registroAtendimentoModel.js";
import { retomarAtendimento } from "../src/controllers/adminController.js";

test("listarAgendamentos normaliza paginação inválida antes da consulta", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });

  await listarAgendamentos({ limite: "1.5", offset: "Infinity" });

  assert.deepEqual(consultas[0].params, [50, 0]);
});

test("listarPacientes normaliza paginação inválida antes da consulta", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });

  await listarPacientes({ limite: "1.5", offset: "Infinity" });

  assert.deepEqual(consultas[0].params, [50, 0, null, null, null]);
});

test("listarPacientes só traz paciente ativo (arquivado não aparece na lista)", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });

  await listarPacientes({});

  assert.match(consultas[0].sql, /WHERE ativo/);
});

test("listarPacientes: busca por nome (ILIKE) e telefone (só dígitos)", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });

  await listarPacientes({ busca: "(11) 99999-0000" });

  assert.match(consultas[0].sql, /ILIKE/);
  assert.match(consultas[0].sql, /regexp_replace\(telefone/);
  assert.equal(consultas[0].params[2], "%(11) 99999-0000%");
  assert.equal(consultas[0].params[3], "11999990000");
});

test("listarPacientes: busca só com dígitos-vazios (letras) não filtra por telefone (evita casar tudo)", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });

  await listarPacientes({ busca: "Maria" });

  assert.equal(consultas[0].params[2], "%Maria%");
  assert.equal(consultas[0].params[3], null);
});

test("listarPacientes: avaliacao='avaliacao' filtra por EXISTS com primeira_consulta = true", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });

  await listarPacientes({ avaliacao: "avaliacao" });

  assert.match(consultas[0].sql, /EXISTS/);
  assert.match(consultas[0].sql, /a\.primeira_consulta = \$5/);
  assert.equal(consultas[0].params[4], true);
});

test("listarPacientes: avaliacao='retorno' filtra com primeira_consulta = false", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });

  await listarPacientes({ avaliacao: "retorno" });

  assert.equal(consultas[0].params[4], false);
});

test("listarPacientes: valor inválido de avaliacao é ignorado (sem filtro)", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });

  await listarPacientes({ avaliacao: "outra-coisa" });

  assert.equal(consultas[0].params[4], null);
});

test("listarPresenca normaliza paginação inválida antes das consultas", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });

  await listarPresenca({ limite: "1.5", offset: "Infinity" });

  assert.deepEqual(consultas.map(({ params }) => params), [[50], [50]]);
});

test("retomarAtendimento rejeita ID parcialmente numérico sem consultar o banco", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });
  const res = {
    statusCode: 200,
    corpo: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(corpo) {
      this.corpo = corpo;
      return this;
    },
  };

  await retomarAtendimento({ params: { id: "1abc" } }, res);

  assert.equal(res.statusCode, 404);
  assert.equal(consultas.length, 0);
});
