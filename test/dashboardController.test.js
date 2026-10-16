import { test } from "node:test";
import assert from "node:assert/strict";
import {
  processarLogin,
  telaControleSessoes,
  telaFichaPaciente,
  processarCriarPacote,
  processarCancelarPacote,
} from "../src/controllers/dashboardController.js";
import { pool } from "../src/db/pool.js";
import { hashSenha } from "../src/services/senhaService.js";

// Estes testes exercitam o processarLogin REAL, incluindo o bcrypt de verdade
// e o buscarUsuarioPorNomeUsuario real do model — o mock entra só em pool.query.
// (Mockar o model via `import * as` + t.mock.method não é possível: module
// namespace objects têm propriedades não-configuráveis.)

const SENHA_CERTA = "SenhaForte123";
const HASH_DA_SENHA_CERTA = await hashSenha(SENHA_CERTA);

// A mesma mensagem precisa sair nos três casos de falha (usuário inexistente,
// usuário inativo, senha errada) — é o requisito de não vazar qual deles
// ocorreu. Fixada aqui para os testes falharem se alguém diferenciar uma.
const MENSAGEM_GENERICA = "Nome de usuário ou senha inválidos.";

function mockarUsuarioNoBanco(t, linhas) {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: linhas, rowCount: linhas.length };
  });
  return consultas;
}

