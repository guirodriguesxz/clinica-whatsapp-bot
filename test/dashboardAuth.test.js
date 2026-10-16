import { test } from "node:test";
import assert from "node:assert/strict";
import { exigirLogin, exigirCsrf, exigirPapel } from "../src/middleware/dashboardAuth.js";
import { pool } from "../src/db/pool.js";

// Os testes abaixo exercitam o exigirLogin REAL (e, através dele, o
// buscarUsuarioPorId real de src/models/usuarioModel.js). O ponto de mock é
// pool.query, e não o model: um `import * as usuarioModel` devolve um module
// namespace object, cujas propriedades são não-configuráveis — t.mock.method
// nele falha com "Cannot redefine property". pool é um objeto comum, então
// t.mock.method funciona e ainda cobre o SQL do model de quebra.
// t.mock.* é restaurado automaticamente pelo node:test no fim de cada teste.
function mockarConsultaDeUsuario(t, linhas) {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: linhas, rowCount: linhas.length };
  });
  return consultas;
}

function criarRespostaFalsa() {
  return {
    redirectedTo: null,
    statusCode: null,
    body: null,
    redirect(url) {
      this.redirectedTo = url;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
    },
    render(view) {
      this.viewRenderizada = view;
    },
  };
}

test("exigirLogin redireciona para /login quando não há sessão", async () => {
  const req = { session: {} };
  const res = criarRespostaFalsa();
  let chamouNext = false;
  await exigirLogin(req, res, () => {
    chamouNext = true;
  });
  assert.equal(res.redirectedTo, "/login");
  assert.equal(chamouNext, false);
});

test("exigirCsrf chama next quando o token bate", () => {
  const req = { session: { csrfToken: "abc123" }, body: { _csrf: "abc123" } };
  const res = criarRespostaFalsa();
  let chamouNext = false;
  exigirCsrf(req, res, () => {
    chamouNext = true;
  });
  assert.equal(chamouNext, true);
});

test("exigirCsrf responde 403 quando o token não bate", () => {
  const req = { session: { csrfToken: "abc123" }, body: { _csrf: "errado" } };
  const res = criarRespostaFalsa();
  let chamouNext = false;
  exigirCsrf(req, res, () => {
    chamouNext = true;
  });
  assert.equal(chamouNext, false);
  assert.equal(res.statusCode, 403);
});

test("exigirCsrf responde 403 quando não há token no corpo", () => {
  const req = { session: { csrfToken: "abc123" }, body: {} };
  const res = criarRespostaFalsa();
  let chamouNext = false;
  exigirCsrf(req, res, () => {
    chamouNext = true;
  });
  assert.equal(chamouNext, false);
  assert.equal(res.statusCode, 403);
});

