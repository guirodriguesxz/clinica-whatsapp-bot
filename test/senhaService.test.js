import { test } from "node:test";
import assert from "node:assert/strict";
import { hashSenha, compararSenha } from "../src/services/senhaService.js";

test("hashSenha nunca devolve a senha em texto puro", async () => {
  const hash = await hashSenha("minhaSenha123");
  assert.notEqual(hash, "minhaSenha123");
  assert.match(hash, /^\$2[aby]\$/);
});

test("compararSenha retorna true para a senha correta", async () => {
  const hash = await hashSenha("minhaSenha123");
  assert.equal(await compararSenha("minhaSenha123", hash), true);
});

test("compararSenha retorna false para senha errada", async () => {
  const hash = await hashSenha("minhaSenha123");
  assert.equal(await compararSenha("outraSenha", hash), false);
});
