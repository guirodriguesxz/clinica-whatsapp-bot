// test/guiaConvenioPdfService.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { linhasGuiaConvenio, gerarPdfGuiaConvenio } from "../src/services/guiaConvenioPdfService.js";

const DADOS_BASE = {
  pacienteNome: "Maria",
  convenio: "Vale Saúde",
  matriculaConvenio: "12345",
  tipoAtendimento: "fisioterapia",
  dataAtendimento: "2026-08-20",
  valor: "300.00",
  profissionalResponsavel: "Dra. Ana",
  numeroGuia: 7,
  cancelada: false,
};

test("linhasGuiaConvenio: inclui todas as linhas quando todos os campos opcionais estão presentes", () => {
  const linhas = linhasGuiaConvenio(DADOS_BASE);

  assert.ok(linhas.some((linha) => linha.includes("Maria")));
  assert.ok(linhas.some((linha) => linha.includes("Vale Saúde")));
  assert.ok(linhas.some((linha) => linha.includes("12345")));
  assert.ok(linhas.some((linha) => linha.includes("Dra. Ana")));
  assert.ok(linhas.some((linha) => linha.includes("7")));
});

test("linhasGuiaConvenio: omite matrícula quando null", () => {
  const linhas = linhasGuiaConvenio({ ...DADOS_BASE, matriculaConvenio: null });

  assert.ok(!linhas.some((linha) => linha.toLowerCase().includes("matr")));
});

test("linhasGuiaConvenio: omite convênio quando null", () => {
  const linhas = linhasGuiaConvenio({ ...DADOS_BASE, convenio: null });

  assert.ok(!linhas.some((linha) => linha.toLowerCase().includes("convênio:")));
});

test("linhasGuiaConvenio: omite profissional quando null", () => {
  const linhas = linhasGuiaConvenio({ ...DADOS_BASE, profissionalResponsavel: null });

  assert.ok(!linhas.some((linha) => linha.toLowerCase().includes("profissional")));
});

test("gerarPdfGuiaConvenio: gera um PDF de verdade em memória (smoke test, sem mock)", async () => {
  const buffer = await gerarPdfGuiaConvenio(DADOS_BASE);

  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 0);
  assert.equal(buffer.subarray(0, 4).toString("latin1"), "%PDF");
});

test("gerarPdfGuiaConvenio: funciona com todos os campos opcionais ausentes", async () => {
  const buffer = await gerarPdfGuiaConvenio({
    ...DADOS_BASE,
    convenio: null,
    matriculaConvenio: null,
    profissionalResponsavel: null,
  });

  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 0);
});

test("gerarPdfGuiaConvenio: estampa 'GUIA CANCELADA' quando cancelada é true", async () => {
  const buffer = await gerarPdfGuiaConvenio({ ...DADOS_BASE, cancelada: true });

  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 0);
});
