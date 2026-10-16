# Pacotes de Sessão (Fisioterapia) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the reception track how many sessions of a pre-paid Fisioterapia
package a patient has used, with the balance always derived from real
attendance records instead of a mutable counter, and zero changes to the
WhatsApp bot.

**Architecture:** A new `pacotes_sessoes` table (paciente, quantidade total,
cancelado, auditoria) plus a nullable `pacote_id` column on the existing
`registros_atendimento` table. When reception marks a Fisioterapia
appointment as `compareceu`, the system automatically links that attendance
row to the patient's active package (if any) inside the same transaction
that already updates `agendamentos.status`. "Sessions used" and "exhausted"
are always computed via `COUNT(...) < quantidade_total`, never stored — so
correcting a presença later can never leave a stale balance. Everything
lives in the dashboard (models/controllers/views); the bot, webhook,
function-calling and Google Calendar code are untouched.

**Tech Stack:** Node.js (ESM), Express, EJS views, `pg` (node-postgres) via
the shared `pool` in `src/db/pool.js`, `node:test` + `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-09-01-pacotes-sessao-design.md`

## Global Constraints

- Fisioterapia only — Psicologia has no automatic scheduling and is out of
  scope for this feature entirely.
- Package debit only applies to `agendamentos` (bot-native appointments),
  never to `agendamentos_importados` (legacy sistema de agenda anterior data predates
  this feature).
- No stored "sessões usadas" or "status" column — both are always computed
  from `registros_atendimento.pacote_id` at query time.
- A patient can have at most one active package at a time (not cancelled,
  used count < total) — creating a new one is blocked while one is active.
- Creating a package: reception or administradora. Cancelling a package:
  administradora only (`exigirPapel("administradora")`, same pattern as
  `/financeiro/pagamento/:id/estornar`).
- No changes to `chatService`, webhook, function-calling, the bot's
  scheduling flow, or Google Calendar integration.
- No payment/money tracking for packages — that stays outside the app.
- This plan produces local, tested code only. Applying the migration to
  Neon, `git push`, and Railway deploy are separate steps requiring their
  own explicit authorization later — do not do them as part of this plan.
- Every task ends with `npm test` and `npm run lint` both clean before
  moving to the next task.

---

### Task 1: Migration file for `pacotes_sessoes` and `registros_atendimento.pacote_id`

**Files:**
- Create: `src/db/migrations/018_pacotes_sessao.sql`

**Interfaces:**
- Produces: table `pacotes_sessoes(id, paciente_id, quantidade_total, cancelado, criado_por, created_at)` and column `registros_atendimento.pacote_id` (nullable FK to `pacotes_sessoes.id`) — every later task's SQL assumes these names exactly.

This is a plain SQL file, like the project's other migrations (e.g.
`src/db/migrations/017_laudos.sql`) — it is written and reviewed here, but
**not applied** to Neon as part of this plan (no dev database exists
separate from production; application needs its own explicit authorization
later).

- [ ] **Step 1: Write the migration file**

```sql
-- src/db/migrations/018_pacotes_sessao.sql
-- Clínica Exemplo Bot — migration 018: pacotes de sessão de Fisioterapia.
-- Rodar no SQL Editor do Neon (ou via psql) depois de 017_laudos.sql.
-- ATENÇÃO: este projeto não tem banco de dev separado do de produção — só
-- aplicar depois de confirmar com o usuário (ver spec deste sub-projeto:
-- docs/superpowers/specs/2026-09-01-pacotes-sessao-design.md).

CREATE TABLE IF NOT EXISTS pacotes_sessoes (
  id SERIAL PRIMARY KEY,
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id),
  quantidade_total INTEGER NOT NULL CHECK (quantidade_total > 0),
  cancelado BOOLEAN NOT NULL DEFAULT false,
  criado_por INTEGER NOT NULL REFERENCES usuarios(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sem coluna de "sessões usadas" ou "status": ambas são sempre calculadas a
-- partir de registros_atendimento.pacote_id (ver spec, seção "Modelo de
-- dados") — corrigir uma presença nunca deixa a contagem inconsistente.

ALTER TABLE registros_atendimento
  ADD COLUMN IF NOT EXISTS pacote_id INTEGER REFERENCES pacotes_sessoes(id);

CREATE INDEX IF NOT EXISTS idx_pacotes_sessoes_paciente
  ON pacotes_sessoes (paciente_id);

CREATE INDEX IF NOT EXISTS idx_registros_atendimento_pacote
  ON registros_atendimento (pacote_id) WHERE pacote_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER TABLE pacotes_sessoes ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON pacotes_sessoes FROM anon, authenticated;
  END IF;
END $$;
```

- [ ] **Step 2: Review the file by hand against the two most recent migrations**

Run: `diff <(head -20 src/db/migrations/017_laudos.sql) <(head -20 src/db/migrations/018_pacotes_sessao.sql)`
Expected: no crash; just eyeball that the header comment style, the
`ATENÇÃO` line, and the `anon` RLS guard block all match the established
pattern (they will differ in content, that's fine — this is a style check,
not a diff that should come back empty).

- [ ] **Step 3: Commit**

```bash
git add src/db/migrations/018_pacotes_sessao.sql
git commit -m "feat: adiciona migration de pacotes de sessão (não aplicada)"
```

---

### Task 2: `pacoteSessaoModel.js`

**Files:**
- Create: `src/models/pacoteSessaoModel.js`
- Test: `test/pacoteSessaoModel.test.js`

