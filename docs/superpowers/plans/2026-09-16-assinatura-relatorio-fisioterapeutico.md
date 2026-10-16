# Assinatura eletrônica no relatório fisioterapêutico — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o relatório fisioterapêutico (PDF/DOCX) sair com a assinatura do fisioterapeuta embutida, em vez de uma linha em branco pra assinar no papel.

**Architecture:** Novo cadastro `/fisioterapeutas` (espelha o padrão já existente de `/psicologos`), com upload de uma imagem de assinatura guardada como `BYTEA` no Postgres, escrita restrita a `administradora`. O formulário do relatório fisioterapêutico passa a escolher o profissional num `<select>` (em vez de texto livre), e a geração do PDF/DOCX busca a assinatura atual do fisioterapeuta selecionado e a embute no documento — com fallback automático pra linha em branco quando o fisioterapeuta ainda não tem assinatura cadastrada, ou quando o relatório é antigo (anterior a esta feature).

**Tech Stack:** Node.js/Express, EJS, PostgreSQL (`pg`), `pdfkit`, `docx`, `multer` (nova dependência), `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-16-assinatura-relatorio-fisioterapeutico-design.md`

## Global Constraints

- Rotas de escrita de `/fisioterapeutas` (`novo`, `editar`, `desativar`, `reativar`) exigem `exigirPapel("administradora")`. A listagem (`GET /fisioterapeutas`) fica aberta a qualquer usuário logado.
- Upload de imagem: só `image/png` ou `image/jpeg`, limite de 2MB.
- Sem assinatura cadastrada para o fisioterapeuta escolhido → documento cai no comportamento atual (linha em branco), nunca quebra a geração.
- Relatórios já existentes (antes desta feature) não são migrados retroativamente — continuam exibindo o texto livre que já têm, sem assinatura.
- Este projeto **não tem banco de dev separado** — o `DATABASE_URL` local aponta pro mesmo Neon de produção. A migration 040 só deve ser aplicada contra o banco real com autorização explícita do usuário, nunca como parte da execução automática das tarefas abaixo (ver Tarefa 13).
- Rodar `npm test` e `npm run lint` a cada tarefa antes de commitar — mesma convenção já usada no resto do projeto.

---

### Task 1: Migration 040 — tabela `fisioterapeutas` + coluna `fisioterapeuta_id`

**Files:**
- Create: `src/db/migrations/040_fisioterapeutas.sql`

**Interfaces:**
- Produces: tabela `fisioterapeutas (id, nome, crefito, ativo, assinatura_imagem, assinatura_mime, created_at)`; coluna nova `relatorios_fisioterapeuticos.fisioterapeuta_id INTEGER REFERENCES fisioterapeutas(id)`, nullable. Consumida por todas as tarefas seguintes.

Este projeto não tem teste automatizado de migration (nenhuma das 039 anteriores tem) — a migration é só escrita e revisada aqui; a aplicação real contra o Neon fica pra Tarefa 13, com autorização explícita.

- [ ] **Step 1: Escrever a migration**

```sql
-- src/db/migrations/040_fisioterapeutas.sql
-- Clínica Exemplo Bot — migration 040: cadastro de fisioterapeutas com assinatura eletrônica
--
-- Cadastro leve de fisioterapeutas da clínica (nome, Crefito, imagem de
-- assinatura), no mesmo espírito do cadastro de psicólogos (migration 024),
-- com um campo a mais: a imagem da assinatura (BYTEA), pra embutir
-- automaticamente no relatório fisioterapêutico em vez de deixar uma linha
-- em branco pra assinar no papel. Ver spec:
-- docs/superpowers/specs/2026-09-16-assinatura-relatorio-fisioterapeutico-design.md
--
-- crefito e os dois campos de assinatura são nullable — o cadastro pode
-- existir antes de a imagem ser enviada; nesse caso o relatório continua
-- caindo no comportamento atual (linha em branco).
CREATE TABLE IF NOT EXISTS fisioterapeutas (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  crefito TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  assinatura_imagem BYTEA,
  assinatura_mime TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Liga um relatório ao fisioterapeuta selecionado no formulário, pra buscar
-- a assinatura atual dele na hora de gerar o PDF/DOCX. Nullable e sem
-- retroatividade: relatórios já existentes ficam com essa coluna NULL e
-- continuam sendo gerados exatamente como hoje (profissional_responsavel
-- em texto solto, sem assinatura).
ALTER TABLE relatorios_fisioterapeuticos
  ADD COLUMN IF NOT EXISTS fisioterapeuta_id INTEGER REFERENCES fisioterapeutas(id);
```

- [ ] **Step 2: Revisar visualmente contra as migrations 024 e 039** (mesmo estilo: sem bloco RLS/REVOKE — esse padrão parou de ser usado depois da migration 009, confirmado ao olhar 024 e 039 antes de escrever esta).

- [ ] **Step 3: Commit**

```bash
git add src/db/migrations/040_fisioterapeutas.sql
git commit -m "feat: migration 040 — cadastro de fisioterapeutas com assinatura"
```

---

### Task 2: `fisioterapeutaModel.js`

**Files:**
- Create: `src/models/fisioterapeutaModel.js`
- Test: `test/fisioterapeutaModel.test.js`

**Interfaces:**
- Consumes: `pool` de `src/db/pool.js` (mesmo padrão de `psicologoModel.js`).
- Produces (usado pela Tarefa 4 e pela Tarefa 10):
  - `listarFisioterapeutas({ apenasAtivos = true }) => Promise<Array<{id, nome, crefito, ativo, createdAt, temAssinatura}>>`
  - `buscarFisioterapeutaPorId(id) => Promise<{id, nome, crefito, ativo, createdAt, temAssinatura} | null>`
  - `buscarAssinaturaFisioterapeuta(id) => Promise<{assinaturaImagem: Buffer, assinaturaMime: string} | null>` (null se o fisioterapeuta não existe, está inativo, ou não tem imagem)
  - `criarFisioterapeuta({nome, crefito, assinaturaImagem, assinaturaMime}) => Promise<{id, nome, crefito, ativo, createdAt, temAssinatura}>`
  - `atualizarFisioterapeuta(id, {nome, crefito}) => Promise<{...} | null>`
  - `atualizarAssinaturaFisioterapeuta(id, {assinaturaImagem, assinaturaMime}) => Promise<void>`
  - `definirAtivoFisioterapeuta(id, ativo) => Promise<{id, nome, crefito, ativo} | null>`

- [ ] **Step 1: Escrever os testes (mockando `pool.query`, mesmo padrão de `psicologoModel.test.js`)**

```javascript
// test/fisioterapeutaModel.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import {
  listarFisioterapeutas,
  buscarFisioterapeutaPorId,
  buscarAssinaturaFisioterapeuta,
  criarFisioterapeuta,
  atualizarFisioterapeuta,
  atualizarAssinaturaFisioterapeuta,
  definirAtivoFisioterapeuta,
} from "../src/models/fisioterapeutaModel.js";

test("listarFisioterapeutas por padrão só busca ativos e mapeia temAssinatura", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    assert.match(sql, /WHERE ativo = true/i);
    return {
      rows: [{ id: 1, nome: "Ana", crefito: "1234-F", ativo: true, created_at: "2026-09-01", tem_assinatura: true }],
    };
  });

  const resultado = await listarFisioterapeutas();

  assert.deepEqual(resultado, [
    { id: 1, nome: "Ana", crefito: "1234-F", ativo: true, createdAt: "2026-09-01", temAssinatura: true },
  ]);
});

test("listarFisioterapeutas({ apenasAtivos: false }) busca todos", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    assert.doesNotMatch(sql, /WHERE ativo = true/i);
    return { rows: [] };
  });

  await listarFisioterapeutas({ apenasAtivos: false });
});

test("buscarFisioterapeutaPorId: retorna null quando não encontrado", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await buscarFisioterapeutaPorId(99);
  assert.equal(resultado, null);
});

test("buscarFisioterapeutaPorId: mapeia temAssinatura=false quando não há imagem", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 5, nome: "Bia", crefito: null, ativo: true, created_at: "2026-09-01", tem_assinatura: false }],
  }));

  const resultado = await buscarFisioterapeutaPorId(5);
  assert.equal(resultado.temAssinatura, false);
  assert.equal(resultado.crefito, null);
});

test("buscarAssinaturaFisioterapeuta: retorna null quando não há linha", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await buscarAssinaturaFisioterapeuta(99);
  assert.equal(resultado, null);
});

test("buscarAssinaturaFisioterapeuta: retorna null quando a coluna assinatura_imagem está vazia", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ assinatura_imagem: null, assinatura_mime: null }] }));

  const resultado = await buscarAssinaturaFisioterapeuta(5);
  assert.equal(resultado, null);
});

test("buscarAssinaturaFisioterapeuta: filtra por ativo=true na query", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    assert.match(sql, /AND ativo = true/i);
    return { rows: [] };
  });

  await buscarAssinaturaFisioterapeuta(5);
});

test("buscarAssinaturaFisioterapeuta: retorna a imagem e o mime quando presentes", async (t) => {
  const bufferFalso = Buffer.from("imagem-fake");
  t.mock.method(pool, "query", async () => ({
    rows: [{ assinatura_imagem: bufferFalso, assinatura_mime: "image/png" }],
  }));

  const resultado = await buscarAssinaturaFisioterapeuta(5);
  assert.deepEqual(resultado, { assinaturaImagem: bufferFalso, assinaturaMime: "image/png" });
});

test("criarFisioterapeuta: envia nome, crefito e assinatura na query e mapeia o retorno", async (t) => {
  let parametrosRecebidos = null;
  t.mock.method(pool, "query", async (_sql, parametros) => {
    parametrosRecebidos = parametros;
    return {
      rows: [{ id: 10, nome: "Carla", crefito: "5555-F", ativo: true, created_at: "2026-09-16", tem_assinatura: true }],
    };
  });

  const bufferFalso = Buffer.from("assinatura");
  const resultado = await criarFisioterapeuta({
    nome: "Carla", crefito: "5555-F", assinaturaImagem: bufferFalso, assinaturaMime: "image/png",
  });

  assert.deepEqual(parametrosRecebidos, ["Carla", "5555-F", bufferFalso, "image/png"]);
  assert.equal(resultado.id, 10);
  assert.equal(resultado.temAssinatura, true);
});

test("criarFisioterapeuta: funciona sem assinatura (campos opcionais)", async (t) => {
  let parametrosRecebidos = null;
  t.mock.method(pool, "query", async (_sql, parametros) => {
    parametrosRecebidos = parametros;
    return {
      rows: [{ id: 11, nome: "Duda", crefito: null, ativo: true, created_at: "2026-09-16", tem_assinatura: false }],
    };
  });

  await criarFisioterapeuta({ nome: "Duda", crefito: null });

  assert.deepEqual(parametrosRecebidos, ["Duda", null, null, null]);
});

test("atualizarFisioterapeuta: atualiza só nome e crefito, sem mexer na assinatura", async (t) => {
  let sqlRecebido = null;
  let parametrosRecebidos = null;
  t.mock.method(pool, "query", async (sql, parametros) => {
    sqlRecebido = sql;
    parametrosRecebidos = parametros;
    return {
      rows: [{ id: 5, nome: "Ana Corrigida", crefito: "9999-F", ativo: true, created_at: "2026-09-01", tem_assinatura: true }],
    };
  });

  await atualizarFisioterapeuta(5, { nome: "Ana Corrigida", crefito: "9999-F" });

  assert.doesNotMatch(sqlRecebido, /assinatura_imagem/);
  assert.deepEqual(parametrosRecebidos, [5, "Ana Corrigida", "9999-F"]);
});

test("atualizarAssinaturaFisioterapeuta: envia id, imagem e mime na query", async (t) => {
  let parametrosRecebidos = null;
  t.mock.method(pool, "query", async (_sql, parametros) => {
    parametrosRecebidos = parametros;
    return { rows: [] };
  });

  const bufferFalso = Buffer.from("nova-assinatura");
  await atualizarAssinaturaFisioterapeuta(5, { assinaturaImagem: bufferFalso, assinaturaMime: "image/jpeg" });

  assert.deepEqual(parametrosRecebidos, [5, bufferFalso, "image/jpeg"]);
});

test("definirAtivoFisioterapeuta: envia id e ativo, retorna null se não encontrado", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await definirAtivoFisioterapeuta(99, false);
  assert.equal(resultado, null);
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham** (módulo `fisioterapeutaModel.js` ainda não existe)

Run: `node --test test/fisioterapeutaModel.test.js`
Expected: FAIL com erro de módulo não encontrado.

- [ ] **Step 3: Implementar `src/models/fisioterapeutaModel.js`**

```javascript
import { pool } from "../db/pool.js";

