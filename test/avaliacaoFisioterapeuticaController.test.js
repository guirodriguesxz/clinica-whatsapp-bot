// test/avaliacaoFisioterapeuticaController.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  telaNovaAvaliacao,
  processarNovaAvaliacao,
  telaEditarAvaliacao,
  processarEditarAvaliacao,
  gerarPdfAvaliacaoController,
} from "../src/controllers/avaliacaoFisioterapeuticaController.js";

function criarRespostaFalsa() {
  return {
    statusCode: 200,
    corpo: null,
    headers: {},
    redirectedTo: null,
    viewRenderizada: null,
    dadosDaView: null,
    status(code) { this.statusCode = code; return this; },
    send(corpo) { this.corpo = corpo; return this; },
    setHeader(nome, valor) { this.headers[nome] = valor; },
    redirect(url) { this.redirectedTo = url; },
    render(view, dados) { this.viewRenderizada = view; this.dadosDaView = dados; },
  };
}

const PACIENTE = { id: 7, nome: "Ana Silva" };
const AVALIACAO = {
  id: 5, pacienteId: 7, dataAvaliacao: "2026-09-01",
  estaGravida: "Não", possuiMarcapasso: null, possuiProteseMetalicaImplantes: null,
  possuiDoencasCardiacas: null, possuiHipertensaoArterial: null, possuiDiabetes: "Sim",
  possuiEpilepsia: null, possuiHistoricoCancer: null, medicamentosContinuosQuais: null,
  cirurgiaQual: null, cirurgiaQuando: null, tempoUltimaCirurgia: null,
  dorAtualLocal: "Lombar", dorAtualIntensidade: "7", limitacoesFuncionaisQuais: null,
  fisioterapiaAnteriormente: "Não", objetivosTratamento: "Reduzir dor", condutasPropostas: "Fortalecimento",
};

test("telaNovaAvaliacao: paciente inexistente responde 404", async () => {
  const res = criarRespostaFalsa();
  await telaNovaAvaliacao({ params: { id: "7" } }, res, { buscarPaciente: async () => null });
  assert.equal(res.statusCode, 404);
});

test("telaNovaAvaliacao: caminho feliz renderiza o formulário sem avaliacao", async () => {
  const res = criarRespostaFalsa();
  await telaNovaAvaliacao({ params: { id: "7" } }, res, { buscarPaciente: async () => PACIENTE });

  assert.equal(res.viewRenderizada, "avaliacoes/formulario");
  assert.equal(res.dadosDaView.paciente, PACIENTE);
  assert.equal(res.dadosDaView.avaliacao, null);
  assert.equal(res.dadosDaView.acaoForm, "/pacientes/7/avaliacoes/nova");
});

test("processarNovaAvaliacao: data inválida responde 400 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarNovaAvaliacao(
    { params: { id: "7" }, body: { data_avaliacao: "não-é-data" }, usuarioAtual: { id: 2 } },
    res,
    { buscarPaciente: async () => PACIENTE, criar: async () => { gravou = true; } }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(gravou, false);
});

test("processarNovaAvaliacao: caminho feliz grava com registradoPor do usuário logado e redireciona pra ficha", async () => {
  const res = criarRespostaFalsa();
  let dadosGravados = null;
  await processarNovaAvaliacao(
    {
      params: { id: "7" },
      body: {
        data_avaliacao: "2026-09-01", esta_gravida: "Não", possui_diabetes: "Sim",
        dor_atual_local: "Lombar", dor_atual_intensidade: "7",
        objetivos_tratamento: "Reduzir dor", condutas_propostas: "Fortalecimento",
      },
      usuarioAtual: { id: 2 },
    },
    res,
    { buscarPaciente: async () => PACIENTE, criar: async (dados) => { dadosGravados = dados; return 42; } }
  );

  assert.equal(dadosGravados.pacienteId, 7);
  assert.equal(dadosGravados.dataAvaliacao, "2026-09-01");
  assert.equal(dadosGravados.estaGravida, "Não");
  assert.equal(dadosGravados.possuiDiabetes, "Sim");
  assert.equal(dadosGravados.dorAtualLocal, "Lombar");
  assert.equal(dadosGravados.registradoPor, 2);
  assert.equal(res.redirectedTo, "/pacientes/7/ficha");
});