function criarRespostaFalsa() {
  return {
    statusCode: 200,
    viewRenderizada: null,
    dadosDaView: null,
    redirectedTo: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    render(view, dados) {
      this.viewRenderizada = view;
      this.dadosDaView = dados;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    redirect(url) {
      this.redirectedTo = url;
    },
  };
}

function criarRequisicao({ nome_usuario, senha, email, manter_conectado, regenerateErr } = {}) {
  return {
    body: { nome_usuario, senha, email, manter_conectado },
    session: {
      regenerateChamado: false,
      usuarioId: undefined,
      cookie: { maxAge: 1000 * 60 * 60 * 12 }, // reflete o default real de app.js
      regenerate(cb) {
        this.regenerateChamado = true;
        cb(regenerateErr ?? null);
      },
    },
  };
}

const USUARIO_ATIVO = {
  id: 42,
  nome: "Ana",
  nome_usuario: "ana",
  papel: "recepcao",
  ativo: true,
  senha_hash: HASH_DA_SENHA_CERTA,
  sessao_versao: 3,
};

test("processarLogin: nome de usuário inexistente responde 401 com a mensagem genérica", async (t) => {
  mockarUsuarioNoBanco(t, []);
  const req = criarRequisicao({ nome_usuario: "ninguem", senha: SENHA_CERTA });
  const res = criarRespostaFalsa();

  await processarLogin(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.viewRenderizada, "login");
  assert.equal(res.dadosDaView.erro, MENSAGEM_GENERICA);
  assert.equal(req.session.usuarioId, undefined);
});

test("processarLogin: usuário inativo responde 401 com a mensagem genérica", async (t) => {
  mockarUsuarioNoBanco(t, [{ ...USUARIO_ATIVO, ativo: false }]);
  const req = criarRequisicao({ nome_usuario: USUARIO_ATIVO.nome_usuario, senha: SENHA_CERTA });
  const res = criarRespostaFalsa();

  await processarLogin(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.viewRenderizada, "login");
  assert.equal(res.dadosDaView.erro, MENSAGEM_GENERICA);
  assert.equal(req.session.regenerateChamado, false);
});

test("processarLogin: senha errada responde 401 com a mensagem genérica", async (t) => {
  mockarUsuarioNoBanco(t, [USUARIO_ATIVO]);
  const req = criarRequisicao({ nome_usuario: USUARIO_ATIVO.nome_usuario, senha: "SenhaErrada999" });
  const res = criarRespostaFalsa();

  await processarLogin(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.viewRenderizada, "login");
  assert.equal(res.dadosDaView.erro, MENSAGEM_GENERICA);
  assert.equal(req.session.regenerateChamado, false);
});

test("processarLogin: os três casos de falha são indistinguíveis na resposta", async (t) => {
  async function respostaDe(linhas, senha) {
    // t.mock.restoreAll() entre as rodadas: um único teste registra três mocks
    // de pool.query em sequência, e sem restaurar o segundo empilharia no
    // primeiro.
    t.mock.restoreAll();
    mockarUsuarioNoBanco(t, linhas);
    const res = criarRespostaFalsa();
    await processarLogin(criarRequisicao({ nome_usuario: "ana", senha }), res);
    return { status: res.statusCode, view: res.viewRenderizada, erro: res.dadosDaView.erro };
  }

  const inexistente = await respostaDe([], SENHA_CERTA);
  const inativo = await respostaDe([{ ...USUARIO_ATIVO, ativo: false }], SENHA_CERTA);
  const senhaErrada = await respostaDe([USUARIO_ATIVO], "SenhaErrada999");

  assert.deepEqual(inexistente, inativo);
  assert.deepEqual(inativo, senhaErrada);
  assert.deepEqual(inexistente, {
    status: 401,
    view: "login",
    erro: MENSAGEM_GENERICA,
  });
});

test("processarLogin: credenciais corretas regeneram a sessão e redirecionam", async (t) => {
  mockarUsuarioNoBanco(t, [USUARIO_ATIVO]);
  const req = criarRequisicao({ nome_usuario: USUARIO_ATIVO.nome_usuario, senha: SENHA_CERTA });
  const res = criarRespostaFalsa();

  await processarLogin(req, res);

  assert.equal(req.session.regenerateChamado, true);
  assert.equal(req.session.usuarioId, USUARIO_ATIVO.id);
  assert.equal(req.session.usuarioVersao, USUARIO_ATIVO.sessao_versao);
  assert.equal(res.redirectedTo, "/hoje");
  assert.equal(res.viewRenderizada, null);
});

for (const papel of [null, "", "superadmin"]) {
  test(`processarLogin: conta ativa com papel inválido (${String(papel)}) não autentica`, async (t) => {
    mockarUsuarioNoBanco(t, [{ ...USUARIO_ATIVO, papel }]);
    const req = criarRequisicao({
      nome_usuario: USUARIO_ATIVO.nome_usuario,
      senha: SENHA_CERTA,
    });
    const res = criarRespostaFalsa();

    await processarLogin(req, res);

    assert.equal(res.statusCode, 401);
    assert.equal(req.session.regenerateChamado, false);
    assert.equal(req.session.usuarioId, undefined);
  });
}

test("processarLogin: corpo incompleto responde 400 com a mensagem genérica", async (t) => {
  mockarUsuarioNoBanco(t, []);
  const res = criarRespostaFalsa();

  await processarLogin(criarRequisicao({ nome_usuario: "ana" }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.dadosDaView.erro, MENSAGEM_GENERICA);
});

test("processarLogin: nome de usuário é normalizado antes de ir ao banco", async (t) => {
  const consultas = mockarUsuarioNoBanco(t, [USUARIO_ATIVO]);

  await processarLogin(
    criarRequisicao({ nome_usuario: "  ANA  ", senha: SENHA_CERTA }),
    criarRespostaFalsa()
  );

  assert.equal(consultas.length, 1);
  assert.deepEqual(consultas[0].params, ["ana"]);
});

test("processarLogin: 'manter_conectado' marcado estende o maxAge do cookie pro teto de retenção do navegador", async (t) => {
  mockarUsuarioNoBanco(t, [USUARIO_ATIVO]);
  const req = criarRequisicao({
    nome_usuario: USUARIO_ATIVO.nome_usuario,
    senha: SENHA_CERTA,
    manter_conectado: "on",
  });
  const res = criarRespostaFalsa();

  await processarLogin(req, res);

  assert.equal(req.session.cookie.maxAge, 1000 * 60 * 60 * 24 * 400);
});

test("processarLogin: sem 'manter_conectado' mantém o maxAge padrão da sessão (comportamento inalterado)", async (t) => {
  mockarUsuarioNoBanco(t, [USUARIO_ATIVO]);
  const req = criarRequisicao({ nome_usuario: USUARIO_ATIVO.nome_usuario, senha: SENHA_CERTA });
  const res = criarRespostaFalsa();
  const maxAgeOriginal = req.session.cookie.maxAge;

  await processarLogin(req, res);

  assert.equal(req.session.cookie.maxAge, maxAgeOriginal);
});

test("processarLogin: e-mail sem nome de usuário não é atalho de acesso", async (t) => {
  const consultas = mockarUsuarioNoBanco(t, []);
  const res = criarRespostaFalsa();

  await processarLogin(criarRequisicao({ email: "ana@example.com", senha: SENHA_CERTA }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.dadosDaView.erro, MENSAGEM_GENERICA);
  assert.equal(consultas.length, 0);
});

test("telaFichaPaciente mostra dados, histórico, pacotes e avaliações do paciente solicitado", async () => {
  const res = criarRespostaFalsa();
  const paciente = { id: 7, nome: "Ana Silva", telefone: "5511999999999", convenio: "Particular" };
  const historico = [{ data: "2026-08-30", hora: "09:00", tipo_atendimento: "fisioterapia", status: "confirmado" }];
  const pacotes = [{ id: 1, quantidade_total: 10, cancelado: false, created_at: "2026-08-01", quantidade_usada: 3 }];
  const avaliacoes = [{ id: 3, dataAvaliacao: "2026-09-01" }];
  const relatorios = [{ id: 4, dataRelatorio: "2026-09-05" }];

  await telaFichaPaciente(
    { params: { id: "7" } },
    res,
    {
      buscarPaciente: async (id) => (id === 7 ? paciente : null),
      buscarHistorico: async (id) => (id === 7 ? historico : []),
      buscarPacotes: async (id) => (id === 7 ? pacotes : []),
      buscarAvaliacoes: async (id) => (id === 7 ? avaliacoes : []),
      buscarRelatorios: async (id) => (id === 7 ? relatorios : []),
    }
  );

  assert.equal(res.viewRenderizada, "pacientes/ficha");
  assert.deepEqual(res.dadosDaView, {
    paciente,
    historico,
    pacotes,
    avaliacoes,
    relatorios,
    idade: null,
    autoImprimir: false,
  });
});

test("telaFichaPaciente rejeita identificador inválido sem consultar dados", async () => {
  const res = criarRespostaFalsa();
  let consultou = false;

  await telaFichaPaciente(
    { params: { id: "abc" } },
    res,
    {
      buscarPaciente: async () => {
        consultou = true;
      },
      buscarHistorico: async () => [],
      buscarPacotes: async () => {
        consultou = true;
        return [];
      },
    }
  );

  assert.equal(res.statusCode, 404);
  assert.equal(consultou, false);
});

// criarPacote (Task 2) roda dentro de uma transação via pool.connect(), não
// via pool.query direto — mockar só pool.query não intercepta essas chamadas
// e o teste acabaria tentando abrir uma conexão real com o banco. Mesmo
// padrão de mock usado em test/pacoteSessaoModel.test.js.
function mockarClientTransacional(t, { pacoteAtivo = null, pacoteCriado = {} } = {}) {
  const chamadas = [];
  const client = {
    query: async (sql, params) => {
      chamadas.push({ sql, params });
      if (sql.includes("SELECT ps.id, ps.quantidade_total")) {
        return { rows: pacoteAtivo ? [pacoteAtivo] : [] };
      }
      if (sql.includes("INSERT INTO pacotes_sessoes")) {
        return { rows: [pacoteCriado] };
      }
      return {};
    },
    release: () => {},
  };
  t.mock.method(pool, "connect", async () => client);
  return chamadas;
}

test("processarCriarPacote: quantidade inválida responde 400", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const res = criarRespostaFalsa();

  await processarCriarPacote(
    { params: { id: "7" }, body: { quantidade_total: "abc" }, usuarioAtual: { id: 5 } },
    res
  );

  assert.equal(res.statusCode, 400);
});

test("processarCriarPacote: paciente com pacote ativo responde 409", async (t) => {
  mockarClientTransacional(t, { pacoteAtivo: { id: 3, quantidade_total: 10 } });
  const res = criarRespostaFalsa();

  await processarCriarPacote(
    { params: { id: "7" }, body: { quantidade_total: "10" }, usuarioAtual: { id: 5 } },
    res
  );

  assert.equal(res.statusCode, 409);
});

test("processarCriarPacote: caminho feliz redireciona pra ficha do paciente", async (t) => {
  const consultas = mockarClientTransacional(t, {
    pacoteCriado: {
      id: 10,
      paciente_id: 7,
      quantidade_total: 10,
      cancelado: false,
      criado_por: 5,
      created_at: "2026-09-01",
    },
  });
  const res = criarRespostaFalsa();

  await processarCriarPacote(
    { params: { id: "7" }, body: { quantidade_total: "10" }, usuarioAtual: { id: 5 } },
    res
  );

  assert.equal(res.redirectedTo, "/pacientes/7/ficha");
  const insertChamada = consultas.find((c) => c.sql.includes("INSERT INTO pacotes_sessoes"));
  assert.deepEqual(insertChamada.params, [7, 10, 5]);
});

test("processarCriarPacote: paciente inválido responde 404 sem consultar o banco", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await processarCriarPacote(
    { params: { id: "abc" }, body: { quantidade_total: "10" }, usuarioAtual: { id: 5 } },
    res
  );

  assert.equal(res.statusCode, 404);
  assert.equal(consultas.length, 0);
});

// Cobre tanto "pacote inexistente" quanto "pacote existe mas pertence a
// outro paciente" (Finding 5 do review final): cancelarPacote agora filtra
// por paciente_id também, então dos dois lados do mock a query não bate
// nenhuma linha e o controller responde 404 do mesmo jeito.
test("processarCancelarPacote: pacote inexistente ou de outro paciente responde 404", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await processarCancelarPacote(
    { params: { id: "7", pacoteId: "999" }, usuarioAtual: { id: 5 } },
    res
  );

  assert.equal(res.statusCode, 404);
  assert.deepEqual(
    consultas[0].params,
    [999, 7],
    "deve filtrar por pacoteId E pacienteId, não só pacoteId"
  );
});