**Interfaces:**
- Consumes: `pool` from `../db/pool.js` (same as every other model in this codebase).
- Produces:
  - `buscarPacoteAtivoPaciente(pacienteId): Promise<{ id: number, quantidade_total: number } | null>`
  - `criarPacote({ pacienteId, quantidadeTotal, criadoPor }): Promise<{ pacote: { id, paciente_id, quantidade_total, cancelado, criado_por, created_at } } | { motivo: "quantidade_invalida" | "pacote_ativo_existente" }>`
  - `cancelarPacote(pacoteId): Promise<{ id: number, cancelado: true } | null>`
  - `listarPacotesPaciente(pacienteId): Promise<Array<{ id, quantidade_total, cancelado, created_at, quantidade_usada: number }>>` (most recent first)

These four functions are what Task 4 (controller) and Task 6 (view) import.

- [ ] **Step 1: Write the failing tests**

```javascript
// test/pacoteSessaoModel.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import {
  buscarPacoteAtivoPaciente,
  criarPacote,
  cancelarPacote,
  listarPacotesPaciente,
} from "../src/models/pacoteSessaoModel.js";

test("buscarPacoteAtivoPaciente: consulta por paciente, não cancelado e com saldo", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [{ id: 9, quantidade_total: 10 }] };
  });

  const pacote = await buscarPacoteAtivoPaciente(42);

  assert.deepEqual(pacote, { id: 9, quantidade_total: 10 });
  assert.match(consultas[0].sql, /FROM pacotes_sessoes ps/);
  assert.match(consultas[0].sql, /ps\.cancelado = false/);
  assert.match(consultas[0].sql, /ORDER BY ps\.created_at DESC/);
  assert.deepEqual(consultas[0].params, [42]);
});

test("buscarPacoteAtivoPaciente: sem pacote ativo retorna null", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const pacote = await buscarPacoteAtivoPaciente(42);

  assert.equal(pacote, null);
});

test("criarPacote: quantidade zero ou negativa retorna motivo quantidade_invalida sem consultar o banco", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });

  const resultadoZero = await criarPacote({ pacienteId: 1, quantidadeTotal: 0, criadoPor: 5 });
  const resultadoNegativo = await criarPacote({ pacienteId: 1, quantidadeTotal: -3, criadoPor: 5 });
  const resultadoNaoNumerico = await criarPacote({ pacienteId: 1, quantidadeTotal: "dez", criadoPor: 5 });

  assert.deepEqual(resultadoZero, { motivo: "quantidade_invalida" });
  assert.deepEqual(resultadoNegativo, { motivo: "quantidade_invalida" });
  assert.deepEqual(resultadoNaoNumerico, { motivo: "quantidade_invalida" });
  assert.equal(consultas.length, 0, "não deve consultar o banco com quantidade inválida");
});

test("criarPacote: paciente com pacote ativo existente é bloqueado", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ id: 3, quantidade_total: 10 }] }));

  const resultado = await criarPacote({ pacienteId: 1, quantidadeTotal: 10, criadoPor: 5 });

  assert.deepEqual(resultado, { motivo: "pacote_ativo_existente" });
});

test("criarPacote: caminho feliz insere e retorna o pacote criado", async (t) => {
  const consultas = [];
  const pacoteCriado = {
    id: 10,
    paciente_id: 1,
    quantidade_total: 20,
    cancelado: false,
    criado_por: 5,
    created_at: "2026-09-01T12:00:00.000Z",
  };
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    if (sql.includes("INSERT INTO pacotes_sessoes")) {
      return { rows: [pacoteCriado] };
    }
    return { rows: [] }; // buscarPacoteAtivoPaciente: nenhum pacote ativo
  });

  const resultado = await criarPacote({ pacienteId: 1, quantidadeTotal: 20, criadoPor: 5 });

  assert.deepEqual(resultado, { pacote: pacoteCriado });
  const insertChamada = consultas.find((c) => c.sql.includes("INSERT INTO pacotes_sessoes"));
  assert.deepEqual(insertChamada.params, [1, 20, 5]);
});

test("cancelarPacote: marca cancelado e retorna a linha atualizada", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [{ id: 10, cancelado: true }] };
  });

  const resultado = await cancelarPacote(10);

  assert.deepEqual(resultado, { id: 10, cancelado: true });
  assert.match(consultas[0].sql, /UPDATE pacotes_sessoes SET cancelado = true/);
  assert.match(consultas[0].sql, /WHERE id = \$1 AND cancelado = false/);
  assert.deepEqual(consultas[0].params, [10]);
});

test("cancelarPacote: pacote inexistente ou já cancelado retorna null", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await cancelarPacote(999);

  assert.equal(resultado, null);
});

test("listarPacotesPaciente: retorna pacotes com quantidade_usada calculada, mais recente primeiro", async (t) => {
  const consultas = [];
  const linhas = [
    { id: 10, quantidade_total: 20, cancelado: false, created_at: "2026-09-01", quantidade_usada: 3 },
    { id: 3, quantidade_total: 10, cancelado: false, created_at: "2026-08-01", quantidade_usada: 10 },
  ];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: linhas };
  });

  const pacotes = await listarPacotesPaciente(1);

  assert.deepEqual(pacotes, linhas);
  assert.match(consultas[0].sql, /ORDER BY ps\.created_at DESC/);
  assert.match(consultas[0].sql, /quantidade_usada/);
  assert.deepEqual(consultas[0].params, [1]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/pacoteSessaoModel.test.js`
