import { test } from "node:test";
import assert from "node:assert/strict";
import {
  telaEditarPaciente,
  processarEditarPaciente,
  telaFichaPaciente,
} from "../src/controllers/dashboardController.js";

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

const PACIENTE = { id: 5, nome: "Ana", telefone: "5511999990000" };

const SEM_CONVENIOS = { listarConvenios: async () => [] };

test("telaEditarPaciente: id não numérico responde 404", async () => {
  const res = criarRespostaFalsa();
  await telaEditarPaciente({ params: { id: "abc" } }, res, SEM_CONVENIOS);
  assert.equal(res.statusCode, 404);
});

test("telaEditarPaciente: paciente inexistente responde 404", async () => {
  const res = criarRespostaFalsa();
  await telaEditarPaciente({ params: { id: "5" } }, res, { buscarPaciente: async () => null, ...SEM_CONVENIOS });
  assert.equal(res.statusCode, 404);
});

test("telaEditarPaciente: caminho feliz renderiza o formulário com os dados atuais e a lista de convênios", async () => {
  const res = criarRespostaFalsa();
  const conveniosFalsos = [{ id: 1, nome: "Mar Azul Saúde" }];
  await telaEditarPaciente(
    { params: { id: "5" } },
    res,
    { buscarPaciente: async () => PACIENTE, listarConvenios: async () => conveniosFalsos }
  );
  assert.equal(res.viewRenderizada, "pacientes/editar");
  assert.equal(res.dadosDaView.paciente.id, 5);
  assert.equal(res.dadosDaView.convenios, conveniosFalsos);
});

test("processarEditarPaciente: id não numérico responde 404", async () => {
  const res = criarRespostaFalsa();
  await processarEditarPaciente({ params: { id: "abc" }, body: {} }, res);
  assert.equal(res.statusCode, 404);
});

test("processarEditarPaciente: paciente inexistente responde 404", async () => {
  const res = criarRespostaFalsa();
  await processarEditarPaciente(
    { params: { id: "5" }, body: {} },
    res,
    { buscarPaciente: async () => null }
  );
  assert.equal(res.statusCode, 404);
});

test("processarEditarPaciente: data de nascimento inválida responde 400 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarEditarPaciente(
    { params: { id: "5" }, body: { data_nascimento: "31-02-2026" } },
    res,
    { buscarPaciente: async () => PACIENTE, atualizarPaciente: async () => { gravou = true; } }
  );
  assert.equal(res.statusCode, 400);
  assert.equal(gravou, false);
});

test("processarEditarPaciente: caminho feliz grava os campos e redireciona pra ficha", async () => {
  const res = criarRespostaFalsa();
  let campos = null;
  await processarEditarPaciente(
    {
      params: { id: "5" },
      body: {
        cpf: " 111.111.111-11 ",
        data_nascimento: "1990-01-01",
        rg: "",
        endereco: "Rua Teste",
        sexo: "F",
        cns: " 700123456789012 ",
        observacao: " Alérgica a dipirona. ",
      },
    },
    res,
    {
      buscarPaciente: async () => PACIENTE,
      atualizarPaciente: async (id, dados) => { campos = { id, ...dados }; },
    }
  );

  assert.equal(res.redirectedTo, "/pacientes/5/ficha");
  assert.equal(campos.id, 5);
  assert.equal(campos.cpf, "111.111.111-11", "campo com espaços deve vir trimado");
  assert.equal(campos.dataNascimento, "1990-01-01");
  assert.equal(campos.rg, null, "campo vazio vira null, não string vazia");
  assert.equal(campos.endereco, "Rua Teste");
  assert.equal(campos.sexo, "F");
  assert.equal(campos.cns, "700123456789012", "campo com espaços deve vir trimado");
  assert.equal(campos.observacao, "Alérgica a dipirona.", "campo com espaços deve vir trimado");
});

test("processarEditarPaciente: com convenio_id, repassa o id pro model", async () => {
  const res = criarRespostaFalsa();
  let campos = null;
  await processarEditarPaciente(
    { params: { id: "5" }, body: { convenio_id: "3" } },
    res,
    { buscarPaciente: async () => PACIENTE, atualizarPaciente: async (id, dados) => { campos = dados; } }
  );

  assert.equal(campos.convenioId, 3);
});

test("processarEditarPaciente: sem convenio_id (manter como está), repassa null", async () => {
  const res = criarRespostaFalsa();
  let campos = null;
  await processarEditarPaciente(
    { params: { id: "5" }, body: {} },
    res,
    { buscarPaciente: async () => PACIENTE, atualizarPaciente: async (id, dados) => { campos = dados; } }
  );

  assert.equal(campos.convenioId, null);
});

test("telaFichaPaciente: calcula idade a partir de data_nascimento", async () => {
  const res = criarRespostaFalsa();
  const pacienteComNascimento = { ...PACIENTE, data_nascimento: "1990-01-01" };
  await telaFichaPaciente(
    { params: { id: "5" } },
    res,
    {
      buscarPaciente: async () => pacienteComNascimento,
      buscarHistorico: async () => [],
      buscarPacotes: async () => [],
      buscarAvaliacoes: async () => [],
      buscarRelatorios: async () => [],
    }
  );
  assert.ok(res.dadosDaView.idade >= 35, "idade calculada deve ser um número plausível");
});

test("telaFichaPaciente: sem data_nascimento, idade é null", async () => {
  const res = criarRespostaFalsa();
  await telaFichaPaciente(
    { params: { id: "5" } },
    res,
    {
      buscarPaciente: async () => PACIENTE,
      buscarHistorico: async () => [],
      buscarPacotes: async () => [],
      buscarAvaliacoes: async () => [],
      buscarRelatorios: async () => [],
    }
  );
  assert.equal(res.dadosDaView.idade, null);
});