test("processarCancelarPacote: caminho feliz redireciona pra ficha do paciente", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [{ id: 10, cancelado: true }] };
  });
  const res = criarRespostaFalsa();

  await processarCancelarPacote(
    { params: { id: "7", pacoteId: "10" }, usuarioAtual: { id: 5 } },
    res
  );

  assert.equal(res.redirectedTo, "/pacientes/7/ficha");
  assert.deepEqual(consultas[0].params, [10, 7]);
});

test("telaControleSessoes prepara dez linhas para impressão de fisioterapia", async () => {
  const res = criarRespostaFalsa();
  const paciente = { id: 7, nome: "Ana Silva" };
  const sessoes = [{ data: "2026-08-30", hora: "09:00", status: "compareceu" }];

  await telaControleSessoes(
    { params: { id: "7" } },
    res,
    {
      buscarPaciente: async () => paciente,
      buscarSessoes: async () => sessoes,
      buscarAvaliacoes: async () => [],
      buscarPacotes: async () => [],
    }
  );

  assert.equal(res.viewRenderizada, "pacientes/controle-sessoes");
  assert.equal(res.dadosDaView.paciente, paciente);
  assert.equal(res.dadosDaView.sessoes.length, 10);
  assert.deepEqual(res.dadosDaView.sessoes[0], { numero: 1, ...sessoes[0] });
  assert.deepEqual(res.dadosDaView.sessoes[9], { numero: 10, data: null, hora: null, status: null });
  assert.equal(res.dadosDaView.dataAvaliacao, null);
});

