import "./setupEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { extrairExtensao } from "../src/services/transcricaoService.js";

test("extrairExtensao mapeia mimetype de áudio de voz do WhatsApp (ogg/opus)", () => {
  assert.equal(extrairExtensao("audio/ogg; codecs=opus"), "ogg");
});

test("extrairExtensao mapeia mimetype sem parâmetros extras", () => {
  assert.equal(extrairExtensao("audio/mpeg"), "mp3");
});

test("extrairExtensao cai para ogg em mimetype desconhecido ou ausente", () => {
  assert.equal(extrairExtensao("audio/x-desconhecido"), "ogg");
  assert.equal(extrairExtensao(undefined), "ogg");
});
