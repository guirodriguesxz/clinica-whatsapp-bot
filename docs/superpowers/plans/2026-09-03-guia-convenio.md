# Guia de Convênio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the reception register a `'convenio'` payment in `/financeiro` and generate a simple reference PDF ("guia de convênio") for it on demand — no TISS/ANS electronic format, no new database tables.

**Architecture:** A one-line migration adds `'convenio'` to `pagamentos.forma_pagamento`'s CHECK constraint — no new columns, since `pacientes.convenio`/`pacientes.matricula_convenio` already exist and `pagamentos.paciente_id` is always populated. A new model (`guiaConvenioModel.js`) reads one payment's full context (patient, convênio, appointment, reversal status) in a single query. A new PDF service (`guiaConvenioPdfService.js`) mirrors `laudoPdfService.js`'s pure-header-lines-plus-pdfkit shape. A new controller function + route wire them together, following the existing `gerarLaudoBot`/`gerarLaudoImportado` pattern exactly. The view gains one new `<option>` in the existing "Registrar pagamento" form and one new conditional link per payment entry.

**Tech Stack:** Node.js (ESM), Express, `pg` (raw SQL, no ORM), `pdfkit`, EJS views, `node --test` + `node:assert/strict` (no test DB — models are tested by mocking `pool.query` via `t.mock.method`).

**Spec:** `docs/superpowers/specs/2026-09-03-guia-convenio-design.md`

## Global Constraints

