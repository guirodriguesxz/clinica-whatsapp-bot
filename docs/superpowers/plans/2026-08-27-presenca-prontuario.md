# Presença e Prontuário Leve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar pra recepção uma tela `/presenca` no dashboard pra marcar compareceu/faltou + observação curta em qualquer agendamento passado, seja feito pelo bot ou migrado do sistema de agenda anterior.

**Architecture:** Tabela nova `registros_atendimento` (aponta pra `agendamentos` OU `agendamentos_importados`, nunca os dois) + um model novo que combina as duas origens em memória + duas rotas de escrita no dashboard EJS já existente (mesmo padrão de sessão/CSRF do sub-projeto 1).

**Tech Stack:** Express + EJS (dashboard já existente), `pg` (Pool + client transacional pra `registrarPresencaBot`), `node --test` com `pool.query`/`pool.connect` mockados (sem Postgres real nos testes).

**Spec:** [docs/superpowers/specs/2026-08-27-presenca-prontuario-design.md](../specs/2026-08-27-presenca-prontuario-design.md)

## Global Constraints

- `presenca` só aceita exatamente `'compareceu'` ou `'faltou'` — qualquer outro valor no `POST` é 400.
- `registros_atendimento` deve sempre apontar pra exatamente uma origem (`agendamento_id` XOR `agendamento_importado_id`) — reforçado pelo `CHECK (num_nonnulls(...) = 1)` no banco.
- Não usar/interpretar `agendamentos_importados.flag_f` pra pré-preencher nada — todo agendamento importado começa sem registro de presença.
- Toda rota `POST` do dashboard exige `exigirLogin` (antes) + `exigirCsrf` (depois), mesmo padrão das rotas já existentes em `dashboardRoutes.js`.
- Sem teste de integração com Postgres real — este projeto testa `node --test` com `pool.query`/`pool.connect` mockados via `t.mock.method`, nunca contra um banco de verdade.
- **Este projeto não tem banco de dev separado do de produção** (achado do sub-projeto 2) — a migration `011_presenca_prontuario.sql` só pode ser aplicada contra o banco real depois de aprovação explícita do usuário. Nenhuma tarefa deste plano deve rodá-la automaticamente contra o banco.
- Módulos que exportam funções (`models/*.js`) não podem ser mockados via `t.mock.method` num `import * as` — module namespace objects têm propriedades não-configuráveis. Testes de model e de controller mockam `pool.query`/`pool.connect` diretamente, deixando o código real do model rodar por cima (mesmo padrão de `test/dashboardController.test.js`).

---

## Estado atual relevante (confirmado direto no banco em 2026-08-27)

- `agendamentos`: 0 linhas hoje (zerado em teste), `status` tem `CHECK IN ('confirmado','cancelado','concluido')`.
- `agendamentos_importados`: 327 linhas, sem coluna `status` nenhuma; `flag_f` tem `S`/`N` em 59 linhas (significado não confirmado — fora de escopo, ver Global Constraints).
- `usuarios`, `pacientes`, dashboard (login/CSRF/sessão) já existem e funcionam (sub-projeto 1, mergeado).

## Task 1: Migration + extensão do filtro de status existente

**Files:**
- Create: `src/db/migrations/011_presenca_prontuario.sql`
- Modify: `src/models/agendamentoModel.js:107`

**Interfaces:**
- Produces: tabela `registros_atendimento` (colunas: `id`, `agendamento_id`, `agendamento_importado_id`, `presenca`, `observacao_sessao`, `registrado_por`, `registrado_em`) e o `CHECK` estendido em `agendamentos.status` — usados por todas as tasks seguintes.

- [ ] **Step 1: Criar a migration**

```sql
-- src/db/migrations/011_presenca_prontuario.sql
-- Clínica Exemplo Bot — migration 011: presença e prontuário leve (sub-projeto 3).
-- Rodar no SQL Editor do Neon (ou via psql) depois de 010_migracao_legado.sql.
-- ATENÇÃO: este projeto não tem banco de dev separado do de produção — só
-- aplicar depois de confirmar com o usuário (ver plano/spec deste sub-projeto).

CREATE TABLE IF NOT EXISTS registros_atendimento (
  id SERIAL PRIMARY KEY,
  agendamento_id INTEGER REFERENCES agendamentos(id),
  agendamento_importado_id INTEGER REFERENCES agendamentos_importados(id),
  presenca TEXT NOT NULL CHECK (presenca IN ('compareceu', 'faltou')),
  observacao_sessao TEXT,
  registrado_por INTEGER NOT NULL REFERENCES usuarios(id),
  registrado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(agendamento_id, agendamento_importado_id) = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_registros_atendimento_agendamento
  ON registros_atendimento (agendamento_id) WHERE agendamento_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_registros_atendimento_importado
  ON registros_atendimento (agendamento_importado_id) WHERE agendamento_importado_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER TABLE registros_atendimento ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON registros_atendimento FROM anon, authenticated;
  END IF;
END $$;

-- agendamentos.status ganha compareceu/faltou (o nome da constraint gerada
-- automaticamente pelo Postgres pro CHECK original — confirmar com
-- \d agendamentos se o nome real divergir antes de aplicar em produção).
ALTER TABLE agendamentos DROP CONSTRAINT IF EXISTS agendamentos_status_check;
ALTER TABLE agendamentos ADD CONSTRAINT agendamentos_status_check
  CHECK (status IN ('confirmado', 'cancelado', 'concluido', 'compareceu', 'faltou'));
```

