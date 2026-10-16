# Cadastro de Psicólogos (Fase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma tela `/psicologos` onde qualquer usuário logado cadastra, edita o nome, desativa e reativa psicólogos da clínica (só nome + ativo/inativo) — sem nenhuma ligação com agendamento ainda (isso é Fase 2, fora deste plano).

**Architecture:** Tabela nova `psicologos`, model/controller/views próprios (arquivo dedicado, não misturado em `dashboardController.js`/`pacienteModel.js`), seguindo exatamente o padrão já usado por `usuarios` (mesma estrutura de rotas, mesmo estilo de view), mas sem exigir papel `administradora` e com desativar/reativar (usuários só desativa, nunca reativa pela UI).

**Tech Stack:** Node.js, Express, EJS, Postgres (Neon) via `pg`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-03-cadastro-psicologos-design.md`

## Global Constraints

- Qualquer usuário logado pode criar/editar/desativar/reativar — sem exigir papel `administradora` (diferente de `/usuarios`).
- Nunca exclusão definitiva (`DELETE`) — só `ativo = true/false`.
- Só dois campos: `nome` (TEXT NOT NULL) e `ativo` (BOOLEAN NOT NULL DEFAULT true). Nenhum outro campo nesta fase.
- Nenhuma ligação com `agendamentos` nesta fase — isso é Fase 2.
- Rodar `npm test` depois de cada tarefa antes de commitar — todos os testes existentes continuam passando.

---

## File Structure

```
src/
├── db/migrations/
│   └── 024_psicologos.sql          # nova
├── models/
│   └── psicologoModel.js           # nova
├── controllers/
│   └── psicologoController.js      # nova
├── routes/
│   └── dashboardRoutes.js          # +rotas de /psicologos
└── views/
    ├── partials/
    │   └── header.ejs              # +item "Psicólogos" no menu
    └── psicologos/
        ├── lista.ejs                # nova
        ├── novo.ejs                 # nova
        └── editar.ejs               # nova
test/
├── migrations.test.js               # +migration 024
├── psicologoModel.test.js           # nova
├── psicologoController.test.js      # nova
└── psicologosView.test.js           # nova
```

---

### Task 1: Migration 024 — tabela `psicologos`

**Files:**
- Create: `src/db/migrations/024_psicologos.sql`
- Test: `test/migrations.test.js`

**Interfaces:**
- Produces: tabela `psicologos` (`id SERIAL PRIMARY KEY`, `nome TEXT NOT NULL`, `ativo BOOLEAN NOT NULL DEFAULT true`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`).

- [ ] **Step 1: Escrever a migration**

```sql
-- src/db/migrations/024_psicologos.sql
-- Clínica Exemplo Bot — migration 024: cadastro de psicólogos (Fase 1)
--
-- Cadastro simples de psicólogos da clínica, administrável por qualquer
-- usuário logado (ver docs/superpowers/specs/2026-09-03-cadastro-psicologos-design.md).
-- Sem nenhuma ligação com agendamentos nesta fase — isso é Fase 2, quando
-- a agenda real de Psicologia estiver disponível.

CREATE TABLE IF NOT EXISTS psicologos (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Escrever o teste da migration (mesmo padrão das migrations 020-023 já existentes)**

Adicionar ao topo de `test/migrations.test.js`, junto das outras constantes `MIGRATION_*`:

```javascript
const MIGRATION_024 = path.join(ROOT, "src/db/migrations/024_psicologos.sql");
```

Adicionar ao final do arquivo:

```javascript
test("migration 024: cria psicologos com nome obrigatório e ativo default true", async () => {
  const sql = await readFile(MIGRATION_024, "utf8");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS psicologos/);
  assert.match(sql, /nome TEXT NOT NULL/);
  assert.match(sql, /ativo BOOLEAN NOT NULL DEFAULT true/);
  assert.match(sql, /created_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)/);
});
```

- [ ] **Step 3: Rodar o teste**

Run: `node --test test/migrations.test.js`
Expected: PASS (todas as migrations 020-023 já existentes + 024 nova).

- [ ] **Step 4: Commit**

```bash
git add src/db/migrations/024_psicologos.sql test/migrations.test.js
git commit -m "feat: migration 024 — cadastro de psicólogos (Fase 1)"
```

---

### Task 2: `psicologoModel.js`

**Files:**
- Create: `src/models/psicologoModel.js`
- Test: `test/psicologoModel.test.js` (novo)

**Interfaces:**
- Consumes: `pool` de `../db/pool.js` (mesmo padrão de `usuarioModel.js`).
- Produces:
  - `listarPsicologos() => Promise<Array<{id, nome, ativo, created_at}>>`
  - `buscarPsicologoPorId(id) => Promise<{id, nome, ativo, created_at} | null>`
  - `criarPsicologo(nome) => Promise<{id, nome, ativo, created_at}>`
  - `atualizarNomePsicologo(id, nome) => Promise<{id, nome, ativo, created_at} | null>`
  - `definirAtivoPsicologo(id, ativo) => Promise<{id, nome, ativo} | null>`

- [ ] **Step 1: Escrever os testes**

```javascript
// test/psicologoModel.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import {
  listarPsicologos,
  buscarPsicologoPorId,
  criarPsicologo,
  atualizarNomePsicologo,
  definirAtivoPsicologo,
} from "../src/models/psicologoModel.js";

