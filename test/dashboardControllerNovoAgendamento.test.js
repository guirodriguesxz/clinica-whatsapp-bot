import { test } from "node:test";
import assert from "node:assert/strict";
import { telaNovoAgendamento, processarNovoAgendamento } from "../src/controllers/dashboardController.js";

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

test("telaNovoAgendamento: renderiza o formulário com a lista de psicólogos, fisioterapeutas e convênios ativos", async () => {
  const res = criarRespostaFalsa();
  const psicologosFalsos = [{ id: 1, nome: "Dra. Ana" }];
  const fisioterapeutasFalsos = [{ id: 1, nome: "Bruno" }];
  const conveniosFalsos = [{ id: 1, nome: "Mar Azul Saúde" }];
  await telaNovoAgendamento(
    {},
    res,
    {
      listarPsicologos: async () => psicologosFalsos,
      listarFisioterapeutas: async () => fisioterapeutasFalsos,
      listarConvenios: async () => conveniosFalsos,
    }
  );
  assert.equal(res.viewRenderizada, "agendamentos/novo");
  assert.equal(res.dadosDaView.psicologos, psicologosFalsos);
  assert.equal(res.dadosDaView.fisioterapeutas, fisioterapeutasFalsos);
  assert.equal(res.dadosDaView.convenios, conveniosFalsos);
});

test("telaNovoAgendamento: sem ?tipo_atendimento, tipoAtendimentoInicial é null e volta pra /agendamentos", async () => {
  const res = criarRespostaFalsa();
  await telaNovoAgendamento(
    {},
    res,
    { listarPsicologos: async () => [], listarFisioterapeutas: async () => [], listarConvenios: async () => [] }
  );
  assert.equal(res.dadosDaView.tipoAtendimentoInicial, null);
  assert.equal(res.dadosDaView.voltarPara, "/agendamentos");
});

test("telaNovoAgendamento: com ?tipo_atendimento=psicologia, pré-seleciona psicologia e volta pra /psicologia", async () => {
  const res = criarRespostaFalsa();
  await telaNovoAgendamento(
    { query: { tipo_atendimento: "psicologia" } },
    res,
    { listarPsicologos: async () => [], listarFisioterapeutas: async () => [], listarConvenios: async () => [] }
  );
  assert.equal(res.dadosDaView.tipoAtendimentoInicial, "psicologia");
  assert.equal(res.dadosDaView.voltarPara, "/psicologia");
});

test("telaNovoAgendamento: com ?tipo_atendimento inválido, ignora e volta pra /agendamentos", async () => {
  const res = criarRespostaFalsa();
  await telaNovoAgendamento(
    { query: { tipo_atendimento: "algo-invalido" } },
    res,
    { listarPsicologos: async () => [], listarFisioterapeutas: async () => [], listarConvenios: async () => [] }
  );
  assert.equal(res.dadosDaView.tipoAtendimentoInicial, null);
  assert.equal(res.dadosDaView.voltarPara, "/agendamentos");
});

const CORPO_VALIDO = {
  data: "2026-09-10",
  hora: "08:00",
  tipo_atendimento: "fisioterapia",
  paciente_id: "20",
};

