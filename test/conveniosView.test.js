// test/conveniosView.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";
import { formatarMoeda } from "../src/utils/dinheiro.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.join(__dirname, "..", "src", "views");

const ADMINISTRADORA = { id: 1, nome: "Ana", papel: "administradora" };

function renderizarLista(dados) {
  const caminho = path.join(VIEWS_DIR, "convenios", "lista.ejs");
  return ejs.renderFile(caminho, {
    convenios: [],
    mostrarTodos: false,
    sucesso: false,
    formatarMoeda,
    titulo: "Convênios",
    caminhoAtual: "/convenios",
    csrfToken: "token-fake",
    usuarioAtual: ADMINISTRADORA,
    ...dados,
  });
}

function renderizarNovo(dados) {
  const caminho = path.join(VIEWS_DIR, "convenios", "novo.ejs");
  return ejs.renderFile(caminho, {
    erro: null,
    titulo: "Novo convênio",
    caminhoAtual: "/convenios/novo",
    csrfToken: "token-fake",
    usuarioAtual: ADMINISTRADORA,
    ...dados,
  });
}

function renderizarEditar(dados) {
  const caminho = path.join(VIEWS_DIR, "convenios", "editar.ejs");
  return ejs.renderFile(caminho, {
    convenio: { id: 5, nome: "Mar Azul Saúde", ativo: true, valor_repasse_avaliacao: null, valor_repasse_sessao: null },
    mostrarTodos: false,
    erro: null,
    titulo: "Editar convênio",
    caminhoAtual: "/convenios/5/editar",
    csrfToken: "token-fake",
    usuarioAtual: ADMINISTRADORA,
    procedimentosTussPorChave: {},
    ...dados,
  });
}

test("convenios/lista: vazia mostra a tabela sem quebrar", async () => {
  const html = await renderizarLista({ convenios: [] });

  assert.match(html, /class="[^"]*data-table/);
  assert.match(html, /href="\/convenios\/novo"/);
});

test("convenios/lista: por padrão (mostrarTodos=false) mostra link para ver inativos", async () => {
  const html = await renderizarLista({ mostrarTodos: false });

  assert.match(html, /href="\/convenios\?todos=1"/);
  assert.match(html, /Mostrar inativos/);
});

test("convenios/lista: com mostrarTodos=true, mostra link para voltar a ver só ativos", async () => {
  const html = await renderizarLista({ mostrarTodos: true });

  assert.match(html, /href="\/convenios"[^>]*>\s*Mostrar só ativos/);
});

