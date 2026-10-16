import "./setupEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { openai } from "../src/config/openai.js";
import { processarMensagemRecebida } from "../src/services/chatService.js";

test("contato novo que só cumprimentou tem a saudação registrada uma vez só", async (t) => {
  const inserts = [];
  t.mock.method(pool, "query", async (sql, params) => {
    if (sql.includes("FROM pacientes")) return { rows: [{ id: 7, nome: null, telefone: "5511977776666", etapa_atual: null }] };
    if (sql.includes("INSERT INTO conversas")) inserts.push(params);
    return { rows: [] };
  });
  const createMock = t.mock.method(openai.chat.completions, "create", async () => {
    throw new Error("não devia chamar a IA");
  });

  await processarMensagemRecebida({ telefone: "5511977776666", texto: "Bom dia", nomeContato: "Novo" });

  assert.equal(inserts.length, 1);
  assert.equal(createMock.mock.calls.length, 0);
});
