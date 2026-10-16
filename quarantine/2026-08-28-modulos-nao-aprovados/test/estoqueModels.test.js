// test/estoqueModels.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { listarFornecedores, criarFornecedor } from "../src/models/fornecedorModel.js";
import { listarCentrosCusto, criarCentroCusto } from "../src/models/centroCustoModel.js";
import { listarMateriais, criarMaterial } from "../src/models/materialModel.js";

test("listarFornecedores: só lista ativos, ordenado por nome", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [{ id: 1, nome: "Fornecedor A" }] };
  });

  const rows = await listarFornecedores();

  assert.match(chamadas[0].sql, /ativo = true/);
  assert.match(chamadas[0].sql, /ORDER BY nome/);
  assert.deepEqual(rows, [{ id: 1, nome: "Fornecedor A" }]);
});

test("criarFornecedor: insere nome/telefone/observacao", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [{ id: 1, nome: "Fornecedor A" }] };
  });

  await criarFornecedor({ nome: "Fornecedor A", telefone: "11999998888", observacao: null });

  assert.deepEqual(chamadas[0].params, ["Fornecedor A", "11999998888", null]);
});

test("listarCentrosCusto: só lista ativos", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [{ id: 1, nome: "Fisioterapia" }] };
  });

  await listarCentrosCusto();

  assert.match(chamadas[0].sql, /ativo = true/);
});

test("criarCentroCusto: insere nome/descricao", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [{ id: 1 }] };
  });

  await criarCentroCusto({ nome: "Fisioterapia", descricao: "Consultório 1" });

  assert.deepEqual(chamadas[0].params, ["Fisioterapia", "Consultório 1"]);
});

test("listarMateriais: resolve nome de fornecedor e centro de custo via LEFT JOIN", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return {
      rows: [
        {
          id: 1,
          nome: "Eletrodo",
          quantidade_em_estoque: 5,
          estoque_minimo: 10,
          fornecedor_nome: "Fornecedor A",
          centro_custo_nome: "Fisioterapia",
        },
      ],
    };
  });

  const rows = await listarMateriais();

  assert.match(chamadas[0].sql, /LEFT JOIN fornecedores/);
  assert.match(chamadas[0].sql, /LEFT JOIN centros_custo/);
  assert.equal(rows[0].fornecedor_nome, "Fornecedor A");
});

test("criarMaterial: insere todos os campos na ordem certa", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [{ id: 1 }] };
  });

  await criarMaterial({
    nome: "Eletrodo",
    categoria: "Fisioterapia",
    unidadeMedida: "unidade",
    quantidadeEmEstoque: 50,
    estoqueMinimo: 10,
    fornecedorId: 1,
    centroCustoId: 2,
  });

  assert.deepEqual(chamadas[0].params, ["Eletrodo", "Fisioterapia", "unidade", 50, 10, 1, 2]);
});
