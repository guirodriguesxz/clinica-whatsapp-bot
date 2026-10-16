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

const LINHA_CONVENIO = {
  id: 10,
  valor: "150.00",
  status: "pago",
  data: "2026-08-20",
  forma_pagamento: "convenio",
  paciente_nome: "Maria",
  convenio: "Vale Saúde",
  numero_carteirinha: "123456",
  tipo_atendimento: "fisioterapia",
  profissional_responsavel: "Dra. Ana",
};

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

test("gerarGuiaConvenio: pagamento pix responde 400 (guia só pra convênio)", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ ...LINHA_CONVENIO, forma_pagamento: "pix" }],
  }));
  const res = criarRespostaFalsa();

  await gerarGuiaConvenio(criarRequisicao({ params: { id: "10" } }), res);

  assert.equal(res.statusCode, 400);
});

test("gerarGuiaConvenio: pagamento cartão responde 400 (guia só pra convênio)", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ ...LINHA_CONVENIO, forma_pagamento: "cartao" }],
  }));
  const res = criarRespostaFalsa();

  await gerarGuiaConvenio(criarRequisicao({ params: { id: "10" } }), res);

  assert.equal(res.statusCode, 400);
});

test("gerarGuiaConvenio: caminho feliz responde com o PDF e os headers corretos", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [LINHA_CONVENIO] }));
  const res = criarRespostaFalsa();

  await gerarGuiaConvenio(criarRequisicao({ params: { id: "10" } }), res);

  assert.equal(res.headers["Content-Type"], "application/pdf");
  assert.match(
    res.headers["Content-Disposition"],
    /^attachment; filename="guia-maria-2026-08-20\.pdf"$/
  );
  assert.ok(Buffer.isBuffer(res.corpo));
  assert.equal(res.corpo.subarray(0, 4).toString("latin1"), "%PDF");
});

test("gerarGuiaConvenio: pagamento de convênio estornado também gera o PDF (carimbo de cancelada)", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ ...LINHA_CONVENIO, status: "estornado" }],
  }));
  const res = criarRespostaFalsa();

  await gerarGuiaConvenio(criarRequisicao({ params: { id: "10" } }), res);

  assert.equal(res.headers["Content-Type"], "application/pdf");
  assert.ok(Buffer.isBuffer(res.corpo));
});