test("telaControleSessoes usa a quantidade_total do pacote ativo quando maior que dez", async () => {
  const res = criarRespostaFalsa();
  const paciente = { id: 7, nome: "Ana Silva" };

  await telaControleSessoes(
    { params: { id: "7" } },
    res,
    {
      buscarPaciente: async () => paciente,
      buscarSessoes: async () => [],
      buscarAvaliacoes: async () => [],
      buscarPacotes: async () => [{ id: 1, quantidade_total: 20, quantidade_usada: 3, cancelado: false }],
    }
  );

  assert.equal(res.dadosDaView.sessoes.length, 20);
  assert.deepEqual(res.dadosDaView.sessoes[19], { numero: 20, data: null, hora: null, status: null });
});

test("telaControleSessoes ignora pacote cancelado ou já esgotado ao contar linhas", async () => {
  const res = criarRespostaFalsa();
  const paciente = { id: 7, nome: "Ana Silva" };

  await telaControleSessoes(
    { params: { id: "7" } },
    res,
    {
      buscarPaciente: async () => paciente,
      buscarSessoes: async () => [],
      buscarAvaliacoes: async () => [],
      buscarPacotes: async () => [
        { id: 1, quantidade_total: 20, quantidade_usada: 20, cancelado: false },
        { id: 2, quantidade_total: 15, quantidade_usada: 0, cancelado: true },
      ],
    }
  );

  assert.equal(res.dadosDaView.sessoes.length, 10);
});

