# Estatísticas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new `/estatisticas` dashboard page showing faturamento and atendimentos-realizados numbers for a flexible period (today/week/month/year presets, or a custom date range), for any logged-in user.

**Architecture:** A pure period-resolution util (`resolverPeriodo`) turns query-string period params into a validated `{ dataInicio, dataFim }` date range with graceful fallback to "mes" on anything invalid. A new model (`estatisticaModel.js`) runs parallel aggregate queries against `pagamentos` and `registros_atendimento` for that range — same `Promise.all`-of-parallel-queries shape `pagamentoModel.js` already uses for `buscarRelatorioMensal`. A new controller function and route wire the two together and render a new EJS view that reuses the `.metric-grid`/`.data-table`/`.report-section` CSS classes `/financeiro/relatorio` already established.

**Tech Stack:** Node.js (ESM), Express, `pg` (raw SQL, no ORM), EJS views, `dayjs` (with `utc`/`timezone`/`isSameOrBefore`/`isoWeek` plugins), `node --test` + `node:assert/strict` for tests (no test framework, no test DB — models are tested by mocking `pool.query` via `t.mock.method`).

**Spec:** `docs/superpowers/specs/2026-09-03-estatisticas-design.md`

## Global Constraints

- No new database table/migration — this feature only reads `pagamentos` and `registros_atendimento` (joined to `agendamentos`/`agendamentos_importados`), which already exist.
- No new npm dependency — no chart library, v1 is tables/numbers only (see spec "Fora de escopo").
- Any logged-in user can access `/estatisticas` — no `exigirPapel` check (same as `/agendamentos`, `/pacientes`, `/psicologos`).
- All money values go through `formatarMoeda` in views (already available as `app.locals.formatarMoeda`, no import needed in `.ejs` files) — never format currency inline.
- Follow the existing dependency-injection-via-default-params pattern for controller functions (see `processarCancelarAgendamento` in `src/controllers/dashboardController.js`) so tests can override without mocking `pool` at the controller layer.
- Don't touch `/financeiro/relatorio`, `pagamentoModel.js`'s `buscarRelatorioMensal`, or the quarantined `quarantine/2026-08-28-modulos-nao-aprovados/src/models/estatisticaModel.js` — this is new, separate code (see spec "Fora de escopo").

---

### Task 1: Período resolver (`resolverPeriodo`)

**Files:**
- Modify: `src/utils/dayjs.js`
- Create: `src/utils/periodoEstatisticas.js`
- Test: `test/periodoEstatisticas.test.js`

**Interfaces:**
- Consumes: `dayjs` (project singleton, `src/utils/dayjs.js`), `validarData` from `src/utils/validacao.js`.
- Produces: `resolverPeriodo({ periodo, inicio, fim } = {})` → `{ periodo: "hoje"|"semana"|"mes"|"ano"|"custom", dataInicio: "YYYY-MM-DD", dataFim: "YYYY-MM-DD" }`. `dataInicio`/`dataFim` are both inclusive. Used by Task 3's controller.

- [ ] **Step 1: Add the `isoWeek` dayjs plugin**

`resolverPeriodo`'s "semana" branch needs Monday-to-Sunday weeks; dayjs's own `.startOf("week")` defaults to Sunday-start, which isn't what the spec calls for. Add the plugin to the shared dayjs singleton so it's available everywhere (same file already loads `utc`/`timezone`/`isSameOrBefore`).

Edit `src/utils/dayjs.js`:

```js
import dayjs from "dayjs";
import "dayjs/locale/pt-br.js";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import isSameOrBefore from "dayjs/plugin/isSameOrBefore.js";
import isoWeek from "dayjs/plugin/isoWeek.js";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isSameOrBefore);
dayjs.extend(isoWeek);
dayjs.locale("pt-br");

export default dayjs;
```

- [ ] **Step 2: Write the failing tests**

Create `test/periodoEstatisticas.test.js`:

```js
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test test/periodoEstatisticas.test.js`
Expected: FAIL — `Cannot find module '../src/utils/periodoEstatisticas.js'`

- [ ] **Step 4: Implement `resolverPeriodo`**

Create `src/utils/periodoEstatisticas.js`:

