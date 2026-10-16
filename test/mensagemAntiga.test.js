import { test } from "node:test";
import assert from "node:assert/strict";
import { ehMensagemAntiga } from "../src/utils/mensagemAntiga.js";

const agora = new Date("2026-09-30T08:00:00-03:00").getTime();
const segundos = (d) => Math.floor(d / 1000);

test("mensagem de agora não é antiga", () => {
  assert.equal(ehMensagemAntiga(segundos(agora), agora), false);
});

test("mensagem de 9 minutos atrás não é antiga", () => {
  assert.equal(ehMensagemAntiga(segundos(agora - 9 * 60_000), agora), false);
});

test("mensagem da noite anterior (entregue quando o PC ligou) é antiga", () => {
  const ontemNoite = new Date("2026-09-29T22:30:00-03:00").getTime();
  assert.equal(ehMensagemAntiga(segundos(ontemNoite), agora), true);
});

test("aceita timestamp como string (formato da Evolution API)", () => {
  assert.equal(ehMensagemAntiga(String(segundos(agora - 60 * 60_000)), agora), true);
});

test("sem timestamp não descarta a mensagem", () => {
  assert.equal(ehMensagemAntiga(undefined, agora), false);
  assert.equal(ehMensagemAntiga(null, agora), false);
  assert.equal(ehMensagemAntiga("abc", agora), false);
});