Expected: FAIL — `Cannot find module '../src/models/pacoteSessaoModel.js'`

- [ ] **Step 3: Write the implementation**

```javascript
// src/models/pacoteSessaoModel.js
import { pool } from "../db/pool.js";

/**
 * Um pacote é "ativo" quando não foi cancelado e ainda tem sessão sobrando —
 * a contagem de sessões usadas nunca fica guardada, é sempre a quantidade de
 * registros_atendimento vinculados a ele (ver spec, seção "Modelo de
 * dados"). Isso evita qualquer descompasso quando uma presença é corrigida
 * depois de já ter esgotado o pacote.
 */
export async function buscarPacoteAtivoPaciente(pacienteId) {
  const { rows } = await pool.query(
    `SELECT ps.id, ps.quantidade_total
     FROM pacotes_sessoes ps
     WHERE ps.paciente_id = $1
       AND ps.cancelado = false
       AND (SELECT COUNT(*) FROM registros_atendimento ra WHERE ra.pacote_id = ps.id) < ps.quantidade_total
     ORDER BY ps.created_at DESC
     LIMIT 1`,
    [pacienteId]
  );
  return rows[0] ?? null;
}

export async function criarPacote({ pacienteId, quantidadeTotal, criadoPor }) {
  const quantidade = Number(quantidadeTotal);
  if (!Number.isInteger(quantidade) || quantidade <= 0) {
    return { motivo: "quantidade_invalida" };
  }

  const ativo = await buscarPacoteAtivoPaciente(pacienteId);
  if (ativo) {
    return { motivo: "pacote_ativo_existente" };
  }

  const { rows } = await pool.query(
    `INSERT INTO pacotes_sessoes (paciente_id, quantidade_total, criado_por)
     VALUES ($1, $2, $3)
     RETURNING id, paciente_id, quantidade_total, cancelado, criado_por, created_at`,
    [pacienteId, quantidade, criadoPor]
  );
  return { pacote: rows[0] };
}

export async function cancelarPacote(pacoteId) {
  const { rows } = await pool.query(
    `UPDATE pacotes_sessoes SET cancelado = true
     WHERE id = $1 AND cancelado = false
     RETURNING id, cancelado`,
    [pacoteId]
  );
  return rows[0] ?? null;
}

export async function listarPacotesPaciente(pacienteId) {
  const { rows } = await pool.query(
    `SELECT ps.id, ps.quantidade_total, ps.cancelado, ps.created_at,
       (SELECT COUNT(*) FROM registros_atendimento ra WHERE ra.pacote_id = ps.id)::int AS quantidade_usada
     FROM pacotes_sessoes ps
     WHERE ps.paciente_id = $1
     ORDER BY ps.created_at DESC`,
    [pacienteId]
  );
  return rows;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/pacoteSessaoModel.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/models/pacoteSessaoModel.js test/pacoteSessaoModel.test.js
git commit -m "feat: adiciona pacoteSessaoModel (criar, cancelar, listar, buscar ativo)"
```

---

### Task 3: Vínculo automático de presença ao pacote ativo

**Files:**
- Modify: `src/models/registroAtendimentoModel.js` (`buscarAgendamentoParaPresenca`, `registrarPresencaBot`)
- Modify: `test/registroAtendimentoModel.test.js`

**Interfaces:**
- Consumes: nothing new imported — the pacote lookup runs as inline SQL on the same transactional `client` already used by `registrarPresencaBot`, not via `pacoteSessaoModel.js` (that model uses `pool` directly, which would be a separate connection outside the transaction — see comment in the code below for why that matters).
- Produces: `registrarPresencaBot(...)`'s returned `registro` row now includes `pacote_id` (via `RETURNING *`, already implicit — no signature change for callers in Task 4).

This task changes shared code with real existing tests. Read
`test/registroAtendimentoModel.test.js` fully before editing — the mocked
transactional client in `mockarClientTransacional` responds to `sql` by
substring match (`sql.includes(...)`), so the new pacote-lookup query must
be given a substring the existing mocks don't already match by accident
(`"FROM pacotes_sessoes"` is unique — the existing mocks only check for
`"UPDATE agendamentos"` and `"INSERT INTO registros_atendimento"`).

- [ ] **Step 1: Write the failing tests (new tests + one updated existing test)**

Add these three new tests to `test/registroAtendimentoModel.test.js`, right
after the existing `"registrarPresencaBot: caminho feliz ..."` test (around
line 192):

