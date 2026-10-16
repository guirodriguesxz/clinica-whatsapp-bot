import { test } from "node:test";
import assert from "node:assert/strict";
import { processarEnviarConfirmacao } from "../src/controllers/dashboardController.js";

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

function criarRequisicao(params, body = {}) {
  return { params, body };
}

const AGENDAMENTO_CONFIRMADO = {
  id: 5,
  status: "confirmado",
  ja_passou: false,
  paciente_nome: "Ana",
  paciente_telefone: "5511999990000",
  tipo_atendimento: "fisioterapia",
  data: "2026-09-10",
  hora: "08:00:00",
};

test("processarEnviarConfirmacao: id não numérico responde 404 sem consultar nada", async () => {
  let consultou = false;
  const res = criarRespostaFalsa();

  await processarEnviarConfirmacao(criarRequisicao({ id: "abc" }), res, {
    buscarAgendamentoBot: async () => ((consultou = true), null),
  });

  assert.equal(res.statusCode, 404);
  assert.equal(consultou, false);
});

test("processarEnviarConfirmacao: origem inválida responde 404", async () => {
  const res = criarRespostaFalsa();

  await processarEnviarConfirmacao(criarRequisicao({ origem: "outra", id: "5" }), res);

  assert.equal(res.statusCode, 404);
});

test("processarEnviarConfirmacao: agendamento inexistente responde 404", async () => {
  const res = criarRespostaFalsa();

  await processarEnviarConfirmacao(criarRequisicao({ id: "5" }), res, {
    buscarAgendamentoBot: async () => null,
  });

  assert.equal(res.statusCode, 404);
});

test("processarEnviarConfirmacao: agendamento cancelado responde 400 sem enviar mensagem", async () => {
  const res = criarRespostaFalsa();
  let enviou = false;

  await processarEnviarConfirmacao(criarRequisicao({ id: "5" }), res, {
    buscarAgendamentoBot: async () => ({ ...AGENDAMENTO_CONFIRMADO, status: "cancelado" }),
    enviarMensagemFn: async () => {
      enviou = true;
    },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(enviou, false);
});

test("processarEnviarConfirmacao: agendamento já passado responde 400 sem enviar mensagem", async () => {
  const res = criarRespostaFalsa();
  let enviou = false;

  await processarEnviarConfirmacao(criarRequisicao({ id: "5" }), res, {
    buscarAgendamentoBot: async () => ({ ...AGENDAMENTO_CONFIRMADO, ja_passou: true }),
    enviarMensagemFn: async () => {
      enviou = true;
    },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(enviou, false);
});

test("processarEnviarConfirmacao: caminho feliz envia a mensagem certa e redireciona", async () => {
  const res = criarRespostaFalsa();
  let telefoneRecebido = null;
  let mensagemRecebida = null;

  await processarEnviarConfirmacao(criarRequisicao({ id: "5" }), res, {
    buscarAgendamentoBot: async () => AGENDAMENTO_CONFIRMADO,
    enviarMensagemFn: async (telefone, mensagem) => {
      telefoneRecebido = telefone;
      mensagemRecebida = mensagem;
    },
  });

  assert.equal(telefoneRecebido, "5511999990000");
  assert.match(mensagemRecebida, /Ana/);
  assert.match(mensagemRecebida, /10\/09\/2026/);
  assert.match(res.redirectedTo, /^\/agendamentos\?/);
});

test("processarEnviarConfirmacao: falha ao enviar (Evolution API fora do ar) responde 500", async () => {
  const res = criarRespostaFalsa();

  await processarEnviarConfirmacao(criarRequisicao({ id: "5" }), res, {
    buscarAgendamentoBot: async () => AGENDAMENTO_CONFIRMADO,
    enviarMensagemFn: async () => {
      throw new Error("Evolution API indisponível");
    },
  });

  assert.equal(res.statusCode, 500);
});

test("processarEnviarConfirmacao: origem importado busca no model certo", async () => {
  const res = criarRespostaFalsa();
  let buscouImportado = false;

  await processarEnviarConfirmacao(criarRequisicao({ origem: "importado", id: "5" }), res, {
    buscarAgendamentoImportado: async () => ((buscouImportado = true), AGENDAMENTO_CONFIRMADO),
    enviarMensagemFn: async () => {},
  });

  assert.equal(buscouImportado, true);
  assert.equal(res.redirectedTo, "/agendamentos?whatsapp=enviado");
});

test("processarEnviarConfirmacao: retorno=proximos volta pra /agendamentos/proximos", async () => {
  const res = criarRespostaFalsa();

  await processarEnviarConfirmacao(
    criarRequisicao({ origem: "bot", id: "5" }, { retorno: "proximos" }),
    res,
    {
      buscarAgendamentoBot: async () => AGENDAMENTO_CONFIRMADO,
      enviarMensagemFn: async () => {},
    }
  );

  assert.equal(res.redirectedTo, "/agendamentos/proximos?whatsapp=enviado");
});

test("processarEnviarConfirmacao: retorno=hoje continua voltando pra /hoje", async () => {
  const res = criarRespostaFalsa();

  await processarEnviarConfirmacao(
    criarRequisicao({ origem: "bot", id: "5" }, { retorno: "hoje" }),
    res,
    {
      buscarAgendamentoBot: async () => AGENDAMENTO_CONFIRMADO,
      enviarMensagemFn: async () => {},
    }
  );

  assert.equal(res.redirectedTo, "/hoje?sucesso=1");
});
