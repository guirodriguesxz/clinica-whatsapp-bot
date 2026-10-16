import "./setupEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ehMensagemAutomaticaWhatsappBusiness } from "../src/controllers/webhookController.js";

const SAUDACAO =
  "Seja muito bem-vindo(a) à Clínica Exemplo!\n\nÉ um prazer ter você com a gente. Somos uma clínica especializada em Fisioterapia & Psicologia.\n\nComo podemos ajudar?";
const AUSENCIA =
  "Olá! 👋\n\nObrigado pelo seu contato.\n\nNo momento estamos fora do nosso horário de atendimento, que é de segunda a sexta-feira, das 07h00 às 19h30.";

test("reconhece a saudação e a mensagem de ausência automáticas do WhatsApp Business", () => {
  assert.equal(ehMensagemAutomaticaWhatsappBusiness(SAUDACAO), true);
  assert.equal(ehMensagemAutomaticaWhatsappBusiness(AUSENCIA), true);
});

test("mensagem manual da equipe não é tratada como automática", () => {
  assert.equal(ehMensagemAutomaticaWhatsappBusiness("Oi Pedro, bom dia. Pode vir, você está agendado às 10h30!"), false);
  assert.equal(ehMensagemAutomaticaWhatsappBusiness("Seja muito bem-vindo(a) à Clínica Exemplo! Qual o seu convênio?"), false);
  assert.equal(ehMensagemAutomaticaWhatsappBusiness(null), false);
});

test("webhook: saudação automática saindo do número da clínica não pausa o bot nem grava como equipe", async (t) => {
  const { pool } = await import("../src/db/pool.js");
  const { receberWebhook } = await import("../src/controllers/webhookController.js");
  const queries = [];
  t.mock.method(pool, "query", async (sql) => {
    queries.push(sql);
    return { rows: [{ id: 1, etapa_atual: null }] };
  });

  await receberWebhook(
    {
      body: {
        event: "messages.upsert",
        data: {
          key: { remoteJid: "5511988887777@s.whatsapp.net", fromMe: true, id: "auto-1" },
          message: { conversation: SAUDACAO },
        },
      },
    },
    { sendStatus() {} }
  );
  await new Promise((r) => setTimeout(r, 0));

  assert.ok(!queries.some((sql) => /UPDATE pacientes|INSERT INTO conversas/.test(sql)));
});

test("webhook: mensagem manual da equipe pausa o bot DENTRO do lock do telefone (caso paciente 310, 2026-10-07)", async (t) => {
  const { pool } = await import("../src/db/pool.js");
  const { receberWebhook } = await import("../src/controllers/webhookController.js");
  const ordem = [];
  const client = {
    query: async (sql) => {
      if (/pg_advisory_xact_lock/.test(sql)) ordem.push("LOCK");
      if (/^COMMIT/.test(sql)) ordem.push("COMMIT");
      return { rows: [] };
    },
    release: () => {},
  };
  t.mock.method(pool, "connect", async () => client);
  t.mock.method(pool, "query", async (sql) => {
    if (/UPDATE pacientes SET etapa_atual/.test(sql)) ordem.push("PAUSA");
    return { rows: [{ id: 1, nome: "Alexandre", etapa_atual: null, wa_message_id: "m1" }] };
  });

  await receberWebhook(
    {
      body: {
        event: "messages.upsert",
        data: {
          key: { remoteJid: "5511977776666@s.whatsapp.net", fromMe: true, id: "manual-310" },
          message: { conversation: "Olá, boa tarde. Desculpa, mas não ouvimos áudios." },
        },
      },
    },
    { sendStatus() {} }
  );
  await new Promise((r) => setTimeout(r, 20));

  assert.deepEqual(ordem.filter((x) => x === "LOCK" || x === "PAUSA" || x === "COMMIT").slice(0, 3), ["LOCK", "PAUSA", "COMMIT"]);
});
