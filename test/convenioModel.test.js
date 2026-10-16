import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import {
  listarConvenios,
  buscarConvenioPorId,
  criarConvenio,
  atualizarConvenio,
  definirAtivoConvenio,
} from "../src/models/convenioModel.js";

function mockarQuery(t, linhas = []) {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: linhas };
  });
  return consultas;
}

test("listarConvenios por padrão só busca ativos", async (t) => {
  const consultas = mockarQuery(t, [{ id: 1, nome: "Mar Azul Saúde", ativo: true }]);

  await listarConvenios();

  assert.match(consultas[0].sql, /WHERE ativo = true/i);
});

test("listarConvenios({ apenasAtivos: false }) busca todos, sem filtro de ativo", async (t) => {
  const consultas = mockarQuery(t, [
    { id: 1, nome: "Mar Azul Saúde", ativo: true },
    { id: 2, nome: "Bio Vida", ativo: false },
  ]);

  const resultado = await listarConvenios({ apenasAtivos: false });

  assert.doesNotMatch(consultas[0].sql, /WHERE ativo/i);
  assert.equal(resultado.length, 2);
});

test("listarConvenios ordena pelo nome", async (t) => {
  const consultas = mockarQuery(t, [{ id: 1, nome: "Mar Azul Saúde", ativo: true }]);

  const resultado = await listarConvenios();

  assert.match(consultas[0].sql, /ORDER BY nome ASC/i);
  assert.equal(resultado[0].nome, "Mar Azul Saúde");
});

test("buscarConvenioPorId retorna null quando não existe", async (t) => {
  mockarQuery(t, []);

  const resultado = await buscarConvenioPorId(999);

  assert.equal(resultado, null);
});

test("buscarConvenioPorId consulta pelo id informado", async (t) => {
  const consultas = mockarQuery(t, [{ id: 5, nome: "Mar Azul Saúde", ativo: true }]);

  const resultado = await buscarConvenioPorId(5);

  assert.deepEqual(consultas[0].params, [5]);
  assert.equal(resultado.nome, "Mar Azul Saúde");
});

test("buscarConvenioPorId: inclui os campos TISS no retorno", async (t) => {
  const linha = {
    id: 5, nome: "Mar Azul Saúde", ativo: true,
    valor_repasse_avaliacao: null, valor_repasse_sessao: null,
    codigo_prestador_na_operadora: "PRESTADOR123", numero_contrato: "CT-001",
    created_at: new Date(),
  };
  mockarQuery(t, [linha]);

  const resultado = await buscarConvenioPorId(5);

  assert.equal(resultado.codigo_prestador_na_operadora, "PRESTADOR123");
  assert.equal(resultado.numero_contrato, "CT-001");
});

test("criarConvenio grava nome e valores de repasse", async (t) => {
  const consultas = mockarQuery(t, [
    { id: 8, nome: "Mar Azul Saúde", ativo: true, valor_repasse_avaliacao: 5.6, valor_repasse_sessao: 5.6 },
  ]);

  const resultado = await criarConvenio({ nome: "Mar Azul Saúde", valorRepasseAvaliacao: 5.6, valorRepasseSessao: 5.6 });

  assert.match(consultas[0].sql, /INSERT INTO convenios/);
  assert.deepEqual(consultas[0].params, ["Mar Azul Saúde", 5.6, 5.6]);
  assert.equal(resultado.id, 8);
});

test("criarConvenio sem valores de repasse grava null nos dois", async (t) => {
  const consultas = mockarQuery(t, [{ id: 9, nome: "Particular", ativo: true }]);

  await criarConvenio({ nome: "Particular" });

  assert.deepEqual(consultas[0].params, ["Particular", null, null]);
});

test("atualizarConvenio altera nome e valores de repasse", async (t) => {
  const consultas = mockarQuery(t, [{ id: 5, nome: "Mar Azul Saúde Novo", ativo: true }]);

  const resultado = await atualizarConvenio(5, { nome: "Mar Azul Saúde Novo", valorRepasseAvaliacao: 6, valorRepasseSessao: 7 });

  assert.match(consultas[0].sql, /SET nome = \$2, valor_repasse_avaliacao = \$3, valor_repasse_sessao = \$4/);
  assert.deepEqual(consultas[0].params, [5, "Mar Azul Saúde Novo", 6, 7, null, null]);
  assert.equal(resultado.nome, "Mar Azul Saúde Novo");
});

test("atualizarConvenio retorna null quando o id não existe", async (t) => {
  mockarQuery(t, []);

  const resultado = await atualizarConvenio(999, { nome: "Nome" });

  assert.equal(resultado, null);
});

test("atualizarConvenio: grava codigoPrestadorNaOperadora e numeroContrato", async (t) => {
  const consultas = mockarQuery(t, [{ id: 5 }]);

  await atualizarConvenio(5, {
    nome: "Mar Azul Saúde",
    valorRepasseAvaliacao: null,
    valorRepasseSessao: null,
    codigoPrestadorNaOperadora: "PRESTADOR123",
    numeroContrato: "CT-001",
  });

  assert.deepEqual(consultas[0].params, [5, "Mar Azul Saúde", null, null, "PRESTADOR123", "CT-001"]);
});

test("definirAtivoConvenio(id, false) desativa", async (t) => {
  const consultas = mockarQuery(t, [{ id: 5, nome: "Mar Azul Saúde", ativo: false }]);

  const resultado = await definirAtivoConvenio(5, false);

  assert.match(consultas[0].sql, /SET ativo = \$2/);
  assert.deepEqual(consultas[0].params, [5, false]);
  assert.equal(resultado.ativo, false);
});

test("definirAtivoConvenio(id, true) reativa", async (t) => {
  const consultas = mockarQuery(t, [{ id: 5, nome: "Mar Azul Saúde", ativo: true }]);

  const resultado = await definirAtivoConvenio(5, true);

  assert.deepEqual(consultas[0].params, [5, true]);
  assert.equal(resultado.ativo, true);
});

test("definirAtivoConvenio retorna null quando o id não existe", async (t) => {
  mockarQuery(t, []);

  const resultado = await definirAtivoConvenio(999, false);

  assert.equal(resultado, null);
});
