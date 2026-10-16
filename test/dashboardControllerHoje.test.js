import { test } from "node:test";
import assert from "node:assert/strict";
import { telaHoje } from "../src/controllers/dashboardController.js";

test("telaHoje renderiza os atendimentos e o resumo operacional", async () => {
  const res = { render(view, dados) { this.view = view; this.dados = dados; } };
  await telaHoje({}, res, { listarHoje: async () => [
    { status: "confirmado", presenca: null },
    { status: "compareceu", presenca: "compareceu" },
    { status: "faltou", presenca: "faltou" },
  ] });
  assert.equal(res.view, "hoje/lista");
  assert.deepEqual(res.dados.resumo, { total: 3, confirmados: 1, compareceram: 1, faltaram: 1 });
});

test("telaHoje busca as páginas seguintes e mantém todos os atendimentos do dia", async () => {
  const paginas = [];
  const res = { render(view, dados) { this.dados = dados; } };
  await telaHoje({}, res, { listarHoje: async (filtros) => {
    paginas.push(filtros);
    return Array.from({ length: filtros.offset === 0 ? 200 : 1 }, () => ({ status: "confirmado" }));
  } });
  assert.equal(res.dados.resumo.total, 201);
  assert.equal(paginas[1].offset, 200);
  assert.equal(paginas[0].data, paginas[1].data);
});

test("telaHoje mostra a mensagem do lote de presença (?presenca_msg=), vinda do redirect de /agendamentos/presenca-lote", async () => {
  const res = { render(view, dados) { this.dados = dados; } };
  await telaHoje(
    { query: { presenca_msg: "2 presenças registradas." } },
    res,
    { listarHoje: async () => [] }
  );
  assert.equal(res.dados.mensagem, "2 presenças registradas.");
});

test("telaHoje: ?sucesso=1 (forms individuais de presença/pagamento) tem prioridade sobre presenca_msg ausente", async () => {
  const res = { render(view, dados) { this.dados = dados; } };
  await telaHoje({ query: { sucesso: "1" } }, res, { listarHoje: async () => [] });
  assert.equal(res.dados.mensagem, "Alteração salva.");
});
