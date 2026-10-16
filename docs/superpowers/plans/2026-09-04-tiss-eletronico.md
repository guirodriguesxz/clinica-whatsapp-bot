# TISS eletrônico (lote de guias SP/SADT) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gerar um arquivo XML de lote de guias TISS SP/SADT (padrão ANS) pra um convênio e período escolhidos, pra upload manual no portal da operadora, com cadastro de dados do prestador e mapeamento de código TUSS por convênio.

**Architecture:** Três migrations novas (dados do prestador, dados TISS do convênio, mapeamento TUSS). Dois controllers novos (`prestadorController.js`, `tissController.js`) seguindo o padrão já usado em `convenioController.js`/`usuarioController.js` — funções com dependências injetáveis por parâmetro default, testadas com um objeto de resposta falso, sem framework de mock. Reaproveita a junção pagamento→paciente→agendamento já usada em `guiaConvenioModel.js`/`pagamentoModel.js`. Geração de XML é uma função pura (`tissXmlService.js`), mesmo padrão dos serviços de PDF (`laudoPdfService.js`, `guiaConvenioPdfService.js`).

**Tech Stack:** Node.js, Express, PostgreSQL (`pg`), EJS, `node --test` (test runner nativo, sem framework externo).

**Spec:** [docs/superpowers/specs/2026-09-04-tiss-eletronico-design.md](../specs/2026-09-04-tiss-eletronico-design.md)

## Global Constraints

- Nenhum dado (CNES, registro do prestador, código TUSS) pode ser inventado ou preenchido com placeholder — campo ausente é omitido do XML ou faz a guia/lote ser classificado como incompleto, nunca um valor de exemplo.
- Guias individuais incompletas (TUSS não cadastrado, paciente sem matrícula de convênio) são excluídas do lote, nunca bloqueiam as demais guias do mesmo lote.
- Dados de clínica/convênio incompletos (`dados_prestador`, `codigo_prestador_na_operadora`, `numero_contrato`) bloqueiam a geração do lote inteiro daquele convênio.
- Pagamentos já estornados (`estornado_por`/linha de estorno vinculada) são excluídos do lote.
- Sem transmissão eletrônica (webservice/SOAP) a nenhuma operadora — o XML é só pra download e upload manual.
- Sem validação contra o XSD oficial da ANS — XML montado manualmente por template string, sem dependência nova.
- Sem histórico/versionamento de lote como entidade — gera sempre a partir do estado atual dos pagamentos.
- Todo código novo segue o padrão de dependências injetáveis por parâmetro default (`{ buscar = buscarPadrao } = {}`) já usado em `convenioController.js`, pra ser testável com um objeto de resposta falso, sem mock de `pool`.
- Testes com `node --test`, `pool.query`/`pool.connect` mockados onde necessário — mesmo padrão de `test/convenioModel.test.js`/`test/pagamentoModel.test.js`.

---

## Task 1: Migrations — dados do prestador, dados TISS do convênio, mapeamento TUSS

**Files:**
- Create: `src/db/migrations/030_dados_prestador.sql`
- Create: `src/db/migrations/031_convenios_dados_tiss.sql`
- Create: `src/db/migrations/032_convenio_procedimentos_tuss.sql`
- Test: `test/migrations.test.js` (adicionar ao arquivo existente)

**Interfaces:**
- Produces: tabela `dados_prestador(id, cnes, razao_social, cnpj, atualizado_em)`; colunas `convenios.codigo_prestador_na_operadora`, `convenios.numero_contrato`; tabela `convenio_procedimentos_tuss(id, convenio_id, tipo_atendimento, categoria, codigo_tuss, descricao_tuss)` com `UNIQUE (convenio_id, tipo_atendimento, categoria)`.

- [ ] **Step 1: Escrever as 3 migrations**

`src/db/migrations/030_dados_prestador.sql`:
```sql
-- src/db/migrations/030_dados_prestador.sql
-- Clínica Exemplo Bot — migration 030: dados do prestador (clínica) pro TISS eletrônico
--
-- Tabela de linha única (não por convênio) com os dados cadastrais da
-- própria clínica exigidos no cabeçalho do XML de lote TISS (ver
-- docs/superpowers/specs/2026-09-04-tiss-eletronico-design.md). Todos os
-- campos nullable — pode existir a linha vazia até alguém preencher com
-- dado real levantado na clínica.

CREATE TABLE IF NOT EXISTS dados_prestador (
  id SERIAL PRIMARY KEY,
  cnes TEXT,
  razao_social TEXT,
  cnpj TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`src/db/migrations/031_convenios_dados_tiss.sql`:
```sql
-- src/db/migrations/031_convenios_dados_tiss.sql
-- Clínica Exemplo Bot — migration 031: dados do convênio na operadora pro TISS eletrônico
--
-- Ver docs/superpowers/specs/2026-09-04-tiss-eletronico-design.md. Nullable:
-- convênio pode continuar existindo no cadastro de repasse sem esses dados
-- até serem levantados na clínica.

ALTER TABLE convenios
  ADD COLUMN IF NOT EXISTS codigo_prestador_na_operadora TEXT,
  ADD COLUMN IF NOT EXISTS numero_contrato TEXT;
```

`src/db/migrations/032_convenio_procedimentos_tuss.sql`:
```sql
-- src/db/migrations/032_convenio_procedimentos_tuss.sql
-- Clínica Exemplo Bot — migration 032: mapeamento de código TUSS por convênio
--
-- Ver docs/superpowers/specs/2026-09-04-tiss-eletronico-design.md. Cruza
-- tipo_atendimento (fisioterapia/psicologia) com categoria (avaliacao/
-- sessao, mesma distinção de agendamentos.primeira_consulta usada no
-- cálculo de repasse) — no máximo 4 linhas por convênio.

CREATE TABLE IF NOT EXISTS convenio_procedimentos_tuss (
  id SERIAL PRIMARY KEY,
  convenio_id INTEGER NOT NULL REFERENCES convenios(id),
  tipo_atendimento TEXT NOT NULL CHECK (tipo_atendimento IN ('fisioterapia', 'psicologia')),
  categoria TEXT NOT NULL CHECK (categoria IN ('avaliacao', 'sessao')),
  codigo_tuss TEXT NOT NULL,
  descricao_tuss TEXT,
  UNIQUE (convenio_id, tipo_atendimento, categoria)
);
```

- [ ] **Step 2: Escrever os testes das migrations**

Adicionar em `test/migrations.test.js`, seguindo o padrão dos testes de `MIGRATION_028`/`MIGRATION_029` já existentes no arquivo (constante de caminho + `readFile` + `assert.match`):

```js
const MIGRATION_030 = path.join(ROOT, "src/db/migrations/030_dados_prestador.sql");
const MIGRATION_031 = path.join(ROOT, "src/db/migrations/031_convenios_dados_tiss.sql");
const MIGRATION_032 = path.join(ROOT, "src/db/migrations/032_convenio_procedimentos_tuss.sql");

test("migration 030: cria dados_prestador com campos nullable", async () => {
  const sql = await readFile(MIGRATION_030, "utf8");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS dados_prestador/);
  assert.match(sql, /cnes TEXT,/);
  assert.match(sql, /razao_social TEXT,/);
  assert.match(sql, /cnpj TEXT,/);
  assert.doesNotMatch(sql, /cnes TEXT NOT NULL/);
});

test("migration 031: adiciona colunas TISS nullable em convenios", async () => {
  const sql = await readFile(MIGRATION_031, "utf8");

  assert.match(sql, /ALTER TABLE convenios/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS codigo_prestador_na_operadora TEXT/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS numero_contrato TEXT/);
});

test("migration 032: cria convenio_procedimentos_tuss com unique por convenio/tipo/categoria", async () => {
  const sql = await readFile(MIGRATION_032, "utf8");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS convenio_procedimentos_tuss/);
  assert.match(sql, /convenio_id INTEGER NOT NULL REFERENCES convenios\(id\)/);
  assert.match(sql, /CHECK \(tipo_atendimento IN \('fisioterapia', 'psicologia'\)\)/);
  assert.match(sql, /CHECK \(categoria IN \('avaliacao', 'sessao'\)\)/);
  assert.match(sql, /codigo_tuss TEXT NOT NULL/);
  assert.match(sql, /UNIQUE \(convenio_id, tipo_atendimento, categoria\)/);
});
```

- [ ] **Step 3: Rodar os testes**

Run: `node --test test/migrations.test.js`
Expected: PASS (todos os testes do arquivo, incluindo os 3 novos)

- [ ] **Step 4: Commit**

```bash
git add src/db/migrations/030_dados_prestador.sql src/db/migrations/031_convenios_dados_tiss.sql src/db/migrations/032_convenio_procedimentos_tuss.sql test/migrations.test.js
git commit -m "feat: migrations de dados do prestador, TISS do convênio e mapeamento TUSS"
```

---

## Task 2: Model de dados do prestador

**Files:**
- Create: `src/models/dadosPrestadorModel.js`
- Test: `test/dadosPrestadorModel.test.js`

**Interfaces:**
- Consumes: `pool` de `src/db/pool.js` (mesmo padrão de `convenioModel.js`).
- Produces: `buscarDadosPrestador(): Promise<{id, cnes, razao_social, cnpj} | null>`, `salvarDadosPrestador({cnes, razaoSocial, cnpj}): Promise<{id, cnes, razao_social, cnpj}>` — usados por `prestadorController.js` (Task 3) e por `tissController.js` (Task 11).

- [ ] **Step 1: Escrever o teste (mockando `pool`)**

```js
// test/dadosPrestadorModel.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { buscarDadosPrestador, salvarDadosPrestador } from "../src/models/dadosPrestadorModel.js";

test("buscarDadosPrestador: retorna null quando a tabela está vazia", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const resultado = await buscarDadosPrestador();
  assert.equal(resultado, null);
});

test("buscarDadosPrestador: retorna a linha existente", async (t) => {
  const linha = { id: 1, cnes: "123456", razao_social: "Clínica Exemplo", cnpj: "00.000.000/0001-00" };
  t.mock.method(pool, "query", async () => ({ rows: [linha] }));
  const resultado = await buscarDadosPrestador();
  assert.deepEqual(resultado, linha);
});

