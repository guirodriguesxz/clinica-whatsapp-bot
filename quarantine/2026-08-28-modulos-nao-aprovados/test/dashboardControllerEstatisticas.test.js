// test/dashboardControllerEstatisticas.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { telaEstatisticas } from "../src/controllers/dashboardController.js";

function criarRespostaFalsa() {
  return {
    viewRenderizada: null,
    dadosDaView: null,
    render(view, dados) {
      this.viewRenderizada = view;
      this.dadosDaView = dados;
      return this;
    },
  };
}

test("telaEstatisticas: renderiza estatisticas/relatorio com o mês pedido", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const res = criarRespostaFalsa();

  await telaEstatisticas({ query: { mes: "2026-08" } }, res);

  assert.equal(res.viewRenderizada, "estatisticas/relatorio");
  assert.equal(res.dadosDaView.estatisticas.mes, "2026-08");
});
