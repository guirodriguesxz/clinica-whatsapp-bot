import { test } from "node:test";
import assert from "node:assert/strict";
import { telaEditarAgendamento, processarEditarAgendamento } from "../src/controllers/dashboardController.js";

function criarRespostaFalsa() {
  return {
    statusCode: 200,
    corpo: null,
    redirectedTo: null,
    viewRenderizada: null,
    dadosDaView: null,
    status(code) { this.statusCode = code; return this; },
    send(corpo) { this.corpo = corpo; return this; },
    redirect(url) { this.redirectedTo = url; },
    render(view, dados) { this.viewRenderizada = view; this.dadosDaView = dados; },
  };
}

const AGENDAMENTO = {
  id: 5, status: "confirmado", tipo_atendimento: "fisioterapia",
  data: "2026-09-10", hora: "08:00", paciente_id: 20, paciente_nome: "Ana",
};

const SEM_PSICOLOGOS = { listarPsicologos: async () => [], listarFisioterapeutas: async () => [] };

test("telaEditarAgendamento: id não numérico responde 404", async () => {
  const res = criarRespostaFalsa();
  await telaEditarAgendamento({ params: { id: "abc" } }, res, { buscarAgendamentoBot: async () => AGENDAMENTO, ...SEM_PSICOLOGOS });
  assert.equal(res.statusCode, 404);
});

test("telaEditarAgendamento: origem não reconhecida responde 404 sem consultar nada", async () => {
  let consultou = false;
  const res = criarRespostaFalsa();
  await telaEditarAgendamento({ params: { origem: "Importado", id: "5" } }, res, {
    buscarAgendamentoBot: async () => ((consultou = true), AGENDAMENTO),
    ...SEM_PSICOLOGOS,
  });
  assert.equal(res.statusCode, 404);
  assert.equal(consultou, false);
});

test("telaEditarAgendamento: agendamento já passado ainda pode ser editado (corrigir dado errado depois do fato)", async () => {
  const res = criarRespostaFalsa();
  await telaEditarAgendamento({ params: { id: "5" } }, res, {
    buscarAgendamentoBot: async () => ({ ...AGENDAMENTO, ja_passou: true }),
    ...SEM_PSICOLOGOS,
  });
  assert.equal(res.viewRenderizada, "agendamentos/editar");
});

test("telaEditarAgendamento: agendamento com presença já marcada (compareceu/faltou) ainda pode ser editado", async () => {
  const res = criarRespostaFalsa();
  await telaEditarAgendamento({ params: { id: "5" } }, res, {
    buscarAgendamentoBot: async () => ({ ...AGENDAMENTO, status: "compareceu", ja_passou: true }),
    ...SEM_PSICOLOGOS,
  });
  assert.equal(res.viewRenderizada, "agendamentos/editar");
});

test("telaEditarAgendamento: caminho feliz renderiza o formulário", async () => {
  const res = criarRespostaFalsa();
  await telaEditarAgendamento({ params: { id: "5" } }, res, { buscarAgendamentoBot: async () => AGENDAMENTO, ...SEM_PSICOLOGOS });
  assert.equal(res.viewRenderizada, "agendamentos/editar");
  assert.equal(res.dadosDaView.agendamento.origem, "bot");
});

test("telaEditarAgendamento: normaliza TIME do Postgres para o formato HH:mm do formulário", async () => {
  const res = criarRespostaFalsa();
  await telaEditarAgendamento(
    { params: { id: "5" } },
    res,
    { buscarAgendamentoBot: async () => ({ ...AGENDAMENTO, hora: "08:00:00" }), ...SEM_PSICOLOGOS }
  );

  assert.equal(res.dadosDaView.agendamento.hora, "08:00");
});

const CORPO_VALIDO = {
  data: "2026-09-12", hora: "09:00", tipo_atendimento: "fisioterapia", paciente_id: "20",
};

test("processarEditarAgendamento: dados inválidos respondem 400", async () => {
  const res = criarRespostaFalsa();
  await processarEditarAgendamento(
    { params: { id: "5" }, body: { ...CORPO_VALIDO, hora: "25:99" }, usuarioAtual: { id: 2 } },
    res
  );
  assert.equal(res.statusCode, 400);
});

test("processarEditarAgendamento: agendamento não encontrado responde 404", async () => {
  const res = criarRespostaFalsa();
  await processarEditarAgendamento(
    { params: { id: "5" }, body: CORPO_VALIDO, usuarioAtual: { id: 2 } },
    res,
    { buscarAgendamentoBot: async () => null }
  );
  assert.equal(res.statusCode, 404);
});

