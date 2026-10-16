// test/pacienteEditarView.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.join(__dirname, "..", "src", "views");

function renderizar(dados) {
  const caminho = path.join(VIEWS_DIR, "pacientes", "editar.ejs");
  return ejs.renderFile(caminho, {
    paciente: { id: 5, nome: "Ana", convenio: null, convenio_id: null, matricula_convenio: null },
    convenios: [],
    csrfToken: "token-fake",
    titulo: "Editar dados do paciente",
    caminhoAtual: "/pacientes/5/editar",
    usuarioAtual: { id: 1, nome: "Bruno", papel: "administradora" },
    ...dados,
  });
}

test("pacientes/editar: select de convênio lista os convênios recebidos", async () => {
  const html = await renderizar({
    convenios: [{ id: 1, nome: "Mar Azul Saúde" }, { id: 2, nome: "Bio Vida" }],
  });

  assert.match(html, /name="convenio_id"/);
  assert.match(html, /<option value="1"[^>]*>Mar Azul Saúde<\/option>/);
  assert.match(html, /<option value="2"[^>]*>Bio Vida<\/option>/);
});

test("pacientes/editar: convenio_id atual vem pré-selecionado", async () => {
  const html = await renderizar({
    paciente: { id: 5, nome: "Ana", convenio: "Bio Vida", convenio_id: 2, matricula_convenio: null },
    convenios: [{ id: 1, nome: "Mar Azul Saúde" }, { id: 2, nome: "Bio Vida" }],
  });

  assert.match(html, /<option value="2" selected>Bio Vida<\/option>/);
});

test("pacientes/editar: paciente com convênio em texto livre (sem convenio_id) mostra 'Manter como está' com o texto atual", async () => {
  const html = await renderizar({
    paciente: { id: 5, nome: "Ana", convenio: "MAR AZUL SP (texto antigo)", convenio_id: null, matricula_convenio: null },
  });

  assert.match(html, /Manter como está \(MAR AZUL SP \(texto antigo\)\)/);
});

test("pacientes/editar: paciente sem nenhum convênio não quebra a view", async () => {
  const html = await renderizar({
    paciente: { id: 5, nome: "Ana", convenio: null, convenio_id: null, matricula_convenio: null },
  });

  assert.match(html, /Manter como está<\/option>/);
});

test("pacientes/editar: mostra o campo CNS com o valor atual quando preenchido", async () => {
  const html = await renderizar({
    paciente: { id: 5, nome: "Ana", convenio: null, convenio_id: null, matricula_convenio: null, cns: "700123456789012" },
  });

  assert.match(html, /name="cns"/);
  assert.match(html, /value="700123456789012"/);
});
