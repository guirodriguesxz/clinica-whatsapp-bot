// test/criarAgendamentoDuplicado.test.js
//
// Cobre o caso real que motivou essa checagem: paciente pediu pra remarcar
// e o bot criou uma consulta nova sem checar se ele já tinha uma confirmada
// naquele dia (ver criarAgendamento.js). Não cobre o restante do fluxo
// (criação de evento/inserção no banco), que já tem cobertura indireta via
// os outros testes de criarAgendamento.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarAgendamento } from "../src/functions/criarAgendamento.js";

const PACIENTE = { id: 7, nome: "Fernanda", convenio: "Particular" };

const DEPS_BASE = {
  encontrarPaciente: async () => PACIENTE,
  atualizarPaciente: async () => {},
  validarDisponibilidade: async () => {},
  inserirNoBanco: async () => ({ id: 99 }),
  notificarRecepcao: async () => {},
};

function argsValidos(extra = {}) {
  return {
    nome_paciente: "Fernanda",
    data: "2026-09-11",
    hora: "17:00",
    tipo_atendimento: "fisioterapia",
    convenio: "Particular",
    ...extra,
  };
}

test("criarAgendamento: paciente já tem consulta confirmada (bot) nessa data — não cria, avisa e não valida disponibilidade/grava", async () => {
  let chamouValidarDisponibilidade = false;
  const resultado = await criarAgendamento(
    argsValidos(),
    { telefone: "5511999990004" },
    {
      ...DEPS_BASE,
      buscarDuplicadoBot: async (pacienteId, data) => {
        assert.equal(pacienteId, 7);
        assert.equal(data, "2026-09-11");
        return { hora: "08:00:00", tipo_atendimento: "fisioterapia" };
      },
      buscarDuplicadoImportado: async () => null,
      validarDisponibilidade: async () => {
        chamouValidarDisponibilidade = true;
      },
    }
  );

  assert.equal(resultado.sucesso, false);
  assert.match(resultado.motivo, /já tem uma consulta confirmada/);
  assert.match(resultado.motivo, /08:00/);
  assert.match(resultado.motivo, /confirmou_consulta_duplicada=true/);
  assert.equal(chamouValidarDisponibilidade, false);
});

test("criarAgendamento: paciente já tem consulta confirmada IMPORTADA (sistema antigo) nessa data — avisa igual", async () => {
  const resultado = await criarAgendamento(
    argsValidos(),
    { telefone: "5511999990004" },
    {
      ...DEPS_BASE,
      buscarDuplicadoBot: async () => null,
      buscarDuplicadoImportado: async () => ({ hora: "09:00:00", tipo_atendimento: "psicologia" }),
    }
  );

  assert.equal(resultado.sucesso, false);
  assert.match(resultado.motivo, /já tem uma consulta confirmada/);
  assert.match(resultado.motivo, /09:00/);
});

test("criarAgendamento: sem consulta existente nessa data, cria normalmente", async () => {
  const resultado = await criarAgendamento(
    argsValidos(),
    { telefone: "5511999990004" },
    {
      ...DEPS_BASE,
      buscarDuplicadoBot: async () => null,
      buscarDuplicadoImportado: async () => null,
    }
  );

  assert.equal(resultado.sucesso, true);
});

test("criarAgendamento: confirmou_consulta_duplicada=true pula a checagem e cria mesmo com consulta existente", async () => {
  let chamouBuscarDuplicado = false;
  const resultado = await criarAgendamento(
    argsValidos({ confirmou_consulta_duplicada: true }),
    { telefone: "5511999990004" },
    {
      ...DEPS_BASE,
      buscarDuplicadoBot: async () => {
        chamouBuscarDuplicado = true;
        return { hora: "08:00:00", tipo_atendimento: "fisioterapia" };
      },
      buscarDuplicadoImportado: async () => null,
    }
  );

  assert.equal(resultado.sucesso, true);
  assert.equal(chamouBuscarDuplicado, false, "nem precisa checar de novo — o paciente já confirmou");
});