```js
// src/utils/periodoEstatisticas.js
import dayjs from "./dayjs.js";
import { validarData } from "./validacao.js";

export const PERIODOS_VALIDOS = ["hoje", "semana", "mes", "ano", "custom"];

/**
 * Resolve os parâmetros de período da query string de /estatisticas pra um
 * intervalo de datas seguro de usar num filtro `data >= dataInicio AND data
 * <= dataFim` (ambos inclusivos). Qualquer coisa inválida — periodo fora do
 * enum, ausente, ou "custom" com datas ausentes/malformadas/invertidas —
 * cai no default "mes" (mês corrente inteiro), sem tela de erro, mesmo
 * espírito de mesSeguro()/validarData() já usados no resto do projeto.
 */
export function resolverPeriodo({ periodo, inicio, fim } = {}) {
  const hoje = dayjs().tz("America/Sao_Paulo");

  if (periodo === "custom") {
    if (validarData(inicio) && validarData(fim) && inicio <= fim) {
      return { periodo: "custom", dataInicio: inicio, dataFim: fim };
    }
    return resolverPeriodo({ periodo: "mes" });
  }

  if (periodo === "hoje") {
    const data = hoje.format("YYYY-MM-DD");
    return { periodo: "hoje", dataInicio: data, dataFim: data };
  }

  if (periodo === "semana") {
    return {
      periodo: "semana",
      dataInicio: hoje.startOf("isoWeek").format("YYYY-MM-DD"),
      dataFim: hoje.endOf("isoWeek").format("YYYY-MM-DD"),
    };
  }

  if (periodo === "ano") {
    return {
      periodo: "ano",
      dataInicio: hoje.startOf("year").format("YYYY-MM-DD"),
      dataFim: hoje.endOf("year").format("YYYY-MM-DD"),
    };
  }

  return {
    periodo: "mes",
    dataInicio: hoje.startOf("month").format("YYYY-MM-DD"),
    dataFim: hoje.endOf("month").format("YYYY-MM-DD"),
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/periodoEstatisticas.test.js`
Expected: PASS (9 tests)

- [ ] **Step 6: Commit**

```bash
git add src/utils/dayjs.js src/utils/periodoEstatisticas.js test/periodoEstatisticas.test.js
git commit -m "feat: adiciona resolverPeriodo pra estatísticas (presets + intervalo custom)"
```

---

### Task 2: Model `estatisticaModel.js`

**Files:**
- Create: `src/models/estatisticaModel.js`
- Test: `test/estatisticaModel.test.js`

**Interfaces:**
- Consumes: `pool` from `src/db/pool.js`.
- Produces: `buscarEstatisticas({ dataInicio, dataFim })` → 
  ```
  {
    faturamento: {
      total: string|number, recebido: string|number, pendente: string|number,
      porEspecialidade: [{ tipo_atendimento, total, recebido, pendente }],
    },
    atendimentos: {
      total: number,
      porEspecialidade: [{ tipo_atendimento, quantidade }],
      porProfissional: [{ profissional, quantidade }],
    },
  }
  ```
  Used by Task 3's controller. `dataInicio`/`dataFim` are `"YYYY-MM-DD"` strings, already resolved and validated by `resolverPeriodo` (Task 1) before this function is called — this model does no validation of its own.

- [ ] **Step 1: Write the failing tests**

Create `test/estatisticaModel.test.js`:

```js
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
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push(sql);
    return { rows: [{ total: "0" }] };
  });

  await buscarEstatisticas({ dataInicio: "2026-02-01", dataFim: "2026-02-28" });

  assert.ok(chamadas.some((sql) => sql.includes("status = 'pago'")));
});

test("buscarEstatisticas: faturamento.pendente consulta com filtro status IN pendente/aguardando_reembolso", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql) => {
    chamadas.push(sql);
    return { rows: [{ total: "0" }] };
  });

  await buscarEstatisticas({ dataInicio: "2026-02-01", dataFim: "2026-02-28" });

  assert.ok(chamadas.some((sql) => sql.includes("'pendente'") && sql.includes("'aguardando_reembolso'")));
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/estatisticaModel.test.js`
Expected: FAIL — `Cannot find module '../src/models/estatisticaModel.js'`

