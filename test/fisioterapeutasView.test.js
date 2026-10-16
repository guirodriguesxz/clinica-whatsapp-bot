import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.join(__dirname, "..", "src", "views");

const ADMINISTRADORA = { id: 1, nome: "Ana", papel: "administradora" };
const RECEPCAO = { id: 2, nome: "Amanda", papel: "recepcao" };

function renderizarLista(dados) {
  return ejs.renderFile(path.join(VIEWS_DIR, "fisioterapeutas", "lista.ejs"), {
    fisioterapeutas: [],
    mostrarTodos: false,
    sucesso: false,
    titulo: "Fisioterapeutas",
    caminhoAtual: "/fisioterapeutas",
    csrfToken: "token-fake",
    usuarioAtual: ADMINISTRADORA,
    ...dados,
  });
}

function renderizarNovo(dados) {
  return ejs.renderFile(path.join(VIEWS_DIR, "fisioterapeutas", "novo.ejs"), {
    erro: null,
    titulo: "Novo fisioterapeuta",
    caminhoAtual: "/fisioterapeutas/novo",
    csrfToken: "token-fake",
    usuarioAtual: ADMINISTRADORA,
    ...dados,
  });
}

function renderizarEditar(dados) {
  return ejs.renderFile(path.join(VIEWS_DIR, "fisioterapeutas", "editar.ejs"), {
    fisioterapeuta: { id: 5, nome: "Ana", crefito: "1234-F", ativo: true, temAssinatura: false },
    mostrarTodos: false,
    erro: null,
    titulo: "Editar fisioterapeuta",
    caminhoAtual: "/fisioterapeutas/5/editar",
    csrfToken: "token-fake",
    usuarioAtual: ADMINISTRADORA,
    ...dados,
  });
}

test("fisioterapeutas/lista: administradora vê botão Novo e ações por linha", async () => {
  const html = await renderizarLista({
    fisioterapeutas: [{ id: 1, nome: "Ana", crefito: "1234-F", ativo: true, temAssinatura: true }],
  });

  assert.match(html, /href="\/fisioterapeutas\/novo"/);
  assert.match(html, /href="\/fisioterapeutas\/1\/editar"/);
  assert.match(html, /action="\/fisioterapeutas\/1\/desativar"/);
});

test("fisioterapeutas/lista: recepção não vê botão Novo nem coluna de ações", async () => {
  const html = await renderizarLista({
    usuarioAtual: RECEPCAO,
    fisioterapeutas: [{ id: 1, nome: "Ana", crefito: "1234-F", ativo: true, temAssinatura: true }],
  });

  assert.doesNotMatch(html, /href="\/fisioterapeutas\/novo"/);
  assert.doesNotMatch(html, /href="\/fisioterapeutas\/1\/editar"/);
  assert.doesNotMatch(html, /action="\/fisioterapeutas\/1\/desativar"/);
});

test("fisioterapeutas/lista: mostra badge de assinatura cadastrada/não cadastrada", async () => {
  const html = await renderizarLista({
    fisioterapeutas: [
      { id: 1, nome: "Ana", crefito: "1234-F", ativo: true, temAssinatura: true },
      { id: 2, nome: "Bia", crefito: null, ativo: true, temAssinatura: false },
    ],
  });

  assert.match(html, /badge is-success">\s*Cadastrada/);
  assert.match(html, /badge is-danger">\s*Não cadastrada/);
});

test("fisioterapeutas/novo: formulário tem campos nome, crefito e assinatura, com enctype multipart", async () => {
  const html = await renderizarNovo({});

  assert.match(html, /enctype="multipart\/form-data"/);
  assert.match(html, /name="nome"/);
  assert.match(html, /name="crefito"/);
  assert.match(html, /name="assinatura"[^>]*type="file"/);
});

test("fisioterapeutas/editar: sem assinatura cadastrada, não mostra preview", async () => {
  const html = await renderizarEditar({
    fisioterapeuta: { id: 5, nome: "Ana", crefito: "1234-F", ativo: true, temAssinatura: false },
  });

  assert.doesNotMatch(html, /fisioterapeutas\/5\/assinatura/);
});

test("fisioterapeutas/editar: com assinatura cadastrada, mostra preview apontando pra rota certa", async () => {
  const html = await renderizarEditar({
    fisioterapeuta: { id: 5, nome: "Ana", crefito: "1234-F", ativo: true, temAssinatura: true },
  });

  assert.match(html, /src="\/fisioterapeutas\/5\/assinatura"/);
});

test("fisioterapeutas/editar: fisioterapeuta inativo com assinatura cadastrada, não mostra preview (rota 404 pra inativo)", async () => {
  const html = await renderizarEditar({
    fisioterapeuta: { id: 5, nome: "Ana", crefito: "1234-F", ativo: false, temAssinatura: true },
  });

  assert.doesNotMatch(html, /fisioterapeutas\/5\/assinatura/);
});

test("fisioterapeutas/editar: formulário pré-preenchido com nome e crefito atuais", async () => {
  const html = await renderizarEditar({
    fisioterapeuta: { id: 5, nome: "Ana Preenchida", crefito: "9999-F", ativo: true, temAssinatura: false },
  });

  assert.match(html, /name="nome"[^>]*value="Ana Preenchida"/);
  assert.match(html, /name="crefito"[^>]*value="9999-F"/);
});
