// test/dashboardControllerEstatisticas.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { telaEstatisticas } from "../src/controllers/dashboardController.js";
import dashboardRoutes from "../src/routes/dashboardRoutes.js";

function criarRespostaFalsa() {
  return {
    viewRenderizada: null,
    dadosDaView: null,
    render(view, dados) {
      this.viewRenderizada = view;
      this.dadosDaView = dados;
    },
  };
}

test("telaEstatisticas: resolve o período a partir da query e busca os dados nesse intervalo", async () => {
  const chamadasPeriodo = [];
  const chamadasDados = [];
  const req = { query: { periodo: "ano" } };
  const res = criarRespostaFalsa();

  await telaEstatisticas(req, res, {
    buscarPeriodo: (args) => {
      chamadasPeriodo.push(args);
      return { periodo: "ano", dataInicio: "2026-01-01", dataFim: "2026-12-31" };
    },
    buscarDados: async (args) => {
      chamadasDados.push(args);
      return { faturamento: { total: 0 }, atendimentos: { total: 0 } };
    },
  });

  assert.deepEqual(chamadasPeriodo[0], { periodo: "ano", inicio: undefined, fim: undefined });
  assert.deepEqual(chamadasDados[0], { dataInicio: "2026-01-01", dataFim: "2026-12-31" });
});

test("telaEstatisticas: renderiza estatisticas/lista com o período resolvido e os dados buscados", async () => {
  const req = { query: {} };
  const res = criarRespostaFalsa();

  await telaEstatisticas(req, res, {
    buscarPeriodo: () => ({ periodo: "mes", dataInicio: "2026-02-01", dataFim: "2026-02-28" }),
    buscarDados: async () => ({
      faturamento: { total: 100, recebido: 60, pendente: 40, porEspecialidade: [] },
      atendimentos: { total: 5, porEspecialidade: [], porProfissional: [] },
    }),
  });

  assert.equal(res.viewRenderizada, "estatisticas/lista");
  assert.equal(res.dadosDaView.periodoResolvido.periodo, "mes");
  assert.equal(res.dadosDaView.estatisticas.faturamento.total, 100);
  assert.equal(res.dadosDaView.estatisticas.atendimentos.total, 5);
  assert.deepEqual(res.dadosDaView.presets, ["hoje", "semana", "mes", "ano"]);
});

test("telaEstatisticas: repassa inicio/fim brutos da query pra view ecoar no formulário custom", async () => {
  const req = { query: { periodo: "custom", inicio: "2026-03-01", fim: "não-é-data" } };
  const res = criarRespostaFalsa();

  await telaEstatisticas(req, res, {
    buscarPeriodo: () => ({ periodo: "mes", dataInicio: "2026-02-01", dataFim: "2026-02-28" }),
    buscarDados: async () => ({ faturamento: { total: 0 }, atendimentos: { total: 0 } }),
  });

  assert.equal(res.dadosDaView.inicioQuery, "2026-03-01");
  assert.equal(res.dadosDaView.fimQuery, "não-é-data");
});

// GET /estatisticas passa por asyncHandler(exigirLogin), que embrulha a
// função real numa closure — não dá pra comparar referência direto contra
// exigirLogin (mesmo padrão de limitação documentado no teste
// "dashboard não registra rotas dos módulos extras" de
// test/financeiroViews.test.js, que só verifica os paths registrados). Em
// vez disso, este teste exercita a cadeia de middleware de verdade com uma
// requisição sem sessão, e confirma que ela é barrada com redirect pra
// /login antes de alcançar o handler final — provando que a rota exige
// login sem depender de introspecção de referência de função.
test("GET /estatisticas exige login: a cadeia de middleware barra requisição sem sessão", async () => {
  const layer = dashboardRoutes.stack.find(
    (l) => l.route && l.route.path === "/estatisticas" && l.route.methods.get
  );
  assert.ok(layer, "rota GET /estatisticas não encontrada em dashboardRoutes.stack");

  const req = { session: {}, query: {} };
  const res = {
    redirectedTo: null,
    redirect(url) {
      this.redirectedTo = url;
    },
    status() {
      return this;
    },
    send() {},
    render() {
      assert.fail("não deveria alcançar o render — exigirLogin devia ter barrado antes");
    },
  };

  // exigirLogin, sem req.session.usuarioId, faz `return res.redirect(...)`
  // antes de qualquer await — então, mesmo embrulhado em asyncHandler, o
  // redirect já aconteceu de forma síncrona no momento em que essa chamada
  // retorna (a promise resolvida depois só carrega o valor de retorno já
  // produzido).
  layer.route.stack[0].handle(req, res, () => {
    assert.fail("next() não deveria ser chamado — exigirLogin devia ter barrado antes");
  });

  assert.equal(res.redirectedTo, "/login");
});
