# CRUD da base de conhecimento no dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao dashboard uma tela de gestão completa (listar, criar, editar, desativar/reativar) das entradas da `base_conhecimento` — hoje só existe `INSERT` via `curl` (`POST /admin/base-conhecimento`).

**Architecture:** Segue exatamente o padrão já usado por `convenios` (mesmo CRUD-shape: lista com filtro "mostrar inativos", criar, editar, soft-delete via `ativo`): um controller próprio (`baseConhecimentoController.js`), rotas dedicadas em `dashboardRoutes.js` atrás de `exigirLogin` + `exigirPapel("administradora")`, e três views EJS (`lista`, `novo`, `editar`). O model ganha as funções de leitura/atualização/soft-delete que faltavam; a busca do bot (`buscarNaBaseConhecimento`) passa a filtrar `ativo = true`.

**Tech Stack:** Node.js/Express, `pg` (Postgres/Neon) via `pool.query`, EJS server-side views, `node --test` + `node:assert/strict` para testes (sem Postgres real — `pool.query` é mockado com `t.mock.method`).

**Spec:** Não há um arquivo de spec separado — o design foi aprovado em conversa (via superpowers:brainstorming, path "bounded") em 2026-09-07. Resumo do design aprovado:
- Só `administradora` gerencia (papel único de acesso).
- Soft-delete via nova coluna `ativo BOOLEAN NOT NULL DEFAULT true` (sem `DELETE` de verdade).
- Categoria vira dropdown de lista fixa na UI (constante em código), mas continua `TEXT` no banco — sem enum/migration de tipo.
- Fora do escopo: busca semântica/embeddings, versionamento/histórico de mudanças, índice trigram.

## Global Constraints

- Migration nova (`034_base_conhecimento_gestao.sql`) fica pronta mas **não é aplicada automaticamente** — mesmo padrão de todos os subprojetos anteriores (sem banco de dev separado do de produção; precisa confirmação explícita do usuário antes de rodar no Neon).
- `POST /admin/base-conhecimento` (rota autenticada por API key, usada hoje via `curl`) **não pode quebrar** — continua existindo, sem mudança de contrato.
- `buscarNaBaseConhecimento` (usada pela function calling do bot, `consultar_base_conhecimento`) precisa ignorar entradas com `ativo = false` — uma resposta desativada nunca pode voltar pro paciente.
- Acesso restrito a `papel === "administradora"`, mesmo padrão de `/usuarios` e `/configuracoes/prestador`.
- TDD: escrever o teste falhando antes de cada implementação, `pool.query`/model mockados via injeção de dependência (mesmo padrão de `convenioController.js`/`convenioModel.test.js`), sem Postgres real em nenhum teste.
- Toda rota de mutação (`POST`) passa por `exigirCsrf`; toda rota (`GET`/`POST`) passa por `exigirLogin` e `exigirPapel("administradora")`.

---

## Task 1: Migration — colunas `ativo` e `updated_at`

**Files:**
- Create: `src/db/migrations/034_base_conhecimento_gestao.sql`

**Interfaces:**
- Produces: colunas `base_conhecimento.ativo` (boolean, default `true`) e `base_conhecimento.updated_at` (timestamptz, default `now()`), consumidas por todas as tasks seguintes.

- [ ] **Step 1: Escrever a migration**

```sql
-- src/db/migrations/034_base_conhecimento_gestao.sql
-- Clínica Exemplo Bot — migration 034: gestão da base de conhecimento no dashboard
--
-- A base de conhecimento (respostas do bot pra FAQs) só tinha INSERT via
-- curl (POST /admin/base-conhecimento). Essas colunas dão suporte a
-- soft-delete (desativar sem apagar, reversível) e a saber quando uma
-- resposta foi corrigida pela última vez — ver
-- docs/superpowers/plans/2026-09-07-crud-base-conhecimento-dashboard.md.

ALTER TABLE base_conhecimento
  ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
```

- [ ] **Step 2: Não aplicar ainda**

Não rode esta migration contra o banco de produção (Neon) nesta task — ela só fica pronta no repositório. A aplicação depende de confirmação explícita do usuário (ver Global Constraints). As tasks seguintes usam mocks de `pool.query`, então não dependem da migration estar aplicada para os testes passarem.

- [ ] **Step 3: Commit**

```bash
git add src/db/migrations/034_base_conhecimento_gestao.sql
git commit -m "feat: adiciona colunas ativo/updated_at em base_conhecimento (migration, não aplicada)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Model — funções de leitura, atualização e soft-delete

**Files:**
- Modify: `src/models/baseConhecimentoModel.js`
- Test: `test/baseConhecimentoModel.test.js` (novo arquivo — o teste existente, `test/baseConhecimento.test.js`, cobre só `extrairPalavrasChave` e não deve ser tocado)

**Interfaces:**
- Consumes: `pool` de `../db/pool.js` (já importado no arquivo).
- Produces (usadas pelo controller na Task 3):
  - `listarBaseConhecimento({ apenasAtivos = true } = {})` → `Promise<Array<{id, pergunta, resposta, categoria, ativo, created_at, updated_at}>>`, ordenado por `created_at DESC`.
  - `buscarEntradaBaseConhecimentoPorId(id)` → `Promise<{id, pergunta, resposta, categoria, ativo, created_at, updated_at} | null>`.
  - `atualizarEntradaBaseConhecimento(id, { pergunta, resposta, categoria })` → `Promise<{...} | null>`, atualiza também `updated_at = now()`.
  - `definirAtivoEntradaBaseConhecimento(id, ativo)` → `Promise<{id, ativo} | null>`.
- Modifies: `buscarNaBaseConhecimento` (já existente) passa a filtrar `ativo = true`.

- [ ] **Step 1: Escrever os testes falhando**

Criar `test/baseConhecimentoModel.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import {
  buscarNaBaseConhecimento,
  listarBaseConhecimento,
  buscarEntradaBaseConhecimentoPorId,
  atualizarEntradaBaseConhecimento,
  definirAtivoEntradaBaseConhecimento,
} from "../src/models/baseConhecimentoModel.js";

