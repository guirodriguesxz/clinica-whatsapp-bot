import { test } from "node:test";
import assert from "node:assert/strict";
import dashboardRoutes from "../src/routes/dashboardRoutes.js";
import { pool } from "../src/db/pool.js";

function encontrarHandlers(caminho, metodo) {
  const camada = dashboardRoutes.stack.find(
    ({ route }) => route?.path === caminho && route.methods[metodo]
  );
  assert.ok(camada, `rota ${metodo.toUpperCase()} ${caminho} não encontrada`);
  return camada.route.stack.map(({ handle }) => handle);
}

async function executarRota({ caminho, metodo, req, res }) {
  const handlers = encontrarHandlers(caminho, metodo);

  await new Promise((resolve, reject) => {
    let encerrada = false;
    const encerrar = () => {
      if (!encerrada) {
        encerrada = true;
        resolve();
      }
    };

    for (const metodoResposta of ["render", "send", "redirect"]) {
      const original = res[metodoResposta];
      res[metodoResposta] = (...args) => {
        const retorno = original.apply(res, args);
        encerrar();
        return retorno;
      };
    }

    const proximo = (indice, erro) => {
      if (erro) return reject(erro);
      if (indice >= handlers.length) return encerrar();

      try {
        const retorno = handlers[indice](req, res, (proximoErro) =>
          proximo(indice + 1, proximoErro)
        );
        Promise.resolve(retorno).catch(reject);
      } catch (erroSincrono) {
        reject(erroSincrono);
      }
    };

    proximo(0);
  });
}

function criarResposta() {
  return {
    locals: {},
    statusCode: 200,
    view: null,
    body: null,
    redirectedTo: null,
    status(codigo) {
      this.statusCode = codigo;
      return this;
    },
    render(view) {
      this.view = view;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    redirect(url) {
      this.redirectedTo = url;
      return this;
    },
  };
}

function criarRequisicao() {
  return {
    session: { usuarioId: 7, csrfToken: "csrf-valido" },
    body: { _csrf: "csrf-valido" },
    params: { id: "4" },
    query: {},
  };
}

const RECEPCIONISTA = {
  id: 7,
  nome: "Amanda",
  nome_usuario: "aline",
  papel: "recepcao",
  ativo: true,
  created_at: "2026-08-31T10:00:00.000Z",
};

test("GET /usuarios bloqueia recepção antes de consultar a lista", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql) => {
    consultas.push(sql);
    return { rows: [RECEPCIONISTA] };
  });
  const res = criarResposta();

  await executarRota({
    caminho: "/usuarios",
    metodo: "get",
    req: criarRequisicao(),
    res,
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.view, "erros/acesso-negado");
  assert.equal(consultas.length, 1, "não deve consultar a lista depois de negar o papel");
});

test("POST de estorno bloqueia recepção antes de abrir transação", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [RECEPCIONISTA] }));
  let abriuTransacao = false;
  t.mock.method(pool, "connect", async () => {
    abriuTransacao = true;
    throw new Error("não deveria abrir transação");
  });
  const req = criarRequisicao();
  req.body.data = "2026-08-31";
  const res = criarResposta();

  await executarRota({
    caminho: "/financeiro/pagamento/:id/estornar",
    metodo: "post",
    req,
    res,
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.view, "erros/acesso-negado");
  assert.equal(abriuTransacao, false);
});

test("POST cancelar pacote bloqueia recepção antes de abrir transação", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [RECEPCIONISTA] }));
  let consultouPacote = false;
  t.mock.method(pool, "connect", async () => {
    consultouPacote = true;
    throw new Error("não deveria abrir conexão");
  });
  const res = criarResposta();

  await executarRota({
    caminho: "/pacientes/:id/pacotes/:pacoteId/cancelar",
    metodo: "post",
    req: criarRequisicao(),
    res,
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.view, "erros/acesso-negado");
  assert.equal(consultouPacote, false);
});

