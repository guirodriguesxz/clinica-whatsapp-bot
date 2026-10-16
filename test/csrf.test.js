import { test } from "node:test";
import assert from "node:assert/strict";
import { gerarTokenCsrf, tokenCsrfValido } from "../src/utils/csrf.js";

test("gerarTokenCsrf gera tokens diferentes a cada chamada", () => {
  const a = gerarTokenCsrf();
  const b = gerarTokenCsrf();
  assert.notEqual(a, b);
  assert.equal(a.length, 64);
});

test("tokenCsrfValido aceita quando os tokens são iguais", () => {
  const token = gerarTokenCsrf();
  assert.equal(tokenCsrfValido(token, token), true);
});

test("tokenCsrfValido rejeita quando os tokens são diferentes", () => {
  assert.equal(tokenCsrfValido(gerarTokenCsrf(), gerarTokenCsrf()), false);
});

test("tokenCsrfValido rejeita quando não há token na sessão", () => {
  assert.equal(tokenCsrfValido(undefined, "qualquer"), false);
});