function mapearFisioterapeuta(registro) {
  return {
    id: registro.id,
    nome: registro.nome,
    crefito: registro.crefito,
    ativo: registro.ativo,
    createdAt: registro.created_at,
    temAssinatura: registro.tem_assinatura,
  };
}

const COLUNAS_LISTAGEM = `id, nome, crefito, ativo, created_at, (assinatura_imagem IS NOT NULL) AS tem_assinatura`;

export async function listarFisioterapeutas({ apenasAtivos = true } = {}) {
  const filtro = apenasAtivos ? "WHERE ativo = true " : "";
  const { rows } = await pool.query(
    `SELECT ${COLUNAS_LISTAGEM} FROM fisioterapeutas ${filtro}ORDER BY nome ASC`
  );
  return rows.map(mapearFisioterapeuta);
}

export async function buscarFisioterapeutaPorId(id) {
  const { rows } = await pool.query(
    `SELECT ${COLUNAS_LISTAGEM} FROM fisioterapeutas WHERE id = $1`,
    [id]
  );
  return rows[0] ? mapearFisioterapeuta(rows[0]) : null;
}

/**
 * Separada de buscarFisioterapeutaPorId pra não puxar o BYTEA da imagem
 * (pode ser grande) em toda listagem/edição — só quando de fato vai
 * embutir a assinatura num documento ou servir o preview.
 */
export async function buscarAssinaturaFisioterapeuta(id) {
  const { rows } = await pool.query(
    "SELECT assinatura_imagem, assinatura_mime FROM fisioterapeutas WHERE id = $1 AND ativo = true",
    [id]
  );
  const registro = rows[0];
  if (!registro || !registro.assinatura_imagem) return null;
  return { assinaturaImagem: registro.assinatura_imagem, assinaturaMime: registro.assinatura_mime };
}

export async function criarFisioterapeuta({ nome, crefito, assinaturaImagem = null, assinaturaMime = null }) {
  const { rows } = await pool.query(
    `INSERT INTO fisioterapeutas (nome, crefito, assinatura_imagem, assinatura_mime)
     VALUES ($1, $2, $3, $4)
     RETURNING ${COLUNAS_LISTAGEM}`,
    [nome, crefito, assinaturaImagem, assinaturaMime]
  );
  return mapearFisioterapeuta(rows[0]);
}

/**
 * Só nome/crefito — a assinatura tem sua própria função (abaixo), chamada
 * apenas quando um arquivo novo é enviado, pra edição de nome não exigir
 * reenviar a imagem.
 */
export async function atualizarFisioterapeuta(id, { nome, crefito }) {
  const { rows } = await pool.query(
    `UPDATE fisioterapeutas SET nome = $2, crefito = $3 WHERE id = $1
     RETURNING ${COLUNAS_LISTAGEM}`,
    [id, nome, crefito]
  );
  return rows[0] ? mapearFisioterapeuta(rows[0]) : null;
}

export async function atualizarAssinaturaFisioterapeuta(id, { assinaturaImagem, assinaturaMime }) {
  await pool.query(
    "UPDATE fisioterapeutas SET assinatura_imagem = $2, assinatura_mime = $3 WHERE id = $1",
    [id, assinaturaImagem, assinaturaMime]
  );
}

export async function definirAtivoFisioterapeuta(id, ativo) {
  const { rows } = await pool.query(
    "UPDATE fisioterapeutas SET ativo = $2 WHERE id = $1 RETURNING id, nome, crefito, ativo",
    [id, ativo]
  );
  return rows[0] ?? null;
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test test/fisioterapeutaModel.test.js`
Expected: PASS (13 testes)

- [ ] **Step 5: Lint e commit**

```bash
npm run lint
git add src/models/fisioterapeutaModel.js test/fisioterapeutaModel.test.js
git commit -m "feat: fisioterapeutaModel — CRUD e busca de assinatura"
```

---

### Task 3: Upload de arquivo (`multer`) + middleware

**Files:**
- Modify: `package.json` (nova dependência `multer`)
- Create: `src/middleware/upload.js`
- Test: `test/upload.test.js`

**Interfaces:**
- Produces: `uploadAssinatura(req, res, next)` — middleware Express que faz `multer.single("assinatura")` com limite de 2MB, populando `req.file` (`{buffer, mimetype, size, ...}`) e `req.body` (campos de texto do multipart, incluindo `_csrf`). Em erro de tamanho, responde `400` direto (não deixa cair no handler genérico de erro). Usado pela Tarefa 5 (rotas).

- [ ] **Step 1: Instalar a dependência**

```bash
npm install multer
```

- [ ] **Step 2: Escrever o teste (smoke test — multer em si já é testado pela própria lib; aqui só confirmamos que o wrapper exporta uma função Express de 3 argumentos e que erros de tamanho viram 400 amigável, sem depender de um stream multipart real)**

```javascript
// test/upload.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import multer from "multer";
import { uploadAssinatura } from "../src/middleware/upload.js";

test("uploadAssinatura: é uma função de middleware Express (req, res, next)", () => {
  assert.equal(typeof uploadAssinatura, "function");
  assert.equal(uploadAssinatura.length, 3);
});

test("uploadAssinatura: erro LIMIT_FILE_SIZE do multer responde 400 amigável, sem propagar pro next", () => {
  const erroMulter = new multer.MulterError("LIMIT_FILE_SIZE");
  const res = {
    statusCode: null,
    corpo: null,
    status(codigo) { this.statusCode = codigo; return this; },
    send(corpo) { this.corpo = corpo; },
  };
  let proximoChamadoCom = "não chamado";

  // Simula o callback interno do multer.single(), sem precisar de um
  // request multipart real — é esse callback que uploadAssinatura envolve.
  const callbackInterno = uploadAssinatura.__testarCallback ?? null;
  assert.ok(callbackInterno, "uploadAssinatura precisa expor __testarCallback pra este teste");
  callbackInterno(erroMulter, res, (erro) => { proximoChamadoCom = erro; });

  assert.equal(res.statusCode, 400);
  assert.match(res.corpo, /máximo 2MB/);
  assert.equal(proximoChamadoCom, "não chamado");
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `node --test test/upload.test.js`
Expected: FAIL (módulo não existe ainda)

- [ ] **Step 4: Implementar `src/middleware/upload.js`**

Expõe o callback de tratamento de erro separadamente (`__testarCallback`) só pra dar um jeito de testar essa lógica sem precisar de um request multipart real de verdade — o multer em si (parsing do multipart) já é testado pela própria lib e será exercitado de verdade na verificação manual (Tarefa 13).

```javascript
import multer from "multer";

// Mantido igual ao TAMANHO_MAXIMO_ASSINATURA_BYTES de fisioterapeutaController.js
// (Tarefa 4) — se um dia mudar, mudar nos dois lugares.
const TAMANHO_MAXIMO_ASSINATURA_BYTES = 2 * 1024 * 1024;

const uploadMemoria = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANHO_MAXIMO_ASSINATURA_BYTES },
});

function tratarErroUpload(err, res, next) {
  if (!err) return next();
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).send("Imagem da assinatura muito grande (máximo 2MB).");
  }
  next(err);
}

export function uploadAssinatura(req, res, next) {
  uploadMemoria.single("assinatura")(req, res, (err) => tratarErroUpload(err, res, next));
}
uploadAssinatura.__testarCallback = tratarErroUpload;
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `node --test test/upload.test.js`
Expected: PASS (2 testes)

- [ ] **Step 6: Lint e commit**

```bash
npm run lint
git add package.json package-lock.json src/middleware/upload.js test/upload.test.js
git commit -m "feat: middleware de upload de assinatura (multer, memória, 2MB)"
```

---

### Task 4: `fisioterapeutaController.js`

**Files:**
- Create: `src/controllers/fisioterapeutaController.js`
- Test: `test/fisioterapeutaController.test.js`

**Interfaces:**
- Consumes: todas as funções de `fisioterapeutaModel.js` (Tarefa 2); `idSeguro` de `src/utils/paginacao.js`.
- Produces (usado pela Tarefa 5 — rotas): `telaFisioterapeutas`, `telaNovoFisioterapeuta`, `processarNovoFisioterapeuta`, `telaEditarFisioterapeuta`, `processarEditarFisioterapeuta`, `processarDesativarFisioterapeuta`, `processarReativarFisioterapeuta`, `servirAssinaturaFisioterapeuta` — todas `(req, res, deps = {})`, mesmo padrão de injeção de dependência de `psicologoController.js`. Também exporta `validarArquivoAssinatura(file)` (usada só internamente, mas exportada pra ser testada isolada).

- [ ] **Step 1: Escrever os testes (mesmo padrão de `psicologoController.test.js`)**

```javascript
// test/fisioterapeutaController.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validarArquivoAssinatura,
  telaFisioterapeutas,
  telaNovoFisioterapeuta,
  processarNovoFisioterapeuta,
  telaEditarFisioterapeuta,
  processarEditarFisioterapeuta,
  processarDesativarFisioterapeuta,
  processarReativarFisioterapeuta,
  servirAssinaturaFisioterapeuta,
} from "../src/controllers/fisioterapeutaController.js";

function criarRespostaFalsa() {
  return {
    statusCode: 200,
    corpo: null,
    headers: {},
    redirectedTo: null,
    viewRenderizada: null,
    dadosDaView: null,
    status(code) { this.statusCode = code; return this; },
    send(corpo) { this.corpo = corpo; return this; },
    setHeader(nome, valor) { this.headers[nome] = valor; },
    redirect(url) { this.redirectedTo = url; },
    render(view, dados) { this.viewRenderizada = view; this.dadosDaView = dados; },
  };
}

const FISIOTERAPEUTA = { id: 5, nome: "Ana", crefito: "1234-F", ativo: true, temAssinatura: false };

test("validarArquivoAssinatura: sem arquivo é válido (upload opcional)", () => {
  assert.equal(validarArquivoAssinatura(undefined), null);
});

test("validarArquivoAssinatura: rejeita mimetype fora de PNG/JPEG", () => {
  const erro = validarArquivoAssinatura({ mimetype: "application/pdf", size: 100 });
  assert.match(erro, /PNG ou JPEG/);
});

test("validarArquivoAssinatura: rejeita arquivo maior que 2MB", () => {
  const erro = validarArquivoAssinatura({ mimetype: "image/png", size: 3 * 1024 * 1024 });
  assert.match(erro, /máximo 2MB/);
});

test("validarArquivoAssinatura: aceita PNG dentro do limite", () => {
  const erro = validarArquivoAssinatura({ mimetype: "image/png", size: 1024 });
  assert.equal(erro, null);
});

test("telaFisioterapeutas: sem ?todos, busca só ativos", async () => {
  const res = criarRespostaFalsa();
  let argumentoRecebido = null;
  await telaFisioterapeutas(
    { query: {} }, res,
    { listar: async (opcoes) => { argumentoRecebido = opcoes; return [FISIOTERAPEUTA]; } }
  );

  assert.deepEqual(argumentoRecebido, { apenasAtivos: true });
  assert.deepEqual(res.dadosDaView.fisioterapeutas, [FISIOTERAPEUTA]);
});

test("processarNovoFisioterapeuta: nome vazio responde 400 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarNovoFisioterapeuta(
    { body: { nome: "  " } }, res,
    { criar: async () => { gravou = true; } }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(gravou, false);
});

test("processarNovoFisioterapeuta: arquivo inválido responde 400 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarNovoFisioterapeuta(
    { body: { nome: "Ana" }, file: { mimetype: "application/pdf", size: 100 } }, res,
    { criar: async () => { gravou = true; } }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(gravou, false);
});

test("processarNovoFisioterapeuta: caminho feliz sem arquivo grava com assinatura null", async () => {
  const res = criarRespostaFalsa();
  let dadosGravados = null;
  await processarNovoFisioterapeuta(
    { body: { nome: " Ana ", crefito: " 1234-F " } }, res,
    { criar: async (dados) => { dadosGravados = dados; } }
  );

  assert.deepEqual(dadosGravados, {
    nome: "Ana", crefito: "1234-F", assinaturaImagem: null, assinaturaMime: null,
  });
  assert.equal(res.redirectedTo, "/fisioterapeutas?sucesso=1");
});

test("processarNovoFisioterapeuta: caminho feliz com arquivo grava buffer e mime", async () => {
  const res = criarRespostaFalsa();
  const bufferFalso = Buffer.from("assinatura");
  let dadosGravados = null;
  await processarNovoFisioterapeuta(
    { body: { nome: "Ana" }, file: { buffer: bufferFalso, mimetype: "image/png", size: 100 } }, res,
    { criar: async (dados) => { dadosGravados = dados; } }
  );

  assert.equal(dadosGravados.assinaturaImagem, bufferFalso);
  assert.equal(dadosGravados.assinaturaMime, "image/png");
});

