// test/dashboardControllerEstoque.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import {
  telaFornecedores,
  processarNovoFornecedor,
  telaCentrosCusto,
  processarNovoCentroCusto,
  telaEstoque,
  processarNovoMaterial,
} from "../src/controllers/dashboardController.js";

function criarRespostaFalsa() {
  return {
    statusCode: 200,
    corpo: null,
    viewRenderizada: null,
    dadosDaView: null,
    redirectedTo: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(corpo) {
      this.corpo = corpo;
      return this;
    },
    render(view, dados) {
      this.viewRenderizada = view;
      this.dadosDaView = dados;
      return this;
    },
    redirect(url) {
      this.redirectedTo = url;
    },
  };
}

function criarRequisicao({ body = {} } = {}) {
  return { body };
}

test("processarNovoFornecedor: nome ausente responde 400 sem consultar o banco", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await processarNovoFornecedor(criarRequisicao({ body: { nome: "  " } }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(consultas.length, 0);
});
test("processarNovoFornecedor: caminho feliz redireciona pra /fornecedores", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ id: 1 }] }));
  const res = criarRespostaFalsa();

  await processarNovoFornecedor(criarRequisicao({ body: { nome: "Fornecedor A" } }), res);

  assert.equal(res.redirectedTo, "/fornecedores");
});

test("telaFornecedores: renderiza fornecedores/lista com os fornecedores", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ id: 1, nome: "Fornecedor A" }] }));
  const res = criarRespostaFalsa();

  await telaFornecedores({}, res);

  assert.equal(res.viewRenderizada, "fornecedores/lista");
  assert.deepEqual(res.dadosDaView.fornecedores, [{ id: 1, nome: "Fornecedor A" }]);
});

test("telaCentrosCusto: renderiza centrosCusto/lista com os centros de custo", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ id: 1, nome: "Fisioterapia" }] }));
  const res = criarRespostaFalsa();

  await telaCentrosCusto({}, res);

  assert.equal(res.viewRenderizada, "centrosCusto/lista");
  assert.deepEqual(res.dadosDaView.centrosCusto, [{ id: 1, nome: "Fisioterapia" }]);
});

test("processarNovoCentroCusto: nome ausente responde 400", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const res = criarRespostaFalsa();

  await processarNovoCentroCusto(criarRequisicao({ body: {} }), res);

  assert.equal(res.statusCode, 400);
});

test("processarNovoCentroCusto: caminho feliz redireciona pra /centros-custo", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ id: 1 }] }));
  const res = criarRespostaFalsa();

  await processarNovoCentroCusto(criarRequisicao({ body: { nome: "Fisioterapia" } }), res);

  assert.equal(res.redirectedTo, "/centros-custo");
});

test("telaEstoque: renderiza estoque/lista com materiais/fornecedores/centrosCusto", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("FROM materiais")) return { rows: [{ id: 1, nome: "Eletrodo" }] };
    if (sql.includes("FROM fornecedores")) return { rows: [{ id: 1, nome: "Fornecedor A" }] };
    return { rows: [{ id: 1, nome: "Fisioterapia" }] };
  });
  const res = criarRespostaFalsa();

  await telaEstoque({}, res);

  assert.equal(res.viewRenderizada, "estoque/lista");
  assert.equal(res.dadosDaView.materiais[0].nome, "Eletrodo");
});

test("processarNovoMaterial: nome ausente responde 400", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const res = criarRespostaFalsa();

  await processarNovoMaterial(criarRequisicao({ body: {} }), res);

  assert.equal(res.statusCode, 400);
});

test("processarNovoMaterial: quantidade ausente vira 0, estoque_minimo/fornecedor/centro ausentes viram null", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [{ id: 1 }] };
  });
  const res = criarRespostaFalsa();

  await processarNovoMaterial(criarRequisicao({ body: { nome: "Eletrodo" } }), res);

  assert.equal(res.redirectedTo, "/estoque");
  assert.deepEqual(chamadas[0].params, ["Eletrodo", null, null, 0, null, null, null]);
});

test("processarNovoMaterial: quantidade_em_estoque negativa responde 400", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await processarNovoMaterial(
    criarRequisicao({ body: { nome: "Eletrodo", quantidade_em_estoque: "-1" } }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(consultas.length, 0);
});

test("processarNovoMaterial: quantidade_em_estoque acima do máximo do INTEGER do Postgres responde 400 sem gravar", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await processarNovoMaterial(
    criarRequisicao({ body: { nome: "Eletrodo", quantidade_em_estoque: "99999999999" } }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(consultas.length, 0);
});

test("processarNovoMaterial: fornecedor_id presente e inválido responde 400 (não vira null silenciosamente)", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [{ id: 1 }] };
  });
  const res = criarRespostaFalsa();

  await processarNovoMaterial(
    criarRequisicao({ body: { nome: "Eletrodo", fornecedor_id: "abc" } }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(consultas.length, 0);
});

test("processarNovoMaterial: centro_custo_id presente e inválido responde 400", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [{ id: 1 }] };
  });
  const res = criarRespostaFalsa();

  await processarNovoMaterial(
    criarRequisicao({ body: { nome: "Eletrodo", centro_custo_id: "0" } }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(consultas.length, 0);
});

test("processarNovoMaterial: fornecedor_id inexistente (violação de FK) responde 400 em vez de 500 cru", async (t) => {
  t.mock.method(pool, "query", async () => {
    const erro = new Error('insert or update on table "materiais" violates foreign key constraint');
    erro.code = "23503";
    throw erro;
  });
  const res = criarRespostaFalsa();

  await processarNovoMaterial(
    criarRequisicao({ body: { nome: "Eletrodo", fornecedor_id: "999" } }),
    res
  );

  assert.equal(res.statusCode, 400);
});

test("processarNovoMaterial: caminho feliz com todos os campos preenchidos", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [{ id: 1 }] };
  });
  const res = criarRespostaFalsa();

  await processarNovoMaterial(
    criarRequisicao({
      body: {
        nome: "Eletrodo",
        categoria: "Fisioterapia",
        unidade_medida: "unidade",
        quantidade_em_estoque: "50",
        estoque_minimo: "10",
        fornecedor_id: "1",
        centro_custo_id: "2",
      },
    }),
    res
  );

  assert.equal(res.redirectedTo, "/estoque");
  assert.deepEqual(chamadas[0].params, ["Eletrodo", "Fisioterapia", "unidade", 50, 10, 1, 2]);
});