- [ ] **Step 2: Estender a lista de status válidos usada pelo filtro de `/agendamentos`**

Em `src/models/agendamentoModel.js:107`, mudar:

```js
const STATUS_VALIDOS = ["confirmado", "cancelado", "concluido"];
```

para:

```js
const STATUS_VALIDOS = ["confirmado", "cancelado", "concluido", "compareceu", "faltou"];
```

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: 0 erros (mesmo warning pré-existente de `calendarService.js`, sem relação).

- [ ] **Step 4: Commit**

```bash
git add src/db/migrations/011_presenca_prontuario.sql src/models/agendamentoModel.js
git commit -m "feat: migration de presença/prontuário + status ampliado em agendamentos"
```

---

## Task 2: Model — listagem combinada (`listarPresenca`)

**Files:**
- Create: `src/models/registroAtendimentoModel.js`
- Test: `test/registroAtendimentoModel.test.js`

**Interfaces:**
- Consumes: `pool` de `src/db/pool.js` (`pool.query(sql, params) => { rows }`).
- Produces: `listarPresenca({ todos, limite, offset } = {}) => Promise<Array<{ id, origem: 'bot'|'importado', paciente_nome, tipo_atendimento, data, hora, presenca: string|null, observacao_sessao: string|null, registrado_em, registrado_por_nome }>>` — usado pela Task 4 (`telaPresenca`).

- [ ] **Step 1: Escrever os testes (falhando)**

```js
// test/registroAtendimentoModel.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { listarPresenca } from "../src/models/registroAtendimentoModel.js";

function mockarConsultas(t, { bot = [], importados = [] } = {}) {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("agendamentos_importados")) {
      return { rows: importados };
    }
    return { rows: bot };
  });
  return chamadas;
}

test("listarPresenca: combina itens do bot e importados, mais recente primeiro", async (t) => {
  mockarConsultas(t, {
    bot: [{ id: 1, origem: "bot", data: "2026-08-20", hora: "10:00:00" }],
    importados: [{ id: 2, origem: "importado", data: "2026-08-25", hora: "09:00:00" }],
  });

  const itens = await listarPresenca({});

  assert.deepEqual(
    itens.map((i) => i.origem),
    ["importado", "bot"]
  );
});

test("listarPresenca: aplica limite e offset sobre a lista já combinada", async (t) => {
  mockarConsultas(t, {
    bot: [
      { id: 1, data: "2026-08-20", hora: "10:00:00" },
      { id: 2, data: "2026-08-21", hora: "10:00:00" },
      { id: 3, data: "2026-08-22", hora: "10:00:00" },
    ],
  });

  const itens = await listarPresenca({ limite: 1, offset: 1 });

  assert.equal(itens.length, 1);
  assert.equal(itens[0].id, 2);
});

test("listarPresenca: por padrão (todos ausente) filtra só pendentes nas duas queries", async (t) => {
  const chamadas = mockarConsultas(t);

  await listarPresenca({});

  assert.equal(chamadas.length, 2);
  for (const { sql } of chamadas) {
    assert.match(sql, /ra\.id IS NULL/);
  }
});

test("listarPresenca: com todos=true não filtra por registro pendente", async (t) => {
  const chamadas = mockarConsultas(t);

  await listarPresenca({ todos: true });

  for (const { sql } of chamadas) {
    assert.doesNotMatch(sql, /ra\.id IS NULL/);
  }
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test test/registroAtendimentoModel.test.js`
Expected: FAIL — `Cannot find module '../src/models/registroAtendimentoModel.js'`.

- [ ] **Step 3: Implementar `listarPresenca`**