test("telaEditarFisioterapeuta: id inexistente responde 404", async () => {
  const res = criarRespostaFalsa();
  await telaEditarFisioterapeuta({ params: { id: "abc" } }, res);
  assert.equal(res.statusCode, 404);
});

test("processarEditarFisioterapeuta: fisioterapeuta inexistente responde 404 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarEditarFisioterapeuta(
    { params: { id: "5" }, body: { nome: "Ana" } }, res,
    { buscar: async () => null, atualizar: async () => { gravou = true; } }
  );

  assert.equal(res.statusCode, 404);
  assert.equal(gravou, false);
});

test("processarEditarFisioterapeuta: sem arquivo novo, não chama atualizarAssinatura", async () => {
  const res = criarRespostaFalsa();
  let chamouAtualizarAssinatura = false;
  await processarEditarFisioterapeuta(
    { params: { id: "5" }, body: { nome: "Ana Corrigida", crefito: "9999-F" } }, res,
    {
      buscar: async () => FISIOTERAPEUTA,
      atualizar: async () => {},
      atualizarAssinatura: async () => { chamouAtualizarAssinatura = true; },
    }
  );

  assert.equal(chamouAtualizarAssinatura, false);
  assert.equal(res.redirectedTo, "/fisioterapeutas?sucesso=1");
});

test("processarEditarFisioterapeuta: com arquivo novo, chama atualizarAssinatura com id/buffer/mime", async () => {
  const res = criarRespostaFalsa();
  const bufferFalso = Buffer.from("nova-assinatura");
  let dadosAssinatura = null;
  await processarEditarFisioterapeuta(
    {
      params: { id: "5" },
      body: { nome: "Ana" },
      file: { buffer: bufferFalso, mimetype: "image/jpeg", size: 100 },
    },
    res,
    {
      buscar: async () => FISIOTERAPEUTA,
      atualizar: async () => {},
      atualizarAssinatura: async (id, dados) => { dadosAssinatura = { id, ...dados }; },
    }
  );

  assert.deepEqual(dadosAssinatura, { id: 5, assinaturaImagem: bufferFalso, assinaturaMime: "image/jpeg" });
});

test("processarDesativarFisioterapeuta: caminho feliz define ativo=false", async () => {
  const res = criarRespostaFalsa();
  let chamada = null;
  await processarDesativarFisioterapeuta(
    { params: { id: "5" } }, res,
    { buscar: async () => FISIOTERAPEUTA, definirAtivo: async (id, ativo) => { chamada = { id, ativo }; } }
  );

  assert.deepEqual(chamada, { id: 5, ativo: false });
  assert.equal(res.redirectedTo, "/fisioterapeutas?sucesso=1");
});

test("processarReativarFisioterapeuta: caminho feliz define ativo=true", async () => {
  const res = criarRespostaFalsa();
  let chamada = null;
  await processarReativarFisioterapeuta(
    { params: { id: "5" } }, res,
    { buscar: async () => FISIOTERAPEUTA, definirAtivo: async (id, ativo) => { chamada = { id, ativo }; } }
  );

  assert.deepEqual(chamada, { id: 5, ativo: true });
});

test("servirAssinaturaFisioterapeuta: sem assinatura responde 404", async () => {
  const res = criarRespostaFalsa();
  await servirAssinaturaFisioterapeuta(
    { params: { id: "5" } }, res,
    { buscarAssinatura: async () => null }
  );

  assert.equal(res.statusCode, 404);
});

test("servirAssinaturaFisioterapeuta: caminho feliz responde a imagem com o Content-Type certo", async () => {
  const res = criarRespostaFalsa();
  const bufferFalso = Buffer.from("assinatura");
  await servirAssinaturaFisioterapeuta(
    { params: { id: "5" } }, res,
    { buscarAssinatura: async () => ({ assinaturaImagem: bufferFalso, assinaturaMime: "image/png" }) }
  );

  assert.equal(res.headers["Content-Type"], "image/png");
  assert.equal(res.corpo, bufferFalso);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/fisioterapeutaController.test.js`
Expected: FAIL (módulo não existe ainda)

- [ ] **Step 3: Implementar `src/controllers/fisioterapeutaController.js`**

```javascript
import {
  listarFisioterapeutas,
  buscarFisioterapeutaPorId,
  buscarAssinaturaFisioterapeuta,
  criarFisioterapeuta,
  atualizarFisioterapeuta,
  atualizarAssinaturaFisioterapeuta,
  definirAtivoFisioterapeuta,
} from "../models/fisioterapeutaModel.js";
import { idSeguro } from "../utils/paginacao.js";

const TIPOS_IMAGEM_VALIDOS = new Set(["image/png", "image/jpeg"]);
// Mantido igual ao limits.fileSize de src/middleware/upload.js — se um dia
// mudar, mudar nos dois lugares.
const TAMANHO_MAXIMO_ASSINATURA_BYTES = 2 * 1024 * 1024;

function sufixoTodos(req) {
  return req.body?.todos === "1" ? "&todos=1" : "";
}

function campoOuNulo(valor) {
  const texto = String(valor ?? "").trim();
  return texto || null;
}

export function validarArquivoAssinatura(file) {
  if (!file) return null;
  if (!TIPOS_IMAGEM_VALIDOS.has(file.mimetype)) {
    return "Imagem da assinatura precisa ser PNG ou JPEG.";
  }
  if (file.size > TAMANHO_MAXIMO_ASSINATURA_BYTES) {
    return "Imagem da assinatura muito grande (máximo 2MB).";
  }
  return null;
}

export async function telaFisioterapeutas(req, res, { listar = listarFisioterapeutas } = {}) {
  const mostrarTodos = req.query.todos === "1";
  const fisioterapeutas = await listar({ apenasAtivos: !mostrarTodos });
  res.render("fisioterapeutas/lista", {
    fisioterapeutas,
    mostrarTodos,
    sucesso: req.query.sucesso === "1",
  });
}

export function telaNovoFisioterapeuta(req, res) {
  res.render("fisioterapeutas/novo", { erro: null });
}

export async function processarNovoFisioterapeuta(req, res, { criar = criarFisioterapeuta } = {}) {
  const nome = String(req.body?.nome ?? "").trim();
  if (!nome) return res.status(400).send("Nome inválido.");

  const erroArquivo = validarArquivoAssinatura(req.file);
  if (erroArquivo) return res.status(400).send(erroArquivo);

  await criar({
    nome,
    crefito: campoOuNulo(req.body?.crefito),
    assinaturaImagem: req.file?.buffer ?? null,
    assinaturaMime: req.file?.mimetype ?? null,
  });
  res.redirect("/fisioterapeutas?sucesso=1");
}

export async function telaEditarFisioterapeuta(req, res, { buscar = buscarFisioterapeutaPorId } = {}) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Fisioterapeuta não encontrado.");

  const fisioterapeuta = await buscar(id);
  if (!fisioterapeuta) return res.status(404).send("Fisioterapeuta não encontrado.");

  res.render("fisioterapeutas/editar", {
    fisioterapeuta,
    erro: null,
    mostrarTodos: req.query?.todos === "1",
  });
}

export async function processarEditarFisioterapeuta(
  req, res,
  {
    buscar = buscarFisioterapeutaPorId,
    atualizar = atualizarFisioterapeuta,
    atualizarAssinatura = atualizarAssinaturaFisioterapeuta,
  } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Fisioterapeuta não encontrado.");

  const nome = String(req.body?.nome ?? "").trim();
  if (!nome) return res.status(400).send("Nome inválido.");

  const erroArquivo = validarArquivoAssinatura(req.file);
  if (erroArquivo) return res.status(400).send(erroArquivo);

  const fisioterapeuta = await buscar(id);
  if (!fisioterapeuta) return res.status(404).send("Fisioterapeuta não encontrado.");

  await atualizar(id, { nome, crefito: campoOuNulo(req.body?.crefito) });
  if (req.file) {
    await atualizarAssinatura(id, { assinaturaImagem: req.file.buffer, assinaturaMime: req.file.mimetype });
  }
  res.redirect(`/fisioterapeutas?sucesso=1${sufixoTodos(req)}`);
}

export async function processarDesativarFisioterapeuta(
  req, res, { buscar = buscarFisioterapeutaPorId, definirAtivo = definirAtivoFisioterapeuta } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Fisioterapeuta não encontrado.");

  const fisioterapeuta = await buscar(id);
  if (!fisioterapeuta) return res.status(404).send("Fisioterapeuta não encontrado.");

  await definirAtivo(id, false);
  res.redirect(`/fisioterapeutas?sucesso=1${sufixoTodos(req)}`);
}

export async function processarReativarFisioterapeuta(
  req, res, { buscar = buscarFisioterapeutaPorId, definirAtivo = definirAtivoFisioterapeuta } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Fisioterapeuta não encontrado.");

  const fisioterapeuta = await buscar(id);
  if (!fisioterapeuta) return res.status(404).send("Fisioterapeuta não encontrado.");

  await definirAtivo(id, true);
  res.redirect(`/fisioterapeutas?sucesso=1${sufixoTodos(req)}`);
}

export async function servirAssinaturaFisioterapeuta(
  req, res, { buscarAssinatura = buscarAssinaturaFisioterapeuta } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Fisioterapeuta não encontrado.");

  const assinatura = await buscarAssinatura(id);
  if (!assinatura) return res.status(404).send("Assinatura não encontrada.");

  res.setHeader("Content-Type", assinatura.assinaturaMime);
  res.send(assinatura.assinaturaImagem);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/fisioterapeutaController.test.js`
Expected: PASS (17 testes)

- [ ] **Step 5: Lint e commit**

```bash
npm run lint
git add src/controllers/fisioterapeutaController.js test/fisioterapeutaController.test.js
git commit -m "feat: fisioterapeutaController — CRUD e preview de assinatura"
```

---

### Task 5: Rotas + link de navegação

**Files:**
- Modify: `src/routes/dashboardRoutes.js`
- Modify: `src/views/partials/header.ejs`
- Modify: `test/dashboardRoutesPermissoes.test.js`

**Interfaces:**
- Consumes: controllers da Tarefa 4, `uploadAssinatura` da Tarefa 3, `exigirLogin`/`exigirCsrf`/`exigirPapel` já existentes.
- Produces: rotas `GET /fisioterapeutas`, `GET|POST /fisioterapeutas/novo`, `GET|POST /fisioterapeutas/:id/editar`, `POST /fisioterapeutas/:id/desativar`, `POST /fisioterapeutas/:id/reativar`, `GET /fisioterapeutas/:id/assinatura` — usadas pela Tarefa 6 (views) e pela Tarefa 10/11 (formulário do relatório, que só lê fisioterapeutas via model, sem chamar essas rotas — mas os testes de view do relatório usam esses caminhos como referência de link).

- [ ] **Step 1: Escrever os testes de permissão (mesmo padrão dos blocos de `/usuarios`/`/psicologos` já existentes em `dashboardRoutesPermissoes.test.js`)**

Adicionar ao final de `test/dashboardRoutesPermissoes.test.js` (reaproveita `executarRota`, `criarResposta`, `criarRequisicao`, `RECEPCIONISTA` já definidos no topo do arquivo):

```javascript
test("GET /fisioterapeutas não bloqueia recepção (listagem é aberta a qualquer logado)", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("FROM usuarios")) return { rows: [RECEPCIONISTA] };
    return { rows: [] };
  });
  const res = criarResposta();

  await executarRota({ caminho: "/fisioterapeutas", metodo: "get", req: criarRequisicao(), res });

  assert.notEqual(res.statusCode, 403);
});

test("GET /fisioterapeutas/novo bloqueia recepção antes de renderizar o formulário", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [RECEPCIONISTA] }));
  const res = criarResposta();

  await executarRota({ caminho: "/fisioterapeutas/novo", metodo: "get", req: criarRequisicao(), res });

  assert.equal(res.statusCode, 403);
  assert.equal(res.view, "erros/acesso-negado");
});

test("POST /fisioterapeutas/:id/desativar bloqueia recepção antes de consultar o fisioterapeuta", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql) => {
    consultas.push(sql);
    return { rows: [RECEPCIONISTA] };
  });
  const res = criarResposta();

  await executarRota({ caminho: "/fisioterapeutas/:id/desativar", metodo: "post", req: criarRequisicao(), res });

  assert.equal(res.statusCode, 403);
  assert.equal(consultas.length, 1, "não deve consultar o fisioterapeuta depois de negar o papel");
});

