import { test } from "node:test";
import assert from "node:assert/strict";
import { validarData, validarHora, validarTipoAtendimento } from "../src/utils/validacao.js";

test("validarData aceita datas reais no formato YYYY-MM-DD", () => {
  assert.equal(validarData("2026-08-10"), true);
});

test("validarData rejeita datas impossíveis (30 de fevereiro)", () => {
  assert.equal(validarData("2026-02-30"), false);
});

test("validarData rejeita formato fora do padrão", () => {
  assert.equal(validarData("10/08/2026"), false);
  assert.equal(validarData(""), false);
  assert.equal(validarData(undefined), false);
});

test("validarHora aceita HH:mm válido em 24h", () => {
  assert.equal(validarHora("07:00"), true);
  assert.equal(validarHora("23:59"), true);
});

test("validarHora rejeita hora ou minuto fora do intervalo", () => {
  assert.equal(validarHora("25:00"), false);
  assert.equal(validarHora("14:60"), false);
  assert.equal(validarHora("2:00"), false);
});

test("validarTipoAtendimento só aceita fisioterapia ou psicologia", () => {
  assert.equal(validarTipoAtendimento("fisioterapia"), true);
  assert.equal(validarTipoAtendimento("psicologia"), true);
  assert.equal(validarTipoAtendimento("nutricao"), false);
});
