import { test } from "node:test";
import assert from "node:assert/strict";
import { extrairPalavrasChave } from "../src/models/baseConhecimentoModel.js";

test("extrairPalavrasChave remove acentos, pontuação e stopwords", () => {
  assert.deepEqual(extrairPalavrasChave("Vocês têm estacionamento?"), ["estacionamento"]);
});

test("extrairPalavrasChave devolve a pergunta original se só sobrarem stopwords/palavras curtas", () => {
  assert.deepEqual(extrairPalavrasChave("Isso é aqui"), ["Isso é aqui"]);
});

test("extrairPalavrasChave mantém múltiplas palavras relevantes", () => {
  assert.deepEqual(extrairPalavrasChave("Qual o horário de funcionamento da clínica?"), [
    "horario",
    "funcionamento",
    "clinica",
  ]);
});
