// test/dinheiro.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatarMoeda } from "../src/utils/dinheiro.js";

// A mesma quantia chega em formatos diferentes dependendo de como o driver
// pg devolve a coluna: um valor dentro de json_build_object vira JS number
// (ex: 150.5, sem zero à direita), enquanto um NUMERIC lido direto de coluna
// vira string (ex: "150.00"). formatarMoeda precisa normalizar os dois pro
// mesmo formato de 2 casas decimais, senão a mesma quantia aparece diferente
// em /financeiro (lista) e /financeiro/relatorio.
test("formatarMoeda: number sem zero à direita (150.5) vira '150.50'", () => {
  assert.equal(formatarMoeda(150.5), "150.50");
});

test("formatarMoeda: number inteiro (150) vira '150.00'", () => {
  assert.equal(formatarMoeda(150), "150.00");
});

test("formatarMoeda: string já com 2 casas ('150.00') permanece '150.00'", () => {
  assert.equal(formatarMoeda("150.00"), "150.00");
});

test("formatarMoeda: string sem casas decimais ('150') vira '150.00'", () => {
  assert.equal(formatarMoeda("150"), "150.00");
});

test("formatarMoeda: number com mais de 2 casas (150.567) arredonda pra '150.57'", () => {
  assert.equal(formatarMoeda(150.567), "150.57");
});

test("formatarMoeda: zero (number ou string) vira '0.00'", () => {
  assert.equal(formatarMoeda(0), "0.00");
  assert.equal(formatarMoeda("0"), "0.00");
});

test("formatarMoeda: null/undefined não quebra, vira '0.00'", () => {
  assert.equal(formatarMoeda(null), "0.00");
  assert.equal(formatarMoeda(undefined), "0.00");
});
