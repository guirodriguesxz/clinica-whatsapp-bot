// test/fisioterapeutaController.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validarArquivoAssinatura,
  telaFisioterapeutas,
  telaNovoFisioterapeuta,
  processarNovoFisioterapeuta,
  telaEditarFisioterapeuta,
  processarEditarFisioterapeuta,
  processarDesativarFisioterapeuta,
  processarReativarFisioterapeuta,
  servirAssinaturaFisioterapeuta,
} from "../src/controllers/fisioterapeutaController.js";

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

const FISIOTERAPEUTA = { id: 5, nome: "Ana", crefito: "1234-F", ativo: true, temAssinatura: false };

test("validarArquivoAssinatura: sem arquivo é válido (upload opcional)", () => {
  assert.equal(validarArquivoAssinatura(undefined), null);
});

test("validarArquivoAssinatura: rejeita mimetype fora de PNG/JPEG", () => {
  const erro = validarArquivoAssinatura({ mimetype: "application/pdf", size: 100 });
  assert.match(erro, /PNG ou JPEG/);
});

test("validarArquivoAssinatura: rejeita arquivo maior que 2MB", () => {
  const erro = validarArquivoAssinatura({ mimetype: "image/png", size: 3 * 1024 * 1024 });
  assert.match(erro, /máximo 2MB/);
});

test("validarArquivoAssinatura: aceita PNG dentro do limite", () => {
  const erro = validarArquivoAssinatura({
    mimetype: "image/png",
    size: 1024,
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  });
  assert.equal(erro, null);
});

test("validarArquivoAssinatura: rejeita mimetype PNG cujos bytes não são de fato um PNG", () => {
  const erro = validarArquivoAssinatura({
    mimetype: "image/png",
    size: 1024,
    buffer: Buffer.from("isso não é uma imagem de verdade"),
  });
  assert.match(erro, /não parece ser uma imagem/);
});

test("validarArquivoAssinatura: aceita JPEG com bytes mágicos corretos", () => {
  const erro = validarArquivoAssinatura({
    mimetype: "image/jpeg",
    size: 1024,
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  });
  assert.equal(erro, null);
});

test("telaNovoFisioterapeuta: renderiza o formulário", () => {
  const res = criarRespostaFalsa();
  telaNovoFisioterapeuta({}, res);
  assert.equal(res.viewRenderizada, "fisioterapeutas/novo");
});

test("telaFisioterapeutas: sem ?todos, busca só ativos", async () => {
  const res = criarRespostaFalsa();
  let argumentoRecebido = null;
  await telaFisioterapeutas(
    { query: {} }, res,
    { listar: async (opcoes) => { argumentoRecebido = opcoes; return [FISIOTERAPEUTA]; } }
  );

  assert.deepEqual(argumentoRecebido, { apenasAtivos: true });
  assert.deepEqual(res.dadosDaView.fisioterapeutas, [FISIOTERAPEUTA]);
});

test("processarNovoFisioterapeuta: nome vazio responde 400 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarNovoFisioterapeuta(
    { body: { nome: "  " } }, res,
    { criar: async () => { gravou = true; } }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(gravou, false);
});

test("processarNovoFisioterapeuta: arquivo inválido responde 400 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarNovoFisioterapeuta(
    { body: { nome: "Ana" }, file: { mimetype: "application/pdf", size: 100 } }, res,
    { criar: async () => { gravou = true; } }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(gravou, false);
});

test("processarNovoFisioterapeuta: caminho feliz sem arquivo grava com assinatura null", async () => {
  const res = criarRespostaFalsa();
  let dadosGravados = null;
  await processarNovoFisioterapeuta(
    { body: { nome: " Ana ", crefito: " 1234-F " } }, res,
    { criar: async (dados) => { dadosGravados = dados; } }
  );

  assert.deepEqual(dadosGravados, {
    nome: "Ana", crefito: "1234-F", assinaturaImagem: null, assinaturaMime: null,
  });
  assert.equal(res.redirectedTo, "/fisioterapeutas?sucesso=1");
});

