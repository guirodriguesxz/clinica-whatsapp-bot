import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validarArquivoFoto,
  telaPsicologos,
  telaNovoPsicologo,
  processarNovoPsicologo,
  telaEditarPsicologo,
  processarEditarPsicologo,
  processarDesativarPsicologo,
  processarReativarPsicologo,
  servirFotoPsicologo,
  gerarPdfTermoCienciaPsicologiaController,
} from "../src/controllers/psicologoController.js";

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

const PSICOLOGO = { id: 5, nome: "Ana", ativo: true, temFoto: false };

test("validarArquivoFoto: sem arquivo é válido (upload opcional)", () => {
  assert.equal(validarArquivoFoto(undefined), null);
});

test("validarArquivoFoto: rejeita mimetype fora de PNG/JPEG", () => {
  const erro = validarArquivoFoto({ mimetype: "application/pdf", size: 100 });
  assert.match(erro, /PNG ou JPEG/);
});

test("validarArquivoFoto: aceita PNG dentro do limite com bytes mágicos corretos", () => {
  const erro = validarArquivoFoto({
    mimetype: "image/png",
    size: 1024,
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  });
  assert.equal(erro, null);
});

test("telaPsicologos: renderiza a lista", async () => {
  const res = criarRespostaFalsa();
  await telaPsicologos({ query: {} }, res, { listar: async () => [PSICOLOGO] });

  assert.equal(res.viewRenderizada, "psicologos/lista");
  assert.deepEqual(res.dadosDaView.psicologos, [PSICOLOGO]);
  assert.equal(res.dadosDaView.sucesso, false);
});

test("telaPsicologos: sem ?todos, busca só ativos e mostrarTodos é false", async () => {
  const res = criarRespostaFalsa();
  let argumentoRecebido = "não chamado";
  await telaPsicologos(
    { query: {} },
    res,
    { listar: async (opcoes) => { argumentoRecebido = opcoes; return []; } }
  );

  assert.deepEqual(argumentoRecebido, { apenasAtivos: true });
  assert.equal(res.dadosDaView.mostrarTodos, false);
});

test("telaPsicologos: com ?todos=1, busca todos e mostrarTodos é true", async () => {
  const res = criarRespostaFalsa();
  let argumentoRecebido = "não chamado";
  await telaPsicologos(
    { query: { todos: "1" } },
    res,
    { listar: async (opcoes) => { argumentoRecebido = opcoes; return []; } }
  );

  assert.deepEqual(argumentoRecebido, { apenasAtivos: false });
  assert.equal(res.dadosDaView.mostrarTodos, true);
});

test("telaNovoPsicologo: renderiza o formulário", () => {
  const res = criarRespostaFalsa();
  telaNovoPsicologo({}, res);

  assert.equal(res.viewRenderizada, "psicologos/novo");
});

test("processarNovoPsicologo: nome vazio responde 400 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarNovoPsicologo(
    { body: { nome: "   " } },
    res,
    { criar: async () => { gravou = true; } }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(gravou, false);
});

test("processarNovoPsicologo: caminho feliz sem foto grava com foto null e redireciona", async () => {
  const res = criarRespostaFalsa();
  let dadosGravados = null;
  await processarNovoPsicologo(
    { body: { nome: "  Ana Nova  " } },
    res,
    { criar: async (dados) => { dadosGravados = dados; } }
  );

  assert.deepEqual(dadosGravados, { nome: "Ana Nova", fotoImagem: null, fotoMime: null });
  assert.equal(res.redirectedTo, "/psicologos?sucesso=1");
});

test("processarNovoPsicologo: arquivo de foto inválido responde 400 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarNovoPsicologo(
    { body: { nome: "Ana" }, file: { mimetype: "application/pdf", size: 100 } },
    res,
    { criar: async () => { gravou = true; } }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(gravou, false);
});

test("processarNovoPsicologo: caminho feliz com foto grava buffer e mime", async () => {
  const res = criarRespostaFalsa();
  const bufferFalso = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from("foto")]);
  let dadosGravados = null;
  await processarNovoPsicologo(
    { body: { nome: "Ana" }, file: { buffer: bufferFalso, mimetype: "image/png", size: 100 } },
    res,
    { criar: async (dados) => { dadosGravados = dados; } }
  );

  assert.equal(dadosGravados.fotoImagem, bufferFalso);
  assert.equal(dadosGravados.fotoMime, "image/png");
});

