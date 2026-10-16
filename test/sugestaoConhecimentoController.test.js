import { test } from "node:test";
import assert from "node:assert/strict";
import {
  telaSugestoesConhecimento,
  processarDescartarSugestaoConhecimento,
} from "../src/controllers/sugestaoConhecimentoController.js";

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

const SUGESTAO = { id: 3, pergunta: "Vocês atendem convênio X?", paciente_nome: "Ana", status: "pendente" };

test("telaSugestoesConhecimento: renderiza a lista de pendentes", async () => {
  const res = criarRespostaFalsa();
  await telaSugestoesConhecimento({}, res, { listar: async () => [SUGESTAO] });

  assert.equal(res.viewRenderizada, "sugestoesConhecimento/lista");
  assert.deepEqual(res.dadosDaView.sugestoes, [SUGESTAO]);
});

test("processarDescartarSugestaoConhecimento: 404 quando a sugestão não existe", async () => {
  const res = criarRespostaFalsa();
  await processarDescartarSugestaoConhecimento(
    { params: { id: "999" } },
    res,
    { buscar: async () => null }
  );

  assert.equal(res.statusCode, 404);
});

test("processarDescartarSugestaoConhecimento: marca como descartada e redireciona", async () => {
  const res = criarRespostaFalsa();
  let idMarcado = null;
  let statusMarcado = null;
  await processarDescartarSugestaoConhecimento(
    { params: { id: "3" } },
    res,
    {
      buscar: async () => SUGESTAO,
      definirStatus: async (id, status) => { idMarcado = id; statusMarcado = status; },
    }
  );

  assert.equal(idMarcado, 3);
  assert.equal(statusMarcado, "descartada");
  assert.equal(res.redirectedTo, "/sugestoes-conhecimento");
});