```js
// src/models/registroAtendimentoModel.js
import { pool } from "../db/pool.js";

const LIMITE_PADRAO_LISTAGEM = 50;
const LIMITE_MAXIMO_LISTAGEM = 200;

/**
 * Fragmento SQL "já aconteceu" pra uma tabela com colunas data/hora — usa
 * conversão explícita de fuso (America/Sao_Paulo) em vez de CURRENT_TIME
 * puro, porque o fuso da sessão do Postgres não é garantido ser o da
 * clínica (ex: Neon roda em UTC por padrão).
 */
function jaPassouSql(alias) {
  return `(${alias}.data < CURRENT_DATE OR (${alias}.data = CURRENT_DATE AND ${alias}.hora <= (now() AT TIME ZONE 'America/Sao_Paulo')::time))`;
}

async function buscarItensBot({ todos }) {
  const filtroRegistro = todos ? "" : "AND ra.id IS NULL";
  const { rows } = await pool.query(
    `SELECT
       a.id,
       'bot' AS origem,
       p.nome AS paciente_nome,
       a.tipo_atendimento,
       a.data,
       a.hora,
       ra.presenca,
       ra.observacao_sessao,
       ra.registrado_em,
       u.nome AS registrado_por_nome
     FROM agendamentos a
     JOIN pacientes p ON p.id = a.paciente_id
     LEFT JOIN registros_atendimento ra ON ra.agendamento_id = a.id
     LEFT JOIN usuarios u ON u.id = ra.registrado_por
     WHERE a.status IN ('confirmado', 'compareceu', 'faltou')
       AND ${jaPassouSql("a")}
       ${filtroRegistro}
     ORDER BY a.data DESC, a.hora DESC
     LIMIT $1`,
    [LIMITE_MAXIMO_LISTAGEM]
  );
  return rows;
}

async function buscarItensImportados({ todos }) {
  const filtroRegistro = todos ? "" : "AND ra.id IS NULL";
  const { rows } = await pool.query(
    `SELECT
       ai.id,
       'importado' AS origem,
       ai.nome AS paciente_nome,
       ai.tipo_atendimento,
       ai.data,
       ai.hora,
       ra.presenca,
       ra.observacao_sessao,
       ra.registrado_em,
       u.nome AS registrado_por_nome
     FROM agendamentos_importados ai
     LEFT JOIN registros_atendimento ra ON ra.agendamento_importado_id = ai.id
     LEFT JOIN usuarios u ON u.id = ra.registrado_por
     WHERE ${jaPassouSql("ai")}
       ${filtroRegistro}
     ORDER BY ai.data DESC, ai.hora DESC
     LIMIT $1`,
    [LIMITE_MAXIMO_LISTAGEM]
  );
  return rows;
}

/**
 * Lista combinada bot + importados pra tela /presenca. Cada query já traz
 * até LIMITE_MAXIMO_LISTAGEM linhas própria (bastante pro volume real desta
 * clínica — poucas centenas de agendamentos no total); limite/offset finais
 * são aplicados em memória sobre a lista já combinada e ordenada, não em
 * cada query separadamente (paginar duas fontes heterogêneas direto no SQL
 * exigiria UNION com casts pra alinhar as colunas — desnecessário nesta
 * escala).
 */
export async function listarPresenca({ todos, limite, offset } = {}) {
  const limiteSeguro = Math.min(Number(limite) || LIMITE_PADRAO_LISTAGEM, LIMITE_MAXIMO_LISTAGEM);
  const offsetSeguro = Math.max(Number(offset) || 0, 0);
  const todosBooleano = Boolean(todos);

  const [itensBot, itensImportados] = await Promise.all([
    buscarItensBot({ todos: todosBooleano }),
    buscarItensImportados({ todos: todosBooleano }),
  ]);

  const combinados = [...itensBot, ...itensImportados].sort((x, y) =>
    `${y.data}T${y.hora}`.localeCompare(`${x.data}T${x.hora}`)
  );

  return combinados.slice(offsetSeguro, offsetSeguro + limiteSeguro);
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test test/registroAtendimentoModel.test.js`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add src/models/registroAtendimentoModel.js test/registroAtendimentoModel.test.js
git commit -m "feat: listarPresenca combina agendamentos do bot e importados"
```

---

## Task 3: Model — registrar presença (`registrarPresencaBot`, `registrarPresencaImportado`)

**Files:**
- Modify: `src/models/registroAtendimentoModel.js`
- Test: `test/registroAtendimentoModel.test.js`

**Interfaces:**
- Consumes: `pool.connect()` (client transacional, só usado por `registrarPresencaBot`) além de `pool.query`.
- Produces:
  - `registrarPresencaBot({ agendamentoId, presenca, observacaoSessao, registradoPor }) => Promise<{ registro: object } | { motivo: 'nao_encontrado'|'cancelado'|'ainda_nao_ocorreu'|'conflito' }>`
  - `registrarPresencaImportado({ agendamentoImportadoId, presenca, observacaoSessao, registradoPor }) => Promise<{ registro: object } | { motivo: 'nao_encontrado'|'ainda_nao_ocorreu' }>`
  - Ambos usados pela Task 4 (controllers).

- [ ] **Step 1: Escrever os testes (falhando)**

Adicionar ao final de `test/registroAtendimentoModel.test.js`:

```js
import { registrarPresencaBot, registrarPresencaImportado } from "../src/models/registroAtendimentoModel.js";

