import { test } from "node:test";
import assert from "node:assert/strict";
import { montarMensagemControleSessoes } from "../src/services/controleSessoesMensagemService.js";

const PACIENTE = { nome: "Ana Silva" };

function linhasEmBranco(quantidade) {
  return Array.from({ length: quantidade }, (_, i) => ({ numero: i + 1, data: null, hora: null, status: null }));
}

test("montarMensagemControleSessoes: sem sessões, avisa que nenhuma foi registrada", () => {
  const mensagem = montarMensagemControleSessoes({
    paciente: PACIENTE,
    sessoes: linhasEmBranco(10),
    dataAvaliacao: null,
  });

  assert.match(mensagem, /Nenhuma sessão registrada ainda\./);
  assert.match(mensagem, /Avaliação: —/);
});

test("montarMensagemControleSessoes: lista só as sessões preenchidas, ignorando as linhas em branco", () => {
  const sessoes = [
    { numero: 1, data: "2026-08-30", hora: "09:00:00", status: "compareceu" },
    { numero: 2, data: "2026-09-06", hora: "09:00:00", status: "confirmado" },
    ...linhasEmBranco(8).map((s, i) => ({ ...s, numero: i + 3 })),
  ];

  const mensagem = montarMensagemControleSessoes({ paciente: PACIENTE, sessoes, dataAvaliacao: "2026-08-01" });
  const linhas = mensagem.split("\n");

  assert.match(mensagem, /Paciente: Ana Silva/);
  assert.match(mensagem, /Avaliação: 01\/08\/2026/);
  assert.ok(linhas.includes("1. 30/08/2026 09:00 — compareceu"));
  assert.ok(linhas.includes("2. 06/09/2026 09:00 — agendado"), "status 'confirmado' deve virar 'agendado' no texto");
  assert.equal(linhas.filter((l) => /^\d+\./.test(l)).length, 2, "não deve listar as linhas em branco");
});

test("montarMensagemControleSessoes: mantém status que não precisam de tradução (ex: faltou)", () => {
  const sessoes = [{ numero: 1, data: "2026-08-30", hora: "09:00:00", status: "faltou" }];
  const mensagem = montarMensagemControleSessoes({ paciente: PACIENTE, sessoes, dataAvaliacao: null });

  assert.match(mensagem, /— faltou/);
});
