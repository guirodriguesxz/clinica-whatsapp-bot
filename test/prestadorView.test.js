import { test } from "node:test";
import assert from "node:assert/strict";
import ejs from "ejs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VIEWS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/views");

async function renderizar(dados) {
  return ejs.renderFile(path.join(VIEWS_DIR, "prestador/editar.ejs"), {
    csrfToken: "token-teste",
    dados: { cnes: null, razao_social: null, cnpj: null, cbo_fisioterapia: null, cbo_psicologia: null },
    sucesso: false,
    ...dados,
  });
}

test("prestador/editar: mostra os 5 campos e o valor atual quando preenchido", async () => {
  const html = await renderizar({
    dados: {
      cnes: "123456",
      razao_social: "Clínica Exemplo",
      cnpj: null,
      cbo_fisioterapia: "2236-05",
      cbo_psicologia: "2515-05",
    },
  });

  assert.match(html, /name="cnes"/);
  assert.match(html, /name="razao_social"/);
  assert.match(html, /name="cnpj"/);
  assert.match(html, /name="cbo_fisioterapia"/);
  assert.match(html, /name="cbo_psicologia"/);
  assert.match(html, /value="123456"/);
  assert.match(html, /value="Clínica Exemplo"/);
  assert.match(html, /value="2236-05"/);
  assert.match(html, /value="2515-05"/);
});

test("prestador/editar: mostra mensagem de sucesso quando sucesso=true", async () => {
  const html = await renderizar({ sucesso: true });
  assert.match(html, /Alteração salva com sucesso/);
});