function mockarQuery(t, linhas = []) {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: linhas };
  });
  return consultas;
}

test("listarPsicologos ordena pelo nome", async (t) => {
  const consultas = mockarQuery(t, [{ id: 1, nome: "Ana", ativo: true }]);

  const resultado = await listarPsicologos();

  assert.match(consultas[0].sql, /ORDER BY nome ASC/i);
  assert.equal(resultado[0].nome, "Ana");
});

test("buscarPsicologoPorId retorna null quando não existe", async (t) => {
  mockarQuery(t, []);

  const resultado = await buscarPsicologoPorId(999);

  assert.equal(resultado, null);
});

test("buscarPsicologoPorId consulta pelo id informado", async (t) => {
  const consultas = mockarQuery(t, [{ id: 5, nome: "Bia", ativo: true }]);

  const resultado = await buscarPsicologoPorId(5);

  assert.deepEqual(consultas[0].params, [5]);
  assert.equal(resultado.nome, "Bia");
});

test("criarPsicologo grava o nome e retorna a linha criada", async (t) => {
  const consultas = mockarQuery(t, [{ id: 8, nome: "Caio", ativo: true, created_at: "2026-09-03" }]);

  const resultado = await criarPsicologo("Caio");

  assert.match(consultas[0].sql, /INSERT INTO psicologos \(nome\)/);
  assert.deepEqual(consultas[0].params, ["Caio"]);
  assert.equal(resultado.id, 8);
});

test("atualizarNomePsicologo altera somente o nome", async (t) => {
  const consultas = mockarQuery(t, [{ id: 5, nome: "Bia Nova", ativo: true }]);

  const resultado = await atualizarNomePsicologo(5, "Bia Nova");

  assert.match(consultas[0].sql, /SET nome = \$2/);
  assert.deepEqual(consultas[0].params, [5, "Bia Nova"]);
  assert.equal(resultado.nome, "Bia Nova");
});

test("atualizarNomePsicologo retorna null quando o id não existe", async (t) => {
  mockarQuery(t, []);

  const resultado = await atualizarNomePsicologo(999, "Nome");

  assert.equal(resultado, null);
});

test("definirAtivoPsicologo(id, false) desativa", async (t) => {
  const consultas = mockarQuery(t, [{ id: 5, nome: "Bia", ativo: false }]);

  const resultado = await definirAtivoPsicologo(5, false);

  assert.match(consultas[0].sql, /SET ativo = \$2/);
  assert.deepEqual(consultas[0].params, [5, false]);
  assert.equal(resultado.ativo, false);
});

test("definirAtivoPsicologo(id, true) reativa", async (t) => {
  const consultas = mockarQuery(t, [{ id: 5, nome: "Bia", ativo: true }]);

  const resultado = await definirAtivoPsicologo(5, true);

  assert.deepEqual(consultas[0].params, [5, true]);
  assert.equal(resultado.ativo, true);
});

test("definirAtivoPsicologo retorna null quando o id não existe", async (t) => {
  mockarQuery(t, []);

  const resultado = await definirAtivoPsicologo(999, false);

  assert.equal(resultado, null);
});
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `node --test test/psicologoModel.test.js`
Expected: FAIL — `src/models/psicologoModel.js` não existe.

- [ ] **Step 3: Implementar**

