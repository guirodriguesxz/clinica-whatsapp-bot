import "./setupEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { openai } from "../src/config/openai.js";
import { evolutionApi } from "../src/config/evolutionApi.js";
import { processarMensagemRecebida, expediente } from "../src/services/chatService.js";

const PACIENTE = { id: 42, nome: "Paciente Teste", telefone: "5511988887777", etapa_atual: null };

function mockarBanco(t) {
  const inserts = [];
  t.mock.method(pool, "query", async (sql, params) => {
    if (sql.includes("FROM pacientes")) return { rows: [PACIENTE] };
    if (sql.includes("FROM conversas")) {
      return { rows: [{ mensagem: "Oi", remetente: "paciente", timestamp: new Date().toISOString() }] };
    }
    if (sql.includes("INSERT INTO conversas")) inserts.push(params);
    return { rows: [] };
  });
  return inserts;
}

// Fora do expediente a mensagem de ausência do WhatsApp Business já responde
// o paciente — o bot só registra e não chama a IA (decisão da clínica,
// 2026-10-02).
test("fora do expediente, o bot só registra a mensagem do paciente e não responde", async (t) => {
  const inserts = mockarBanco(t);
  t.mock.method(expediente, "estaAberto", () => false);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const createMock = t.mock.method(openai.chat.completions, "create", async () => {
    throw new Error("não deveria chamar a IA fora do expediente");
  });
  const postMock = t.mock.method(evolutionApi, "post", async () => ({ data: { key: { id: "msg-1" } } }));

  await processarMensagemRecebida({
    telefone: "5511988887777",
    texto: "quero saber sobre horários de fisioterapia",
    nomeContato: "Paciente Teste",
  });
  await t.mock.timers.tick(70_000);

  assert.equal(createMock.mock.calls.length, 0);
  assert.equal(postMock.mock.calls.length, 0);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0][1], "quero saber sobre horários de fisioterapia");
});

test("dentro do expediente, a IA responde normalmente", async (t) => {
  mockarBanco(t);
  t.mock.method(expediente, "estaAberto", () => true);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const createMock = t.mock.method(openai.chat.completions, "create", async () => ({
    choices: [{ message: { content: "Claro, posso te ajudar com isso!", tool_calls: undefined } }],
  }));

  await processarMensagemRecebida({
    telefone: "5511988887777",
    texto: "quero saber sobre horários de fisioterapia",
    nomeContato: "Paciente Teste",
  });

  assert.equal(createMock.mock.calls.length, 1);
});