test("convenios/lista: mostra nome e badge Ativo/Inativo por linha", async () => {
  const html = await renderizarLista({
    convenios: [
      { id: 1, nome: "Mar Azul Saúde Ativo", ativo: true },
      { id: 2, nome: "Bio Vida Inativo", ativo: false },
    ],
  });

  assert.match(html, /Mar Azul Saúde Ativo/);
  assert.match(html, /Bio Vida Inativo/);
  assert.match(html, /badge is-success">\s*Ativo/);
  assert.match(html, /badge is-danger">\s*Inativo/);
});

test("convenios/lista: mostra os valores de repasse formatados quando presentes", async () => {
  const html = await renderizarLista({
    convenios: [
      { id: 1, nome: "Mar Azul Saúde", ativo: true, valor_repasse_avaliacao: 5.6, valor_repasse_sessao: 5.6 },
    ],
  });

  assert.match(html, /R\$ 5\.60/);
});

test("convenios/lista: mostra travessão quando o valor de repasse não foi preenchido", async () => {
  const html = await renderizarLista({
    convenios: [
      { id: 1, nome: "Particular", ativo: true, valor_repasse_avaliacao: null, valor_repasse_sessao: null },
    ],
  });

  assert.match(html, /<td>—<\/td>/);
});

test("convenios/lista: linha ativa mostra ação Desativar, não Reativar", async () => {
  const html = await renderizarLista({
    convenios: [{ id: 1, nome: "Mar Azul Saúde", ativo: true }],
  });

  assert.match(html, /action="\/convenios\/1\/desativar"/);
  assert.doesNotMatch(html, /\/reativar/);
});

test("convenios/lista: linha inativa mostra ação Reativar, não Desativar", async () => {
  const html = await renderizarLista({
    convenios: [{ id: 1, nome: "Mar Azul Saúde", ativo: false }],
  });

  assert.match(html, /action="\/convenios\/1\/reativar"/);
  assert.doesNotMatch(html, /\/desativar/);
});

test("convenios/lista: link de editar aponta pro id certo", async () => {
  const html = await renderizarLista({
    convenios: [{ id: 7, nome: "Bio Vida", ativo: true }],
  });

  assert.match(html, /href="\/convenios\/7\/editar"/);
});

test("convenios/lista: com mostrarTodos, link de editar e forms de ação preservam ?todos=1", async () => {
  const html = await renderizarLista({
    mostrarTodos: true,
    convenios: [{ id: 7, nome: "Bio Vida", ativo: false }],
  });

  assert.match(html, /href="\/convenios\/7\/editar\?todos=1"/);
  assert.match(html, /action="\/convenios\/7\/reativar"[\s\S]*?name="todos" value="1"/);
});

test("convenios/novo: formulário tem campos de nome e valores de repasse, e csrf", async () => {
  const html = await renderizarNovo({});

  assert.match(html, /name="nome"/);
  assert.match(html, /name="valor_repasse_avaliacao"/);
  assert.match(html, /name="valor_repasse_sessao"/);
  assert.match(html, /name="_csrf" value="token-fake"/);
});

test("convenios/novo: mostra mensagem de erro quando presente", async () => {
  const html = await renderizarNovo({ erro: "Nome inválido." });

  assert.match(html, /Nome inválido\./);
});

test("convenios/editar: formulário pré-preenchido com nome e valores de repasse atuais", async () => {
  const html = await renderizarEditar({
    convenio: { id: 5, nome: "Mar Azul Saúde", ativo: true, valor_repasse_avaliacao: 5.6, valor_repasse_sessao: 5.6 },
  });

  assert.match(html, /name="nome"[^>]*value="Mar Azul Saúde"/);
  assert.match(html, /name="valor_repasse_avaliacao"[^>]*value="5\.6"/);
});

test("convenios/editar: valores de repasse ausentes mostram campo vazio, não 'null'", async () => {
  const html = await renderizarEditar({
    convenio: { id: 5, nome: "Particular", ativo: true, valor_repasse_avaliacao: null, valor_repasse_sessao: null },
  });

  assert.doesNotMatch(html, /value="null"/);
});

test("convenios/editar: com mostrarTodos, form preserva ?todos=1 via campo oculto", async () => {
  const html = await renderizarEditar({ mostrarTodos: true });

  assert.match(html, /name="todos" value="1"/);
});

test("convenios/editar: mostra campos TISS do convênio quando preenchidos", async () => {
  const html = await renderizarEditar({
    convenio: { id: 5, nome: "Mar Azul Saúde", ativo: true, valor_repasse_avaliacao: null, valor_repasse_sessao: null, codigo_prestador_na_operadora: "PRESTADOR123", numero_contrato: "CT-001" },
  });

  assert.match(html, /name="codigo_prestador_na_operadora"[^>]*value="PRESTADOR123"/);
  assert.match(html, /name="numero_contrato"[^>]*value="CT-001"/);
});

test("convenios/editar: mostra as 4 linhas de mapeamento TUSS, pré-preenchidas quando cadastradas", async () => {
  const html = await renderizarEditar({
    procedimentosTussPorChave: {
      fisioterapia_sessao: { codigo_tuss: "10101012", descricao_tuss: "Sessão de fisioterapia" },
    },
  });

  assert.match(html, /name="tuss_fisioterapia_avaliacao_codigo"/);
  assert.match(html, /name="tuss_fisioterapia_sessao_codigo"[^>]*value="10101012"/);
  assert.match(html, /name="tuss_psicologia_avaliacao_codigo"/);
  assert.match(html, /name="tuss_psicologia_sessao_codigo"/);
});

test("convenios/editar: campos TISS/TUSS ausentes mostram vazio, não 'null'", async () => {
  const html = await renderizarEditar({});
  assert.doesNotMatch(html, /value="null"/);
});

test("convenios/lista: nome com aspas/HTML aparece escapado, sem quebrar o layout", async () => {
  const nomeMalicioso = 'Mar Azul Saúde "><script>alert(1)</script>';
  const html = await renderizarLista({
    convenios: [{ id: 1, nome: nomeMalicioso, ativo: true }],
  });

  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /alert\(1\)/);
});