- No new database table and no new column — the only schema change is widening `pagamentos.forma_pagamento`'s CHECK constraint to include `'convenio'`.
- The guia PDF has no visual identity/branding beyond what `laudoPdfService.js` already establishes (plain text, `NOME_CLINICA` header) — do not invent new PDF styling.
- The route that generates the guia does **not** validate `forma_pagamento` — it generates from any existing, non-reversal payment row (see spec's "Não entra" section). The only gate on *when* this is used is the "Gerar guia" link only appearing on `convenio` rows in the view.
- A payment is "already reversed" when a **separate** row exists with `pagamento_origem_id` pointing at it (`estornarPagamento` in `pagamentoModel.js` never mutates the original row's `status`) — never check `pg.status = 'estornado'` for this.
- Requesting the guia for a payment row that is itself a reversal (`tipo_lancamento = 'estorno'`) is a 404, not a guia — the guia always generates from the original payment.
- Follow the existing dependency-injection-via-default-params pattern for controller functions that the codebase already uses (see `gerarLaudoBot`/`gerarLaudoImportado` in `src/controllers/dashboardController.js`) only where the plan's own task text asks for it — the laudo controller functions this task mirrors do NOT use that pattern themselves (no test needs it), so match `gerarLaudoBot`'s actual style, not an idealized one.

---

### Task 1: Migration

**Files:**
- Create: `src/db/migrations/025_guia_convenio.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `pagamentos.forma_pagamento` CHECK constraint now allows `'convenio'` alongside `'pix'`/`'cartao'`. This is a database-side change the user applies manually to production (Neon) before deploying the code from Tasks 3-5 — this task only creates the SQL file, it does not run it (this project has no separate dev database; migrations are applied by the user directly in production, per the existing convention documented in `README.md`'s numbered migration list).

- [ ] **Step 1: Write the migration file**

Create `src/db/migrations/025_guia_convenio.sql`:

```sql
-- src/db/migrations/025_guia_convenio.sql
-- Clínica Exemplo Bot — migration 025: guia de convênio (sub-projeto "Guia de
-- convênio", ver docs/superpowers/specs/2026-09-03-guia-convenio-design.md).
-- Rodar no SQL Editor do Neon (ou via psql) antes de fazer deploy do código
-- que usa isso — sem essa migration, registrar um pagamento com
-- forma_pagamento = 'convenio' falha com violação de CHECK.
--
-- ATENÇÃO: este projeto não tem banco de dev separado do de produção — só
-- aplicar depois de confirmar com o usuário.
--
-- O nome real da constraint (gerada automaticamente pelo Postgres) precisa
-- ser confirmado com `\d pagamentos` antes de rodar em produção — mesma
-- ressalva já usada nas migrations 011 e 013. Se o nome divergir de
-- `pagamentos_forma_pagamento_check`, ajuste o DROP CONSTRAINT abaixo pelo
-- nome real antes de aplicar.

ALTER TABLE pagamentos DROP CONSTRAINT IF EXISTS pagamentos_forma_pagamento_check;
ALTER TABLE pagamentos ADD CONSTRAINT pagamentos_forma_pagamento_check
  CHECK (forma_pagamento IN ('pix', 'cartao', 'convenio'));
```

- [ ] **Step 2: Commit**

```bash
git add src/db/migrations/025_guia_convenio.sql
git commit -m "feat: migration 025 — libera 'convenio' em pagamentos.forma_pagamento"
```

---

### Task 2: Model `guiaConvenioModel.js`

**Files:**
- Create: `src/models/guiaConvenioModel.js`
- Test: `test/guiaConvenioModel.test.js`

**Interfaces:**
- Consumes: `pool` from `src/db/pool.js`.
- Produces: `buscarDadosGuiaConvenio(pagamentoId)` → one of:
  - `{ motivo: "nao_encontrado" }` — no payment row with that id.
  - `{ motivo: "eh_estorno" }` — the row exists but is itself a reversal (`tipo_lancamento === "estorno"`).
  - `{ dados: { pacienteNome, convenio, matriculaConvenio, tipoAtendimento, dataAtendimento, valor, profissionalResponsavel, numeroGuia, cancelada } }` — the happy path. `numeroGuia` is the payment's own `id` (as a number). `cancelada` is `true` when a reversal row exists (`estornado_por` from the query is not null), `false` otherwise. `convenio`/`matriculaConvenio`/`profissionalResponsavel` are `null` when absent (never omitted from the object, never coerced to empty string) — this is what lets `guiaConvenioPdfService.js` (Task 3) decide per-line whether to print them, the same way `laudoPdfService.js`'s `linhasCabecalhoLaudo` already does for `profissionalResponsavel`.

  Used by Task 4's controller.

- [ ] **Step 1: Write the failing tests**

Create `test/guiaConvenioModel.test.js`:

```js
// test/guiaConvenioModel.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { buscarDadosGuiaConvenio } from "../src/models/guiaConvenioModel.js";

test("buscarDadosGuiaConvenio: pagamento inexistente retorna motivo nao_encontrado", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await buscarDadosGuiaConvenio(999);

  assert.deepEqual(resultado, { motivo: "nao_encontrado" });
});

test("buscarDadosGuiaConvenio: linha do próprio estorno retorna motivo eh_estorno, sem expor os dados", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        id: 42,
        valor: "150.00",
        tipo_lancamento: "estorno",
        paciente_nome: "Maria",
        convenio: "Vale Saúde",
        matricula_convenio: "12345",
        tipo_atendimento: "fisioterapia",
        data_atendimento: "2026-08-20",
        profissional_responsavel: null,
        estornado_por: null,
      },
    ],
  }));

  const resultado = await buscarDadosGuiaConvenio(42);

  assert.deepEqual(resultado, { motivo: "eh_estorno" });
});

test("buscarDadosGuiaConvenio: caminho feliz com todos os campos presentes", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return {
      rows: [
        {
          id: 7,
          valor: "300.00",
          tipo_lancamento: "pagamento",
          paciente_nome: "Maria",
          convenio: "Vale Saúde",
          matricula_convenio: "12345",
          tipo_atendimento: "fisioterapia",
          data_atendimento: "2026-08-20",
          profissional_responsavel: "Dra. Ana",
          estornado_por: null,
        },
      ],
    };
  });

  const resultado = await buscarDadosGuiaConvenio(7);

  assert.deepEqual(resultado, {
    dados: {
      pacienteNome: "Maria",
      convenio: "Vale Saúde",
      matriculaConvenio: "12345",
      tipoAtendimento: "fisioterapia",
      dataAtendimento: "2026-08-20",
      valor: "300.00",
      profissionalResponsavel: "Dra. Ana",
      numeroGuia: 7,
      cancelada: false,
    },
  });
  assert.deepEqual(chamadas[0].params, [7]);
});