test("POST excluir paciente bloqueia recepção antes de consultar o banco", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql) => {
    consultas.push(sql);
    return { rows: [RECEPCIONISTA] };
  });
  const res = criarResposta();

  await executarRota({
    caminho: "/pacientes/:id/excluir",
    metodo: "post",
    req: criarRequisicao(),
    res,
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.view, "erros/acesso-negado");
  assert.equal(consultas.length, 1, "não deve tentar excluir depois de negar o papel");
});

test("GET /psicologos sem sessão redireciona pro login", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql) => {
    consultas.push(sql);
    return { rows: [] };
  });
  const res = criarResposta();

  await executarRota({
    caminho: "/psicologos",
    metodo: "get",
    req: { session: {}, body: {}, params: {}, query: {} },
    res,
  });

  assert.equal(res.redirectedTo, "/login");
  assert.equal(consultas.length, 0, "não deve consultar o banco sem sessão válida");
});

test("POST /psicologos/:id/desativar com CSRF inválido bloqueia antes de atualizar", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql) => {
    consultas.push(sql);
    return { rows: [RECEPCIONISTA] };
  });
  const req = criarRequisicao();
  req.body._csrf = "csrf-invalido";
  const res = criarResposta();

  await executarRota({
    caminho: "/psicologos/:id/desativar",
    metodo: "post",
    req,
    res,
  });

  assert.equal(res.statusCode, 403);
  assert.ok(
    !consultas.some((sql) => /UPDATE psicologos/i.test(sql)),
    "não deve atualizar o psicólogo com CSRF inválido"
  );
});

test("GET /base-conhecimento bloqueia recepção antes de consultar a lista", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql) => {
    consultas.push(sql);
    return { rows: [RECEPCIONISTA] };
  });
  const res = criarResposta();

  await executarRota({
    caminho: "/base-conhecimento",
    metodo: "get",
    req: criarRequisicao(),
    res,
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.view, "erros/acesso-negado");
  assert.equal(consultas.length, 1, "não deve consultar a lista depois de negar o papel");
});

test("POST /base-conhecimento/:id/desativar bloqueia recepção antes de gravar", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [RECEPCIONISTA] }));
  const res = criarResposta();

  await executarRota({
    caminho: "/base-conhecimento/:id/desativar",
    metodo: "post",
    req: criarRequisicao(),
    res,
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.view, "erros/acesso-negado");
});

test("GET /fisioterapeutas não bloqueia recepção (listagem é aberta a qualquer logado)", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("FROM usuarios")) return { rows: [RECEPCIONISTA] };
    return { rows: [] };
  });
  const res = criarResposta();

  await executarRota({ caminho: "/fisioterapeutas", metodo: "get", req: criarRequisicao(), res });

  assert.notEqual(res.statusCode, 403);
});

test("GET /fisioterapeutas/novo bloqueia recepção antes de renderizar o formulário", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [RECEPCIONISTA] }));
  const res = criarResposta();

  await executarRota({ caminho: "/fisioterapeutas/novo", metodo: "get", req: criarRequisicao(), res });

  assert.equal(res.statusCode, 403);
  assert.equal(res.view, "erros/acesso-negado");
});

test("POST /fisioterapeutas/:id/desativar bloqueia recepção antes de consultar o fisioterapeuta", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql) => {
    consultas.push(sql);
    return { rows: [RECEPCIONISTA] };
  });
  const res = criarResposta();

  await executarRota({ caminho: "/fisioterapeutas/:id/desativar", metodo: "post", req: criarRequisicao(), res });

  assert.equal(res.statusCode, 403);
  assert.equal(consultas.length, 1, "não deve consultar o fisioterapeuta depois de negar o papel");
});

