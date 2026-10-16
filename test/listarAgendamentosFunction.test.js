import { test } from "node:test";
import assert from "node:assert/strict";
import { listarAgendamentos, MENSAGEM_NADA_ENCONTRADO } from "../src/functions/listarAgendamentos.js";

const CONTEXTO = { pacienteId: 1, telefone: "5511999990015" };

const DO_BOT = [{ id: 7, data: "2026-09-25", hora: "10:00:00", tipo_atendimento: "fisioterapia" }];
const IMPORTADO = [
  { data: "2026-09-24", hora: "16:00:00", tipo_atendimento: "fisioterapia", atendente: "Carlos" },
];

test("listarAgendamentos: encontra consulta que só existe no sistema interno (regressão real: paciente ouviu que não tinha agendamento 40 minutos antes da própria sessão)", async () => {
  const resultado = await listarAgendamentos(null, CONTEXTO, {
    buscarDoBot: async () => [],
    buscarImportados: async () => IMPORTADO,
  });

  assert.deepEqual(resultado.agendamentos, []);
  assert.equal(resultado.agendamentos_do_sistema_interno.length, 1);
  assert.equal(resultado.agendamentos_do_sistema_interno[0].data, "2026-09-24");
  assert.equal(resultado.mensagem, undefined);
});

test("listarAgendamentos: não devolve id pros agendamentos do sistema interno (evita o modelo mandá-los pra cancelar_agendamento)", async () => {
  const resultado = await listarAgendamentos(null, CONTEXTO, {
    buscarDoBot: async () => [],
    buscarImportados: async () => IMPORTADO,
  });

  assert.equal("agendamento_id" in resultado.agendamentos_do_sistema_interno[0], false);
  assert.match(resultado.observacao, /NÃO podem ser cancelados nem remarcados por você/);
});

test("listarAgendamentos: junta as duas origens quando o paciente tem das duas", async () => {
  const resultado = await listarAgendamentos(null, CONTEXTO, {
    buscarDoBot: async () => DO_BOT,
    buscarImportados: async () => IMPORTADO,
  });

  assert.equal(resultado.agendamentos.length, 1);
  assert.equal(resultado.agendamentos[0].agendamento_id, 7);
  assert.equal(resultado.agendamentos_do_sistema_interno.length, 1);
});

test("listarAgendamentos: só agendamento do bot mantém a resposta anterior, sem ruído do sistema interno", async () => {
  const resultado = await listarAgendamentos(null, CONTEXTO, {
    buscarDoBot: async () => DO_BOT,
    buscarImportados: async () => [],
  });

  assert.deepEqual(resultado, {
    agendamentos: [{ agendamento_id: 7, data: "2026-09-25", hora: "10:00:00", tipo_atendimento: "fisioterapia" }],
  });
});

test("listarAgendamentos: sem nada em nenhuma das origens, instrui a não negar a consulta ao paciente", async () => {
  const resultado = await listarAgendamentos(null, CONTEXTO, {
    buscarDoBot: async () => [],
    buscarImportados: async () => [],
  });

  assert.deepEqual(resultado, {
    agendamentos: [],
    mensagem: MENSAGEM_NADA_ENCONTRADO,
  });
  assert.match(resultado.mensagem, /NÃO significa que o paciente não tem consulta/);
});

test("listarAgendamentos: sem telefone no contexto, não quebra nem consulta os importados", async () => {
  let consultou = false;
  const resultado = await listarAgendamentos(null, { pacienteId: 1 }, {
    buscarDoBot: async () => [],
    buscarImportados: async () => ((consultou = true), IMPORTADO),
  });

  assert.equal(consultou, false);
  assert.deepEqual(resultado.agendamentos, []);
});
