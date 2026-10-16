// test/tissLoteModel.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import {
  buscarGuiasConvenioPeriodo,
  classificarGuias,
  motivosBloqueioLote,
} from "../src/models/tissLoteModel.js";

test("buscarGuiasConvenioPeriodo: filtra por convênio, período, forma convenio e exclui estornados", async (t) => {
  let parametrosRecebidos = null;
  let sqlRecebido = "";
  t.mock.method(pool, "query", async (sql, parametros) => {
    sqlRecebido = sql;
    parametrosRecebidos = parametros;
    return { rows: [] };
  });

  await buscarGuiasConvenioPeriodo({ convenioId: 5, inicio: "2026-09-01", fim: "2026-09-30" });

  assert.deepEqual(parametrosRecebidos, [5, "2026-09-01", "2026-09-30"]);
  assert.match(sqlRecebido, /forma_pagamento = 'convenio'/);
  assert.match(sqlRecebido, /estorno\.id IS NULL/);
  assert.match(sqlRecebido, /p\.sexo, p\.cns/);
});

test("classificarGuias: guia sem matrícula de convênio é incompleta", () => {
  const { prontas, incompletas } = classificarGuias([
    { pagamento_id: 1, matricula_convenio: null, codigo_tuss: "10101012" },
  ]);
  assert.equal(prontas.length, 0);
  assert.equal(incompletas[0].motivo, "paciente_sem_matricula");
});

test("classificarGuias: guia sem código TUSS é incompleta", () => {
  const { prontas, incompletas } = classificarGuias([
    { pagamento_id: 1, matricula_convenio: "MAT123", codigo_tuss: null },
  ]);
  assert.equal(prontas.length, 0);
  assert.equal(incompletas[0].motivo, "tuss_nao_cadastrado");
});

test("classificarGuias: guia com matrícula e TUSS é pronta", () => {
  const linha = { pagamento_id: 1, matricula_convenio: "MAT123", codigo_tuss: "10101012" };
  const { prontas, incompletas } = classificarGuias([linha]);
  assert.deepEqual(prontas, [linha]);
  assert.equal(incompletas.length, 0);
});

test("motivosBloqueioLote: sem dados do prestador nem contrato do convênio, lista os dois motivos", () => {
  const motivos = motivosBloqueioLote({
    dadosPrestador: { cnes: null, cnpj: null },
    convenio: { codigo_prestador_na_operadora: null, numero_contrato: null },
  });
  assert.ok(motivos.includes("dados_prestador_incompletos"));
  assert.ok(motivos.includes("codigo_prestador_na_operadora_ausente"));
  assert.ok(motivos.includes("numero_contrato_ausente"));
});

test("motivosBloqueioLote: tudo preenchido, lista vazia", () => {
  const motivos = motivosBloqueioLote({
    dadosPrestador: { cnes: "123456", cnpj: null },
    convenio: { codigo_prestador_na_operadora: "PRESTADOR123", numero_contrato: "CT-001" },
  });
  assert.deepEqual(motivos, []);
});
