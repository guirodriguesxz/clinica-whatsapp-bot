import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import {
  processarDesativacaoUsuario,
  processarNovoUsuario,
  processarRedefinicaoSenha,
  processarTrocaPropriaSenha,
  telaUsuarios,
} from "../src/controllers/usuarioController.js";

function criarRespostaFalsa() {
  return {
    statusCode: 200,
    body: null,
    redirectedTo: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    redirect(url) {
      this.redirectedTo = url;
    },
    render(view, dados) {
      this.view = view;
      this.dados = dados;
    },
  };
}

test("processarNovoUsuario cria conta de recepção sem aceitar papel do formulário", async () => {
  const res = criarRespostaFalsa();
  let entradaCriada = null;

  await processarNovoUsuario(
    {
      body: {
        nome: "Amanda",
        nome_usuario: "aline",
        papel: "administradora",
        senha: "SenhaForte123",
        confirmacao_senha: "SenhaForte123",
      },
    },
    res,
    {
      hash: async () => "hash-seguro",
      criar: async (entrada) => {
        entradaCriada = entrada;
        return { id: 4 };
      },
    }
  );

  assert.deepEqual(entradaCriada, {
    nome: "Amanda",
    nomeUsuario: "aline",
    papel: "recepcao",
    senhaHash: "hash-seguro",
  });
  assert.equal(res.redirectedTo, "/usuarios?sucesso=1");
});

test("processarNovoUsuario trata nome de usuário duplicado sem expor erro do banco", async () => {
  const res = criarRespostaFalsa();
  const erroDuplicidade = Object.assign(new Error("detalhes internos"), { code: "23505" });

  await processarNovoUsuario(
    {
      body: {
        nome: "Amanda",
        nome_usuario: "aline",
        senha: "SenhaTemporaria123",
        confirmacao_senha: "SenhaTemporaria123",
      },
    },
    res,
    {
      hash: async () => "hash-seguro",
      criar: async () => {
        throw erroDuplicidade;
      },
    }
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.body, /já existe um usuário/i);
  assert.doesNotMatch(res.body, /detalhes internos/i);
});

for (const nomeUsuario of ["ab", "nome com espaço", "ADMIN!"]) {
  test(`processarNovoUsuario rejeita nome de usuário inválido (${nomeUsuario}) antes do hash`, async () => {
    const res = criarRespostaFalsa();
    let calculouHash = false;

    await processarNovoUsuario(
      {
        body: {
          nome: "Teste",
          nome_usuario: nomeUsuario,
          senha: "SenhaTemporaria123",
          confirmacao_senha: "SenhaTemporaria123",
        },
      },
      res,
      {
        hash: async () => {
          calculouHash = true;
        },
      }
    );

    assert.equal(res.statusCode, 400);
    assert.equal(calculouHash, false);
  });
}

test("telaUsuarios renderiza lista sem solicitar senha_hash", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql) => {
    consultas.push(sql);
    return {
      rows: [
        {
          id: 7,
          nome: "Amanda",
          nome_usuario: "aline",
          papel: "recepcao",
          ativo: true,
        },
      ],
    };
  });
  const res = criarRespostaFalsa();

  await telaUsuarios({ query: {} }, res);

  assert.equal(res.view, "usuarios/lista");
  assert.equal(res.dados.usuarios[0].senha_hash, undefined);
  assert.doesNotMatch(consultas[0], /senha_hash/i);
});