test("buscarDadosGuiaConvenio: campos opcionais ausentes ficam null (convenio, matricula, profissional)", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        id: 8,
        valor: "150.00",
        tipo_lancamento: "pagamento",
        paciente_nome: "João",
        convenio: null,
        matricula_convenio: null,
        tipo_atendimento: "psicologia",
        data_atendimento: "2026-08-21",
        profissional_responsavel: null,
        estornado_por: null,
      },
    ],
  }));

  const resultado = await buscarDadosGuiaConvenio(8);

  assert.equal(resultado.dados.convenio, null);
  assert.equal(resultado.dados.matriculaConvenio, null);
  assert.equal(resultado.dados.profissionalResponsavel, null);
});

test("buscarDadosGuiaConvenio: pagamento com estorno vinculado marca cancelada true", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        id: 9,
        valor: "150.00",
        tipo_lancamento: "pagamento",
        paciente_nome: "João",
        convenio: "Bússola Saúde",
        matricula_convenio: null,
        tipo_atendimento: "psicologia",
        data_atendimento: "2026-08-21",
        profissional_responsavel: null,
        estornado_por: 15,
      },
    ],
  }));

  const resultado = await buscarDadosGuiaConvenio(9);

  assert.equal(resultado.dados.cancelada, true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/guiaConvenioModel.test.js`
Expected: FAIL — `Cannot find module '../src/models/guiaConvenioModel.js'`

- [ ] **Step 3: Implement `guiaConvenioModel.js`**

Create `src/models/guiaConvenioModel.js`:

```js
// src/models/guiaConvenioModel.js
import { pool } from "../db/pool.js";

/**
 * Dados de uma guia de convênio pra um pagamento — sempre a partir do
 * estado atual, sem histórico de guias como entidade própria (mesma
 * decisão já usada nos Laudos, ver laudoModel.js).
 *
 * pagamentos.paciente_id é sempre preenchido (bot ou importado) e
 * pacientes.convenio/matricula_convenio já existem desde antes deste
 * módulo — por isso essa consulta não precisa resolver telefone/paciente
 * como o fluxo de registrar pagamento importado faz.
 *
 * "cancelada" detecta o estorno pela EXISTÊNCIA de uma linha própria
 * ligada por pagamento_origem_id (append-only, migration 013) — nunca
 * pelo status da linha original, que estornarPagamento nunca altera.
 */
export async function buscarDadosGuiaConvenio(pagamentoId) {
  const { rows } = await pool.query(
    `SELECT
       pg.id, pg.valor, pg.tipo_lancamento,
       p.nome AS paciente_nome, p.convenio, p.matricula_convenio,
       COALESCE(a.tipo_atendimento, ai.tipo_atendimento) AS tipo_atendimento,
       COALESCE(a.data, ai.data) AS data_atendimento,
       ra.profissional_responsavel,
       estorno.id AS estornado_por
     FROM pagamentos pg
     JOIN pacientes p ON p.id = pg.paciente_id
     LEFT JOIN agendamentos a ON a.id = pg.agendamento_id
     LEFT JOIN agendamentos_importados ai ON ai.id = pg.agendamento_importado_id
     LEFT JOIN registros_atendimento ra
       ON ra.agendamento_id = pg.agendamento_id OR ra.agendamento_importado_id = pg.agendamento_importado_id
     LEFT JOIN pagamentos estorno ON estorno.pagamento_origem_id = pg.id
     WHERE pg.id = $1`,
    [pagamentoId]
  );
  const registro = rows[0];
  if (!registro) return { motivo: "nao_encontrado" };
  if (registro.tipo_lancamento === "estorno") return { motivo: "eh_estorno" };

  return {
    dados: {
      pacienteNome: registro.paciente_nome,
      convenio: registro.convenio ?? null,
      matriculaConvenio: registro.matricula_convenio ?? null,
      tipoAtendimento: registro.tipo_atendimento,
      dataAtendimento: registro.data_atendimento,
      valor: registro.valor,
      profissionalResponsavel: registro.profissional_responsavel ?? null,
      numeroGuia: registro.id,
      cancelada: registro.estornado_por != null,
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/guiaConvenioModel.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/models/guiaConvenioModel.js test/guiaConvenioModel.test.js
git commit -m "feat: adiciona buscarDadosGuiaConvenio"
```

---

### Task 3: PDF service `guiaConvenioPdfService.js`

**Files:**
- Create: `src/services/guiaConvenioPdfService.js`
- Test: `test/guiaConvenioPdfService.test.js`

**Interfaces:**
- Consumes: `pdfkit` (same as `laudoPdfService.js`), the `dados` shape Task 2 produces.
- Produces: `linhasGuiaConvenio(dados)` (pure function, no pdfkit) → an array of header-line strings, and `gerarPdfGuiaConvenio(dados)` (async) → a `Buffer` containing a real PDF. `dados` is exactly the `dados` object Task 2's `buscarDadosGuiaConvenio` returns on its happy path (`{ pacienteNome, convenio, matriculaConvenio, tipoAtendimento, dataAtendimento, valor, profissionalResponsavel, numeroGuia, cancelada }`). Used by Task 4's controller.

- [ ] **Step 1: Write the failing tests**

Create `test/guiaConvenioPdfService.test.js`:

```js
// test/guiaConvenioPdfService.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { linhasGuiaConvenio, gerarPdfGuiaConvenio } from "../src/services/guiaConvenioPdfService.js";

const DADOS_BASE = {
  pacienteNome: "Maria",
  convenio: "Vale Saúde",
  matriculaConvenio: "12345",
  tipoAtendimento: "fisioterapia",
  dataAtendimento: "2026-08-20",
  valor: "300.00",
  profissionalResponsavel: "Dra. Ana",
  numeroGuia: 7,
  cancelada: false,
};

test("linhasGuiaConvenio: inclui todas as linhas quando todos os campos opcionais estão presentes", () => {
  const linhas = linhasGuiaConvenio(DADOS_BASE);

  assert.ok(linhas.some((linha) => linha.includes("Maria")));
  assert.ok(linhas.some((linha) => linha.includes("Vale Saúde")));
  assert.ok(linhas.some((linha) => linha.includes("12345")));
  assert.ok(linhas.some((linha) => linha.includes("Dra. Ana")));
  assert.ok(linhas.some((linha) => linha.includes("7")));
});

test("linhasGuiaConvenio: omite matrícula quando null", () => {
  const linhas = linhasGuiaConvenio({ ...DADOS_BASE, matriculaConvenio: null });

  assert.ok(!linhas.some((linha) => linha.toLowerCase().includes("matr")));
});

test("linhasGuiaConvenio: omite convênio quando null", () => {
  const linhas = linhasGuiaConvenio({ ...DADOS_BASE, convenio: null });

  assert.ok(!linhas.some((linha) => linha.toLowerCase().includes("convênio:")));
});

test("linhasGuiaConvenio: omite profissional quando null", () => {
  const linhas = linhasGuiaConvenio({ ...DADOS_BASE, profissionalResponsavel: null });

  assert.ok(!linhas.some((linha) => linha.toLowerCase().includes("profissional")));
});

test("gerarPdfGuiaConvenio: gera um PDF de verdade em memória (smoke test, sem mock)", async () => {
  const buffer = await gerarPdfGuiaConvenio(DADOS_BASE);

  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 0);
  assert.equal(buffer.subarray(0, 4).toString("latin1"), "%PDF");
});

test("gerarPdfGuiaConvenio: funciona com todos os campos opcionais ausentes", async () => {
  const buffer = await gerarPdfGuiaConvenio({
    ...DADOS_BASE,
    convenio: null,
    matriculaConvenio: null,
    profissionalResponsavel: null,
  });

  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/guiaConvenioPdfService.test.js`
Expected: FAIL — `Cannot find module '../src/services/guiaConvenioPdfService.js'`

- [ ] **Step 3: Implement `guiaConvenioPdfService.js`**

Create `src/services/guiaConvenioPdfService.js`:

```js
// src/services/guiaConvenioPdfService.js
import PDFDocument from "pdfkit";

const NOME_CLINICA = "Clínica Exemplo — Fisioterapia & Psicologia";

/**
 * Linhas de cabeçalho da guia de convênio — função pura, mesmo motivo de
 * linhasCabecalhoLaudo em laudoPdfService.js: pdfkit não expõe um jeito
 * simples de inspecionar o que já foi escrito antes de doc.end(), então
 * extrair isso deixa a regra "campo ausente só não aparece" testável sem
 * gerar/ler um PDF de verdade a cada caso.
 */
export function linhasGuiaConvenio(dados) {
  const {
    pacienteNome,
    convenio,
    matriculaConvenio,
    tipoAtendimento,
    dataAtendimento,
    valor,
    profissionalResponsavel,
    numeroGuia,
  } = dados;

  const linhas = [`Guia nº ${numeroGuia}`, `Paciente: ${pacienteNome}`];
  if (convenio) linhas.push(`Convênio: ${convenio}`);
  if (matriculaConvenio) linhas.push(`Matrícula: ${matriculaConvenio}`);
  linhas.push(`Tipo de atendimento: ${tipoAtendimento}`);
  linhas.push(`Data do atendimento: ${dataAtendimento}`);
  linhas.push(`Valor: R$ ${valor}`);
  if (profissionalResponsavel) linhas.push(`Profissional responsável: ${profissionalResponsavel}`);

  return linhas;
}

/**
 * Gera o PDF da guia em memória — nunca salvo em disco/banco, mesma
 * decisão dos Laudos. Estampa "GUIA CANCELADA" com destaque quando o
 * pagamento já tem um estorno vinculado — sem bloquear a geração.
 */
export function gerarPdfGuiaConvenio(dados) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).text(NOME_CLINICA, { align: "center" });
    doc.moveDown(2);

    if (dados.cancelada) {
      doc.fontSize(14).fillColor("red").text("GUIA CANCELADA", { align: "center" });
      doc.fillColor("black");
      doc.moveDown();
    }

    doc.fontSize(12);
    for (const linha of linhasGuiaConvenio(dados)) {
      doc.text(linha);
    }

    doc.end();
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/guiaConvenioPdfService.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/guiaConvenioPdfService.js test/guiaConvenioPdfService.test.js
git commit -m "feat: adiciona gerarPdfGuiaConvenio"
```

---

### Task 4: Controller + rota + registro de pagamento em convênio

**Files:**
- Modify: `src/controllers/dashboardController.js`
- Modify: `src/routes/dashboardRoutes.js`
- Test: `test/dashboardControllerGuiaConvenio.test.js`

**Interfaces:**
- Consumes: `buscarDadosGuiaConvenio` from `src/models/guiaConvenioModel.js` (Task 2), `gerarPdfGuiaConvenio` from `src/services/guiaConvenioPdfService.js` (Task 3), the existing `idSeguro` (from `src/utils/paginacao.js`, already imported in this file) and `slugArquivo` (private helper already in this file, line ~652) and `exigirLogin`/`exigirCsrf`/`asyncHandler`.
- Produces: `gerarGuiaConvenio(req, res)` exported from `dashboardController.js`, and the route `GET /financeiro/pagamento/:id/guia`. Also widens the existing `FORMA_PAGAMENTO_VALIDA` constant (currently `["pix", "cartao"]`, around line 704 of `dashboardController.js`, used by `validarCamposPagamento` to accept a "Registrar pagamento" submission) to include `"convenio"` — without this, the migration alone doesn't let the reception actually register a convênio payment through the existing form; `processarPagamentoAgendamento`/`processarPagamentoImportado` (Task 5's view submits to these, unchanged) would reject it with a 400 before it ever reaches the database.

- [ ] **Step 1: Write the failing tests**

Create `test/dashboardControllerGuiaConvenio.test.js`:

```js
// test/dashboardControllerGuiaConvenio.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { gerarGuiaConvenio } from "../src/controllers/dashboardController.js";

function criarRespostaFalsa() {
  return {
    statusCode: 200,
    corpo: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(nome, valor) {
      this.headers[nome] = valor;
      return this;
    },
    send(corpo) {
      this.corpo = corpo;
      return this;
    },
  };
}

function criarRequisicao({ params = {} } = {}) {
  return { params };
}

test("gerarGuiaConvenio: id não numérico responde 404 sem consultar o banco", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await gerarGuiaConvenio(criarRequisicao({ params: { id: "abc" } }), res);

  assert.equal(res.statusCode, 404);
  assert.equal(consultas.length, 0);
});

test("gerarGuiaConvenio: pagamento inexistente responde 404", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const res = criarRespostaFalsa();

  await gerarGuiaConvenio(criarRequisicao({ params: { id: "999" } }), res);

  assert.equal(res.statusCode, 404);
});

test("gerarGuiaConvenio: linha de estorno responde 404", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        id: 42,
        valor: "150.00",
        tipo_lancamento: "estorno",
        paciente_nome: "Maria",
        convenio: "Vale Saúde",
        matricula_convenio: null,
        tipo_atendimento: "fisioterapia",
        data_atendimento: "2026-08-20",
        profissional_responsavel: null,
        estornado_por: null,
      },
    ],
  }));
  const res = criarRespostaFalsa();

  await gerarGuiaConvenio(criarRequisicao({ params: { id: "42" } }), res);

  assert.equal(res.statusCode, 404);
});

