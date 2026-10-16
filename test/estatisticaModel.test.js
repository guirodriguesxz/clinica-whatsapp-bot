// test/estatisticaModel.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { buscarEstatisticas } from "../src/models/estatisticaModel.js";

test("buscarEstatisticas: passa dataInicio/dataFim como parâmetros em toda consulta", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [] };
  });

  await buscarEstatisticas({ dataInicio: "2026-02-01", dataFim: "2026-02-28" });

  assert.ok(chamadas.length > 0);
  for (const { params } of chamadas) {
    assert.equal(params[0], "2026-02-01");
    assert.equal(params[1], "2026-02-28");
  }
});

test("buscarEstatisticas: faturamento.total soma pagamento e abate estorno, ignorando linhas sem SUM", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("FROM pagamentos pg WHERE") && !sql.includes("GROUP BY") && !sql.includes("status")) {
      return { rows: [{ total: "180.00" }] };
    }
    return { rows: [] };
  });

  const resultado = await buscarEstatisticas({ dataInicio: "2026-02-01", dataFim: "2026-02-28" });

  assert.equal(resultado.faturamento.total, "180.00");
});

test("buscarEstatisticas: faturamento.recebido consulta com filtro status = 'pago'", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, _params) => {
    chamadas.push(sql);
    return { rows: [{ total: "0" }] };
  });

  await buscarEstatisticas({ dataInicio: "2026-02-01", dataFim: "2026-02-28" });

  assert.ok(chamadas.some((sql) => sql.includes("status = 'pago'") && !sql.includes("GROUP BY")));
});

test("buscarEstatisticas: faturamento.pendente consulta com filtro status IN pendente/aguardando_reembolso", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql) => {
    chamadas.push(sql);
    return { rows: [{ total: "0" }] };
  });

  await buscarEstatisticas({ dataInicio: "2026-02-01", dataFim: "2026-02-28" });

  assert.ok(
    chamadas.some(
      (sql) => sql.includes("'pendente'") && sql.includes("'aguardando_reembolso'") && !sql.includes("GROUP BY")
    )
  );
});

test("buscarEstatisticas: faturamento.porEspecialidade repassa as linhas agrupadas por tipo_atendimento", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("GROUP BY COALESCE(a.tipo_atendimento, ai.tipo_atendimento)") && sql.includes("pagamentos")) {
      return {
        rows: [
          { tipo_atendimento: "fisioterapia", total: "300.00", recebido: "200.00", pendente: "100.00" },
          { tipo_atendimento: "psicologia", total: "150.00", recebido: "150.00", pendente: "0.00" },
        ],
      };
    }
    return { rows: [] };
  });

  const resultado = await buscarEstatisticas({ dataInicio: "2026-02-01", dataFim: "2026-02-28" });

  assert.deepEqual(resultado.faturamento.porEspecialidade, [
    { tipo_atendimento: "fisioterapia", total: "300.00", recebido: "200.00", pendente: "100.00" },
    { tipo_atendimento: "psicologia", total: "150.00", recebido: "150.00", pendente: "0.00" },
  ]);
});

test("buscarEstatisticas: atendimentos.total consulta registros_atendimento filtrando presenca = 'compareceu'", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql) => {
    chamadas.push(sql);
    if (sql.includes("COUNT(*) AS quantidade FROM registros_atendimento") && !sql.includes("GROUP BY")) {
      return { rows: [{ quantidade: "7" }] };
    }
    return { rows: [] };
  });

  const resultado = await buscarEstatisticas({ dataInicio: "2026-02-01", dataFim: "2026-02-28" });

  assert.equal(resultado.atendimentos.total, 7);
  assert.ok(chamadas.every((sql) => !sql.includes("registros_atendimento") || sql.includes("presenca = 'compareceu'")));
});

test("buscarEstatisticas: repassePorConvenio usa o mesmo intervalo de data (inclusive) do resto da tela", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [] };
  });

  await buscarEstatisticas({ dataInicio: "2026-02-01", dataFim: "2026-02-28" });

  const porConvenioSql = chamadas.find(({ sql }) => sql.includes("GROUP BY chave_grupo"));
  assert.ok(porConvenioSql, "consulta agrupada por convênio deveria existir");
  assert.match(porConvenioSql.sql, /pg\.data >= \$1 AND pg\.data <= \$2/);
  assert.deepEqual(porConvenioSql.params, ["2026-02-01", "2026-02-28"]);
});

test("buscarEstatisticas: repassePorConvenio calcula o valor esperado a partir dos valores de repasse do convênio", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("GROUP BY chave_grupo")) {
      return {
        rows: [
          {
            chave_grupo: "1",
            plano: "Mar Azul Saúde",
            total: "220.00",
            quantidade: "3",
            quantidade_estornos: "0",
            quantidade_avaliacao: "1",
            quantidade_sessao: "2",
            convenio_identificado: true,
            valor_repasse_avaliacao: "40.00",
            valor_repasse_sessao: "90.00",
          },
        ],
      };
    }
    return { rows: [] };
  });

  const resultado = await buscarEstatisticas({ dataInicio: "2026-02-01", dataFim: "2026-02-28" });

  assert.equal(resultado.repassePorConvenio.length, 1);
  assert.equal(resultado.repassePorConvenio[0].plano, "Mar Azul Saúde");
  assert.equal(resultado.repassePorConvenio[0].valorRepasse, 220);
  assert.equal(resultado.repassePorConvenio[0].motivoRepasseIndisponivel, null);
});

test("buscarEstatisticas: atendimentos.porProfissional agrupa NULL e string vazia como 'Não informado'", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("profissional_responsavel") && sql.includes("GROUP BY")) {
      return {
        rows: [
          { profissional: "Não informado", quantidade: "3" },
          { profissional: "Dra. Ana", quantidade: "5" },
        ],
      };
    }
    return { rows: [] };
  });

  const resultado = await buscarEstatisticas({ dataInicio: "2026-02-01", dataFim: "2026-02-28" });

  assert.deepEqual(resultado.atendimentos.porProfissional, [
    { profissional: "Não informado", quantidade: "3" },
    { profissional: "Dra. Ana", quantidade: "5" },
  ]);
});
