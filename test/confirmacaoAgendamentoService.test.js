import { test } from "node:test";
import assert from "node:assert/strict";
import { montarMensagemConfirmacao } from "../src/services/confirmacaoAgendamentoService.js";

test("montarMensagemConfirmacao: monta a mensagem com nome, tipo por extenso, data DD/MM/AAAA e hora sem segundos", () => {
  const mensagem = montarMensagemConfirmacao({
    paciente_nome: "Ana",
    tipo_atendimento: "fisioterapia",
    data: "2026-09-10",
    hora: "08:00:00",
  });

  assert.equal(
    mensagem,
    "Olá, Ana! Sua consulta de Fisioterapia na Clínica Exemplo foi confirmada para 10/09/2026 às 08:00. Até lá!"
  );
});

test("montarMensagemConfirmacao: psicologia usa o nome por extenso certo", () => {
  const mensagem = montarMensagemConfirmacao({
    paciente_nome: "Bruno",
    tipo_atendimento: "psicologia",
    data: "2026-09-11",
    hora: "14:30:00",
  });

  assert.match(mensagem, /consulta de Psicologia/);
});