test("GET /fisioterapeutas sem sessão redireciona pro login", async (t) => {
  const res = criarResposta();

  await executarRota({
    caminho: "/fisioterapeutas",
    metodo: "get",
    req: { session: {}, body: {}, params: {}, query: {} },
    res,
  });

  assert.equal(res.redirectedTo, "/login");
});
```

- [ ] **Step 2: Rodar e confirmar que falha** (rotas ainda não existem)

Run: `node --test test/dashboardRoutesPermissoes.test.js`
Expected: FAIL com "rota GET /fisioterapeutas não encontrada"

- [ ] **Step 3: Registrar as rotas em `src/routes/dashboardRoutes.js`**

No topo do arquivo, junto dos outros imports de controller:

```javascript
import {
  telaFisioterapeutas,
  telaNovoFisioterapeuta,
  processarNovoFisioterapeuta,
  telaEditarFisioterapeuta,
  processarEditarFisioterapeuta,
  processarDesativarFisioterapeuta,
  processarReativarFisioterapeuta,
  servirAssinaturaFisioterapeuta,
} from "../controllers/fisioterapeutaController.js";
import { uploadAssinatura } from "../middleware/upload.js";
```

Logo depois do bloco de rotas de `/psicologos` (linhas ~158-186 de hoje):

```javascript
router.get("/fisioterapeutas", asyncHandler(exigirLogin), asyncHandler(telaFisioterapeutas));
router.get(
  "/fisioterapeutas/novo",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  telaNovoFisioterapeuta
);
router.post(
  "/fisioterapeutas/novo",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  uploadAssinatura,
  exigirCsrf,
  asyncHandler(processarNovoFisioterapeuta)
);
router.get(
  "/fisioterapeutas/:id/editar",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  asyncHandler(telaEditarFisioterapeuta)
);
router.post(
  "/fisioterapeutas/:id/editar",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  uploadAssinatura,
  exigirCsrf,
  asyncHandler(processarEditarFisioterapeuta)
);
router.post(
  "/fisioterapeutas/:id/desativar",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  exigirCsrf,
  asyncHandler(processarDesativarFisioterapeuta)
);
router.post(
  "/fisioterapeutas/:id/reativar",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  exigirCsrf,
  asyncHandler(processarReativarFisioterapeuta)
);
router.get(
  "/fisioterapeutas/:id/assinatura",
  asyncHandler(exigirLogin),
  asyncHandler(servirAssinaturaFisioterapeuta)
);
```

**Importante — ordem do middleware**: `exigirPapel` vem *antes* de `uploadAssinatura`, que vem *antes* de `exigirCsrf`. Isso é proposital: (1) barra recepção antes de gastar tempo fazendo parsing de multipart; (2) o `_csrf` chega dentro do corpo multipart junto com `nome`/`crefito`/`assinatura` — só depois do `multer` rodar é que `req.body._csrf` existe (o `express.urlencoded` global do `app.js` não entende `multipart/form-data`, só `application/x-www-form-urlencoded`).

- [ ] **Step 4: Adicionar o link de navegação em `src/views/partials/header.ejs`**

Dentro do bloco `<% if (usuarioAtual.papel === "administradora") { %>` (linhas 41-46 de hoje), logo depois do link de "Usuários":

```html
<a class="sidebar-link<%= ativo('/fisioterapeutas') ? ' is-active' : '' %>" href="/fisioterapeutas"<% if (ativo('/fisioterapeutas')) { %> aria-current="page"<% } %>><svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg><span>Fisioterapeutas</span></a>
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `node --test test/dashboardRoutesPermissoes.test.js`
Expected: PASS

- [ ] **Step 6: Rodar a suíte inteira (garantir que nada mais quebrou) + lint**

Run: `npm test && npm run lint`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/routes/dashboardRoutes.js src/views/partials/header.ejs test/dashboardRoutesPermissoes.test.js
git commit -m "feat: rotas de /fisioterapeutas restritas a administradora + link no menu"
```

---

### Task 6: Views `fisioterapeutas/lista.ejs`, `novo.ejs`, `editar.ejs`

**Files:**
- Create: `src/views/fisioterapeutas/lista.ejs`
- Create: `src/views/fisioterapeutas/novo.ejs`
- Create: `src/views/fisioterapeutas/editar.ejs`
- Modify: `public/dashboard.css` (classe `.signature-preview`)
- Test: `test/fisioterapeutasView.test.js`

**Interfaces:**
- Consumes: dados renderizados pelos controllers da Tarefa 4 (`fisioterapeutas`, `mostrarTodos`, `sucesso`, `fisioterapeuta`, `erro`); `usuarioAtual` do partial `header.ejs` (já injetado globalmente em toda view do dashboard).

- [ ] **Step 1: Escrever os testes (mesmo padrão de `psicologosView.test.js`)**

```javascript
// test/fisioterapeutasView.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.join(__dirname, "..", "src", "views");

const ADMINISTRADORA = { id: 1, nome: "Ana", papel: "administradora" };
const RECEPCAO = { id: 2, nome: "Amanda", papel: "recepcao" };

function renderizarLista(dados) {
  return ejs.renderFile(path.join(VIEWS_DIR, "fisioterapeutas", "lista.ejs"), {
    fisioterapeutas: [],
    mostrarTodos: false,
    sucesso: false,
    titulo: "Fisioterapeutas",
    caminhoAtual: "/fisioterapeutas",
    csrfToken: "token-fake",
    usuarioAtual: ADMINISTRADORA,
    ...dados,
  });
}

function renderizarNovo(dados) {
  return ejs.renderFile(path.join(VIEWS_DIR, "fisioterapeutas", "novo.ejs"), {
    erro: null,
    titulo: "Novo fisioterapeuta",
    caminhoAtual: "/fisioterapeutas/novo",
    csrfToken: "token-fake",
    usuarioAtual: ADMINISTRADORA,
    ...dados,
  });
}

function renderizarEditar(dados) {
  return ejs.renderFile(path.join(VIEWS_DIR, "fisioterapeutas", "editar.ejs"), {
    fisioterapeuta: { id: 5, nome: "Ana", crefito: "1234-F", ativo: true, temAssinatura: false },
    mostrarTodos: false,
    erro: null,
    titulo: "Editar fisioterapeuta",
    caminhoAtual: "/fisioterapeutas/5/editar",
    csrfToken: "token-fake",
    usuarioAtual: ADMINISTRADORA,
    ...dados,
  });
}

test("fisioterapeutas/lista: administradora vê botão Novo e ações por linha", async () => {
  const html = await renderizarLista({
    fisioterapeutas: [{ id: 1, nome: "Ana", crefito: "1234-F", ativo: true, temAssinatura: true }],
  });

  assert.match(html, /href="\/fisioterapeutas\/novo"/);
  assert.match(html, /href="\/fisioterapeutas\/1\/editar"/);
  assert.match(html, /action="\/fisioterapeutas\/1\/desativar"/);
});

test("fisioterapeutas/lista: recepção não vê botão Novo nem coluna de ações", async () => {
  const html = await renderizarLista({
    usuarioAtual: RECEPCAO,
    fisioterapeutas: [{ id: 1, nome: "Ana", crefito: "1234-F", ativo: true, temAssinatura: true }],
  });

  assert.doesNotMatch(html, /href="\/fisioterapeutas\/novo"/);
  assert.doesNotMatch(html, /href="\/fisioterapeutas\/1\/editar"/);
  assert.doesNotMatch(html, /action="\/fisioterapeutas\/1\/desativar"/);
});

test("fisioterapeutas/lista: mostra badge de assinatura cadastrada/não cadastrada", async () => {
  const html = await renderizarLista({
    fisioterapeutas: [
      { id: 1, nome: "Ana", crefito: "1234-F", ativo: true, temAssinatura: true },
      { id: 2, nome: "Bia", crefito: null, ativo: true, temAssinatura: false },
    ],
  });

  assert.match(html, /badge is-success">\s*Cadastrada/);
  assert.match(html, /badge is-danger">\s*Não cadastrada/);
});

test("fisioterapeutas/novo: formulário tem campos nome, crefito e assinatura, com enctype multipart", async () => {
  const html = await renderizarNovo({});

  assert.match(html, /enctype="multipart\/form-data"/);
  assert.match(html, /name="nome"/);
  assert.match(html, /name="crefito"/);
  assert.match(html, /name="assinatura"[^>]*type="file"/);
});

test("fisioterapeutas/editar: sem assinatura cadastrada, não mostra preview", async () => {
  const html = await renderizarEditar({
    fisioterapeuta: { id: 5, nome: "Ana", crefito: "1234-F", ativo: true, temAssinatura: false },
  });

  assert.doesNotMatch(html, /fisioterapeutas\/5\/assinatura/);
});

test("fisioterapeutas/editar: com assinatura cadastrada, mostra preview apontando pra rota certa", async () => {
  const html = await renderizarEditar({
    fisioterapeuta: { id: 5, nome: "Ana", crefito: "1234-F", ativo: true, temAssinatura: true },
  });

  assert.match(html, /src="\/fisioterapeutas\/5\/assinatura"/);
});

test("fisioterapeutas/editar: formulário pré-preenchido com nome e crefito atuais", async () => {
  const html = await renderizarEditar({
    fisioterapeuta: { id: 5, nome: "Ana Preenchida", crefito: "9999-F", ativo: true, temAssinatura: false },
  });

  assert.match(html, /name="nome"[^>]*value="Ana Preenchida"/);
  assert.match(html, /name="crefito"[^>]*value="9999-F"/);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/fisioterapeutasView.test.js`
Expected: FAIL (views não existem)

- [ ] **Step 3: Criar `src/views/fisioterapeutas/lista.ejs`**

```html
<!-- src/views/fisioterapeutas/lista.ejs -->
<%- include("../partials/header", { titulo: "Fisioterapeutas" }) %>
<section class="user-list">
  <header class="page-header">
    <div>
      <h1>Fisioterapeutas</h1>
      <p class="patient-list-summary">Cadastro dos fisioterapeutas da clínica, com assinatura pro relatório fisioterapêutico.</p>
    </div>
    <div class="toolbar">
      <% if (mostrarTodos) { %>
      <a class="button button--quiet" href="/fisioterapeutas">Mostrar só ativos</a>
      <% } else { %>
      <a class="button button--quiet" href="/fisioterapeutas?todos=1">Mostrar inativos</a>
      <% } %>
      <% if (usuarioAtual.papel === "administradora") { %>
      <a class="button" href="/fisioterapeutas/novo">Novo fisioterapeuta</a>
      <% } %>
    </div>
  </header>
  <% if (sucesso) { %>
  <p class="sucesso">Alteração salva com sucesso.</p>
  <% } %>
  <div class="panel user-list-panel">
    <div class="patient-table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Nome</th><th>Crefito</th><th>Assinatura</th><th>Status</th>
            <% if (usuarioAtual.papel === "administradora") { %><th>Ações</th><% } %>
          </tr>
        </thead>
        <tbody>
          <% for (const fisioterapeuta of fisioterapeutas) { %>
          <tr>
            <td><%= fisioterapeuta.nome %></td>
            <td><%= fisioterapeuta.crefito ?? "" %></td>
            <td><span class="badge <%= fisioterapeuta.temAssinatura ? 'is-success' : 'is-danger' %>"><%= fisioterapeuta.temAssinatura ? "Cadastrada" : "Não cadastrada" %></span></td>
            <td><span class="badge <%= fisioterapeuta.ativo ? 'is-success' : 'is-danger' %>"><%= fisioterapeuta.ativo ? "Ativo" : "Inativo" %></span></td>
            <% if (usuarioAtual.papel === "administradora") { %>
            <td>
              <div class="user-row-actions">
                <a class="button button--quiet" href="/fisioterapeutas/<%= fisioterapeuta.id %>/editar<%= mostrarTodos ? '?todos=1' : '' %>">Editar</a>
                <% if (fisioterapeuta.ativo) { %>
                <form method="post" action="/fisioterapeutas/<%= fisioterapeuta.id %>/desativar">
                  <input type="hidden" name="_csrf" value="<%= csrfToken %>" />
                  <% if (mostrarTodos) { %><input type="hidden" name="todos" value="1" /><% } %>
                  <button class="button is-danger" type="submit">Desativar</button>
                </form>
                <% } else { %>
                <form method="post" action="/fisioterapeutas/<%= fisioterapeuta.id %>/reativar">
                  <input type="hidden" name="_csrf" value="<%= csrfToken %>" />
                  <% if (mostrarTodos) { %><input type="hidden" name="todos" value="1" /><% } %>
                  <button class="button" type="submit">Reativar</button>
                </form>
                <% } %>
              </div>
            </td>
            <% } %>
          </tr>
          <% } %>
        </tbody>
      </table>
    </div>
  </div>
</section>
<%- include("../partials/footer") %>
```

- [ ] **Step 4: Criar `src/views/fisioterapeutas/novo.ejs`**

```html
<!-- src/views/fisioterapeutas/novo.ejs -->
<%- include("../partials/header", { titulo: "Novo fisioterapeuta" }) %>
<header class="page-header">
  <div>
    <h1>Novo fisioterapeuta</h1>
    <p>Cadastre um fisioterapeuta da clínica.</p>
  </div>
  <a class="button button--quiet" href="/fisioterapeutas">Voltar</a>
</header>

<form class="focused-form" method="post" action="/fisioterapeutas/novo" enctype="multipart/form-data">
  <input type="hidden" name="_csrf" value="<%= csrfToken %>" />
  <% if (erro) { %>
  <p class="erro"><%= erro %></p>
  <% } %>
  <div class="form-grid">
    <label>Nome<input type="text" name="nome" required /></label>
    <label>Crefito<input type="text" name="crefito" placeholder="Ex.: 435050-F" /></label>
    <label>Assinatura (imagem PNG ou JPEG, opcional)<input type="file" name="assinatura" accept="image/png,image/jpeg" /></label>
  </div>
  <div class="toolbar">
    <button type="submit">Criar</button>
  </div>
</form>
<%- include("../partials/footer") %>
```

- [ ] **Step 5: Criar `src/views/fisioterapeutas/editar.ejs`**

```html
<!-- src/views/fisioterapeutas/editar.ejs -->
<%- include("../partials/header", { titulo: "Editar fisioterapeuta" }) %>
<header class="page-header">
  <div>
    <h1>Editar fisioterapeuta</h1>
    <p>Corrija os dados cadastrados ou envie uma nova assinatura.</p>
  </div>
  <a class="button button--quiet" href="/fisioterapeutas<%= mostrarTodos ? '?todos=1' : '' %>">Voltar</a>
</header>

<form class="focused-form" method="post" action="/fisioterapeutas/<%= fisioterapeuta.id %>/editar" enctype="multipart/form-data">
  <input type="hidden" name="_csrf" value="<%= csrfToken %>" />
  <% if (mostrarTodos) { %>
  <input type="hidden" name="todos" value="1" />
  <% } %>
  <% if (erro) { %>
  <p class="erro"><%= erro %></p>
  <% } %>
  <div class="form-grid">
    <label>Nome<input type="text" name="nome" value="<%= fisioterapeuta.nome %>" required /></label>
    <label>Crefito<input type="text" name="crefito" value="<%= fisioterapeuta.crefito ?? '' %>" placeholder="Ex.: 435050-F" /></label>
    <label>Assinatura (imagem PNG ou JPEG)
      <% if (fisioterapeuta.temAssinatura) { %>
      <img src="/fisioterapeutas/<%= fisioterapeuta.id %>/assinatura" alt="Assinatura atual de <%= fisioterapeuta.nome %>" class="signature-preview" />
      <% } %>
      <input type="file" name="assinatura" accept="image/png,image/jpeg" />
    </label>
  </div>
  <div class="toolbar">
    <button type="submit">Salvar</button>
  </div>
</form>
<%- include("../partials/footer") %>
```

- [ ] **Step 6: Adicionar a classe `.signature-preview` em `public/dashboard.css`** (final do arquivo)

```css
.signature-preview {
  display: block;
  max-width: 220px;
  max-height: 90px;
  border: 1px solid var(--border);
  border-radius: 4px;
  margin-bottom: 0.5rem;
  background: #fff;
}
```

- [ ] **Step 7: Rodar e confirmar que passa**

Run: `node --test test/fisioterapeutasView.test.js`
Expected: PASS (8 testes)

- [ ] **Step 8: Lint e commit**

```bash
npm run lint
git add src/views/fisioterapeutas public/dashboard.css test/fisioterapeutasView.test.js
git commit -m "feat: telas de cadastro de fisioterapeutas (lista/novo/editar)"
```

---

### Task 7: `relatorioFisioterapeuticoModel.js` — suporte a `fisioterapeuta_id`

**Files:**
- Modify: `src/models/relatorioFisioterapeuticoModel.js`
- Modify: `test/relatorioFisioterapeuticoModel.test.js`

**Interfaces:**
- Produces (usado pela Tarefa 10): `buscarRelatorioDoPaciente` agora retorna também `fisioterapeutaId`; `criarRelatorio` e `atualizarRelatorio` agora aceitam também `fisioterapeutaId` (nullable).

- [ ] **Step 1: Atualizar os testes existentes que quebram com a mudança**

Em `test/relatorioFisioterapeuticoModel.test.js`, editar:

```javascript
test("buscarRelatorioDoPaciente: mapeia todas as colunas pra camelCase", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{
      id: 5, paciente_id: 7, data_relatorio: "2026-09-01",
      diagnostico_motivo: "Fratura 5º dedo mão direita",
      conduta_evolucao: "Ganho de mobilidade progressivo",
      consideracoes_finais: "Consolidação parcial, seguir tratamento",
      profissional_responsavel: "Dra. Isabella Silva Reis / Crefito 435050-F",
      fisioterapeuta_id: 3,
    }],
  }));

  const resultado = await buscarRelatorioDoPaciente(5, 7);

  assert.deepEqual(resultado, {
    id: 5, pacienteId: 7, dataRelatorio: "2026-09-01",
    diagnosticoMotivo: "Fratura 5º dedo mão direita",
    condutaEvolucao: "Ganho de mobilidade progressivo",
    consideracoesFinais: "Consolidação parcial, seguir tratamento",
    profissionalResponsavel: "Dra. Isabella Silva Reis / Crefito 435050-F",
    fisioterapeutaId: 3,
  });
});

