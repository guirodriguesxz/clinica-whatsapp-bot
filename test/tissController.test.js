// test/tissController.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { telaTiss, gerarLoteTiss } from "../src/controllers/tissController.js";

function criarRespostaFalsa() {
  return {
    statusCode: 200,
    corpo: null,
    headers: {},
    viewRenderizada: null,
    dadosDaView: null,
    status(code) { this.statusCode = code; return this; },
    send(corpo) { this.corpo = corpo; return this; },
    setHeader(nome, valor) { this.headers[nome] = valor; },
    render(view, dados) { this.viewRenderizada = view; this.dadosDaView = dados; },
  };
}

const CONVENIO = { id: 5, nome: "Mar Azul Saúde", codigo_prestador_na_operadora: "PRESTADOR123", numero_contrato: "CT-001" };
const PRESTADOR = { cnes: "123456", razao_social: "Clínica Exemplo", cnpj: null, cbo_fisioterapia: "2236-05", cbo_psicologia: "2515-05" };
const GUIA_PRONTA = { pagamento_id: 1, matricula_convenio: "MAT123", codigo_tuss: "10101012", descricao_tuss: "Sessão", paciente_nome: "João", sexo: "M", cns: "700123456789012", tipo_atendimento: "fisioterapia", data_atendimento: "2026-09-10", valor: "80.00" };

test("telaTiss: sem parâmetros, renderiza só o formulário (sem preview)", async () => {
  const res = criarRespostaFalsa();
  await telaTiss(
    { query: {} },
    res,
    { listarConvenios: async () => [CONVENIO] }
  );

  assert.equal(res.viewRenderizada, "financeiro/tiss");
  assert.equal(res.dadosDaView.preview, null);
  assert.equal(res.dadosDaView.carater, "eletiva");
});

test("telaTiss: carater inválido na query cai pro padrão 'eletiva'", async () => {
  const res = criarRespostaFalsa();
  await telaTiss(
    { query: { carater: "qualquer-coisa" } },
    res,
    { listarConvenios: async () => [CONVENIO] }
  );

  assert.equal(res.dadosDaView.carater, "eletiva");
});

test("telaTiss: carater='urgencia' na query é preservado", async () => {
  const res = criarRespostaFalsa();
  await telaTiss(
    { query: { convenioId: "5", inicio: "2026-09-01", fim: "2026-09-30", carater: "urgencia" } },
    res,
    {
      listarConvenios: async () => [CONVENIO],
      buscarConvenio: async () => CONVENIO,
      buscarPrestador: async () => PRESTADOR,
      buscarGuias: async () => [GUIA_PRONTA],
    }
  );

  assert.equal(res.dadosDaView.carater, "urgencia");
});

test("telaTiss: com parâmetros válidos, monta o preview com prontas/incompletas/motivosBloqueio", async () => {
  const res = criarRespostaFalsa();
  await telaTiss(
    { query: { convenioId: "5", inicio: "2026-09-01", fim: "2026-09-30" } },
    res,
    {
      listarConvenios: async () => [CONVENIO],
      buscarConvenio: async () => CONVENIO,
      buscarPrestador: async () => PRESTADOR,
      buscarGuias: async () => [GUIA_PRONTA],
    }
  );

  assert.equal(res.dadosDaView.preview.prontas.length, 1);
  assert.equal(res.dadosDaView.preview.incompletas.length, 0);
  assert.deepEqual(res.dadosDaView.preview.motivosBloqueio, []);
});

test("telaTiss: convênio inexistente responde 404", async () => {
  const res = criarRespostaFalsa();
  await telaTiss(
    { query: { convenioId: "5", inicio: "2026-09-01", fim: "2026-09-30" } },
    res,
    { listarConvenios: async () => [], buscarConvenio: async () => null }
  );

  assert.equal(res.statusCode, 404);
});

test("gerarLoteTiss: parâmetros ausentes respondem 400", async () => {
  const res = criarRespostaFalsa();
  await gerarLoteTiss({ query: {} }, res, {});
  assert.equal(res.statusCode, 400);
});

