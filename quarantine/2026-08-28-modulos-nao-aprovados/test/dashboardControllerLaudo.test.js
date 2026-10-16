// test/dashboardControllerLaudo.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { gerarLaudoBot, gerarLaudoImportado } from "../src/controllers/dashboardController.js";

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

test("gerarLaudoBot: id não numérico responde 404 sem consultar o banco", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await gerarLaudoBot(criarRequisicao({ params: { id: "abc" } }), res);

  assert.equal(res.statusCode, 404);
  assert.equal(consultas.length, 0);
});
test("gerarLaudoBot: agendamento inexistente responde 404", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const res = criarRespostaFalsa();

  await gerarLaudoBot(criarRequisicao({ params: { id: "999" } }), res);

  assert.equal(res.statusCode, 404);
});

test("gerarLaudoBot: sem observacao_sessao responde 400", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        paciente_nome: "Maria",
        data: "2026-08-20",
        observacao_sessao: null,
        profissional_responsavel: null,
      },
    ],
  }));
  const res = criarRespostaFalsa();

  await gerarLaudoBot(criarRequisicao({ params: { id: "5" } }), res);

  assert.equal(res.statusCode, 400);
});

test("gerarLaudoBot: caminho feliz responde com o PDF e os headers corretos", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        paciente_nome: "Maria",
        data: "2026-08-20",
        observacao_sessao: "Evoluiu bem",
        profissional_responsavel: "Dra. Ana",
      },
    ],
  }));
  const res = criarRespostaFalsa();

  await gerarLaudoBot(criarRequisicao({ params: { id: "5" } }), res);

  assert.equal(res.headers["Content-Type"], "application/pdf");
  assert.match(
    res.headers["Content-Disposition"],
    /^attachment; filename="laudo-maria-2026-08-20\.pdf"$/
  );
  assert.ok(Buffer.isBuffer(res.corpo));
  assert.equal(res.corpo.subarray(0, 4).toString("latin1"), "%PDF");
});

test("gerarLaudoImportado: id não numérico responde 404 sem consultar o banco", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await gerarLaudoImportado(criarRequisicao({ params: { id: "abc" } }), res);

  assert.equal(res.statusCode, 404);
  assert.equal(consultas.length, 0);
});

test("gerarLaudoImportado: agendamento importado inexistente responde 404", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const res = criarRespostaFalsa();

  await gerarLaudoImportado(criarRequisicao({ params: { id: "999" } }), res);

  assert.equal(res.statusCode, 404);
});

test("gerarLaudoImportado: sem observacao_sessao responde 400", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        paciente_nome: "João",
        data: "2026-08-20",
        atendente: null,
        observacao_sessao: "",
        profissional_responsavel: null,
      },
    ],
  }));
  const res = criarRespostaFalsa();

  await gerarLaudoImportado(criarRequisicao({ params: { id: "8" } }), res);

  assert.equal(res.statusCode, 400);
});

test("gerarLaudoImportado: caminho feliz usa atendente como fallback no nome do arquivo/PDF", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        paciente_nome: "João da Silva",
        data: "2026-08-20",
        atendente: "Carlos",
        observacao_sessao: "Sessão concluída",
        profissional_responsavel: null,
      },
    ],
  }));
  const res = criarRespostaFalsa();

  await gerarLaudoImportado(criarRequisicao({ params: { id: "8" } }), res);

  assert.equal(res.headers["Content-Type"], "application/pdf");
  assert.match(
    res.headers["Content-Disposition"],
    /^attachment; filename="laudo-joao-da-silva-2026-08-20\.pdf"$/
  );
  assert.ok(Buffer.isBuffer(res.corpo));
});
