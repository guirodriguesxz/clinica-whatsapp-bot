import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import {
  listarAvaliacoesPaciente,
  buscarAvaliacaoDoPaciente,
  criarAvaliacao,
  atualizarAvaliacao,
} from "../src/models/avaliacaoFisioterapeuticaModel.js";

test("listarAvaliacoesPaciente: retorna id e data mapeados pra camelCase", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 3, data_avaliacao: "2026-09-01" }, { id: 1, data_avaliacao: "2026-01-10" }],
  }));

  const resultado = await listarAvaliacoesPaciente(7);

  assert.deepEqual(resultado, [
    { id: 3, dataAvaliacao: "2026-09-01" },
    { id: 1, dataAvaliacao: "2026-01-10" },
  ]);
});

test("buscarAvaliacaoDoPaciente: retorna null quando não encontrado", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await buscarAvaliacaoDoPaciente(99, 7);
  assert.equal(resultado, null);
});

test("buscarAvaliacaoDoPaciente: filtra por paciente_id na query (evita vazar avaliação de outro paciente)", async (t) => {
  let parametrosRecebidos = null;
  t.mock.method(pool, "query", async (_sql, parametros) => {
    parametrosRecebidos = parametros;
    return { rows: [] };
  });

  await buscarAvaliacaoDoPaciente(5, 7);

  assert.deepEqual(parametrosRecebidos, [5, 7]);
});

test("buscarAvaliacaoDoPaciente: mapeia todos os campos pra camelCase", async (t) => {
  const linha = {
    id: 5, paciente_id: 7, data_avaliacao: "2026-09-01",
    esta_gravida: "Não", possui_marcapasso: "Não",
    possui_protese_metalica_implantes: null, possui_doencas_cardiacas: null,
    possui_hipertensao_arterial: null, possui_diabetes: "Sim", possui_epilepsia: null,
    possui_historico_cancer: null, medicamentos_continuos_quais: "Losartana",
    cirurgia_qual: null, cirurgia_quando: null, tempo_ultima_cirurgia: null,
    dor_atual_local: "Lombar", dor_atual_intensidade: "7",
    limitacoes_funcionais_quais: null, fisioterapia_anteriormente: "Não",
    objetivos_tratamento: "Reduzir dor lombar", condutas_propostas: "Fortalecimento",
  };
  t.mock.method(pool, "query", async () => ({ rows: [linha] }));

  const resultado = await buscarAvaliacaoDoPaciente(5, 7);

  assert.equal(resultado.id, 5);
  assert.equal(resultado.pacienteId, 7);
  assert.equal(resultado.dataAvaliacao, "2026-09-01");
  assert.equal(resultado.possuiDiabetes, "Sim");
  assert.equal(resultado.medicamentosContinuosQuais, "Losartana");
  assert.equal(resultado.dorAtualLocal, "Lombar");
  assert.equal(resultado.dorAtualIntensidade, "7");
  assert.equal(resultado.objetivosTratamento, "Reduzir dor lombar");
  assert.equal(resultado.condutasPropostas, "Fortalecimento");
  assert.equal(resultado.possuiProteseMetalicaImplantes, null);
});

test("criarAvaliacao: grava os 21 campos na ordem certa e retorna o id", async (t) => {
  let parametrosRecebidos = null;
  t.mock.method(pool, "query", async (_sql, parametros) => {
    parametrosRecebidos = parametros;
    return { rows: [{ id: 42 }] };
  });

  const id = await criarAvaliacao({
    pacienteId: 7, dataAvaliacao: "2026-09-04",
    estaGravida: "Não", possuiMarcapasso: null, possuiProteseMetalicaImplantes: null,
    possuiDoencasCardiacas: null, possuiHipertensaoArterial: null, possuiDiabetes: "Sim",
    possuiEpilepsia: null, possuiHistoricoCancer: null, medicamentosContinuosQuais: "Losartana",
    cirurgiaQual: null, cirurgiaQuando: null, tempoUltimaCirurgia: null,
    dorAtualLocal: "Lombar", dorAtualIntensidade: "7", limitacoesFuncionaisQuais: null,
    fisioterapiaAnteriormente: "Não", objetivosTratamento: "Reduzir dor lombar",
    condutasPropostas: "Fortalecimento", registradoPor: 2,
  });

  assert.equal(id, 42);
  assert.deepEqual(parametrosRecebidos, [
    7, "2026-09-04", "Não", null, null, null, null, "Sim", null, null, "Losartana",
    null, null, null, "Lombar", "7", null, "Não", "Reduzir dor lombar", "Fortalecimento", 2,
  ]);
});

test("atualizarAvaliacao: grava os 19 campos de conteúdo na ordem certa", async (t) => {
  let parametrosRecebidos = null;
  t.mock.method(pool, "query", async (_sql, parametros) => {
    parametrosRecebidos = parametros;
    return { rows: [] };
  });

  await atualizarAvaliacao(5, {
    dataAvaliacao: "2026-09-05",
    estaGravida: "Não", possuiMarcapasso: null, possuiProteseMetalicaImplantes: null,
    possuiDoencasCardiacas: null, possuiHipertensaoArterial: null, possuiDiabetes: "Sim",
    possuiEpilepsia: null, possuiHistoricoCancer: null, medicamentosContinuosQuais: "Losartana",
    cirurgiaQual: null, cirurgiaQuando: null, tempoUltimaCirurgia: null,
    dorAtualLocal: "Lombar", dorAtualIntensidade: "5", limitacoesFuncionaisQuais: null,
    fisioterapiaAnteriormente: "Não", objetivosTratamento: "Reduzir dor lombar",
    condutasPropostas: "Fortalecimento e alongamento",
  });

  assert.deepEqual(parametrosRecebidos, [
    5, "2026-09-05", "Não", null, null, null, null, "Sim", null, null, "Losartana",
    null, null, null, "Lombar", "5", null, "Não", "Reduzir dor lombar", "Fortalecimento e alongamento",
  ]);
});
