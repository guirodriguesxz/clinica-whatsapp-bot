import { test } from "node:test";
import assert from "node:assert/strict";
import { CATEGORIAS_BASE_CONHECIMENTO } from "../src/constants/categoriasBaseConhecimento.js";

test("CATEGORIAS_BASE_CONHECIMENTO tem valor e rótulo únicos", () => {
  assert.ok(Array.isArray(CATEGORIAS_BASE_CONHECIMENTO));
  assert.ok(CATEGORIAS_BASE_CONHECIMENTO.length >= 8);

  const valores = CATEGORIAS_BASE_CONHECIMENTO.map((c) => c.valor);
  assert.equal(new Set(valores).size, valores.length, "valores não podem se repetir");

  for (const categoria of CATEGORIAS_BASE_CONHECIMENTO) {
    assert.equal(typeof categoria.valor, "string");
    assert.equal(typeof categoria.rotulo, "string");
    assert.ok(categoria.valor.length > 0);
    assert.ok(categoria.rotulo.length > 0);
  }
});

test("CATEGORIAS_BASE_CONHECIMENTO inclui 'geral' como opção coringa", () => {
  assert.ok(CATEGORIAS_BASE_CONHECIMENTO.some((c) => c.valor === "geral"));
});