```javascript
// src/models/psicologoModel.js
import { pool } from "../db/pool.js";

export async function listarPsicologos() {
  const { rows } = await pool.query(
    "SELECT id, nome, ativo, created_at FROM psicologos ORDER BY nome ASC"
  );
  return rows;
}

export async function buscarPsicologoPorId(id) {
  const { rows } = await pool.query(
    "SELECT id, nome, ativo, created_at FROM psicologos WHERE id = $1",
    [id]
  );
  return rows[0] ?? null;
}

export async function criarPsicologo(nome) {
  const { rows } = await pool.query(
    "INSERT INTO psicologos (nome) VALUES ($1) RETURNING id, nome, ativo, created_at",
    [nome]
  );
  return rows[0];
}

export async function atualizarNomePsicologo(id, nome) {
  const { rows } = await pool.query(
    "UPDATE psicologos SET nome = $2 WHERE id = $1 RETURNING id, nome, ativo, created_at",
    [id, nome]
  );
  return rows[0] ?? null;
}

export async function definirAtivoPsicologo(id, ativo) {
  const { rows } = await pool.query(
    "UPDATE psicologos SET ativo = $2 WHERE id = $1 RETURNING id, nome, ativo",
    [id, ativo]
  );
  return rows[0] ?? null;
}
```

- [ ] **Step 4: Rodar os testes**

Run: `node --test test/psicologoModel.test.js`
Expected: PASS em todos.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/models/psicologoModel.js test/psicologoModel.test.js
git commit -m "feat: psicologoModel — CRUD básico de psicólogos"
```

---

### Task 3: `psicologoController.js`

**Files:**
- Create: `src/controllers/psicologoController.js`
- Test: `test/psicologoController.test.js` (novo)

**Interfaces:**
- Consumes: `listarPsicologos`, `buscarPsicologoPorId`, `criarPsicologo`, `atualizarNomePsicologo`, `definirAtivoPsicologo` (Task 2) de `../models/psicologoModel.js`; `idSeguro` de `../utils/paginacao.js` (já existe, usado por `dashboardController.js`).
- Produces:
  - `telaPsicologos(req, res, deps?)` — `GET /psicologos`.
  - `telaNovoPsicologo(req, res)` — `GET /psicologos/novo`.
  - `processarNovoPsicologo(req, res, deps?)` — `POST /psicologos/novo`.
  - `telaEditarPsicologo(req, res, deps?)` — `GET /psicologos/:id/editar`.
  - `processarEditarPsicologo(req, res, deps?)` — `POST /psicologos/:id/editar`.
  - `processarDesativarPsicologo(req, res, deps?)` — `POST /psicologos/:id/desativar`.
  - `processarReativarPsicologo(req, res, deps?)` — `POST /psicologos/:id/reativar`.

- [ ] **Step 1: Escrever os testes**

```javascript
// test/psicologoController.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  telaPsicologos,
  telaNovoPsicologo,
  processarNovoPsicologo,
  telaEditarPsicologo,
  processarEditarPsicologo,
  processarDesativarPsicologo,
  processarReativarPsicologo,
} from "../src/controllers/psicologoController.js";

function criarRespostaFalsa() {
  return {
    statusCode: 200,
    corpo: null,
    redirectedTo: null,
    viewRenderizada: null,
    dadosDaView: null,
    status(code) { this.statusCode = code; return this; },
    send(corpo) { this.corpo = corpo; return this; },
    redirect(url) { this.redirectedTo = url; },
    render(view, dados) { this.viewRenderizada = view; this.dadosDaView = dados; },
  };
}

const PSICOLOGO = { id: 5, nome: "Ana", ativo: true };

test("telaPsicologos: renderiza a lista", async () => {
  const res = criarRespostaFalsa();
  await telaPsicologos({ query: {} }, res, { listar: async () => [PSICOLOGO] });

  assert.equal(res.viewRenderizada, "psicologos/lista");
  assert.deepEqual(res.dadosDaView.psicologos, [PSICOLOGO]);
  assert.equal(res.dadosDaView.sucesso, false);
});

test("telaNovoPsicologo: renderiza o formulário", () => {
  const res = criarRespostaFalsa();
  telaNovoPsicologo({}, res);

  assert.equal(res.viewRenderizada, "psicologos/novo");
});

test("processarNovoPsicologo: nome vazio responde 400 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarNovoPsicologo(
    { body: { nome: "   " } },
    res,
    { criar: async () => { gravou = true; } }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(gravou, false);
});

