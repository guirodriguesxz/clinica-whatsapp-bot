import { test } from "node:test";
import assert from "node:assert/strict";
import { gerarDocxRelatorio } from "../src/services/relatorioFisioterapeuticoDocxService.js";

test("gerarDocxRelatorio: gera um .docx de verdade em memória (smoke test, sem mock)", async () => {
  const buffer = await gerarDocxRelatorio({
    pacienteNome: "Nicolas Eustaquio Nogueira da Cruz",
    dataRelatorio: "2026-09-11",
    diagnosticoMotivo: "Fisioterapia Ortopédica: Fratura 5º dedo mão direita",
    condutaEvolucao: "Ganho de mobilidade e fortalecimento progressivo, sem quadro álgico.",
    consideracoesFinais: "Consolidação parcial, importante continuidade até reavaliação médica.",
    profissionalResponsavel: "Dra. Isabella Silva Reis / Crefito 435050-F",
  });

  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 0);
  // .docx é um arquivo ZIP — assinatura "PK" no início confirma que é um
  // pacote válido, sem precisar abrir/parsear o XML interno pra esse smoke test.
  assert.equal(buffer.subarray(0, 2).toString("latin1"), "PK");
});

test("gerarDocxRelatorio: funciona sem nenhum campo de conteúdo preenchido (rascunho vazio)", async () => {
  const buffer = await gerarDocxRelatorio({
    pacienteNome: "Paciente Ainda Sem Nome",
    dataRelatorio: null,
    diagnosticoMotivo: null,
    condutaEvolucao: null,
    consideracoesFinais: null,
    profissionalResponsavel: null,
  });

  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 0);
});

test("gerarDocxRelatorio: com assinaturaImagem/assinaturaMime, embute a imagem sem quebrar (smoke test)", async () => {
  const pngMinimo = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );

  const buffer = await gerarDocxRelatorio({
    pacienteNome: "Ana",
    dataRelatorio: "2026-09-16",
    diagnosticoMotivo: "Lombalgia",
    condutaEvolucao: "Evoluindo bem",
    consideracoesFinais: null,
    profissionalResponsavel: "Dra. Isabella / Crefito 435050-F",
    assinaturaImagem: pngMinimo,
    assinaturaMime: "image/png",
  });

  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0, 2).toString("latin1"), "PK");
});
