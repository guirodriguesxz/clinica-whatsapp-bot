import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import {
  criarSugestaoConhecimento,
  listarSugestoesConhecimentoPendentes,
  buscarSugestaoConhecimentoPorId,
  definirStatusSugestaoConhecimento,
} from "../src/models/sugestaoConhecimentoModel.js";

function mockarQuery(t, linhas = []) {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: linhas };
  });
  return consultas;
}

test("criarSugestaoConhecimento grava pergunta, telefone e nome do paciente", async (t) => {
  const consultas = mockarQuery(t, [
    { id: 1, pergunta: "Vocês atendem pelo plano X?", paciente_telefone: "5511988887777", paciente_nome: "Ana" },
  ]);

  const resultado = await criarSugestaoConhecimento({
    pergunta: "Vocês atendem pelo plano X?",
    telefone: "5511988887777",
    nome: "Ana",
  });

  assert.deepEqual(consultas[0].params, ["Vocês atendem pelo plano X?", "5511988887777", "Ana"]);
  assert.equal(resultado.id, 1);
});

test("criarSugestaoConhecimento aceita telefone/nome ausentes", async (t) => {
  const consultas = mockarQuery(t, [{ id: 2, pergunta: "p" }]);

  await criarSugestaoConhecimento({ pergunta: "p" });

  assert.deepEqual(consultas[0].params, ["p", null, null]);
});

test("listarSugestoesConhecimentoPendentes só busca status pendente, mais recentes primeiro", async (t) => {
  const consultas = mockarQuery(t, [{ id: 1, pergunta: "p", status: "pendente" }]);

  const resultado = await listarSugestoesConhecimentoPendentes();

  assert.match(consultas[0].sql, /WHERE status = 'pendente'/i);
  assert.match(consultas[0].sql, /ORDER BY created_at DESC/i);
  assert.equal(resultado.length, 1);
});

test("buscarSugestaoConhecimentoPorId retorna null quando não existe", async (t) => {
  mockarQuery(t, []);

  const resultado = await buscarSugestaoConhecimentoPorId(999);

  assert.equal(resultado, null);
});

test("definirStatusSugestaoConhecimento atualiza o status informado", async (t) => {
  const consultas = mockarQuery(t, [{ id: 5, status: "aprovada" }]);

  const resultado = await definirStatusSugestaoConhecimento(5, "aprovada");

  assert.deepEqual(consultas[0].params, [5, "aprovada"]);
  assert.equal(resultado.status, "aprovada");
});

test("definirStatusSugestaoConhecimento retorna null quando o id não existe", async (t) => {
  mockarQuery(t, []);

  const resultado = await definirStatusSugestaoConhecimento(999, "descartada");

  assert.equal(resultado, null);
});
