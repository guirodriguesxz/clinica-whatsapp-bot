// test/periodoEstatisticas.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import dayjs from "../src/utils/dayjs.js";
import { resolverPeriodo } from "../src/utils/periodoEstatisticas.js";

function hojeSaoPaulo() {
  return dayjs().tz("America/Sao_Paulo");
}

test("resolverPeriodo: sem periodo, cai no default 'mes' (mês corrente inteiro)", () => {
  const resultado = resolverPeriodo({});
  const hoje = hojeSaoPaulo();
  assert.equal(resultado.periodo, "mes");
  assert.equal(resultado.dataInicio, hoje.startOf("month").format("YYYY-MM-DD"));
  assert.equal(resultado.dataFim, hoje.endOf("month").format("YYYY-MM-DD"));
});

test("resolverPeriodo: periodo fora do enum, cai no default 'mes'", () => {
  const resultado = resolverPeriodo({ periodo: "trimestre" });
  assert.equal(resultado.periodo, "mes");
});

test("resolverPeriodo: 'hoje' retorna só o dia atual (inicio === fim)", () => {
  const resultado = resolverPeriodo({ periodo: "hoje" });
  const hoje = hojeSaoPaulo().format("YYYY-MM-DD");
  assert.equal(resultado.periodo, "hoje");
  assert.equal(resultado.dataInicio, hoje);
  assert.equal(resultado.dataFim, hoje);
});

test("resolverPeriodo: 'semana' vai de segunda a domingo (isoWeek), não domingo a sábado", () => {
  const resultado = resolverPeriodo({ periodo: "semana" });
  assert.equal(dayjs(resultado.dataInicio, "YYYY-MM-DD").day(), 1); // segunda
  assert.equal(dayjs(resultado.dataFim, "YYYY-MM-DD").day(), 0); // domingo
});

test("resolverPeriodo: 'ano' vai de 1º de janeiro a 31 de dezembro do ano corrente", () => {
  const resultado = resolverPeriodo({ periodo: "ano" });
  const anoAtual = hojeSaoPaulo().format("YYYY");
  assert.equal(resultado.dataInicio, `${anoAtual}-01-01`);
  assert.equal(resultado.dataFim, `${anoAtual}-12-31`);
});

test("resolverPeriodo: 'custom' com inicio/fim válidos e inicio <= fim, usa exatamente esse intervalo", () => {
  const resultado = resolverPeriodo({ periodo: "custom", inicio: "2026-01-10", fim: "2026-02-20" });
  assert.deepEqual(resultado, { periodo: "custom", dataInicio: "2026-01-10", dataFim: "2026-02-20" });
});

test("resolverPeriodo: 'custom' com inicio > fim, cai no default 'mes'", () => {
  const resultado = resolverPeriodo({ periodo: "custom", inicio: "2026-02-20", fim: "2026-01-10" });
  assert.equal(resultado.periodo, "mes");
});

test("resolverPeriodo: 'custom' com data inválida (formato errado ou impossível), cai no default 'mes'", () => {
  assert.equal(resolverPeriodo({ periodo: "custom", inicio: "não-é-data", fim: "2026-02-20" }).periodo, "mes");
  assert.equal(resolverPeriodo({ periodo: "custom", inicio: "2026-01-10", fim: "2026-02-30" }).periodo, "mes");
  assert.equal(resolverPeriodo({ periodo: "custom" }).periodo, "mes");
});
