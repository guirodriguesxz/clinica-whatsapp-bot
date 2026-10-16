import { test } from "node:test";
import assert from "node:assert/strict";
import { telaPrestador, processarPrestador } from "../src/controllers/prestadorController.js";

function criarRespostaFalsa() {
  return {
    statusCode: 200,
    redirectedTo: null,
    viewRenderizada: null,
    dadosDaView: null,
    status(code) { this.statusCode = code; return this; },
    send(corpo) { this.corpo = corpo; return this; },
    redirect(url) { this.redirectedTo = url; },
    render(view, dados) { this.viewRenderizada = view; this.dadosDaView = dados; },
  };
}

test("telaPrestador: sem dados cadastrados, renderiza com campos vazios", async () => {
  const res = criarRespostaFalsa();
  await telaPrestador({ query: {} }, res, { buscar: async () => null });

  assert.equal(res.viewRenderizada, "prestador/editar");
  assert.equal(res.dadosDaView.dados.cnes, null);
  assert.equal(res.dadosDaView.sucesso, false);
});

test("telaPrestador: com dados cadastrados, renderiza com os valores atuais", async () => {
  const res = criarRespostaFalsa();
  const dados = { cnes: "123456", razao_social: "Clínica Exemplo", cnpj: "00.000.000/0001-00" };
  await telaPrestador({ query: { sucesso: "1" } }, res, { buscar: async () => dados });

  assert.deepEqual(res.dadosDaView.dados, dados);
  assert.equal(res.dadosDaView.sucesso, true);
});

test("processarPrestador: trima campos e converte vazio em null", async () => {
  const res = criarRespostaFalsa();
  let dadosGravados = null;
  await processarPrestador(
    { body: { cnes: "  123456  ", razao_social: "", cnpj: "  " } },
    res,
    { salvar: async (dados) => { dadosGravados = dados; } }
  );

  assert.deepEqual(dadosGravados, {
    cnes: "123456",
    razaoSocial: null,
    cnpj: null,
    cboFisioterapia: null,
    cboPsicologia: null,
  });
  assert.equal(res.redirectedTo, "/configuracoes/prestador?sucesso=1");
});