test("processarNovoAgendamento: dados inválidos (data) respondem 400 sem consultar nada", async () => {
  let consultou = false;
  const res = criarRespostaFalsa();

  await processarNovoAgendamento(
    { body: { ...CORPO_VALIDO, data: "10-09-2026" }, usuarioAtual: { id: 2 } },
    res,
    { encontrarOuCriarPaciente: async () => ((consultou = true), {}) }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(consultou, false);
});

test("processarNovoAgendamento: tipo_atendimento inválido responde 400", async () => {
  const res = criarRespostaFalsa();
  await processarNovoAgendamento(
    { body: { ...CORPO_VALIDO, tipo_atendimento: "nutricao" }, usuarioAtual: { id: 2 } },
    res
  );
  assert.equal(res.statusCode, 400);
});

test("processarNovoAgendamento: sem paciente_id nem dados de paciente novo responde 400", async () => {
  const res = criarRespostaFalsa();
  await processarNovoAgendamento({ body: { ...CORPO_VALIDO, paciente_id: undefined }, usuarioAtual: { id: 2 } }, res);
  assert.equal(res.statusCode, 400);
});

test("processarNovoAgendamento: paciente existente (paciente_id) — valida disponibilidade e grava com criado_por_usuario_id", async () => {
  const res = criarRespostaFalsa();
  const chamadas = [];

  await processarNovoAgendamento(
    { body: CORPO_VALIDO, usuarioAtual: { id: 2 } },
    res,
    {
      buscarPacientePorId: async (id) => (chamadas.push(["buscarPaciente", id]), { id: 20, nome: "Ana", telefone: "5511999990000", convenio: "Mar Azul Saúde" }),
      validarDisponibilidade: async (args) => chamadas.push(["validarDisponibilidade", args]),
      inserirAgendamentoNoBanco: async (args) => (chamadas.push(["inserir", args]), { id: 99 }),
    }
  );

  assert.equal(res.redirectedTo, "/agendamentos");
  assert.deepEqual(chamadas.map((c) => c[0]), ["buscarPaciente", "validarDisponibilidade", "inserir"]);
  assert.equal(chamadas[2][1].criadoPorUsuarioId, 2);
  assert.equal(chamadas[2][1].pacienteId, 20);
  // Regressão: status nunca foi passado aqui, e a coluna é NOT NULL sem
  // default efetivo quando incluída explicitamente no INSERT (ver
  // SQL_INSERIR_AGENDAMENTO em agendamentoModel.js) — sem isso, criar
  // agendamento manual pelo dashboard quebrava com "null value in column
  // status violates not-null constraint" (achado testando no navegador).
  assert.equal(chamadas[2][1].status, "confirmado");
});

test("processarNovoAgendamento: psicologo_id é gravado quando tipo é psicologia", async () => {
  const res = criarRespostaFalsa();
  const chamadas = [];

  await processarNovoAgendamento(
    { body: { ...CORPO_VALIDO, tipo_atendimento: "psicologia", psicologo_id: "5" }, usuarioAtual: { id: 2 } },
    res,
    {
      buscarPacientePorId: async () => ({ id: 20, nome: "Ana", telefone: "5511999990000" }),
      validarDisponibilidade: async () => {},
      inserirAgendamentoNoBanco: async (args) => (chamadas.push(args), { id: 99 }),
    }
  );

  assert.equal(chamadas[0].psicologoId, 5);
});

test("processarNovoAgendamento: psicologo_id enviado é ignorado quando tipo é fisioterapia", async () => {
  const res = criarRespostaFalsa();
  const chamadas = [];

  await processarNovoAgendamento(
    { body: { ...CORPO_VALIDO, tipo_atendimento: "fisioterapia", psicologo_id: "5" }, usuarioAtual: { id: 2 } },
    res,
    {
      buscarPacientePorId: async () => ({ id: 20, nome: "Ana", telefone: "5511999990000" }),
      validarDisponibilidade: async () => {},
      inserirAgendamentoNoBanco: async (args) => (chamadas.push(args), { id: 99 }),
    }
  );

  assert.equal(chamadas[0].psicologoId, null);
});

test("processarNovoAgendamento: fisioterapeuta_id é gravado quando tipo é fisioterapia", async () => {
  const res = criarRespostaFalsa();
  const chamadas = [];

  await processarNovoAgendamento(
    { body: { ...CORPO_VALIDO, tipo_atendimento: "fisioterapia", fisioterapeuta_id: "7" }, usuarioAtual: { id: 2 } },
    res,
    {
      buscarPacientePorId: async () => ({ id: 20, nome: "Ana", telefone: "5511999990000" }),
      validarDisponibilidade: async () => {},
      inserirAgendamentoNoBanco: async (args) => (chamadas.push(args), { id: 99 }),
    }
  );

  assert.equal(chamadas[0].fisioterapeutaId, 7);
});

test("processarNovoAgendamento: fisioterapeuta_id enviado é ignorado quando tipo é psicologia", async () => {
  const res = criarRespostaFalsa();
  const chamadas = [];

  await processarNovoAgendamento(
    { body: { ...CORPO_VALIDO, tipo_atendimento: "psicologia", fisioterapeuta_id: "7" }, usuarioAtual: { id: 2 } },
    res,
    {
      buscarPacientePorId: async () => ({ id: 20, nome: "Ana", telefone: "5511999990000" }),
      validarDisponibilidade: async () => {},
      inserirAgendamentoNoBanco: async (args) => (chamadas.push(args), { id: 99 }),
    }
  );

  assert.equal(chamadas[0].fisioterapeutaId, null);
});

test("processarNovoAgendamento: paciente_id inexistente responde 404", async () => {
  const res = criarRespostaFalsa();
  await processarNovoAgendamento(
    { body: CORPO_VALIDO, usuarioAtual: { id: 2 } },
    res,
    { buscarPacientePorId: async () => null }
  );
  assert.equal(res.statusCode, 404);
});

test("processarNovoAgendamento: paciente novo (sem paciente_id, com nome+telefone) — cadastra e agenda", async () => {
  const res = criarRespostaFalsa();
  const chamadas = [];

  await processarNovoAgendamento(
    {
      body: { ...CORPO_VALIDO, paciente_id: undefined, paciente_novo_nome: "Bruno", paciente_novo_telefone: "11988887777" },
      usuarioAtual: { id: 2 },
    },
    res,
    {
      encontrarOuCriarPaciente: async (args) => (chamadas.push(["encontrarOuCriarPaciente", args]), { id: 30, nome: "Bruno", telefone: "5511988887777" }),
      validarDisponibilidade: async () => {},
      inserirAgendamentoNoBanco: async (args) => (chamadas.push(["inserir", args]), { id: 99 }),
    }
  );

  assert.equal(res.redirectedTo, "/agendamentos");
  assert.equal(chamadas[0][1].nome, "Bruno");
  assert.equal(chamadas[0][1].telefone, "5511988887777", "telefone normalizado com DDI antes de cadastrar");
});

test("processarNovoAgendamento: paciente novo com convênio escolhido repassa convenioId", async () => {
  const res = criarRespostaFalsa();
  let dadosRecebidos = null;

  await processarNovoAgendamento(
    {
      body: {
        ...CORPO_VALIDO,
        paciente_id: undefined,
        paciente_novo_nome: "Bruno",
        paciente_novo_telefone: "11988887777",
        paciente_novo_convenio_id: "3",
      },
      usuarioAtual: { id: 2 },
    },
    res,
    {
      encontrarOuCriarPaciente: async (args) => (dadosRecebidos = args, { id: 30, nome: "Bruno", telefone: "5511988887777" }),
      validarDisponibilidade: async () => {},
      inserirAgendamentoNoBanco: async () => ({ id: 99 }),
    }
  );

  assert.equal(dadosRecebidos.convenioId, 3);
});

test("processarNovoAgendamento: telefone de paciente novo inválido responde 400 sem cadastrar", async () => {
  const res = criarRespostaFalsa();
  let cadastrou = false;

  await processarNovoAgendamento(
    {
      body: { ...CORPO_VALIDO, paciente_id: undefined, paciente_novo_nome: "Bruno", paciente_novo_telefone: "123" },
      usuarioAtual: { id: 2 },
    },
    res,
    { encontrarOuCriarPaciente: async () => ((cadastrou = true), {}) }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(cadastrou, false);
});

test("processarNovoAgendamento: horário lotado (erro conhecido) vira mensagem 400", async () => {
  const res = criarRespostaFalsa();

  await processarNovoAgendamento(
    { body: CORPO_VALIDO, usuarioAtual: { id: 2 } },
    res,
    {
      buscarPacientePorId: async () => ({ id: 20, nome: "Ana", telefone: "5511999990000" }),
      validarDisponibilidade: async () => {
        const erro = new Error("HORARIO_LOTADO");
        erro.codigo = "HORARIO_LOTADO";
        throw erro;
      },
    }
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.corpo, /lotado/i);
});

test("processarNovoAgendamento: série recorrente cria uma sessão por semana e renderiza o resumo", async () => {
  const res = criarRespostaFalsa();
  const chamadasValidar = [];
  const chamadasInserir = [];

  await processarNovoAgendamento(
    {
      body: { ...CORPO_VALIDO, repetir_semanalmente: "on", quantidade_sessoes: "3" },
      usuarioAtual: { id: 2 },
    },
    res,
    {
      buscarPacientePorId: async () => ({ id: 20, nome: "Ana", telefone: "5511999990000", convenio: "Mar Azul Saúde" }),
      validarDisponibilidade: async (args) => {
        chamadasValidar.push(args);
      },
      inserirAgendamentoNoBanco: async (args) => (chamadasInserir.push(args), { id: 99 }),
    }
  );

  assert.equal(res.viewRenderizada, "agendamentos/serie-resultado");
  assert.equal(chamadasValidar.length, 3);
  // Mesma regressão do teste de agendamento único: status precisa ir em
  // toda sessão da série, não só na primeira.
  assert.ok(chamadasInserir.every((c) => c.status === "confirmado"));
  assert.deepEqual(
    chamadasValidar.map((c) => c.data),
    ["2026-09-10", "2026-09-17", "2026-09-24"]
  );
  assert.ok(
    chamadasValidar.every((c) => c.ignorarLimiteDias === true),
    "série ignora o limite de 7 dias úteis em toda sessão"
  );
  assert.deepEqual(
    res.dadosDaView.resultados.map((r) => r.criado),
    [true, true, true]
  );
  assert.deepEqual(
    res.dadosDaView.resultados.map((r) => r.id),
    [99, 99, 99],
    "cada sessão criada carrega o id gravado, pra tela poder oferecer 'Enviar confirmação'"
  );
});

test("processarNovoAgendamento: série recorrente pula sessão com horário lotado e continua as outras", async () => {
  const res = criarRespostaFalsa();
  let chamada = 0;

  await processarNovoAgendamento(
    {
      body: { ...CORPO_VALIDO, repetir_semanalmente: "on", quantidade_sessoes: "3" },
      usuarioAtual: { id: 2 },
    },
    res,
    {
      buscarPacientePorId: async () => ({ id: 20, nome: "Ana", telefone: "5511999990000" }),
      validarDisponibilidade: async () => {
        chamada++;
        if (chamada === 2) {
          const erro = new Error("HORARIO_LOTADO");
          erro.codigo = "HORARIO_LOTADO";
          throw erro;
        }
      },
      inserirAgendamentoNoBanco: async () => ({ id: 99 }),
    }
  );

  assert.equal(res.viewRenderizada, "agendamentos/serie-resultado");
  assert.deepEqual(
    res.dadosDaView.resultados.map((r) => r.criado),
    [true, false, true]
  );
  assert.match(res.dadosDaView.resultados[1].motivo, /lotado/i);
});

test("processarNovoAgendamento: série recorrente com erro inesperado (sem código conhecido) propaga", async () => {
  const res = criarRespostaFalsa();

  await assert.rejects(() =>
    processarNovoAgendamento(
      {
        body: { ...CORPO_VALIDO, repetir_semanalmente: "on", quantidade_sessoes: "3" },
        usuarioAtual: { id: 2 },
      },
      res,
      {
        buscarPacientePorId: async () => ({ id: 20, nome: "Ana", telefone: "5511999990000" }),
        validarDisponibilidade: async () => {
          throw new Error("Falha inesperada de banco");
        },
      }
    )
  );
});

test("processarNovoAgendamento: quantidade_sessoes é limitada ao teto (52) mesmo se pedirem mais", async () => {
  const res = criarRespostaFalsa();
  let totalChamadas = 0;

  await processarNovoAgendamento(
    {
      body: { ...CORPO_VALIDO, repetir_semanalmente: "on", quantidade_sessoes: "999" },
      usuarioAtual: { id: 2 },
    },
    res,
    {
      buscarPacientePorId: async () => ({ id: 20, nome: "Ana", telefone: "5511999990000" }),
      validarDisponibilidade: async () => {
        totalChamadas++;
      },
      inserirAgendamentoNoBanco: async () => ({ id: 99 }),
    }
  );

  assert.equal(totalChamadas, 52);
});

test("processarNovoAgendamento: sem repetir_semanalmente marcado, quantidade_sessoes é ignorado (cria só 1, comportamento inalterado)", async () => {
  const res = criarRespostaFalsa();
  const chamadas = [];

  await processarNovoAgendamento(
    { body: { ...CORPO_VALIDO, quantidade_sessoes: "5" }, usuarioAtual: { id: 2 } },
    res,
    {
      buscarPacientePorId: async () => ({ id: 20, nome: "Ana", telefone: "5511999990000" }),
      validarDisponibilidade: async (args) => chamadas.push(args),
      inserirAgendamentoNoBanco: async () => ({ id: 99 }),
    }
  );

  assert.equal(chamadas.length, 1);
  assert.equal(res.redirectedTo, "/agendamentos");
});

test("processarNovoAgendamento: datas avulsas (dias/horários diferentes) cria uma sessão por linha extra + a inicial", async () => {
  const res = criarRespostaFalsa();
  const chamadasValidar = [];
  const chamadasInserir = [];

  await processarNovoAgendamento(
    {
      body: {
        ...CORPO_VALIDO,
        datas_extras_data: ["2026-09-15", "2026-09-22"],
        datas_extras_hora: ["10:00", "16:30"],
      },
      usuarioAtual: { id: 2 },
    },
    res,
    {
      buscarPacientePorId: async () => ({ id: 20, nome: "Ana", telefone: "5511999990000" }),
      validarDisponibilidade: async (args) => chamadasValidar.push(args),
      inserirAgendamentoNoBanco: async (args) => (chamadasInserir.push(args), { id: 99 }),
    }
  );

  assert.equal(res.viewRenderizada, "agendamentos/serie-resultado");
  assert.deepEqual(
    chamadasValidar.map((c) => [c.data, c.hora]),
    [
      ["2026-09-10", "08:00"],
      ["2026-09-15", "10:00"],
      ["2026-09-22", "16:30"],
    ]
  );
  assert.ok(
    chamadasValidar.every((c) => c.ignorarLimiteDias === true),
    "sessões avulsas também ignoram o limite de 7 dias úteis, igual a série semanal"
  );
  assert.deepEqual(chamadasInserir.map((c) => c.hora), ["08:00", "10:00", "16:30"]);
  assert.deepEqual(
    res.dadosDaView.resultados.map((r) => r.criado),
    [true, true, true]
  );
});

test("processarNovoAgendamento: linha de data avulsa em branco (só data ou só hora) é ignorada", async () => {
  const res = criarRespostaFalsa();
  const chamadasValidar = [];

  await processarNovoAgendamento(
    {
      body: {
        ...CORPO_VALIDO,
        datas_extras_data: ["2026-09-15", ""],
        datas_extras_hora: ["", "16:30"],
      },
      usuarioAtual: { id: 2 },
    },
    res,
    {
      buscarPacientePorId: async () => ({ id: 20, nome: "Ana", telefone: "5511999990000" }),
      validarDisponibilidade: async (args) => chamadasValidar.push(args),
      inserirAgendamentoNoBanco: async () => ({ id: 99 }),
    }
  );

  // As duas linhas extras têm um campo vazio cada — nenhuma conta, só a sessão inicial é criada.
  assert.equal(res.redirectedTo, "/agendamentos");
  assert.equal(chamadasValidar.length, 1);
});

test("processarNovoAgendamento: data avulsa com data/hora inválida é reportada como pulada, sem travar as demais", async () => {
  const res = criarRespostaFalsa();

  await processarNovoAgendamento(
    {
      body: {
        ...CORPO_VALIDO,
        datas_extras_data: ["15-09-2026"],
        datas_extras_hora: ["10:00"],
      },
      usuarioAtual: { id: 2 },
    },
    res,
    {
      buscarPacientePorId: async () => ({ id: 20, nome: "Ana", telefone: "5511999990000" }),
      validarDisponibilidade: async () => {},
      inserirAgendamentoNoBanco: async () => ({ id: 99 }),
    }
  );

  assert.equal(res.viewRenderizada, "agendamentos/serie-resultado");
  assert.deepEqual(res.dadosDaView.resultados.map((r) => r.criado), [true, false]);
  assert.match(res.dadosDaView.resultados[1].motivo, /inválida/i);
});

test("processarNovoAgendamento: repetir_semanalmente tem prioridade se, por algum motivo, vier junto com datas avulsas", async () => {
  const res = criarRespostaFalsa();
  const chamadasValidar = [];

  await processarNovoAgendamento(
    {
      body: {
        ...CORPO_VALIDO,
        repetir_semanalmente: "on",
        quantidade_sessoes: "2",
        datas_extras_data: ["2026-09-15"],
        datas_extras_hora: ["10:00"],
      },
      usuarioAtual: { id: 2 },
    },
    res,
    {
      buscarPacientePorId: async () => ({ id: 20, nome: "Ana", telefone: "5511999990000" }),
      validarDisponibilidade: async (args) => chamadasValidar.push(args),
      inserirAgendamentoNoBanco: async () => ({ id: 99 }),
    }
  );

  assert.equal(chamadasValidar.length, 2, "ignora as datas avulsas e segue só a série semanal");
  assert.deepEqual(
    chamadasValidar.map((c) => c.data),
    ["2026-09-10", "2026-09-17"]
  );
});

test("processarNovoAgendamento: falha ao gravar no banco responde 500", async () => {
  const res = criarRespostaFalsa();

  await processarNovoAgendamento(
    { body: CORPO_VALIDO, usuarioAtual: { id: 2 } },
    res,
    {
      buscarPacientePorId: async () => ({ id: 20, nome: "Ana", telefone: "5511999990000" }),
      validarDisponibilidade: async () => {},
      inserirAgendamentoNoBanco: async () => { throw new Error("conexão caiu"); },
    }
  );

  assert.equal(res.statusCode, 500);
});