test("salvarDadosPrestador: sem linha existente, insere", async (t) => {
  let comandoExecutado = "";
  t.mock.method(pool, "query", async (sql) => {
    comandoExecutado += sql.trim().split(" ")[0] + " ";
    if (sql.includes("SELECT")) return { rows: [] };
    return { rows: [{ id: 1, cnes: "123456", razao_social: null, cnpj: null }] };
  });

  const resultado = await salvarDadosPrestador({ cnes: "123456", razaoSocial: null, cnpj: null });

  assert.match(comandoExecutado, /SELECT.*INSERT/);
  assert.equal(resultado.id, 1);
});

test("salvarDadosPrestador: com linha existente, atualiza", async (t) => {
  let comandoExecutado = "";
  t.mock.method(pool, "query", async (sql) => {
    comandoExecutado += sql.trim().split(" ")[0] + " ";
    if (sql.includes("SELECT")) return { rows: [{ id: 5, cnes: "111", razao_social: null, cnpj: null }] };
    return { rows: [{ id: 5, cnes: "222", razao_social: "Clínica Exemplo", cnpj: null }] };
  });

  const resultado = await salvarDadosPrestador({ cnes: "222", razaoSocial: "Clínica Exemplo", cnpj: null });

  assert.match(comandoExecutado, /SELECT.*UPDATE/);
  assert.equal(resultado.cnes, "222");
});
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `node --test test/dadosPrestadorModel.test.js`
Expected: FAIL com `Cannot find module '../src/models/dadosPrestadorModel.js'`

- [ ] **Step 3: Implementar o model**

```js
// src/models/dadosPrestadorModel.js
import { pool } from "../db/pool.js";

/**
 * Linha única com os dados cadastrais da clínica (não por convênio) — ver
 * docs/superpowers/specs/2026-09-04-tiss-eletronico-design.md.
 */
export async function buscarDadosPrestador() {
  const { rows } = await pool.query(
    "SELECT id, cnes, razao_social, cnpj FROM dados_prestador ORDER BY id LIMIT 1"
  );
  return rows[0] ?? null;
}

export async function salvarDadosPrestador({ cnes, razaoSocial, cnpj }) {
  const existente = await buscarDadosPrestador();

  if (existente) {
    const { rows } = await pool.query(
      `UPDATE dados_prestador
       SET cnes = $2, razao_social = $3, cnpj = $4, atualizado_em = now()
       WHERE id = $1
       RETURNING id, cnes, razao_social, cnpj`,
      [existente.id, cnes, razaoSocial, cnpj]
    );
    return rows[0];
  }

  const { rows } = await pool.query(
    `INSERT INTO dados_prestador (cnes, razao_social, cnpj)
     VALUES ($1, $2, $3)
     RETURNING id, cnes, razao_social, cnpj`,
    [cnes, razaoSocial, cnpj]
  );
  return rows[0];
}
```

- [ ] **Step 4: Rodar os testes e ver passar**

Run: `node --test test/dadosPrestadorModel.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/models/dadosPrestadorModel.js test/dadosPrestadorModel.test.js
git commit -m "feat: model de dados do prestador (cadastro único da clínica)"
```

---

## Task 3: Controller de dados do prestador

**Files:**
- Create: `src/controllers/prestadorController.js`
- Test: `test/prestadorController.test.js`

**Interfaces:**
- Consumes: `buscarDadosPrestador`, `salvarDadosPrestador` de `../models/dadosPrestadorModel.js` (Task 2).
- Produces: `telaPrestador(req, res, {buscar} = {})`, `processarPrestador(req, res, {salvar} = {})` — usados nas rotas da Task 4.

- [ ] **Step 1: Escrever o teste**

```js
// test/prestadorController.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { telaPrestador, processarPrestador } from "../src/controllers/prestadorController.js";

function criarRespostaFalsa() {
  return {
    statusCode: 200,
    redirectedTo: null,
    viewRenderizada: null,
    dadosDaView: null,
    status(code) { this.statusCode = code; return this; },
    send(corpo) { this.corpo = corpo; return this; },
    redirect(url) { this.redirectedTo = url; },
    render(view, dados) { this.viewRenderizada = view; this.dadosDaView = dados; },
  };
}

test("telaPrestador: sem dados cadastrados, renderiza com campos vazios", async () => {
  const res = criarRespostaFalsa();
  await telaPrestador({ query: {} }, res, { buscar: async () => null });

  assert.equal(res.viewRenderizada, "prestador/editar");
  assert.equal(res.dadosDaView.dados.cnes, null);
  assert.equal(res.dadosDaView.sucesso, false);
});

test("telaPrestador: com dados cadastrados, renderiza com os valores atuais", async () => {
  const res = criarRespostaFalsa();
  const dados = { cnes: "123456", razao_social: "Clínica Exemplo", cnpj: "00.000.000/0001-00" };
  await telaPrestador({ query: { sucesso: "1" } }, res, { buscar: async () => dados });

  assert.deepEqual(res.dadosDaView.dados, dados);
  assert.equal(res.dadosDaView.sucesso, true);
});

test("processarPrestador: trima campos e converte vazio em null", async () => {
  const res = criarRespostaFalsa();
  let dadosGravados = null;
  await processarPrestador(
    { body: { cnes: "  123456  ", razao_social: "", cnpj: "  " } },
    res,
    { salvar: async (dados) => { dadosGravados = dados; } }
  );

  assert.deepEqual(dadosGravados, { cnes: "123456", razaoSocial: null, cnpj: null });
  assert.equal(res.redirectedTo, "/configuracoes/prestador?sucesso=1");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/prestadorController.test.js`
Expected: FAIL com `Cannot find module '../src/controllers/prestadorController.js'`

- [ ] **Step 3: Implementar o controller**

```js
// src/controllers/prestadorController.js
import { buscarDadosPrestador, salvarDadosPrestador } from "../models/dadosPrestadorModel.js";

function textoOuNulo(bruto) {
  const texto = String(bruto ?? "").trim();
  return texto || null;
}

export async function telaPrestador(req, res, { buscar = buscarDadosPrestador } = {}) {
  const dados = (await buscar()) ?? { cnes: null, razao_social: null, cnpj: null };
  res.render("prestador/editar", { dados, sucesso: req.query.sucesso === "1" });
}

export async function processarPrestador(req, res, { salvar = salvarDadosPrestador } = {}) {
  await salvar({
    cnes: textoOuNulo(req.body?.cnes),
    razaoSocial: textoOuNulo(req.body?.razao_social),
    cnpj: textoOuNulo(req.body?.cnpj),
  });
  res.redirect("/configuracoes/prestador?sucesso=1");
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/prestadorController.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/controllers/prestadorController.js test/prestadorController.test.js
git commit -m "feat: controller de dados do prestador"
```

---

## Task 4: Tela e rotas de dados do prestador

**Files:**
- Create: `src/views/prestador/editar.ejs`
- Modify: `src/routes/dashboardRoutes.js`
- Test: `test/prestadorView.test.js`

**Interfaces:**
- Consumes: `telaPrestador`, `processarPrestador` (Task 3); `exigirLogin`, `exigirCsrf`, `exigirPapel` de `../middleware/dashboardAuth.js`; `asyncHandler` de `../utils/asyncHandler.js`.

- [ ] **Step 1: Escrever o teste da view (render direto do template)**

```js
// test/prestadorView.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import ejs from "ejs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VIEWS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/views");

async function renderizar(dados) {
  return ejs.renderFile(path.join(VIEWS_DIR, "prestador/editar.ejs"), {
    csrfToken: "token-teste",
    dados: { cnes: null, razao_social: null, cnpj: null },
    sucesso: false,
    ...dados,
  });
}

test("prestador/editar: mostra os 3 campos e o valor atual quando preenchido", async () => {
  const html = await renderizar({ dados: { cnes: "123456", razao_social: "Clínica Exemplo", cnpj: null } });

  assert.match(html, /name="cnes"/);
  assert.match(html, /name="razao_social"/);
  assert.match(html, /name="cnpj"/);
  assert.match(html, /value="123456"/);
  assert.match(html, /value="Clínica Exemplo"/);
});

test("prestador/editar: mostra mensagem de sucesso quando sucesso=true", async () => {
  const html = await renderizar({ sucesso: true });
  assert.match(html, /Alteração salva com sucesso/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/prestadorView.test.js`
Expected: FAIL (arquivo de view não existe)

- [ ] **Step 3: Criar a view**

```html
<!-- src/views/prestador/editar.ejs -->
<%- include("../partials/header", { titulo: "Dados do prestador" }) %>
<header class="page-header">
  <div>
    <h1>Dados do prestador</h1>
    <p>Dados cadastrais da clínica usados no cabeçalho do lote TISS eletrônico.</p>
  </div>
</header>
<% if (sucesso) { %>
<p class="sucesso">Alteração salva com sucesso.</p>
<% } %>
<form class="focused-form" method="post" action="/configuracoes/prestador">
  <input type="hidden" name="_csrf" value="<%= csrfToken %>" />
  <div class="form-grid">
    <label>CNES<input type="text" name="cnes" placeholder="Opcional" value="<%= dados.cnes ?? '' %>" /></label>
    <label>Razão social<input type="text" name="razao_social" placeholder="Opcional" value="<%= dados.razao_social ?? '' %>" /></label>
    <label>CNPJ<input type="text" name="cnpj" placeholder="Opcional" value="<%= dados.cnpj ?? '' %>" /></label>
  </div>
  <div class="toolbar">
    <button type="submit">Salvar</button>
  </div>
</form>
<%- include("../partials/footer") %>
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/prestadorView.test.js`
Expected: PASS

- [ ] **Step 5: Adicionar as rotas**

Em `src/routes/dashboardRoutes.js`, adicionar ao bloco de imports de controller (junto aos demais `import ... from "../controllers/..."`):

```js
import { telaPrestador, processarPrestador } from "../controllers/prestadorController.js";
```

E, próximo ao bloco de rotas `/usuarios` (mesmo padrão de acesso restrito à administradora), adicionar:

```js
router.get(
  "/configuracoes/prestador",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  asyncHandler(telaPrestador)
);
router.post(
  "/configuracoes/prestador",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  exigirCsrf,
  asyncHandler(processarPrestador)
);
```

- [ ] **Step 6: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS (nenhuma regressão nas rotas existentes)

- [ ] **Step 7: Commit**