test("exigirPapel bloqueia recepção antes do controlador administrativo", () => {
  const req = { usuarioAtual: { id: 7, papel: "recepcao" } };
  const res = criarRespostaFalsa();
  let chamouNext = false;

  exigirPapel("administradora")(req, res, () => {
    chamouNext = true;
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.viewRenderizada, "erros/acesso-negado");
  assert.equal(chamouNext, false);
});

test("exigirPapel libera administradora", () => {
  const req = { usuarioAtual: { id: 1, papel: "administradora" } };
  const res = criarRespostaFalsa();
  let chamouNext = false;

  exigirPapel("administradora")(req, res, () => {
    chamouNext = true;
  });

  assert.equal(chamouNext, true);
  assert.equal(res.statusCode, null);
});

test("exigirLogin redireciona quando usuário não é encontrado no banco", async (t) => {
  mockarConsultaDeUsuario(t, []);
  const req = { session: { usuarioId: 123, destroy: (cb) => cb(null) } };
  const res = criarRespostaFalsa();
  let chamouNext = false;

  await exigirLogin(req, res, () => {
    chamouNext = true;
  });

  assert.equal(res.redirectedTo, "/login");
  assert.equal(chamouNext, false);
});

test("exigirLogin destroi sessão e redireciona quando usuário está inativo", async (t) => {
  mockarConsultaDeUsuario(t, [{ id: 123, nome: "João", ativo: false }]);

  let destroyCalled = false;
  const req = {
    session: {
      usuarioId: 123,
      destroy: (cb) => {
        destroyCalled = true;
        cb(null);
      },
    },
  };
  const res = criarRespostaFalsa();
  let chamouNext = false;

  await exigirLogin(req, res, () => {
    chamouNext = true;
  });

  assert.equal(destroyCalled, true);
  assert.equal(res.redirectedTo, "/login");
  assert.equal(chamouNext, false);
});

test("exigirLogin popula dados do usuário ativo e chama next", async (t) => {
  const usuarioAtivo = {
    id: 123,
    nome: "João",
    nome_usuario: "joao",
    papel: "recepcao",
    ativo: true,
    sessao_versao: 2,
  };
  mockarConsultaDeUsuario(t, [usuarioAtivo]);

  const req = {
    session: { usuarioId: 123, usuarioVersao: 2, csrfToken: null },
  };
  const res = criarRespostaFalsa();
  res.locals = {};

  let chamouNext = false;
  await exigirLogin(req, res, () => {
    chamouNext = true;
  });

  assert.equal(chamouNext, true);
  assert.deepEqual(req.usuarioAtual, usuarioAtivo);
  assert.deepEqual(res.locals.usuarioAtual, usuarioAtivo);
  assert.ok(res.locals.csrfToken);
  assert.ok(req.session.csrfToken);
});

for (const caso of [
  { nome: "papel nulo", usuario: { papel: null, sessao_versao: 2 }, usuarioVersao: 2 },
  { nome: "papel desconhecido", usuario: { papel: "superadmin", sessao_versao: 2 }, usuarioVersao: 2 },
  { nome: "versão de sessão antiga", usuario: { papel: "recepcao", sessao_versao: 3 }, usuarioVersao: 2 },
]) {
  test(`exigirLogin encerra sessão com ${caso.nome}`, async (t) => {
    mockarConsultaDeUsuario(t, [
      {
        id: 123,
        nome: "João",
        nome_usuario: "joao",
        ativo: true,
        ...caso.usuario,
      },
    ]);
    let destruiu = false;
    const req = {
      session: {
        usuarioId: 123,
        usuarioVersao: caso.usuarioVersao,
        destroy(callback) {
          destruiu = true;
          callback(null);
        },
      },
    };
    const res = criarRespostaFalsa();

    await exigirLogin(req, res, () => assert.fail("não deveria liberar a requisição"));

    assert.equal(destruiu, true);
    assert.equal(res.redirectedTo, "/login");
  });
}

// Guarda de regressão para o vazamento do hash bcrypt até as views: o objeto
// que exigirLogin publica em req.usuarioAtual/res.locals.usuarioAtual vem
// direto do SELECT, então um `SELECT *` levaria senha_hash junto.
test("buscarUsuarioPorId não seleciona senha_hash", async (t) => {
  const consultas = mockarConsultaDeUsuario(t, [{
    id: 123,
    nome: "João",
    nome_usuario: "joao",
    papel: "recepcao",
    ativo: true,
    sessao_versao: 1,
  }]);

  const req = { session: { usuarioId: 123, usuarioVersao: 1 } };
  const res = criarRespostaFalsa();
  res.locals = {};
  await exigirLogin(req, res, () => {});

  assert.equal(consultas.length, 1);
  const sql = consultas[0].sql;
  assert.ok(!/select\s+\*/i.test(sql), `SQL não deve usar SELECT *: ${sql}`);
  assert.ok(!/senha_hash/i.test(sql), `SQL não deve trazer senha_hash: ${sql}`);
  assert.equal(Object.hasOwn(res.locals.usuarioAtual, "senha_hash"), false);
});

// Guarda de regressão: buscarUsuarioPorId precisa trazer sessao_versao, senão
// exigirLogin nunca consegue comparar contra req.session.usuarioVersao e todo
// usuário é deslogado na requisição seguinte ao login (bug real encontrado
// na revisão do merge de acesso-permissoes — mascarado antes porque o mock
// devolvia sessao_versao mesmo sem o SQL selecioná-la).
test("buscarUsuarioPorId seleciona sessao_versao", async (t) => {
  const consultas = mockarConsultaDeUsuario(t, [{
    id: 123,
    nome: "João",
    nome_usuario: "joao",
    papel: "recepcao",
    ativo: true,
    sessao_versao: 1,
  }]);

  const req = { session: { usuarioId: 123, usuarioVersao: 1 } };
  const res = criarRespostaFalsa();
  res.locals = {};
  await exigirLogin(req, res, () => {});

  const sql = consultas[0].sql;
  assert.ok(/sessao_versao/i.test(sql), `SQL deve trazer sessao_versao: ${sql}`);
});
