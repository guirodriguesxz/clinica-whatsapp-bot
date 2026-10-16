import { test } from "node:test";
import assert from "node:assert/strict";
import {
  telaConvenios,
  telaNovoConvenio,
  processarNovoConvenio,
  telaEditarConvenio,
  processarEditarConvenio,
  processarDesativarConvenio,
  processarReativarConvenio,
} from "../src/controllers/convenioController.js";

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

const CONVENIO = { id: 5, nome: "Mar Azul Saúde", ativo: true, valor_repasse_avaliacao: 5.6, valor_repasse_sessao: 5.6 };

test("telaConvenios: renderiza a lista", async () => {
  const res = criarRespostaFalsa();
  await telaConvenios({ query: {} }, res, { listar: async () => [CONVENIO] });

  assert.equal(res.viewRenderizada, "convenios/lista");
  assert.deepEqual(res.dadosDaView.convenios, [CONVENIO]);
  assert.equal(res.dadosDaView.sucesso, false);
});

test("telaConvenios: sem ?todos, busca só ativos e mostrarTodos é false", async () => {
  const res = criarRespostaFalsa();
  let argumentoRecebido = "não chamado";
  await telaConvenios(
    { query: {} },
    res,
    { listar: async (opcoes) => { argumentoRecebido = opcoes; return []; } }
  );

  assert.deepEqual(argumentoRecebido, { apenasAtivos: true });
  assert.equal(res.dadosDaView.mostrarTodos, false);
});

test("telaConvenios: com ?todos=1, busca todos e mostrarTodos é true", async () => {
  const res = criarRespostaFalsa();
  let argumentoRecebido = "não chamado";
  await telaConvenios(
    { query: { todos: "1" } },
    res,
    { listar: async (opcoes) => { argumentoRecebido = opcoes; return []; } }
  );

  assert.deepEqual(argumentoRecebido, { apenasAtivos: false });
  assert.equal(res.dadosDaView.mostrarTodos, true);
});

test("telaNovoConvenio: renderiza o formulário", () => {
  const res = criarRespostaFalsa();
  telaNovoConvenio({}, res);

  assert.equal(res.viewRenderizada, "convenios/novo");
});

test("processarNovoConvenio: nome vazio responde 400 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarNovoConvenio(
    { body: { nome: "   " } },
    res,
    { criar: async () => { gravou = true; } }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(gravou, false);
});

test("processarNovoConvenio: caminho feliz grava (trimado) com valores de repasse e redireciona", async () => {
  const res = criarRespostaFalsa();
  let dadosGravados = null;
  await processarNovoConvenio(
    { body: { nome: "  Mar Azul Saúde  ", valor_repasse_avaliacao: "5,60", valor_repasse_sessao: "5.60" } },
    res,
    { criar: async (dados) => { dadosGravados = dados; } }
  );

  assert.deepEqual(dadosGravados, { nome: "Mar Azul Saúde", valorRepasseAvaliacao: 5.6, valorRepasseSessao: 5.6 });
  assert.equal(res.redirectedTo, "/convenios?sucesso=1");
});

test("processarNovoConvenio: valores de repasse vazios gravam null (não bloqueiam)", async () => {
  const res = criarRespostaFalsa();
  let dadosGravados = null;
  await processarNovoConvenio(
    { body: { nome: "Particular" } },
    res,
    { criar: async (dados) => { dadosGravados = dados; } }
  );

  assert.equal(dadosGravados.valorRepasseAvaliacao, null);
  assert.equal(dadosGravados.valorRepasseSessao, null);
});

test("processarNovoConvenio: valor de repasse negativo responde 400 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarNovoConvenio(
    { body: { nome: "Mar Azul Saúde", valor_repasse_avaliacao: "-5" } },
    res,
    { criar: async () => { gravou = true; } }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(gravou, false);
});

