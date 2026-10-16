import { test } from "node:test";
import assert from "node:assert/strict";
import {
  registrarEnvioIminente,
  registrarMensagemEnviada,
  foiEnviadaPeloBot,
} from "../src/utils/mensagensDoBot.js";

test("foiEnviadaPeloBot retorna true pra um ID registrado via registrarMensagemEnviada", () => {
  registrarMensagemEnviada("MSG1");
  assert.equal(foiEnviadaPeloBot("MSG1", "5511988887777"), true);
});

test("foiEnviadaPeloBot retorna false pra um ID e telefone nunca registrados (mensagem manual de um humano)", () => {
  assert.equal(foiEnviadaPeloBot("NUNCA_ENVIADO", "5511900000000"), false);
});

test("foiEnviadaPeloBot continua true numa segunda checagem do mesmo ID — reentrega de webhook não deve pausar", () => {
  registrarMensagemEnviada("MSG2");
  assert.equal(foiEnviadaPeloBot("MSG2", "5511988887777"), true);
  assert.equal(foiEnviadaPeloBot("MSG2", "5511988887777"), true);
});

test("foiEnviadaPeloBot cai pro telefone quando o ID ainda não chegou (corrida: eco antes da resposta do envio)", () => {
  registrarEnvioIminente("5511977776666");
  assert.equal(foiEnviadaPeloBot("ID_AINDA_NAO_REGISTRADO", "5511977776666"), true);
});

test("registrarEnvioIminente e foiEnviadaPeloBot ignoram telefone/ID vazio ou nulo sem lançar exceção", () => {
  assert.doesNotThrow(() => registrarEnvioIminente(undefined));
  assert.doesNotThrow(() => registrarMensagemEnviada(null));
  assert.equal(foiEnviadaPeloBot(null, null), false);
});
