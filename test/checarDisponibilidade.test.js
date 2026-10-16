import "./setupEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { checarDisponibilidade } from "../src/functions/checarDisponibilidade.js";

// A amostra devolvida pro paciente pega um slot sim, outro não — por isso
// costuma omitir os :30 mesmo quando estão livres (ver
// amostrarMetadeDeCadaPeriodo em calendarService.js).
const TODOS_DO_DIA = [
  { data: "2026-09-17", hora: "13:00" },
  { data: "2026-09-17", hora: "13:30" },
  { data: "2026-09-17", hora: "14:00" },
  { data: "2026-09-17", hora: "14:30" },
];

test("checarDisponibilidade com hora específica: confirma que o horário está livre mesmo fora da amostra (regressão real: bot disse que 13h30 não tinha vaga e empurrou o paciente pras 14h)", async () => {
  let amostrarRecebido = null;
  const resultado = await checarDisponibilidade(
    { data: "2026-09-17", hora: "13:30", tipo_atendimento: "fisioterapia" },
    null,
    {
      listarHorarios: async ({ amostrar }) => {
        amostrarRecebido = amostrar;
        return TODOS_DO_DIA;
      },
    }
  );

  assert.equal(amostrarRecebido, false);

  assert.equal(resultado.disponivel, true);
  assert.equal(resultado.horario_solicitado, "13:30");
});

test("checarDisponibilidade com hora específica ocupada: devolve indisponível e os horários livres do dia", async () => {
  const resultado = await checarDisponibilidade(
    { data: "2026-09-17", hora: "16:00", tipo_atendimento: "fisioterapia" },
    null,
    { listarHorarios: async () => TODOS_DO_DIA }
  );

  assert.equal(resultado.disponivel, false);
  assert.equal(resultado.horario_solicitado, "16:00");
  assert.deepEqual(resultado.horarios, TODOS_DO_DIA);
});

test("checarDisponibilidade: hora em formato inválido é recusada", async () => {
  const resultado = await checarDisponibilidade({
    data: "2026-09-17",
    hora: "13h30",
    tipo_atendimento: "fisioterapia",
  });

  assert.equal(resultado.disponivel, false);
  assert.match(resultado.erro, /Formato de hora inválido/);
});

test("checarDisponibilidade: hora sem data é recusada (não dá pra saber de que dia)", async () => {
  const resultado = await checarDisponibilidade({ hora: "13:30", tipo_atendimento: "fisioterapia" });

  assert.equal(resultado.disponivel, false);
  assert.match(resultado.erro, /Informe também a data/);
});

test("checarDisponibilidade sem hora: mantém o comportamento de amostra", async () => {
  let amostrarRecebido = "nao-chamado";
  const resultado = await checarDisponibilidade(
    { data: "2026-09-17", tipo_atendimento: "fisioterapia" },
    null,
    {
      listarHorarios: async ({ amostrar }) => {
        amostrarRecebido = amostrar;
        return [{ data: "2026-09-17", hora: "13:00" }];
      },
    }
  );

  assert.equal(amostrarRecebido, undefined);

  assert.equal(resultado.disponivel, true);
  assert.equal(resultado.horarios.length, 1);
});