test("telaEditarAvaliacao: avaliação inexistente (ou de outro paciente) responde 404", async () => {
  const res = criarRespostaFalsa();
  await telaEditarAvaliacao(
    { params: { id: "7", avaliacaoId: "5" } },
    res,
    { buscarPaciente: async () => PACIENTE, buscarAvaliacao: async () => null }
  );

  assert.equal(res.statusCode, 404);
});

test("telaEditarAvaliacao: caminho feliz renderiza o formulário pré-preenchido", async () => {
  const res = criarRespostaFalsa();
  await telaEditarAvaliacao(
    { params: { id: "7", avaliacaoId: "5" } },
    res,
    { buscarPaciente: async () => PACIENTE, buscarAvaliacao: async () => AVALIACAO }
  );

  assert.equal(res.viewRenderizada, "avaliacoes/formulario");
  assert.equal(res.dadosDaView.avaliacao, AVALIACAO);
  assert.equal(res.dadosDaView.acaoForm, "/pacientes/7/avaliacoes/5/editar");
});

test("processarEditarAvaliacao: avaliação inexistente responde 404 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarEditarAvaliacao(
    { params: { id: "7", avaliacaoId: "5" }, body: { data_avaliacao: "2026-09-01" } },
    res,
    { buscarAvaliacao: async () => null, atualizar: async () => { gravou = true; } }
  );

  assert.equal(res.statusCode, 404);
  assert.equal(gravou, false);
});

test("processarEditarAvaliacao: caminho feliz grava e redireciona pra ficha", async () => {
  const res = criarRespostaFalsa();
  let idAtualizado = null;
  let dadosAtualizados = null;
  await processarEditarAvaliacao(
    {
      params: { id: "7", avaliacaoId: "5" },
      body: { data_avaliacao: "2026-09-05", possui_diabetes: "Sim", condutas_propostas: "Novo plano" },
    },
    res,
    {
      buscarAvaliacao: async () => AVALIACAO,
      atualizar: async (id, dados) => { idAtualizado = id; dadosAtualizados = dados; },
    }
  );

  assert.equal(idAtualizado, 5);
  assert.equal(dadosAtualizados.dataAvaliacao, "2026-09-05");
  assert.equal(dadosAtualizados.possuiDiabetes, "Sim");
  assert.equal(dadosAtualizados.condutasPropostas, "Novo plano");
  assert.equal(res.redirectedTo, "/pacientes/7/ficha");
});

test("gerarPdfAvaliacaoController: avaliação inexistente responde 404", async () => {
  const res = criarRespostaFalsa();
  await gerarPdfAvaliacaoController(
    { params: { id: "7", avaliacaoId: "5" } },
    res,
    { buscarPaciente: async () => PACIENTE, buscarAvaliacao: async () => null }
  );

  assert.equal(res.statusCode, 404);
});

test("gerarPdfAvaliacaoController: caminho feliz responde PDF com Content-Disposition correto", async () => {
  const res = criarRespostaFalsa();
  let dadosPassadosPraPdf = null;
  await gerarPdfAvaliacaoController(
    { params: { id: "7", avaliacaoId: "5" } },
    res,
    {
      buscarPaciente: async () => PACIENTE,
      buscarAvaliacao: async () => AVALIACAO,
      gerarPdf: (dados) => { dadosPassadosPraPdf = dados; return Promise.resolve(Buffer.from("PDF-FAKE")); },
    }
  );

  assert.equal(res.corpo.toString(), "PDF-FAKE");
  assert.equal(res.headers["Content-Type"], "application/pdf");
  assert.match(res.headers["Content-Disposition"], /attachment; filename="avaliacao-ana-silva-2026-09-01\.pdf"/);
  assert.equal(dadosPassadosPraPdf.pacienteNome, "Ana Silva");
  assert.equal(dadosPassadosPraPdf.dataAvaliacao, "2026-09-01");
});