function mockarClientTransacional(t, { statusUpdateRowCount = 1, registroRetornado = {} } = {}) {
  const chamadas = [];
  const client = {
    query: async (sql, params) => {
      chamadas.push({ sql, params });
      if (sql.includes("UPDATE agendamentos")) {
        return { rowCount: statusUpdateRowCount };
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

test("registrarPresencaBot: agendamento inexistente retorna motivo nao_encontrado", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await registrarPresencaBot({
    agendamentoId: 999,
    presenca: "compareceu",
    observacaoSessao: null,
    registradoPor: 1,
  });

  assert.deepEqual(resultado, { motivo: "nao_encontrado" });
});

test("registrarPresencaBot: agendamento cancelado retorna motivo cancelado", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 5, status: "cancelado", ja_passou: true }],
  }));

  const resultado = await registrarPresencaBot({
    agendamentoId: 5,
    presenca: "compareceu",
    observacaoSessao: null,
    registradoPor: 1,
  });

  assert.deepEqual(resultado, { motivo: "cancelado" });
});

test("registrarPresencaBot: agendamento ainda no futuro retorna motivo ainda_nao_ocorreu", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 5, status: "confirmado", ja_passou: false }],
  }));

  const resultado = await registrarPresencaBot({
    agendamentoId: 5,
    presenca: "compareceu",
    observacaoSessao: null,
    registradoPor: 1,
  });

  assert.deepEqual(resultado, { motivo: "ainda_nao_ocorreu" });
});

test("registrarPresencaBot: caminho feliz atualiza status e grava o registro numa transação", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 5, status: "confirmado", ja_passou: true }],
  }));
  const registroEsperado = { id: 1, agendamento_id: 5, presenca: "compareceu" };
  const chamadas = mockarClientTransacional(t, { registroRetornado: registroEsperado });

  const resultado = await registrarPresencaBot({
    agendamentoId: 5,
    presenca: "compareceu",
    observacaoSessao: "Evoluiu bem",
    registradoPor: 7,
  });

  assert.deepEqual(resultado, { registro: registroEsperado });
  assert.equal(chamadas[0].sql, "BEGIN");
  assert.match(chamadas[1].sql, /UPDATE agendamentos/);
  assert.match(chamadas[2].sql, /INSERT INTO registros_atendimento/);
  assert.equal(chamadas[3].sql, "COMMIT");
});

test("registrarPresencaBot: UPDATE afetando 0 linhas (corrida) retorna motivo conflito e faz ROLLBACK", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 5, status: "confirmado", ja_passou: true }],
  }));
  const chamadas = mockarClientTransacional(t, { statusUpdateRowCount: 0 });

  const resultado = await registrarPresencaBot({
    agendamentoId: 5,
    presenca: "compareceu",
    observacaoSessao: null,
    registradoPor: 7,
  });

  assert.deepEqual(resultado, { motivo: "conflito" });
  assert.equal(chamadas.at(-1).sql, "ROLLBACK");
});

test("registrarPresencaImportado: agendamento inexistente retorna motivo nao_encontrado", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await registrarPresencaImportado({
    agendamentoImportadoId: 999,
    presenca: "faltou",
    observacaoSessao: null,
    registradoPor: 1,
  });

  assert.deepEqual(resultado, { motivo: "nao_encontrado" });
});

test("registrarPresencaImportado: agendamento ainda no futuro retorna motivo ainda_nao_ocorreu", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ id: 8, ja_passou: false }] }));

  const resultado = await registrarPresencaImportado({
    agendamentoImportadoId: 8,
    presenca: "faltou",
    observacaoSessao: null,
    registradoPor: 1,
  });

  assert.deepEqual(resultado, { motivo: "ainda_nao_ocorreu" });
});