- [ ] **Step 3: Implement `estatisticaModel.js`**

Create `src/models/estatisticaModel.js`:

```js
// src/models/estatisticaModel.js
import { pool } from "../db/pool.js";

// Mesma técnica de reversão de estorno que buscarRelatorioMensal já usa em
// pagamentoModel.js: um estorno é uma linha própria (append-only, migration
// 013), então soma-la direto dobraria o valor — precisa abater.
const VALOR_LIQUIDO = `CASE WHEN pg.tipo_lancamento = 'estorno' THEN -pg.valor ELSE pg.valor END`;

const JOINS_PAGAMENTO = `
  LEFT JOIN agendamentos a ON a.id = pg.agendamento_id
  LEFT JOIN agendamentos_importados ai ON ai.id = pg.agendamento_importado_id`;

async function buscarFaturamento({ dataInicio, dataFim }) {
  const parametros = [dataInicio, dataFim];
  const where = `WHERE pg.data >= $1 AND pg.data <= $2`;

  const [total, recebido, pendente, porEspecialidade] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(${VALOR_LIQUIDO}), 0) AS total FROM pagamentos pg ${where}`, parametros),
    pool.query(
      `SELECT COALESCE(SUM(${VALOR_LIQUIDO}), 0) AS total FROM pagamentos pg ${where} AND pg.status = 'pago'`,
      parametros
    ),
    pool.query(
      `SELECT COALESCE(SUM(${VALOR_LIQUIDO}), 0) AS total FROM pagamentos pg ${where} AND pg.status IN ('pendente', 'aguardando_reembolso')`,
      parametros
    ),
    pool.query(
      `SELECT COALESCE(a.tipo_atendimento, ai.tipo_atendimento) AS tipo_atendimento,
              COALESCE(SUM(${VALOR_LIQUIDO}), 0) AS total,
              COALESCE(SUM(${VALOR_LIQUIDO}) FILTER (WHERE pg.status = 'pago'), 0) AS recebido,
              COALESCE(SUM(${VALOR_LIQUIDO}) FILTER (WHERE pg.status IN ('pendente', 'aguardando_reembolso')), 0) AS pendente
       FROM pagamentos pg ${JOINS_PAGAMENTO} ${where}
       GROUP BY COALESCE(a.tipo_atendimento, ai.tipo_atendimento)`,
      parametros
    ),
  ]);

  return {
    total: total.rows[0]?.total ?? 0,
    recebido: recebido.rows[0]?.total ?? 0,
    pendente: pendente.rows[0]?.total ?? 0,
    porEspecialidade: porEspecialidade.rows,
  };
}

async function buscarAtendimentos({ dataInicio, dataFim }) {
  const parametros = [dataInicio, dataFim];
  const joins = `
    LEFT JOIN agendamentos a ON a.id = ra.agendamento_id
    LEFT JOIN agendamentos_importados ai ON ai.id = ra.agendamento_importado_id`;
  const where = `WHERE ra.presenca = 'compareceu' AND COALESCE(a.data, ai.data) >= $1 AND COALESCE(a.data, ai.data) <= $2`;

  const [total, porEspecialidade, porProfissional] = await Promise.all([
    pool.query(`SELECT COUNT(*) AS quantidade FROM registros_atendimento ra ${joins} ${where}`, parametros),
    pool.query(
      `SELECT COALESCE(a.tipo_atendimento, ai.tipo_atendimento) AS tipo_atendimento, COUNT(*) AS quantidade
       FROM registros_atendimento ra ${joins} ${where}
       GROUP BY COALESCE(a.tipo_atendimento, ai.tipo_atendimento)`,
      parametros
    ),
    pool.query(
      `SELECT COALESCE(NULLIF(ra.profissional_responsavel, ''), 'Não informado') AS profissional, COUNT(*) AS quantidade
       FROM registros_atendimento ra ${joins} ${where}
       GROUP BY COALESCE(NULLIF(ra.profissional_responsavel, ''), 'Não informado')
       ORDER BY quantidade DESC`,
      parametros
    ),
  ]);

  return {
    total: Number(total.rows[0]?.quantidade ?? 0),
    porEspecialidade: porEspecialidade.rows,
    porProfissional: porProfissional.rows,
  };
}

