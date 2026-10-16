// test/laudoPdfService.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { linhasCabecalhoLaudo, gerarPdfLaudo } from "../src/services/laudoPdfService.js";

test("linhasCabecalhoLaudo: inclui a linha do profissional quando presente", () => {
  const linhas = linhasCabecalhoLaudo({
    pacienteNome: "Maria",
    data: "2026-08-20",
    profissionalResponsavel: "Dra. Ana",
  });

  assert.ok(linhas.some((linha) => linha.includes("Dra. Ana")));
  assert.ok(linhas.some((linha) => linha.startsWith("Paciente: Maria")));
  assert.ok(linhas.some((linha) => linha.includes("2026-08-20")));
});

test("linhasCabecalhoLaudo: omite a linha do profissional quando null", () => {
  const linhas = linhasCabecalhoLaudo({
    pacienteNome: "Maria",
    data: "2026-08-20",
    profissionalResponsavel: null,
  });

  assert.ok(!linhas.some((linha) => linha.toLowerCase().includes("profissional")));
});

test("linhasCabecalhoLaudo: omite a linha do profissional quando undefined", () => {
  const linhas = linhasCabecalhoLaudo({
    pacienteNome: "Maria",
    data: "2026-08-20",
  });

  assert.ok(!linhas.some((linha) => linha.toLowerCase().includes("profissional")));
});

test("gerarPdfLaudo: gera um PDF de verdade em memória (smoke test, sem mock)", async () => {
  const buffer = await gerarPdfLaudo({
    pacienteNome: "Maria",
    data: "2026-08-20",
    profissionalResponsavel: "Dra. Ana",
    observacaoSessao: "Paciente evoluiu bem, sem queixas.",
  });

  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 0);
  assert.equal(buffer.subarray(0, 4).toString("latin1"), "%PDF");
});

test("gerarPdfLaudo: funciona sem profissionalResponsavel (campo opcional)", async () => {
  const buffer = await gerarPdfLaudo({
    pacienteNome: "João",
    data: "2026-08-20",
    profissionalResponsavel: null,
    observacaoSessao: "Sessão concluída sem intercorrências.",
  });

  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 0);
});
