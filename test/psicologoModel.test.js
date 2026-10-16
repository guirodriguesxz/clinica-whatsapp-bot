import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import {
  listarPsicologos,
  buscarPsicologoPorId,
  buscarFotoPsicologo,
  criarPsicologo,
  atualizarNomePsicologo,
  atualizarFotoPsicologo,
  definirAtivoPsicologo,
} from "../src/models/psicologoModel.js";

function mockarQuery(t, linhas = []) {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: linhas };
  });
  return consultas;
}

test("listarPsicologos por padrão só busca ativos", async (t) => {
  const consultas = mockarQuery(t, [{ id: 1, nome: "Ana", ativo: true }]);

  await listarPsicologos();

  assert.match(consultas[0].sql, /WHERE ativo = true/i);
});

test("listarPsicologos mapeia temFoto a partir de tem_foto", async (t) => {
  mockarQuery(t, [
    { id: 1, nome: "Ana", ativo: true, tem_foto: true },
    { id: 2, nome: "Bia", ativo: true, tem_foto: false },
  ]);

  const resultado = await listarPsicologos();

  assert.equal(resultado[0].temFoto, true);
  assert.equal(resultado[1].temFoto, false);
});

test("listarPsicologos({ apenasAtivos: false }) busca todos, sem filtro de ativo", async (t) => {
  const consultas = mockarQuery(t, [
    { id: 1, nome: "Ana", ativo: true },
    { id: 2, nome: "Bia", ativo: false },
  ]);

  const resultado = await listarPsicologos({ apenasAtivos: false });

  assert.doesNotMatch(consultas[0].sql, /WHERE ativo/i);
  assert.equal(resultado.length, 2);
});

test("listarPsicologos ordena pelo nome", async (t) => {
  const consultas = mockarQuery(t, [{ id: 1, nome: "Ana", ativo: true }]);

  const resultado = await listarPsicologos();

  assert.match(consultas[0].sql, /ORDER BY nome ASC/i);
  assert.equal(resultado[0].nome, "Ana");
});

test("buscarPsicologoPorId retorna null quando não existe", async (t) => {
  mockarQuery(t, []);

  const resultado = await buscarPsicologoPorId(999);

  assert.equal(resultado, null);
});

test("buscarPsicologoPorId consulta pelo id informado", async (t) => {
  const consultas = mockarQuery(t, [{ id: 5, nome: "Bia", ativo: true }]);

  const resultado = await buscarPsicologoPorId(5);

  assert.deepEqual(consultas[0].params, [5]);
  assert.equal(resultado.nome, "Bia");
});

test("criarPsicologo grava o nome e retorna a linha criada", async (t) => {
  const consultas = mockarQuery(t, [{ id: 8, nome: "Caio", ativo: true, created_at: "2026-09-03" }]);

  const resultado = await criarPsicologo({ nome: "Caio" });

  assert.match(consultas[0].sql, /INSERT INTO psicologos \(nome, foto_imagem, foto_mime\)/);
  assert.deepEqual(consultas[0].params, ["Caio", null, null]);
  assert.equal(resultado.id, 8);
});

test("criarPsicologo grava a foto quando informada", async (t) => {
  const bufferFalso = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const consultas = mockarQuery(t, [{ id: 8, nome: "Caio", ativo: true }]);

  await criarPsicologo({ nome: "Caio", fotoImagem: bufferFalso, fotoMime: "image/png" });

  assert.deepEqual(consultas[0].params, ["Caio", bufferFalso, "image/png"]);
});

test("atualizarNomePsicologo altera somente o nome", async (t) => {
  const consultas = mockarQuery(t, [{ id: 5, nome: "Bia Nova", ativo: true }]);

  const resultado = await atualizarNomePsicologo(5, "Bia Nova");

  assert.match(consultas[0].sql, /SET nome = \$2/);
  assert.deepEqual(consultas[0].params, [5, "Bia Nova"]);
  assert.equal(resultado.nome, "Bia Nova");
});

test("atualizarNomePsicologo retorna null quando o id não existe", async (t) => {
  mockarQuery(t, []);

  const resultado = await atualizarNomePsicologo(999, "Nome");

  assert.equal(resultado, null);
});

test("buscarFotoPsicologo: retorna null quando não há linha", async (t) => {
  mockarQuery(t, []);

  const resultado = await buscarFotoPsicologo(999);
  assert.equal(resultado, null);
});

test("buscarFotoPsicologo: retorna null quando a coluna foto_imagem está vazia", async (t) => {
  mockarQuery(t, [{ foto_imagem: null, foto_mime: null }]);

  const resultado = await buscarFotoPsicologo(5);
  assert.equal(resultado, null);
});

test("buscarFotoPsicologo: não filtra por ativo (foto aparece mesmo pra inativo)", async (t) => {
  const consultas = mockarQuery(t, []);

  await buscarFotoPsicologo(5);
  assert.doesNotMatch(consultas[0].sql, /ativo/i);
});

test("buscarFotoPsicologo: retorna a imagem e o mime quando presentes", async (t) => {
  const bufferFalso = Buffer.from("foto-fake");
  mockarQuery(t, [{ foto_imagem: bufferFalso, foto_mime: "image/png" }]);

  const resultado = await buscarFotoPsicologo(5);
  assert.deepEqual(resultado, { fotoImagem: bufferFalso, fotoMime: "image/png" });
});

test("atualizarFotoPsicologo: envia id, imagem e mime na query", async (t) => {
  const bufferFalso = Buffer.from("nova-foto");
  const consultas = mockarQuery(t, []);

  await atualizarFotoPsicologo(5, { fotoImagem: bufferFalso, fotoMime: "image/jpeg" });

  assert.deepEqual(consultas[0].params, [5, bufferFalso, "image/jpeg"]);
});

test("definirAtivoPsicologo(id, false) desativa", async (t) => {
  const consultas = mockarQuery(t, [{ id: 5, nome: "Bia", ativo: false }]);

  const resultado = await definirAtivoPsicologo(5, false);

  assert.match(consultas[0].sql, /SET ativo = \$2/);
  assert.deepEqual(consultas[0].params, [5, false]);
  assert.equal(resultado.ativo, false);
});

test("definirAtivoPsicologo(id, true) reativa", async (t) => {
  const consultas = mockarQuery(t, [{ id: 5, nome: "Bia", ativo: true }]);

  const resultado = await definirAtivoPsicologo(5, true);

  assert.deepEqual(consultas[0].params, [5, true]);
  assert.equal(resultado.ativo, true);
});

test("definirAtivoPsicologo retorna null quando o id não existe", async (t) => {
  mockarQuery(t, []);

  const resultado = await definirAtivoPsicologo(999, false);

  assert.equal(resultado, null);
});