test("processarNovoPsicologo: caminho feliz grava (trimado) e redireciona", async () => {
  const res = criarRespostaFalsa();
  let nomeGravado = null;
  await processarNovoPsicologo(
    { body: { nome: "  Ana Nova  " } },
    res,
    { criar: async (nome) => { nomeGravado = nome; } }
  );

  assert.equal(nomeGravado, "Ana Nova");
  assert.equal(res.redirectedTo, "/psicologos?sucesso=1");
});

test("telaEditarPsicologo: id não numérico responde 404", async () => {
  const res = criarRespostaFalsa();
  await telaEditarPsicologo({ params: { id: "abc" } }, res);

  assert.equal(res.statusCode, 404);
});

test("telaEditarPsicologo: psicólogo inexistente responde 404", async () => {
  const res = criarRespostaFalsa();
  await telaEditarPsicologo({ params: { id: "5" } }, res, { buscar: async () => null });

  assert.equal(res.statusCode, 404);
});

test("telaEditarPsicologo: caminho feliz renderiza com os dados atuais", async () => {
  const res = criarRespostaFalsa();
  await telaEditarPsicologo({ params: { id: "5" } }, res, { buscar: async () => PSICOLOGO });

  assert.equal(res.viewRenderizada, "psicologos/editar");
  assert.equal(res.dadosDaView.psicologo.id, 5);
});

test("processarEditarPsicologo: nome vazio responde 400 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarEditarPsicologo(
    { params: { id: "5" }, body: { nome: "" } },
    res,
    { buscar: async () => PSICOLOGO, atualizar: async () => { gravou = true; } }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(gravou, false);
});

test("processarEditarPsicologo: psicólogo inexistente responde 404", async () => {
  const res = criarRespostaFalsa();
  await processarEditarPsicologo(
    { params: { id: "5" }, body: { nome: "Novo Nome" } },
    res,
    { buscar: async () => null }
  );

  assert.equal(res.statusCode, 404);
});

test("processarEditarPsicologo: caminho feliz grava e redireciona", async () => {
  const res = criarRespostaFalsa();
  let idAtualizado = null;
  let nomeAtualizado = null;
  await processarEditarPsicologo(
    { params: { id: "5" }, body: { nome: "  Nome Corrigido  " } },
    res,
    {
      buscar: async () => PSICOLOGO,
      atualizar: async (id, nome) => { idAtualizado = id; nomeAtualizado = nome; },
    }
  );

  assert.equal(idAtualizado, 5);
  assert.equal(nomeAtualizado, "Nome Corrigido");
  assert.equal(res.redirectedTo, "/psicologos?sucesso=1");
});

test("processarDesativarPsicologo: psicólogo inexistente responde 404", async () => {
  const res = criarRespostaFalsa();
  await processarDesativarPsicologo({ params: { id: "5" } }, res, { buscar: async () => null });

  assert.equal(res.statusCode, 404);
});

test("processarDesativarPsicologo: caminho feliz define ativo=false e redireciona", async () => {
  const res = criarRespostaFalsa();
  let chamada = null;
  await processarDesativarPsicologo(
    { params: { id: "5" } },
    res,
    { buscar: async () => PSICOLOGO, definirAtivo: async (id, ativo) => { chamada = { id, ativo }; } }
  );

  assert.deepEqual(chamada, { id: 5, ativo: false });
  assert.equal(res.redirectedTo, "/psicologos?sucesso=1");
});

test("processarReativarPsicologo: caminho feliz define ativo=true e redireciona", async () => {
  const res = criarRespostaFalsa();
  let chamada = null;
  await processarReativarPsicologo(
    { params: { id: "5" } },
    res,
    { buscar: async () => PSICOLOGO, definirAtivo: async (id, ativo) => { chamada = { id, ativo }; } }
  );

  assert.deepEqual(chamada, { id: 5, ativo: true });
  assert.equal(res.redirectedTo, "/psicologos?sucesso=1");
});
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `node --test test/psicologoController.test.js`
Expected: FAIL — `src/controllers/psicologoController.js` não existe.

- [ ] **Step 3: Implementar**

