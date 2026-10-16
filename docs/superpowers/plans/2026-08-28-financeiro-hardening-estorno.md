# Financeiro — Hardening e Estorno Append-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir bordas do Financeiro e implementar estorno como lançamento compensatório imutável.

**Architecture:** `pagamentos` continuará como extrato. Um original terá `tipo_lancamento = 'pagamento'`; um estorno será uma segunda linha vinculada ao original, inserida dentro de transação e protegida por índice único. TISS, Relatório de atendimento, Estoque e Estatísticas não participam desta implementação.

**Tech Stack:** Node.js 20+, Express, EJS, PostgreSQL/`pg`, `node --test`, ESLint.

**Spec:** `docs/superpowers/specs/2026-08-28-financeiro-hardening-estorno-design.md`

## Global Constraints

- Não alterar bot, webhook, `chatService`, IA ou Google Calendar.
- Não conectar no Neon de produção, aplicar migration, iniciar `server.js`, commitar, enviar ou fazer deploy.
- Testes de banco usam mocks e não provam compatibilidade com Neon.
- Preservar as correções autorizadas de arredondamento, telefone importado e clamps compartilhados.
- Enquanto TISS estiver em quarentena, aceitar somente `pix` e `cartao`.
- A migration nova é `013_financeiro_estorno_append_only.sql`; migrations extras 013–015 não coexistem no diretório ativo.

## File Structure

- `src/models/pacienteModel.js`: candidatos canônicos de telefone brasileiro.
- `src/models/pagamentoModel.js`: clamps, estorno transacional, listagem e relatório assinados.
- `src/controllers/dashboardController.js`: IDs estritos e respostas HTTP.
- `src/routes/dashboardRoutes.js`: somente rotas aprovadas.
- `src/views/financeiro/*.ejs`: histórico de estorno, sem Convênio ou Guia.
- `src/db/migrations/013_financeiro_estorno_append_only.sql`: contrato de schema não aplicado.
- `test/pagamentoModel.test.js`, `test/dashboardControllerFinanceiro.test.js`, `test/financeiroViews.test.js`: regressões.

### Task 1: Quarentenar o wiring de módulos extras

**Files:**
- Modify: `src/controllers/dashboardController.js`
- Modify: `src/routes/dashboardRoutes.js`
- Modify: `src/views/partials/header.ejs`
- Modify: `src/views/financeiro/lista.ejs`
- Modify: `package.json`, `package-lock.json`
- Test: `test/financeiroViews.test.js`

**Interfaces:**
- Produces: dashboard ativo sem rotas, imports, menu, formulário ou dependência de Guia, Relatório, Estoque e Estatísticas.
- Preserves: todos os arquivos extras; mover ou apagar requer confirmação explícita do usuário.

- [ ] **Step 1: Capturar inventário antes de qualquer movimento**

Run: `git status --short`

Run: `git diff --no-index /dev/null src/models/laudoModel.js`

Run: `git diff --no-index /dev/null src/services/laudoPdfService.js`

Expected: registrar a lista completa dos extras. A localização reversível aprovada por delegação do usuário é `quarantine/2026-08-28-modulos-nao-aprovados/`, no diretório raiz e fora de `src`, `test` e `src/db/migrations`. Não usar `git clean`, `git reset`, `rm` ou `git checkout`.

- [ ] **Step 2: Escrever testes de superfície isolada**

Add `import { pool } from "../src/db/pool.js";` to `test/pagamentoModel.test.js` if it is not already imported. Add to `test/financeiroViews.test.js`:

```js
test("financeiro não oferece Convênio nem guia", async () => {
  const html = await renderizar("financeiro/lista.ejs", {
    itens: [], filtroData: null, limiteAtual: 50, offsetAtual: 0, temProximaPagina: false,
  });
  assert.doesNotMatch(html, /value="convenio"/);
  assert.doesNotMatch(html, /Gerar guia/);
});
```

Add router assertions that `/financeiro/pagamento/:id/guia`, `/estoque`, `/fornecedores`, `/centros-custo` and `/estatisticas` are absent.