```javascript
function mockarClientComPacote(t, { pacoteEncontrado = null, registroRetornado = {} } = {}) {
  const chamadas = [];
  const client = {
    query: async (sql, params) => {
      chamadas.push({ sql, params });
      if (sql.includes("UPDATE agendamentos")) {
        return { rowCount: 1 };
      }
      if (sql.includes("FROM pacotes_sessoes")) {
        return { rows: pacoteEncontrado ? [pacoteEncontrado] : [] };
      }
      if (sql.includes("INSERT INTO registros_atendimento")) {
        return { rows: [registroRetornado] };
      }
      return {};
    },
    release: () => {},
  };
  t.mock.method(pool, "connect", async () => client);
  return chamadas;
}

test("registrarPresencaBot: fisioterapia com pacote ativo vincula pacote_id automaticamente", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 5, status: "confirmado", ja_passou: true, paciente_id: 42, tipo_atendimento: "fisioterapia" }],
  }));
  const registroEsperado = { id: 1, agendamento_id: 5, presenca: "compareceu", pacote_id: 9 };
  const chamadas = mockarClientComPacote(t, {
    pacoteEncontrado: { id: 9 },
    registroRetornado: registroEsperado,
  });

  const resultado = await registrarPresencaBot({
    agendamentoId: 5,
    presenca: "compareceu",
    observacaoSessao: null,
    profissionalResponsavel: null,
    registradoPor: 7,
  });

  assert.deepEqual(resultado, { registro: registroEsperado });
  const buscaPacote = chamadas.find((c) => c.sql.includes("FROM pacotes_sessoes"));
  assert.ok(buscaPacote, "deve consultar o pacote ativo do paciente");
  assert.deepEqual(buscaPacote.params, [42]);
  const insertChamada = chamadas.find((c) => c.sql.includes("INSERT INTO registros_atendimento"));
  assert.equal(insertChamada.params[5], 9, "pacote_id deve ser o pacote encontrado");
});

test("registrarPresencaBot: fisioterapia sem pacote ativo grava pacote_id null", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 5, status: "confirmado", ja_passou: true, paciente_id: 42, tipo_atendimento: "fisioterapia" }],
  }));
  const chamadas = mockarClientComPacote(t, { pacoteEncontrado: null, registroRetornado: { id: 1 } });

  await registrarPresencaBot({
    agendamentoId: 5,
    presenca: "compareceu",
    observacaoSessao: null,
    registradoPor: 7,
  });

  const insertChamada = chamadas.find((c) => c.sql.includes("INSERT INTO registros_atendimento"));
  assert.equal(insertChamada.params[5], null);
});

test("registrarPresencaBot: marcar faltou não busca pacote e limpa pacote_id (corrige um compareceu anterior)", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 5, status: "compareceu", ja_passou: true, paciente_id: 42, tipo_atendimento: "fisioterapia" }],
  }));
  const chamadas = mockarClientComPacote(t, { pacoteEncontrado: { id: 9 }, registroRetornado: { id: 1 } });

  await registrarPresencaBot({
    agendamentoId: 5,
    presenca: "faltou",
    observacaoSessao: null,
    registradoPor: 7,
  });

  const buscaPacote = chamadas.find((c) => c.sql.includes("FROM pacotes_sessoes"));
  assert.equal(buscaPacote, undefined, "não deve consultar pacote quando presença é faltou");
  const insertChamada = chamadas.find((c) => c.sql.includes("INSERT INTO registros_atendimento"));
  assert.equal(insertChamada.params[5], null, "pacote_id deve voltar a null");
});

test("registrarPresencaBot: psicologia nunca busca nem vincula pacote", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 6, status: "confirmado", ja_passou: true, paciente_id: 42, tipo_atendimento: "psicologia" }],
  }));
  const chamadas = mockarClientComPacote(t, { pacoteEncontrado: { id: 9 }, registroRetornado: { id: 2 } });

  await registrarPresencaBot({
    agendamentoId: 6,
    presenca: "compareceu",
    observacaoSessao: null,
    registradoPor: 7,
  });

  const buscaPacote = chamadas.find((c) => c.sql.includes("FROM pacotes_sessoes"));
  assert.equal(buscaPacote, undefined);
});
```

Now update the existing `"registrarPresencaBot: caminho feliz ..."` test
(the one asserting `chamadas[2].params`) — its mocked pre-check row has no
`tipo_atendimento`, so the new pacote lookup is skipped and the sequence of
`chamadas` stays `BEGIN, UPDATE, INSERT, COMMIT` (unchanged indices), but
the INSERT now always has a 6th param. Change only this one line:

```javascript
// before:
  assert.deepEqual(chamadas[2].params, [5, "compareceu", "Evoluiu bem", "Dra. Ana", 7]);
// after:
  assert.deepEqual(chamadas[2].params, [5, "compareceu", "Evoluiu bem", "Dra. Ana", 7, null]);
```

- [ ] **Step 2: Run tests to verify the new ones fail and the updated one fails too (before the implementation change)**

Run: `node --test test/registroAtendimentoModel.test.js`
Expected: the 4 new tests FAIL (pacote_id not yet a param), and the updated
"caminho feliz" test FAILS too (still only 5 params) — confirming the test
change is exercising real behavior, not a no-op.

- [ ] **Step 3: Modify `buscarAgendamentoParaPresenca` to also fetch `paciente_id` and `tipo_atendimento`**

In `src/models/registroAtendimentoModel.js`, replace:

```javascript
async function buscarAgendamentoParaPresenca(id) {
  const { rows } = await pool.query(
    `SELECT id, status,
       (data < CURRENT_DATE OR (data = CURRENT_DATE AND hora <= (now() AT TIME ZONE 'America/Sao_Paulo')::time)) AS ja_passou
     FROM agendamentos
     WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}