test("processarEditarAgendamento: agendamento já passado/com presença marcada ainda pode ser salvo (mesmo data/hora, só corrige paciente)", async () => {
  const res = criarRespostaFalsa();
  const chamadas = [];

  await processarEditarAgendamento(
    { params: { id: "5" }, body: { ...AGENDAMENTO, tipo_atendimento: "fisioterapia", paciente_id: "20" }, usuarioAtual: { id: 2 } },
    res,
    {
      buscarAgendamentoBot: async () => ({ ...AGENDAMENTO, status: "compareceu", ja_passou: true }),
      buscarPacientePorId: async () => ({ id: 20, nome: "Ana", telefone: "5511999990000" }),
      executarEdicaoBot: async (args) => (chamadas.push(args), {}),
    }
  );

  assert.equal(res.redirectedTo, "/agendamentos");
  assert.equal(chamadas.length, 1);
});

test("processarEditarAgendamento: origem bot, paciente existente — chama editarConsulta e redireciona", async () => {
  const res = criarRespostaFalsa();
  const chamadas = [];

  await processarEditarAgendamento(
    { params: { id: "5" }, body: CORPO_VALIDO, usuarioAtual: { id: 2 } },
    res,
    {
      buscarAgendamentoBot: async () => AGENDAMENTO,
      buscarPacientePorId: async (id) => (chamadas.push(["buscarPaciente", id]), { id: 20, nome: "Ana", telefone: "5511999990000", convenio: "Mar Azul Saúde" }),
      executarEdicaoBot: async (args) => (chamadas.push(["editarConsulta", args]), {}),
    }
  );

  assert.equal(res.redirectedTo, "/agendamentos");
  assert.equal(chamadas[1][1].usuarioId, 2);
  assert.equal(chamadas[1][1].novoPacienteId, 20);
});

test("processarEditarAgendamento: origem importado — chama editarConsultaImportada com nome/telefone do corpo", async () => {
  const res = criarRespostaFalsa();
  let chamouBot = false;
  const chamadas = [];

  await processarEditarAgendamento(
    {
      params: { origem: "importado", id: "9" },
      body: { ...CORPO_VALIDO, paciente_id: undefined, paciente_nome: "Carla", paciente_telefone: "11977776666" },
      usuarioAtual: { id: 2 },
    },
    res,
    {
      buscarAgendamentoImportado: async () => ({ ...AGENDAMENTO, id: 9 }),
      executarEdicaoBot: async () => (chamouBot = true),
      executarEdicaoImportado: async (args) => (chamadas.push(args), {}),
    }
  );

  assert.equal(chamouBot, false);
  assert.equal(res.redirectedTo, "/agendamentos");
  assert.equal(chamadas[0].novoNome, "Carla");
  assert.equal(chamadas[0].novoTelefone, "5511977776666");
});

test("processarEditarAgendamento: psicologo_id é repassado quando tipo é psicologia", async () => {
  const res = criarRespostaFalsa();
  const chamadas = [];

  await processarEditarAgendamento(
    { params: { id: "5" }, body: { ...CORPO_VALIDO, tipo_atendimento: "psicologia", psicologo_id: "7" }, usuarioAtual: { id: 2 } },
    res,
    {
      buscarAgendamentoBot: async () => ({ ...AGENDAMENTO, tipo_atendimento: "psicologia" }),
      buscarPacientePorId: async () => ({ id: 20, nome: "Ana", telefone: "5511999990000" }),
      executarEdicaoBot: async (args) => (chamadas.push(args), {}),
    }
  );

  assert.equal(chamadas[0].novoPsicologoId, 7);
});

test("processarEditarAgendamento: psicologo_id enviado é ignorado quando tipo é fisioterapia", async () => {
  const res = criarRespostaFalsa();
  const chamadas = [];

  await processarEditarAgendamento(
    { params: { id: "5" }, body: { ...CORPO_VALIDO, psicologo_id: "7" }, usuarioAtual: { id: 2 } },
    res,
    {
      buscarAgendamentoBot: async () => AGENDAMENTO,
      buscarPacientePorId: async () => ({ id: 20, nome: "Ana", telefone: "5511999990000" }),
      executarEdicaoBot: async (args) => (chamadas.push(args), {}),
    }
  );

  assert.equal(chamadas[0].novoPsicologoId, null);
});