- [ ] **Step 3: Run tests and confirm red**

Run: `node --test test/financeiroViews.test.js test/dashboardControllerFinanceiro.test.js`

Expected: FAIL because active code still exposes Convênio/Guia and extra routes.

- [ ] **Step 4: Remove only active wiring after approval**

Remove extra handler imports/exports, routes and navigation links. Remove the Convênio option and `Gerar guia` from Financeiro. Remove `pdfkit` only if no active file imports it. Move extras only to the user-approved reversible location; never delete them.

- [ ] **Step 5: Run isolation verification**

Run: `node --test test/financeiroViews.test.js test/dashboardControllerFinanceiro.test.js`

Run: `rg -n "gerarGuiaConvenio|forma_pagamento.*convenio|/estoque|/estatisticas|/fornecedores|/centros-custo|pdfkit" src package.json`

Expected: tests PASS and no matches in active dashboard/Financeiro code.

### Task 2: Make telefone and pagination safe

**Files:**
- Modify: `src/models/pacienteModel.js`
- Modify: `src/models/pagamentoModel.js`
- Test: `test/pagamentoModel.test.js`

**Interfaces:**
- Produces: `buscarPacientePorTelefoneNormalizado(telefone)` with length-aware candidates.
- Produces: finite-integer `limiteSeguroListagem(limite)` and `offsetSeguroListagem(offset)`.

- [ ] **Step 1: Write failing regressions**

```js
test("DDD 55 recebe DDI antes do matching", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [{ id: 41 }] };
  });
  await buscarPacientePorTelefoneNormalizado("55 99999-9999");
  assert.deepEqual(chamadas[0].params, ["5555999999999", "55999999999"]);
});

test("clamps rejeitam decimal e infinito", () => {
  assert.equal(limiteSeguroListagem("1.5"), 50);
  assert.equal(limiteSeguroListagem("Infinity"), 50);
  assert.equal(offsetSeguroListagem("1.5"), 0);
  assert.equal(offsetSeguroListagem("Infinity"), 0);
});
```

Also test `201 → 200` for limit and `1000001 → 1000000` for offset.

- [ ] **Step 2: Run test and confirm red**

Run: `node --test test/pagamentoModel.test.js`

Expected: FAIL because existing code accepts leading `55` without checking length and permits decimal/infinite pagination.

- [ ] **Step 3: Implement minimal normalization**

Use this candidate order:

```js
if (digitos.length === 10 || digitos.length === 11) return [`55${digitos}`, digitos];
if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) {
  return [digitos, digitos.slice(2)];
}
return [digitos];
```

Use a shared parser requiring `/^\d+$/` and `Number.isSafeInteger`. Invalid limit defaults to 50 and invalid offset defaults to 0; clamp valid values to 1–200 and 0–1.000.000.

- [ ] **Step 4: Run test and confirm green**

Run: `node --test test/pagamentoModel.test.js`

Expected: PASS, including existing importado and report tests.

### Task 3: Validate IDs and prepare estorno input

**Files:**
- Modify: `src/controllers/dashboardController.js`
- Modify: `src/views/financeiro/lista.ejs`
- Test: `test/dashboardControllerFinanceiro.test.js`
- Test: `test/financeiroViews.test.js`

**Interfaces:**
- Consumes: Task 5 `estornarPagamento(id, { registradoPor, data, observacao })`.
- Produces: strict IDs and CSRF-protected estorno data.

- [ ] **Step 1: Write failing controller tests**

```js
for (const id of ["1abc", "1.9", "1e2", "Infinity", "9007199254740992"]) {
  test(`estorno rejeita ${id}`, async (t) => {
    const chamadas = [];
    const res = criarRespostaFalsa();
    const req = criarRequisicao({ params: { id }, body: {} });
    t.mock.method(pool, "query", async (sql, params) => {
      chamadas.push({ sql, params });
      return { rows: [] };
    });
    await processarEstorno(req, res);
    assert.equal(res.statusCode, 404);
    assert.equal(chamadas.length, 0);
  });
}
```

