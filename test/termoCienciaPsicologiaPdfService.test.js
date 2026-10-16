import { test } from "node:test";
import assert from "node:assert/strict";
import {
  paragrafosTermoCienciaPsicologia,
  gerarPdfTermoCienciaPsicologia,
} from "../src/services/termoCienciaPsicologiaPdfService.js";

test("paragrafosTermoCienciaPsicologia: as 3 regras, na ordem do papel real", () => {
  const paragrafos = paragrafosTermoCienciaPsicologia();

  assert.equal(paragrafos.length, 3);
  assert.match(paragrafos[0], /antecedência mínima de 7 dias/);
  assert.match(paragrafos[1], /mínimo de 24 horas de antecedência/);
  assert.match(paragrafos[2], /2 faltas consecutivas/);
});

test("gerarPdfTermoCienciaPsicologia: gera um PDF de verdade em memória (smoke test, sem mock)", async () => {
  const buffer = await gerarPdfTermoCienciaPsicologia();

  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 0);
  assert.equal(buffer.subarray(0, 4).toString("latin1"), "%PDF");
});
