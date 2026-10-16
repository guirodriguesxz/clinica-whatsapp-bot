import "./setupEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { TELEFONES_SEM_ATENDIMENTO_AUTOMATICO } from "../src/config/clinica.js";

test("TELEFONES_SEM_ATENDIMENTO_AUTOMATICO inclui o telefone de ATENDENTE_HUMANO_TELEFONE — evita o bot tratar resposta da equipe nesse número como paciente", () => {
  assert.ok(TELEFONES_SEM_ATENDIMENTO_AUTOMATICO.includes(process.env.ATENDENTE_HUMANO_TELEFONE));
});

test("TELEFONES_SEM_ATENDIMENTO_AUTOMATICO continua incluindo os contatos internos fixos", () => {
  assert.ok(TELEFONES_SEM_ATENDIMENTO_AUTOMATICO.includes("5511999990007"));
  assert.ok(TELEFONES_SEM_ATENDIMENTO_AUTOMATICO.includes("5511999990008"));
  assert.ok(TELEFONES_SEM_ATENDIMENTO_AUTOMATICO.includes("5511999990009"));
  assert.ok(TELEFONES_SEM_ATENDIMENTO_AUTOMATICO.includes("5511999990014"));
  assert.ok(TELEFONES_SEM_ATENDIMENTO_AUTOMATICO.includes("5511999990013"));
  assert.ok(TELEFONES_SEM_ATENDIMENTO_AUTOMATICO.includes("5511999990010"));
});