test("processarNovoConvenio: valor de repasse não-numérico responde 400 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarNovoConvenio(
    { body: { nome: "Mar Azul Saúde", valor_repasse_sessao: "abc" } },
    res,
    { criar: async () => { gravou = true; } }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(gravou, false);
});

test("telaEditarConvenio: id não numérico responde 404", async () => {
  const res = criarRespostaFalsa();
  await telaEditarConvenio({ params: { id: "abc" } }, res);

  assert.equal(res.statusCode, 404);
});

test("telaEditarConvenio: convênio inexistente responde 404", async () => {
  const res = criarRespostaFalsa();
  await telaEditarConvenio({ params: { id: "5" } }, res, { buscar: async () => null });

  assert.equal(res.statusCode, 404);
});

test("telaEditarConvenio: caminho feliz renderiza com os dados atuais", async () => {
  const res = criarRespostaFalsa();
  await telaEditarConvenio({ params: { id: "5" }, query: {} }, res, { buscar: async () => CONVENIO, listarTuss: async () => [] });

  assert.equal(res.viewRenderizada, "convenios/editar");
  assert.equal(res.dadosDaView.convenio.id, 5);
  assert.equal(res.dadosDaView.mostrarTodos, false);
});

test("processarEditarConvenio: nome vazio responde 400 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarEditarConvenio(
    { params: { id: "5" }, body: { nome: "" } },
    res,
    { buscar: async () => CONVENIO, atualizar: async () => { gravou = true; } }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(gravou, false);
});

