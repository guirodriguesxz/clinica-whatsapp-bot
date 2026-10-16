// test/dashboardControllerPacientes.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { telaPacientes, processarExcluirPaciente } from "../src/controllers/dashboardController.js";

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

function criarRequisicao({ query = {}, params = {} } = {}) {
  return { query, params };
}

test("telaPacientes: sem query params, usa offset 0 e limite padrão (50) na view", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const res = criarRespostaFalsa();

  await telaPacientes(criarRequisicao({ query: {} }), res);

  assert.equal(res.viewRenderizada, "pacientes/lista");
  assert.equal(res.dadosDaView.offsetAtual, 0);
  assert.equal(res.dadosDaView.limiteAtual, 50);
  assert.equal(res.dadosDaView.mensagemExclusao, null);
});

test("telaPacientes: ?resultado=excluido mostra mensagem de exclusão", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const res = criarRespostaFalsa();

  await telaPacientes(criarRequisicao({ query: { resultado: "excluido" } }), res);

  assert.match(res.dadosDaView.mensagemExclusao, /excluído/);
});

test("telaPacientes: ?resultado=arquivado mostra mensagem de arquivamento explicando o motivo", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const res = criarRespostaFalsa();

  await telaPacientes(criarRequisicao({ query: { resultado: "arquivado" } }), res);

  assert.match(res.dadosDaView.mensagemExclusao, /arquivado/);
  assert.match(res.dadosDaView.mensagemExclusao, /histórico/);
});

test("telaPacientes: ?resultado=qualquercoisa (valor não reconhecido) não mostra mensagem", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const res = criarRespostaFalsa();

  await telaPacientes(criarRequisicao({ query: { resultado: "qualquercoisa" } }), res);

  assert.equal(res.dadosDaView.mensagemExclusao, null);
});

test("telaPacientes: repassa limite/offset da query pro model", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await telaPacientes(criarRequisicao({ query: { limite: "10", offset: "20" } }), res);

  assert.equal(res.dadosDaView.limiteAtual, 10);
  assert.equal(res.dadosDaView.offsetAtual, 20);
});

test("telaPacientes: repassa a busca (nome ou telefone) da query pro model e pra view", async (t) => {
  let paramsRecebidos = null;
  t.mock.method(pool, "query", async (sql, params) => {
    paramsRecebidos = params;
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await telaPacientes(criarRequisicao({ query: { busca: "11999990000" } }), res);

  assert.equal(paramsRecebidos[3], "11999990000");
  assert.equal(res.dadosDaView.busca, "11999990000");
});

test("telaPacientes: repassa o filtro de avaliação pro model e pra view", async () => {
  let filtrosRecebidos = null;
  const res = criarRespostaFalsa();

  await telaPacientes(criarRequisicao({ query: { avaliacao: "avaliacao" } }), res, {
    listarPacientes: async (filtros) => {
      filtrosRecebidos = filtros;
      return [];
    },
  });

  assert.equal(filtrosRecebidos.avaliacao, "avaliacao");
  assert.equal(res.dadosDaView.avaliacao, "avaliacao");
});

test("telaPacientes: página cheia (pacientes.length === limite) marca temProximaPagina true", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 1, nome: "Ana", telefone: "5511999990000", convenio: null, created_at: new Date() }],
  }));
  const res = criarRespostaFalsa();

  await telaPacientes(criarRequisicao({ query: { limite: "1" } }), res);

  assert.equal(res.dadosDaView.pacientes.length, 1);
  assert.equal(res.dadosDaView.temProximaPagina, true);
});

test("telaPacientes: página incompleta (pacientes.length < limite) marca temProximaPagina false", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const res = criarRespostaFalsa();

  await telaPacientes(criarRequisicao({ query: { limite: "10" } }), res);

  assert.equal(res.dadosDaView.pacientes.length, 0);
  assert.equal(res.dadosDaView.temProximaPagina, false);
});

test("processarExcluirPaciente: id inválido responde 404 sem chamar o model", async () => {
  let chamado = false;
  const res = criarRespostaFalsa();

  await processarExcluirPaciente(criarRequisicao({ params: { id: "abc" } }), res, {
    excluirOuArquivarPacienteFn: async () => {
      chamado = true;
      return "excluido";
    },
  });

  assert.equal(res.statusCode, 404);
  assert.equal(chamado, false);
});

test("processarExcluirPaciente: sem histórico (model retorna 'excluido') redireciona com resultado=excluido", async () => {
  const res = criarRespostaFalsa();

  await processarExcluirPaciente(criarRequisicao({ params: { id: "7" } }), res, {
    excluirOuArquivarPacienteFn: async (id) => {
      assert.equal(id, 7);
      return "excluido";
    },
  });

  assert.equal(res.redirectedTo, "/pacientes?resultado=excluido");
});

test("processarExcluirPaciente: com histórico (model retorna 'arquivado') redireciona com resultado=arquivado", async () => {
  const res = criarRespostaFalsa();

  await processarExcluirPaciente(criarRequisicao({ params: { id: "7" } }), res, {
    excluirOuArquivarPacienteFn: async () => "arquivado",
  });

  assert.equal(res.redirectedTo, "/pacientes?resultado=arquivado");
});

test("processarExcluirPaciente: paciente inexistente (model retorna null) responde 404", async () => {
  const res = criarRespostaFalsa();

  await processarExcluirPaciente(criarRequisicao({ params: { id: "7" } }), res, {
    excluirOuArquivarPacienteFn: async () => null,
  });

  assert.equal(res.statusCode, 404);
});

test("processarExcluirPaciente: erro do model propaga (nenhum erro esperado sobra sem tratar)", async () => {
  const res = criarRespostaFalsa();

  await assert.rejects(() =>
    processarExcluirPaciente(criarRequisicao({ params: { id: "7" } }), res, {
      excluirOuArquivarPacienteFn: async () => {
        throw new Error("falha inesperada de conexão");
      },
    })
  );
});
