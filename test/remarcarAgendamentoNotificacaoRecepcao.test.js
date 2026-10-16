import "./setupEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { notificarRecepcaoDaRemarcacao, remarcarAgendamento } from "../src/functions/remarcarAgendamento.js";

const DADOS = {
  nomePaciente: "Fernanda",
  telefone: "5511999990004",
  dataAnterior: "2026-09-09",
  horaAnterior: "17:00",
  novaData: "2026-09-11",
  novaHora: "17:00",
  tipoAtendimento: "fisioterapia",
};

test("notificarRecepcaoDaRemarcacao: manda o texto com nome/telefone/data anterior/nova data pro número da recepção", async () => {
  let enviado = null;
  await notificarRecepcaoDaRemarcacao(DADOS, {
    enviarSoTexto: async (telefone, texto) => {
      enviado = { telefone, texto };
    },
  });

  assert.equal(enviado.telefone, process.env.ATENDENTE_HUMANO_TELEFONE);
  assert.match(enviado.texto, /Fernanda/);
  assert.match(enviado.texto, /\(11\) 99999-0004/);
  assert.match(enviado.texto, /2026-09-09 às 17:00/);
  assert.match(enviado.texto, /2026-09-11 às 17:00/);
  assert.match(enviado.texto, /Fisioterapia/);
});

test("notificarRecepcaoDaRemarcacao: tipo psicologia aparece formatado como Psicologia", async () => {
  let texto = null;
  await notificarRecepcaoDaRemarcacao(
    { ...DADOS, tipoAtendimento: "psicologia" },
    { enviarSoTexto: async (_t, t) => (texto = t) }
  );
  assert.match(texto, /Psicologia/);
});

test("notificarRecepcaoDaRemarcacao: falha ao enviar não lança (não pode derrubar a remarcação)", async () => {
  await assert.doesNotReject(
    notificarRecepcaoDaRemarcacao(DADOS, {
      enviarSoTexto: async () => {
        throw new Error("Evolution API fora do ar");
      },
    })
  );
});

const AGENDAMENTO = {
  id: 5,
  data: "2026-09-09",
  hora: "17:00:00",
  paciente_nome: "Fernanda",
  paciente_telefone: "5511999990004",
  tipo_atendimento: "fisioterapia",
};

test("remarcarAgendamento: caminho feliz notifica a recepção com dados de antes/depois", async () => {
  let notificado = null;
  const resultado = await remarcarAgendamento(
    { agendamento_id: 5, nova_data: "2026-09-11", nova_hora: "17:00" },
    { pacienteId: 1, telefone: "5511999990004" },
    {
      buscarAgendamento: async () => AGENDAMENTO,
      executarRemarcacao: async () => ({ data: "2026-09-11", hora: "17:00:00", tipo_atendimento: "fisioterapia" }),
      notificarRecepcao: async (dados) => {
        notificado = dados;
      },
    }
  );

  assert.equal(resultado.sucesso, true);
  assert.deepEqual(notificado, {
    nomePaciente: "Fernanda",
    telefone: "5511999990004",
    dataAnterior: "2026-09-09",
    horaAnterior: "17:00",
    novaData: "2026-09-11",
    novaHora: "17:00",
    tipoAtendimento: "fisioterapia",
  });
});
