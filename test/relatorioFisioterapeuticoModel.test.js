import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import {
  listarRelatoriosPaciente,
  buscarRelatorioDoPaciente,
  criarRelatorio,
  atualizarRelatorio,
  excluirRelatorio,
} from "../src/models/relatorioFisioterapeuticoModel.js";

test("listarRelatoriosPaciente: retorna id e data mapeados pra camelCase", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 3, data_relatorio: "2026-09-01" }, { id: 1, data_relatorio: "2026-01-10" }],
  }));

  const resultado = await listarRelatoriosPaciente(7);

  assert.deepEqual(resultado, [
    { id: 3, dataRelatorio: "2026-09-01" },
    { id: 1, dataRelatorio: "2026-01-10" },
  ]);
});

test("buscarRelatorioDoPaciente: retorna null quando não encontrado", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await buscarRelatorioDoPaciente(99, 7);
  assert.equal(resultado, null);
});

test("buscarRelatorioDoPaciente: filtra por paciente_id na query (evita vazar relatório de outro paciente)", async (t) => {
  let parametrosRecebidos = null;
  t.mock.method(pool, "query", async (_sql, parametros) => {
    parametrosRecebidos = parametros;
    return { rows: [] };
  });

  await buscarRelatorioDoPaciente(5, 7);

  assert.deepEqual(parametrosRecebidos, [5, 7]);
});

test("buscarRelatorioDoPaciente: mapeia todas as colunas pra camelCase", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{
      id: 5, paciente_id: 7, data_relatorio: "2026-09-01",
      diagnostico_motivo: "Fratura 5º dedo mão direita",
      conduta_evolucao: "Ganho de mobilidade progressivo",
      consideracoes_finais: "Consolidação parcial, seguir tratamento",
      profissional_responsavel: "Dra. Isabella Silva Reis / Crefito 435050-F",
      fisioterapeuta_id: 3,
    }],
  }));

  const resultado = await buscarRelatorioDoPaciente(5, 7);

  assert.deepEqual(resultado, {
    id: 5, pacienteId: 7, dataRelatorio: "2026-09-01",
    diagnosticoMotivo: "Fratura 5º dedo mão direita",
    condutaEvolucao: "Ganho de mobilidade progressivo",
    consideracoesFinais: "Consolidação parcial, seguir tratamento",
    profissionalResponsavel: "Dra. Isabella Silva Reis / Crefito 435050-F",
    fisioterapeutaId: 3,
  });
});

test("criarRelatorio: retorna o id gerado pelo banco", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ id: 42 }] }));

  const id = await criarRelatorio({
    pacienteId: 7, dataRelatorio: "2026-09-01",
    diagnosticoMotivo: "Fratura", condutaEvolucao: "Evoluindo bem",
    consideracoesFinais: "Seguir tratamento", profissionalResponsavel: "Dra. Isabella",
    fisioterapeutaId: 3, registradoPor: 2,
  });

  assert.equal(id, 42);
});

test("atualizarRelatorio: envia todos os campos, incluindo fisioterapeutaId, na query de update", async (t) => {
  let parametrosRecebidos = null;
  t.mock.method(pool, "query", async (_sql, parametros) => {
    parametrosRecebidos = parametros;
    return { rows: [] };
  });

  await atualizarRelatorio(5, {
    dataRelatorio: "2026-09-02", diagnosticoMotivo: "Fratura",
    condutaEvolucao: "Evoluindo bem", consideracoesFinais: "Seguir tratamento",
    profissionalResponsavel: "Dra. Isabella", fisioterapeutaId: 3,
  });

  assert.deepEqual(parametrosRecebidos, [
    5, "2026-09-02", "Fratura", "Evoluindo bem", "Seguir tratamento", "Dra. Isabella", 3,
  ]);
});

test("excluirRelatorio: filtra por paciente_id e devolve true quando apagou uma linha", async (t) => {
  let parametrosRecebidos = null;
  t.mock.method(pool, "query", async (_sql, parametros) => {
    parametrosRecebidos = parametros;
    return { rowCount: 1 };
  });

  const excluiu = await excluirRelatorio(5, 7);

  assert.deepEqual(parametrosRecebidos, [5, 7]);
  assert.equal(excluiu, true);
});

test("excluirRelatorio: devolve false quando nenhuma linha bate (id de outro paciente, por exemplo)", async (t) => {
  t.mock.method(pool, "query", async () => ({ rowCount: 0 }));

  const excluiu = await excluirRelatorio(5, 999);

  assert.equal(excluiu, false);
});