```javascript
// src/controllers/psicologoController.js
import {
  listarPsicologos,
  buscarPsicologoPorId,
  criarPsicologo,
  atualizarNomePsicologo,
  definirAtivoPsicologo,
} from "../models/psicologoModel.js";
import { idSeguro } from "../utils/paginacao.js";

export async function telaPsicologos(req, res, { listar = listarPsicologos } = {}) {
  const psicologos = await listar();
  res.render("psicologos/lista", { psicologos, sucesso: req.query.sucesso === "1" });
}

export function telaNovoPsicologo(req, res) {
  res.render("psicologos/novo", { erro: null });
}

export async function processarNovoPsicologo(req, res, { criar = criarPsicologo } = {}) {
  const nome = String(req.body?.nome ?? "").trim();
  if (!nome) return res.status(400).send("Nome inválido.");

  await criar(nome);
  res.redirect("/psicologos?sucesso=1");
}

export async function telaEditarPsicologo(
  req,
  res,
  { buscar = buscarPsicologoPorId } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Psicólogo não encontrado.");

  const psicologo = await buscar(id);
  if (!psicologo) return res.status(404).send("Psicólogo não encontrado.");

  res.render("psicologos/editar", { psicologo, erro: null });
}

export async function processarEditarPsicologo(
  req,
  res,
  { buscar = buscarPsicologoPorId, atualizar = atualizarNomePsicologo } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Psicólogo não encontrado.");

  const nome = String(req.body?.nome ?? "").trim();
  if (!nome) return res.status(400).send("Nome inválido.");

  const psicologo = await buscar(id);
  if (!psicologo) return res.status(404).send("Psicólogo não encontrado.");

  await atualizar(id, nome);
  res.redirect("/psicologos?sucesso=1");
}

export async function processarDesativarPsicologo(
  req,
  res,
  { buscar = buscarPsicologoPorId, definirAtivo = definirAtivoPsicologo } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Psicólogo não encontrado.");

  const psicologo = await buscar(id);
  if (!psicologo) return res.status(404).send("Psicólogo não encontrado.");

  await definirAtivo(id, false);
  res.redirect("/psicologos?sucesso=1");
}

export async function processarReativarPsicologo(
  req,
  res,
  { buscar = buscarPsicologoPorId, definirAtivo = definirAtivoPsicologo } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Psicólogo não encontrado.");

  const psicologo = await buscar(id);
  if (!psicologo) return res.status(404).send("Psicólogo não encontrado.");

  await definirAtivo(id, true);
  res.redirect("/psicologos?sucesso=1");
}
```

- [ ] **Step 4: Rodar os testes**

Run: `node --test test/psicologoController.test.js`
Expected: PASS em todos.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/controllers/psicologoController.js test/psicologoController.test.js
git commit -m "feat: psicologoController — telas de listar/criar/editar/desativar/reativar"
```

---

### Task 4: Rotas novas

**Files:**
- Modify: `src/routes/dashboardRoutes.js`

**Interfaces:**
- Consumes: `telaPsicologos`, `telaNovoPsicologo`, `processarNovoPsicologo`, `telaEditarPsicologo`, `processarEditarPsicologo`, `processarDesativarPsicologo`, `processarReativarPsicologo` (Task 3) de `../controllers/psicologoController.js`.

- [ ] **Step 1: Adicionar o import**

Logo abaixo do import de `usuarioController.js` (linha 13), adicionar:

```javascript
import {
  telaPsicologos,
  telaNovoPsicologo,
  processarNovoPsicologo,
  telaEditarPsicologo,
  processarEditarPsicologo,
  processarDesativarPsicologo,
  processarReativarPsicologo,
} from "../controllers/psicologoController.js";
```

- [ ] **Step 2: Adicionar as rotas**

Logo depois do bloco de rotas `/minha-senha` (linha 79 hoje, `router.post("/minha-senha", ...)`), adicionar:

```javascript
router.get("/psicologos", asyncHandler(exigirLogin), asyncHandler(telaPsicologos));
router.get("/psicologos/novo", asyncHandler(exigirLogin), telaNovoPsicologo);
router.post(
  "/psicologos/novo",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarNovoPsicologo)
);
router.get(
  "/psicologos/:id/editar",
  asyncHandler(exigirLogin),
  asyncHandler(telaEditarPsicologo)
);
router.post(
  "/psicologos/:id/editar",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarEditarPsicologo)
);
router.post(
  "/psicologos/:id/desativar",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarDesativarPsicologo)
);
router.post(
  "/psicologos/:id/reativar",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarReativarPsicologo)
);
```

Note que nenhuma dessas rotas usa `exigirPapel("administradora")` — diferente de `/usuarios` — porque qualquer usuário logado pode mexer nesse cadastro.

- [ ] **Step 3: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/routes/dashboardRoutes.js
git commit -m "feat: rotas de cadastro de psicólogos"
```

---

### Task 5: Views — lista, formulários e item de menu

