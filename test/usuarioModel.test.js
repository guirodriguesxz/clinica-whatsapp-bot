import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import {
  buscarUsuarioPorId,
  buscarUsuarioPorNomeUsuario,
  atualizarSenhaUsuario,
  criarUsuario,
  desativarUsuario,
  listarUsuarios,
  normalizarNomeUsuario,
} from "../src/models/usuarioModel.js";

function mockarQuery(t, linhas = []) {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: linhas, rowCount: linhas.length };
  });
  return consultas;
}

test("normalizarNomeUsuario padroniza espaços e letras maiúsculas", () => {
  assert.equal(normalizarNomeUsuario("  BrUnO  "), "bruno");
});

test("normalizarNomeUsuario rejeita identificador curto ou com caracteres inseguros", () => {
  assert.equal(normalizarNomeUsuario("ab"), null);
  assert.equal(normalizarNomeUsuario("bruno admin"), null);
});

test("buscarUsuarioPorNomeUsuario consulta o nome normalizado", async (t) => {
  const consultas = mockarQuery(t, [{ id: 7, nome_usuario: "bruno", senha_hash: "hash" }]);

  const usuario = await buscarUsuarioPorNomeUsuario("  BrUnO  ");

  assert.equal(usuario.nome_usuario, "bruno");
  assert.deepEqual(consultas[0].params, ["bruno"]);
});

test("buscarUsuarioPorId não seleciona senha_hash para a sessão", async (t) => {
  const consultas = mockarQuery(t, [
    { id: 7, nome: "Bruno", nome_usuario: "bruno", papel: "recepcao", ativo: true },
  ]);

  const usuario = await buscarUsuarioPorId(7);

  assert.equal(usuario.nome_usuario, "bruno");
  assert.doesNotMatch(consultas[0].sql, /senha_hash/i);
});

test("criarUsuario rejeita papel que não é administradora nem recepcao", async () => {
  await assert.rejects(
    () =>
      criarUsuario({
        nome: "Teste",
        nomeUsuario: "teste",
        papel: "admin",
        senhaHash: "hash",
      }),
    /papel inválido/i
  );
});

test("listarUsuarios ordena administradoras primeiro, depois por nome, e não seleciona senha_hash", async (t) => {
  const consultas = mockarQuery(t, []);

  await listarUsuarios();

  assert.match(consultas[0].sql, /ORDER BY \(papel = 'administradora'\) DESC, nome ASC/i);
  assert.doesNotMatch(consultas[0].sql, /senha_hash/i);
});

test("desativarUsuario altera somente o estado ativo", async (t) => {
  const consultas = mockarQuery(t, [{ id: 7, ativo: false }]);

  await desativarUsuario(7);

  assert.match(consultas[0].sql, /SET ativo = false/i);
  assert.deepEqual(consultas[0].params, [7]);
});

test("atualizarSenhaUsuario incrementa a versão para revogar sessões existentes", async (t) => {
  const consultas = mockarQuery(t, [{ id: 7, sessao_versao: 4 }]);

  const usuario = await atualizarSenhaUsuario(7, "hash-novo");

  assert.match(consultas[0].sql, /sessao_versao\s*=\s*sessao_versao\s*\+\s*1/i);
  assert.match(consultas[0].sql, /RETURNING id, sessao_versao/i);
  assert.deepEqual(consultas[0].params, [7, "hash-novo"]);
  assert.equal(usuario.sessao_versao, 4);
});
