import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deveEnviarLembreteVespera,
  telefonesPermitidosParaLembrete,
  cronLembreteTarde,
  montarMensagemLembrete,
  deveEnviarLembreteTarde,
  montarMensagemLembreteTarde,
} from "../src/services/lembreteService.js";
import dayjs from "../src/utils/dayjs.js";
import { CLINICA } from "../src/config/clinica.js";

function agoraEm(dataHora) {
  return dayjs.tz(dataHora, CLINICA.timezone);
}

test("deveEnviarLembreteVespera: consulta é amanhã e já passou das 18h — envia", () => {
  const agendamento = { data: "2026-09-10", hora: "09:00:00" };
  const agora = agoraEm("2026-09-09T18:00:00");

  assert.equal(deveEnviarLembreteVespera(agendamento, agora), true);
});

test("deveEnviarLembreteVespera: consulta é amanhã mas ainda não passou das 18h — não envia", () => {
  const agendamento = { data: "2026-09-10", hora: "09:00:00" };
  const agora = agoraEm("2026-09-09T17:59:00");

  assert.equal(deveEnviarLembreteVespera(agendamento, agora), false);
});

test("deveEnviarLembreteVespera: consulta é hoje (mesmo dia, sem véspera possível) — não envia mesmo depois das 18h", () => {
  const agendamento = { data: "2026-09-09", hora: "20:00:00" };
  const agora = agoraEm("2026-09-09T19:00:00");

  assert.equal(deveEnviarLembreteVespera(agendamento, agora), false);
});

test("deveEnviarLembreteVespera: consulta é depois de amanhã — não envia ainda", () => {
  const agendamento = { data: "2026-09-11", hora: "09:00:00" };
  const agora = agoraEm("2026-09-09T19:00:00");

  assert.equal(deveEnviarLembreteVespera(agendamento, agora), false);
});

test("deveEnviarLembreteVespera: respeita hora configurada via LEMBRETE_CONSULTA_HORA_VESPERA", (t) => {
  t.after(() => delete process.env.LEMBRETE_CONSULTA_HORA_VESPERA);
  process.env.LEMBRETE_CONSULTA_HORA_VESPERA = "20";

  const agendamento = { data: "2026-09-10", hora: "09:00:00" };

  assert.equal(deveEnviarLembreteVespera(agendamento, agoraEm("2026-09-09T19:00:00")), false);
  assert.equal(deveEnviarLembreteVespera(agendamento, agoraEm("2026-09-09T20:00:00")), true);
});

test("montarMensagemLembrete: menciona 'amanhã', nome, tipo e hora sem segundos", () => {
  const mensagem = montarMensagemLembrete({
    paciente_nome: "Ana",
    tipo_atendimento: "fisioterapia",
    hora: "08:00:00",
  });

  assert.match(mensagem, /Ana/);
  assert.match(mensagem, /Fisioterapia/);
  assert.match(mensagem, /amanhã às 08:00/);
});

test("deveEnviarLembreteTarde: consulta é hoje à tarde e já passou das 12h — envia", () => {
  const agendamento = { data: "2026-09-09", hora: "14:00:00" };
  const agora = agoraEm("2026-09-09T12:00:00");

  assert.equal(deveEnviarLembreteTarde(agendamento, agora), true);
});

test("deveEnviarLembreteTarde: consulta é hoje mas ainda não passou das 12h — não envia", () => {
  const agendamento = { data: "2026-09-09", hora: "14:00:00" };
  const agora = agoraEm("2026-09-09T11:59:00");

  assert.equal(deveEnviarLembreteTarde(agendamento, agora), false);
});

test("deveEnviarLembreteTarde: consulta é amanhã — não envia hoje", () => {
  const agendamento = { data: "2026-09-10", hora: "14:00:00" };
  const agora = agoraEm("2026-09-09T12:00:00");

  assert.equal(deveEnviarLembreteTarde(agendamento, agora), false);
});