test("processarEditarConvenio: valor de repasse inválido responde 400 sem consultar/gravar", async () => {
  const res = criarRespostaFalsa();
  let buscou = false;
  await processarEditarConvenio(
    { params: { id: "5" }, body: { nome: "Mar Azul Saúde", valor_repasse_avaliacao: "abc" } },
    res,
    { buscar: async () => { buscou = true; return CONVENIO; } }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(buscou, false);
});

test("processarEditarConvenio: convênio inexistente responde 404", async () => {
  const res = criarRespostaFalsa();
  await processarEditarConvenio(
    { params: { id: "5" }, body: { nome: "Novo Nome" } },
    res,
    { buscar: async () => null }
  );

  assert.equal(res.statusCode, 404);
});

test("processarEditarConvenio: caminho feliz grava e redireciona", async () => {
  const res = criarRespostaFalsa();
  let idAtualizado = null;
  let dadosAtualizados = null;
  await processarEditarConvenio(
    { params: { id: "5" }, body: { nome: "  Mar Azul Saúde Novo  ", valor_repasse_avaliacao: "6", valor_repasse_sessao: "7" } },
    res,
    {
      buscar: async () => CONVENIO,
      atualizar: async (id, dados) => { idAtualizado = id; dadosAtualizados = dados; },
      salvarTuss: async () => {},
    }
  );

  assert.equal(idAtualizado, 5);
  assert.deepEqual(dadosAtualizados, {
    nome: "Mar Azul Saúde Novo",
    valorRepasseAvaliacao: 6,
    valorRepasseSessao: 7,
    codigoPrestadorNaOperadora: null,
    numeroContrato: null,
  });
  assert.equal(res.redirectedTo, "/convenios?sucesso=1");
});

test("processarEditarConvenio: com body.todos=1, preserva o filtro no redirect", async () => {
  const res = criarRespostaFalsa();
  await processarEditarConvenio(
    { params: { id: "5" }, body: { nome: "Nome Corrigido", todos: "1" } },
    res,
    { buscar: async () => CONVENIO, atualizar: async () => {}, salvarTuss: async () => {} }
  );

  assert.equal(res.redirectedTo, "/convenios?sucesso=1&todos=1");
});

test("telaEditarConvenio: monta procedimentosTussPorChave a partir das linhas cadastradas", async () => {
  const res = criarRespostaFalsa();
  await telaEditarConvenio(
    { params: { id: "5" }, query: {} },
    res,
    {
      buscar: async () => CONVENIO,
      listarTuss: async () => [
        { tipo_atendimento: "fisioterapia", categoria: "sessao", codigo_tuss: "10101012", descricao_tuss: "Sessão" },
      ],
    }
  );

  assert.deepEqual(res.dadosDaView.procedimentosTussPorChave.fisioterapia_sessao, {
    codigo_tuss: "10101012", descricao_tuss: "Sessão",
  });
  assert.equal(res.dadosDaView.procedimentosTussPorChave.fisioterapia_avaliacao, undefined);
});

test("processarEditarConvenio: grava codigo_prestador_na_operadora/numero_contrato e chama salvarProcedimentosTuss com as 4 combinações", async () => {
  const res = criarRespostaFalsa();
  let dadosAtualizados = null;
  let linhasTussSalvas = null;
  await processarEditarConvenio(
    {
      params: { id: "5" },
      body: {
        nome: "Mar Azul Saúde",
        codigo_prestador_na_operadora: "PRESTADOR123",
        numero_contrato: "CT-001",
        tuss_fisioterapia_avaliacao_codigo: "10101020",
        tuss_fisioterapia_avaliacao_descricao: "Avaliação fisioterapêutica",
        tuss_fisioterapia_sessao_codigo: "",
        tuss_psicologia_avaliacao_codigo: "",
        tuss_psicologia_sessao_codigo: "",
      },
    },
    res,
    {
      buscar: async () => CONVENIO,
      atualizar: async (id, dados) => { dadosAtualizados = { id, dados }; },
      salvarTuss: async (id, linhas) => { linhasTussSalvas = { id, linhas }; },
    }
  );

  assert.equal(dadosAtualizados.dados.codigoPrestadorNaOperadora, "PRESTADOR123");
  assert.equal(dadosAtualizados.dados.numeroContrato, "CT-001");
  assert.equal(linhasTussSalvas.id, 5);
  assert.deepEqual(linhasTussSalvas.linhas, [
    { tipoAtendimento: "fisioterapia", categoria: "avaliacao", codigoTuss: "10101020", descricaoTuss: "Avaliação fisioterapêutica" },
    { tipoAtendimento: "fisioterapia", categoria: "sessao", codigoTuss: null, descricaoTuss: null },
    { tipoAtendimento: "psicologia", categoria: "avaliacao", codigoTuss: null, descricaoTuss: null },
    { tipoAtendimento: "psicologia", categoria: "sessao", codigoTuss: null, descricaoTuss: null },
  ]);
  assert.equal(res.redirectedTo, "/convenios?sucesso=1");
});

test("processarDesativarConvenio: convênio inexistente responde 404", async () => {
  const res = criarRespostaFalsa();
  await processarDesativarConvenio({ params: { id: "5" } }, res, { buscar: async () => null });

  assert.equal(res.statusCode, 404);
});

test("processarDesativarConvenio: caminho feliz define ativo=false e redireciona", async () => {
  const res = criarRespostaFalsa();
  let chamada = null;
  await processarDesativarConvenio(
    { params: { id: "5" } },
    res,
    { buscar: async () => CONVENIO, definirAtivo: async (id, ativo) => { chamada = { id, ativo }; } }
  );

  assert.deepEqual(chamada, { id: 5, ativo: false });
  assert.equal(res.redirectedTo, "/convenios?sucesso=1");
});

test("processarReativarConvenio: caminho feliz define ativo=true e redireciona", async () => {
  const res = criarRespostaFalsa();
  let chamada = null;
  await processarReativarConvenio(
    { params: { id: "5" } },
    res,
    { buscar: async () => CONVENIO, definirAtivo: async (id, ativo) => { chamada = { id, ativo }; } }
  );

  assert.deepEqual(chamada, { id: 5, ativo: true });
  assert.equal(res.redirectedTo, "/convenios?sucesso=1");
});