```bash
git add src/views/prestador/editar.ejs src/routes/dashboardRoutes.js test/prestadorView.test.js
git commit -m "feat: tela e rotas de dados do prestador (/configuracoes/prestador)"
```

---

## Task 5: Estender `convenioModel.js` com os campos TISS do convênio

**Files:**
- Modify: `src/models/convenioModel.js`
- Test: `test/convenioModel.test.js` (adicionar aos testes existentes)

**Interfaces:**
- Modifies: `buscarConvenioPorId(id)` passa a incluir `codigo_prestador_na_operadora`, `numero_contrato` no retorno; `atualizarConvenio(id, {..., codigoPrestadorNaOperadora, numeroContrato})` passa a gravar essas duas colunas.
- Produces: essas duas colunas ficam disponíveis pra `convenioController.js` (Task 7) e `tissLoteModel.js` (Task 9, via `buscarConvenioPorId`).

- [ ] **Step 1: Escrever os testes novos (adicionar a `test/convenioModel.test.js`)**

```js
test("buscarConvenioPorId: inclui os campos TISS no retorno", async (t) => {
  const linha = {
    id: 5, nome: "Mar Azul Saúde", ativo: true,
    valor_repasse_avaliacao: null, valor_repasse_sessao: null,
    codigo_prestador_na_operadora: "PRESTADOR123", numero_contrato: "CT-001",
    created_at: new Date(),
  };
  t.mock.method(pool, "query", async () => ({ rows: [linha] }));

  const resultado = await buscarConvenioPorId(5);

  assert.equal(resultado.codigo_prestador_na_operadora, "PRESTADOR123");
  assert.equal(resultado.numero_contrato, "CT-001");
});

test("atualizarConvenio: grava codigoPrestadorNaOperadora e numeroContrato", async (t) => {
  let parametrosRecebidos = null;
  t.mock.method(pool, "query", async (_sql, parametros) => {
    parametrosRecebidos = parametros;
    return { rows: [{ id: 5 }] };
  });

  await atualizarConvenio(5, {
    nome: "Mar Azul Saúde",
    valorRepasseAvaliacao: null,
    valorRepasseSessao: null,
    codigoPrestadorNaOperadora: "PRESTADOR123",
    numeroContrato: "CT-001",
  });

  assert.deepEqual(parametrosRecebidos, [5, "Mar Azul Saúde", null, null, "PRESTADOR123", "CT-001"]);
});
```

