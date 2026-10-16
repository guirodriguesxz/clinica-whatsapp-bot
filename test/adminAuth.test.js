import test from "node:test";
import assert from "node:assert/strict";

process.env.ADMIN_API_KEY = "chave-admin-de-teste";
const { verificarApiKeyAdmin } = await import("../src/middleware/auth.js");

function criarRespostaFalsa() {
  return {
    statusCode: null,
    corpo: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(corpo) {
      this.corpo = corpo;
    },
  };
}

test("verificarApiKeyAdmin aceita a chave somente pelo cabeçalho", () => {
  const req = {
    header: (nome) => (nome === "x-admin-api-key" ? "chave-admin-de-teste" : undefined),
    query: {},
  };
  const res = criarRespostaFalsa();
  let chamouNext = false;

  verificarApiKeyAdmin(req, res, () => {
    chamouNext = true;
  });

  assert.equal(chamouNext, true);
  assert.equal(res.statusCode, null);
});

test("verificarApiKeyAdmin recusa chave enviada na URL", () => {
  const req = {
    header: () => undefined,
    query: { chave: "chave-admin-de-teste" },
  };
  const res = criarRespostaFalsa();
  let chamouNext = false;

  verificarApiKeyAdmin(req, res, () => {
    chamouNext = true;
  });

  assert.equal(chamouNext, false);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.corpo, { erro: "Não autorizado." });
});
