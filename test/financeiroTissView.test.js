import { test } from "node:test";
import assert from "node:assert/strict";
import ejs from "ejs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VIEWS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/views");

async function renderizar(dados) {
  return ejs.renderFile(path.join(VIEWS_DIR, "financeiro/tiss.ejs"), {
    convenios: [{ id: 5, nome: "Mar Azul Saúde" }],
    convenioId: "",
    inicio: "",
    fim: "",
    carater: "eletiva",
    preview: null,
    ...dados,
  });
}

test("financeiro/tiss: sem preview, mostra só o formulário", async () => {
  const html = await renderizar({});
  assert.match(html, /name="convenioId"/);
  assert.match(html, /name="inicio"/);
  assert.match(html, /name="fim"/);
  assert.match(html, /name="carater"/);
  assert.doesNotMatch(html, /Gerar XML do lote/);
});

test("financeiro/tiss: com preview e sem motivos de bloqueio, mostra contagens e botão habilitado", async () => {
  const html = await renderizar({
    convenioId: "5", inicio: "2026-09-01", fim: "2026-09-30",
    preview: {
      convenio: { id: 5, nome: "Mar Azul Saúde" },
      prontas: [{ pagamento_id: 1 }],
      incompletas: [{ pagamento_id: 2, motivo: "tuss_nao_cadastrado" }],
      motivosBloqueio: [],
    },
  });

  assert.match(html, /1 guia[s]? pronta/i);
  assert.match(html, /1 guia[s]? incompleta/i);
  assert.match(html, /tuss_nao_cadastrado|C.{1,20}digo TUSS n.{1,3}o cadastrado/i);
  assert.match(html, /href="\/financeiro\/tiss\/lote\?convenioId=5&inicio=2026-09-01&fim=2026-09-30&carater=eletiva"/);
});

test("financeiro/tiss: com motivo de bloqueio, não mostra o link de gerar", async () => {
  const html = await renderizar({
    convenioId: "5", inicio: "2026-09-01", fim: "2026-09-30",
    preview: {
      convenio: { id: 5, nome: "Mar Azul Saúde" },
      prontas: [],
      incompletas: [],
      motivosBloqueio: ["numero_contrato_ausente"],
    },
  });

  assert.doesNotMatch(html, /\/financeiro\/tiss\/lote\?/);
  assert.match(html, /n.mero.{1,3}de contrato/i);
});