/**
 * Estatísticas agregadas (faturamento + atendimentos realizados) pra tela
 * /estatisticas, num intervalo de datas livre — não só o mês corrente como
 * /financeiro/relatorio. dataInicio/dataFim já chegam validados por
 * resolverPeriodo (src/utils/periodoEstatisticas.js); este model não
 * valida nada, só consulta.
 */
export async function buscarEstatisticas({ dataInicio, dataFim }) {
  const [faturamento, atendimentos] = await Promise.all([
    buscarFaturamento({ dataInicio, dataFim }),
    buscarAtendimentos({ dataInicio, dataFim }),
  ]);
  return { faturamento, atendimentos };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/estatisticaModel.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/models/estatisticaModel.js test/estatisticaModel.test.js
git commit -m "feat: adiciona buscarEstatisticas (faturamento + atendimentos por período)"
```

---

### Task 3: Controller + rota (`telaEstatisticas`)

**Files:**
- Modify: `src/controllers/dashboardController.js`
- Modify: `src/routes/dashboardRoutes.js`
- Test: `test/dashboardControllerEstatisticas.test.js`

**Interfaces:**
- Consumes: `resolverPeriodo` from `src/utils/periodoEstatisticas.js` (Task 1), `buscarEstatisticas` from `src/models/estatisticaModel.js` (Task 2), `exigirLogin` from `src/middleware/dashboardAuth.js`, `asyncHandler` from `src/utils/asyncHandler.js`.
- Produces: `telaEstatisticas(req, res, { buscarPeriodo, buscarDados } = {})` (exported from `dashboardController.js`) and the route `GET /estatisticas`. Renders view `estatisticas/lista` (Task 4) with locals `{ periodoResolvido, estatisticas, inicioQuery, fimQuery }` — `inicioQuery`/`fimQuery` are the raw (unvalidated) `req.query.inicio`/`req.query.fim` strings, so the view's "custom" date inputs can echo back what the user typed even when it fell back to the "mes" default (same UX reason `filtroData`/`plano`/`especialidade` are passed alongside the resolved data in `telaFinanceiro`/`telaRelatorioFinanceiro`).

- [ ] **Step 1: Write the failing tests**

Create `test/dashboardControllerEstatisticas.test.js`:

```js
// test/dashboardControllerEstatisticas.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { telaEstatisticas } from "../src/controllers/dashboardController.js";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/dashboardControllerEstatisticas.test.js`
Expected: FAIL — `telaEstatisticas is not a function` (not exported yet)

- [ ] **Step 3: Add `telaEstatisticas` to the controller**

In `src/controllers/dashboardController.js`, add to the imports near the top (alongside the other model imports):

```js
import { buscarEstatisticas } from "../models/estatisticaModel.js";
import { resolverPeriodo } from "../utils/periodoEstatisticas.js";
```

Then add this function (a good spot is right after `telaRelatorioFinanceiro`, since it's the closest sibling — a reporting screen driven by query params):

```js
export async function telaEstatisticas(
  req,
  res,
  { buscarPeriodo = resolverPeriodo, buscarDados = buscarEstatisticas } = {}
) {
  const periodoResolvido = buscarPeriodo({
    periodo: req.query.periodo,
    inicio: req.query.inicio,
    fim: req.query.fim,
  });
  const estatisticas = await buscarDados({
    dataInicio: periodoResolvido.dataInicio,
    dataFim: periodoResolvido.dataFim,
  });
  res.render("estatisticas/lista", {
    periodoResolvido,
    estatisticas,
    inicioQuery: req.query.inicio ?? "",
    fimQuery: req.query.fim ?? "",
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/dashboardControllerEstatisticas.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Wire the route**

In `src/routes/dashboardRoutes.js`, add `telaEstatisticas` to the existing import block from `../controllers/dashboardController.js` (next to `telaFinanceiro`, `telaRelatorioFinanceiro`), then add the route right after the `/financeiro/relatorio` GET route:

```js
router.get("/estatisticas", asyncHandler(exigirLogin), asyncHandler(telaEstatisticas));
```

- [ ] **Step 6: Run the full test suite to check for regressions**

Run: `npm test`
Expected: PASS, no failures (the new view doesn't exist yet, but nothing renders it in a test yet either — Task 4 adds that)

- [ ] **Step 7: Commit**

```bash
git add src/controllers/dashboardController.js src/routes/dashboardRoutes.js test/dashboardControllerEstatisticas.test.js
git commit -m "feat: adiciona controller e rota GET /estatisticas"
```

---

### Task 4: View, menu, CSS

**Files:**
- Create: `src/views/estatisticas/lista.ejs`
- Modify: `src/views/partials/header.ejs`
- Modify: `public/dashboard.css`
- Test: `test/estatisticasView.test.js`

**Interfaces:**
- Consumes: `periodoResolvido` (`{ periodo, dataInicio, dataFim }`), `estatisticas` (`{ faturamento: { total, recebido, pendente, porEspecialidade }, atendimentos: { total, porEspecialidade, porProfissional } }`), `inicioQuery`, `fimQuery` — all from Task 3's `telaEstatisticas`. `formatarMoeda` from `app.locals` (no import needed).
- Produces: the rendered `/estatisticas` page; the sidebar link other views' nav already has a slot for.

- [ ] **Step 1: Write the failing view test**

Create `test/estatisticasView.test.js` (mirrors `test/financeiroViews.test.js`'s direct-EJS-render approach):

```js
// test/estatisticasView.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";
import { formatarMoeda } from "../src/utils/dinheiro.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.join(__dirname, "..", "src", "views");

function renderizar(dados) {
  const caminho = path.join(VIEWS_DIR, "estatisticas", "lista.ejs");
  return ejs.renderFile(caminho, { csrfToken: "token-fake", formatarMoeda, ...dados });
}

const ESTATISTICAS_VAZIAS = {
  faturamento: { total: 0, recebido: 0, pendente: 0, porEspecialidade: [] },
  atendimentos: { total: 0, porEspecialidade: [], porProfissional: [] },
};

test("estatisticas/lista: renderiza sem erro com dados vazios", async () => {
  const html = await renderizar({
    periodoResolvido: { periodo: "mes", dataInicio: "2026-02-01", dataFim: "2026-02-28" },
    estatisticas: ESTATISTICAS_VAZIAS,
    inicioQuery: "",
    fimQuery: "",
  });

  assert.match(html, /Estatísticas/);
  assert.match(html, /R\$ 0\.00/);
});

test("estatisticas/lista: renderiza os totais e as tabelas com dados populados", async () => {
  const html = await renderizar({
    periodoResolvido: { periodo: "ano", dataInicio: "2026-01-01", dataFim: "2026-12-31" },
    estatisticas: {
      faturamento: {
        total: 450.5,
        recebido: 300,
        pendente: 150.5,
        porEspecialidade: [
          { tipo_atendimento: "fisioterapia", total: "300.00", recebido: "300.00", pendente: "0.00" },
          { tipo_atendimento: "psicologia", total: "150.50", recebido: "0.00", pendente: "150.50" },
        ],
      },
      atendimentos: {
        total: 12,
        porEspecialidade: [
          { tipo_atendimento: "fisioterapia", quantidade: "9" },
          { tipo_atendimento: "psicologia", quantidade: "3" },
        ],
        porProfissional: [
          { profissional: "Dra. Ana", quantidade: "3" },
          { profissional: "Não informado", quantidade: "9" },
        ],
      },
    },
    inicioQuery: "",
    fimQuery: "",
  });

  assert.match(html, /R\$ 450\.50/);
  assert.match(html, /Dra\. Ana/);
  assert.match(html, /Não informado/);
});

test("estatisticas/lista: preset ativo (periodo) fica marcado com is-active", async () => {
  const html = await renderizar({
    periodoResolvido: { periodo: "semana", dataInicio: "2026-02-02", dataFim: "2026-02-08" },
    estatisticas: ESTATISTICAS_VAZIAS,
    inicioQuery: "",
    fimQuery: "",
  });

  assert.match(html, /class="button is-active"[^>]*href="\/estatisticas\?periodo=semana"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/estatisticasView.test.js`
Expected: FAIL — ENOENT, `estatisticas/lista.ejs` does not exist

- [ ] **Step 3: Add the CSS for the period-preset buttons**

Append to `public/dashboard.css`, right after the existing `.report-filters` rules (near line 501, after `.report-filters form label { gap: 0.2rem; }`):

```css
.periodo-presets { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.75rem; }
.periodo-presets .button.is-active { background: var(--forest); border-color: var(--forest); color: #fff; }
```

- [ ] **Step 4: Write the view**

Create `src/views/estatisticas/lista.ejs`:

```html
<!-- src/views/estatisticas/lista.ejs -->
<%- include("../partials/header", { titulo: "Estatísticas" }) %>
<header class="page-header">
  <div>
    <h1>Estatísticas</h1>
  </div>
</header>

<div class="report-filters">
  <div class="periodo-presets">
    <% ["hoje", "semana", "mes", "ano"].forEach((preset) => { %>
    <a
      class="button<%= periodoResolvido.periodo === preset ? ' is-active' : '' %>"
      href="/estatisticas?periodo=<%= preset %>"
    ><%= preset === "hoje" ? "Hoje" : preset === "semana" ? "Semana" : preset === "mes" ? "Mês" : "Ano" %></a>
    <% }) %>
  </div>
  <form method="get" action="/estatisticas">
    <input type="hidden" name="periodo" value="custom" />
    <label>De<input type="date" name="inicio" value="<%= inicioQuery %>" /></label>
    <label>Até<input type="date" name="fim" value="<%= fimQuery %>" /></label>
    <button type="submit">Filtrar período</button>
  </form>
  <p class="registro-info">
    Período exibido: <%= periodoResolvido.dataInicio %> a <%= periodoResolvido.dataFim %>
  </p>
</div>

<div class="metric-grid">
  <div class="metric-card">
    <h2>Faturamento total</h2>
    <p class="metric-value">R$ <%= formatarMoeda(estatisticas.faturamento.total) %></p>
  </div>
  <div class="metric-card">
    <h2>Recebido</h2>
    <p class="metric-value">R$ <%= formatarMoeda(estatisticas.faturamento.recebido) %></p>
  </div>
  <div class="metric-card">
    <h2>Pendente</h2>
    <p class="metric-value">R$ <%= formatarMoeda(estatisticas.faturamento.pendente) %></p>
  </div>
  <div class="metric-card">
    <h2>Atendimentos realizados</h2>
    <p class="metric-value"><%= estatisticas.atendimentos.total %></p>
  </div>
</div>

<section class="report-section">
  <h2>Faturamento por especialidade</h2>
  <div class="report-section-table">
    <table class="data-table">
      <thead>
        <tr>
          <th>Especialidade</th>
          <th>Total</th>
          <th>Recebido</th>
          <th>Pendente</th>
        </tr>
      </thead>
      <tbody>
        <% estatisticas.faturamento.porEspecialidade.forEach((linha) => { %>
        <tr>
          <td><%= linha.tipo_atendimento %></td>
          <td>R$ <%= formatarMoeda(linha.total) %></td>
          <td>R$ <%= formatarMoeda(linha.recebido) %></td>
          <td>R$ <%= formatarMoeda(linha.pendente) %></td>
        </tr>
        <% }) %>
      </tbody>
    </table>
  </div>
</section>

<section class="report-section">
  <h2>Atendimentos por especialidade</h2>
  <div class="report-section-table">
    <table class="data-table">
      <thead>
        <tr>
          <th>Especialidade</th>
          <th>Quantidade</th>
        </tr>
      </thead>
      <tbody>
        <% estatisticas.atendimentos.porEspecialidade.forEach((linha) => { %>
        <tr>
          <td><%= linha.tipo_atendimento %></td>
          <td><%= linha.quantidade %></td>
        </tr>
        <% }) %>
      </tbody>
    </table>
  </div>
</section>

<section class="report-section">
  <h2>Atendimentos por profissional</h2>
  <div class="report-section-table">
    <table class="data-table">
      <thead>
        <tr>
          <th>Profissional</th>
          <th>Quantidade</th>
        </tr>
      </thead>
      <tbody>
        <% estatisticas.atendimentos.porProfissional.forEach((linha) => { %>
        <tr>
          <td><%= linha.profissional %></td>
          <td><%= linha.quantidade %></td>
        </tr>
        <% }) %>
      </tbody>
    </table>
  </div>
</section>

<%- include("../partials/footer") %>
```

- [ ] **Step 5: Add the sidebar link**

In `src/views/partials/header.ejs`, add a new line right after the Financeiro link (which is right before the Psicólogos link):

```html
<a class="sidebar-link<%= ativo('/financeiro') ? ' is-active' : '' %>" href="/financeiro"<% if (ativo('/financeiro')) { %> aria-current="page"<% } %>>Financeiro</a>
<a class="sidebar-link<%= ativo('/estatisticas') ? ' is-active' : '' %>" href="/estatisticas"<% if (ativo('/estatisticas')) { %> aria-current="page"<% } %>>Estatísticas</a>
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test test/estatisticasView.test.js`
Expected: PASS (3 tests)

- [ ] **Step 7: Run the full suite**

Run: `npm test && npm run lint`
Expected: PASS, no failures, no lint errors

- [ ] **Step 8: Manual check against a live server**

Run: `npm run dev`, log in, open `http://localhost:3000/estatisticas`. Confirm:
- The sidebar shows "Estatísticas" and highlights when active.
- Preset buttons (Hoje/Semana/Mês/Ano) change the period and the highlighted button matches the URL's `periodo`.
- The "De/Até" form filters a custom range.
- Numbers match what you'd expect from `/financeiro` and `/agendamentos` data for the same period (spot-check one number against `/financeiro/relatorio` for the current month).

- [ ] **Step 9: Commit**

```bash
git add src/views/estatisticas/lista.ejs src/views/partials/header.ejs public/dashboard.css test/estatisticasView.test.js
git commit -m "feat: view /estatisticas com filtro de período e item no menu"
```

---

### Task 5: Documentation

**Files:**
- Modify: `TODO.md`
- Modify: `README.md` (only if it maintains a route/feature list — check first)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by other tasks — this is the last task.

- [ ] **Step 1: Check whether README documents the dashboard's routes/screens**

```bash
grep -n "psicologos\|/financeiro\b" README.md
```

If README lists dashboard screens/routes (e.g. in a features overview section), add `/estatisticas` there following the same format as the surrounding entries. If it doesn't (README's structure may only document setup and migrations, not every screen), skip this file — don't invent a section that doesn't fit the doc's existing structure.

- [ ] **Step 2: Update TODO.md**

Open `TODO.md` and find the line (around line 126):

```
- [ ] Decidir o futuro de Guia/TISS, Estoque e Estatísticas a partir do
  material preservado em `quarantine/2026-08-28-modulos-nao-aprovados/`.
```

Replace it with two lines — keep the still-open Guia/TISS/Estoque decision, and record Estatísticas as done:

```
- [ ] Decidir o futuro de Guia/TISS e Estoque a partir do material
  preservado em `quarantine/2026-08-28-modulos-nao-aprovados/`. TISS
  confirmado como necessário (clínica atende convênio, 2026-09-03) — falta
  sequenciar dentro do roadmap.
- [x] Estatísticas: tela `/estatisticas` implementada (2026-09-03) —
  faturamento e atendimentos realizados por período (hoje/semana/mês/ano ou
  intervalo livre), qualquer usuário logado. Spec
  `docs/superpowers/specs/2026-09-03-estatisticas-design.md`, plano
  `docs/superpowers/plans/2026-09-03-estatisticas.md`. Não reaproveita o
  código quarantenado (escopo diferente: período flexível + faturamento,
  não só contagem mensal).
```

- [ ] **Step 3: Run the full suite one last time**

Run: `npm test && npm run lint`
Expected: PASS, no failures, no lint errors

- [ ] **Step 4: Commit**

```bash
git add TODO.md README.md
git commit -m "docs: registra o módulo de estatísticas implementado"
```

(If Step 1 found nothing to change in README.md, just `git add TODO.md` instead.)
