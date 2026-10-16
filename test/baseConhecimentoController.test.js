import { test } from "node:test";
import assert from "node:assert/strict";
import {
  telaBaseConhecimento,
  telaNovaEntradaBaseConhecimento,
  processarNovaEntradaBaseConhecimento,
  telaEditarEntradaBaseConhecimento,
  processarEditarEntradaBaseConhecimento,
  processarDesativarEntradaBaseConhecimento,
  processarReativarEntradaBaseConhecimento,
} from "../src/controllers/baseConhecimentoController.js";

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

const ENTRADA = { id: 5, pergunta: "Vocês têm estacionamento?", resposta: "Sim.", categoria: "localizacao", ativo: true };

test("telaBaseConhecimento: renderiza a lista", async () => {
  const res = criarRespostaFalsa();
  await telaBaseConhecimento({ query: {} }, res, { listar: async () => [ENTRADA] });

  assert.equal(res.viewRenderizada, "baseConhecimento/lista");
  assert.deepEqual(res.dadosDaView.entradas, [ENTRADA]);
  assert.equal(res.dadosDaView.sucesso, false);
});

test("telaBaseConhecimento: sem ?todos, busca só ativos e mostrarTodos é false", async () => {
  const res = criarRespostaFalsa();
  let argumentoRecebido = "não chamado";
  await telaBaseConhecimento(
    { query: {} },
    res,
    { listar: async (opcoes) => { argumentoRecebido = opcoes; return []; } }
  );

  assert.deepEqual(argumentoRecebido, { apenasAtivos: true });
  assert.equal(res.dadosDaView.mostrarTodos, false);
});

test("telaBaseConhecimento: com ?todos=1, busca todos e mostrarTodos é true", async () => {
  const res = criarRespostaFalsa();
  let argumentoRecebido = "não chamado";
  await telaBaseConhecimento(
    { query: { todos: "1" } },
    res,
    { listar: async (opcoes) => { argumentoRecebido = opcoes; return []; } }
  );

  assert.deepEqual(argumentoRecebido, { apenasAtivos: false });
  assert.equal(res.dadosDaView.mostrarTodos, true);
});

test("telaNovaEntradaBaseConhecimento: renderiza o formulário com as categorias fixas", () => {
  const res = criarRespostaFalsa();
  telaNovaEntradaBaseConhecimento({}, res);

  assert.equal(res.viewRenderizada, "baseConhecimento/novo");
  assert.ok(res.dadosDaView.categorias.some((c) => c.valor === "geral"));
});

test("processarNovaEntradaBaseConhecimento: pergunta vazia responde 400 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarNovaEntradaBaseConhecimento(
    { body: { pergunta: "   ", resposta: "Sim" } },
    res,
    { criar: async () => { gravou = true; } }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(gravou, false);
});

test("processarNovaEntradaBaseConhecimento: resposta vazia responde 400 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarNovaEntradaBaseConhecimento(
    { body: { pergunta: "Tem estacionamento?", resposta: "  " } },
    res,
    { criar: async () => { gravou = true; } }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(gravou, false);
});

test("processarNovaEntradaBaseConhecimento: grava e redireciona com sucesso", async () => {
  const res = criarRespostaFalsa();
  let dadosGravados = null;
  await processarNovaEntradaBaseConhecimento(
    { body: { pergunta: "Tem estacionamento?", resposta: "Sim.", categoria: "localizacao" } },
    res,
    { criar: async (dados) => { dadosGravados = dados; return { id: 1, ...dados }; } }
  );

  assert.deepEqual(dadosGravados, {
    pergunta: "Tem estacionamento?",
    resposta: "Sim.",
    categoria: "localizacao",
  });
  assert.equal(res.redirectedTo, "/base-conhecimento?sucesso=1");
});

test("telaNovaEntradaBaseConhecimento: com ?sugestaoId, pré-preenche a pergunta e carrega o id da sugestão", () => {
  const res = criarRespostaFalsa();
  telaNovaEntradaBaseConhecimento({ query: { sugestaoId: "7", pergunta: "Tem plano X?" } }, res);

  assert.equal(res.dadosDaView.sugestaoId, 7);
  assert.equal(res.dadosDaView.perguntaSugerida, "Tem plano X?");
});

test("processarNovaEntradaBaseConhecimento: com sugestaoId, grava a entrada E marca a sugestão como aprovada", async () => {
  const res = criarRespostaFalsa();
  let idMarcado = null;
  let statusMarcado = null;
  await processarNovaEntradaBaseConhecimento(
    { body: { pergunta: "Tem plano X?", resposta: "Sim.", categoria: "convenios", sugestaoId: "7" } },
    res,
    {
      criar: async (dados) => ({ id: 1, ...dados }),
      marcarSugestaoAprovada: async (id, status) => { idMarcado = id; statusMarcado = status; },
    }
  );

  assert.equal(idMarcado, 7);
  assert.equal(statusMarcado, "aprovada");
  assert.equal(res.redirectedTo, "/base-conhecimento?sucesso=1");
});

