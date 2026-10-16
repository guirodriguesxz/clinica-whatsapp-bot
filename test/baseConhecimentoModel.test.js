import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import {
  buscarNaBaseConhecimento,
  listarBaseConhecimento,
  buscarEntradaBaseConhecimentoPorId,
  atualizarEntradaBaseConhecimento,
  definirAtivoEntradaBaseConhecimento,
} from "../src/models/baseConhecimentoModel.js";

function mockarQuery(t, linhas = []) {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: linhas };
  });
  return consultas;
}

test("buscarNaBaseConhecimento só busca entradas ativas", async (t) => {
  const consultas = mockarQuery(t, [{ id: 1, pergunta: "p", resposta: "r", categoria: "geral" }]);

  await buscarNaBaseConhecimento("qual o horario");

  assert.match(consultas[0].sql, /WHERE ativo = true\s/i);
});

test("buscarNaBaseConhecimento ordena pela quantidade de palavras-chave encontradas e ignora acentos do texto salvo (regressão real: 'kinesio taping' voltava 3 entradas genéricas)", async (t) => {
  const consultas = mockarQuery(t, []);

  await buscarNaBaseConhecimento("Vocês fazem kinesio taping?");

  assert.match(consultas[0].sql, /ORDER BY \(SELECT count\(\*\) FROM unnest\(\$1::text\[\]\)/);
  assert.match(consultas[0].sql, /translate\(lower\(/);
  assert.deepEqual(consultas[0].params[0], ["%fazem%", "%kinesio%", "%taping%"]);
});

test("listarBaseConhecimento por padrão só busca ativos, mais recentes primeiro", async (t) => {
  const consultas = mockarQuery(t, [{ id: 1, pergunta: "p", resposta: "r", ativo: true }]);

  const resultado = await listarBaseConhecimento();

  assert.match(consultas[0].sql, /WHERE ativo = true/i);
  assert.match(consultas[0].sql, /ORDER BY created_at DESC/i);
  assert.equal(resultado.length, 1);
});

test("listarBaseConhecimento({ apenasAtivos: false }) busca todos, sem filtro de ativo", async (t) => {
  const consultas = mockarQuery(t, [
    { id: 1, pergunta: "p1", ativo: true },
    { id: 2, pergunta: "p2", ativo: false },
  ]);

  const resultado = await listarBaseConhecimento({ apenasAtivos: false });

  assert.doesNotMatch(consultas[0].sql, /WHERE ativo/i);
  assert.equal(resultado.length, 2);
});

test("buscarEntradaBaseConhecimentoPorId retorna null quando não existe", async (t) => {
  mockarQuery(t, []);

  const resultado = await buscarEntradaBaseConhecimentoPorId(999);

  assert.equal(resultado, null);
});

test("buscarEntradaBaseConhecimentoPorId consulta pelo id informado", async (t) => {
  const consultas = mockarQuery(t, [{ id: 5, pergunta: "p", resposta: "r", ativo: true }]);

  const resultado = await buscarEntradaBaseConhecimentoPorId(5);

  assert.deepEqual(consultas[0].params, [5]);
  assert.equal(resultado.id, 5);
});

test("atualizarEntradaBaseConhecimento atualiza pergunta/resposta/categoria e updated_at", async (t) => {
  const consultas = mockarQuery(t, [{ id: 5, pergunta: "nova", resposta: "nova resp", categoria: "geral" }]);

  const resultado = await atualizarEntradaBaseConhecimento(5, {
    pergunta: "nova",
    resposta: "nova resp",
    categoria: "geral",
  });

  assert.match(consultas[0].sql, /SET pergunta = \$2, resposta = \$3, categoria = \$4, updated_at = now\(\)/i);
  assert.deepEqual(consultas[0].params, [5, "nova", "nova resp", "geral"]);
  assert.equal(resultado.pergunta, "nova");
});

test("atualizarEntradaBaseConhecimento retorna null quando o id não existe", async (t) => {
  mockarQuery(t, []);

  const resultado = await atualizarEntradaBaseConhecimento(999, {
    pergunta: "x",
    resposta: "y",
    categoria: null,
  });

  assert.equal(resultado, null);
});

test("definirAtivoEntradaBaseConhecimento(id, false) desativa", async (t) => {
  const consultas = mockarQuery(t, [{ id: 5, ativo: false }]);

  const resultado = await definirAtivoEntradaBaseConhecimento(5, false);

  assert.match(consultas[0].sql, /SET ativo = \$2/i);
  assert.deepEqual(consultas[0].params, [5, false]);
  assert.equal(resultado.ativo, false);
});

test("definirAtivoEntradaBaseConhecimento retorna null quando o id não existe", async (t) => {
  mockarQuery(t, []);

  const resultado = await definirAtivoEntradaBaseConhecimento(999, true);

  assert.equal(resultado, null);
});