test("processarRedefinicaoSenha rejeita confirmação diferente sem atualizar", async () => {
  const res = criarRespostaFalsa();
  let atualizou = false;

  await processarRedefinicaoSenha(
    {
      params: { id: "7" },
      usuarioAtual: { id: 1 },
      body: { senha: "SenhaForte123", confirmacao_senha: "OutraSenha123" },
    },
    res,
    {
      hash: async () => "nao-deve-chamar",
      atualizar: async () => {
        atualizou = true;
      },
    }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(atualizou, false);
});

test("processarRedefinicaoSenha rejeita senha curta antes de hash ou consulta", async () => {
  const res = criarRespostaFalsa();
  const chamadas = [];

  await processarRedefinicaoSenha(
    {
      params: { id: "7" },
      usuarioAtual: { id: 1 },
      body: { senha: "curta", confirmacao_senha: "curta" },
    },
    res,
    {
      buscarUsuario: async () => chamadas.push("buscar"),
      hash: async () => chamadas.push("hash"),
      atualizar: async () => chamadas.push("atualizar"),
    }
  );

  assert.equal(res.statusCode, 400);
  assert.deepEqual(chamadas, []);
});

test("processarRedefinicaoSenha não permite redefinir a própria senha", async () => {
  const res = criarRespostaFalsa();
  let atualizou = false;

  await processarRedefinicaoSenha(
    {
      params: { id: "1" },
      usuarioAtual: { id: 1 },
      body: { senha: "SenhaForte123", confirmacao_senha: "SenhaForte123" },
    },
    res,
    {
      hash: async () => "nao-deve-chamar",
      atualizar: async () => {
        atualizou = true;
      },
    }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(atualizou, false);
});

test("processarRedefinicaoSenha não altera a senha de outra administradora", async () => {
  const res = criarRespostaFalsa();
  let atualizou = false;

  await processarRedefinicaoSenha(
    {
      params: { id: "2" },
      usuarioAtual: { id: 1 },
      body: { senha: "SenhaForte123", confirmacao_senha: "SenhaForte123" },
    },
    res,
    {
      buscarUsuario: async () => ({ id: 2, papel: "administradora" }),
      hash: async () => "nao-deve-chamar",
      atualizar: async () => {
        atualizou = true;
      },
    }
  );

  assert.equal(res.statusCode, 403);
  assert.equal(atualizou, false);
});

test("processarDesativacaoUsuario não permite desativar a própria administradora", async () => {
  const res = criarRespostaFalsa();
  let desativou = false;

  await processarDesativacaoUsuario(
    { params: { id: "1" }, usuarioAtual: { id: 1 } },
    res,
    {
      desativar: async () => {
        desativou = true;
      },
    }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(desativou, false);
});

test("processarDesativacaoUsuario não desativa outra administradora", async () => {
  const res = criarRespostaFalsa();
  let desativou = false;

  await processarDesativacaoUsuario(
    { params: { id: "2" }, usuarioAtual: { id: 1 } },
    res,
    {
      buscarUsuario: async () => ({ id: 2, papel: "administradora" }),
      desativar: async () => {
        desativou = true;
      },
    }
  );

  assert.equal(res.statusCode, 403);
  assert.equal(desativou, false);
});

test("processarTrocaPropriaSenha encerra a sessão depois de trocar a senha correta", async () => {
  const res = criarRespostaFalsa();
  let atualizacao = null;
  let sessaoDestruida = false;
  const req = {
    usuarioAtual: { id: 7 },
    body: {
      senha_atual: "SenhaAtual123",
      senha: "SenhaNova123",
      confirmacao_senha: "SenhaNova123",
    },
    session: {
      destroy(callback) {
        sessaoDestruida = true;
        callback(null);
      },
    },
  };

  const ordem = [];
  await processarTrocaPropriaSenha(req, res, {
    buscarHash: async () => {
      ordem.push("buscar");
      return "hash-atual";
    },
    comparar: async (senha, hash) => {
      ordem.push("comparar");
      return senha === "SenhaAtual123" && hash === "hash-atual";
    },
    hash: async () => {
      ordem.push("hash");
      return "hash-novo";
    },
    atualizar: async (id, senhaHash) => {
      ordem.push("atualizar");
      atualizacao = { id, senhaHash };
      return { id };
    },
  });

  assert.deepEqual(atualizacao, { id: 7, senhaHash: "hash-novo" });
  assert.equal(sessaoDestruida, true);
  assert.equal(res.redirectedTo, "/login?senhaAlterada=1");
  assert.deepEqual(ordem, ["buscar", "comparar", "hash", "atualizar"]);
});

test("processarTrocaPropriaSenha rejeita senha atual incorreta sem atualizar", async () => {
  const res = criarRespostaFalsa();
  let atualizou = false;

  await processarTrocaPropriaSenha(
    {
      usuarioAtual: { id: 7 },
      body: {
        senha_atual: "SenhaIncorreta123",
        senha: "SenhaNova123",
        confirmacao_senha: "SenhaNova123",
      },
      session: { destroy() {} },
    },
    res,
    {
      buscarHash: async () => "hash-atual",
      comparar: async () => false,
      hash: async () => "nao-deve-chamar",
      atualizar: async () => {
        atualizou = true;
      },
    }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(atualizou, false);
});

for (const [nome, senha, confirmacao] of [
  ["senha curta", "curta", "curta"],
  ["confirmação divergente", "SenhaNova123", "OutraSenha123"],
]) {
  test(`processarTrocaPropriaSenha rejeita ${nome} antes de consultar credenciais`, async () => {
    const res = criarRespostaFalsa();
    let buscouHash = false;

    await processarTrocaPropriaSenha(
      {
        usuarioAtual: { id: 7 },
        body: {
          senha_atual: "SenhaAtual123",
          senha,
          confirmacao_senha: confirmacao,
        },
        session: { destroy() {} },
      },
      res,
      {
        buscarHash: async () => {
          buscouHash = true;
        },
      }
    );

    assert.equal(res.statusCode, 400);
    assert.equal(buscouHash, false);
  });
}

test("processarTrocaPropriaSenha informa erro se não conseguir encerrar a sessão", async () => {
  const res = criarRespostaFalsa();
  const erroSessao = new Error("store indisponível");
  let erroCapturado = null;
  const req = {
    usuarioAtual: { id: 7 },
    body: {
      senha_atual: "SenhaAtual123",
      senha: "SenhaNova123",
      confirmacao_senha: "SenhaNova123",
    },
    session: {
      destroy(callback) {
        callback(erroSessao);
      },
    },
  };

  await processarTrocaPropriaSenha(req, res, {
    buscarHash: async () => "hash-atual",
    comparar: async () => true,
    hash: async () => "hash-novo",
    atualizar: async () => ({ id: 7 }),
    capturar: (mensagem, erro) => {
      erroCapturado = { mensagem, erro };
    },
  });

  assert.equal(res.statusCode, 500);
  assert.equal(res.redirectedTo, null);
  assert.deepEqual(erroCapturado, {
    mensagem: "[usuarios] Erro ao encerrar sessão após troca de senha:",
    erro: erroSessao,
  });
});
