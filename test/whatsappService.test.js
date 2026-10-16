import "./setupEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { evolutionApi } from "../src/config/evolutionApi.js";
import { enviarMensagem } from "../src/services/whatsappService.js";

test("enviarMensagem mostra 'digitando...' (presence composing) por um instante antes de mandar o texto", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const chamadas = [];
  t.mock.method(evolutionApi, "post", async (url, body) => {
    chamadas.push({ url, body });
    if (url.includes("/chat/whatsappNumbers/")) {
      return { data: [{ exists: true, jid: "5511988887777@s.whatsapp.net" }] };
    }
    return { data: { key: { id: "msg-1" } } };
  });

  const promessa = enviarMensagem("5511988887777", "Olá!");

  // Deixa as microtasks até a checagem de JID e a primeira chamada
  // (presence) resolverem, sem avançar o relógio — o texto não pode ter
  // sido enviado ainda.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(chamadas.length, 2, "deveria ter resolvido o JID e mandado a presence 'composing' até aqui");
  assert.match(chamadas[0].url, /\/chat\/whatsappNumbers\//);
  assert.deepEqual(chamadas[0].body.numbers, ["5511988887777"]);
  assert.match(chamadas[1].url, /\/chat\/sendPresence\//);
  assert.equal(chamadas[1].body.number, "5511988887777@s.whatsapp.net");
  assert.equal(chamadas[1].body.presence, "composing");
  assert.equal(
    chamadas[1].body.delay,
    2000,
    "a Evolution API exige 'delay' no payload do sendPresence (número, presence e delay são obrigatórios no schema dela) — sem isso ela responde 400"
  );

  await t.mock.timers.tick(2000);
  await promessa;

  assert.equal(chamadas.length, 3, "depois do atraso de 'digitando', o texto precisa ter sido enviado");
  assert.match(chamadas[2].url, /\/message\/sendText\//);
  assert.equal(chamadas[2].body.number, "5511988887777@s.whatsapp.net");
  assert.equal(chamadas[2].body.text, "Olá!");
});

test("enviarMensagem cai de volta pro número normalizado se a checagem de JID falhar", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const chamadas = [];
  t.mock.method(evolutionApi, "post", async (url, body) => {
    if (url.includes("/chat/whatsappNumbers/")) {
      throw new Error("Evolution API indisponível");
    }
    chamadas.push({ url, body });
    return { data: { key: { id: "msg-2" } } };
  });

  const promessa = enviarMensagem("5511988887777", "Olá!");
  // A checagem de JID (que falha) resolve antes do setTimeout do "digitando"
  // ser sequer registrado — dá espaço pras microtasks andarem antes de
  // avançar o relógio.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await t.mock.timers.tick(2000);
  await promessa;

  assert.equal(chamadas.length, 2);
  assert.equal(chamadas[0].body.number, "5511988887777");
  assert.equal(chamadas[1].body.number, "5511988887777");
});

test("enviarMensagem recusa o envio se o JID resolvido apontar pro próprio número conectado ao bot", async (t) => {
  const chamadas = [];
  t.mock.method(evolutionApi, "post", async (url, body) => {
    chamadas.push({ url, body });
    if (url.includes("/chat/whatsappNumbers/")) {
      // Simula o bug: a Evolution API resolve o destino pro próprio número
      // conectado ao bot (ex: mismatch de @lid) em vez do número pedido.
      return { data: [{ exists: true, jid: "5511999990100@s.whatsapp.net", number: "5511999990100" }] };
    }
    return { data: { key: { id: "msg-3" } } };
  });

  await assert.rejects(
    () => enviarMensagem("5511999990005", "Aviso pra recepção"),
    /próprio número conectado ao bot/
  );

  // Só a checagem de JID deve ter saído — nada de presence/texto.
  assert.equal(chamadas.length, 1);
});

test("enviarMensagem recusa o envio direto se o número pedido já for o do próprio bot (sem depender da checagem de JID)", async (t) => {
  const chamadas = [];
  t.mock.method(evolutionApi, "post", async (url, body) => {
    chamadas.push({ url, body });
    if (url.includes("/chat/whatsappNumbers/")) {
      return { data: [{ exists: true, jid: "5511999990100@s.whatsapp.net", number: "5511999990100" }] };
    }
    return { data: { key: { id: "msg-4" } } };
  });

  await assert.rejects(() => enviarMensagem("5511999990100", "Teste"), /próprio número conectado ao bot/);
  assert.equal(chamadas.length, 1);
});