**Files:**
- Create: `src/views/psicologos/lista.ejs`
- Create: `src/views/psicologos/novo.ejs`
- Create: `src/views/psicologos/editar.ejs`
- Modify: `src/views/partials/header.ejs`
- Test: `test/psicologosView.test.js` (novo)

**Interfaces:**
- Consumes: `psicologos` (array), `sucesso` (bool) — de `telaPsicologos`; `psicologo`, `erro` — de `telaEditarPsicologo`/`telaNovoPsicologo`. `csrfToken`, `usuarioAtual`, `caminhoAtual` já chegam via `res.locals` (middleware `exigirLogin`, ver `src/middleware/dashboardAuth.js`), não precisam ser passados explicitamente pelo controller.

- [ ] **Step 1: Escrever os testes de view**

```javascript
// test/psicologosView.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.join(__dirname, "..", "src", "views");

const ADMINISTRADORA = { id: 1, nome: "Ana", papel: "administradora" };

function renderizarLista(dados) {
  const caminho = path.join(VIEWS_DIR, "psicologos", "lista.ejs");
  return ejs.renderFile(caminho, {
    psicologos: [],
    sucesso: false,
    titulo: "Psicólogos",
    caminhoAtual: "/psicologos",
    csrfToken: "token-fake",
    usuarioAtual: ADMINISTRADORA,
    ...dados,
  });
}

function renderizarNovo(dados) {
  const caminho = path.join(VIEWS_DIR, "psicologos", "novo.ejs");
  return ejs.renderFile(caminho, {
    erro: null,
    titulo: "Novo psicólogo",
    caminhoAtual: "/psicologos/novo",
    csrfToken: "token-fake",
    usuarioAtual: ADMINISTRADORA,
    ...dados,
  });
}

function renderizarEditar(dados) {
  const caminho = path.join(VIEWS_DIR, "psicologos", "editar.ejs");
  return ejs.renderFile(caminho, {
    psicologo: { id: 5, nome: "Ana", ativo: true },
    erro: null,
    titulo: "Editar psicólogo",
    caminhoAtual: "/psicologos/5/editar",
    csrfToken: "token-fake",
    usuarioAtual: ADMINISTRADORA,
    ...dados,
  });
}

test("psicologos/lista: vazia mostra a tabela sem quebrar", async () => {
  const html = await renderizarLista({ psicologos: [] });

  assert.match(html, /class="[^"]*data-table/);
  assert.match(html, /href="\/psicologos\/novo"/);
});

test("psicologos/lista: mostra nome e badge Ativo/Inativo por linha", async () => {
  const html = await renderizarLista({
    psicologos: [
      { id: 1, nome: "Ana Ativa", ativo: true },
      { id: 2, nome: "Bia Inativa", ativo: false },
    ],
  });

  assert.match(html, /Ana Ativa/);
  assert.match(html, /Bia Inativa/);
  assert.match(html, /badge is-success">\s*Ativo/);
  assert.match(html, /badge is-danger">\s*Inativo/);
});

test("psicologos/lista: linha ativa mostra ação Desativar, não Reativar", async () => {
  const html = await renderizarLista({
    psicologos: [{ id: 1, nome: "Ana", ativo: true }],
  });

  assert.match(html, /action="\/psicologos\/1\/desativar"/);
  assert.doesNotMatch(html, /\/reativar/);
});

test("psicologos/lista: linha inativa mostra ação Reativar, não Desativar", async () => {
  const html = await renderizarLista({
    psicologos: [{ id: 1, nome: "Ana", ativo: false }],
  });

  assert.match(html, /action="\/psicologos\/1\/reativar"/);
  assert.doesNotMatch(html, /\/desativar/);
});

test("psicologos/lista: link de editar aponta pro id certo", async () => {
  const html = await renderizarLista({
    psicologos: [{ id: 7, nome: "Caio", ativo: true }],
  });

  assert.match(html, /href="\/psicologos\/7\/editar"/);
});

test("psicologos/novo: formulário tem campo nome e csrf", async () => {
  const html = await renderizarNovo({});

  assert.match(html, /name="nome"/);
  assert.match(html, /name="_csrf" value="token-fake"/);
});

test("psicologos/novo: mostra mensagem de erro quando presente", async () => {
  const html = await renderizarNovo({ erro: "Nome inválido." });

  assert.match(html, /Nome inválido\./);
});

test("psicologos/editar: formulário pré-preenchido com o nome atual", async () => {
  const html = await renderizarEditar({ psicologo: { id: 5, nome: "Ana Preenchida", ativo: true } });

  assert.match(html, /name="nome"[^>]*value="Ana Preenchida"/);
});
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `node --test test/psicologosView.test.js`
Expected: FAIL — as views ainda não existem.

- [ ] **Step 3: Criar `lista.ejs`**

```html
<!-- src/views/psicologos/lista.ejs -->
<%- include("../partials/header", { titulo: "Psicólogos" }) %>
<section class="user-list">
  <header class="page-header">
    <div>
      <h1>Psicólogos</h1>
      <p class="patient-list-summary">Cadastro dos psicólogos da clínica.</p>
    </div>
    <a class="button" href="/psicologos/novo">Novo psicólogo</a>
  </header>
  <% if (sucesso) { %>
  <p class="sucesso">Alteração salva com sucesso.</p>
  <% } %>
  <div class="panel user-list-panel">
    <div class="patient-table-wrap">
      <table class="data-table">
        <thead>
          <tr><th>Nome</th><th>Status</th><th>Ações</th></tr>
        </thead>
        <tbody>
          <% for (const psicologo of psicologos) { %>
          <tr>
            <td><%= psicologo.nome %></td>
            <td><span class="badge <%= psicologo.ativo ? 'is-success' : 'is-danger' %>"><%= psicologo.ativo ? "Ativo" : "Inativo" %></span></td>
            <td>
              <div class="user-row-actions">
                <a class="button button--quiet" href="/psicologos/<%= psicologo.id %>/editar">Editar</a>
                <% if (psicologo.ativo) { %>
                <form method="post" action="/psicologos/<%= psicologo.id %>/desativar">
                  <input type="hidden" name="_csrf" value="<%= csrfToken %>" />
                  <button class="button is-danger" type="submit">Desativar</button>
                </form>
                <% } else { %>
                <form method="post" action="/psicologos/<%= psicologo.id %>/reativar">
                  <input type="hidden" name="_csrf" value="<%= csrfToken %>" />
                  <button class="button" type="submit">Reativar</button>
                </form>
                <% } %>
              </div>
            </td>
          </tr>
          <% } %>
        </tbody>
      </table>
    </div>
  </div>
