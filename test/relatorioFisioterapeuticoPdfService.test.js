import { test } from "node:test";
import assert from "node:assert/strict";
import {
  paragrafosRelatorioPdf,
  gerarPdfRelatorio,
  LINHAS_ESPECIALIDADES,
  REGISTRO_CLINICA,
} from "../src/services/relatorioFisioterapeuticoPdfService.js";

test("LINHAS_ESPECIALIDADES: cabeçalho do papel timbrado, 4 linhas na ordem certa", () => {
  assert.deepEqual(LINHAS_ESPECIALIDADES, [
    "• Fisioterapia Ortopédica • Neurológica",
    "• Reumatológica • Respiratória • Acupuntura",
    "• Estética (Drenagem linfática)",
    "• Psicologia • Fonoaudiologia",
  ]);
});

test("REGISTRO_CLINICA: registro que aparece embaixo da logo no papel timbrado", () => {
  assert.equal(REGISTRO_CLINICA, "DRF 10094-SP");
});

test("paragrafosRelatorioPdf: inclui só os parágrafos preenchidos, na ordem diagnóstico → conduta → considerações", () => {
  const paragrafos = paragrafosRelatorioPdf({
    diagnosticoMotivo: "Fratura 5º dedo mão direita",
    condutaEvolucao: null,
    consideracoesFinais: "Seguir tratamento até reavaliação médica",
  });

  assert.deepEqual(paragrafos, [
    "Fratura 5º dedo mão direita",
    "Seguir tratamento até reavaliação médica",
  ]);
});

test("paragrafosRelatorioPdf: sem nenhum campo preenchido, devolve lista vazia", () => {
  assert.deepEqual(paragrafosRelatorioPdf({}), []);
});

test("gerarPdfRelatorio: gera um PDF de verdade em memória (smoke test, sem mock)", async () => {
  const buffer = await gerarPdfRelatorio({
    pacienteNome: "Nicolas Eustaquio Nogueira da Cruz",
    dataRelatorio: "2026-09-11",
    diagnosticoMotivo: "Fisioterapia Ortopédica: Fratura 5º dedo mão direita",
    condutaEvolucao: "Ganho de mobilidade e fortalecimento progressivo, sem quadro álgico.",
    consideracoesFinais: "Consolidação parcial, importante continuidade até reavaliação médica.",
    profissionalResponsavel: "Dra. Isabella Silva Reis / Crefito 435050-F",
  });

  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 0);
  assert.equal(buffer.subarray(0, 4).toString("latin1"), "%PDF");
});

test("gerarPdfRelatorio: funciona sem profissionalResponsavel (campo opcional)", async () => {
  const buffer = await gerarPdfRelatorio({
    pacienteNome: "João",
    dataRelatorio: "2026-09-11",
    diagnosticoMotivo: "Lombalgia",
    condutaEvolucao: "Evoluindo bem",
    consideracoesFinais: null,
    profissionalResponsavel: null,
  });

  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 0);
});

test("gerarPdfRelatorio: com assinaturaImagem, embute a imagem sem quebrar (smoke test)", async () => {
  // PNG 1x1 transparente válido — só precisa ser um PNG de verdade pro
  // pdfkit conseguir decodificar, o conteúdo visual não importa aqui.
  const pngMinimo = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );

  const buffer = await gerarPdfRelatorio({
    pacienteNome: "Ana",
    dataRelatorio: "2026-09-16",
    diagnosticoMotivo: "Lombalgia",
    condutaEvolucao: "Evoluindo bem",
    consideracoesFinais: null,
    profissionalResponsavel: "Dra. Isabella / Crefito 435050-F",
    assinaturaImagem: pngMinimo,
  });

  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0, 4).toString("latin1"), "%PDF");
});

test("gerarPdfRelatorio: com assinaturaImagem corrompida/inválida, cai no comportamento de linha em branco em vez de rejeitar (defense-in-depth)", async () => {
  const buffer = await gerarPdfRelatorio({
    pacienteNome: "Ana",
    dataRelatorio: "2026-09-16",
    diagnosticoMotivo: "Lombalgia",
    condutaEvolucao: "Evoluindo bem",
    consideracoesFinais: null,
    profissionalResponsavel: "Dra. Isabella / Crefito 435050-F",
    assinaturaImagem: Buffer.from("not a real image"),
  });

  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0, 4).toString("latin1"), "%PDF");
});