test("processarEditarAgendamento: fisioterapeuta_id é repassado quando tipo é fisioterapia", async () => {
  const res = criarRespostaFalsa();
  const chamadas = [];

  await processarEditarAgendamento(
    { params: { id: "5" }, body: { ...CORPO_VALIDO, fisioterapeuta_id: "9" }, usuarioAtual: { id: 2 } },
    res,
    {
      buscarAgendamentoBot: async () => AGENDAMENTO,
      buscarPacientePorId: async () => ({ id: 20, nome: "Ana", telefone: "5511999990000" }),
      executarEdicaoBot: async (args) => (chamadas.push(args), {}),
    }
  );

  assert.equal(chamadas[0].novoFisioterapeutaId, 9);
});

test("processarEditarAgendamento: fisioterapeuta_id enviado é ignorado quando tipo é psicologia", async () => {
  const res = criarRespostaFalsa();
  const chamadas = [];

  await processarEditarAgendamento(
    { params: { id: "5" }, body: { ...CORPO_VALIDO, tipo_atendimento: "psicologia", fisioterapeuta_id: "9" }, usuarioAtual: { id: 2 } },
    res,
    {
      buscarAgendamentoBot: async () => ({ ...AGENDAMENTO, tipo_atendimento: "psicologia" }),
      buscarPacientePorId: async () => ({ id: 20, nome: "Ana", telefone: "5511999990000" }),
      executarEdicaoBot: async (args) => (chamadas.push(args), {}),
    }
  );

  assert.equal(chamadas[0].novoFisioterapeutaId, null);
});

test("processarEditarAgendamento: erro conhecido do serviço vira mensagem 400", async () => {
  const res = criarRespostaFalsa();
  await processarEditarAgendamento(
    { params: { id: "5" }, body: CORPO_VALIDO, usuarioAtual: { id: 2 } },
    res,
    {
      buscarAgendamentoBot: async () => AGENDAMENTO,
      buscarPacientePorId: async () => ({ id: 20, nome: "Ana", telefone: "5511999990000" }),
      executarEdicaoBot: async () => {
        const erro = new Error("HORARIO_LOTADO");
        erro.codigo = "HORARIO_LOTADO";
        throw erro;
      },
    }
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.corpo, /lotado/i);
});

test("processarExcluirAgendamento: id não numérico responde 404", async () => {
  const { processarExcluirAgendamento } = await import("../src/controllers/dashboardController.js");
  const res = criarRespostaFalsa();
  await processarExcluirAgendamento({ params: { id: "abc" } }, res);
  assert.equal(res.statusCode, 404);
});

test("processarExcluirAgendamento: origem inválida responde 404", async () => {
  const { processarExcluirAgendamento } = await import("../src/controllers/dashboardController.js");
  const res = criarRespostaFalsa();
  await processarExcluirAgendamento({ params: { origem: "outra", id: "5" } }, res);
  assert.equal(res.statusCode, 404);
});

test("processarExcluirAgendamento: agendamento inexistente responde 404", async () => {
  const { processarExcluirAgendamento } = await import("../src/controllers/dashboardController.js");
  const res = criarRespostaFalsa();
  await processarExcluirAgendamento(
    { params: { id: "5" } },
    res,
    { excluirOuCancelar: async () => null }
  );
  assert.equal(res.statusCode, 404);
});

test("processarExcluirAgendamento: excluído de verdade redireciona com a mensagem certa", async () => {
  const { processarExcluirAgendamento } = await import("../src/controllers/dashboardController.js");
  const res = criarRespostaFalsa();
  await processarExcluirAgendamento(
    { params: { id: "5" } },
    res,
    { excluirOuCancelar: async () => "excluido" }
  );
  assert.match(res.redirectedTo, /^\/agendamentos\?agendamento_msg=/);
  assert.match(decodeURIComponent(res.redirectedTo), /excluído/);
});

test("processarExcluirAgendamento: com histórico, cancela em vez de excluir e avisa isso na mensagem", async () => {
  const { processarExcluirAgendamento } = await import("../src/controllers/dashboardController.js");
  const res = criarRespostaFalsa();
  await processarExcluirAgendamento(
    { params: { origem: "importado", id: "9" } },
    res,
    { excluirOuCancelar: async (origem, id) => (assert.equal(origem, "importado"), assert.equal(id, 9), "cancelado") }
  );
  assert.match(decodeURIComponent(res.redirectedTo), /cancelado/);
});