</section>
<%- include("../partials/footer") %>
```

- [ ] **Step 4: Criar `novo.ejs`**

```html
<!-- src/views/psicologos/novo.ejs -->
<%- include("../partials/header", { titulo: "Novo psicólogo" }) %>
<header class="page-header">
  <div>
    <h1>Novo psicólogo</h1>
    <p>Cadastre um psicólogo da clínica.</p>
  </div>
  <a class="button button--quiet" href="/psicologos">Voltar</a>
</header>

<form class="focused-form" method="post" action="/psicologos/novo">
  <input type="hidden" name="_csrf" value="<%= csrfToken %>" />
  <% if (erro) { %>
  <p class="erro"><%= erro %></p>
  <% } %>
  <div class="form-grid">
    <label>Nome<input type="text" name="nome" required /></label>
  </div>
  <div class="toolbar">
    <button type="submit">Criar</button>
  </div>
</form>
<%- include("../partials/footer") %>
```

- [ ] **Step 5: Criar `editar.ejs`**

```html
<!-- src/views/psicologos/editar.ejs -->
<%- include("../partials/header", { titulo: "Editar psicólogo" }) %>
<header class="page-header">
  <div>
    <h1>Editar psicólogo</h1>
    <p>Corrija o nome cadastrado.</p>
  </div>
  <a class="button button--quiet" href="/psicologos">Voltar</a>
</header>

<form class="focused-form" method="post" action="/psicologos/<%= psicologo.id %>/editar">
  <input type="hidden" name="_csrf" value="<%= csrfToken %>" />
  <% if (erro) { %>
  <p class="erro"><%= erro %></p>
  <% } %>
  <div class="form-grid">
    <label>Nome<input type="text" name="nome" value="<%= psicologo.nome %>" required /></label>
  </div>
  <div class="toolbar">
    <button type="submit">Salvar</button>
  </div>
</form>
<%- include("../partials/footer") %>
```

- [ ] **Step 6: Adicionar item "Psicólogos" no menu**

Em `src/views/partials/header.ejs`, logo depois do link de "Financeiro" (linha 29: `<a class="sidebar-link<%= ativo('/financeiro') ? ...`) e antes do bloco `<% if (usuarioAtual.papel === "administradora") { %>` que envolve "Usuários" (linha 30), adicionar:

