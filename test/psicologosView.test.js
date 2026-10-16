// test/psicologosView.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.join(__dirname, "..", "src", "views");

const ADMINISTRADORA = { id: 1, nome: "Ana", papel: "administradora" };

function renderizarLista(dados) {
  const caminho = path.join(VIEWS_DIR, "psicologos", "lista.ejs");
  return ejs.renderFile(caminho, {
    psicologos: [],
    mostrarTodos: false,
    sucesso: false,
    titulo: "Psicólogos",
    caminhoAtual: "/psicologos",
    csrfToken: "token-fake",
    usuarioAtual: ADMINISTRADORA,
    ...dados,
  });
}

function renderizarNovo(dados) {
  const caminho = path.join(VIEWS_DIR, "psicologos", "novo.ejs");
  return ejs.renderFile(caminho, {
    erro: null,
    titulo: "Novo psicólogo",
    caminhoAtual: "/psicologos/novo",
    csrfToken: "token-fake",
    usuarioAtual: ADMINISTRADORA,
    ...dados,
  });
}

function renderizarEditar(dados) {
  const caminho = path.join(VIEWS_DIR, "psicologos", "editar.ejs");
  return ejs.renderFile(caminho, {
    psicologo: { id: 5, nome: "Ana", ativo: true, temFoto: false },
    mostrarTodos: false,
    erro: null,
    titulo: "Editar psicólogo",
    caminhoAtual: "/psicologos/5/editar",
    csrfToken: "token-fake",
    usuarioAtual: ADMINISTRADORA,
    ...dados,
  });
}

test("psicologos/lista: vazia mostra a tabela sem quebrar", async () => {
  const html = await renderizarLista({ psicologos: [] });

  assert.match(html, /class="[^"]*data-table/);
  assert.match(html, /href="\/psicologos\/novo"/);
});

test("psicologos/lista: mostra link pra imprimir o Termo de Ciência de Psicologia", async () => {
  const html = await renderizarLista({});

  assert.match(html, /href="\/psicologos\/termo-ciencia"/);
});

test("psicologos/lista: por padrão (mostrarTodos=false) mostra link para ver inativos", async () => {
  const html = await renderizarLista({ mostrarTodos: false });

  assert.match(html, /href="\/psicologos\?todos=1"/);
  assert.match(html, /Mostrar inativos/);
});

test("psicologos/lista: com mostrarTodos=true, mostra link para voltar a ver só ativos", async () => {
  const html = await renderizarLista({ mostrarTodos: true });

  assert.match(html, /href="\/psicologos"[^>]*>\s*Mostrar só ativos/);
});

