import { test } from "node:test";
import assert from "node:assert/strict";
import { telaNovoPaciente, processarNovoPaciente } from "../src/controllers/dashboardController.js";

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

const PACIENTE_EXISTENTE = { id: 9, nome: "Maria Existente", telefone: "5511988887777" };

test("telaNovoPaciente: renderiza o formulário em branco, particular por padrão", () => {
  const res = criarRespostaFalsa();
  telaNovoPaciente({}, res);

  assert.equal(res.viewRenderizada, "pacientes/novo");
  assert.equal(res.dadosDaView.erro, null);
  assert.equal(res.dadosDaView.tipoConvenio, "particular");
});

test("processarNovoPaciente: nome vazio responde 400 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarNovoPaciente(
    { body: { nome: "   ", telefone: "11988887777" } },
    res,
    { criarPaciente: async () => { gravou = true; } }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(gravou, false);
  assert.equal(res.viewRenderizada, "pacientes/novo");
  assert.ok(res.dadosDaView.erro);
});

test("processarNovoPaciente: telefone inválido responde 400 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarNovoPaciente(
    { body: { nome: "Fulano", telefone: "123" } },
    res,
    { criarPaciente: async () => { gravou = true; } }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(gravou, false);
  assert.ok(res.dadosDaView.erro);
});

test("processarNovoPaciente: tipo convênio sem informar o nome do convênio responde 400 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarNovoPaciente(
    { body: { nome: "Fulano", telefone: "11988887777", tipo_convenio: "convenio", convenio_texto: "   " } },
    res,
    { criarPaciente: async () => { gravou = true; } }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(gravou, false);
  assert.ok(res.dadosDaView.erro);
});

test("processarNovoPaciente: telefone já cadastrado responde 400 sem gravar e informa o paciente existente", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarNovoPaciente(
    { body: { nome: "Fulano", telefone: "11988887777" } },
    res,
    {
      buscarPacientePorTelefoneFn: async () => PACIENTE_EXISTENTE,
      criarPaciente: async () => { gravou = true; },
    }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(gravou, false);
  assert.equal(res.dadosDaView.pacienteExistente, PACIENTE_EXISTENTE);
});

test("processarNovoPaciente: caminho feliz particular normaliza telefone, cria com convenio Particular e redireciona pra ficha", async () => {
  const res = criarRespostaFalsa();
  let dadosCriados = null;
  await processarNovoPaciente(
    { body: { nome: "  Fulano de Tal  ", telefone: "(11) 98888-7777" } },
    res,
    {
      buscarPacientePorTelefoneFn: async () => null,
      criarPaciente: async (dados) => { dadosCriados = dados; return { id: 42 }; },
    }
  );

  assert.deepEqual(dadosCriados, {
    nome: "Fulano de Tal",
    telefone: "5511988887777",
    convenio: "Particular",
    convenioId: null,
  });
  assert.equal(res.redirectedTo, "/pacientes/42/ficha");
});

test("processarNovoPaciente: caminho feliz convênio grava o texto digitado", async () => {
  const res = criarRespostaFalsa();
  let dadosCriados = null;
  await processarNovoPaciente(
    {
      body: {
        nome: "Fulano",
        telefone: "11988887777",
        tipo_convenio: "convenio",
        convenio_texto: "  Bússola Saúde  ",
      },
    },
    res,
    {
      buscarPacientePorTelefoneFn: async () => null,
      criarPaciente: async (dados) => { dadosCriados = dados; return { id: 42 }; },
    }
  );

  assert.equal(dadosCriados.convenio, "Bússola Saúde");
  assert.equal(dadosCriados.convenioId, null);
});