test("telaControleSessoes: ?linhas sobrepõe o cálculo automático", async () => {
  const res = criarRespostaFalsa();
  const paciente = { id: 7, nome: "Ana Silva" };

  await telaControleSessoes(
    { params: { id: "7" }, query: { linhas: "17" } },
    res,
    {
      buscarPaciente: async () => paciente,
      buscarSessoes: async () => [],
      buscarAvaliacoes: async () => [],
      buscarPacotes: async () => [],
    }
  );

  assert.equal(res.dadosDaView.sessoes.length, 17);
  assert.equal(res.dadosDaView.totalLinhas, 17);
  assert.equal(res.dadosDaView.totalAutomatico, 10);
});

test("telaControleSessoes: ?linhas inválido (fora de 1..60, ou não numérico) cai no cálculo automático", async () => {
  const paciente = { id: 7, nome: "Ana Silva" };
  const dependencias = {
    buscarPaciente: async () => paciente,
    buscarSessoes: async () => [],
    buscarAvaliacoes: async () => [],
    buscarPacotes: async () => [{ id: 1, quantidade_total: 12, quantidade_usada: 0, cancelado: false }],
  };

  for (const linhasInvalidas of ["0", "61", "abc", "-5", "3.5"]) {
    const res = criarRespostaFalsa();
    await telaControleSessoes({ params: { id: "7" }, query: { linhas: linhasInvalidas } }, res, dependencias);
    assert.equal(res.dadosDaView.sessoes.length, 12, `linhas=${linhasInvalidas} deveria cair no automático`);
  }
});

test("telaControleSessoes usa a data da avaliação mais recente do paciente", async () => {
  const res = criarRespostaFalsa();
  const paciente = { id: 7, nome: "Ana Silva" };

  await telaControleSessoes(
    { params: { id: "7" } },
    res,
    {
      buscarPaciente: async () => paciente,
      buscarSessoes: async () => [],
      buscarAvaliacoes: async () => [
        { id: 2, dataAvaliacao: "2026-09-01" },
        { id: 1, dataAvaliacao: "2026-08-01" },
      ],
      buscarPacotes: async () => [],
    }
  );

  assert.equal(res.dadosDaView.dataAvaliacao, "2026-09-01");
});