test("psicologos/lista: mostra nome e badge Ativo/Inativo por linha", async () => {
  const html = await renderizarLista({
    psicologos: [
      { id: 1, nome: "Ana Ativa", ativo: true },
      { id: 2, nome: "Bia Inativa", ativo: false },
    ],
  });

  assert.match(html, /Ana Ativa/);
  assert.match(html, /Bia Inativa/);
  assert.match(html, /badge is-success">\s*Ativo/);
  assert.match(html, /badge is-danger">\s*Inativo/);
});

test("psicologos/lista: linha sem foto mostra o placeholder, não uma tag img", async () => {
  const html = await renderizarLista({
    psicologos: [{ id: 1, nome: "Ana", ativo: true, temFoto: false }],
  });

  assert.match(html, /photo-thumb--vazio/);
  assert.doesNotMatch(html, /<img[^>]*photo-thumb"/);
});

test("psicologos/lista: linha com foto mostra a tag img apontando pra rota da foto", async () => {
  const html = await renderizarLista({
    psicologos: [{ id: 1, nome: "Ana", ativo: true, temFoto: true }],
  });

  assert.match(html, /<img src="\/psicologos\/1\/foto"[^>]*class="photo-thumb"/);
});

test("psicologos/lista: linha ativa mostra ação Desativar, não Reativar", async () => {
  const html = await renderizarLista({
    psicologos: [{ id: 1, nome: "Ana", ativo: true }],
  });

  assert.match(html, /action="\/psicologos\/1\/desativar"/);
  assert.doesNotMatch(html, /\/reativar/);
});

test("psicologos/lista: linha inativa mostra ação Reativar, não Desativar", async () => {
  const html = await renderizarLista({
    psicologos: [{ id: 1, nome: "Ana", ativo: false }],
  });

  assert.match(html, /action="\/psicologos\/1\/reativar"/);
  assert.doesNotMatch(html, /\/desativar/);
});

test("psicologos/lista: link de editar aponta pro id certo", async () => {
  const html = await renderizarLista({
    psicologos: [{ id: 7, nome: "Caio", ativo: true }],
  });

  assert.match(html, /href="\/psicologos\/7\/editar"/);
});

test("psicologos/lista: com mostrarTodos, link de editar e forms de ação preservam ?todos=1", async () => {
  const html = await renderizarLista({
    mostrarTodos: true,
    psicologos: [{ id: 7, nome: "Caio", ativo: false }],
  });

  assert.match(html, /href="\/psicologos\/7\/editar\?todos=1"/);
  assert.match(html, /action="\/psicologos\/7\/reativar"[\s\S]*?name="todos" value="1"/);
});

test("psicologos/lista: sem mostrarTodos, link de editar e forms de ação não carregam todos", async () => {
  const html = await renderizarLista({
    mostrarTodos: false,
    psicologos: [{ id: 7, nome: "Caio", ativo: true }],
  });

  assert.match(html, /href="\/psicologos\/7\/editar"[^?]/);
  assert.doesNotMatch(html, /name="todos"/);
});

test("psicologos/novo: formulário tem campo nome e csrf", async () => {
  const html = await renderizarNovo({});

  assert.match(html, /name="nome"/);
  assert.match(html, /name="_csrf" value="token-fake"/);
});

test("psicologos/novo: formulário tem campo de foto (arquivo) e enctype multipart", async () => {
  const html = await renderizarNovo({});

  assert.match(html, /enctype="multipart\/form-data"/);
  assert.match(html, /name="foto" type="file"/);
});

test("psicologos/novo: mostra mensagem de erro quando presente", async () => {
  const html = await renderizarNovo({ erro: "Nome inválido." });

  assert.match(html, /Nome inválido\./);
});

test("psicologos/editar: formulário pré-preenchido com o nome atual", async () => {
  const html = await renderizarEditar({ psicologo: { id: 5, nome: "Ana Preenchida", ativo: true } });

  assert.match(html, /name="nome"[^>]*value="Ana Preenchida"/);
});

test("psicologos/editar: com mostrarTodos, form preserva ?todos=1 via campo oculto", async () => {
  const html = await renderizarEditar({ mostrarTodos: true });

  assert.match(html, /name="todos" value="1"/);
});

test("psicologos/editar: sem mostrarTodos, form não carrega campo todos", async () => {
  const html = await renderizarEditar({ mostrarTodos: false });

  assert.doesNotMatch(html, /name="todos"/);
});

test("psicologos/editar: formulário tem campo de foto (arquivo) e enctype multipart", async () => {
  const html = await renderizarEditar({});

  assert.match(html, /enctype="multipart\/form-data"/);
  assert.match(html, /name="foto" type="file"/);
});

test("psicologos/editar: sem foto cadastrada, não mostra preview", async () => {
  const html = await renderizarEditar({ psicologo: { id: 5, nome: "Ana", ativo: true, temFoto: false } });

  assert.doesNotMatch(html, /photo-preview/);
});

test("psicologos/editar: com foto cadastrada, mostra preview apontando pra rota da foto", async () => {
  const html = await renderizarEditar({ psicologo: { id: 5, nome: "Ana", ativo: true, temFoto: true } });

  assert.match(html, /src="\/psicologos\/5\/foto"/);
  assert.match(html, /class="photo-preview"/);
});

test("psicologos/lista: nome com aspas/HTML aparece escapado, sem quebrar o layout", async () => {
  const nomeMalicioso = 'Ana "><script>alert(1)</script>';
  const html = await renderizarLista({
    psicologos: [{ id: 1, nome: nomeMalicioso, ativo: true }],
  });

  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /alert\(1\)/);
});

test("psicologos/editar: nome com aspas/HTML aparece escapado, sem quebrar o layout", async () => {
  const nomeMalicioso = 'Ana "><script>alert(1)</script>';
  const html = await renderizarEditar({
    psicologo: { id: 5, nome: nomeMalicioso, ativo: true },
  });

  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /alert\(1\)/);
});