test("telaEditarPsicologo: id não numérico responde 404", async () => {
  const res = criarRespostaFalsa();
  await telaEditarPsicologo({ params: { id: "abc" } }, res);

  assert.equal(res.statusCode, 404);
});

test("telaEditarPsicologo: psicólogo inexistente responde 404", async () => {
  const res = criarRespostaFalsa();
  await telaEditarPsicologo({ params: { id: "5" } }, res, { buscar: async () => null });

  assert.equal(res.statusCode, 404);
});

test("telaEditarPsicologo: caminho feliz renderiza com os dados atuais", async () => {
  const res = criarRespostaFalsa();
  await telaEditarPsicologo({ params: { id: "5" }, query: {} }, res, { buscar: async () => PSICOLOGO });

  assert.equal(res.viewRenderizada, "psicologos/editar");
  assert.equal(res.dadosDaView.psicologo.id, 5);
  assert.equal(res.dadosDaView.mostrarTodos, false);
});

test("telaEditarPsicologo: com ?todos=1, passa mostrarTodos=true pra view", async () => {
  const res = criarRespostaFalsa();
  await telaEditarPsicologo(
    { params: { id: "5" }, query: { todos: "1" } },
    res,
    { buscar: async () => PSICOLOGO }
  );

  assert.equal(res.dadosDaView.mostrarTodos, true);
});

test("processarEditarPsicologo: nome vazio responde 400 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarEditarPsicologo(
    { params: { id: "5" }, body: { nome: "" } },
    res,
    { buscar: async () => PSICOLOGO, atualizar: async () => { gravou = true; } }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(gravou, false);
});

test("processarEditarPsicologo: psicólogo inexistente responde 404", async () => {
  const res = criarRespostaFalsa();
  await processarEditarPsicologo(
    { params: { id: "5" }, body: { nome: "Novo Nome" } },
    res,
    { buscar: async () => null }
  );

  assert.equal(res.statusCode, 404);
});

test("processarEditarPsicologo: caminho feliz grava e redireciona", async () => {
  const res = criarRespostaFalsa();
  let idAtualizado = null;
  let nomeAtualizado = null;
  await processarEditarPsicologo(
    { params: { id: "5" }, body: { nome: "  Nome Corrigido  " } },
    res,
    {
      buscar: async () => PSICOLOGO,
      atualizar: async (id, nome) => { idAtualizado = id; nomeAtualizado = nome; },
    }
  );

  assert.equal(idAtualizado, 5);
  assert.equal(nomeAtualizado, "Nome Corrigido");
  assert.equal(res.redirectedTo, "/psicologos?sucesso=1");
});

test("processarEditarPsicologo: com body.todos=1, preserva o filtro no redirect", async () => {
  const res = criarRespostaFalsa();
  await processarEditarPsicologo(
    { params: { id: "5" }, body: { nome: "Nome Corrigido", todos: "1" } },
    res,
    { buscar: async () => PSICOLOGO, atualizar: async () => {} }
  );

  assert.equal(res.redirectedTo, "/psicologos?sucesso=1&todos=1");
});

test("processarEditarPsicologo: arquivo de foto inválido responde 400 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarEditarPsicologo(
    { params: { id: "5" }, body: { nome: "Ana" }, file: { mimetype: "application/pdf", size: 100 } },
    res,
    { buscar: async () => PSICOLOGO, atualizar: async () => { gravou = true; } }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(gravou, false);
});

test("processarEditarPsicologo: sem foto nova, não chama atualizarFoto", async () => {
  const res = criarRespostaFalsa();
  let chamouAtualizarFoto = false;
  await processarEditarPsicologo(
    { params: { id: "5" }, body: { nome: "Ana Corrigida" } },
    res,
    {
      buscar: async () => PSICOLOGO,
      atualizar: async () => {},
      atualizarFoto: async () => { chamouAtualizarFoto = true; },
    }
  );

  assert.equal(chamouAtualizarFoto, false);
  assert.equal(res.redirectedTo, "/psicologos?sucesso=1");
});