test("criarRelatorio: retorna o id gerado pelo banco", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ id: 42 }] }));

  const id = await criarRelatorio({
    pacienteId: 7, dataRelatorio: "2026-09-01",
    diagnosticoMotivo: "Fratura", condutaEvolucao: "Evoluindo bem",
    consideracoesFinais: "Seguir tratamento", profissionalResponsavel: "Dra. Isabella",
    fisioterapeutaId: 3, registradoPor: 2,
  });

  assert.equal(id, 42);
});

test("atualizarRelatorio: envia todos os campos, incluindo fisioterapeutaId, na query de update", async (t) => {
  let parametrosRecebidos = null;
  t.mock.method(pool, "query", async (_sql, parametros) => {
    parametrosRecebidos = parametros;
    return { rows: [] };
  });

  await atualizarRelatorio(5, {
    dataRelatorio: "2026-09-02", diagnosticoMotivo: "Fratura",
    condutaEvolucao: "Evoluindo bem", consideracoesFinais: "Seguir tratamento",
    profissionalResponsavel: "Dra. Isabella", fisioterapeutaId: 3,
  });

  assert.deepEqual(parametrosRecebidos, [
    5, "2026-09-02", "Fratura", "Evoluindo bem", "Seguir tratamento", "Dra. Isabella", 3,
  ]);
});
```

- [ ] **Step 2: Rodar e confirmar que falham** (implementação ainda não muda)

Run: `node --test test/relatorioFisioterapeuticoModel.test.js`
Expected: FAIL nos 3 testes editados

- [ ] **Step 3: Atualizar `src/models/relatorioFisioterapeuticoModel.js`**

```javascript
export async function buscarRelatorioDoPaciente(relatorioId, pacienteId) {
  const { rows } = await pool.query(
    `SELECT id, paciente_id, data_relatorio, diagnostico_motivo, conduta_evolucao,
            consideracoes_finais, profissional_responsavel, fisioterapeuta_id
     FROM relatorios_fisioterapeuticos
     WHERE id = $1 AND paciente_id = $2`,
    [relatorioId, pacienteId]
  );
  const registro = rows[0];
  if (!registro) return null;

  return {
    id: registro.id,
    pacienteId: registro.paciente_id,
    dataRelatorio: registro.data_relatorio,
    diagnosticoMotivo: registro.diagnostico_motivo,
    condutaEvolucao: registro.conduta_evolucao,
    consideracoesFinais: registro.consideracoes_finais,
    profissionalResponsavel: registro.profissional_responsavel,
    fisioterapeutaId: registro.fisioterapeuta_id,
  };
}

export async function criarRelatorio({
  pacienteId, dataRelatorio, diagnosticoMotivo, condutaEvolucao,
  consideracoesFinais, profissionalResponsavel, fisioterapeutaId, registradoPor,
}) {
  const { rows } = await pool.query(
    `INSERT INTO relatorios_fisioterapeuticos (
       paciente_id, data_relatorio, diagnostico_motivo, conduta_evolucao,
       consideracoes_finais, profissional_responsavel, fisioterapeuta_id, registrado_por
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [
      pacienteId, dataRelatorio, diagnosticoMotivo, condutaEvolucao,
      consideracoesFinais, profissionalResponsavel, fisioterapeutaId, registradoPor,
    ]
  );
  return rows[0].id;
}

export async function atualizarRelatorio(relatorioId, {
  dataRelatorio, diagnosticoMotivo, condutaEvolucao,
  consideracoesFinais, profissionalResponsavel, fisioterapeutaId,
}) {
  await pool.query(
    `UPDATE relatorios_fisioterapeuticos SET
       data_relatorio = $2, diagnostico_motivo = $3, conduta_evolucao = $4,
       consideracoes_finais = $5, profissional_responsavel = $6, fisioterapeuta_id = $7
     WHERE id = $1`,
    [
      relatorioId, dataRelatorio, diagnosticoMotivo, condutaEvolucao,
      consideracoesFinais, profissionalResponsavel, fisioterapeutaId,
    ]
  );
}
```

(`listarRelatoriosPaciente` e `excluirRelatorio` não mudam.)

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/relatorioFisioterapeuticoModel.test.js`
Expected: PASS

- [ ] **Step 5: Lint e commit**

```bash
npm run lint
git add src/models/relatorioFisioterapeuticoModel.js test/relatorioFisioterapeuticoModel.test.js
git commit -m "feat: relatorioFisioterapeuticoModel guarda fisioterapeuta_id"
```

---

### Task 8: `relatorioFisioterapeuticoPdfService.js` — embutir a assinatura

**Files:**
- Modify: `src/services/relatorioFisioterapeuticoPdfService.js`
- Modify: `test/relatorioFisioterapeuticoPdfService.test.js`

**Interfaces:**
- Produces: `gerarPdfRelatorio(dados)` agora aceita também `dados.assinaturaImagem` (Buffer, opcional). Consumido pela Tarefa 10.

- [ ] **Step 1: Adicionar os testes novos** (ao final de `test/relatorioFisioterapeuticoPdfService.test.js`)

```javascript
test("gerarPdfRelatorio: com assinaturaImagem, embute a imagem sem quebrar (smoke test)", async () => {
  // PNG 1x1 transparente válido — só precisa ser um PNG de verdade pro
  // pdfkit conseguir decodificar, o conteúdo visual não importa aqui.
  const pngMinimo = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );

  const buffer = await gerarPdfRelatorio({
    pacienteNome: "Ana",
    dataRelatorio: "2026-09-16",
    diagnosticoMotivo: "Lombalgia",
    condutaEvolucao: "Evoluindo bem",
    consideracoesFinais: null,
    profissionalResponsavel: "Dra. Isabella / Crefito 435050-F",
    assinaturaImagem: pngMinimo,
  });

  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0, 4).toString("latin1"), "%PDF");
});
```

- [ ] **Step 2: Rodar e confirmar que passa mesmo sem mudar a implementação ainda**

Run: `node --test test/relatorioFisioterapeuticoPdfService.test.js`
Expected: na verdade este teste específico já passaria sem mudança nenhuma (pdfkit ignora a chave extra) — o que confirma que **sem** implementar o embed, a imagem simplesmente não apareceria. Prosseguir mesmo assim pra Step 3, já que o objetivo real (embutir a imagem) só é visível olhando o PDF, não por este smoke test — a garantia de "não quebra com imagem real" é o valor deste teste.

- [ ] **Step 3: Implementar o embed em `src/services/relatorioFisioterapeuticoPdfService.js`**

Trocar o bloco final:

```javascript
    doc.moveDown(3);

    if (dados.profissionalResponsavel) {
      doc.text("_______________________________________", { align: "center" });
      doc.text(dados.profissionalResponsavel, { align: "center" });
    }

    doc.end();
