import { test } from "node:test";
import assert from "node:assert/strict";
import { processarCancelarAgendamento } from "../src/controllers/dashboardController.js";

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

function criarRequisicao(params) {
  return { params, body: {} };
}

test("processarCancelarAgendamento: id não numérico responde 404 sem consultar nada", async () => {
  let consultou = false;
  const res = criarRespostaFalsa();

  await processarCancelarAgendamento(criarRequisicao({ id: "abc" }), res, {
    buscarAgendamentoBot: async () => ((consultou = true), null),
  });

  assert.equal(res.statusCode, 404);
  assert.equal(consultou, false);
});

test("processarCancelarAgendamento: agendamento inexistente responde 404", async () => {
  const res = criarRespostaFalsa();

  await processarCancelarAgendamento(criarRequisicao({ id: "5" }), res, {
    buscarAgendamentoBot: async () => null,
  });

  assert.equal(res.statusCode, 404);
});

test("processarCancelarAgendamento: corrida (0 linhas afetadas) responde 409", async () => {
  const res = criarRespostaFalsa();

  await processarCancelarAgendamento(criarRequisicao({ id: "5" }), res, {
    buscarAgendamentoBot: async () => ({ id: 5 }),
    cancelarNoBancoBot: async () => null,
  });

  assert.equal(res.statusCode, 409);
});

test("processarCancelarAgendamento: caminho feliz cancela no banco e redireciona", async () => {
  const chamadas = [];
  const res = criarRespostaFalsa();

  await processarCancelarAgendamento(criarRequisicao({ id: "5" }), res, {
    buscarAgendamentoBot: async () => ({ id: 5 }),
    cancelarNoBancoBot: async (id) => (chamadas.push(["cancelarNoBanco", id]), { id: 5, status: "cancelado" }),
  });

  assert.deepEqual(chamadas, [["cancelarNoBanco", 5]]);
  assert.equal(res.redirectedTo, "/agendamentos");
});

test("processarCancelarAgendamento: agendamento que já passou responde 404", async () => {
  const res = criarRespostaFalsa();

  await processarCancelarAgendamento(criarRequisicao({ id: "5" }), res, {
    buscarAgendamentoBot: async () => ({ id: 5, ja_passou: true }),
  });

  assert.equal(res.statusCode, 404);
});

test("processarCancelarAgendamento: origem importado cancela no banco e redireciona", async () => {
  const res = criarRespostaFalsa();

  await processarCancelarAgendamento({ params: { origem: "importado", id: "9" }, body: {} }, res, {
    buscarAgendamentoImportado: async () => ({ id: 9, ja_passou: false }),
    cancelarNoBancoImportado: async () => ({ id: 9, status: "cancelado" }),
  });

  assert.equal(res.redirectedTo, "/agendamentos");
});

test("processarCancelarAgendamento: origem importado, corrida (0 linhas) responde 409", async () => {
  const res = criarRespostaFalsa();

  await processarCancelarAgendamento({ params: { origem: "importado", id: "9" }, body: {} }, res, {
    buscarAgendamentoImportado: async () => ({ id: 9, ja_passou: false }),
    cancelarNoBancoImportado: async () => null,
  });

  assert.equal(res.statusCode, 409);
});

test("processarCancelarAgendamento: origem importado inexistente responde 404", async () => {
  const res = criarRespostaFalsa();

  await processarCancelarAgendamento({ params: { origem: "importado", id: "9" }, body: {} }, res, {
    buscarAgendamentoImportado: async () => null,
  });

  assert.equal(res.statusCode, 404);
});

// Finding 7 do review final: um valor de :origem que não seja exatamente
// "bot" ou "importado" (typo, caixa errada, etc.) tinha que 404, não cair
// silenciosamente no branch do bot e arriscar mexer na tabela errada.
test("processarCancelarAgendamento: origem não reconhecida responde 404 sem consultar nada", async () => {
  let consultou = false;
  const res = criarRespostaFalsa();

  await processarCancelarAgendamento({ params: { origem: "importados", id: "9" }, body: {} }, res, {
    buscarAgendamentoBot: async () => ((consultou = true), null),
    buscarAgendamentoImportado: async () => ((consultou = true), null),
  });

  assert.equal(res.statusCode, 404);
  assert.equal(consultou, false);
});