test("processarNovoFisioterapeuta: caminho feliz com arquivo grava buffer e mime", async () => {
  const res = criarRespostaFalsa();
  const bufferFalso = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from("assinatura")]);
  let dadosGravados = null;
  await processarNovoFisioterapeuta(
    { body: { nome: "Ana" }, file: { buffer: bufferFalso, mimetype: "image/png", size: 100 } }, res,
    { criar: async (dados) => { dadosGravados = dados; } }
  );

  assert.equal(dadosGravados.assinaturaImagem, bufferFalso);
  assert.equal(dadosGravados.assinaturaMime, "image/png");
});

test("telaEditarFisioterapeuta: id inexistente responde 404", async () => {
  const res = criarRespostaFalsa();
  await telaEditarFisioterapeuta({ params: { id: "abc" } }, res);
  assert.equal(res.statusCode, 404);
});

test("processarEditarFisioterapeuta: fisioterapeuta inexistente responde 404 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarEditarFisioterapeuta(
    { params: { id: "5" }, body: { nome: "Ana" } }, res,
    { buscar: async () => null, atualizar: async () => { gravou = true; } }
  );

  assert.equal(res.statusCode, 404);
  assert.equal(gravou, false);
});

test("processarEditarFisioterapeuta: sem arquivo novo, não chama atualizarAssinatura", async () => {
  const res = criarRespostaFalsa();
  let chamouAtualizarAssinatura = false;
  await processarEditarFisioterapeuta(
    { params: { id: "5" }, body: { nome: "Ana Corrigida", crefito: "9999-F" } }, res,
    {
      buscar: async () => FISIOTERAPEUTA,
      atualizar: async () => {},
      atualizarAssinatura: async () => { chamouAtualizarAssinatura = true; },
    }
  );

  assert.equal(chamouAtualizarAssinatura, false);
  assert.equal(res.redirectedTo, "/fisioterapeutas?sucesso=1");
});

test("processarEditarFisioterapeuta: com arquivo novo, chama atualizarAssinatura com id/buffer/mime", async () => {
  const res = criarRespostaFalsa();
  const bufferFalso = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("nova-assinatura")]);
  let dadosAssinatura = null;
  await processarEditarFisioterapeuta(
    {
      params: { id: "5" },
      body: { nome: "Ana" },
      file: { buffer: bufferFalso, mimetype: "image/jpeg", size: 100 },
    },
    res,
    {
      buscar: async () => FISIOTERAPEUTA,
      atualizar: async () => {},
      atualizarAssinatura: async (id, dados) => { dadosAssinatura = { id, ...dados }; },
    }
  );

  assert.deepEqual(dadosAssinatura, { id: 5, assinaturaImagem: bufferFalso, assinaturaMime: "image/jpeg" });
});

test("processarDesativarFisioterapeuta: caminho feliz define ativo=false", async () => {
  const res = criarRespostaFalsa();
  let chamada = null;
  await processarDesativarFisioterapeuta(
    { params: { id: "5" } }, res,
    { buscar: async () => FISIOTERAPEUTA, definirAtivo: async (id, ativo) => { chamada = { id, ativo }; } }
  );

  assert.deepEqual(chamada, { id: 5, ativo: false });
  assert.equal(res.redirectedTo, "/fisioterapeutas?sucesso=1");
});

test("processarReativarFisioterapeuta: caminho feliz define ativo=true", async () => {
  const res = criarRespostaFalsa();
  let chamada = null;
  await processarReativarFisioterapeuta(
    { params: { id: "5" } }, res,
    { buscar: async () => FISIOTERAPEUTA, definirAtivo: async (id, ativo) => { chamada = { id, ativo }; } }
  );

  assert.deepEqual(chamada, { id: 5, ativo: true });
});

test("servirAssinaturaFisioterapeuta: sem assinatura responde 404", async () => {
  const res = criarRespostaFalsa();
  await servirAssinaturaFisioterapeuta(
    { params: { id: "5" } }, res,
    { buscarAssinatura: async () => null }
  );

  assert.equal(res.statusCode, 404);
});

test("servirAssinaturaFisioterapeuta: caminho feliz responde a imagem com o Content-Type certo", async () => {
  const res = criarRespostaFalsa();
  const bufferFalso = Buffer.from("assinatura");
  await servirAssinaturaFisioterapeuta(
    { params: { id: "5" } }, res,
    { buscarAssinatura: async () => ({ assinaturaImagem: bufferFalso, assinaturaMime: "image/png" }) }
  );

  assert.equal(res.headers["Content-Type"], "image/png");
  assert.equal(res.corpo, bufferFalso);
});
