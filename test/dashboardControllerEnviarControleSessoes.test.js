import { test } from "node:test";
import assert from "node:assert/strict";
import { processarEnviarControleSessoes } from "../src/controllers/dashboardController.js";

function criarRespostaFalsa() {
  return {
    statusCode: 200,
    corpo: null,
    redirectedTo: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(corpo) {
      this.corpo = corpo;
      return this;
    },
    redirect(url) {
      this.redirectedTo = url;
    },
  };
}

const PACIENTE = { id: 7, nome: "Ana Silva", telefone: "5511999990000" };

test("processarEnviarControleSessoes: id inválido responde 404 sem consultar nada", async () => {
  let consultou = false;
  const res = criarRespostaFalsa();

  await processarEnviarControleSessoes({ params: { id: "abc" } }, res, {
    buscarPaciente: async () => ((consultou = true), PACIENTE),
  });

  assert.equal(res.statusCode, 404);
  assert.equal(consultou, false);
});

test("processarEnviarControleSessoes: paciente inexistente responde 404", async () => {
  const res = criarRespostaFalsa();

  await processarEnviarControleSessoes({ params: { id: "7" } }, res, {
    buscarPaciente: async () => null,
  });

  assert.equal(res.statusCode, 404);
});

test("processarEnviarControleSessoes: caminho feliz monta a mensagem, envia como texto por WhatsApp e redireciona", async () => {
  const res = criarRespostaFalsa();
  let telefoneRecebido = null;
  let mensagemRecebida = null;

  await processarEnviarControleSessoes({ params: { id: "7" } }, res, {
    buscarPaciente: async () => PACIENTE,
    buscarSessoes: async () => [{ data: "2026-08-30", hora: "09:00", status: "compareceu" }],
    buscarAvaliacoes: async () => [{ id: 1, dataAvaliacao: "2026-08-01" }],
    enviarMensagemFn: async (telefone, mensagem) => {
      telefoneRecebido = telefone;
      mensagemRecebida = mensagem;
    },
  });

  assert.equal(telefoneRecebido, "5511999990000");
  assert.match(mensagemRecebida, /Ana Silva/);
  assert.match(mensagemRecebida, /30\/08\/2026 09:00 — compareceu/);
  assert.match(res.redirectedTo, /^\/pacientes\/7\/controle-sessoes\?/);
});

test("processarEnviarControleSessoes: falha ao enviar (Evolution API fora do ar) responde 500", async () => {
  const res = criarRespostaFalsa();

  await processarEnviarControleSessoes({ params: { id: "7" } }, res, {
    buscarPaciente: async () => PACIENTE,
    buscarSessoes: async () => [],
    buscarAvaliacoes: async () => [],
    enviarMensagemFn: async () => {
      throw new Error("Evolution API indisponível");
    },
  });

  assert.equal(res.statusCode, 500);
});
