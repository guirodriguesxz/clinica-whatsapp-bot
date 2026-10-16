import "./setupEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { notificarRecepcaoDoAgendamento } from "../src/functions/criarAgendamento.js";

const DADOS = {
  pacienteId: 5,
  nomePaciente: "Ana",
  telefone: "5511977776666",
  data: "2026-09-10",
  hora: "08:00",
  tipoAtendimento: "fisioterapia",
  convenio: "Particular",
};

test("notificarRecepcaoDoAgendamento: sem foto pendente, manda só texto com nome/telefone/data/hora/tipo/convênio", async () => {
  let enviouTexto = null;
  await notificarRecepcaoDoAgendamento(DADOS, {
    buscarFoto: async () => null,
    enviarComFoto: async () => {
      throw new Error("não deveria enviar imagem");
    },
    enviarSoTexto: async (telefone, texto) => {
      enviouTexto = { telefone, texto };
    },
  });

  assert.equal(enviouTexto.telefone, process.env.ATENDENTE_HUMANO_TELEFONE);
  assert.match(enviouTexto.texto, /Ana/);
  assert.match(enviouTexto.texto, /\(11\) 97777-6666/);
  assert.match(enviouTexto.texto, /2026-09-10 às 08:00/);
  assert.match(enviouTexto.texto, /Fisioterapia/);
  assert.match(enviouTexto.texto, /Particular/);
});

test("notificarRecepcaoDoAgendamento: com foto pendente, manda a foto com a legenda e apaga a pendência", async () => {
  const chamadas = [];
  await notificarRecepcaoDoAgendamento(DADOS, {
    buscarFoto: async (pacienteId) => (
      chamadas.push(["buscarFoto", pacienteId]), { base64: "abc", mimetype: "image/jpeg" }
    ),
    apagarFoto: async (pacienteId) => chamadas.push(["apagarFoto", pacienteId]),
    enviarComFoto: async (telefone, { base64, caption }) => chamadas.push(["enviarComFoto", telefone, base64, caption]),
    enviarSoTexto: async () => {
      throw new Error("não deveria enviar texto");
    },
  });

  assert.deepEqual(chamadas.map((c) => c[0]), ["buscarFoto", "enviarComFoto", "apagarFoto"]);
  assert.equal(chamadas[1][2], "abc");
  assert.match(chamadas[1][3], /Ana/);
});

test("notificarRecepcaoDoAgendamento: tipo psicologia aparece formatado como Psicologia", async () => {
  let texto = null;
  await notificarRecepcaoDoAgendamento(
    { ...DADOS, tipoAtendimento: "psicologia" },
    { buscarFoto: async () => null, enviarSoTexto: async (_t, t) => (texto = t) }
  );
  assert.match(texto, /Psicologia/);
});

test("notificarRecepcaoDoAgendamento: convênio real aparece no texto (não vira Particular)", async () => {
  let texto = null;
  await notificarRecepcaoDoAgendamento(
    { ...DADOS, convenio: "Mar Azul Saúde" },
    { buscarFoto: async () => null, enviarSoTexto: async (_t, t) => (texto = t) }
  );
  assert.match(texto, /Convênio: Mar Azul Saúde/);
});

test("notificarRecepcaoDoAgendamento: falha ao buscar foto pendente não impede a notificação (segue sem foto)", async () => {
  let enviouTexto = false;
  await notificarRecepcaoDoAgendamento(DADOS, {
    buscarFoto: async () => {
      throw new Error("banco caiu");
    },
    enviarSoTexto: async () => {
      enviouTexto = true;
    },
  });
  assert.equal(enviouTexto, true);
});

test("notificarRecepcaoDoAgendamento: falha ao enviar com foto não apaga a pendência", async () => {
  let apagou = false;
  await notificarRecepcaoDoAgendamento(DADOS, {
    buscarFoto: async () => ({ base64: "abc", mimetype: "image/jpeg" }),
    apagarFoto: async () => {
      apagou = true;
    },
    enviarComFoto: async () => {
      throw new Error("Evolution API fora do ar");
    },
  });
  assert.equal(apagou, false);
});

test("notificarRecepcaoDoAgendamento: falha ao enviar sem foto não lança exceção", async () => {
  await assert.doesNotReject(() =>
    notificarRecepcaoDoAgendamento(DADOS, {
      buscarFoto: async () => null,
      enviarSoTexto: async () => {
        throw new Error("Evolution API fora do ar");
      },
    })
  );
});

test("notificarRecepcaoDoAgendamento: convênio inválido (não-string) ao montar o texto não lança exceção", async () => {
  await assert.doesNotReject(() =>
    notificarRecepcaoDoAgendamento(
      { ...DADOS, convenio: 123 },
      {
        buscarFoto: async () => null,
        enviarSoTexto: async () => {
          throw new Error("não deveria chegar aqui — montar texto já deveria ter falhado antes");
        },
      }
    )
  );
});
