import { test } from "node:test";
import assert from "node:assert/strict";
import { slugArquivo } from "../src/utils/slugArquivo.js";

test("slugArquivo: remove acento e normaliza pra minúsculo com hífen", () => {
  assert.equal(slugArquivo("João da Silva"), "joao-da-silva");
});

test("slugArquivo: texto vazio ou só símbolos devolve 'paciente'", () => {
  assert.equal(slugArquivo("!!!"), "paciente");
});