test("processarNovaEntradaBaseConhecimento: sem sugestaoId, não tenta marcar sugestão nenhuma", async () => {
  const res = criarRespostaFalsa();
  let chamou = false;
  await processarNovaEntradaBaseConhecimento(
    { body: { pergunta: "Tem estacionamento?", resposta: "Sim." } },
    res,
    {
      criar: async (dados) => ({ id: 1, ...dados }),
      marcarSugestaoAprovada: async () => { chamou = true; },
    }
  );

  assert.equal(chamou, false);
});

test("telaEditarEntradaBaseConhecimento: 404 quando a entrada não existe", async () => {
  const res = criarRespostaFalsa();
  await telaEditarEntradaBaseConhecimento(
    { params: { id: "999" }, query: {} },
    res,
    { buscar: async () => null }
  );

  assert.equal(res.statusCode, 404);
});

test("telaEditarEntradaBaseConhecimento: renderiza o formulário preenchido", async () => {
  const res = criarRespostaFalsa();
  await telaEditarEntradaBaseConhecimento(
    { params: { id: "5" }, query: {} },
    res,
    { buscar: async () => ENTRADA }
  );

  assert.equal(res.viewRenderizada, "baseConhecimento/editar");
  assert.deepEqual(res.dadosDaView.entrada, ENTRADA);
});

test("processarEditarEntradaBaseConhecimento: pergunta vazia responde 400 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let atualizou = false;
  await processarEditarEntradaBaseConhecimento(
    { params: { id: "5" }, body: { pergunta: "  ", resposta: "Sim" } },
    res,
    { buscar: async () => ENTRADA, atualizar: async () => { atualizou = true; } }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(atualizou, false);
});

test("processarEditarEntradaBaseConhecimento: 404 quando a entrada não existe", async () => {
  const res = criarRespostaFalsa();
  await processarEditarEntradaBaseConhecimento(
    { params: { id: "999" }, body: { pergunta: "P", resposta: "R" } },
    res,
    { buscar: async () => null }
  );

  assert.equal(res.statusCode, 404);
});

test("processarEditarEntradaBaseConhecimento: atualiza e redireciona preservando ?todos=1", async () => {
  const res = criarRespostaFalsa();
  let idAtualizado = null;
  let dadosAtualizados = null;
  await processarEditarEntradaBaseConhecimento(
    { params: { id: "5" }, body: { pergunta: "Nova pergunta", resposta: "Nova resposta", categoria: "geral", todos: "1" } },
    res,
    {
      buscar: async () => ENTRADA,
      atualizar: async (id, dados) => { idAtualizado = id; dadosAtualizados = dados; return { ...ENTRADA, ...dados }; },
    }
  );

  assert.equal(idAtualizado, 5);
  assert.deepEqual(dadosAtualizados, { pergunta: "Nova pergunta", resposta: "Nova resposta", categoria: "geral" });
  assert.equal(res.redirectedTo, "/base-conhecimento?sucesso=1&todos=1");
});

test("processarDesativarEntradaBaseConhecimento: 404 quando a entrada não existe", async () => {
  const res = criarRespostaFalsa();
  await processarDesativarEntradaBaseConhecimento(
    { params: { id: "999" }, body: {} },
    res,
    { buscar: async () => null }
  );

  assert.equal(res.statusCode, 404);
});

test("processarDesativarEntradaBaseConhecimento: desativa e redireciona", async () => {
  const res = criarRespostaFalsa();
  let idDesativado = null;
  await processarDesativarEntradaBaseConhecimento(
    { params: { id: "5" }, body: {} },
    res,
    {
      buscar: async () => ENTRADA,
      definirAtivo: async (id) => { idDesativado = id; return { id, ativo: false }; },
    }
  );

  assert.equal(idDesativado, 5);
  assert.equal(res.redirectedTo, "/base-conhecimento?sucesso=1");
});

test("processarReativarEntradaBaseConhecimento: reativa e redireciona", async () => {
  const res = criarRespostaFalsa();
  let ativoDefinido = null;
  await processarReativarEntradaBaseConhecimento(
    { params: { id: "5" }, body: {} },
    res,
    {
      buscar: async () => ({ ...ENTRADA, ativo: false }),
      definirAtivo: async (id, ativo) => { ativoDefinido = ativo; return { id, ativo }; },
    }
  );

  assert.equal(ativoDefinido, true);
  assert.equal(res.redirectedTo, "/base-conhecimento?sucesso=1");
});