test("registrarPresencaImportado: caminho feliz grava o registro (upsert simples, sem transação)", async (t) => {
  const registroEsperado = { id: 2, agendamento_importado_id: 8, presenca: "faltou" };
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("INSERT INTO registros_atendimento")) {
      return { rows: [registroEsperado] };
    }
    return { rows: [{ id: 8, ja_passou: true }] };
  });

  const resultado = await registrarPresencaImportado({
    agendamentoImportadoId: 8,
    presenca: "faltou",
    observacaoSessao: null,
    registradoPor: 7,
  });

  assert.deepEqual(resultado, { registro: registroEsperado });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test test/registroAtendimentoModel.test.js`
Expected: FAIL — `registrarPresencaBot`/`registrarPresencaImportado` não exportados.

- [ ] **Step 3: Implementar as duas funções**

`jaPassouSql` (Task 2) espera um alias de tabela — para estas duas consultas, sem alias (uma tabela só, sem JOIN), a condição é escrita por extenso em vez de reaproveitar a função. Adicionar ao final de `src/models/registroAtendimentoModel.js`:

```js
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

async function buscarImportadoParaPresenca(id) {
  const { rows } = await pool.query(
    `SELECT id,
       (data < CURRENT_DATE OR (data = CURRENT_DATE AND hora <= (now() AT TIME ZONE 'America/Sao_Paulo')::time)) AS ja_passou
     FROM agendamentos_importados
     WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

/**
 * Marca presença de um agendamento do bot. Faz duas escritas numa
 * transação: atualiza agendamentos.status (compareceu/faltou) e faz upsert
 * em registros_atendimento — precisam ser atômicas, senão um erro no meio
 * deixaria o status dizendo uma coisa e o registro de presença outra (ou
 * nenhum registro). O UPDATE usa `WHERE status <> 'cancelado'` (não só
 * `= 'confirmado'`) de propósito: permite tanto marcar pela primeira vez
 * quanto corrigir um registro já feito (status já compareceu/faltou), só
 * bloqueando se o agendamento foi cancelado entre a pré-checagem e aqui
 * (corrida real, ainda que rara) — nesse caso retorna motivo 'conflito'.
 */
export async function registrarPresencaBot({ agendamentoId, presenca, observacaoSessao, registradoPor }) {
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
    const { rows } = await client.query(
      `INSERT INTO registros_atendimento (agendamento_id, presenca, observacao_sessao, registrado_por)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (agendamento_id) DO UPDATE
         SET presenca = EXCLUDED.presenca,
             observacao_sessao = EXCLUDED.observacao_sessao,
             registrado_por = EXCLUDED.registrado_por,
             registrado_em = now()
       RETURNING *`,
      [agendamentoId, presenca, observacaoSessao, registradoPor]
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

/**
 * Marca presença de um agendamento importado. Sem status pra atualizar
 * (agendamentos_importados não tem essa coluna) — só o upsert em
 * registros_atendimento, sem necessidade de transação (uma única escrita).
 */
export async function registrarPresencaImportado({
  agendamentoImportadoId,
  presenca,
  observacaoSessao,
  registradoPor,
}) {
  const agendamento = await buscarImportadoParaPresenca(agendamentoImportadoId);
  if (!agendamento) return { motivo: "nao_encontrado" };
  if (!agendamento.ja_passou) return { motivo: "ainda_nao_ocorreu" };

  const { rows } = await pool.query(
    `INSERT INTO registros_atendimento (agendamento_importado_id, presenca, observacao_sessao, registrado_por)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (agendamento_importado_id) DO UPDATE
       SET presenca = EXCLUDED.presenca,
           observacao_sessao = EXCLUDED.observacao_sessao,
           registrado_por = EXCLUDED.registrado_por,
           registrado_em = now()
     RETURNING *`,
    [agendamentoImportadoId, presenca, observacaoSessao, registradoPor]
  );
  return { registro: rows[0] };
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test test/registroAtendimentoModel.test.js`
Expected: PASS (11/11 no arquivo todo).

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: 0 erros.

- [ ] **Step 6: Commit**

```bash
git add src/models/registroAtendimentoModel.js test/registroAtendimentoModel.test.js
git commit -m "feat: registrarPresencaBot e registrarPresencaImportado"
```

---

## Task 4: Controller (`telaPresenca`, `processarPresencaAgendamento`, `processarPresencaImportado`)

**Files:**
- Modify: `src/controllers/dashboardController.js`
- Test: `test/dashboardControllerPresenca.test.js` (novo arquivo — mantém `test/dashboardController.test.js` focado só em login, ver Global Constraints)

**Interfaces:**
- Consumes: `listarPresenca`, `registrarPresencaBot`, `registrarPresencaImportado` (Tasks 2/3); `req.usuarioAtual.id` (já injetado por `exigirLogin`, ver `src/middleware/dashboardAuth.js:35`).
- Produces: `telaPresenca(req, res)`, `processarPresencaAgendamento(req, res)`, `processarPresencaImportado(req, res)` — usados pela Task 5 (rotas).

- [ ] **Step 1: Escrever os testes (falhando)**

```js
// test/dashboardControllerPresenca.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import {
  telaPresenca,
  processarPresencaAgendamento,
  processarPresencaImportado,
} from "../src/controllers/dashboardController.js";

function criarRespostaFalsa() {
  return {
    statusCode: 200,
    corpo: null,
    viewRenderizada: null,
    dadosDaView: null,
    redirectedTo: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(corpo) {
      this.corpo = corpo;
      return this;
    },
    render(view, dados) {
      this.viewRenderizada = view;
      this.dadosDaView = dados;
      return this;
    },
    redirect(url) {
      this.redirectedTo = url;
    },
  };
}

function criarRequisicao({ params = {}, body = {}, query = {}, usuarioId = 7 } = {}) {
  return { params, body, query, usuarioAtual: { id: usuarioId } };
}

function mockarClientTransacional(t, { statusUpdateRowCount = 1, registroRetornado = {} } = {}) {
  const client = {
    query: async (sql) => {
      if (sql.includes("UPDATE agendamentos")) return { rowCount: statusUpdateRowCount };
      if (sql.includes("INSERT INTO registros_atendimento")) return { rows: [registroRetornado] };
      return {};
    },
    release: () => {},
  };
  t.mock.method(pool, "connect", async () => client);
}

test("processarPresencaAgendamento: presença inválida responde 400 sem consultar o banco", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await processarPresencaAgendamento(
    criarRequisicao({ params: { id: "5" }, body: { presenca: "quaseveio" } }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(consultas.length, 0);
});

test("processarPresencaAgendamento: agendamento inexistente responde 404", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const res = criarRespostaFalsa();

  await processarPresencaAgendamento(
    criarRequisicao({ params: { id: "999" }, body: { presenca: "compareceu" } }),
    res
  );

  assert.equal(res.statusCode, 404);
});

test("processarPresencaAgendamento: caminho feliz redireciona pra /presenca", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 5, status: "confirmado", ja_passou: true }],
  }));
  mockarClientTransacional(t, { registroRetornado: { id: 1, presenca: "compareceu" } });
  const res = criarRespostaFalsa();

  await processarPresencaAgendamento(
    criarRequisicao({
      params: { id: "5" },
      body: { presenca: "compareceu", observacao_sessao: "  Foi bem  " },
    }),
    res
  );

  assert.equal(res.redirectedTo, "/presenca");
});

test("processarPresencaAgendamento: corrida (0 linhas afetadas) responde 409", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 5, status: "confirmado", ja_passou: true }],
  }));
  mockarClientTransacional(t, { statusUpdateRowCount: 0 });
  const res = criarRespostaFalsa();

  await processarPresencaAgendamento(
    criarRequisicao({ params: { id: "5" }, body: { presenca: "compareceu" } }),
    res
  );

  assert.equal(res.statusCode, 409);
});

test("processarPresencaImportado: caminho feliz redireciona pra /presenca", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("INSERT INTO registros_atendimento")) {
      return { rows: [{ id: 2, presenca: "faltou" }] };
    }
    return { rows: [{ id: 8, ja_passou: true }] };
  });
  const res = criarRespostaFalsa();

  await processarPresencaImportado(
    criarRequisicao({ params: { id: "8" }, body: { presenca: "faltou" } }),
    res
  );

  assert.equal(res.redirectedTo, "/presenca");
});

test("telaPresenca: renderiza presenca/lista com os itens combinados e a flag todos", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("agendamentos_importados")) return { rows: [] };
    return { rows: [{ id: 1, origem: "bot", data: "2026-08-20", hora: "10:00:00" }] };
  });
  const res = criarRespostaFalsa();

  await telaPresenca(criarRequisicao({ query: {} }), res);

  assert.equal(res.viewRenderizada, "presenca/lista");
  assert.equal(res.dadosDaView.itens.length, 1);
  assert.equal(res.dadosDaView.todos, false);
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test test/dashboardControllerPresenca.test.js`
Expected: FAIL — `telaPresenca`/`processarPresencaAgendamento`/`processarPresencaImportado` não exportados.

- [ ] **Step 3: Implementar os controllers**

Em `src/controllers/dashboardController.js`, adicionar ao topo do arquivo:

```js
import {
  listarPresenca,
  registrarPresencaBot,
  registrarPresencaImportado,
} from "../models/registroAtendimentoModel.js";
```

E ao final do arquivo:

```js
const PRESENCA_VALIDA = ["compareceu", "faltou"];

function mensagemErroPresenca(motivo) {
  switch (motivo) {
    case "cancelado":
      return "Esse agendamento foi cancelado, não é possível registrar presença.";
    case "ainda_nao_ocorreu":
      return "Esse agendamento ainda não aconteceu.";
    case "conflito":
      return "Esse agendamento já foi atualizado por outra pessoa — recarregue a página e tente de novo.";
    default:
      return "Não foi possível registrar a presença.";
  }
}

export async function telaPresenca(req, res) {
  const { limite, offset } = req.query;
  const todos = req.query.todos === "1";
  const itens = await listarPresenca({ todos, limite, offset });
  res.render("presenca/lista", { itens, todos });
}

export async function processarPresencaAgendamento(req, res) {
  const { presenca, observacao_sessao } = req.body ?? {};
  if (!PRESENCA_VALIDA.includes(presenca)) {
    return res.status(400).send("Presença inválida — use compareceu ou faltou.");
  }

  const resultado = await registrarPresencaBot({
    agendamentoId: Number(req.params.id),
    presenca,
    observacaoSessao: observacao_sessao?.trim() || null,
    registradoPor: req.usuarioAtual.id,
  });

  if (resultado.motivo === "nao_encontrado") {
    return res.status(404).send("Agendamento não encontrado.");
  }
  if (resultado.motivo) {
    const status = resultado.motivo === "conflito" ? 409 : 400;
    return res.status(status).send(mensagemErroPresenca(resultado.motivo));
  }
  res.redirect("/presenca");
}

export async function processarPresencaImportado(req, res) {
  const { presenca, observacao_sessao } = req.body ?? {};
  if (!PRESENCA_VALIDA.includes(presenca)) {
    return res.status(400).send("Presença inválida — use compareceu ou faltou.");
  }

  const resultado = await registrarPresencaImportado({
    agendamentoImportadoId: Number(req.params.id),
    presenca,
    observacaoSessao: observacao_sessao?.trim() || null,
    registradoPor: req.usuarioAtual.id,
  });

  if (resultado.motivo === "nao_encontrado") {
    return res.status(404).send("Agendamento não encontrado.");
  }
  if (resultado.motivo) {
    return res.status(400).send(mensagemErroPresenca(resultado.motivo));
  }
  res.redirect("/presenca");
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test test/dashboardControllerPresenca.test.js`
Expected: PASS (6/6).

- [ ] **Step 5: Rodar a suíte inteira + lint**

Run: `npm test && npm run lint`
Expected: todos os testes passam, 0 erros de lint.

- [ ] **Step 6: Commit**

```bash
git add src/controllers/dashboardController.js test/dashboardControllerPresenca.test.js
git commit -m "feat: controllers de presença (telaPresenca, processarPresenca*)"
```

---

## Task 5: Rotas

**Files:**
- Modify: `src/routes/dashboardRoutes.js`

**Interfaces:**
- Consumes: `telaPresenca`, `processarPresencaAgendamento`, `processarPresencaImportado` (Task 4); `exigirLogin`, `exigirCsrf` (já existentes).
- Produces: `GET /presenca`, `POST /presenca/agendamento/:id`, `POST /presenca/importado/:id` — usados pela Task 6 (view) e pela verificação manual final.

- [ ] **Step 1: Adicionar as rotas**

Em `src/routes/dashboardRoutes.js`, atualizar o import:

```js
import {
  telaLogin,
  processarLogin,
  processarLogout,
  telaNovoUsuario,
  processarNovoUsuario,
  telaAgendamentos,
  telaPacientes,
  telaPresenca,
  processarPresencaAgendamento,
  processarPresencaImportado,
} from "../controllers/dashboardController.js";
```

E adicionar, depois da rota `/pacientes`:

```js
router.get("/presenca", asyncHandler(exigirLogin), asyncHandler(telaPresenca));
router.post(
  "/presenca/agendamento/:id",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarPresencaAgendamento)
);
router.post(
  "/presenca/importado/:id",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarPresencaImportado)
);
```

- [ ] **Step 2: Lint (não há teste dedicado de rotas neste projeto — dashboardRoutes.js não é testado isoladamente em nenhum outro sub-projeto; cobertura vem da Task 4 nos controllers + verificação manual no fim do plano)**

Run: `npm run lint`
Expected: 0 erros.

- [ ] **Step 3: Commit**

```bash
git add src/routes/dashboardRoutes.js
git commit -m "feat: rotas /presenca no dashboard"
```

---

## Task 6: View (`presenca/lista.ejs`) + link de navegação

**Files:**
- Create: `src/views/presenca/lista.ejs`
- Modify: `src/views/partials/header.ejs:14-16`

**Interfaces:**
- Consumes: `itens` e `todos` (renderizados por `telaPresenca`, Task 4); `csrfToken`/`usuarioAtual` (já injetados em `res.locals` por `exigirLogin`).

- [ ] **Step 1: Criar a view**

```html
<!-- src/views/presenca/lista.ejs -->
<%- include("../partials/header", { titulo: "Presença" }) %>
<h1>Presença</h1>
<p>
  <% if (todos) { %>
  <a href="/presenca">Ver só pendentes</a>
  <% } else { %>
  <a href="/presenca?todos=1">Ver todos (incluindo já registrados)</a>
  <% } %>
</p>
<table>
  <thead>
    <tr>
      <th>Data</th>
      <th>Hora</th>
      <th>Paciente</th>
      <th>Tipo</th>
      <th>Origem</th>
      <th>Presença</th>
    </tr>
  </thead>
  <tbody>
    <% itens.forEach((item) => { %>
    <tr>
      <td><%= item.data %></td>
      <td><%= item.hora %></td>
      <td><%= item.paciente_nome %></td>
      <td><%= item.tipo_atendimento %></td>
      <td><%= item.origem === "bot" ? "Bot" : "Importado" %></td>
      <td>
        <form
          method="post"
          action="/presenca/<%= item.origem === 'bot' ? 'agendamento' : 'importado' %>/<%= item.id %>"
        >
          <input type="hidden" name="_csrf" value="<%= csrfToken %>" />
          <label>
            <input
              type="radio"
              name="presenca"
              value="compareceu"
              <%= item.presenca === "compareceu" ? "checked" : "" %>
              required
            />
            Compareceu
          </label>
          <label>
            <input
              type="radio"
              name="presenca"
              value="faltou"
              <%= item.presenca === "faltou" ? "checked" : "" %>
            />
            Faltou
          </label>
          <br />
          <textarea
            name="observacao_sessao"
            placeholder="Observação (opcional)"
          ><%= item.observacao_sessao ?? "" %></textarea>
          <br />
          <button type="submit"><%= item.presenca ? "Corrigir" : "Registrar" %></button>
        </form>
        <% if (item.presenca) { %>
        <p class="registro-info">
          Registrado por <%= item.registrado_por_nome %> em <%= item.registrado_em %>
        </p>
        <% } %>
      </td>
    </tr>
    <% }) %>
  </tbody>
</table>
<%- include("../partials/footer") %>
```

- [ ] **Step 2: Adicionar o link no menu**

Em `src/views/partials/header.ejs:14-16`, mudar:

```html
<a href="/agendamentos">Agendamentos</a>
<a href="/pacientes">Pacientes</a>
<a href="/usuarios/novo">Novo usuário</a>
```

para:

```html
<a href="/agendamentos">Agendamentos</a>
<a href="/pacientes">Pacientes</a>
<a href="/presenca">Presença</a>
<a href="/usuarios/novo">Novo usuário</a>
```

- [ ] **Step 3: Rodar a suíte inteira + lint**

Run: `npm test && npm run lint`
Expected: todos os testes passam, 0 erros.

- [ ] **Step 4: Commit**

```bash
git add src/views/presenca/lista.ejs src/views/partials/header.ejs
git commit -m "feat: tela /presenca no dashboard"
```

---

## Verificação manual e aplicação da migration (fora das tasks — requer aprovação explícita)

**Antes de considerar este sub-projeto pronto pra mergear:**

1. **Não aplicar `011_presenca_prontuario.sql` contra o banco sem antes reportar o plano ao usuário e receber aprovação explícita** — este projeto não tem banco de dev separado do de produção (achado do sub-projeto 2), então aplicar a migration é uma mudança de schema direto em produção.
2. Depois de aprovado e aplicado: rodar `npm run dev`/`node server.js` localmente, logar no dashboard, e confirmar manualmente:
   - Um agendamento do bot com `status='confirmado'` e data/hora no passado aparece em `/presenca`; um `cancelado` e um futuro **não** aparecem.
   - Marcar `compareceu` num agendamento do bot atualiza `agendamentos.status` **e** cria a linha em `registros_atendimento` (conferir direto no banco).
   - Um agendamento importado (`agendamentos_importados`) com data no passado aparece na mesma lista, mesmo sem nunca ter passado pelo bot; marcar presença cria o registro sem tocar `agendamentos_importados`.
   - `?todos=1` mostra também os já registrados, com o formulário pré-preenchido; reenviar com um valor diferente corrige o registro (conferir `registrado_em` mudou).
   - Tentar `POST` num id inexistente responde 404; num agendamento cancelado ou futuro responde 400, com a mensagem certa.
3. Só depois dessa verificação: seguir pro fluxo de revisão do branch inteiro + merge em `main` (mesmo processo dos sub-projetos 1 e 2 — `superpowers:finishing-a-development-branch`).
