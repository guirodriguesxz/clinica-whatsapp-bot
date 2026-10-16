// test/guiaConvenioPdfService.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { linhasCorpoGuiaConvenio, gerarPdfGuiaConvenio } from "../src/services/laudoPdfService.js";

const DADOS_BASE = {
  numeroGuia: 10,
  pacienteNome: "Maria",
  convenio: "Vale Saúde",
  numeroCarteirinha: "123456",
  tipoAtendimento: "fisioterapia",
  data: "2026-08-20",
  valor: "150.00",
  profissionalResponsavel: "Dra. Ana",
  status: "pago",
};

test("linhasCorpoGuiaConvenio: inclui carteirinha e profissional quando presentes", () => {
  const linhas = linhasCorpoGuiaConvenio(DADOS_BASE);

  assert.ok(linhas.some((l) => l.includes("Vale Saúde")));
  assert.ok(linhas.some((l) => l.includes("123456")));
  assert.ok(linhas.some((l) => l.includes("Dra. Ana")));
  assert.ok(linhas.some((l) => l.includes("150.00")));
});

test("linhasCorpoGuiaConvenio: omite carteirinha quando null", () => {
  const linhas = linhasCorpoGuiaConvenio({ ...DADOS_BASE, numeroCarteirinha: null });

  assert.ok(!linhas.some((l) => l.toLowerCase().includes("carteirinha")));
});

test("linhasCorpoGuiaConvenio: omite profissional quando null", () => {
  const linhas = linhasCorpoGuiaConvenio({ ...DADOS_BASE, profissionalResponsavel: null });

  assert.ok(!linhas.some((l) => l.toLowerCase().includes("profissional")));
});

test("linhasCorpoGuiaConvenio: valor number (sem zero à direita) é formatado com 2 casas", () => {
  const linhas = linhasCorpoGuiaConvenio({ ...DADOS_BASE, valor: 150.5 });

  assert.ok(linhas.some((l) => l.includes("150.50")));
});

test("gerarPdfGuiaConvenio: gera um PDF de verdade em memória (smoke test, sem mock)", async () => {
  const buffer = await gerarPdfGuiaConvenio(DADOS_BASE);

  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 0);
  assert.equal(buffer.subarray(0, 4).toString("latin1"), "%PDF");
});

test("gerarPdfGuiaConvenio: também funciona pra pagamento estornado (carimbo de cancelada)", async () => {
  const buffer = await gerarPdfGuiaConvenio({ ...DADOS_BASE, status: "estornado" });

  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 0);
  assert.equal(buffer.subarray(0, 4).toString("latin1"), "%PDF");
});