```

por:

```javascript
    doc.moveDown(3);

    if (dados.assinaturaImagem) {
      doc.image(dados.assinaturaImagem, { fit: [180, 70], align: "center" });
      doc.moveDown(0.5);
    } else if (dados.profissionalResponsavel) {
      doc.text("_______________________________________", { align: "center" });
    }
    if (dados.profissionalResponsavel) {
      doc.text(dados.profissionalResponsavel, { align: "center" });
    }

    doc.end();
```

- [ ] **Step 4: Rodar toda a suíte do arquivo e confirmar que passa**

Run: `node --test test/relatorioFisioterapeuticoPdfService.test.js`
Expected: PASS (5 testes)

- [ ] **Step 5: Lint e commit**

```bash
npm run lint
git add src/services/relatorioFisioterapeuticoPdfService.js test/relatorioFisioterapeuticoPdfService.test.js
git commit -m "feat: relatório em PDF embute a assinatura do fisioterapeuta quando houver"
```

---

### Task 9: `relatorioFisioterapeuticoDocxService.js` — embutir a assinatura

**Files:**
- Modify: `src/services/relatorioFisioterapeuticoDocxService.js`
- Modify: `test/relatorioFisioterapeuticoDocxService.test.js`

**Interfaces:**
- Produces: `gerarDocxRelatorio(dados)` agora aceita também `dados.assinaturaImagem` (Buffer) e `dados.assinaturaMime` (`"image/png"` ou `"image/jpeg"`, opcional). Consumido pela Tarefa 10.

- [ ] **Step 1: Adicionar o teste novo**

```javascript
test("gerarDocxRelatorio: com assinaturaImagem/assinaturaMime, embute a imagem sem quebrar (smoke test)", async () => {
  const pngMinimo = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );

  const buffer = await gerarDocxRelatorio({
    pacienteNome: "Ana",
    dataRelatorio: "2026-09-16",
    diagnosticoMotivo: "Lombalgia",
    condutaEvolucao: "Evoluindo bem",
    consideracoesFinais: null,
    profissionalResponsavel: "Dra. Isabella / Crefito 435050-F",
    assinaturaImagem: pngMinimo,
    assinaturaMime: "image/png",
  });

  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0, 2).toString("latin1"), "PK");
});
```

- [ ] **Step 2: Rodar** (mesma observação da Tarefa 8 — este smoke test passaria mesmo sem embed real; o embed em si só se confirma visualmente na Tarefa 13)

Run: `node --test test/relatorioFisioterapeuticoDocxService.test.js`

- [ ] **Step 3: Implementar em `src/services/relatorioFisioterapeuticoDocxService.js`**

```javascript
import { Document, Packer, Paragraph, AlignmentType, HeadingLevel, ImageRun } from "docx";
```

Trocar o bloco final:

```javascript
  if (dados.profissionalResponsavel) {
    paragrafos.push(
      new Paragraph({ text: "_______________________________________", alignment: AlignmentType.CENTER })
    );
    paragrafos.push(new Paragraph({ text: dados.profissionalResponsavel, alignment: AlignmentType.CENTER }));
  }
```

por:

```javascript
  if (dados.assinaturaImagem) {
    paragrafos.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new ImageRun({
            data: dados.assinaturaImagem,
            transformation: { width: 180, height: 70 },
            type: dados.assinaturaMime === "image/jpeg" ? "jpg" : "png",
          }),
        ],
      })
    );
  } else if (dados.profissionalResponsavel) {
    paragrafos.push(
      new Paragraph({ text: "_______________________________________", alignment: AlignmentType.CENTER })
    );
  }
  if (dados.profissionalResponsavel) {
    paragrafos.push(new Paragraph({ text: dados.profissionalResponsavel, alignment: AlignmentType.CENTER }));
  }
```

- [ ] **Step 4: Rodar toda a suíte do arquivo e confirmar que passa**

Run: `node --test test/relatorioFisioterapeuticoDocxService.test.js`
Expected: PASS (3 testes)

- [ ] **Step 5: Lint e commit**

```bash
npm run lint
git add src/services/relatorioFisioterapeuticoDocxService.js test/relatorioFisioterapeuticoDocxService.test.js
git commit -m "feat: relatório em Word embute a assinatura do fisioterapeuta quando houver"
```

---

### Task 10: `relatorioFisioterapeuticoController.js` — ligar tudo

**Files:**
- Modify: `src/controllers/relatorioFisioterapeuticoController.js`
- Modify: `test/relatorioFisioterapeuticoController.test.js`

**Interfaces:**
- Consumes: `listarFisioterapeutas`, `buscarFisioterapeutaPorId`, `buscarAssinaturaFisioterapeuta` de `fisioterapeutaModel.js` (Tarefa 2); `fisioterapeutaId` de `relatorioFisioterapeuticoModel.js` (Tarefa 7); `assinaturaImagem`/`assinaturaMime` dos services (Tarefas 8/9).
- Produces: `telaNovoRelatorio`/`telaEditarRelatorio` passam `fisioterapeutas` (lista de ativos) pra view (consumido pela Tarefa 11).

Este é o núcleo da integração: o campo de texto livre "profissional responsável" vira uma seleção de fisioterapeuta cadastrado, e a assinatura é buscada fresca (não salva no relatório) sempre que um PDF/DOCX é gerado.

- [ ] **Step 1: Atualizar/adicionar os testes**

Substituir o teste `"processarNovoRelatorio: caminho feliz grava com registradoPor..."` e adicionar os novos casos:

```javascript
const FISIOTERAPEUTA = { id: 3, nome: "Dra. Isabella Silva Reis", crefito: "435050-F", ativo: true };

test("telaNovoRelatorio: caminho feliz passa a lista de fisioterapeutas ativos pra view", async () => {
  const res = criarRespostaFalsa();
  let opcoesRecebidas = null;
  await telaNovoRelatorio(
    { params: { id: "7" } }, res,
    {
      buscarPaciente: async () => PACIENTE,
      listarFisioterapeutas: async (opcoes) => { opcoesRecebidas = opcoes; return [FISIOTERAPEUTA]; },
    }
  );

  assert.deepEqual(opcoesRecebidas, { apenasAtivos: true });
  assert.deepEqual(res.dadosDaView.fisioterapeutas, [FISIOTERAPEUTA]);
});

test("processarNovoRelatorio: com fisioterapeuta_id válido, deriva profissionalResponsavel e grava fisioterapeutaId", async () => {
  const res = criarRespostaFalsa();
  let dadosGravados = null;
  await processarNovoRelatorio(
    {
      params: { id: "7" },
      body: {
        data_relatorio: "2026-09-11",
        diagnostico_motivo: "Fratura 5º dedo mão direita",
        fisioterapeuta_id: "3",
      },
      usuarioAtual: { id: 2 },
    },
    res,
    {
      buscarPaciente: async () => PACIENTE,
      buscarFisioterapeuta: async (id) => (id === 3 ? FISIOTERAPEUTA : null),
      criar: async (dados) => { dadosGravados = dados; return 42; },
    }
  );

  assert.equal(dadosGravados.fisioterapeutaId, 3);
  assert.equal(dadosGravados.profissionalResponsavel, "Dra. Isabella Silva Reis / Crefito 435050-F");
});

test("processarNovoRelatorio: sem fisioterapeuta_id, grava fisioterapeutaId e profissionalResponsavel null", async () => {
  const res = criarRespostaFalsa();
  let dadosGravados = null;
  await processarNovoRelatorio(
    { params: { id: "7" }, body: { data_relatorio: "2026-09-11" }, usuarioAtual: { id: 2 } },
    res,
    { buscarPaciente: async () => PACIENTE, criar: async (dados) => { dadosGravados = dados; return 42; } }
  );

  assert.equal(dadosGravados.fisioterapeutaId, null);
  assert.equal(dadosGravados.profissionalResponsavel, null);
});

test("processarEditarRelatorio: com fisioterapeuta_id válido, deriva e grava normalmente", async () => {
  const res = criarRespostaFalsa();
  let dadosAtualizados = null;
  await processarEditarRelatorio(
    { params: { id: "7", relatorioId: "5" }, body: { data_relatorio: "2026-09-12", fisioterapeuta_id: "3" } },
    res,
    {
      buscarRelatorio: async () => RELATORIO,
      buscarFisioterapeuta: async (id) => (id === 3 ? FISIOTERAPEUTA : null),
      atualizar: async (id, dados) => { dadosAtualizados = dados; },
    }
  );

  assert.equal(dadosAtualizados.fisioterapeutaId, 3);
  assert.equal(dadosAtualizados.profissionalResponsavel, "Dra. Isabella Silva Reis / Crefito 435050-F");
});

test("processarEditarRelatorio: relatório legado (sem fisioterapeuta_id) com campo legado no body preserva o texto antigo", async () => {
  const res = criarRespostaFalsa();
  let dadosAtualizados = null;
  await processarEditarRelatorio(
    {
      params: { id: "7", relatorioId: "5" },
      body: {
        data_relatorio: "2026-09-12",
        profissional_responsavel_legado: "Dr. Antigo / Crefito 111111-F",
      },
    },
    res,
    {
      buscarRelatorio: async () => RELATORIO,
      atualizar: async (id, dados) => { dadosAtualizados = dados; },
    }
  );

  assert.equal(dadosAtualizados.fisioterapeutaId, null);
  assert.equal(dadosAtualizados.profissionalResponsavel, "Dr. Antigo / Crefito 111111-F");
});

test("gerarPdfRelatorioController: relatório com fisioterapeutaId busca e passa a assinatura pro gerarPdf", async () => {
  const res = criarRespostaFalsa();
  let dadosPassadosPraPdf = null;
  await gerarPdfRelatorioController(
    { params: { id: "7", relatorioId: "5" } },
    res,
    {
      buscarPaciente: async () => PACIENTE,
      buscarRelatorio: async () => ({ ...RELATORIO, fisioterapeutaId: 3 }),
      buscarAssinatura: async (id) => (id === 3 ? { assinaturaImagem: Buffer.from("img"), assinaturaMime: "image/png" } : null),
      gerarPdf: (dados) => { dadosPassadosPraPdf = dados; return Promise.resolve(Buffer.from("PDF-FAKE")); },
    }
  );

  assert.deepEqual(dadosPassadosPraPdf.assinaturaImagem, Buffer.from("img"));
  assert.equal(dadosPassadosPraPdf.assinaturaMime, "image/png");
});

test("gerarPdfRelatorioController: relatório sem fisioterapeutaId (legado) não busca assinatura", async () => {
  const res = criarRespostaFalsa();
  let buscouAssinatura = false;
  let dadosPassadosPraPdf = null;
  await gerarPdfRelatorioController(
    { params: { id: "7", relatorioId: "5" } },
    res,
    {
      buscarPaciente: async () => PACIENTE,
      buscarRelatorio: async () => RELATORIO,
      buscarAssinatura: async () => { buscouAssinatura = true; return null; },
      gerarPdf: (dados) => { dadosPassadosPraPdf = dados; return Promise.resolve(Buffer.from("PDF-FAKE")); },
    }
  );

  assert.equal(buscouAssinatura, false);
  assert.equal(dadosPassadosPraPdf.assinaturaImagem, null);
});

test("processarRascunhoRelatorioPdf: com fisioterapeuta_id, resolve texto e assinatura juntos", async () => {
  const res = criarRespostaFalsa();
  let dadosPassadosPraPdf = null;
  await processarRascunhoRelatorioPdf(
    { params: { id: "7" }, body: { fisioterapeuta_id: "3" } },
    res,
    {
      buscarPaciente: async () => PACIENTE,
      buscarFisioterapeuta: async (id) => (id === 3 ? FISIOTERAPEUTA : null),
      buscarAssinatura: async (id) => (id === 3 ? { assinaturaImagem: Buffer.from("img"), assinaturaMime: "image/png" } : null),
      gerarPdf: (dados) => { dadosPassadosPraPdf = dados; return Promise.resolve(Buffer.from("PDF-RASCUNHO")); },
    }
  );

  assert.equal(dadosPassadosPraPdf.profissionalResponsavel, "Dra. Isabella Silva Reis / Crefito 435050-F");
  assert.deepEqual(dadosPassadosPraPdf.assinaturaImagem, Buffer.from("img"));
});
```

E remover/ajustar o teste antigo `"processarNovoRelatorio: caminho feliz grava com registradoPor do usuário logado e redireciona pra ficha"` pra não mais depender de `body.profissional_responsavel` texto livre (ele é substituído pelos dois novos testes de `fisioterapeuta_id` acima — pode ser removido).

Adicionar também os equivalentes em DOCX (mesma lógica dos dois testes de `gerarPdfRelatorioController` e do teste de `processarRascunhoRelatorioPdf` acima, só trocando o service/prefixo do buffer fake):

```javascript
test("gerarDocxRelatorioController: relatório com fisioterapeutaId busca e passa a assinatura pro gerarDocx", async () => {
  const res = criarRespostaFalsa();
  let dadosPassadosPraDocx = null;
  await gerarDocxRelatorioController(
    { params: { id: "7", relatorioId: "5" } },
    res,
    {
      buscarPaciente: async () => PACIENTE,
      buscarRelatorio: async () => ({ ...RELATORIO, fisioterapeutaId: 3 }),
      buscarAssinatura: async (id) => (id === 3 ? { assinaturaImagem: Buffer.from("img"), assinaturaMime: "image/png" } : null),
      gerarDocx: (dados) => { dadosPassadosPraDocx = dados; return Promise.resolve(Buffer.from("DOCX-FAKE")); },
    }
  );

  assert.deepEqual(dadosPassadosPraDocx.assinaturaImagem, Buffer.from("img"));
  assert.equal(dadosPassadosPraDocx.assinaturaMime, "image/png");
});