test("gerarLoteTiss: dados de prestador/convênio incompletos respondem 400 sem gerar XML", async () => {
  const res = criarRespostaFalsa();
  let gerou = false;
  await gerarLoteTiss(
    { query: { convenioId: "5", inicio: "2026-09-01", fim: "2026-09-30" } },
    res,
    {
      buscarConvenio: async () => ({ ...CONVENIO, numero_contrato: null }),
      buscarPrestador: async () => PRESTADOR,
      buscarGuias: async () => [GUIA_PRONTA],
      gerarXml: () => { gerou = true; return "<xml/>"; },
    }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(gerou, false);
});

test("gerarLoteTiss: nenhuma guia pronta no período responde 400 sem gerar XML", async () => {
  const res = criarRespostaFalsa();
  let gerou = false;
  await gerarLoteTiss(
    { query: { convenioId: "5", inicio: "2026-09-01", fim: "2026-09-30" } },
    res,
    {
      buscarConvenio: async () => CONVENIO,
      buscarPrestador: async () => PRESTADOR,
      buscarGuias: async () => [],
      gerarXml: () => { gerou = true; return "<xml/>"; },
    }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(gerou, false);
});

test("gerarLoteTiss: caminho feliz responde XML com Content-Disposition correto", async () => {
  const res = criarRespostaFalsa();
  let dadosPassadosPraXml = null;
  await gerarLoteTiss(
    { query: { convenioId: "5", inicio: "2026-09-01", fim: "2026-09-30" } },
    res,
    {
      buscarConvenio: async () => CONVENIO,
      buscarPrestador: async () => PRESTADOR,
      buscarGuias: async () => [GUIA_PRONTA],
      gerarXml: (dados) => { dadosPassadosPraXml = dados; return "<xml>ok</xml>"; },
    }
  );

  assert.equal(res.corpo, "<xml>ok</xml>");
  assert.equal(res.headers["Content-Type"], "application/xml; charset=utf-8");
  assert.match(res.headers["Content-Disposition"], /attachment; filename="tiss-lote-mar-azul-saude-2026-09-01-2026-09-30\.xml"/);
  assert.equal(dadosPassadosPraXml.guias[0].numeroGuiaPrestador, "1");
  assert.equal(dadosPassadosPraXml.guias[0].codigoTuss, "10101012");
  assert.equal(dadosPassadosPraXml.guias[0].pacienteSexo, "M");
  assert.equal(dadosPassadosPraXml.guias[0].pacienteCns, "700123456789012");
  assert.equal(dadosPassadosPraXml.guias[0].caraterAtendimento, "eletiva");
  assert.equal(dadosPassadosPraXml.guias[0].cboProfissional, "2236-05");
});

test("gerarLoteTiss: usa o carater da query e o CBO de psicologia quando o tipo de atendimento é psicologia", async () => {
  const res = criarRespostaFalsa();
  let dadosPassadosPraXml = null;
  const GUIA_PSICOLOGIA = { ...GUIA_PRONTA, tipo_atendimento: "psicologia" };
  await gerarLoteTiss(
    { query: { convenioId: "5", inicio: "2026-09-01", fim: "2026-09-30", carater: "urgencia" } },
    res,
    {
      buscarConvenio: async () => CONVENIO,
      buscarPrestador: async () => PRESTADOR,
      buscarGuias: async () => [GUIA_PSICOLOGIA],
      gerarXml: (dados) => { dadosPassadosPraXml = dados; return "<xml>ok</xml>"; },
    }
  );

  assert.equal(dadosPassadosPraXml.guias[0].caraterAtendimento, "urgencia");
  assert.equal(dadosPassadosPraXml.guias[0].cboProfissional, "2515-05");
});

test("gerarLoteTiss: lote misto (guia pronta + incompleta) gera XML só com a guia pronta", async () => {
  const res = criarRespostaFalsa();
  let dadosPassadosPraXml = null;
  const GUIA_INCOMPLETA = { ...GUIA_PRONTA, pagamento_id: 2, matricula_convenio: null };
  await gerarLoteTiss(
    { query: { convenioId: "5", inicio: "2026-09-01", fim: "2026-09-30" } },
    res,
    {
      buscarConvenio: async () => CONVENIO,
      buscarPrestador: async () => PRESTADOR,
      buscarGuias: async () => [GUIA_PRONTA, GUIA_INCOMPLETA],
      gerarXml: (dados) => { dadosPassadosPraXml = dados; return "<xml>ok</xml>"; },
    }
  );

  assert.notEqual(res.statusCode, 400);
  assert.equal(dadosPassadosPraXml.guias.length, 1);
  assert.equal(dadosPassadosPraXml.guias[0].numeroGuiaPrestador, "1");
  assert.equal(dadosPassadosPraXml.guias[0].codigoTuss, "10101012");
});