Add tests for invalid date (400, model not called) and happy path passing `registradoPor`, date and trimmed observation.

- [ ] **Step 2: Run test and confirm red**

Run: `node --test test/dashboardControllerFinanceiro.test.js test/financeiroViews.test.js`

Expected: FAIL because `parseInt("1abc", 10)` is permissive and the form has no audit data.

- [ ] **Step 3: Implement strict parsing**

```js
function idValido(valorBruto) {
  const texto = String(valorBruto ?? "");
  if (!/^\d+$/.test(texto)) return null;
  const id = Number(texto);
  return Number.isSafeInteger(id) && id >= 1 ? id : null;
}
```

Validate `validarData(req.body.data)`. Map `nao_encontrado` to 404 and `ja_estornado`/`nao_estornavel` to 400. Change the view to a CSRF-protected form containing `data` and `observacao`, shown only for original rows without `estornado_por`.

- [ ] **Step 4: Run test and confirm green**

Run: `node --test test/dashboardControllerFinanceiro.test.js test/financeiroViews.test.js`

Expected: PASS; no test expects status mutation.

### Task 4: Prepare migration 013, without applying it

**Files:**
- Create: `src/db/migrations/013_financeiro_estorno_append_only.sql`
- Modify: `README.md`
- Test: `test/pagamentoModel.test.js`

**Interfaces:**
- Produces: `tipo_lancamento`, `pagamento_origem_id` and unique estorno-per-original contract for Task 5.

- [ ] **Step 1: Write a failing migration-contract test**

```js
const sql = await readFile(MIGRATION_PATH, "utf8");
assert.match(sql, /ADD COLUMN IF NOT EXISTS tipo_lancamento TEXT NOT NULL DEFAULT 'pagamento'/);
assert.match(sql, /ADD COLUMN IF NOT EXISTS pagamento_origem_id INTEGER REFERENCES pagamentos\(id\)/);
assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_pagamentos_estorno_unico/);
assert.match(sql, /WHERE pagamento_origem_id IS NOT NULL/);
```

- [ ] **Step 2: Run test and confirm red**

Run: `node --test test/pagamentoModel.test.js`

Expected: FAIL because migration 013 does not exist.

- [ ] **Step 3: Write additive SQL**

Create the migration with a production warning; add both columns, `pagamentos_tipo_lancamento_check`, `pagamentos_estorno_origem_check`, and:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_pagamentos_estorno_unico
  ON pagamentos (pagamento_origem_id)
  WHERE pagamento_origem_id IS NOT NULL;