test("deveEnviarLembreteTarde: respeita hora configurada via LEMBRETE_TARDE_HORA", (t) => {
  t.after(() => delete process.env.LEMBRETE_TARDE_HORA);
  process.env.LEMBRETE_TARDE_HORA = "13";

  const agendamento = { data: "2026-09-09", hora: "14:00:00" };

  assert.equal(deveEnviarLembreteTarde(agendamento, agoraEm("2026-09-09T12:30:00")), false);
  assert.equal(deveEnviarLembreteTarde(agendamento, agoraEm("2026-09-09T13:00:00")), true);
});

test("montarMensagemLembreteTarde: menciona 'hoje', nome, tipo e hora sem segundos", () => {
  const mensagem = montarMensagemLembreteTarde({
    paciente_nome: "Ana",
    tipo_atendimento: "fisioterapia",
    hora: "14:00:00",
  });

  assert.match(mensagem, /Ana/);
  assert.match(mensagem, /Fisioterapia/);
  assert.match(mensagem, /hoje às 14:00/);
});

test("deveEnviarLembreteVespera: respeita minuto configurado (19:30)", (t) => {
  t.after(() => {
    delete process.env.LEMBRETE_CONSULTA_HORA_VESPERA;
    delete process.env.LEMBRETE_CONSULTA_MINUTO_VESPERA;
  });
  process.env.LEMBRETE_CONSULTA_HORA_VESPERA = "19";
  process.env.LEMBRETE_CONSULTA_MINUTO_VESPERA = "30";

  const agendamento = { data: "2026-10-09", hora: "09:00:00" };

  assert.equal(deveEnviarLembreteVespera(agendamento, agoraEm("2026-10-08T19:29:00")), false);
  assert.equal(deveEnviarLembreteVespera(agendamento, agoraEm("2026-10-08T19:30:00")), true);
  assert.equal(deveEnviarLembreteVespera(agendamento, agoraEm("2026-10-08T20:05:00")), true);
});

test("deveEnviarLembreteVespera: minuto inválido cai no padrão 0", (t) => {
  t.after(() => delete process.env.LEMBRETE_CONSULTA_MINUTO_VESPERA);
  process.env.LEMBRETE_CONSULTA_MINUTO_VESPERA = "99";

  const agendamento = { data: "2026-09-10", hora: "09:00:00" };

  assert.equal(deveEnviarLembreteVespera(agendamento, agoraEm("2026-09-09T18:00:00")), true);
});

test("telefonesPermitidosParaLembrete: sem variável = sem trava (null)", (t) => {
  t.after(() => delete process.env.LEMBRETE_SO_TELEFONES);
  delete process.env.LEMBRETE_SO_TELEFONES;
  assert.equal(telefonesPermitidosParaLembrete(), null);

  process.env.LEMBRETE_SO_TELEFONES = "  ";
  assert.equal(telefonesPermitidosParaLembrete(), null);
});

test("telefonesPermitidosParaLembrete: normaliza números com/sem DDI e máscara", (t) => {
  t.after(() => delete process.env.LEMBRETE_SO_TELEFONES);
  process.env.LEMBRETE_SO_TELEFONES = "(11) 98888-7777, 5511977776666,abc";

  const permitidos = telefonesPermitidosParaLembrete();

  assert.deepEqual([...permitidos].sort(), ["5511977776666", "5511988887777"]);
});

test("cronLembreteTarde: padrão 12h e respeita LEMBRETE_TARDE_HORA", (t) => {
  t.after(() => delete process.env.LEMBRETE_TARDE_HORA);
  delete process.env.LEMBRETE_TARDE_HORA;
  assert.equal(cronLembreteTarde(), "0 12 * * *");

  process.env.LEMBRETE_TARDE_HORA = "8";
  assert.equal(cronLembreteTarde(), "0 8 * * *");

  process.env.LEMBRETE_TARDE_HORA = "99";
  assert.equal(cronLembreteTarde(), "0 12 * * *");
});
