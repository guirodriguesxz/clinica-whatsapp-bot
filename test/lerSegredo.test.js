import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { lerSegredo } from "../src/utils/lerSegredo.js";

test("lerSegredo lê uma linha do stdin sem reproduzir o conteúdo na saída", async () => {
  const entrada = new PassThrough();
  const saida = new PassThrough();
  let textoSaida = "";
  saida.on("data", (chunk) => {
    textoSaida += chunk.toString();
  });
  entrada.end("valor-temporario\n");

  const segredo = await lerSegredo({ entrada, saida, prompt: "Senha: " });

  assert.equal(segredo, "valor-temporario");
  assert.equal(textoSaida.includes("valor-temporario"), false);
  assert.match(textoSaida, /Senha:/);
});
