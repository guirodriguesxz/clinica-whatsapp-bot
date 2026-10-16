// test/estatisticaModel.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import dayjs from "../src/utils/dayjs.js";
import { buscarEstatisticasMensais } from "../src/models/estatisticaModel.js";

test("buscarEstatisticasMensais: com mes inválido, usa o mês atual", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push(params);
    return { rows: [] };
  });

  const mesAtual = dayjs().tz("America/Sao_Paulo").format("YYYY-MM");
  const estatisticas = await buscarEstatisticasMensais({ mes: "não-é-um-mes" });

  assert.equal(estatisticas.mes, mesAtual);
  for (const params of chamadas) {
    assert.equal(params[0], `${mesAtual}-01`);
  }
});

test("buscarEstatisticasMensais: com mes válido, usa o intervalo certo (início inclusivo, fim exclusivo)", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push(params);
    return { rows: [] };
  });

  await buscarEstatisticasMensais({ mes: "2026-02" });

  for (const params of chamadas) {
    assert.equal(params[0], "2026-02-01");
    assert.equal(params[1], "2026-03-01");
  }
});

test("buscarEstatisticasMensais: monta o objeto com os 3 agregados", async (t) => {
  let chamada = 0;
  t.mock.method(pool, "query", async () => {
    chamada += 1;
    if (chamada === 1) return { rows: [{ tipo_atendimento: "fisioterapia", quantidade: "10" }] };
    if (chamada === 2) return { rows: [{ presenca: "compareceu", quantidade: "8" }] };
    return { rows: [{ convenio: "Vale Saúde", quantidade: "5" }] };
  });

  const estatisticas = await buscarEstatisticasMensais({ mes: "2026-08" });

  assert.deepEqual(estatisticas.porTipoAtendimento, [
    { tipo_atendimento: "fisioterapia", quantidade: "10" },
  ]);
  assert.deepEqual(estatisticas.porPresenca, [{ presenca: "compareceu", quantidade: "8" }]);
  assert.deepEqual(estatisticas.porConvenio, [{ convenio: "Vale Saúde", quantidade: "5" }]);
});