test("gerarDocxRelatorioController: relatório sem fisioterapeutaId (legado) não busca assinatura", async () => {
  const res = criarRespostaFalsa();
  let buscouAssinatura = false;
  let dadosPassadosPraDocx = null;
  await gerarDocxRelatorioController(
    { params: { id: "7", relatorioId: "5" } },
    res,
    {
      buscarPaciente: async () => PACIENTE,
      buscarRelatorio: async () => RELATORIO,
      buscarAssinatura: async () => { buscouAssinatura = true; return null; },
      gerarDocx: (dados) => { dadosPassadosPraDocx = dados; return Promise.resolve(Buffer.from("DOCX-FAKE")); },
    }
  );

  assert.equal(buscouAssinatura, false);
  assert.equal(dadosPassadosPraDocx.assinaturaImagem, null);
});

test("processarRascunhoRelatorioDocx: com fisioterapeuta_id, resolve texto e assinatura juntos", async () => {
  const res = criarRespostaFalsa();
  let dadosPassadosPraDocx = null;
  await processarRascunhoRelatorioDocx(
    { params: { id: "7" }, body: { fisioterapeuta_id: "3" } },
    res,
    {
      buscarPaciente: async () => PACIENTE,
      buscarFisioterapeuta: async (id) => (id === 3 ? FISIOTERAPEUTA : null),
      buscarAssinatura: async (id) => (id === 3 ? { assinaturaImagem: Buffer.from("img"), assinaturaMime: "image/png" } : null),
      gerarDocx: (dados) => { dadosPassadosPraDocx = dados; return Promise.resolve(Buffer.from("DOCX-RASCUNHO")); },
    }
  );

  assert.equal(dadosPassadosPraDocx.profissionalResponsavel, "Dra. Isabella Silva Reis / Crefito 435050-F");
  assert.deepEqual(dadosPassadosPraDocx.assinaturaImagem, Buffer.from("img"));
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/relatorioFisioterapeuticoController.test.js`
Expected: FAIL nos testes novos/alterados

- [ ] **Step 3: Implementar em `src/controllers/relatorioFisioterapeuticoController.js`**

```javascript
import { buscarPacientePorId } from "../models/pacienteModel.js";
import {
  criarRelatorio,
  buscarRelatorioDoPaciente,
  atualizarRelatorio,
  excluirRelatorio,
} from "../models/relatorioFisioterapeuticoModel.js";
import {
  listarFisioterapeutas,
  buscarFisioterapeutaPorId,
  buscarAssinaturaFisioterapeuta,
} from "../models/fisioterapeutaModel.js";
import { gerarPdfRelatorio } from "../services/relatorioFisioterapeuticoPdfService.js";
import { gerarDocxRelatorio } from "../services/relatorioFisioterapeuticoDocxService.js";
import { slugArquivo } from "../utils/slugArquivo.js";
import { idSeguro } from "../utils/paginacao.js";
import { validarData } from "../utils/validacao.js";

function campoOuNulo(valor) {
  const texto = String(valor ?? "").trim();
  return texto || null;
}

function camposConteudoDoBody(body) {
  return {
    diagnosticoMotivo: campoOuNulo(body.diagnostico_motivo),
    condutaEvolucao: campoOuNulo(body.conduta_evolucao),
    consideracoesFinais: campoOuNulo(body.consideracoes_finais),
  };
}

function formatarProfissionalResponsavel(fisioterapeuta) {
  return fisioterapeuta.crefito
    ? `${fisioterapeuta.nome} / Crefito ${fisioterapeuta.crefito}`
    : fisioterapeuta.nome;
}

/**
 * Resolve o fisioterapeuta escolhido no <select> do formulário. Sem
 * seleção válida, devolve os dois campos null — mesmo comportamento de
 * hoje quando o campo (antes texto livre) ficava em branco.
 */
async function resolverFisioterapeuta(body, { buscarFisioterapeuta }) {
  const fisioterapeutaId = idSeguro(body.fisioterapeuta_id);
  if (!fisioterapeutaId) return { fisioterapeutaId: null, profissionalResponsavel: null };

  const fisioterapeuta = await buscarFisioterapeuta(fisioterapeutaId);
  if (!fisioterapeuta || !fisioterapeuta.ativo) {
    return { fisioterapeutaId: null, profissionalResponsavel: null };
  }
  return { fisioterapeutaId: fisioterapeuta.id, profissionalResponsavel: formatarProfissionalResponsavel(fisioterapeuta) };
}

/**
 * Busca a assinatura atual do fisioterapeuta (sempre "ao vivo", nunca
 * guardada no relatório) — mesmo espírito de "documento gerado sob
 * demanda, nunca salvo" que já vale pro relatório inteiro. Sem
 * fisioterapeutaId (relatório legado ou sem seleção), não bate no banco.
 */
async function buscarDadosAssinatura(fisioterapeutaId, { buscarAssinatura = buscarAssinaturaFisioterapeuta } = {}) {
  if (!fisioterapeutaId) return { assinaturaImagem: null, assinaturaMime: null };

  const assinatura = await buscarAssinatura(fisioterapeutaId);
  if (!assinatura) return { assinaturaImagem: null, assinaturaMime: null };
  return { assinaturaImagem: assinatura.assinaturaImagem, assinaturaMime: assinatura.assinaturaMime };
}

export async function telaNovoRelatorio(
  req, res,
  { buscarPaciente = buscarPacientePorId, listarFisioterapeutas: listar = listarFisioterapeutas } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  if (!pacienteId) return res.status(404).send("Paciente não encontrado.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  const fisioterapeutas = await listar({ apenasAtivos: true });

  res.render("relatorios/formulario", {
    paciente,
    relatorio: null,
    fisioterapeutas,
    erro: null,
    acaoForm: `/pacientes/${pacienteId}/relatorios/novo`,
  });
}

export async function processarNovoRelatorio(
  req, res,
  { buscarPaciente = buscarPacientePorId, criar = criarRelatorio, buscarFisioterapeuta = buscarFisioterapeutaPorId } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  if (!pacienteId) return res.status(404).send("Paciente não encontrado.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  const body = req.body ?? {};
  const dataRelatorio = String(body.data_relatorio ?? "").trim();
  if (!validarData(dataRelatorio)) return res.status(400).send("Data do relatório inválida.");

  const { fisioterapeutaId, profissionalResponsavel } = await resolverFisioterapeuta(body, { buscarFisioterapeuta });

  await criar({
    pacienteId,
    dataRelatorio,
    ...camposConteudoDoBody(body),
    profissionalResponsavel,
    fisioterapeutaId,
    registradoPor: req.usuarioAtual.id,
  });

  res.redirect(`/pacientes/${pacienteId}/ficha`);
}

export async function telaEditarRelatorio(
  req, res,
  {
    buscarPaciente = buscarPacientePorId,
    buscarRelatorio = buscarRelatorioDoPaciente,
    listarFisioterapeutas: listar = listarFisioterapeutas,
  } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  const relatorioId = idSeguro(req.params.relatorioId);
  if (!pacienteId || !relatorioId) return res.status(404).send("Relatório não encontrado.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  const relatorio = await buscarRelatorio(relatorioId, pacienteId);
  if (!relatorio) return res.status(404).send("Relatório não encontrado.");

  const fisioterapeutas = await listar({ apenasAtivos: true });

  res.render("relatorios/formulario", {
    paciente,
    relatorio,
    fisioterapeutas,
    erro: null,
    acaoForm: `/pacientes/${pacienteId}/relatorios/${relatorioId}/editar`,
  });
}

export async function processarEditarRelatorio(
  req, res,
  {
    buscarRelatorio = buscarRelatorioDoPaciente,
    atualizar = atualizarRelatorio,
    buscarFisioterapeuta = buscarFisioterapeutaPorId,
  } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  const relatorioId = idSeguro(req.params.relatorioId);
  if (!pacienteId || !relatorioId) return res.status(404).send("Relatório não encontrado.");

  const relatorio = await buscarRelatorio(relatorioId, pacienteId);
  if (!relatorio) return res.status(404).send("Relatório não encontrado.");

  const body = req.body ?? {};
  const dataRelatorio = String(body.data_relatorio ?? "").trim();
  if (!validarData(dataRelatorio)) return res.status(400).send("Data do relatório inválida.");

  let { fisioterapeutaId, profissionalResponsavel } = await resolverFisioterapeuta(body, { buscarFisioterapeuta });

  // Relatório antigo (sem fisioterapeuta cadastrado) sendo editado sem
  // trocar a seleção: preserva o texto livre que já tinha, em vez de
  // apagá-lo — ver formulario.ejs (Tarefa 11), que manda esse campo
  // escondido só quando esse caso se aplica.
  if (!fisioterapeutaId && campoOuNulo(body.profissional_responsavel_legado)) {
    profissionalResponsavel = campoOuNulo(body.profissional_responsavel_legado);
  }

  await atualizar(relatorioId, {
    dataRelatorio,
    ...camposConteudoDoBody(body),
    profissionalResponsavel,
    fisioterapeutaId,
  });

  res.redirect(`/pacientes/${pacienteId}/ficha`);
}

export async function gerarPdfRelatorioController(
  req, res,
  {
    buscarPaciente = buscarPacientePorId,
    buscarRelatorio = buscarRelatorioDoPaciente,
    buscarAssinatura = buscarAssinaturaFisioterapeuta,
    gerarPdf = gerarPdfRelatorio,
  } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  const relatorioId = idSeguro(req.params.relatorioId);
  if (!pacienteId || !relatorioId) return res.status(404).send("Relatório não encontrado.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  const relatorio = await buscarRelatorio(relatorioId, pacienteId);
  if (!relatorio) return res.status(404).send("Relatório não encontrado.");

  const dadosAssinatura = await buscarDadosAssinatura(relatorio.fisioterapeutaId, { buscarAssinatura });

  const pdf = await gerarPdf({ pacienteNome: paciente.nome, ...relatorio, ...dadosAssinatura });
  const nomeArquivo = `relatorio-${slugArquivo(paciente.nome)}-${relatorio.dataRelatorio}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo}"`);
  res.send(pdf);
}

export async function gerarDocxRelatorioController(
  req, res,
  {
    buscarPaciente = buscarPacientePorId,
    buscarRelatorio = buscarRelatorioDoPaciente,
    buscarAssinatura = buscarAssinaturaFisioterapeuta,
    gerarDocx = gerarDocxRelatorio,
  } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  const relatorioId = idSeguro(req.params.relatorioId);
  if (!pacienteId || !relatorioId) return res.status(404).send("Relatório não encontrado.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  const relatorio = await buscarRelatorio(relatorioId, pacienteId);
  if (!relatorio) return res.status(404).send("Relatório não encontrado.");

  const dadosAssinatura = await buscarDadosAssinatura(relatorio.fisioterapeutaId, { buscarAssinatura });

  const docx = await gerarDocx({ pacienteNome: paciente.nome, ...relatorio, ...dadosAssinatura });
  const nomeArquivo = `relatorio-${slugArquivo(paciente.nome)}-${relatorio.dataRelatorio}.docx`;
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo}"`);
  res.send(docx);
}

export async function processarRascunhoRelatorioPdf(
  req, res,
  {
    buscarPaciente = buscarPacientePorId,
    buscarFisioterapeuta = buscarFisioterapeutaPorId,
    buscarAssinatura = buscarAssinaturaFisioterapeuta,
    gerarPdf = gerarPdfRelatorio,
  } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  if (!pacienteId) return res.status(404).send("Paciente não encontrado.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  const body = req.body ?? {};
  const { fisioterapeutaId, profissionalResponsavel } = await resolverFisioterapeuta(body, { buscarFisioterapeuta });
  const dadosAssinatura = await buscarDadosAssinatura(fisioterapeutaId, { buscarAssinatura });

  const pdf = await gerarPdf({
    pacienteNome: paciente.nome,
    dataRelatorio: campoOuNulo(body.data_relatorio),
    ...camposConteudoDoBody(body),
    profissionalResponsavel,
    ...dadosAssinatura,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="rascunho-relatorio-${slugArquivo(paciente.nome)}.pdf"`);
  res.send(pdf);
}

export async function processarRascunhoRelatorioDocx(
  req, res,
  {
    buscarPaciente = buscarPacientePorId,
    buscarFisioterapeuta = buscarFisioterapeutaPorId,
    buscarAssinatura = buscarAssinaturaFisioterapeuta,
    gerarDocx = gerarDocxRelatorio,
  } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  if (!pacienteId) return res.status(404).send("Paciente não encontrado.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  const body = req.body ?? {};
  const { fisioterapeutaId, profissionalResponsavel } = await resolverFisioterapeuta(body, { buscarFisioterapeuta });
  const dadosAssinatura = await buscarDadosAssinatura(fisioterapeutaId, { buscarAssinatura });

  const docx = await gerarDocx({
    pacienteNome: paciente.nome,
    dataRelatorio: campoOuNulo(body.data_relatorio),
    ...camposConteudoDoBody(body),
    profissionalResponsavel,
    ...dadosAssinatura,
  });
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="rascunho-relatorio-${slugArquivo(paciente.nome)}.docx"`
  );
  res.send(docx);
}

export async function processarExcluirRelatorio(req, res, { excluir = excluirRelatorio } = {}) {
  const pacienteId = idSeguro(req.params.id);
  const relatorioId = idSeguro(req.params.relatorioId);
  if (!pacienteId || !relatorioId) return res.status(404).send("Relatório não encontrado.");

  const excluiu = await excluir(relatorioId, pacienteId);
  if (!excluiu) return res.status(404).send("Relatório não encontrado.");

  res.redirect(`/pacientes/${pacienteId}/ficha`);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/relatorioFisioterapeuticoController.test.js`
Expected: PASS

- [ ] **Step 5: Lint e commit**

```bash
npm run lint
git add src/controllers/relatorioFisioterapeuticoController.js test/relatorioFisioterapeuticoController.test.js
git commit -m "feat: relatorioFisioterapeuticoController resolve fisioterapeuta e assinatura"
```

---

### Task 11: `relatorios/formulario.ejs` — seletor de fisioterapeuta

**Files:**
- Modify: `src/views/relatorios/formulario.ejs`
- Modify: `test/relatorioFormularioView.test.js`

**Interfaces:**
- Consumes: `fisioterapeutas` (lista de ativos, da Tarefa 10), `relatorio.fisioterapeutaId` (da Tarefa 7).

- [ ] **Step 1: Atualizar os testes existentes que quebram e adicionar os novos**

Em `test/relatorioFormularioView.test.js`, atualizar a função `renderizar` pra incluir `fisioterapeutas: []` por padrão, e trocar as duas asserções que checavam o antigo campo de texto livre:

```javascript
async function renderizar(dados) {
  return ejs.renderFile(path.join(VIEWS_DIR, "relatorios/formulario.ejs"), {
    csrfToken: "token-teste",
    paciente: { id: 7, nome: "Ana Silva" },
    relatorio: null,
    fisioterapeutas: [],
    erro: null,
    acaoForm: "/pacientes/7/relatorios/novo",
    ...dados,
  });
}
```

No teste `"formulario: sem relatorio, todos os campos vêm vazios..."`, trocar:

```javascript
  assert.match(html, /name="profissional_responsavel"/);
```

por:

```javascript
  assert.match(html, /name="fisioterapeuta_id"/);
```

No teste `"formulario: com relatorio preenchido..."`, trocar a linha que afirma o `value=` do texto livre por uma checagem de seleção, e adicionar `fisioterapeutaId`/`fisioterapeutas` aos dados:

```javascript
test("formulario: com relatorio preenchido, campos vêm pré-preenchidos, fisioterapeuta selecionado e mostra link de PDF e Word", async () => {
  const html = await renderizar({
    relatorio: {
      id: 5, dataRelatorio: "2026-09-11",
      diagnosticoMotivo: "Fratura 5º dedo mão direita",
      condutaEvolucao: "Ganho de mobilidade progressivo",
      consideracoesFinais: "Consolidação parcial",
      profissionalResponsavel: "Dra. Isabella Silva Reis / Crefito 435050-F",
      fisioterapeutaId: 3,
    },
    fisioterapeutas: [{ id: 3, nome: "Dra. Isabella Silva Reis", crefito: "435050-F" }],
    acaoForm: "/pacientes/7/relatorios/5/editar",
  });

  assert.match(html, /name="data_relatorio"[^>]*value="2026-09-11"/);
  assert.match(html, /<option value="3" selected>/);
  assert.match(html, />Ganho de mobilidade progressivo</);
  assert.match(html, /href="\/pacientes\/7\/relatorios\/5\/pdf"/);
  assert.match(html, /href="\/pacientes\/7\/relatorios\/5\/docx"/);
});
```

E adicionar dois testes novos:

```javascript
test("formulario: relatorio legado (profissionalResponsavel em texto, sem fisioterapeutaId) mostra aviso e campo oculto de preservação", async () => {
  const html = await renderizar({
    relatorio: {
      id: 5, dataRelatorio: "2026-09-11",
      profissionalResponsavel: "Dr. Antigo / Crefito 111111-F",
      fisioterapeutaId: null,
    },
    acaoForm: "/pacientes/7/relatorios/5/editar",
  });

  assert.match(html, /Dr\. Antigo \/ Crefito 111111-F/);
  assert.match(html, /name="profissional_responsavel_legado" value="Dr\. Antigo \/ Crefito 111111-F"/);
});

test("formulario: relatorio novo (fisioterapeutaId null, sem texto legado) não mostra aviso nem campo oculto", async () => {
  const html = await renderizar({ relatorio: null });

  assert.doesNotMatch(html, /profissional_responsavel_legado/);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/relatorioFormularioView.test.js`
Expected: FAIL (view ainda não mudou)

- [ ] **Step 3: Editar `src/views/relatorios/formulario.ejs`**

Trocar:

```html
    <label>Profissional responsável (nome e Crefito)<input type="text" name="profissional_responsavel" placeholder="Ex.: Dra. Isabella Silva Reis / Crefito 435050-F" value="<%= relatorio?.profissionalResponsavel ?? '' %>" /></label>
```

por:

```html
    <label>Profissional responsável
      <select name="fisioterapeuta_id">
        <option value="">— selecione —</option>
        <% for (const fisioterapeuta of fisioterapeutas) { %>
        <option value="<%= fisioterapeuta.id %>"<%= relatorio?.fisioterapeutaId === fisioterapeuta.id ? " selected" : "" %>><%= fisioterapeuta.crefito ? `${fisioterapeuta.nome} / Crefito ${fisioterapeuta.crefito}` : fisioterapeuta.nome %></option>
        <% } %>
      </select>
    </label>
```

E logo depois do `</div>` que fecha `.form-grid` (linha 20 de hoje), antes do `<fieldset>`, adicionar o aviso de compatibilidade com relatórios antigos:

```html
  <% if (relatorio && relatorio.profissionalResponsavel && !relatorio.fisioterapeutaId) { %>
  <p>Assinatura anterior (texto livre, sem fisioterapeuta cadastrado): <%= relatorio.profissionalResponsavel %>. Selecione um fisioterapeuta acima pra habilitar a assinatura eletrônica, ou deixe em branco pra manter esse texto.</p>
  <input type="hidden" name="profissional_responsavel_legado" value="<%= relatorio.profissionalResponsavel %>" />
  <% } %>
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/relatorioFormularioView.test.js`
Expected: PASS

- [ ] **Step 5: Rodar a suíte inteira + lint**

Run: `npm test && npm run lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/views/relatorios/formulario.ejs test/relatorioFormularioView.test.js
git commit -m "feat: formulário do relatório seleciona fisioterapeuta cadastrado em vez de texto livre"
```

---

### Task 12: Documentação

**Files:**
- Modify: `TODO.md`
- Modify: `README.md`

**Interfaces:**
- Nenhuma (só documentação) — mas relevante pra quem for aplicar a migration 040 depois (Tarefa 13) e pra manter `TODO.md` fiel ao estado real do projeto, seguindo a convenção já usada nas entradas anteriores.

- [ ] **Step 1: Adicionar uma entrada em `TODO.md`** (seção "Próxima retomada" ou equivalente no topo, seguindo o estilo das entradas existentes)

```markdown
- [ ] Assinatura eletrônica no relatório fisioterapêutico: implementada
  (2026-09-16) — cadastro `/fisioterapeutas` (nome, Crefito, imagem de
  assinatura, restrito a administradora), formulário do relatório agora
  seleciona o fisioterapeuta em vez de texto livre, PDF/DOCX embutem a
  assinatura quando cadastrada (fallback pra linha em branco quando não
  há). Spec `docs/superpowers/specs/2026-09-16-assinatura-relatorio-fisioterapeutico-design.md`,
  plano `docs/superpowers/plans/2026-09-16-assinatura-relatorio-fisioterapeutico.md`.
  **Pendente**: migration 040 (`fisioterapeutas` + `relatorios_fisioterapeuticos.fisioterapeuta_id`)
  ainda não aplicada em produção — bloqueante pro deploy, ver checklist do
  README. `npm install` também pendente na máquina de deploy (nova
  dependência: `multer`).
```

- [ ] **Step 2: Adicionar a migration 040 na lista de migrations do checklist de deploy do `README.md`**

Localizar a linha "2. **Migrations**: rode todas, na ordem numérica (`001` até `009`)..." (item 2 do checklist, seção "Guia passo a passo pra Railway") e, se ainda listar um intervalo desatualizado, deixar claro que a migration 040 é a mais recente pendente — seguir o texto já existente ali, só garantindo que a 040 apareça mencionada como a última aplicável.

- [ ] **Step 3: Commit**

```bash
git add TODO.md README.md
git commit -m "docs: registra a feature de assinatura eletrônica e a migration 040 pendente"
```

---

### Task 13: Verificação manual (⚠️ toca produção — só com autorização explícita)

**Files:** nenhum (verificação, não código)

Este projeto não tem banco de dev separado do de produção (ver Global Constraints). **Nenhum destes passos deve ser executado automaticamente** — apresentar este checklist ao usuário e pedir autorização explícita, passo a passo, antes de cada ação que grava no Neon real ou mexe no deploy do Railway, seguindo a mesma sequência (checar → reportar → agir) já estabelecida no projeto.

- [ ] **Step 1: Aplicar a migration 040 contra o Neon** — só com autorização explícita do usuário. Confirmar depois via `information_schema`/`pg_constraint` que `fisioterapeutas` existe e que `relatorios_fisioterapeuticos.fisioterapeuta_id` foi criada.
- [ ] **Step 2: Rodar `npm install` localmente** (já deveria ter sido feito nas Tarefas 3-11 durante o desenvolvimento, mas confirmar que `multer` está no `package-lock.json` commitado).
- [ ] **Step 3: Testar o fluxo completo manualmente** (com um usuário administradora de teste, ou o real, a critério do usuário): cadastrar um fisioterapeuta de teste em `/fisioterapeutas/novo` com uma imagem de assinatura de verdade (PNG/JPEG pequena), gerar um relatório fisioterapêutico pra um paciente de teste selecionando esse fisioterapeuta, baixar o PDF e o DOCX e abrir os dois de verdade pra conferir visualmente que a imagem aparece centralizada e com tamanho razoável (o `fit: [180, 70]` da Tarefa 8/9 é um chute inicial — ajustar se ficar grande/pequeno/distorcido demais).
- [ ] **Step 4: Testar o fallback** — gerar um relatório sem selecionar fisioterapeuta (ou selecionando um sem assinatura cadastrada) e confirmar que a linha em branco tradicional ainda aparece, sem erro.
- [ ] **Step 5: Testar um relatório legado** (criado antes desta feature, se existir algum em produção) — abrir pra editar e confirmar que o aviso de compatibilidade aparece e que salvar sem mexer no seletor preserva o texto antigo.
- [ ] **Step 6: Limpar os dados de teste** (fisioterapeuta e relatório de teste criados no Step 3), seguindo o padrão já estabelecido no projeto pra limpeza de registros de teste.
- [ ] **Step 7: Deploy pro Railway** — só depois de tudo acima confirmado, e só com autorização explícita (`git push`, ou o fluxo de deploy que o usuário preferir nesse momento).