function mockarQuery(t, linhas = []) {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: linhas };
  });
  return consultas;
}

test("buscarNaBaseConhecimento só busca entradas ativas", async (t) => {
  const consultas = mockarQuery(t, [{ id: 1, pergunta: "p", resposta: "r", categoria: "geral" }]);

  await buscarNaBaseConhecimento("qual o horario");

  assert.match(consultas[0].sql, /WHERE ativo = true AND \(/i);
});

test("listarBaseConhecimento por padrão só busca ativos, mais recentes primeiro", async (t) => {
  const consultas = mockarQuery(t, [{ id: 1, pergunta: "p", resposta: "r", ativo: true }]);

  const resultado = await listarBaseConhecimento();

  assert.match(consultas[0].sql, /WHERE ativo = true/i);
  assert.match(consultas[0].sql, /ORDER BY created_at DESC/i);
  assert.equal(resultado.length, 1);
});

test("listarBaseConhecimento({ apenasAtivos: false }) busca todos, sem filtro de ativo", async (t) => {
  const consultas = mockarQuery(t, [
    { id: 1, pergunta: "p1", ativo: true },
    { id: 2, pergunta: "p2", ativo: false },
  ]);

  const resultado = await listarBaseConhecimento({ apenasAtivos: false });

  assert.doesNotMatch(consultas[0].sql, /WHERE ativo/i);
  assert.equal(resultado.length, 2);
});

test("buscarEntradaBaseConhecimentoPorId retorna null quando não existe", async (t) => {
  mockarQuery(t, []);

  const resultado = await buscarEntradaBaseConhecimentoPorId(999);

  assert.equal(resultado, null);
});

test("buscarEntradaBaseConhecimentoPorId consulta pelo id informado", async (t) => {
  const consultas = mockarQuery(t, [{ id: 5, pergunta: "p", resposta: "r", ativo: true }]);

  const resultado = await buscarEntradaBaseConhecimentoPorId(5);

  assert.deepEqual(consultas[0].params, [5]);
  assert.equal(resultado.id, 5);
});

test("atualizarEntradaBaseConhecimento atualiza pergunta/resposta/categoria e updated_at", async (t) => {
  const consultas = mockarQuery(t, [{ id: 5, pergunta: "nova", resposta: "nova resp", categoria: "geral" }]);

  const resultado = await atualizarEntradaBaseConhecimento(5, {
    pergunta: "nova",
    resposta: "nova resp",
    categoria: "geral",
  });

  assert.match(consultas[0].sql, /SET pergunta = \$2, resposta = \$3, categoria = \$4, updated_at = now\(\)/i);
  assert.deepEqual(consultas[0].params, [5, "nova", "nova resp", "geral"]);
  assert.equal(resultado.pergunta, "nova");
});

test("atualizarEntradaBaseConhecimento retorna null quando o id não existe", async (t) => {
  mockarQuery(t, []);

  const resultado = await atualizarEntradaBaseConhecimento(999, {
    pergunta: "x",
    resposta: "y",
    categoria: null,
  });

  assert.equal(resultado, null);
});

test("definirAtivoEntradaBaseConhecimento(id, false) desativa", async (t) => {
  const consultas = mockarQuery(t, [{ id: 5, ativo: false }]);

  const resultado = await definirAtivoEntradaBaseConhecimento(5, false);

  assert.match(consultas[0].sql, /SET ativo = \$2/i);
  assert.deepEqual(consultas[0].params, [5, false]);
  assert.equal(resultado.ativo, false);
});

test("definirAtivoEntradaBaseConhecimento retorna null quando o id não existe", async (t) => {
  mockarQuery(t, []);

  const resultado = await definirAtivoEntradaBaseConhecimento(999, true);

  assert.equal(resultado, null);
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test test/baseConhecimentoModel.test.js`
Expected: FAIL — `listarBaseConhecimento`, `buscarEntradaBaseConhecimentoPorId`, `atualizarEntradaBaseConhecimento` e `definirAtivoEntradaBaseConhecimento` não existem ainda, e o filtro `ativo = true` não está em `buscarNaBaseConhecimento`.

- [ ] **Step 3: Implementar no model**

Editar `src/models/baseConhecimentoModel.js`:

Substituir a query de `buscarNaBaseConhecimento`:

```javascript
export async function buscarNaBaseConhecimento(pergunta, limite = 3) {
  const palavras = extrairPalavrasChave(pergunta);
  const patterns = palavras.map((p) => `%${escaparCuringasLike(p)}%`);

  const { rows } = await pool.query(
    `SELECT id, pergunta, resposta, categoria
     FROM base_conhecimento
     WHERE ativo = true AND (pergunta ILIKE ANY($1) OR resposta ILIKE ANY($1) OR categoria ILIKE ANY($1))
     LIMIT $2`,
    [patterns, limite]
  );
  return rows;
}
```

Adicionar, depois de `inserirEntradaBaseConhecimento`:

```javascript
export async function listarBaseConhecimento({ apenasAtivos = true } = {}) {
  const filtro = apenasAtivos ? "WHERE ativo = true " : "";
  const { rows } = await pool.query(
    `SELECT id, pergunta, resposta, categoria, ativo, created_at, updated_at
     FROM base_conhecimento ${filtro}ORDER BY created_at DESC`
  );
  return rows;
}

export async function buscarEntradaBaseConhecimentoPorId(id) {
  const { rows } = await pool.query(
    `SELECT id, pergunta, resposta, categoria, ativo, created_at, updated_at
     FROM base_conhecimento WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function atualizarEntradaBaseConhecimento(id, { pergunta, resposta, categoria }) {
  const { rows } = await pool.query(
    `UPDATE base_conhecimento
     SET pergunta = $2, resposta = $3, categoria = $4, updated_at = now()
     WHERE id = $1
     RETURNING id, pergunta, resposta, categoria, ativo, created_at, updated_at`,
    [id, pergunta, resposta, categoria ?? null]
  );
  return rows[0] ?? null;
}

export async function definirAtivoEntradaBaseConhecimento(id, ativo) {
  const { rows } = await pool.query(
    "UPDATE base_conhecimento SET ativo = $2 WHERE id = $1 RETURNING id, ativo",
    [id, ativo]
  );
  return rows[0] ?? null;
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test test/baseConhecimentoModel.test.js test/baseConhecimento.test.js`
Expected: PASS (todos, incluindo o teste antigo que não foi tocado).

- [ ] **Step 5: Rodar a suíte inteira pra garantir que nada mais quebrou**

Run: `node --test`
Expected: PASS (a mudança em `buscarNaBaseConhecimento` é a única alteração de comportamento visível fora deste arquivo — confirme que nenhum outro teste dependia do SQL antigo, ex. `test/consultarBaseConhecimento.test.js` se existir).

- [ ] **Step 6: Commit**

```bash
git add src/models/baseConhecimentoModel.js test/baseConhecimentoModel.test.js
git commit -m "feat: adiciona listar/buscar-por-id/atualizar/desativar em baseConhecimentoModel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Constante de categorias fixas

**Files:**
- Create: `src/constants/categoriasBaseConhecimento.js`
- Test: `test/categoriasBaseConhecimento.test.js`

**Interfaces:**
- Produces: `CATEGORIAS_BASE_CONHECIMENTO` — `Array<{ valor: string, rotulo: string }>`, consumida pelas views (`novo.ejs`/`editar.ejs`) da Task 5 pra montar o `<select>`.

- [ ] **Step 1: Escrever o teste falhando**

```javascript
// test/categoriasBaseConhecimento.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { CATEGORIAS_BASE_CONHECIMENTO } from "../src/constants/categoriasBaseConhecimento.js";

test("CATEGORIAS_BASE_CONHECIMENTO tem valor e rótulo únicos", () => {
  assert.ok(Array.isArray(CATEGORIAS_BASE_CONHECIMENTO));
  assert.ok(CATEGORIAS_BASE_CONHECIMENTO.length >= 8);

  const valores = CATEGORIAS_BASE_CONHECIMENTO.map((c) => c.valor);
  assert.equal(new Set(valores).size, valores.length, "valores não podem se repetir");

  for (const categoria of CATEGORIAS_BASE_CONHECIMENTO) {
    assert.equal(typeof categoria.valor, "string");
    assert.equal(typeof categoria.rotulo, "string");
    assert.ok(categoria.valor.length > 0);
    assert.ok(categoria.rotulo.length > 0);
  }
});

test("CATEGORIAS_BASE_CONHECIMENTO inclui 'geral' como opção coringa", () => {
  assert.ok(CATEGORIAS_BASE_CONHECIMENTO.some((c) => c.valor === "geral"));
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/categoriasBaseConhecimento.test.js`
Expected: FAIL — o módulo `src/constants/categoriasBaseConhecimento.js` não existe.

- [ ] **Step 3: Implementar**

```javascript
// src/constants/categoriasBaseConhecimento.js
// Lista fixa usada só na UI (dropdown de criar/editar) — o banco continua
// aceitando qualquer TEXT em base_conhecimento.categoria, sem enum, então
// entradas antigas fora desta lista continuam válidas e aparecem como
// "Categoria (livre)" na tela de edição em vez de sumir.
export const CATEGORIAS_BASE_CONHECIMENTO = [
  { valor: "horarios", rotulo: "Horários" },
  { valor: "convenios", rotulo: "Convênios" },
  { valor: "precos", rotulo: "Preços" },
  { valor: "localizacao", rotulo: "Localização" },
  { valor: "politicas", rotulo: "Políticas" },
  { valor: "fisioterapia", rotulo: "Fisioterapia" },
  { valor: "psicologia", rotulo: "Psicologia" },
  { valor: "geral", rotulo: "Geral" },
];
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/categoriasBaseConhecimento.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/constants/categoriasBaseConhecimento.js test/categoriasBaseConhecimento.test.js
git commit -m "feat: adiciona lista fixa de categorias da base de conhecimento

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Controller — `baseConhecimentoController.js`

**Files:**
- Create: `src/controllers/baseConhecimentoController.js`
- Test: `test/baseConhecimentoController.test.js`

**Interfaces:**
- Consumes: de `../models/baseConhecimentoModel.js` — `listarBaseConhecimento`, `buscarEntradaBaseConhecimentoPorId`, `inserirEntradaBaseConhecimento`, `atualizarEntradaBaseConhecimento`, `definirAtivoEntradaBaseConhecimento` (todas da Task 2, exceto `inserirEntradaBaseConhecimento` que já existia); `idSeguro` de `../utils/paginacao.js`; `CATEGORIAS_BASE_CONHECIMENTO` de `../constants/categoriasBaseConhecimento.js` (Task 3).
- Produces (usadas pelas rotas na Task 5): `telaBaseConhecimento`, `telaNovaEntradaBaseConhecimento`, `processarNovaEntradaBaseConhecimento`, `telaEditarEntradaBaseConhecimento`, `processarEditarEntradaBaseConhecimento`, `processarDesativarEntradaBaseConhecimento`, `processarReativarEntradaBaseConhecimento` — todas `(req, res, overrides = {})`, mesmo padrão de injeção de dependência de `convenioController.js`.

- [ ] **Step 1: Escrever os testes falhando**

Criar `test/baseConhecimentoController.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  telaBaseConhecimento,
  telaNovaEntradaBaseConhecimento,
  processarNovaEntradaBaseConhecimento,
  telaEditarEntradaBaseConhecimento,
  processarEditarEntradaBaseConhecimento,
  processarDesativarEntradaBaseConhecimento,
  processarReativarEntradaBaseConhecimento,
} from "../src/controllers/baseConhecimentoController.js";

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

const ENTRADA = { id: 5, pergunta: "Vocês têm estacionamento?", resposta: "Sim.", categoria: "localizacao", ativo: true };

test("telaBaseConhecimento: renderiza a lista", async () => {
  const res = criarRespostaFalsa();
  await telaBaseConhecimento({ query: {} }, res, { listar: async () => [ENTRADA] });

  assert.equal(res.viewRenderizada, "baseConhecimento/lista");
  assert.deepEqual(res.dadosDaView.entradas, [ENTRADA]);
  assert.equal(res.dadosDaView.sucesso, false);
});

test("telaBaseConhecimento: sem ?todos, busca só ativos e mostrarTodos é false", async () => {
  const res = criarRespostaFalsa();
  let argumentoRecebido = "não chamado";
  await telaBaseConhecimento(
    { query: {} },
    res,
    { listar: async (opcoes) => { argumentoRecebido = opcoes; return []; } }
  );

  assert.deepEqual(argumentoRecebido, { apenasAtivos: true });
  assert.equal(res.dadosDaView.mostrarTodos, false);
});

test("telaBaseConhecimento: com ?todos=1, busca todos e mostrarTodos é true", async () => {
  const res = criarRespostaFalsa();
  let argumentoRecebido = "não chamado";
  await telaBaseConhecimento(
    { query: { todos: "1" } },
    res,
    { listar: async (opcoes) => { argumentoRecebido = opcoes; return []; } }
  );

  assert.deepEqual(argumentoRecebido, { apenasAtivos: false });
  assert.equal(res.dadosDaView.mostrarTodos, true);
});

test("telaNovaEntradaBaseConhecimento: renderiza o formulário com as categorias fixas", () => {
  const res = criarRespostaFalsa();
  telaNovaEntradaBaseConhecimento({}, res);

  assert.equal(res.viewRenderizada, "baseConhecimento/novo");
  assert.ok(res.dadosDaView.categorias.some((c) => c.valor === "geral"));
});

test("processarNovaEntradaBaseConhecimento: pergunta vazia responde 400 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarNovaEntradaBaseConhecimento(
    { body: { pergunta: "   ", resposta: "Sim" } },
    res,
    { criar: async () => { gravou = true; } }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(gravou, false);
});

test("processarNovaEntradaBaseConhecimento: resposta vazia responde 400 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarNovaEntradaBaseConhecimento(
    { body: { pergunta: "Tem estacionamento?", resposta: "  " } },
    res,
    { criar: async () => { gravou = true; } }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(gravou, false);
});

test("processarNovaEntradaBaseConhecimento: grava e redireciona com sucesso", async () => {
  const res = criarRespostaFalsa();
  let dadosGravados = null;
  await processarNovaEntradaBaseConhecimento(
    { body: { pergunta: "Tem estacionamento?", resposta: "Sim.", categoria: "localizacao" } },
    res,
    { criar: async (dados) => { dadosGravados = dados; return { id: 1, ...dados }; } }
  );

  assert.deepEqual(dadosGravados, {
    pergunta: "Tem estacionamento?",
    resposta: "Sim.",
    categoria: "localizacao",
  });
  assert.equal(res.redirectedTo, "/base-conhecimento?sucesso=1");
});

test("telaEditarEntradaBaseConhecimento: 404 quando a entrada não existe", async () => {
  const res = criarRespostaFalsa();
  await telaEditarEntradaBaseConhecimento(
    { params: { id: "999" }, query: {} },
    res,
    { buscar: async () => null }
  );

  assert.equal(res.statusCode, 404);
});

test("telaEditarEntradaBaseConhecimento: renderiza o formulário preenchido", async () => {
  const res = criarRespostaFalsa();
  await telaEditarEntradaBaseConhecimento(
    { params: { id: "5" }, query: {} },
    res,
    { buscar: async () => ENTRADA }
  );

  assert.equal(res.viewRenderizada, "baseConhecimento/editar");
  assert.deepEqual(res.dadosDaView.entrada, ENTRADA);
});

test("processarEditarEntradaBaseConhecimento: pergunta vazia responde 400 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let atualizou = false;
  await processarEditarEntradaBaseConhecimento(
    { params: { id: "5" }, body: { pergunta: "  ", resposta: "Sim" } },
    res,
    { buscar: async () => ENTRADA, atualizar: async () => { atualizou = true; } }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(atualizou, false);
});

test("processarEditarEntradaBaseConhecimento: 404 quando a entrada não existe", async () => {
  const res = criarRespostaFalsa();
  await processarEditarEntradaBaseConhecimento(
    { params: { id: "999" }, body: { pergunta: "P", resposta: "R" } },
    res,
    { buscar: async () => null }
  );

  assert.equal(res.statusCode, 404);
});

test("processarEditarEntradaBaseConhecimento: atualiza e redireciona preservando ?todos=1", async () => {
  const res = criarRespostaFalsa();
  let idAtualizado = null;
  let dadosAtualizados = null;
  await processarEditarEntradaBaseConhecimento(
    { params: { id: "5" }, body: { pergunta: "Nova pergunta", resposta: "Nova resposta", categoria: "geral", todos: "1" } },
    res,
    {
      buscar: async () => ENTRADA,
      atualizar: async (id, dados) => { idAtualizado = id; dadosAtualizados = dados; return { ...ENTRADA, ...dados }; },
    }
  );

  assert.equal(idAtualizado, 5);
  assert.deepEqual(dadosAtualizados, { pergunta: "Nova pergunta", resposta: "Nova resposta", categoria: "geral" });
  assert.equal(res.redirectedTo, "/base-conhecimento?sucesso=1&todos=1");
});

test("processarDesativarEntradaBaseConhecimento: 404 quando a entrada não existe", async () => {
  const res = criarRespostaFalsa();
  await processarDesativarEntradaBaseConhecimento(
    { params: { id: "999" }, body: {} },
    res,
    { buscar: async () => null }
  );

  assert.equal(res.statusCode, 404);
});

test("processarDesativarEntradaBaseConhecimento: desativa e redireciona", async () => {
  const res = criarRespostaFalsa();
  let idDesativado = null;
  await processarDesativarEntradaBaseConhecimento(
    { params: { id: "5" }, body: {} },
    res,
    {
      buscar: async () => ENTRADA,
      definirAtivo: async (id) => { idDesativado = id; return { id, ativo: false }; },
    }
  );

  assert.equal(idDesativado, 5);
  assert.equal(res.redirectedTo, "/base-conhecimento?sucesso=1");
});

test("processarReativarEntradaBaseConhecimento: reativa e redireciona", async () => {
  const res = criarRespostaFalsa();
  let ativoDefinido = null;
  await processarReativarEntradaBaseConhecimento(
    { params: { id: "5" }, body: {} },
    res,
    {
      buscar: async () => ({ ...ENTRADA, ativo: false }),
      definirAtivo: async (id, ativo) => { ativoDefinido = ativo; return { id, ativo }; },
    }
  );

  assert.equal(ativoDefinido, true);
  assert.equal(res.redirectedTo, "/base-conhecimento?sucesso=1");
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/baseConhecimentoController.test.js`
Expected: FAIL — `src/controllers/baseConhecimentoController.js` não existe.

- [ ] **Step 3: Implementar o controller**

```javascript
// src/controllers/baseConhecimentoController.js
import {
  listarBaseConhecimento,
  buscarEntradaBaseConhecimentoPorId,
  inserirEntradaBaseConhecimento,
  atualizarEntradaBaseConhecimento as atualizarEntradaModel,
  definirAtivoEntradaBaseConhecimento,
} from "../models/baseConhecimentoModel.js";
import { CATEGORIAS_BASE_CONHECIMENTO } from "../constants/categoriasBaseConhecimento.js";
import { idSeguro } from "../utils/paginacao.js";

/**
 * Preserva o filtro "mostrar inativos" no redirect pós-ação, senão
 * desativar/reativar/editar a partir da visão de inativos sempre bate de
 * volta na lista só-ativos. Mesmo padrão de convenioController.js.
 */
function sufixoTodos(req) {
  return req.body?.todos === "1" ? "&todos=1" : "";
}

function camposValidos({ pergunta, resposta }) {
  return Boolean(String(pergunta ?? "").trim()) && Boolean(String(resposta ?? "").trim());
}

export async function telaBaseConhecimento(req, res, { listar = listarBaseConhecimento } = {}) {
  const mostrarTodos = req.query.todos === "1";
  const entradas = await listar({ apenasAtivos: !mostrarTodos });
  res.render("baseConhecimento/lista", {
    entradas,
    mostrarTodos,
    sucesso: req.query.sucesso === "1",
  });
}

export function telaNovaEntradaBaseConhecimento(req, res) {
  res.render("baseConhecimento/novo", { erro: null, categorias: CATEGORIAS_BASE_CONHECIMENTO });
}

export async function processarNovaEntradaBaseConhecimento(
  req,
  res,
  { criar = inserirEntradaBaseConhecimento } = {}
) {
  const pergunta = String(req.body?.pergunta ?? "").trim();
  const resposta = String(req.body?.resposta ?? "").trim();
  const categoria = String(req.body?.categoria ?? "").trim() || null;

  if (!camposValidos({ pergunta, resposta })) {
    return res.status(400).send("Pergunta e resposta são obrigatórias.");
  }

  await criar({ pergunta, resposta, categoria });
  res.redirect("/base-conhecimento?sucesso=1");
}

export async function telaEditarEntradaBaseConhecimento(
  req,
  res,
  { buscar = buscarEntradaBaseConhecimentoPorId } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Entrada não encontrada.");

  const entrada = await buscar(id);
  if (!entrada) return res.status(404).send("Entrada não encontrada.");

  res.render("baseConhecimento/editar", {
    entrada,
    erro: null,
    mostrarTodos: req.query?.todos === "1",
    categorias: CATEGORIAS_BASE_CONHECIMENTO,
  });
}

export async function processarEditarEntradaBaseConhecimento(
  req,
  res,
  { buscar = buscarEntradaBaseConhecimentoPorId, atualizar = atualizarEntradaModel } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Entrada não encontrada.");

  const pergunta = String(req.body?.pergunta ?? "").trim();
  const resposta = String(req.body?.resposta ?? "").trim();
  const categoria = String(req.body?.categoria ?? "").trim() || null;

  if (!camposValidos({ pergunta, resposta })) {
    return res.status(400).send("Pergunta e resposta são obrigatórias.");
  }

  const entrada = await buscar(id);
  if (!entrada) return res.status(404).send("Entrada não encontrada.");

  await atualizar(id, { pergunta, resposta, categoria });
  res.redirect(`/base-conhecimento?sucesso=1${sufixoTodos(req)}`);
}

export async function processarDesativarEntradaBaseConhecimento(
  req,
  res,
  { buscar = buscarEntradaBaseConhecimentoPorId, definirAtivo = definirAtivoEntradaBaseConhecimento } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Entrada não encontrada.");

  const entrada = await buscar(id);
  if (!entrada) return res.status(404).send("Entrada não encontrada.");

  await definirAtivo(id, false);
  res.redirect(`/base-conhecimento?sucesso=1${sufixoTodos(req)}`);
}

export async function processarReativarEntradaBaseConhecimento(
  req,
  res,
  { buscar = buscarEntradaBaseConhecimentoPorId, definirAtivo = definirAtivoEntradaBaseConhecimento } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Entrada não encontrada.");

  const entrada = await buscar(id);
  if (!entrada) return res.status(404).send("Entrada não encontrada.");

  await definirAtivo(id, true);
  res.redirect(`/base-conhecimento?sucesso=1${sufixoTodos(req)}`);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/baseConhecimentoController.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/controllers/baseConhecimentoController.js test/baseConhecimentoController.test.js
git commit -m "feat: adiciona baseConhecimentoController com CRUD completo

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Views EJS — lista, novo, editar

**Files:**
- Create: `src/views/baseConhecimento/lista.ejs`
- Create: `src/views/baseConhecimento/novo.ejs`
- Create: `src/views/baseConhecimento/editar.ejs`

**Interfaces:**
- Consumes: variáveis passadas pelo controller da Task 4 — `lista.ejs` recebe `{ entradas, mostrarTodos, sucesso }`; `novo.ejs` recebe `{ erro, categorias }`; `editar.ejs` recebe `{ entrada, erro, mostrarTodos, categorias }`. Todas usam `csrfToken` (já disponível em `res.locals` via `exigirLogin`, mesmo padrão de `convenios/*.ejs`).

Views não têm teste unitário próprio neste projeto (confirmado em `convenios/*.ejs`) — a cobertura vem da Task 7 (verificação manual) e dos testes de controller/rota já escritos. Sem passo de teste automatizado aqui.

- [ ] **Step 1: Criar `src/views/baseConhecimento/lista.ejs`**

```html
<!-- src/views/baseConhecimento/lista.ejs -->
<%- include("../partials/header", { titulo: "Base de conhecimento" }) %>
<section class="user-list">
  <header class="page-header">
    <div>
      <h1>Base de conhecimento</h1>
      <p class="patient-list-summary">Perguntas e respostas que o bot usa pra responder pacientes no WhatsApp.</p>
    </div>
    <div class="toolbar">
      <% if (mostrarTodos) { %>
      <a class="button button--quiet" href="/base-conhecimento">Mostrar só ativas</a>
      <% } else { %>
      <a class="button button--quiet" href="/base-conhecimento?todos=1">Mostrar inativas</a>
      <% } %>
      <a class="button" href="/base-conhecimento/novo">Nova entrada</a>
    </div>
  </header>
  <% if (sucesso) { %>
  <p class="sucesso">Alteração salva com sucesso.</p>
  <% } %>
  <div class="panel user-list-panel">
    <div class="patient-table-wrap">
      <table class="data-table">
        <thead>
          <tr><th>Pergunta</th><th>Categoria</th><th>Status</th><th>Ações</th></tr>
        </thead>
        <tbody>
          <% for (const entrada of entradas) { %>
          <tr>
            <td><%= entrada.pergunta %></td>
            <td><%= entrada.categoria ?? "—" %></td>
            <td><span class="badge <%= entrada.ativo ? 'is-success' : 'is-danger' %>"><%= entrada.ativo ? "Ativa" : "Inativa" %></span></td>
            <td>
              <div class="user-row-actions">
                <a class="button button--quiet" href="/base-conhecimento/<%= entrada.id %>/editar<%= mostrarTodos ? '?todos=1' : '' %>">Editar</a>
                <% if (entrada.ativo) { %>
                <form method="post" action="/base-conhecimento/<%= entrada.id %>/desativar">
                  <input type="hidden" name="_csrf" value="<%= csrfToken %>" />
                  <% if (mostrarTodos) { %>
                  <input type="hidden" name="todos" value="1" />
                  <% } %>
                  <button class="button is-danger" type="submit">Desativar</button>
                </form>
                <% } else { %>
                <form method="post" action="/base-conhecimento/<%= entrada.id %>/reativar">
                  <input type="hidden" name="_csrf" value="<%= csrfToken %>" />
                  <% if (mostrarTodos) { %>
                  <input type="hidden" name="todos" value="1" />
                  <% } %>
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

- [ ] **Step 2: Criar `src/views/baseConhecimento/novo.ejs`**

```html
<!-- src/views/baseConhecimento/novo.ejs -->
<%- include("../partials/header", { titulo: "Nova entrada — Base de conhecimento" }) %>
<header class="page-header">
  <div>
    <h1>Nova entrada</h1>
    <p>Cadastre uma pergunta e resposta que o bot pode usar pra responder pacientes.</p>
  </div>
  <a class="button button--quiet" href="/base-conhecimento">Voltar</a>
</header>

<form class="focused-form" method="post" action="/base-conhecimento/novo">
  <input type="hidden" name="_csrf" value="<%= csrfToken %>" />
  <% if (erro) { %>
  <p class="erro"><%= erro %></p>
  <% } %>
  <div class="form-grid">
    <label>Pergunta<textarea name="pergunta" rows="2" required></textarea></label>
    <label>Resposta<textarea name="resposta" rows="4" required></textarea></label>
    <label>Categoria
      <select name="categoria">
        <option value="">Sem categoria</option>
        <% for (const categoria of categorias) { %>
        <option value="<%= categoria.valor %>"><%= categoria.rotulo %></option>
        <% } %>
      </select>
    </label>
  </div>
  <div class="toolbar">
    <button type="submit">Criar</button>
  </div>
</form>
<%- include("../partials/footer") %>
```

- [ ] **Step 3: Criar `src/views/baseConhecimento/editar.ejs`**

```html
<!-- src/views/baseConhecimento/editar.ejs -->
<%- include("../partials/header", { titulo: "Editar entrada — Base de conhecimento" }) %>
<header class="page-header">
  <div>
    <h1>Editar entrada</h1>
    <p>Corrija a pergunta, resposta ou categoria.</p>
  </div>
  <a class="button button--quiet" href="/base-conhecimento<%= mostrarTodos ? '?todos=1' : '' %>">Voltar</a>
</header>

<form class="focused-form" method="post" action="/base-conhecimento/<%= entrada.id %>/editar">
  <input type="hidden" name="_csrf" value="<%= csrfToken %>" />
  <% if (mostrarTodos) { %>
  <input type="hidden" name="todos" value="1" />
  <% } %>
  <% if (erro) { %>
  <p class="erro"><%= erro %></p>
  <% } %>
  <div class="form-grid">
    <label>Pergunta<textarea name="pergunta" rows="2" required><%= entrada.pergunta %></textarea></label>
    <label>Resposta<textarea name="resposta" rows="4" required><%= entrada.resposta %></textarea></label>
    <label>Categoria
      <select name="categoria">
        <option value="" <%= !entrada.categoria ? "selected" : "" %>>Sem categoria</option>
        <% for (const categoria of categorias) { %>
        <option value="<%= categoria.valor %>" <%= entrada.categoria === categoria.valor ? "selected" : "" %>><%= categoria.rotulo %></option>
        <% } %>
        <% if (entrada.categoria && !categorias.some((c) => c.valor === entrada.categoria)) { %>
        <option value="<%= entrada.categoria %>" selected><%= entrada.categoria %> (livre)</option>
        <% } %>
      </select>
    </label>
  </div>
  <div class="toolbar">
    <button type="submit">Salvar</button>
  </div>
</form>
<%- include("../partials/footer") %>
```

- [ ] **Step 4: Commit**

```bash
git add src/views/baseConhecimento/
git commit -m "feat: adiciona views de lista/criar/editar da base de conhecimento

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Rotas + link no menu lateral

**Files:**
- Modify: `src/routes/dashboardRoutes.js`
- Modify: `src/views/partials/header.ejs`
- Test: `test/dashboardRoutesPermissoes.test.js` (adicionar casos)

**Interfaces:**
- Consumes: os 7 handlers exportados por `baseConhecimentoController.js` (Task 4); `exigirLogin`, `exigirCsrf`, `exigirPapel` de `../middleware/dashboardAuth.js`; `asyncHandler` de `../utils/asyncHandler.js` (todos já importados no arquivo de rotas).

- [ ] **Step 1: Escrever o teste falhando (bloqueio de papel)**

Adicionar ao final de `test/dashboardRoutesPermissoes.test.js` (mesmo arquivo, mesmos helpers já definidos no topo — `executarRota`, `criarResposta`, `criarRequisicao`, `RECEPCIONISTA`):

```javascript
test("GET /base-conhecimento bloqueia recepção antes de consultar a lista", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql) => {
    consultas.push(sql);
    return { rows: [RECEPCIONISTA] };
  });
  const res = criarResposta();

  await executarRota({
    caminho: "/base-conhecimento",
    metodo: "get",
    req: criarRequisicao(),
    res,
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.view, "erros/acesso-negado");
  assert.equal(consultas.length, 1, "não deve consultar a lista depois de negar o papel");
});

test("POST /base-conhecimento/:id/desativar bloqueia recepção antes de gravar", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [RECEPCIONISTA] }));
  const res = criarResposta();

  await executarRota({
    caminho: "/base-conhecimento/:id/desativar",
    metodo: "post",
    req: criarRequisicao(),
    res,
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.view, "erros/acesso-negado");
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/dashboardRoutesPermissoes.test.js`
Expected: FAIL com "rota GET /base-conhecimento não encontrada" (as rotas ainda não existem).

- [ ] **Step 3: Registrar as rotas**

Em `src/routes/dashboardRoutes.js`, adicionar o import (junto aos outros imports de controller, próximo ao de `convenioController.js`):

```javascript
import {
  telaBaseConhecimento,
  telaNovaEntradaBaseConhecimento,
  processarNovaEntradaBaseConhecimento,
  telaEditarEntradaBaseConhecimento,
  processarEditarEntradaBaseConhecimento,
  processarDesativarEntradaBaseConhecimento,
  processarReativarEntradaBaseConhecimento,
} from "../controllers/baseConhecimentoController.js";
```

E, logo depois do bloco de rotas de `/convenios/:id/reativar` (antes de `router.get("/agendamentos", ...)`):

```javascript
router.get(
  "/base-conhecimento",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  asyncHandler(telaBaseConhecimento)
);
router.get(
  "/base-conhecimento/novo",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  telaNovaEntradaBaseConhecimento
);
router.post(
  "/base-conhecimento/novo",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  exigirCsrf,
  asyncHandler(processarNovaEntradaBaseConhecimento)
);
router.get(
  "/base-conhecimento/:id/editar",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  asyncHandler(telaEditarEntradaBaseConhecimento)
);
router.post(
  "/base-conhecimento/:id/editar",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  exigirCsrf,
  asyncHandler(processarEditarEntradaBaseConhecimento)
);
router.post(
  "/base-conhecimento/:id/desativar",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  exigirCsrf,
  asyncHandler(processarDesativarEntradaBaseConhecimento)
);
router.post(
  "/base-conhecimento/:id/reativar",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  exigirCsrf,
  asyncHandler(processarReativarEntradaBaseConhecimento)
);
```

- [ ] **Step 4: Adicionar o link no menu lateral**

Em `src/views/partials/header.ejs`, dentro do bloco `<% if (usuarioAtual.papel === "administradora") { %> ... <% } %>` (linhas 40-43), adicionar antes do link de "Dados do prestador":

```html
<a class="sidebar-link<%= ativo('/base-conhecimento') ? ' is-active' : '' %>" href="/base-conhecimento"<% if (ativo('/base-conhecimento')) { %> aria-current="page"<% } %>><svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M12 4h9M4 4h.01M4 12h.01M4 20h.01M8 4h13M8 12h13M8 20h13" transform="translate(-4 0)"/><circle cx="4" cy="7" r="1.5"/><circle cx="4" cy="12" r="1.5"/><circle cx="4" cy="17" r="1.5"/></svg><span>Base de conhecimento</span></a>
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `node --test test/dashboardRoutesPermissoes.test.js`
Expected: PASS

- [ ] **Step 6: Rodar a suíte inteira**

Run: `node --test`
Expected: PASS em todos os arquivos.

- [ ] **Step 7: Commit**

```bash
git add src/routes/dashboardRoutes.js src/views/partials/header.ejs test/dashboardRoutesPermissoes.test.js
git commit -m "feat: registra rotas de /base-conhecimento e link no menu, restrito a administradora

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Verificação manual no navegador + atualização da documentação

**Files:**
- Modify: `OPERACAO.md`

**Interfaces:**
- Nenhuma (task de verificação e docs).

- [ ] **Step 1: Rodar a aplicação localmente**

Confirme que `.env` tem `DATABASE_URL` apontando pro banco de dev/staging (nunca produção pra este teste manual) e que a migration `034_base_conhecimento_gestao.sql` foi aplicada nesse banco (não em produção — ver Task 1). Suba o servidor conforme o processo já documentado no `README.md` (`npm start` ou equivalente).

- [ ] **Step 2: Testar o fluxo completo no navegador**

1. Login como usuária com `papel = "administradora"`.
2. Abrir `/base-conhecimento` — confirmar que a lista aparece (vazia ou com o seed de exemplo) e o link "Base de conhecimento" aparece no menu lateral.
3. Clicar em "Nova entrada", preencher pergunta/resposta/categoria, salvar — confirmar redirect com "Alteração salva com sucesso." e a nova linha na lista.
4. Clicar em "Editar" na entrada criada, mudar o texto, salvar — confirmar que a mudança aparece na lista.
5. Clicar em "Desativar" — confirmar que a linha some da lista padrão (só ativos) e aparece com badge "Inativa" ao clicar em "Mostrar inativas".
6. Clicar em "Reativar" — confirmar que volta a aparecer na lista padrão.
7. Logar como usuária com `papel = "recepcao"` e confirmar que `/base-conhecimento` retorna a tela de acesso negado (não aparece no menu, e a URL direta é bloqueada).

- [ ] **Step 3: Atualizar `OPERACAO.md`**

Substituir a seção `## Adicionar/editar respostas do bot (base de conhecimento)` (linhas ~48-58 hoje) por:

```markdown
## Adicionar/editar respostas do bot (base de conhecimento)

Perguntas frequentes (horário, convênios, endereço, preços etc.) ficam guardadas numa "base de conhecimento". Quem tem papel de administradora consegue gerenciar direto pelo dashboard, em **Base de conhecimento** no menu lateral:

- **Nova entrada**: cadastra uma pergunta e resposta nova, com categoria opcional.
- **Editar**: corrige o texto de uma entrada já existente.
- **Desativar/Reativar**: desativar tira a resposta de circulação (o bot para de usá-la, e ela some da listagem padrão) sem apagar do banco — dá pra reativar depois. Use "Mostrar inativas" pra ver o que já foi desativado.

A rota antiga por `curl` (`POST /admin/base-conhecimento`, autenticada por API key) continua funcionando sem mudanças, caso ainda seja usada por alguma automação externa.
```

- [ ] **Step 4: Commit**

```bash
git add OPERACAO.md
git commit -m "docs: atualiza OPERACAO.md com o novo fluxo de gestão da base de conhecimento no dashboard

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Fora de escopo (explicitamente adiado)

- Aplicar a migration `034_base_conhecimento_gestao.sql` em produção (Neon) — depende de confirmação do usuário, fora do fluxo deste plano.
- Busca semântica/embeddings (`pgvector`) — já documentado como decisão consciente no README.
- Versionamento/histórico de alterações (quem editou o quê e quando) além do único campo `updated_at`.
- Índice trigram/GIN em `pergunta`/`resposta`/`categoria` — base pequena hoje, sem necessidade de performance ainda.
- Migrar/curar os dados de exemplo (`src/db/seed-example-kb.js`, marcados `[EXEMPLO]`) — questão operacional da clínica, não de código.
