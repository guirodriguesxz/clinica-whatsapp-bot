import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import {
  listarFisioterapeutas,
  buscarFisioterapeutaPorId,
  buscarAssinaturaFisioterapeuta,
  criarFisioterapeuta,
  atualizarFisioterapeuta,
  atualizarAssinaturaFisioterapeuta,
  definirAtivoFisioterapeuta,
} from "../src/models/fisioterapeutaModel.js";

test("listarFisioterapeutas por padrão só busca ativos e mapeia temAssinatura", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    assert.match(sql, /WHERE ativo = true/i);
    return {
      rows: [{ id: 1, nome: "Ana", crefito: "1234-F", ativo: true, created_at: "2026-09-01", tem_assinatura: true }],
    };
  });

  const resultado = await listarFisioterapeutas();

  assert.deepEqual(resultado, [
    { id: 1, nome: "Ana", crefito: "1234-F", ativo: true, createdAt: "2026-09-01", temAssinatura: true },
  ]);
});

test("listarFisioterapeutas({ apenasAtivos: false }) busca todos", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    assert.doesNotMatch(sql, /WHERE ativo = true/i);
    return { rows: [] };
  });

  await listarFisioterapeutas({ apenasAtivos: false });
});

test("buscarFisioterapeutaPorId: retorna null quando não encontrado", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await buscarFisioterapeutaPorId(99);
  assert.equal(resultado, null);
});

test("buscarFisioterapeutaPorId: mapeia temAssinatura=false quando não há imagem", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 5, nome: "Bia", crefito: null, ativo: true, created_at: "2026-09-01", tem_assinatura: false }],
  }));

  const resultado = await buscarFisioterapeutaPorId(5);
  assert.equal(resultado.temAssinatura, false);
  assert.equal(resultado.crefito, null);
});

test("buscarAssinaturaFisioterapeuta: retorna null quando não há linha", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await buscarAssinaturaFisioterapeuta(99);
  assert.equal(resultado, null);
});

test("buscarAssinaturaFisioterapeuta: retorna null quando a coluna assinatura_imagem está vazia", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ assinatura_imagem: null, assinatura_mime: null }] }));

  const resultado = await buscarAssinaturaFisioterapeuta(5);
  assert.equal(resultado, null);
});

test("buscarAssinaturaFisioterapeuta: filtra por ativo=true na query", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    assert.match(sql, /AND ativo = true/i);
    return { rows: [] };
  });

  await buscarAssinaturaFisioterapeuta(5);
});

test("buscarAssinaturaFisioterapeuta: retorna a imagem e o mime quando presentes", async (t) => {
  const bufferFalso = Buffer.from("imagem-fake");
  t.mock.method(pool, "query", async () => ({
    rows: [{ assinatura_imagem: bufferFalso, assinatura_mime: "image/png" }],
  }));

  const resultado = await buscarAssinaturaFisioterapeuta(5);
  assert.deepEqual(resultado, { assinaturaImagem: bufferFalso, assinaturaMime: "image/png" });
});

test("criarFisioterapeuta: envia nome, crefito e assinatura na query e mapeia o retorno", async (t) => {
  let parametrosRecebidos = null;
  t.mock.method(pool, "query", async (_sql, parametros) => {
    parametrosRecebidos = parametros;
    return {
      rows: [{ id: 10, nome: "Carla", crefito: "5555-F", ativo: true, created_at: "2026-09-16", tem_assinatura: true }],
    };
  });

  const bufferFalso = Buffer.from("assinatura");
  const resultado = await criarFisioterapeuta({
    nome: "Carla", crefito: "5555-F", assinaturaImagem: bufferFalso, assinaturaMime: "image/png",
  });

  assert.deepEqual(parametrosRecebidos, ["Carla", "5555-F", bufferFalso, "image/png"]);
  assert.equal(resultado.id, 10);
  assert.equal(resultado.temAssinatura, true);
});

test("criarFisioterapeuta: funciona sem assinatura (campos opcionais)", async (t) => {
  let parametrosRecebidos = null;
  t.mock.method(pool, "query", async (_sql, parametros) => {
    parametrosRecebidos = parametros;
    return {
      rows: [{ id: 11, nome: "Duda", crefito: null, ativo: true, created_at: "2026-09-16", tem_assinatura: false }],
    };
  });

  await criarFisioterapeuta({ nome: "Duda", crefito: null });

  assert.deepEqual(parametrosRecebidos, ["Duda", null, null, null]);
});

test("atualizarFisioterapeuta: atualiza só nome e crefito, sem mexer na assinatura", async (t) => {
  let sqlRecebido = null;
  let parametrosRecebidos = null;
  t.mock.method(pool, "query", async (sql, parametros) => {
    sqlRecebido = sql;
    parametrosRecebidos = parametros;
    return {
      rows: [{ id: 5, nome: "Ana Corrigida", crefito: "9999-F", ativo: true, created_at: "2026-09-01", tem_assinatura: true }],
    };
  });

  const resultado = await atualizarFisioterapeuta(5, { nome: "Ana Corrigida", crefito: "9999-F" });

  assert.doesNotMatch(sqlRecebido, /SET\s+assinatura/i);
  assert.deepEqual(parametrosRecebidos, [5, "Ana Corrigida", "9999-F"]);
  assert.equal(resultado.temAssinatura, true);
  assert.deepEqual(resultado, {
    id: 5,
    nome: "Ana Corrigida",
    crefito: "9999-F",
    ativo: true,
    createdAt: "2026-09-01",
    temAssinatura: true,
  });
});

test("atualizarAssinaturaFisioterapeuta: envia id, imagem e mime na query", async (t) => {
  let parametrosRecebidos = null;
  t.mock.method(pool, "query", async (_sql, parametros) => {
    parametrosRecebidos = parametros;
    return { rows: [] };
  });

  const bufferFalso = Buffer.from("nova-assinatura");
  await atualizarAssinaturaFisioterapeuta(5, { assinaturaImagem: bufferFalso, assinaturaMime: "image/jpeg" });

  assert.deepEqual(parametrosRecebidos, [5, bufferFalso, "image/jpeg"]);
});

test("definirAtivoFisioterapeuta: envia id e ativo, retorna null se não encontrado", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await definirAtivoFisioterapeuta(99, false);
  assert.equal(resultado, null);
});
