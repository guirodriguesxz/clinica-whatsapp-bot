// test/estatisticasViews.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.join(__dirname, "..", "src", "views");

test("estatisticas/relatorio: renderiza os 3 agregados sem quebrar", async () => {
  const caminho = path.join(VIEWS_DIR, "estatisticas", "relatorio.ejs");
  const html = await ejs.renderFile(caminho, {
    estatisticas: {
      mes: "2026-08",
      porTipoAtendimento: [{ tipo_atendimento: "fisioterapia", quantidade: "10" }],
      porPresenca: [{ presenca: "compareceu", quantidade: "8" }],
      porConvenio: [{ convenio: "Vale Saúde", quantidade: "5" }],
    },
  });

  assert.match(html, /fisioterapia/);
  assert.match(html, /compareceu/);
  assert.match(html, /Vale Saúde/);
});