test("gerarGuiaConvenio: caminho feliz responde com o PDF e os headers corretos", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        id: 7,
        valor: "300.00",
        tipo_lancamento: "pagamento",
        paciente_nome: "Maria",
        convenio: "Vale Saúde",
        matricula_convenio: "12345",
        tipo_atendimento: "fisioterapia",
        data_atendimento: "2026-08-20",
        profissional_responsavel: "Dra. Ana",
        estornado_por: null,
      },
    ],
  }));
  const res = criarRespostaFalsa();

  await gerarGuiaConvenio(criarRequisicao({ params: { id: "7" } }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Content-Type"], "application/pdf");
  assert.match(res.headers["Content-Disposition"], /^attachment; filename="guia-maria-2026-08-20\.pdf"$/);
  assert.ok(Buffer.isBuffer(res.corpo));
  assert.equal(res.corpo.subarray(0, 4).toString("latin1"), "%PDF");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/dashboardControllerGuiaConvenio.test.js`
Expected: FAIL — `gerarGuiaConvenio is not a function` (not exported yet)

- [ ] **Step 3: Add imports, widen `FORMA_PAGAMENTO_VALIDA`, add `gerarGuiaConvenio`**

In `src/controllers/dashboardController.js`, add to the imports near the top (alongside the other model/service imports):

```js
import { buscarDadosGuiaConvenio } from "../models/guiaConvenioModel.js";
import { gerarPdfGuiaConvenio } from "../services/guiaConvenioPdfService.js";
```

Find the existing line (around line 704):

```js
const FORMA_PAGAMENTO_VALIDA = ["pix", "cartao"];
```

Change it to:

```js
const FORMA_PAGAMENTO_VALIDA = ["pix", "cartao", "convenio"];
```

Add this function right after `gerarLaudoImportado` (around line 702), following the exact same shape as `gerarLaudoBot`/`gerarLaudoImportado`:

```js
export async function gerarGuiaConvenio(req, res) {
  const pagamentoId = idSeguro(req.params.id);
  if (!pagamentoId) {
    return res.status(404).send("Pagamento não encontrado.");
  }

  const resultado = await buscarDadosGuiaConvenio(pagamentoId);
  if (resultado.motivo === "nao_encontrado") {
    return res.status(404).send("Pagamento não encontrado.");
  }
  if (resultado.motivo === "eh_estorno") {
    return res.status(404).send("Pagamento não encontrado.");
  }

  const pdf = await gerarPdfGuiaConvenio(resultado.dados);
  const nomeArquivo = `guia-${slugArquivo(resultado.dados.pacienteNome)}-${resultado.dados.dataAtendimento}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo}"`);
  res.send(pdf);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/dashboardControllerGuiaConvenio.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Wire the route**

In `src/routes/dashboardRoutes.js`, add `gerarGuiaConvenio` to the existing import block from `../controllers/dashboardController.js` (next to `gerarLaudoBot`, `gerarLaudoImportado`), then add the route right after the `/financeiro/relatorio` GET route and before the `/estatisticas` route (or right after it — exact position among GET routes doesn't matter, just keep it out of the POST block below):

```js
router.get(
  "/financeiro/pagamento/:id/guia",
  asyncHandler(exigirLogin),
  asyncHandler(gerarGuiaConvenio)
);
```

- [ ] **Step 6: Run the full test suite to check for regressions**

Run: `npm test`
Expected: PASS, no failures

- [ ] **Step 7: Commit**

```bash
git add src/controllers/dashboardController.js src/routes/dashboardRoutes.js test/dashboardControllerGuiaConvenio.test.js
git commit -m "feat: adiciona controller e rota GET /financeiro/pagamento/:id/guia"
```

---

### Task 5: View — opção "Convênio" e link "Gerar guia"

**Files:**
- Modify: `src/views/financeiro/lista.ejs`
- Test: `test/financeiroViews.test.js` (extend, don't replace)

**Interfaces:**
- Consumes: `item.pagamentos[].forma_pagamento`, `.tipo_lancamento`, `.id` (all already present in every payment entry the view already renders — no new data needed from the controller/model).
- Produces: nothing consumed by another task — this is the last functional task.

- [ ] **Step 1: Write the failing tests**

Open `test/financeiroViews.test.js` and add these two tests (append near the end of the file, following the file's existing `renderizar(...)` helper pattern already defined at the top of that file):

```js
test("financeiro/lista: mostra 'Gerar guia' numa entrada de pagamento com forma_pagamento convenio", async () => {
  const itens = [
    {
      id: 1,
      data: "2026-08-20",
      hora: "10:00:00",
      paciente_nome: "Fulana",
      tipo_atendimento: "fisioterapia",
      origem: "bot",
      pagamentos: [
        {
          id: 10,
          valor: 300,
          forma_pagamento: "convenio",
          parcelas: null,
          valor_acrescimo: null,
          status: "pago",
          data: "2026-08-20",
          observacao: null,
          tipo_lancamento: "pagamento",
        },
      ],
    },
  ];

  const html = await renderizar("financeiro/lista.ejs", {
    itens,
    filtroData: null,
    limiteAtual: 50,
    offsetAtual: 0,
    temProximaPagina: false,
  });

  assert.match(html, /href="\/financeiro\/pagamento\/10\/guia"/);
  assert.match(html, /Gerar guia/);
});

test("financeiro/lista: não mostra 'Gerar guia' numa entrada pix/cartão, nem na linha do próprio estorno", async () => {
  const itens = [
    {
      id: 1,
      data: "2026-08-20",
      hora: "10:00:00",
      paciente_nome: "Fulana",
      tipo_atendimento: "fisioterapia",
      origem: "bot",
      pagamentos: [
        {
          id: 11,
          valor: 150,
          forma_pagamento: "pix",
          parcelas: null,
          valor_acrescimo: null,
          status: "pago",
          data: "2026-08-20",
          observacao: null,
          tipo_lancamento: "pagamento",
        },
        {
          id: 12,
          valor: 300,
          forma_pagamento: "convenio",
          parcelas: null,
          valor_acrescimo: null,
          status: "pago",
          data: "2026-08-20",
          observacao: null,
          tipo_lancamento: "estorno",
          pagamento_origem_id: 10,
        },
      ],
    },
  ];

  const html = await renderizar("financeiro/lista.ejs", {
    itens,
    filtroData: null,
    limiteAtual: 50,
    offsetAtual: 0,
    temProximaPagina: false,
  });

  assert.ok(!html.includes("Gerar guia"));
});

test("financeiro/lista: formulário 'Registrar pagamento' tem a opção Convênio", async () => {
  const html = await renderizar("financeiro/lista.ejs", {
    itens: [],
    filtroData: null,
    limiteAtual: 50,
    offsetAtual: 0,
    temProximaPagina: false,
  });

  assert.match(html, /<option value="convenio">Convênio<\/option>/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/financeiroViews.test.js`
Expected: FAIL — the new assertions don't match anything in the current template

- [ ] **Step 3: Add the "Convênio" option to the payment form**

In `src/views/financeiro/lista.ejs`, find:

```html
<select name="forma_pagamento" required>
  <option value="pix">Pix</option>
  <option value="cartao">Cartão</option>
</select>
```

Change it to:

```html
<select name="forma_pagamento" required>
  <option value="pix">Pix</option>
  <option value="cartao">Cartão</option>
  <option value="convenio">Convênio</option>
</select>
```

- [ ] **Step 4: Add the "Gerar guia" link**

In the same file, find the `<summary>` block for each payment entry (the one showing `R$ <%= formatarMoeda(p.valor) %> — <%= p.forma_pagamento %> ...`). Immediately after that `</summary>` closing tag (still inside the surrounding `<details class="<%= classesEntrada %>">`), add:

```html
<% if (p.forma_pagamento === "convenio" && !ehEstorno) { %>
<p><a href="/financeiro/pagamento/<%= p.id %>/guia">Gerar guia</a></p>
<% } %>
```

`ehEstorno` is already computed earlier in the same `forEach` iteration (`const ehEstorno = p.tipo_lancamento === "estorno";`) — reuse it, don't recompute.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/financeiroViews.test.js`
Expected: PASS (all existing tests plus the 3 new ones)

- [ ] **Step 6: Run the full suite and lint**

Run: `npm test && npm run lint`
Expected: PASS, no failures, no lint errors

- [ ] **Step 7: Manual check against a live server**

If you have `.env` with a working `DATABASE_URL` and dashboard login credentials: run `npm run dev`, log in, open `/financeiro`, register a payment with "Convênio" as the form, confirm "Gerar guia" appears and downloads a PDF with the expected fields. If you don't have credentials (e.g. this task runs in an isolated worktree with no `.env`), skip this step and say so explicitly in your report — do not claim it was done.

- [ ] **Step 8: Commit**

```bash
git add src/views/financeiro/lista.ejs test/financeiroViews.test.js
git commit -m "feat: view /financeiro — opção Convênio e link Gerar guia"
```

---

### Task 6: Documentation

**Files:**
- Modify: `README.md`
- Modify: `TODO.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by other tasks — this is the last task.

- [ ] **Step 1: Add the migration to README's numbered list**

Open `README.md` and find item 10 in the migrations list (around line 72):

```
   10. `src/db/migrations/024_psicologos.sql` — cria a tabela `psicologos` (`id`, `nome`, `ativo`, `created_at`), usada pela nova tela de cadastro `/psicologos` — ver seção 7.1. **Precisa rodar no Neon antes de fazer deploy dessa funcionalidade**: o link "Psicólogos" no menu do dashboard aparece pra qualquer usuário logado, em qualquer página, sem checagem alguma — se o código for pro ar antes dessa migration rodar, o primeiro clique no link já esbarra num erro de tabela inexistente no banco.
```

Add a new item 11 right after it, matching the same style:

```
   11. `src/db/migrations/025_guia_convenio.sql` — libera `'convenio'` como valor de `pagamentos.forma_pagamento`, usado pela tela `/financeiro` pra registrar pagamento de convênio e gerar a guia em PDF — ver seção 7.1. **Precisa rodar no Neon antes de fazer deploy dessa funcionalidade**: sem essa migration, registrar um pagamento com forma "Convênio" falha com violação de CHECK no banco.
```

(If README's "seção 7.1" doesn't already describe `/financeiro`'s guia feature, don't invent a new subsection there — this list entry pointing at the migration is sufficient; adding prose documentation beyond the existing pattern is out of scope for this task.)

- [ ] **Step 2: Update TODO.md**

Open `TODO.md` and find the lines (around line 126, right after the Estatísticas entry that a previous session's plan added):

```
- [ ] Decidir o futuro de Guia/TISS e Estoque a partir do material
  preservado em `quarantine/2026-08-28-modulos-nao-aprovados/`. TISS
  confirmado como necessário (clínica atende convênio, 2026-09-03) — falta
  sequenciar dentro do roadmap.
```

Replace it with:

```
- [x] Guia de convênio: implementada (2026-09-03) como PDF simples gerado
  sob demanda em `/financeiro` (forma de pagamento "Convênio" + botão
  "Gerar guia"), não o padrão eletrônico TISS/ANS completo (XML, TUSS,
  homologação por operadora) — decisão de escopo confirmada pelo usuário.
  Spec `docs/superpowers/specs/2026-09-03-guia-convenio-design.md`, plano
  `docs/superpowers/plans/2026-09-03-guia-convenio.md`. **Pendência
  explícita**: o usuário respondeu com incerteza se a recepção realmente só
  usa o PDF como referência pros portais dos convênios, sem exigir arquivo
  TISS eletrônico — confirmar com quem cuida do faturamento assim que
  possível. Se confirmar que precisa do TISS eletrônico de verdade, vira
  uma extensão bem maior por cima deste trabalho, não retrabalho.
- [ ] Decidir o futuro de Estoque a partir do material preservado em
  `quarantine/2026-08-28-modulos-nao-aprovados/`.
```

- [ ] **Step 3: Run the full suite one last time**

Run: `npm test && npm run lint`
Expected: PASS, no failures, no lint errors

- [ ] **Step 4: Commit**

```bash
git add README.md TODO.md
git commit -m "docs: registra o módulo de guia de convênio implementado"
```