test("processarEditarPsicologo: com foto nova, chama atualizarFoto com id/buffer/mime", async () => {
  const res = criarRespostaFalsa();
  const bufferFalso = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("nova-foto")]);
  let dadosFoto = null;
  await processarEditarPsicologo(
    {
      params: { id: "5" },
      body: { nome: "Ana" },
      file: { buffer: bufferFalso, mimetype: "image/jpeg", size: 100 },
    },
    res,
    {
      buscar: async () => PSICOLOGO,
      atualizar: async () => {},
      atualizarFoto: async (id, dados) => { dadosFoto = { id, ...dados }; },
    }
  );

  assert.deepEqual(dadosFoto, { id: 5, fotoImagem: bufferFalso, fotoMime: "image/jpeg" });
});

test("servirFotoPsicologo: sem foto responde 404", async () => {
  const res = criarRespostaFalsa();
  await servirFotoPsicologo(
    { params: { id: "5" } }, res,
    { buscarFoto: async () => null }
  );

  assert.equal(res.statusCode, 404);
});

test("servirFotoPsicologo: caminho feliz responde a imagem com o Content-Type certo", async () => {
  const res = criarRespostaFalsa();
  const bufferFalso = Buffer.from("foto");
  await servirFotoPsicologo(
    { params: { id: "5" } }, res,
    { buscarFoto: async () => ({ fotoImagem: bufferFalso, fotoMime: "image/png" }) }
  );

  assert.equal(res.headers["Content-Type"], "image/png");
  assert.equal(res.corpo, bufferFalso);
});

test("gerarPdfTermoCienciaPsicologiaController: responde o PDF com Content-Type e Content-Disposition certos", async () => {
  const res = criarRespostaFalsa();
  const bufferFalso = Buffer.from("%PDF-fake");
  await gerarPdfTermoCienciaPsicologiaController(
    {}, res,
    { gerarPdf: async () => bufferFalso }
  );

  assert.equal(res.headers["Content-Type"], "application/pdf");
  assert.match(res.headers["Content-Disposition"], /attachment; filename="termo-ciencia-psicologia\.pdf"/);
  assert.equal(res.corpo, bufferFalso);
});

test("processarDesativarPsicologo: psicólogo inexistente responde 404", async () => {
  const res = criarRespostaFalsa();
  await processarDesativarPsicologo({ params: { id: "5" } }, res, { buscar: async () => null });

  assert.equal(res.statusCode, 404);
});

test("processarDesativarPsicologo: caminho feliz define ativo=false e redireciona", async () => {
  const res = criarRespostaFalsa();
  let chamada = null;
  await processarDesativarPsicologo(
    { params: { id: "5" } },
    res,
    { buscar: async () => PSICOLOGO, definirAtivo: async (id, ativo) => { chamada = { id, ativo }; } }
  );

  assert.deepEqual(chamada, { id: 5, ativo: false });
  assert.equal(res.redirectedTo, "/psicologos?sucesso=1");
});

test("processarDesativarPsicologo: com body.todos=1, preserva o filtro no redirect", async () => {
  const res = criarRespostaFalsa();
  await processarDesativarPsicologo(
    { params: { id: "5" }, body: { todos: "1" } },
    res,
    { buscar: async () => PSICOLOGO, definirAtivo: async () => {} }
  );

  assert.equal(res.redirectedTo, "/psicologos?sucesso=1&todos=1");
});

test("processarReativarPsicologo: caminho feliz define ativo=true e redireciona", async () => {
  const res = criarRespostaFalsa();
  let chamada = null;
  await processarReativarPsicologo(
    { params: { id: "5" } },
    res,
    { buscar: async () => PSICOLOGO, definirAtivo: async (id, ativo) => { chamada = { id, ativo }; } }
  );

  assert.deepEqual(chamada, { id: 5, ativo: true });
  assert.equal(res.redirectedTo, "/psicologos?sucesso=1");
});

test("processarReativarPsicologo: com body.todos=1, preserva o filtro no redirect", async () => {
  const res = criarRespostaFalsa();
  await processarReativarPsicologo(
    { params: { id: "5" }, body: { todos: "1" } },
    res,
    { buscar: async () => PSICOLOGO, definirAtivo: async () => {} }
  );

  assert.equal(res.redirectedTo, "/psicologos?sucesso=1&todos=1");
});