(Confirmar no topo do arquivo se `buscarConvenioPorId`/`atualizarConvenio` já estão importados — devem estar, pois o arquivo já tem os testes existentes dessas funções.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/convenioModel.test.js`
Expected: FAIL (parâmetros/retorno ainda não incluem os campos novos)

- [ ] **Step 3: Atualizar o model**

Em `src/models/convenioModel.js`, atualizar `buscarConvenioPorId` e `atualizarConvenio`:

```js
export async function buscarConvenioPorId(id) {
  const { rows } = await pool.query(
    `SELECT id, nome, ativo, valor_repasse_avaliacao, valor_repasse_sessao,
            codigo_prestador_na_operadora, numero_contrato, created_at
     FROM convenios WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}
```

```js
export async function atualizarConvenio(
  id,
  { nome, valorRepasseAvaliacao = null, valorRepasseSessao = null, codigoPrestadorNaOperadora = null, numeroContrato = null }
) {
  const { rows } = await pool.query(
    `UPDATE convenios
     SET nome = $2, valor_repasse_avaliacao = $3, valor_repasse_sessao = $4,
         codigo_prestador_na_operadora = $5, numero_contrato = $6
     WHERE id = $1
     RETURNING id, nome, ativo, valor_repasse_avaliacao, valor_repasse_sessao,
               codigo_prestador_na_operadora, numero_contrato, created_at`,
    [id, nome, valorRepasseAvaliacao, valorRepasseSessao, codigoPrestadorNaOperadora, numeroContrato]
  );
  return rows[0] ?? null;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/convenioModel.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/models/convenioModel.js test/convenioModel.test.js
git commit -m "feat: campos TISS do convênio (código na operadora, número de contrato)"
```

---

## Task 6: Model de mapeamento de procedimentos TUSS por convênio

**Files:**
- Create: `src/models/convenioProcedimentoTussModel.js`
- Test: `test/convenioProcedimentoTussModel.test.js`

**Interfaces:**
- Produces: `listarProcedimentosTuss(convenioId): Promise<Array<{tipo_atendimento, categoria, codigo_tuss, descricao_tuss}>>`, `salvarProcedimentosTuss(convenioId, linhas: Array<{tipoAtendimento, categoria, codigoTuss, descricaoTuss}>): Promise<void>` — usados por `convenioController.js` (Task 7) e `tissLoteModel.js` (Task 9, via join direto na tabela).

- [ ] **Step 1: Escrever o teste**

```js
// test/convenioProcedimentoTussModel.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { listarProcedimentosTuss, salvarProcedimentosTuss } from "../src/models/convenioProcedimentoTussModel.js";

test("listarProcedimentosTuss: retorna as linhas cadastradas do convênio", async (t) => {
  const linhas = [{ tipo_atendimento: "fisioterapia", categoria: "sessao", codigo_tuss: "10101012", descricao_tuss: "Sessão de fisioterapia" }];
  t.mock.method(pool, "query", async () => ({ rows: linhas }));

  const resultado = await listarProcedimentosTuss(5);
  assert.deepEqual(resultado, linhas);
});

test("salvarProcedimentosTuss: linha com código faz upsert (INSERT ... ON CONFLICT)", async (t) => {
  const comandos = [];
  const clienteFalso = {
    query: async (sql, parametros) => { comandos.push({ sql, parametros }); return { rows: [] }; },
    release: () => {},
  };
  t.mock.method(pool, "connect", async () => clienteFalso);

  await salvarProcedimentosTuss(5, [
    { tipoAtendimento: "fisioterapia", categoria: "sessao", codigoTuss: "10101012", descricaoTuss: "Sessão" },
  ]);

  assert.equal(comandos[0].sql, "BEGIN");
  assert.match(comandos[1].sql, /INSERT INTO convenio_procedimentos_tuss/);
  assert.match(comandos[1].sql, /ON CONFLICT \(convenio_id, tipo_atendimento, categoria\)/);
  assert.deepEqual(comandos[1].parametros, [5, "fisioterapia", "sessao", "10101012", "Sessão"]);
  assert.equal(comandos[2].sql, "COMMIT");
});

test("salvarProcedimentosTuss: linha sem código remove o mapeamento existente (DELETE)", async (t) => {
  const comandos = [];
  const clienteFalso = {
    query: async (sql, parametros) => { comandos.push({ sql, parametros }); return { rows: [] }; },
    release: () => {},
  };
  t.mock.method(pool, "connect", async () => clienteFalso);

  await salvarProcedimentosTuss(5, [
    { tipoAtendimento: "psicologia", categoria: "avaliacao", codigoTuss: null, descricaoTuss: null },
  ]);

  assert.match(comandos[1].sql, /DELETE FROM convenio_procedimentos_tuss/);
  assert.deepEqual(comandos[1].parametros, [5, "psicologia", "avaliacao"]);
});

test("salvarProcedimentosTuss: erro no meio faz ROLLBACK e relança", async (t) => {
  const comandos = [];
  const clienteFalso = {
    query: async (sql) => {
      comandos.push(sql);
      if (sql.startsWith("INSERT")) throw new Error("falha simulada");
      return { rows: [] };
    },
    release: () => {},
  };
  t.mock.method(pool, "connect", async () => clienteFalso);

  await assert.rejects(
    () => salvarProcedimentosTuss(5, [
      { tipoAtendimento: "fisioterapia", categoria: "sessao", codigoTuss: "1", descricaoTuss: null },
    ]),
    /falha simulada/
  );
  assert.ok(comandos.includes("ROLLBACK"));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/convenioProcedimentoTussModel.test.js`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implementar o model**

```js
// src/models/convenioProcedimentoTussModel.js
import { pool } from "../db/pool.js";

export async function listarProcedimentosTuss(convenioId) {
  const { rows } = await pool.query(
    `SELECT tipo_atendimento, categoria, codigo_tuss, descricao_tuss
     FROM convenio_procedimentos_tuss WHERE convenio_id = $1`,
    [convenioId]
  );
  return rows;
}

/**
 * Substitui o mapeamento TUSS do convênio pelas linhas informadas. Linha
 * com código vazio remove o mapeamento existente daquela combinação
 * (tipo_atendimento, categoria) — nunca grava linha sem código, já que a
 * coluna é NOT NULL. Ver
 * docs/superpowers/specs/2026-09-04-tiss-eletronico-design.md.
 */
export async function salvarProcedimentosTuss(convenioId, linhas) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const linha of linhas) {
      if (linha.codigoTuss) {
        await client.query(
          `INSERT INTO convenio_procedimentos_tuss (convenio_id, tipo_atendimento, categoria, codigo_tuss, descricao_tuss)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (convenio_id, tipo_atendimento, categoria)
           DO UPDATE SET codigo_tuss = EXCLUDED.codigo_tuss, descricao_tuss = EXCLUDED.descricao_tuss`,
          [convenioId, linha.tipoAtendimento, linha.categoria, linha.codigoTuss, linha.descricaoTuss]
        );
      } else {
        await client.query(
          `DELETE FROM convenio_procedimentos_tuss WHERE convenio_id = $1 AND tipo_atendimento = $2 AND categoria = $3`,
          [convenioId, linha.tipoAtendimento, linha.categoria]
        );
      }
    }
    await client.query("COMMIT");
  } catch (erro) {
    await client.query("ROLLBACK");
    throw erro;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/convenioProcedimentoTussModel.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/models/convenioProcedimentoTussModel.js test/convenioProcedimentoTussModel.test.js
git commit -m "feat: model de mapeamento de código TUSS por convênio"
```

---

## Task 7: Estender `convenioController.js` (tela e processamento de edição)

**Files:**
- Modify: `src/controllers/convenioController.js`
- Test: `test/convenioController.test.js` (adicionar aos testes existentes)

**Interfaces:**
- Consumes: `listarProcedimentosTuss`, `salvarProcedimentosTuss` de `../models/convenioProcedimentoTussModel.js` (Task 6); `atualizarConvenio` já aceita os campos TISS (Task 5).
- Modifies: `telaEditarConvenio` passa a injetar `listarProcedimentosTuss` e passar `procedimentosTussPorChave` pra view; `processarEditarConvenio` passa a ler `codigo_prestador_na_operadora`, `numero_contrato` e as 4 linhas de TUSS do body, e a injetar `salvarProcedimentosTuss`.
- Produces: `procedimentosTussPorChave: Record<"fisioterapia_avaliacao"|"fisioterapia_sessao"|"psicologia_avaliacao"|"psicologia_sessao", {codigo_tuss, descricao_tuss}>` — consumido pela view da Task 8.

- [ ] **Step 1: Escrever os testes novos (adicionar a `test/convenioController.test.js`)**

```js
test("telaEditarConvenio: monta procedimentosTussPorChave a partir das linhas cadastradas", async () => {
  const res = criarRespostaFalsa();
  await telaEditarConvenio(
    { params: { id: "5" }, query: {} },
    res,
    {
      buscar: async () => CONVENIO,
      listarTuss: async () => [
        { tipo_atendimento: "fisioterapia", categoria: "sessao", codigo_tuss: "10101012", descricao_tuss: "Sessão" },
      ],
    }
  );

  assert.deepEqual(res.dadosDaView.procedimentosTussPorChave.fisioterapia_sessao, {
    codigo_tuss: "10101012", descricao_tuss: "Sessão",
  });
  assert.equal(res.dadosDaView.procedimentosTussPorChave.fisioterapia_avaliacao, undefined);
});

test("processarEditarConvenio: grava codigo_prestador_na_operadora/numero_contrato e chama salvarProcedimentosTuss com as 4 combinações", async () => {
  const res = criarRespostaFalsa();
  let dadosAtualizados = null;
  let linhasTussSalvas = null;
  await processarEditarConvenio(
    {
      params: { id: "5" },
      body: {
        nome: "Mar Azul Saúde",
        codigo_prestador_na_operadora: "PRESTADOR123",
        numero_contrato: "CT-001",
        tuss_fisioterapia_avaliacao_codigo: "10101020",
        tuss_fisioterapia_avaliacao_descricao: "Avaliação fisioterapêutica",
        tuss_fisioterapia_sessao_codigo: "",
        tuss_psicologia_avaliacao_codigo: "",
        tuss_psicologia_sessao_codigo: "",
      },
    },
    res,
    {
      buscar: async () => CONVENIO,
      atualizar: async (id, dados) => { dadosAtualizados = { id, dados }; },
      salvarTuss: async (id, linhas) => { linhasTussSalvas = { id, linhas }; },
    }
  );

  assert.equal(dadosAtualizados.dados.codigoPrestadorNaOperadora, "PRESTADOR123");
  assert.equal(dadosAtualizados.dados.numeroContrato, "CT-001");
  assert.equal(linhasTussSalvas.id, 5);
  assert.deepEqual(linhasTussSalvas.linhas, [
    { tipoAtendimento: "fisioterapia", categoria: "avaliacao", codigoTuss: "10101020", descricaoTuss: "Avaliação fisioterapêutica" },
    { tipoAtendimento: "fisioterapia", categoria: "sessao", codigoTuss: null, descricaoTuss: null },
    { tipoAtendimento: "psicologia", categoria: "avaliacao", codigoTuss: null, descricaoTuss: null },
    { tipoAtendimento: "psicologia", categoria: "sessao", codigoTuss: null, descricaoTuss: null },
  ]);
  assert.equal(res.redirectedTo, "/convenios?sucesso=1");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/convenioController.test.js`
Expected: FAIL (`procedimentosTussPorChave` ausente, `salvarTuss` nunca chamado)

- [ ] **Step 3: Atualizar o controller**

Em `src/controllers/convenioController.js`, adicionar o import e a constante das 4 combinações:

```js
import {
  listarProcedimentosTuss,
  salvarProcedimentosTuss,
} from "../models/convenioProcedimentoTussModel.js";

const COMBINACOES_TUSS = [
  { tipoAtendimento: "fisioterapia", categoria: "avaliacao" },
  { tipoAtendimento: "fisioterapia", categoria: "sessao" },
  { tipoAtendimento: "psicologia", categoria: "avaliacao" },
  { tipoAtendimento: "psicologia", categoria: "sessao" },
];

function linhasTussDoBody(body) {
  return COMBINACOES_TUSS.map(({ tipoAtendimento, categoria }) => ({
    tipoAtendimento,
    categoria,
    codigoTuss: String(body?.[`tuss_${tipoAtendimento}_${categoria}_codigo`] ?? "").trim() || null,
    descricaoTuss: String(body?.[`tuss_${tipoAtendimento}_${categoria}_descricao`] ?? "").trim() || null,
  }));
}
```

Atualizar `telaEditarConvenio`:

```js
export async function telaEditarConvenio(
  req,
  res,
  { buscar = buscarConvenioPorId, listarTuss = listarProcedimentosTuss } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Convênio não encontrado.");

  const convenio = await buscar(id);
  if (!convenio) return res.status(404).send("Convênio não encontrado.");

  const linhasTuss = await listarTuss(id);
  const procedimentosTussPorChave = Object.fromEntries(
    linhasTuss.map((l) => [`${l.tipo_atendimento}_${l.categoria}`, { codigo_tuss: l.codigo_tuss, descricao_tuss: l.descricao_tuss }])
  );

  res.render("convenios/editar", {
    convenio,
    erro: null,
    mostrarTodos: req.query?.todos === "1",
    procedimentosTussPorChave,
  });
}
```

Atualizar `processarEditarConvenio` (adicionar leitura dos campos TISS e chamada a `salvarTuss`, mantendo toda a validação de nome/repasse já existente):

```js
export async function processarEditarConvenio(
  req,
  res,
  { buscar = buscarConvenioPorId, atualizar = atualizarConvenio, salvarTuss = salvarProcedimentosTuss } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Convênio não encontrado.");

  const nome = String(req.body?.nome ?? "").trim();
  if (!nome) return res.status(400).send("Nome inválido.");

  const valorRepasseAvaliacao = valorRepasseSeguro(req.body?.valor_repasse_avaliacao);
  const valorRepasseSessao = valorRepasseSeguro(req.body?.valor_repasse_sessao);
  if (valorRepasseAvaliacao === undefined || valorRepasseSessao === undefined) {
    return res.status(400).send("Valor de repasse inválido.");
  }

  const convenio = await buscar(id);
  if (!convenio) return res.status(404).send("Convênio não encontrado.");

  const codigoPrestadorNaOperadora = String(req.body?.codigo_prestador_na_operadora ?? "").trim() || null;
  const numeroContrato = String(req.body?.numero_contrato ?? "").trim() || null;

  await atualizar(id, {
    nome, valorRepasseAvaliacao, valorRepasseSessao, codigoPrestadorNaOperadora, numeroContrato,
  });
  await salvarTuss(id, linhasTussDoBody(req.body ?? {}));

  res.redirect(`/convenios?sucesso=1${sufixoTodos(req)}`);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/convenioController.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/controllers/convenioController.js test/convenioController.test.js
git commit -m "feat: edição de dados TISS e mapeamento TUSS na tela de convênio"
```

---

## Task 8: Estender a view `convenios/editar.ejs`

**Files:**
- Modify: `src/views/convenios/editar.ejs`
- Test: `test/conveniosView.test.js` (adicionar aos testes existentes, mesmo padrão de render direto do template)

**Interfaces:**
- Consumes: `procedimentosTussPorChave` (produzido na Task 7), `convenio.codigo_prestador_na_operadora`, `convenio.numero_contrato`.

- [ ] **Step 1: Atualizar o helper `renderizarEditar` e escrever o teste**

`test/conveniosView.test.js` já tem um helper `renderizarEditar(dados)` (linha 41) que passa um objeto `convenio` default e faz spread de `dados` por cima. Ele precisa de um default pra `procedimentosTussPorChave` (senão a view quebra ao acessar `procedimentosTussPorChave.fisioterapia_avaliacao` nos testes que não passam esse campo). Atualizar a função:

```js
function renderizarEditar(dados) {
  const caminho = path.join(VIEWS_DIR, "convenios", "editar.ejs");
  return ejs.renderFile(caminho, {
    convenio: { id: 5, nome: "Mar Azul Saúde", ativo: true, valor_repasse_avaliacao: null, valor_repasse_sessao: null },
    mostrarTodos: false,
    erro: null,
    titulo: "Editar convênio",
    caminhoAtual: "/convenios/5/editar",
    csrfToken: "token-fake",
    usuarioAtual: ADMINISTRADORA,
    procedimentosTussPorChave: {},
    ...dados,
  });
}
```

E adicionar os testes novos:

```js
test("convenios/editar: mostra campos TISS do convênio quando preenchidos", async () => {
  const html = await renderizarEditar({
    convenio: { id: 5, nome: "Mar Azul Saúde", ativo: true, valor_repasse_avaliacao: null, valor_repasse_sessao: null, codigo_prestador_na_operadora: "PRESTADOR123", numero_contrato: "CT-001" },
  });

  assert.match(html, /name="codigo_prestador_na_operadora"[^>]*value="PRESTADOR123"/);
  assert.match(html, /name="numero_contrato"[^>]*value="CT-001"/);
});

test("convenios/editar: mostra as 4 linhas de mapeamento TUSS, pré-preenchidas quando cadastradas", async () => {
  const html = await renderizarEditar({
    procedimentosTussPorChave: {
      fisioterapia_sessao: { codigo_tuss: "10101012", descricao_tuss: "Sessão de fisioterapia" },
    },
  });

  assert.match(html, /name="tuss_fisioterapia_avaliacao_codigo"/);
  assert.match(html, /name="tuss_fisioterapia_sessao_codigo"[^>]*value="10101012"/);
  assert.match(html, /name="tuss_psicologia_avaliacao_codigo"/);
  assert.match(html, /name="tuss_psicologia_sessao_codigo"/);
});

test("convenios/editar: campos TISS/TUSS ausentes mostram vazio, não 'null'", async () => {
  const html = await renderizarEditar({});
  assert.doesNotMatch(html, /value="null"/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/conveniosView.test.js`
Expected: FAIL (campos novos não existem na view)

- [ ] **Step 3: Atualizar a view**

Em `src/views/convenios/editar.ejs`, depois do `form-grid` existente (nome + repasse) e antes do `toolbar`, adicionar:

```html
  <fieldset>
    <legend>Dados TISS (opcional — preencher quando levantado com a operadora)</legend>
    <div class="form-grid">
      <label>Código do prestador na operadora<input type="text" name="codigo_prestador_na_operadora" placeholder="Opcional" value="<%= convenio.codigo_prestador_na_operadora ?? '' %>" /></label>
      <label>Número do contrato<input type="text" name="numero_contrato" placeholder="Opcional" value="<%= convenio.numero_contrato ?? '' %>" /></label>
    </div>
    <table>
      <thead>
        <tr><th>Tipo</th><th>Categoria</th><th>Código TUSS</th><th>Descrição</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>Fisioterapia</td><td>Avaliação</td>
          <td><input type="text" name="tuss_fisioterapia_avaliacao_codigo" value="<%= procedimentosTussPorChave.fisioterapia_avaliacao?.codigo_tuss ?? '' %>" /></td>
          <td><input type="text" name="tuss_fisioterapia_avaliacao_descricao" value="<%= procedimentosTussPorChave.fisioterapia_avaliacao?.descricao_tuss ?? '' %>" /></td>
        </tr>
        <tr>
          <td>Fisioterapia</td><td>Sessão</td>
          <td><input type="text" name="tuss_fisioterapia_sessao_codigo" value="<%= procedimentosTussPorChave.fisioterapia_sessao?.codigo_tuss ?? '' %>" /></td>
          <td><input type="text" name="tuss_fisioterapia_sessao_descricao" value="<%= procedimentosTussPorChave.fisioterapia_sessao?.descricao_tuss ?? '' %>" /></td>
        </tr>
        <tr>
          <td>Psicologia</td><td>Avaliação</td>
          <td><input type="text" name="tuss_psicologia_avaliacao_codigo" value="<%= procedimentosTussPorChave.psicologia_avaliacao?.codigo_tuss ?? '' %>" /></td>
          <td><input type="text" name="tuss_psicologia_avaliacao_descricao" value="<%= procedimentosTussPorChave.psicologia_avaliacao?.descricao_tuss ?? '' %>" /></td>
        </tr>
        <tr>
          <td>Psicologia</td><td>Sessão</td>
          <td><input type="text" name="tuss_psicologia_sessao_codigo" value="<%= procedimentosTussPorChave.psicologia_sessao?.codigo_tuss ?? '' %>" /></td>
          <td><input type="text" name="tuss_psicologia_sessao_descricao" value="<%= procedimentosTussPorChave.psicologia_sessao?.descricao_tuss ?? '' %>" /></td>
        </tr>
      </tbody>
    </table>
  </fieldset>
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/conveniosView.test.js`
Expected: PASS

- [ ] **Step 5: Rodar a suíte inteira e checar visualmente**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/views/convenios/editar.ejs test/conveniosView.test.js
git commit -m "feat: seção de dados TISS e mapeamento TUSS na tela de editar convênio"
```

---

## Task 9: Model de guias do lote TISS (busca + classificação)

**Files:**
- Create: `src/models/tissLoteModel.js`
- Test: `test/tissLoteModel.test.js`

**Interfaces:**
- Produces: `buscarGuiasConvenioPeriodo({convenioId, inicio, fim}): Promise<Array<{pagamento_id, valor, paciente_nome, matricula_convenio, tipo_atendimento, data_atendimento, categoria, codigo_tuss, descricao_tuss}>>`, `classificarGuias(linhas): {prontas: [...], incompletas: [...]}`, `motivosBloqueioLote({dadosPrestador, convenio}): string[]` — usados por `tissController.js` (Task 11).

- [ ] **Step 1: Escrever o teste**

```js
// test/tissLoteModel.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import {
  buscarGuiasConvenioPeriodo,
  classificarGuias,
  motivosBloqueioLote,
} from "../src/models/tissLoteModel.js";

test("buscarGuiasConvenioPeriodo: filtra por convênio, período, forma convenio e exclui estornados", async (t) => {
  let parametrosRecebidos = null;
  let sqlRecebido = "";
  t.mock.method(pool, "query", async (sql, parametros) => {
    sqlRecebido = sql;
    parametrosRecebidos = parametros;
    return { rows: [] };
  });

  await buscarGuiasConvenioPeriodo({ convenioId: 5, inicio: "2026-09-01", fim: "2026-09-30" });

  assert.deepEqual(parametrosRecebidos, [5, "2026-09-01", "2026-09-30"]);
  assert.match(sqlRecebido, /forma_pagamento = 'convenio'/);
  assert.match(sqlRecebido, /estorno\.id IS NULL/);
});

test("classificarGuias: guia sem matrícula de convênio é incompleta", () => {
  const { prontas, incompletas } = classificarGuias([
    { pagamento_id: 1, matricula_convenio: null, codigo_tuss: "10101012" },
  ]);
  assert.equal(prontas.length, 0);
  assert.equal(incompletas[0].motivo, "paciente_sem_matricula");
});

test("classificarGuias: guia sem código TUSS é incompleta", () => {
  const { prontas, incompletas } = classificarGuias([
    { pagamento_id: 1, matricula_convenio: "MAT123", codigo_tuss: null },
  ]);
  assert.equal(prontas.length, 0);
  assert.equal(incompletas[0].motivo, "tuss_nao_cadastrado");
});

test("classificarGuias: guia com matrícula e TUSS é pronta", () => {
  const linha = { pagamento_id: 1, matricula_convenio: "MAT123", codigo_tuss: "10101012" };
  const { prontas, incompletas } = classificarGuias([linha]);
  assert.deepEqual(prontas, [linha]);
  assert.equal(incompletas.length, 0);
});

test("motivosBloqueioLote: sem dados do prestador nem contrato do convênio, lista os dois motivos", () => {
  const motivos = motivosBloqueioLote({
    dadosPrestador: { cnes: null, cnpj: null },
    convenio: { codigo_prestador_na_operadora: null, numero_contrato: null },
  });
  assert.ok(motivos.includes("dados_prestador_incompletos"));
  assert.ok(motivos.includes("codigo_prestador_na_operadora_ausente"));
  assert.ok(motivos.includes("numero_contrato_ausente"));
});

test("motivosBloqueioLote: tudo preenchido, lista vazia", () => {
  const motivos = motivosBloqueioLote({
    dadosPrestador: { cnes: "123456", cnpj: null },
    convenio: { codigo_prestador_na_operadora: "PRESTADOR123", numero_contrato: "CT-001" },
  });
  assert.deepEqual(motivos, []);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/tissLoteModel.test.js`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implementar o model**

```js
// src/models/tissLoteModel.js
import { pool } from "../db/pool.js";

/**
 * Guias candidatas a um lote TISS: pagamentos com forma "convenio" do
 * convênio escolhido, dentro do período, já com a categoria
 * (avaliacao/sessao) e o código TUSS correspondente resolvidos via join —
 * mesma lógica de primeira_consulta usada no cálculo de repasse
 * (pagamentoModel.js): só agendamentos do bot têm essa coluna, importados
 * sempre contam como sessão. Pagamentos já estornados são excluídos (mesmo
 * padrão de estornado_por em guiaConvenioModel.js).
 */
export async function buscarGuiasConvenioPeriodo({ convenioId, inicio, fim }) {
  const { rows } = await pool.query(
    `SELECT
       pg.id AS pagamento_id, pg.valor,
       p.nome AS paciente_nome, p.matricula_convenio,
       COALESCE(a.tipo_atendimento, ai.tipo_atendimento) AS tipo_atendimento,
       COALESCE(a.data, ai.data) AS data_atendimento,
       CASE WHEN a.primeira_consulta IS TRUE THEN 'avaliacao' ELSE 'sessao' END AS categoria,
       tuss.codigo_tuss, tuss.descricao_tuss
     FROM pagamentos pg
     JOIN pacientes p ON p.id = pg.paciente_id
     LEFT JOIN agendamentos a ON a.id = pg.agendamento_id
     LEFT JOIN agendamentos_importados ai ON ai.id = pg.agendamento_importado_id
     LEFT JOIN pagamentos estorno ON estorno.pagamento_origem_id = pg.id
     LEFT JOIN convenio_procedimentos_tuss tuss
       ON tuss.convenio_id = p.convenio_id
       AND tuss.tipo_atendimento = COALESCE(a.tipo_atendimento, ai.tipo_atendimento)
       AND tuss.categoria = CASE WHEN a.primeira_consulta IS TRUE THEN 'avaliacao' ELSE 'sessao' END
     WHERE pg.forma_pagamento = 'convenio'
       AND pg.tipo_lancamento = 'pagamento'
       AND p.convenio_id = $1
       AND COALESCE(a.data, ai.data) BETWEEN $2 AND $3
       AND estorno.id IS NULL
     ORDER BY COALESCE(a.data, ai.data) ASC, pg.id ASC`,
    [convenioId, inicio, fim]
  );
  return rows;
}

/**
 * Nunca inventa dado: guia sem matrícula de convênio ou sem código TUSS
 * pra sua combinação (tipo_atendimento, categoria) fica de fora do lote,
 * com o motivo explícito — ver
 * docs/superpowers/specs/2026-09-04-tiss-eletronico-design.md.
 */
export function classificarGuias(linhas) {
  const prontas = [];
  const incompletas = [];
  for (const linha of linhas) {
    if (!linha.matricula_convenio) {
      incompletas.push({ ...linha, motivo: "paciente_sem_matricula" });
      continue;
    }
    if (!linha.codigo_tuss) {
      incompletas.push({ ...linha, motivo: "tuss_nao_cadastrado" });
      continue;
    }
    prontas.push(linha);
  }
  return { prontas, incompletas };
}

/**
 * Pré-requisitos de nível clínica/convênio (não por guia individual) —
 * ausência de qualquer um bloqueia a geração do lote inteiro.
 */
export function motivosBloqueioLote({ dadosPrestador, convenio }) {
  const motivos = [];
  if (!dadosPrestador?.cnes && !dadosPrestador?.cnpj) motivos.push("dados_prestador_incompletos");
  if (!convenio?.codigo_prestador_na_operadora) motivos.push("codigo_prestador_na_operadora_ausente");
  if (!convenio?.numero_contrato) motivos.push("numero_contrato_ausente");
  return motivos;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/tissLoteModel.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/models/tissLoteModel.js test/tissLoteModel.test.js
git commit -m "feat: model de busca e classificação de guias pro lote TISS"
```

---

## Task 10: Extrair `slugArquivo` e criar `tissXmlService.js`

**Files:**
- Create: `src/utils/slugArquivo.js`
- Modify: `src/controllers/dashboardController.js` (trocar a função local por import)
- Create: `src/services/tissXmlService.js`
- Test: `test/slugArquivo.test.js`, `test/tissXmlService.test.js`

**Interfaces:**
- Produces: `slugArquivo(texto: string): string` (movida de `dashboardController.js`, mesmo comportamento); `gerarXmlLoteTiss({dadosPrestador, convenio, guias, numeroLote, dataGeracao}): string` — usado por `tissController.js` (Task 11).

- [ ] **Step 1: Escrever o teste de `slugArquivo`**

```js
// test/slugArquivo.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { slugArquivo } from "../src/utils/slugArquivo.js";

test("slugArquivo: remove acento e normaliza pra minúsculo com hífen", () => {
  assert.equal(slugArquivo("João da Silva"), "joao-da-silva");
});

test("slugArquivo: texto vazio ou só símbolos devolve 'paciente'", () => {
  assert.equal(slugArquivo("!!!"), "paciente");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/slugArquivo.test.js`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Extrair a função pro util e atualizar `dashboardController.js`**

```js
// src/utils/slugArquivo.js

// Slug ASCII pro filename de arquivos gerados (guia, laudo, lote TISS) — um
// acento/aspas num nome real (comum em português) quebraria o header HTTP
// Content-Disposition se usado cru.
export function slugArquivo(texto) {
  return (
    texto
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "paciente"
  );
}
```

Em `src/controllers/dashboardController.js`: remover a definição local de `slugArquivo` (linhas ~953-963) e adicionar `import { slugArquivo } from "../utils/slugArquivo.js";` junto aos demais imports do topo do arquivo.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/slugArquivo.test.js && npm test`
Expected: PASS (incluindo os testes existentes que usam `gerarGuiaConvenio`/`gerarLaudo*`, que dependem indiretamente de `slugArquivo`)

- [ ] **Step 5: Commit**

```bash
git add src/utils/slugArquivo.js src/controllers/dashboardController.js test/slugArquivo.test.js
git commit -m "refactor: extrai slugArquivo pra util compartilhado"
```

- [ ] **Step 6: Escrever o teste de `tissXmlService`**

```js
// test/tissXmlService.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { gerarXmlLoteTiss } from "../src/services/tissXmlService.js";

const DADOS_PRESTADOR = { cnes: "123456", razao_social: "Clínica Exemplo", cnpj: "00.000.000/0001-00" };
const CONVENIO = { nome: "Mar Azul Saúde", codigo_prestador_na_operadora: "PRESTADOR123", numero_contrato: "CT-001" };
const GUIA = {
  numeroGuiaPrestador: "42",
  pacienteNome: "João da Silva",
  matriculaConvenio: "MAT123",
  tipoAtendimento: "fisioterapia",
  dataAtendimento: "2026-09-10",
  codigoTuss: "10101012",
  descricaoTuss: "Sessão de fisioterapia",
  valor: "80.00",
};

test("gerarXmlLoteTiss: inclui versão do padrão, dados do prestador e do convênio", () => {
  const xml = gerarXmlLoteTiss({ dadosPrestador: DADOS_PRESTADOR, convenio: CONVENIO, guias: [GUIA], numeroLote: "5-2026-09-01-2026-09-30", dataGeracao: "2026-09-04" });

  assert.match(xml, /<Padrao>3\.05\.00<\/Padrao>/);
  assert.match(xml, /<CNES>123456<\/CNES>/);
  assert.match(xml, /<codigoPrestadorNaOperadora>PRESTADOR123<\/codigoPrestadorNaOperadora>/);
  assert.match(xml, /<numeroContrato>CT-001<\/numeroContrato>/);
  assert.match(xml, /<numeroLote>5-2026-09-01-2026-09-30<\/numeroLote>/);
});

test("gerarXmlLoteTiss: monta uma guiaSP-SADT por guia, com procedimento e valor", () => {
  const xml = gerarXmlLoteTiss({ dadosPrestador: DADOS_PRESTADOR, convenio: CONVENIO, guias: [GUIA], numeroLote: "1", dataGeracao: "2026-09-04" });

  assert.match(xml, /<guiaSP-SADT>/);
  assert.match(xml, /<numeroGuiaPrestador>42<\/numeroGuiaPrestador>/);
  assert.match(xml, /<numeroCarteira>MAT123<\/numeroCarteira>/);
  assert.match(xml, /<nomeBeneficiario>Jo&#227;o da Silva<\/nomeBeneficiario>|<nomeBeneficiario>João da Silva<\/nomeBeneficiario>/);
  assert.match(xml, /<codigoProcedimento>10101012<\/codigoProcedimento>/);
  assert.match(xml, /<valorProcedimento>80\.00<\/valorProcedimento>/);
});

test("gerarXmlLoteTiss: campo ausente (matrícula null) é omitido, não vira string vazia nem 'null'", () => {
  const guiaSemMatricula = { ...GUIA, matriculaConvenio: null };
  const xml = gerarXmlLoteTiss({ dadosPrestador: DADOS_PRESTADOR, convenio: CONVENIO, guias: [guiaSemMatricula], numeroLote: "1", dataGeracao: "2026-09-04" });

  assert.doesNotMatch(xml, /<numeroCarteira>/);
  assert.doesNotMatch(xml, /null/);
});

test("gerarXmlLoteTiss: escapa caracteres especiais de XML no nome do paciente", () => {
  const guiaComEspecial = { ...GUIA, pacienteNome: 'Maria & "Ana" <Silva>' };
  const xml = gerarXmlLoteTiss({ dadosPrestador: DADOS_PRESTADOR, convenio: CONVENIO, guias: [guiaComEspecial], numeroLote: "1", dataGeracao: "2026-09-04" });

  assert.doesNotMatch(xml, /<Silva>/);
  assert.match(xml, /&amp;/);
  assert.match(xml, /&lt;Silva&gt;/);
});

test("gerarXmlLoteTiss: duas guias geram duas tags guiaSP-SADT", () => {
  const xml = gerarXmlLoteTiss({ dadosPrestador: DADOS_PRESTADOR, convenio: CONVENIO, guias: [GUIA, { ...GUIA, numeroGuiaPrestador: "43" }], numeroLote: "1", dataGeracao: "2026-09-04" });

  const ocorrencias = xml.match(/<guiaSP-SADT>/g) ?? [];
  assert.equal(ocorrencias.length, 2);
});
```

- [ ] **Step 7: Rodar e ver falhar**

Run: `node --test test/tissXmlService.test.js`
Expected: FAIL (módulo não existe)

- [ ] **Step 8: Implementar o serviço**

```js
// src/services/tissXmlService.js

// Versão do padrão TISS/ANS que este gerador segue. Ver
// docs/superpowers/specs/2026-09-04-tiss-eletronico-design.md — estrutura
// escrita manualmente por template string, sem validação contra o XSD
// oficial, e sem os campos tipicamente exigidos (sexo/CNS do paciente,
// CBO do profissional) que ainda não existem em nenhuma tabela do sistema.
const VERSAO_TISS = "3.05.00";
const CODIGO_TABELA_TUSS = "22";

function escaparXml(texto) {
  return String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Campo ausente (null/undefined/vazio) é omitido do XML — nunca vira tag
// vazia nem a string "null". Mesma regra de "nunca inventar dado" já usada
// nos serviços de PDF (laudoPdfService.js, guiaConvenioPdfService.js).
function tagOpcional(nome, valor) {
  if (valor === null || valor === undefined || valor === "") return "";
  return `<${nome}>${escaparXml(valor)}</${nome}>`;
}

function montarGuiaSpSadt(guia) {
  return `
        <guiaSP-SADT>
          <cabecalhoGuia>
            <numeroGuiaPrestador>${escaparXml(guia.numeroGuiaPrestador)}</numeroGuiaPrestador>
          </cabecalhoGuia>
          <dadosBeneficiario>
            ${tagOpcional("numeroCarteira", guia.matriculaConvenio)}
            <nomeBeneficiario>${escaparXml(guia.pacienteNome)}</nomeBeneficiario>
          </dadosBeneficiario>
          <dadosAtendimento>
            <tipoAtendimento>${escaparXml(guia.tipoAtendimento)}</tipoAtendimento>
            <dataAtendimento>${escaparXml(guia.dataAtendimento)}</dataAtendimento>
          </dadosAtendimento>
          <procedimentosExecutados>
            <procedimento>
              <codigoTabela>${CODIGO_TABELA_TUSS}</codigoTabela>
              <codigoProcedimento>${escaparXml(guia.codigoTuss)}</codigoProcedimento>
              ${tagOpcional("descricaoProcedimento", guia.descricaoTuss)}
              <valorProcedimento>${escaparXml(guia.valor)}</valorProcedimento>
            </procedimento>
          </procedimentosExecutados>
          <valorTotal>
            <valorTotalGeral>${escaparXml(guia.valor)}</valorTotalGeral>
          </valorTotal>
        </guiaSP-SADT>`;
}

/**
 * Monta o XML de um lote de guias SP/SADT — função pura, sem I/O, mesmo
 * padrão dos serviços de PDF (recebe dados já resolvidos pelo model,
 * devolve string pronta pra resposta HTTP).
 */
export function gerarXmlLoteTiss({ dadosPrestador, convenio, guias, numeroLote, dataGeracao }) {
  const guiasXml = guias.map(montarGuiaSpSadt).join("");

  return `<?xml version="1.0" encoding="ISO-8859-1"?>
<mensagemTISS>
  <cabecalho>
    <identificacaoTransacao>
      <tipoTransacao>ENVIO_LOTE_GUIAS</tipoTransacao>
      <dataRegistroTransacao>${escaparXml(dataGeracao)}</dataRegistroTransacao>
    </identificacaoTransacao>
    <origem>
      <identificacaoPrestador>
        ${tagOpcional("CNES", dadosPrestador?.cnes)}
        ${tagOpcional("razaoSocial", dadosPrestador?.razao_social)}
        ${tagOpcional("CNPJ", dadosPrestador?.cnpj)}
        ${tagOpcional("codigoPrestadorNaOperadora", convenio.codigo_prestador_na_operadora)}
      </identificacaoPrestador>
    </origem>
    <destino>
      <nomeOperadora>${escaparXml(convenio.nome)}</nomeOperadora>
      ${tagOpcional("numeroContrato", convenio.numero_contrato)}
    </destino>
    <Padrao>${VERSAO_TISS}</Padrao>
  </cabecalho>
  <prestadorParaOperadora>
    <loteGuias>
      <numeroLote>${escaparXml(numeroLote)}</numeroLote>
      <guiasTISS>${guiasXml}
      </guiasTISS>
    </loteGuias>
  </prestadorParaOperadora>
</mensagemTISS>
`;
}
```

- [ ] **Step 9: Rodar e ver passar**

Run: `node --test test/tissXmlService.test.js`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/services/tissXmlService.js test/tissXmlService.test.js
git commit -m "feat: serviço de geração do XML de lote TISS (guia SP/SADT)"
```

---

## Task 11: Controller de geração do lote TISS

**Files:**
- Create: `src/controllers/tissController.js`
- Test: `test/tissController.test.js`

**Interfaces:**
- Consumes: `listarConvenios`, `buscarConvenioPorId` de `../models/convenioModel.js`; `buscarDadosPrestador` de `../models/dadosPrestadorModel.js` (Task 2); `buscarGuiasConvenioPeriodo`, `classificarGuias`, `motivosBloqueioLote` de `../models/tissLoteModel.js` (Task 9); `gerarXmlLoteTiss` de `../services/tissXmlService.js` (Task 10); `slugArquivo` de `../utils/slugArquivo.js` (Task 10); `idSeguro` de `../utils/paginacao.js`; `validarData` de `../utils/validacao.js`; `dayjs` de `../utils/dayjs.js`.
- Produces: `telaTiss(req, res, deps = {})`, `gerarLoteTiss(req, res, deps = {})` — usados nas rotas da Task 12.

- [ ] **Step 1: Escrever o teste**

```js
// test/tissController.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { telaTiss, gerarLoteTiss } from "../src/controllers/tissController.js";

function criarRespostaFalsa() {
  return {
    statusCode: 200,
    corpo: null,
    headers: {},
    viewRenderizada: null,
    dadosDaView: null,
    status(code) { this.statusCode = code; return this; },
    send(corpo) { this.corpo = corpo; return this; },
    setHeader(nome, valor) { this.headers[nome] = valor; },
    render(view, dados) { this.viewRenderizada = view; this.dadosDaView = dados; },
  };
}

const CONVENIO = { id: 5, nome: "Mar Azul Saúde", codigo_prestador_na_operadora: "PRESTADOR123", numero_contrato: "CT-001" };
const PRESTADOR = { cnes: "123456", razao_social: "Clínica Exemplo", cnpj: null };
const GUIA_PRONTA = { pagamento_id: 1, matricula_convenio: "MAT123", codigo_tuss: "10101012", descricao_tuss: "Sessão", paciente_nome: "João", tipo_atendimento: "fisioterapia", data_atendimento: "2026-09-10", valor: "80.00" };

test("telaTiss: sem parâmetros, renderiza só o formulário (sem preview)", async () => {
  const res = criarRespostaFalsa();
  await telaTiss(
    { query: {} },
    res,
    { listarConvenios: async () => [CONVENIO] }
  );

  assert.equal(res.viewRenderizada, "financeiro/tiss");
  assert.equal(res.dadosDaView.preview, null);
});

test("telaTiss: com parâmetros válidos, monta o preview com prontas/incompletas/motivosBloqueio", async () => {
  const res = criarRespostaFalsa();
  await telaTiss(
    { query: { convenioId: "5", inicio: "2026-09-01", fim: "2026-09-30" } },
    res,
    {
      listarConvenios: async () => [CONVENIO],
      buscarConvenio: async () => CONVENIO,
      buscarPrestador: async () => PRESTADOR,
      buscarGuias: async () => [GUIA_PRONTA],
    }
  );

  assert.equal(res.dadosDaView.preview.prontas.length, 1);
  assert.equal(res.dadosDaView.preview.incompletas.length, 0);
  assert.deepEqual(res.dadosDaView.preview.motivosBloqueio, []);
});

test("telaTiss: convênio inexistente responde 404", async () => {
  const res = criarRespostaFalsa();
  await telaTiss(
    { query: { convenioId: "5", inicio: "2026-09-01", fim: "2026-09-30" } },
    res,
    { listarConvenios: async () => [], buscarConvenio: async () => null }
  );

  assert.equal(res.statusCode, 404);
});

test("gerarLoteTiss: parâmetros ausentes respondem 400", async () => {
  const res = criarRespostaFalsa();
  await gerarLoteTiss({ query: {} }, res, {});
  assert.equal(res.statusCode, 400);
});

test("gerarLoteTiss: dados de prestador/convênio incompletos respondem 400 sem gerar XML", async () => {
  const res = criarRespostaFalsa();
  let gerou = false;
  await gerarLoteTiss(
    { query: { convenioId: "5", inicio: "2026-09-01", fim: "2026-09-30" } },
    res,
    {
      buscarConvenio: async () => ({ ...CONVENIO, numero_contrato: null }),
      buscarPrestador: async () => PRESTADOR,
      buscarGuias: async () => [GUIA_PRONTA],
      gerarXml: () => { gerou = true; return "<xml/>"; },
    }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(gerou, false);
});

test("gerarLoteTiss: nenhuma guia pronta no período responde 400 sem gerar XML", async () => {
  const res = criarRespostaFalsa();
  let gerou = false;
  await gerarLoteTiss(
    { query: { convenioId: "5", inicio: "2026-09-01", fim: "2026-09-30" } },
    res,
    {
      buscarConvenio: async () => CONVENIO,
      buscarPrestador: async () => PRESTADOR,
      buscarGuias: async () => [],
      gerarXml: () => { gerou = true; return "<xml/>"; },
    }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(gerou, false);
});

test("gerarLoteTiss: caminho feliz responde XML com Content-Disposition correto", async () => {
  const res = criarRespostaFalsa();
  let dadosPassadosPraXml = null;
  await gerarLoteTiss(
    { query: { convenioId: "5", inicio: "2026-09-01", fim: "2026-09-30" } },
    res,
    {
      buscarConvenio: async () => CONVENIO,
      buscarPrestador: async () => PRESTADOR,
      buscarGuias: async () => [GUIA_PRONTA],
      gerarXml: (dados) => { dadosPassadosPraXml = dados; return "<xml>ok</xml>"; },
    }
  );

  assert.equal(res.corpo, "<xml>ok</xml>");
  assert.equal(res.headers["Content-Type"], "application/xml");
  assert.match(res.headers["Content-Disposition"], /attachment; filename="tiss-lote-mar-azul-saude-2026-09-01-2026-09-30\.xml"/);
  assert.equal(dadosPassadosPraXml.guias[0].numeroGuiaPrestador, "1");
  assert.equal(dadosPassadosPraXml.guias[0].codigoTuss, "10101012");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/tissController.test.js`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implementar o controller**

```js
// src/controllers/tissController.js
import { listarConvenios, buscarConvenioPorId } from "../models/convenioModel.js";
import { buscarDadosPrestador } from "../models/dadosPrestadorModel.js";
import {
  buscarGuiasConvenioPeriodo,
  classificarGuias,
  motivosBloqueioLote,
} from "../models/tissLoteModel.js";
import { gerarXmlLoteTiss } from "../services/tissXmlService.js";
import { slugArquivo } from "../utils/slugArquivo.js";
import { idSeguro } from "../utils/paginacao.js";
import { validarData } from "../utils/validacao.js";
import dayjs from "../utils/dayjs.js";

function parametrosPeriodo(query) {
  const convenioId = idSeguro(query.convenioId);
  const inicio = validarData(query.inicio) ? query.inicio : null;
  const fim = validarData(query.fim) ? query.fim : null;
  return { convenioId, inicio, fim };
}

export async function telaTiss(
  req,
  res,
  {
    listarConvenios: listar = listarConvenios,
    buscarConvenio = buscarConvenioPorId,
    buscarPrestador = buscarDadosPrestador,
    buscarGuias = buscarGuiasConvenioPeriodo,
  } = {}
) {
  const convenios = await listar({ apenasAtivos: true });
  const { convenioId, inicio, fim } = parametrosPeriodo(req.query ?? {});

  if (!convenioId || !inicio || !fim) {
    return res.render("financeiro/tiss", {
      convenios,
      convenioId: req.query?.convenioId ?? "",
      inicio: req.query?.inicio ?? "",
      fim: req.query?.fim ?? "",
      preview: null,
    });
  }

  const convenio = await buscarConvenio(convenioId);
  if (!convenio) return res.status(404).send("Convênio não encontrado.");

  const [dadosPrestador, linhas] = await Promise.all([
    buscarPrestador(),
    buscarGuias({ convenioId, inicio, fim }),
  ]);

  const { prontas, incompletas } = classificarGuias(linhas);
  const motivosBloqueio = motivosBloqueioLote({ dadosPrestador, convenio });

  res.render("financeiro/tiss", {
    convenios,
    convenioId: String(convenioId),
    inicio,
    fim,
    preview: { convenio, prontas, incompletas, motivosBloqueio },
  });
}

export async function gerarLoteTiss(
  req,
  res,
  {
    buscarConvenio = buscarConvenioPorId,
    buscarPrestador = buscarDadosPrestador,
    buscarGuias = buscarGuiasConvenioPeriodo,
    gerarXml = gerarXmlLoteTiss,
  } = {}
) {
  const { convenioId, inicio, fim } = parametrosPeriodo(req.query ?? {});
  if (!convenioId || !inicio || !fim) {
    return res.status(400).send("Parâmetros inválidos.");
  }

  const convenio = await buscarConvenio(convenioId);
  if (!convenio) return res.status(404).send("Convênio não encontrado.");

  const [dadosPrestador, linhas] = await Promise.all([
    buscarPrestador(),
    buscarGuias({ convenioId, inicio, fim }),
  ]);

  const motivosBloqueio = motivosBloqueioLote({ dadosPrestador, convenio });
  if (motivosBloqueio.length > 0) {
    return res.status(400).send("Dados do prestador/convênio incompletos para gerar o lote.");
  }

  const { prontas } = classificarGuias(linhas);
  if (prontas.length === 0) {
    return res.status(400).send("Nenhuma guia pronta no período selecionado.");
  }

  const guias = prontas.map((linha) => ({
    numeroGuiaPrestador: String(linha.pagamento_id),
    pacienteNome: linha.paciente_nome,
    matriculaConvenio: linha.matricula_convenio,
    tipoAtendimento: linha.tipo_atendimento,
    dataAtendimento: linha.data_atendimento,
    codigoTuss: linha.codigo_tuss,
    descricaoTuss: linha.descricao_tuss,
    valor: linha.valor,
  }));

  const xml = gerarXml({
    dadosPrestador,
    convenio,
    guias,
    numeroLote: `${convenioId}-${inicio}-${fim}`,
    dataGeracao: dayjs().format("YYYY-MM-DD"),
  });

  const nomeArquivo = `tiss-lote-${slugArquivo(convenio.nome)}-${inicio}-${fim}.xml`;
  res.setHeader("Content-Type", "application/xml");
  res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo}"`);
  res.send(xml);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/tissController.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/controllers/tissController.js test/tissController.test.js
git commit -m "feat: controller de geração do lote TISS"
```

---

## Task 12: Tela e rotas do lote TISS

**Files:**
- Create: `src/views/financeiro/tiss.ejs`
- Modify: `src/views/financeiro/lista.ejs` (link de entrada)
- Modify: `src/routes/dashboardRoutes.js`
- Test: `test/financeiroTissView.test.js`

**Interfaces:**
- Consumes: `telaTiss`, `gerarLoteTiss` (Task 11).

- [ ] **Step 1: Escrever o teste da view**

```js
// test/financeiroTissView.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import ejs from "ejs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VIEWS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/views");

async function renderizar(dados) {
  return ejs.renderFile(path.join(VIEWS_DIR, "financeiro/tiss.ejs"), {
    convenios: [{ id: 5, nome: "Mar Azul Saúde" }],
    convenioId: "",
    inicio: "",
    fim: "",
    preview: null,
    ...dados,
  });
}

test("financeiro/tiss: sem preview, mostra só o formulário", async () => {
  const html = await renderizar({});
  assert.match(html, /name="convenioId"/);
  assert.match(html, /name="inicio"/);
  assert.match(html, /name="fim"/);
  assert.doesNotMatch(html, /Gerar XML do lote/);
});

test("financeiro/tiss: com preview e sem motivos de bloqueio, mostra contagens e botão habilitado", async () => {
  const html = await renderizar({
    convenioId: "5", inicio: "2026-09-01", fim: "2026-09-30",
    preview: {
      convenio: { id: 5, nome: "Mar Azul Saúde" },
      prontas: [{ pagamento_id: 1 }],
      incompletas: [{ pagamento_id: 2, motivo: "tuss_nao_cadastrado" }],
      motivosBloqueio: [],
    },
  });

  assert.match(html, /1 guia[s]? pronta/i);
  assert.match(html, /1 guia[s]? incompleta/i);
  assert.match(html, /tuss_nao_cadastrado|C.{1,20}digo TUSS n.{1,3}o cadastrado/i);
  assert.match(html, /href="\/financeiro\/tiss\/lote\?convenioId=5&inicio=2026-09-01&fim=2026-09-30"/);
});

test("financeiro/tiss: com motivo de bloqueio, não mostra o link de gerar", async () => {
  const html = await renderizar({
    convenioId: "5", inicio: "2026-09-01", fim: "2026-09-30",
    preview: {
      convenio: { id: 5, nome: "Mar Azul Saúde" },
      prontas: [],
      incompletas: [],
      motivosBloqueio: ["numero_contrato_ausente"],
    },
  });

  assert.doesNotMatch(html, /\/financeiro\/tiss\/lote\?/);
  assert.match(html, /n.mero.{1,3}de contrato/i);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/financeiroTissView.test.js`
Expected: FAIL (view não existe)

- [ ] **Step 3: Criar a view**

```html
<!-- src/views/financeiro/tiss.ejs -->
<%- include("../partials/header", { titulo: "TISS eletrônico" }) %>
<header class="page-header">
  <div>
    <h1>TISS eletrônico — lote de guias</h1>
    <p>Gera o XML de lote de guias SP/SADT pra upload manual no portal do convênio.</p>
  </div>
  <a class="button button--quiet" href="/financeiro">Voltar</a>
</header>

<form class="focused-form" method="get" action="/financeiro/tiss">
  <div class="form-grid">
    <label>Convênio
      <select name="convenioId" required>
        <option value="">Selecione</option>
        <% convenios.forEach(function (c) { %>
        <option value="<%= c.id %>" <%= String(c.id) === convenioId ? 'selected' : '' %>><%= c.nome %></option>
        <% }) %>
      </select>
    </label>
    <label>Início<input type="date" name="inicio" value="<%= inicio %>" required /></label>
    <label>Fim<input type="date" name="fim" value="<%= fim %>" required /></label>
  </div>
  <div class="toolbar">
    <button type="submit">Consultar</button>
  </div>
</form>

<% if (preview) { %>
<section>
  <h2><%= preview.convenio.nome %> — <%= preview.prontas.length %> guia<%= preview.prontas.length === 1 ? '' : 's' %> pronta<%= preview.prontas.length === 1 ? '' : 's' %>, <%= preview.incompletas.length %> guia<%= preview.incompletas.length === 1 ? '' : 's' %> incompleta<%= preview.incompletas.length === 1 ? '' : 's' %></h2>

  <% if (preview.motivosBloqueio.length > 0) { %>
  <p class="erro">
    Não é possível gerar o lote — faltam dados de cadastro:
    <ul>
      <% if (preview.motivosBloqueio.includes('dados_prestador_incompletos')) { %>
      <li>Dados do prestador (CNES/CNPJ) — <a href="/configuracoes/prestador">cadastrar</a>.</li>
      <% } %>
      <% if (preview.motivosBloqueio.includes('codigo_prestador_na_operadora_ausente')) { %>
      <li>Código do prestador na operadora — <a href="/convenios/<%= preview.convenio.id %>/editar">cadastrar no convênio</a>.</li>
      <% } %>
      <% if (preview.motivosBloqueio.includes('numero_contrato_ausente')) { %>
      <li>Número de contrato — <a href="/convenios/<%= preview.convenio.id %>/editar">cadastrar no convênio</a>.</li>
      <% } %>
    </ul>
  </p>
  <% } else if (preview.prontas.length > 0) { %>
  <p class="toolbar">
    <a class="button" href="/financeiro/tiss/lote?convenioId=<%= convenioId %>&inicio=<%= inicio %>&fim=<%= fim %>">Gerar XML do lote</a>
  </p>
  <% } else { %>
  <p>Nenhuma guia pronta no período selecionado.</p>
  <% } %>

  <% if (preview.incompletas.length > 0) { %>
  <h3>Guias incompletas (fora do lote)</h3>
  <ul>
    <% preview.incompletas.forEach(function (g) { %>
    <li>
      Pagamento #<%= g.pagamento_id %> —
      <%= g.motivo === 'paciente_sem_matricula' ? 'paciente sem matrícula de convênio' : 'código TUSS não cadastrado para esse tipo de atendimento/categoria' %>
    </li>
    <% }) %>
  </ul>
  <% } %>
</section>
<% } %>
<%- include("../partials/footer") %>
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/financeiroTissView.test.js`
Expected: PASS

- [ ] **Step 5: Adicionar o link em `financeiro/lista.ejs`**

Em `src/views/financeiro/lista.ejs`, no `page-header`, ao lado do link existente pra `/financeiro/relatorio`:

```html
<header class="page-header">
  <div>
    <h1>Financeiro</h1>
    <p class="agenda-summary"><%= itens.length %> atendimento(s) nesta página</p>
  </div>
  <a class="button button--quiet" href="/financeiro/relatorio">Ver relatório mensal</a>
  <a class="button button--quiet" href="/financeiro/tiss">TISS eletrônico</a>
</header>
```

- [ ] **Step 6: Adicionar as rotas**

Em `src/routes/dashboardRoutes.js`, adicionar ao bloco de imports:

```js
import { telaTiss, gerarLoteTiss } from "../controllers/tissController.js";
```

E, próximo às rotas de `/financeiro/relatorio`:

```js
router.get("/financeiro/tiss", asyncHandler(exigirLogin), asyncHandler(telaTiss));
router.get("/financeiro/tiss/lote", asyncHandler(exigirLogin), asyncHandler(gerarLoteTiss));
```

- [ ] **Step 7: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/views/financeiro/tiss.ejs src/views/financeiro/lista.ejs src/routes/dashboardRoutes.js test/financeiroTissView.test.js
git commit -m "feat: tela e rotas de geração do lote TISS (/financeiro/tiss)"
```

---

## Task 13: Verificação final

**Files:** nenhum arquivo novo — só validação.

- [ ] **Step 1: Rodar a suíte completa**

Run: `npm test`
Expected: PASS (todos os testes, incluindo os de todas as tasks anteriores)

- [ ] **Step 2: Rodar o lint**

Run: `npm run lint`
Expected: sem erros

- [ ] **Step 3: Subir o servidor localmente e checar visualmente o fluxo novo**

Run: `npm start` (ou o comando de dev já usado no projeto)

Checklist manual:
- `/configuracoes/prestador` abre só pra administradora, salva e mostra "Alteração salva com sucesso".
- `/convenios/:id/editar` mostra a seção nova de dados TISS e as 4 linhas de TUSS, salva e volta pra `/convenios`.
- `/financeiro/tiss` sem parâmetros mostra só o formulário; com convênio+período preenchidos mostra prontas/incompletas; com dados de prestador/convênio incompletos, mostra o aviso de bloqueio em vez do botão de gerar.
- `/financeiro/tiss/lote?...` baixa um arquivo `.xml` com o conteúdo esperado.

- [ ] **Step 4: Nenhum commit nesta task** (é só checkpoint de verificação — se algo falhar, corrigir na task correspondente e recomitar lá).