```html
<a class="sidebar-link<%= ativo('/psicologos') ? ' is-active' : '' %>" href="/psicologos"<% if (ativo('/psicologos')) { %> aria-current="page"<% } %>>Psicólogos</a>
```

Fora do bloco condicional de `administradora` — visível pra qualquer usuário logado.

- [ ] **Step 7: Rodar os testes**

Run: `node --test test/psicologosView.test.js`
Expected: PASS em todos.

- [ ] **Step 8: Verificar sintaxe EJS das views novas**

Run:
```bash
node -e "require('ejs').compile(require('fs').readFileSync('src/views/psicologos/lista.ejs','utf8'))"
node -e "require('ejs').compile(require('fs').readFileSync('src/views/psicologos/novo.ejs','utf8'))"
node -e "require('ejs').compile(require('fs').readFileSync('src/views/psicologos/editar.ejs','utf8'))"
```
Expected: sem erro em nenhum dos três.

- [ ] **Step 9: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS — conferir também que testes de layout existentes (`test/dashboardLayoutViews.test.js`) continuam passando, já que `header.ejs` foi modificado.

- [ ] **Step 10: Commit**

```bash
git add src/views/psicologos/lista.ejs src/views/psicologos/novo.ejs src/views/psicologos/editar.ejs src/views/partials/header.ejs test/psicologosView.test.js
git commit -m "feat: views de cadastro de psicólogos e item no menu"
```

---

### Task 6: Verificação manual (dev, não produção)

**Files:** nenhum (só verificação).

- [ ] **Step 1: Rodar a migration 024 no banco de dev**

Mesmo processo usado pras migrations anteriores nesta sessão: aplicar o SQL de `024_psicologos.sql` contra o banco de dev (confirmar antes que é dev, não produção).

- [ ] **Step 2: Subir o servidor local**

Run: `node server.js`.

- [ ] **Step 3: Exercitar o fluxo pelo navegador**

- Logar com um usuário de teste (recepção ou administradora, tanto faz — não há restrição de papel nesta feature).
- Abrir "Psicólogos" no menu lateral — lista vazia.
- Clicar em "Novo psicólogo", cadastrar um nome de teste (ex: "Psicólogo Teste") — confirmar que volta pra lista com "Ativo".
- Clicar em "Editar", corrigir o nome — confirmar que salva.
- Clicar em "Desativar" — confirmar que vira "Inativo" e o botão vira "Reativar".
- Clicar em "Reativar" — confirmar que volta a "Ativo".
- **Limpeza:** apagar esse psicólogo de teste do banco de dev ao final (`DELETE FROM psicologos WHERE nome = 'Psicólogo Teste'`), já que não existe exclusão pela UI.

- [ ] **Step 4: Rodar a suíte inteira uma última vez**

Run: `npm test`
Expected: PASS — todos os testes (560 originais desta sessão + os novos desta feature).

- [ ] **Step 5: Derrubar o servidor local**

Encerrar o processo `node server.js` iniciado no Step 2.

---

## Self-Review

**Cobertura da spec:** migration com `nome`/`ativo`/`created_at` — Task 1. Model com as 5 funções especificadas — Task 2. Controller com as 7 rotas especificadas, permissão "qualquer usuário logado" (sem `exigirPapel`) — Tasks 3-4. Views + item de menu fora do bloco de administradora — Task 5. Nenhuma ligação com agendamento (Fase 2, fora de escopo) — nenhuma tarefa toca `agendamentoModel.js`/`agendamentos`. Sem exclusão definitiva — só `definirAtivoPsicologo`, nunca um `DELETE` no model (exceto o de limpeza manual da Task 6, que é só dado de teste).

**Consistência de tipos/nomes:** `criarPsicologo(nome)` (Task 2) é chamado por `processarNovoPsicologo` (Task 3) com o mesmo formato (string simples, não objeto) — confirmado contra a assinatura exata do Task 2. `atualizarNomePsicologo(id, nome)` e `definirAtivoPsicologo(id, ativo)` (Task 2) usados com a mesma ordem de parâmetros em `processarEditarPsicologo`/`processarDesativarPsicologo`/`processarReativarPsicologo` (Task 3). Rotas (Task 4) importam exatamente os 7 nomes exportados pelo controller (Task 3).

**Nota de implementação:** diferente de `/usuarios`, nenhuma rota desta feature usa `exigirPapel("administradora")` — decisão explícita do usuário durante o brainstorm, registrada na spec.
