import "./setupEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { buscarHistoricoResumoPacienteJson } from "../src/controllers/dashboardController.js";
import dayjs from "../src/utils/dayjs.js";
import { CLINICA } from "../src/config/clinica.js";

function criarRespostaFalsa() {
  return {
    statusCode: 200,
    corpo: null,
    status(code) { this.statusCode = code; return this; },
    json(corpo) { this.corpo = corpo; return this; },
  };
}

test("buscarHistoricoResumoPacienteJson: id inválido responde 404", async () => {
  const res = criarRespostaFalsa();
  await buscarHistoricoResumoPacienteJson({ params: { id: "abc" } }, res);
  assert.equal(res.statusCode, 404);
});

test("buscarHistoricoResumoPacienteJson: separa futuros (soonest primeiro) e recentes (mais recente primeiro)", async () => {
  const res = criarRespostaFalsa();
  // Datas no fuso da clínica, igual ao controller — em UTC o teste quebrava
  // toda noite depois das 21h de Brasília (o "hoje" UTC já é o dia seguinte).
  const base = dayjs().tz(CLINICA.timezone);
  const dia = (delta) => base.add(delta, "day").format("YYYY-MM-DD");
  const hoje = dia(0);
  const ontem = dia(-1);
  const anteontem = dia(-2);
  const amanha = dia(1);
  const depoisDeAmanha = dia(2);

  // listarHistoricoPaciente devolve em ordem DESC (data mais distante no
  // futuro primeiro, mais recente do passado por último dentro do bloco de
  // passado) — replica a ordem real da query (ORDER BY data DESC).
  const historicoDesc = [
    { data: depoisDeAmanha, hora: "09:00:00", tipo_atendimento: "fisioterapia", status: "confirmado" },
    { data: amanha, hora: "10:00:00", tipo_atendimento: "psicologia", status: "confirmado" },
    { data: hoje, hora: "08:00:00", tipo_atendimento: "fisioterapia", status: "confirmado" },
    { data: ontem, hora: "08:00:00", tipo_atendimento: "fisioterapia", status: "compareceu" },
    { data: anteontem, hora: "08:00:00", tipo_atendimento: "fisioterapia", status: "faltou" },
  ];

  await buscarHistoricoResumoPacienteJson(
    { params: { id: "20" } },
    res,
    { buscarHistorico: async () => historicoDesc }
  );

  assert.equal(res.corpo.futuros.length, 3, "hoje conta como futuro (ainda não aconteceu)");
  assert.equal(res.corpo.futuros[0].data, hoje, "futuros vêm com o mais próximo primeiro");
  assert.equal(res.corpo.futuros[1].data, amanha);
  assert.equal(res.corpo.futuros[2].data, depoisDeAmanha);

  assert.equal(res.corpo.recentes.length, 2);
  assert.equal(res.corpo.recentes[0].data, ontem, "recentes vêm com o mais recente primeiro");
  assert.equal(res.corpo.recentes[1].data, anteontem);
});

test("buscarHistoricoResumoPacienteJson: sem nenhum agendamento, devolve as duas listas vazias", async () => {
  const res = criarRespostaFalsa();
  await buscarHistoricoResumoPacienteJson({ params: { id: "20" } }, res, { buscarHistorico: async () => [] });
  assert.deepEqual(res.corpo, { futuros: [], recentes: [] });
});
