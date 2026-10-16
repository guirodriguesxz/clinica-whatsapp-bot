// test/dashboardControllerGuiaConvenio.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { gerarGuiaConvenio } from "../src/controllers/dashboardController.js";

function criarRespostaFalsa() {
  return {
    statusCode: 200,
    corpo: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(nome, valor) {
      this.headers[nome] = valor;
      return this;
    },
    send(corpo) {
      this.corpo = corpo;
      return this;
    },
  };
}

function criarRequisicao({ params = {} } = {}) {
  return { params };
}

test("gerarGuiaConvenio: id não numérico responde 404 sem consultar o banco", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await gerarGuiaConvenio(criarRequisicao({ params: { id: "abc" } }), res);

  assert.equal(res.statusCode, 404);
  assert.equal(consultas.length, 0);
});

test("gerarGuiaConvenio: pagamento inexistente responde 404", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const res = criarRespostaFalsa();

  await gerarGuiaConvenio(criarRequisicao({ params: { id: "999" } }), res);

  assert.equal(res.statusCode, 404);
});

test("gerarGuiaConvenio: linha de estorno responde 404", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        id: 42,
        valor: "150.00",
        tipo_lancamento: "estorno",
        paciente_nome: "Maria",
        convenio: "Vale Saúde",
        matricula_convenio: null,
        tipo_atendimento: "fisioterapia",
        data_atendimento: "2026-08-20",
        profissional_responsavel: null,
        estornado_por: null,
      },
    ],
  }));
  const res = criarRespostaFalsa();

  await gerarGuiaConvenio(criarRequisicao({ params: { id: "42" } }), res);

  assert.equal(res.statusCode, 404);
});

test("gerarGuiaConvenio: caminho feliz responde com o PDF e os headers corretos", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        id: 7,
        valor: "300.00",
        tipo_lancamento: "pagamento",
        paciente_nome: "Maria",
        convenio: "Vale Saúde",
        matricula_convenio: "12345",
        tipo_atendimento: "fisioterapia",
        data_atendimento: "2026-08-20",
        profissional_responsavel: "Dra. Ana",
        estornado_por: null,
      },
    ],
  }));
  const res = criarRespostaFalsa();

  await gerarGuiaConvenio(criarRequisicao({ params: { id: "7" } }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Content-Type"], "application/pdf");
  assert.match(res.headers["Content-Disposition"], /^attachment; filename="guia-maria-2026-08-20\.pdf"$/);
  assert.ok(Buffer.isBuffer(res.corpo));
  assert.equal(res.corpo.subarray(0, 4).toString("latin1"), "%PDF");
});
