// test/feriados.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { ehFeriado } from "../src/utils/feriados.js";
import dayjs from "../src/utils/dayjs.js";

test("ehFeriado: reconhece feriados nacionais fixos", () => {
  assert.equal(ehFeriado(dayjs("2026-01-01")), true); // Confraternização Universal
  assert.equal(ehFeriado(dayjs("2026-04-21")), true); // Tiradentes
  assert.equal(ehFeriado(dayjs("2026-09-07")), true); // Independência
  assert.equal(ehFeriado(dayjs("2026-11-20")), true); // Consciência Negra
  assert.equal(ehFeriado(dayjs("2026-12-25")), true); // Natal
});

test("ehFeriado: reconhece feriado estadual de SP (Revolução Constitucionalista)", () => {
  assert.equal(ehFeriado(dayjs("2026-07-09")), true);
});

test("ehFeriado: reconhece feriado municipal de São Paulo (aniversário da cidade)", () => {
  assert.equal(ehFeriado(dayjs("2026-01-25")), true);
});

test("ehFeriado: reconhece feriados móveis (Carnaval, Sexta-feira Santa, Corpus Christi) em 2026", () => {
  // Páscoa 2026 cai em 05/04.
  assert.equal(ehFeriado(dayjs("2026-02-16")), true); // Carnaval (segunda)
  assert.equal(ehFeriado(dayjs("2026-02-17")), true); // Carnaval (terça)
  assert.equal(ehFeriado(dayjs("2026-04-03")), true); // Sexta-feira Santa
  assert.equal(ehFeriado(dayjs("2026-06-04")), true); // Corpus Christi
});

test("ehFeriado: dia útil comum não é feriado", () => {
  assert.equal(ehFeriado(dayjs("2026-03-10")), false);
});