```

with:

```javascript
async function buscarAgendamentoParaPresenca(id) {
  const { rows } = await pool.query(
    `SELECT id, status, paciente_id, tipo_atendimento,
       (data < CURRENT_DATE OR (data = CURRENT_DATE AND hora <= (now() AT TIME ZONE 'America/Sao_Paulo')::time)) AS ja_passou
     FROM agendamentos
     WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}
```

- [ ] **Step 4: Modify `registrarPresencaBot` to compute and persist `pacote_id`**

Replace the whole function body with:

```javascript
export async function registrarPresencaBot({
  agendamentoId,
  presenca,
  observacaoSessao,
  profissionalResponsavel,
  registradoPor,
}) {
  const agendamento = await buscarAgendamentoParaPresenca(agendamentoId);
  if (!agendamento) return { motivo: "nao_encontrado" };
  if (agendamento.status === "cancelado") return { motivo: "cancelado" };
  if (!agendamento.ja_passou) return { motivo: "ainda_nao_ocorreu" };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const atualizado = await client.query(
      `UPDATE agendamentos SET status = $2 WHERE id = $1 AND status <> 'cancelado' RETURNING id`,
      [agendamentoId, presenca]
    );
    if (atualizado.rowCount === 0) {
      await client.query("ROLLBACK");
      return { motivo: "conflito" };
    }

    // Vínculo automático com o pacote de sessão ativo do paciente (pacotes
    // de sessão só existem pra Fisioterapia — ver spec). A busca roda no
    // mesmo client/transação do UPDATE acima (não via pacoteSessaoModel,
    // que usa `pool` diretamente) pra ficar atômica com o INSERT/UPDATE de
    // registros_atendimento logo abaixo — evita, ainda que numa corrida
    // rara, vincular a um pacote que outra requisição acabou de esgotar ou
    // cancelar entre a consulta e a gravação.
    let pacoteId = null;
    if (presenca === "compareceu" && agendamento.tipo_atendimento === "fisioterapia") {
      const { rows: pacoteRows } = await client.query(
        `SELECT ps.id
         FROM pacotes_sessoes ps
         WHERE ps.paciente_id = $1
           AND ps.cancelado = false
           AND (SELECT COUNT(*) FROM registros_atendimento ra WHERE ra.pacote_id = ps.id) < ps.quantidade_total
         ORDER BY ps.created_at DESC
         LIMIT 1`,
        [agendamento.paciente_id]
      );
      pacoteId = pacoteRows[0]?.id ?? null;
    }

    const { rows } = await client.query(
      `INSERT INTO registros_atendimento (agendamento_id, presenca, observacao_sessao, profissional_responsavel, registrado_por, pacote_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (agendamento_id) WHERE agendamento_id IS NOT NULL DO UPDATE
         SET presenca = EXCLUDED.presenca,
             observacao_sessao = EXCLUDED.observacao_sessao,
             profissional_responsavel = EXCLUDED.profissional_responsavel,
             registrado_por = EXCLUDED.registrado_por,
             registrado_em = now(),
             pacote_id = EXCLUDED.pacote_id
       RETURNING *`,
      [agendamentoId, presenca, observacaoSessao, profissionalResponsavel, registradoPor, pacoteId]
    );
    await client.query("COMMIT");
    return { registro: rows[0] };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/registroAtendimentoModel.test.js`
Expected: PASS (all tests, including the 4 new ones and the updated one)

- [ ] **Step 6: Run the full suite (this file is shared by controller tests)**

Run: `npm test`
Expected: all tests pass, including `test/dashboardControllerPresenca.test.js`
(its assertions are index-based on individual params, e.g. `insertChamada.params[0]`,
not full-array equality, so the new 6th param does not break them — but
verify this by actually running the suite, not by assuming it).

- [ ] **Step 7: Lint and commit**

```bash
npm run lint
git add src/models/registroAtendimentoModel.js test/registroAtendimentoModel.test.js
git commit -m "feat: vincula presença de fisioterapia ao pacote de sessão ativo"
```

---

### Task 4: Controller — criar/cancelar pacote e mostrar na ficha do paciente

**Files:**
- Modify: `src/controllers/dashboardController.js` (`telaFichaPaciente`, plus two new exports)
- Modify: `test/dashboardController.test.js`

**Interfaces:**
- Consumes: `criarPacote`, `cancelarPacote`, `listarPacotesPaciente` from `../models/pacoteSessaoModel.js` (Task 2); `idSeguro` from `../utils/paginacao.js` (already imported in this file).
- Produces:
  - `telaFichaPaciente(req, res, { buscarPaciente, buscarHistorico, buscarPacotes })` — now renders `pacientes/ficha` with `{ paciente, historico, pacotes }` (Task 6 consumes `pacotes`).
  - `processarCriarPacote(req, res)` — `req.params.id` is the paciente id, `req.body.quantidade_total`.
  - `processarCancelarPacote(req, res)` — `req.params.pacoteId`; redirects to `/pacientes/:id/ficha` using `req.params.id`.

- [ ] **Step 1: Write the failing tests**

First, update the existing `telaFichaPaciente` tests in
`test/dashboardController.test.js` (around line 210) — they currently
assert `res.dadosDaView` equals exactly `{ paciente, historico }`, which
will break once a third key is added. Change the first test to:

```javascript
test("telaFichaPaciente mostra dados, histórico e pacotes do paciente solicitado", async () => {
  const res = criarRespostaFalsa();
  const paciente = { id: 7, nome: "Ana Silva", telefone: "5511999999999", convenio: "Particular" };
  const historico = [{ data: "2026-08-30", hora: "09:00", tipo_atendimento: "fisioterapia", status: "confirmado" }];
  const pacotes = [{ id: 1, quantidade_total: 10, cancelado: false, created_at: "2026-08-01", quantidade_usada: 3 }];

  await telaFichaPaciente(
    { params: { id: "7" } },
    res,
    {
      buscarPaciente: async (id) => (id === 7 ? paciente : null),
      buscarHistorico: async (id) => (id === 7 ? historico : []),
      buscarPacotes: async (id) => (id === 7 ? pacotes : []),
    }
  );

  assert.equal(res.viewRenderizada, "pacientes/ficha");
  assert.deepEqual(res.dadosDaView, { paciente, historico, pacotes });
});
```

The second existing test (`"telaFichaPaciente rejeita identificador
inválido sem consultar dados"`) needs a `buscarPacotes` stub added to its
dependency object too (so a missing key doesn't just happen to work by
accident), and an assertion that it's never called:

```javascript
test("telaFichaPaciente rejeita identificador inválido sem consultar dados", async () => {
  const res = criarRespostaFalsa();
  let consultou = false;

  await telaFichaPaciente(
    { params: { id: "abc" } },
    res,
    {
      buscarPaciente: async () => {
        consultou = true;
      },
      buscarHistorico: async () => [],
      buscarPacotes: async () => {
        consultou = true;
        return [];
      },
    }
  );

  assert.equal(res.statusCode, 404);
  assert.equal(consultou, false);
});
```

Now add new tests for the two new controller functions, right after the
`telaFichaPaciente` tests:

```javascript
import {
  criarPacote as criarPacoteReal,
  cancelarPacote as cancelarPacoteReal,
} from "../src/models/pacoteSessaoModel.js";
import { processarCriarPacote, processarCancelarPacote } from "../src/controllers/dashboardController.js";

test("processarCriarPacote: quantidade inválida responde 400", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const res = criarRespostaFalsa();

  await processarCriarPacote(
    { params: { id: "7" }, body: { quantidade_total: "abc" }, usuarioAtual: { id: 5 } },
    res
  );

  assert.equal(res.statusCode, 400);
});

test("processarCriarPacote: paciente com pacote ativo responde 409", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ id: 3, quantidade_total: 10 }] }));
  const res = criarRespostaFalsa();

  await processarCriarPacote(
    { params: { id: "7" }, body: { quantidade_total: "10" }, usuarioAtual: { id: 5 } },
    res
  );

  assert.equal(res.statusCode, 409);
});

test("processarCriarPacote: caminho feliz redireciona pra ficha do paciente", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    if (sql.includes("INSERT INTO pacotes_sessoes")) {
      return { rows: [{ id: 10, paciente_id: 7, quantidade_total: 10, cancelado: false, criado_por: 5, created_at: "2026-09-01" }] };
    }
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await processarCriarPacote(
    { params: { id: "7" }, body: { quantidade_total: "10" }, usuarioAtual: { id: 5 } },
    res
  );

  assert.equal(res.redirectedTo, "/pacientes/7/ficha");
  const insertChamada = consultas.find((c) => c.sql.includes("INSERT INTO pacotes_sessoes"));
  assert.deepEqual(insertChamada.params, [7, 10, 5]);
});

test("processarCriarPacote: paciente inválido responde 404 sem consultar o banco", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await processarCriarPacote(
    { params: { id: "abc" }, body: { quantidade_total: "10" }, usuarioAtual: { id: 5 } },
    res
  );

  assert.equal(res.statusCode, 404);
  assert.equal(consultas.length, 0);
});

test("processarCancelarPacote: pacote inexistente responde 404", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const res = criarRespostaFalsa();

  await processarCancelarPacote(
    { params: { id: "7", pacoteId: "999" }, usuarioAtual: { id: 5 } },
    res
  );

  assert.equal(res.statusCode, 404);
});

test("processarCancelarPacote: caminho feliz redireciona pra ficha do paciente", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ id: 10, cancelado: true }] }));
  const res = criarRespostaFalsa();

  await processarCancelarPacote(
    { params: { id: "7", pacoteId: "10" }, usuarioAtual: { id: 5 } },
    res
  );

  assert.equal(res.redirectedTo, "/pacientes/7/ficha");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/dashboardController.test.js`
Expected: FAIL — `processarCriarPacote`/`processarCancelarPacote` are not
exported yet, and the `telaFichaPaciente` assertions don't match (missing
`pacotes` key).

- [ ] **Step 3: Add the import and modify `telaFichaPaciente`**

In `src/controllers/dashboardController.js`, add to the existing
`pacienteModel.js` import block:

```javascript
import {
  buscarPacientePorId,
  listarHistoricoPaciente,
  listarPacientes,
  listarSessoesFisioterapiaPaciente,
} from "../models/pacienteModel.js";
```

becomes:

```javascript
import {
  buscarPacientePorId,
  listarHistoricoPaciente,
  listarPacientes,
  listarSessoesFisioterapiaPaciente,
} from "../models/pacienteModel.js";
import {
  criarPacote,
  cancelarPacote,
  listarPacotesPaciente,
} from "../models/pacoteSessaoModel.js";
```

Replace `telaFichaPaciente`:

```javascript
export async function telaFichaPaciente(
  req,
  res,
  { buscarPaciente = buscarPacientePorId, buscarHistorico = listarHistoricoPaciente } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  if (!pacienteId) return res.status(404).send("Paciente não encontrado.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  const historico = await buscarHistorico(pacienteId);
  res.render("pacientes/ficha", { paciente, historico });
}
```

with:

```javascript
export async function telaFichaPaciente(
  req,
  res,
  {
    buscarPaciente = buscarPacientePorId,
    buscarHistorico = listarHistoricoPaciente,
    buscarPacotes = listarPacotesPaciente,
  } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  if (!pacienteId) return res.status(404).send("Paciente não encontrado.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  const historico = await buscarHistorico(pacienteId);
  const pacotes = await buscarPacotes(pacienteId);
  res.render("pacientes/ficha", { paciente, historico, pacotes });
}
```

- [ ] **Step 4: Add the two new controller functions**

Add near the end of `src/controllers/dashboardController.js` (after
`telaControleSessoes`, before the presença section):

```javascript
export async function processarCriarPacote(req, res) {
  const pacienteId = idSeguro(req.params.id);
  if (!pacienteId) return res.status(404).send("Paciente não encontrado.");

  const resultado = await criarPacote({
    pacienteId,
    quantidadeTotal: req.body?.quantidade_total,
    criadoPor: req.usuarioAtual.id,
  });

  if (resultado.motivo === "quantidade_invalida") {
    return res
      .status(400)
      .send("Quantidade de sessões inválida — informe um número inteiro maior que zero.");
  }
  if (resultado.motivo === "pacote_ativo_existente") {
    return res
      .status(409)
      .send("Este paciente já tem um pacote ativo — cancele o atual antes de criar outro.");
  }
  res.redirect(`/pacientes/${pacienteId}/ficha`);
}

export async function processarCancelarPacote(req, res) {
  const pacienteId = idSeguro(req.params.id);
  if (!pacienteId) return res.status(404).send("Paciente não encontrado.");

  const pacoteId = idSeguro(req.params.pacoteId);
  if (!pacoteId) return res.status(404).send("Pacote não encontrado.");

  const cancelado = await cancelarPacote(pacoteId);
  if (!cancelado) return res.status(404).send("Pacote não encontrado ou já cancelado.");

  res.redirect(`/pacientes/${pacienteId}/ficha`);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/dashboardController.test.js`
Expected: PASS (all tests)

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 7: Lint and commit**

```bash
npm run lint
git add src/controllers/dashboardController.js test/dashboardController.test.js
git commit -m "feat: adiciona controllers de criar/cancelar pacote e inclui na ficha"
```

---

### Task 5: Rotas

**Files:**
- Modify: `src/routes/dashboardRoutes.js`
- Modify: `test/dashboardRoutesPermissoes.test.js`

**Interfaces:**
- Consumes: `processarCriarPacote`, `processarCancelarPacote` from `../controllers/dashboardController.js` (Task 4).
- Produces: `POST /pacientes/:id/pacotes` (create, any logged-in role), `POST /pacientes/:id/pacotes/:pacoteId/cancelar` (cancel, `administradora` only).

- [ ] **Step 1: Write the failing test**

Add to `test/dashboardRoutesPermissoes.test.js`, after the existing
`"POST de estorno bloqueia recepção antes de abrir transação"` test:

```javascript
test("POST cancelar pacote bloqueia recepção antes de abrir transação", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [RECEPCIONISTA] }));
  let consultouPacote = false;
  t.mock.method(pool, "connect", async () => {
    consultouPacote = true;
    throw new Error("não deveria abrir conexão");
  });
  const res = criarResposta();

  await executarRota({
    caminho: "/pacientes/:id/pacotes/:pacoteId/cancelar",
    metodo: "post",
    req: criarRequisicao(),
    res,
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.view, "erros/acesso-negado");
  assert.equal(consultouPacote, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dashboardRoutesPermissoes.test.js`
Expected: FAIL — route `/pacientes/:id/pacotes/:pacoteId/cancelar` doesn't
exist yet (`encontrarHandlers` throws via its own `assert.ok`).

- [ ] **Step 3: Add the routes**

In `src/routes/dashboardRoutes.js`, add `processarCriarPacote,
processarCancelarPacote` to the existing import from
`../controllers/dashboardController.js`, then add these two routes right
after the existing `/pacientes/:id/controle-sessoes` route:

```javascript
router.post(
  "/pacientes/:id/pacotes",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarCriarPacote)
);
router.post(
  "/pacientes/:id/pacotes/:pacoteId/cancelar",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  exigirCsrf,
  asyncHandler(processarCancelarPacote)
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/dashboardRoutesPermissoes.test.js`
Expected: PASS

- [ ] **Step 5: Run the full suite, lint, and commit**

```bash
npm test
npm run lint
git add src/routes/dashboardRoutes.js test/dashboardRoutesPermissoes.test.js
git commit -m "feat: adiciona rotas de criar/cancelar pacote de sessão"
```

---

### Task 6: View — seção de pacotes na ficha do paciente

**Files:**
- Modify: `src/views/pacientes/ficha.ejs`
- Create: `test/fichaPacienteView.test.js`

**Interfaces:**
- Consumes: `paciente`, `historico`, `pacotes` (array from `listarPacotesPaciente`, Task 2), `csrfToken` and `usuarioAtual` (already provided by every dashboard render via `exigirLogin` — see `src/middleware/dashboardAuth.js`).

- [ ] **Step 1: Write the failing tests**

```javascript
// test/fichaPacienteView.test.js
//
// Renderiza pacientes/ficha.ejs diretamente (sem controller/app), mesmo
// padrão de test/presencaViews.test.js — pega bug de view que ficaria
// escondido atrás de um mock que só confere res.dadosDaView.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.join(__dirname, "..", "src", "views");

const PACIENTE = { id: 7, nome: "Ana Silva", telefone: "5511999999999", convenio: "Particular", created_at: "2026-01-01" };
const ADMINISTRADORA = { id: 1, nome: "Ana", papel: "administradora" };
const RECEPCAO = { id: 2, nome: "Amanda", papel: "recepcao" };

function renderizar(dados) {
  const caminho = path.join(VIEWS_DIR, "pacientes", "ficha.ejs");
  return ejs.renderFile(caminho, {
    paciente: PACIENTE,
    historico: [],
    pacotes: [],
    csrfToken: "token-fake",
    usuarioAtual: ADMINISTRADORA,
    ...dados,
  });
}

test("ficha: sem pacotes, mostra o formulário de criar pacote e nenhum pacote ativo", async () => {
  const html = await renderizar({ pacotes: [] });

  assert.match(html, /Criar pacote/);
  assert.doesNotMatch(html, /Pacote atual/);
});

test("ficha: pacote ativo mostra contagem de sessões usadas", async () => {
  const html = await renderizar({
    pacotes: [{ id: 10, quantidade_total: 10, cancelado: false, created_at: "2026-09-01", quantidade_usada: 3 }],
  });

  assert.match(html, /Pacote atual/);
  assert.match(html, /3 de 10/);
});

test("ficha: pacote esgotado (usada = total) aparece como esgotado, não como ativo", async () => {
  const html = await renderizar({
    pacotes: [{ id: 10, quantidade_total: 10, cancelado: false, created_at: "2026-09-01", quantidade_usada: 10 }],
  });

  assert.doesNotMatch(html, /Pacote atual/);
  assert.match(html, /esgotado/i);
});

test("ficha: botão cancelar pacote aparece pra administradora mas não pra recepção", async () => {
  const pacotes = [{ id: 10, quantidade_total: 10, cancelado: false, created_at: "2026-09-01", quantidade_usada: 3 }];

  const htmlAdministradora = await renderizar({ pacotes, usuarioAtual: ADMINISTRADORA });
  const htmlRecepcao = await renderizar({ pacotes, usuarioAtual: RECEPCAO });

  assert.match(htmlAdministradora, /Cancelar pacote/);
  assert.doesNotMatch(htmlRecepcao, /Cancelar pacote/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/fichaPacienteView.test.js`
Expected: FAIL — the view doesn't render any of this content yet.

- [ ] **Step 3: Add the pacotes section to `ficha.ejs`**

In `src/views/pacientes/ficha.ejs`, add a new `<section>` right after the
closing `</section>` of `historico-agendamentos` (before the final
`<%- include("../partials/footer") %>`):

```html
  <section class="pacotes-sessao">
    <h2>Pacote de sessões (Fisioterapia)</h2>
    <%
      const pacoteAtual = pacotes.find((p) => !p.cancelado && p.quantidade_usada < p.quantidade_total);
    %>
    <% if (pacoteAtual) { %>
    <p>Pacote atual: <%= pacoteAtual.quantidade_usada %> de <%= pacoteAtual.quantidade_total %> sessões usadas.</p>
    <% if (usuarioAtual.papel === "administradora") { %>
    <form
      method="post"
      action="/pacientes/<%= paciente.id %>/pacotes/<%= pacoteAtual.id %>/cancelar"
      onsubmit="return confirm('Confirma o cancelamento deste pacote?')"
    >
      <input type="hidden" name="_csrf" value="<%= csrfToken %>" />
      <button type="submit">Cancelar pacote</button>
    </form>
    <% } %>
    <% } else { %>
    <form method="post" action="/pacientes/<%= paciente.id %>/pacotes">
      <input type="hidden" name="_csrf" value="<%= csrfToken %>" />
      <label>Quantidade de sessões<input type="number" name="quantidade_total" min="1" required /></label>
      <button type="submit">Criar pacote</button>
    </form>
    <% } %>

    <% if (pacotes.length > 0) { %>
    <h3>Histórico de pacotes</h3>
    <table>
      <thead><tr><th>Criado em</th><th>Sessões</th><th>Situação</th></tr></thead>
      <tbody>
        <% pacotes.forEach((p) => { %>
        <tr>
          <td><%= p.created_at %></td>
          <td><%= p.quantidade_usada %> de <%= p.quantidade_total %></td>
          <td>
            <% if (p.cancelado) { %>cancelado
            <% } else if (p.quantidade_usada >= p.quantidade_total) { %>esgotado
            <% } else { %>ativo
            <% } %>
          </td>
        </tr>
        <% }) %>
      </tbody>
    </table>
    <% } %>
  </section>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/fichaPacienteView.test.js`
Expected: PASS

- [ ] **Step 5: Run the full suite, lint, and commit**

```bash
npm test
npm run lint
git add src/views/pacientes/ficha.ejs test/fichaPacienteView.test.js
git commit -m "feat: mostra pacote de sessões na ficha do paciente"
```

---

### Task 7: Verificação final do branch

**Files:** none (verification only)

- [ ] **Step 1: Rodar a suite inteira**

Run: `npm test`
Expected: all tests pass (existing suite + every test added in Tasks 2-6)

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: 0 errors (the pre-existing `calendarService.js:108` warning is
fine — it predates this plan and is out of scope)

- [ ] **Step 3: Revisar o diff inteiro contra `main`**

Run: `git diff main --stat` (from inside the worktree, once one exists per
`superpowers:using-git-worktrees`)
Expected: only the files listed across Tasks 1-6 appear — no accidental
changes to `chatService.js`, webhook routes, `calendarService.js`,
`googleCalendar.js`, or anything under `src/functions/`.

- [ ] **Step 4: Confirm no production action was taken**

Manually confirm: migration `018_pacotes_sessao.sql` was written but never
run against Neon; nothing was pushed to `origin`; Railway was not touched.
This matches the Global Constraints at the top of this plan — do not
"finish" this task by applying the migration or pushing, that needs its
own separate authorization later.