test("GET /fisioterapeutas sem sessão redireciona pro login", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql) => {
    consultas.push(sql);
    return { rows: [] };
  });
  const res = criarResposta();

  await executarRota({
    caminho: "/fisioterapeutas",
    metodo: "get",
    req: { session: {}, body: {}, params: {}, query: {} },
    res,
  });

  assert.equal(res.redirectedTo, "/login");
  assert.equal(consultas.length, 0, "não deve consultar o banco sem sessão válida");
});

const ADMINISTRADORA = {
  id: 7,
  nome: "Ana",
  nome_usuario: "ana",
  papel: "administradora",
  ativo: true,
  created_at: "2026-08-31T10:00:00.000Z",
};

function mockPoolAgenda(t, { usuario = ADMINISTRADORA } = {}) {
  const paramsDasConsultasDeAgenda = [];
  t.mock.method(pool, "query", async (sql, params = []) => {
    if (sql.includes("FROM usuarios")) return { rows: [usuario] };
    if (sql.includes("FROM psicologos")) return { rows: [] };
    if (sql.includes("FROM agendamentos") || sql.includes("FROM agendamentos_importados")) {
      paramsDasConsultasDeAgenda.push(params);
      return { rows: [] };
    }
    return { rows: [] };
  });
  return paramsDasConsultasDeAgenda;
}

test("GET /psicologia busca só agendamentos de psicologia, mesmo sem filtro na query", async (t) => {
  const chamadas = mockPoolAgenda(t);
  const res = criarResposta();

  await executarRota({ caminho: "/psicologia", metodo: "get", req: criarRequisicao(), res });

  assert.notEqual(res.statusCode, 403);
  assert.ok(chamadas.length > 0, "deveria ter consultado agendamentos");
  for (const params of chamadas) {
    assert.ok(params.includes("psicologia"), `esperava 'psicologia' nos params, recebeu: ${JSON.stringify(params)}`);
    assert.ok(!params.includes("fisioterapia"));
  }
});

test("GET /psicologia/proximos busca só agendamentos de psicologia, mesmo sem filtro na query", async (t) => {
  const chamadas = mockPoolAgenda(t);
  const res = criarResposta();

  await executarRota({ caminho: "/psicologia/proximos", metodo: "get", req: criarRequisicao(), res });

  assert.notEqual(res.statusCode, 403);
  assert.ok(chamadas.length > 0, "deveria ter consultado agendamentos");
  for (const params of chamadas) {
    assert.ok(params.includes("psicologia"));
    assert.ok(!params.includes("fisioterapia"));
  }
});

test("GET /agendamentos busca só agendamentos de fisioterapia, mesmo tentando psicologia via query", async (t) => {
  const chamadas = mockPoolAgenda(t);
  const res = criarResposta();

  await executarRota({
    caminho: "/agendamentos",
    metodo: "get",
    req: { ...criarRequisicao(), query: { tipo_atendimento: "psicologia" } },
    res,
  });

  assert.notEqual(res.statusCode, 403);
  assert.ok(chamadas.length > 0, "deveria ter consultado agendamentos");
  for (const params of chamadas) {
    assert.ok(params.includes("fisioterapia"), `esperava 'fisioterapia' nos params, recebeu: ${JSON.stringify(params)}`);
    assert.ok(!params.includes("psicologia"));
  }
});

test("GET /agendamentos/proximos busca só agendamentos de fisioterapia, mesmo tentando psicologia via query", async (t) => {
  const chamadas = mockPoolAgenda(t);
  const res = criarResposta();

  await executarRota({
    caminho: "/agendamentos/proximos",
    metodo: "get",
    req: { ...criarRequisicao(), query: { tipo_atendimento: "psicologia" } },
    res,
  });

  assert.notEqual(res.statusCode, 403);
  assert.ok(chamadas.length > 0, "deveria ter consultado agendamentos");
  for (const params of chamadas) {
    assert.ok(params.includes("fisioterapia"));
    assert.ok(!params.includes("psicologia"));
  }
});