```

Do not edit migration 012. Do not remove `estornado` from its status CHECK; that requires a future read-only audit of production schema and rows. Document this exact constraint in README.

- [ ] **Step 4: Run test and confirm green**

Run: `node --test test/pagamentoModel.test.js`

Expected: PASS; this is not Neon validation.

### Task 5: Implement transactional estorno and signed reports

**Files:**
- Modify: `src/models/pagamentoModel.js`
- Test: `test/pagamentoModel.test.js`

**Interfaces:**
- Produces: `estornarPagamento(pagamentoId, { registradoPor, data, observacao })` returning `{ pagamento }` or `nao_encontrado`, `ja_estornado`, `nao_estornavel`.
- Produces: list rows with `tipo_lancamento`, `pagamento_origem_id`, `estornado_por`.

- [ ] **Step 1: Write failing transaction tests**

Mock `pool.connect()` and assert `BEGIN`, `SELECT ... FOR UPDATE`, estorno lookup, `INSERT`, `COMMIT`, rollback on failure, `client.release()` always, and no `UPDATE pagamentos` or `DELETE FROM pagamentos`. Test nonexistent, second estorno, estorno of estorno and PostgreSQL `23505` race.

- [ ] **Step 2: Run test and confirm red**

Run: `node --test test/pagamentoModel.test.js`

Expected: FAIL because current code updates the original status.

- [ ] **Step 3: Implement insert-only flow**

```js
await client.query("BEGIN");
const finalizarComRollback = async (motivo) => {
  await client.query("ROLLBACK");
  return { motivo };
};
const original = await client.query("SELECT * FROM pagamentos WHERE id = $1 FOR UPDATE", [id]);
if (!original.rows[0]) return finalizarComRollback("nao_encontrado");
if (original.rows[0].tipo_lancamento === "estorno") return finalizarComRollback("nao_estornavel");
const existente = await client.query("SELECT id FROM pagamentos WHERE pagamento_origem_id = $1", [id]);
if (existente.rows[0]) return finalizarComRollback("ja_estornado");
await client.query(INSERT_ESTORNO_SQL, parametrosCopiadosDoOriginal);
await client.query("COMMIT");
```

The insert copies original links, patient, amount, method, installments, fee and status, then uses operator date/observation/user plus `tipo_lancamento = 'estorno'` and `pagamento_origem_id = id`. Convert `23505` to `ja_estornado` after rollback.

Extend list aggregation with `tipo_lancamento`, `pagamento_origem_id` and `estornado_por` from a left join. Change monetary report sums to:

```sql
SUM(CASE WHEN pg.tipo_lancamento = 'estorno' THEN -pg.valor ELSE pg.valor END)
```

Count originals and estornos separately and use each row's own payment date.

- [ ] **Step 4: Run test and confirm green**

Run: `node --test test/pagamentoModel.test.js`

Expected: PASS including matching and rounding regressions.

### Task 6: Render history and verify locally

**Files:**
- Modify: `src/views/financeiro/lista.ejs`
- Modify: `src/views/financeiro/relatorio.ejs`
- Modify: `README.md`
- Test: `test/financeiroViews.test.js`
- Test: `test/dashboardControllerFinanceiro.test.js`

**Interfaces:**
- Consumes: Task 5 signed totals and `estornado_por`.
- Produces: history-first UI without front-end arithmetic.

- [ ] **Step 1: Write failing presentation tests**

```js
assert.match(html, /Pagamento estornado/);
assert.doesNotMatch(html, /action="\/financeiro\/pagamento\/31\/estornar"/);
assert.match(relatorioHtml, /Estornos no período: 1/);
```

Also test successful redirect and 400 messages for duplicate/non-estornável cases.

- [ ] **Step 2: Run test and confirm red**

Run: `node --test test/dashboardControllerFinanceiro.test.js test/financeiroViews.test.js`

Expected: FAIL because templates derive state from mutable status.

- [ ] **Step 3: Implement history-first rendering**

Render an original badge when `estornado_por` exists. Render the compensatory line as “Estorno do pagamento #ID”, hide the original button and show the separate estorno count in the report. Update README with append-only behavior and the explicit production audit/migration approval requirement.

- [ ] **Step 4: Run complete local verification**

Run: `node --test test/pagamentoModel.test.js test/dashboardControllerFinanceiro.test.js test/financeiroViews.test.js`

Run: `npm test`

Run: `npm run lint`

Run: `git diff --check`

Run: `git status --short`

Expected: all Financeiro and full tests PASS; no new lint error; no whitespace failure; report existing unrelated warnings without changing them.

- [ ] **Step 5: Hand off without production actions**

Report changed files, test results, quarantine location and unapplied migration. Require new explicit approval for Neon schema audit, migration execution, Railway deploy and bot health check after restart.

## Self-review coverage

| Requirement | Tasks |
|---|---|
| Quarantine extras/TISS | 1 |
| DDD 55 and pagination | 2 |
| Strict IDs | 3 |
| Unapplied incremental migration | 4 |
| Append-only and race safety | 5 |
| History list and signed reports | 5, 6 |
| Bot and deployment protection | Global Constraints |

## Execution approval boundary

Before Task 1, obtain the exact user-approved quarantine location. Before Task 4, ensure `013_laudos.sql` is no longer in the active migration directory. This plan never authorizes Neon writes or Railway deployment.
