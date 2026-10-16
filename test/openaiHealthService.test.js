import "./setupEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { openai } from "../src/config/openai.js";
import { evolutionApi } from "../src/config/evolutionApi.js";
import { verificarCreditosOpenAI } from "../src/services/openaiHealthService.js";

function erroOpenAI(status, code) {
  return Object.assign(new Error(`erro simulado ${status}/${code}`), { status, code });
}

// O módulo guarda o último estado conhecido em variável de módulo (mesma
// estratégia de whatsappHealthService.js) — por isso os testes abaixo
// precisam rodar em sequência, simulando a linha do tempo real: disponível
// -> sem créditos -> ainda sem créditos (não deve repetir aviso) -> normalizado.

test("verificarCreditosOpenAI não avisa nada quando os créditos continuam disponíveis (estado inicial)", async (t) => {
  t.mock.method(openai.chat.completions, "create", async () => ({
    choices: [{ message: { content: "pong" } }],
  }));
  const postMock = t.mock.method(evolutionApi, "post", async () => ({ data: {} }));

  await verificarCreditosOpenAI();

  assert.equal(postMock.mock.calls.length, 0);
});

test("verificarCreditosOpenAI avisa a equipe por WhatsApp na transição para SEM créditos", async (t) => {
  t.mock.method(openai.chat.completions, "create", async () => {
    throw erroOpenAI(429, "insufficient_quota");
  });
  const postMock = t.mock.method(evolutionApi, "post", async () => ({ data: {} }));

  await verificarCreditosOpenAI();

  // enviarMensagem checa o JID, manda a presence "composing" e só então o texto: 3 chamadas.
  assert.equal(postMock.mock.calls.length, 3);
  assert.match(postMock.mock.calls[2].arguments[1].text, /sem créditos/);
});

test("verificarCreditosOpenAI NÃO repete o aviso enquanto o estado continuar sem créditos", async (t) => {
  t.mock.method(openai.chat.completions, "create", async () => {
    throw erroOpenAI(429, "insufficient_quota");
  });
  const postMock = t.mock.method(evolutionApi, "post", async () => ({ data: {} }));

  await verificarCreditosOpenAI();

  assert.equal(postMock.mock.calls.length, 0);
});

test("verificarCreditosOpenAI não avisa (nem muda estado) em erro que não é de créditos, ex: instabilidade de rede", async (t) => {
  t.mock.method(openai.chat.completions, "create", async () => {
    throw erroOpenAI(500, "server_error");
  });
  const postMock = t.mock.method(evolutionApi, "post", async () => ({ data: {} }));

  await verificarCreditosOpenAI();

  assert.equal(postMock.mock.calls.length, 0);
});

test("verificarCreditosOpenAI não manda WhatsApp na transição de volta pra disponível (só normaliza o estado)", async (t) => {
  t.mock.method(openai.chat.completions, "create", async () => ({
    choices: [{ message: { content: "pong" } }],
  }));
  const postMock = t.mock.method(evolutionApi, "post", async () => ({ data: {} }));

  await verificarCreditosOpenAI();

  assert.equal(postMock.mock.calls.length, 0);
});
