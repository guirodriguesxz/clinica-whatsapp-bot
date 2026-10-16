import { test } from "node:test";
import assert from "node:assert/strict";
import { linhasAnamnesePdf, linhasPlanoTerapeuticoPdf, gerarPdfAvaliacao } from "../src/services/avaliacaoFisioterapeuticaPdfService.js";

const AVALIACAO_COMPLETA = {
  pacienteNome: "Maria", dataAvaliacao: "2026-09-01",
  estaGravida: "Não", possuiMarcapasso: "Não", possuiProteseMetalicaImplantes: "Não",
  possuiDoencasCardiacas: "Não", possuiHipertensaoArterial: "Sim", possuiDiabetes: "Não",
  possuiEpilepsia: "Não", possuiHistoricoCancer: "Não", medicamentosContinuosQuais: "Losartana",
  cirurgiaQual: null, cirurgiaQuando: null, tempoUltimaCirurgia: null,
  dorAtualLocal: "Lombar", dorAtualIntensidade: "7", limitacoesFuncionaisQuais: null,
  fisioterapiaAnteriormente: "Não", objetivosTratamento: "Reduzir dor lombar",
  condutasPropostas: "Fortalecimento e alongamento",
};

test("linhasAnamnesePdf: inclui só as perguntas com resposta preenchida", () => {
  const linhas = linhasAnamnesePdf(AVALIACAO_COMPLETA);

  assert.ok(linhas.some((l) => l.includes("Possui hipertensão arterial?") && l.includes("Sim")));
  assert.ok(linhas.some((l) => l.includes("Sente dor atualmente? Local") && l.includes("Lombar")));
  assert.ok(!linhas.some((l) => l.toLowerCase().includes("cirurgia")));
});

test("linhasAnamnesePdf: sem nenhuma resposta preenchida, devolve lista vazia", () => {
  const linhas = linhasAnamnesePdf({});
  assert.deepEqual(linhas, []);
});

test("linhasPlanoTerapeuticoPdf: sem nenhum campo preenchido, devolve lista vazia", () => {
  const linhas = linhasPlanoTerapeuticoPdf({});
  assert.deepEqual(linhas, []);
});

test("linhasPlanoTerapeuticoPdf: só objetivosTratamento preenchido, devolve só essa linha", () => {
  const linhas = linhasPlanoTerapeuticoPdf({ objetivosTratamento: "Reduzir dor lombar" });
  assert.deepEqual(linhas, ["Objetivos do tratamento: Reduzir dor lombar"]);
});

test("linhasPlanoTerapeuticoPdf: com os dois campos preenchidos, devolve as duas linhas formatadas", () => {
  const linhas = linhasPlanoTerapeuticoPdf({
    objetivosTratamento: "Reduzir dor lombar",
    condutasPropostas: "Fortalecimento e alongamento",
  });
  assert.deepEqual(linhas, [
    "Objetivos do tratamento: Reduzir dor lombar",
    "Condutas propostas: Fortalecimento e alongamento",
  ]);
});

test("gerarPdfAvaliacao: gera um PDF de verdade em memória (smoke test, sem mock)", async () => {
  const buffer = await gerarPdfAvaliacao(AVALIACAO_COMPLETA);

  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 0);
  assert.equal(buffer.subarray(0, 4).toString("latin1"), "%PDF");
});

test("gerarPdfAvaliacao: funciona com todos os campos de conteúdo ausentes", async () => {
  const buffer = await gerarPdfAvaliacao({ pacienteNome: "João", dataAvaliacao: "2026-09-01" });

  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 0);
});
