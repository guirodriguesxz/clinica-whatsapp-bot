# Ficha de Impressão do Paciente (Dados Cadastrais Completos) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A ficha do paciente ganha uma seção de dados cadastrais completos (CPF, RG, endereço, estado civil, profissão, e-mail, matrícula do convênio), editável pela recepção, no formato do sistema antigo da clínica — e é essa seção que sai na impressão, no lugar do resumo simples de hoje.

**Architecture:** Campos novos em `pacientes` (todos nullable, preenchidos aos poucos). Tela de edição nova reaproveitando os padrões já estabelecidos (formulário com CSRF, `idSeguro`, permissão de qualquer usuário logado). A ficha existente ganha a grade de campos no lugar do resumo atual; o CSS de impressão já existente é ajustado pra também esconder o pacote de sessões (hoje só esconde o histórico de agendamentos).

**Tech Stack:** Node.js, Express, EJS, Postgres (Neon) via `pg`, `dayjs`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-03-ficha-impressao-paciente-design.md`

## Global Constraints

- Todos os campos novos são opcionais/nullable — sem validação de formato além do que o navegador já faz nativamente (`type="email"`).
- `atualizarDadosPaciente` preserva o comportamento existente: chamadas antigas (só `nome`/`convenio`, como `criarAgendamento.js` já faz) continuam funcionando sem alterar os demais campos — usa `COALESCE`, mesmo padrão de hoje.
- Mesma permissão do resto do dashboard: qualquer usuário logado pode editar (sem exigir papel de administradora).
- "Médico" na ficha é texto fixo "Ana Exemplo" — nunca um campo de banco.
- Campo sem valor aparece em branco na ficha (nunca "Não informado" — é pra impressão em papel).
- `pacientes.data_nascimento` é uma coluna `DATE` — o driver `pg` devolve isso como string `"YYYY-MM-DD"` pura (ver `types.setTypeParser(types.builtins.DATE, ...)` em `src/db/pool.js`), não como `Date`. `formatarData` não deve usar `.tz()` (diferente de `formatarDataHora`, que trata `TIMESTAMPTZ`) — aplicar fuso horário a uma data sem hora pode deslocar o dia.
- Rodar `npm test` depois de cada tarefa antes de commitar — todos os testes existentes continuam passando.

---

## File Structure

```
src/
├── db/migrations/
│   └── 023_dados_cadastrais_paciente.sql   # nova
├── utils/
│   └── data.js                  # +formatarData
├── models/
│   └── pacienteModel.js         # atualizarDadosPaciente ganha os campos novos
├── controllers/
│   └── dashboardController.js   # +telaEditarPaciente, +processarEditarPaciente;
│                                 #   telaFichaPaciente calcula idade
├── routes/
│   └── dashboardRoutes.js       # rotas novas de editar paciente
└── views/
    └── pacientes/
        ├── ficha.ejs             # substitui o resumo por dados cadastrais
        └── editar.ejs            # nova
app.js                            # +app.locals.formatarData
public/
└── dashboard.css                 # +.ficha-cadastral (grade), +esconde
                                   #   .session-package na impressão
test/
├── migrations.test.js            # +migration 023
├── data.test.js                  # +formatarData
├── pacienteModelAtualizarDados.test.js   # nova
├── dashboardControllerEditarPaciente.test.js   # nova
└── fichaPacienteView.test.js     # +campos novos, +idade
```

---

### Task 1: Migration 023 — campos cadastrais completos

**Files:**
- Create: `src/db/migrations/023_dados_cadastrais_paciente.sql`
- Test: `test/migrations.test.js`

**Interfaces:**
- Produces: colunas `pacientes.rg`, `.endereco`, `.numero`, `.bairro`, `.cidade`, `.uf`, `.cep`, `.estado_civil`, `.sexo`, `.profissao`, `.email`, `.matricula_convenio` — todas `TEXT`, nullable.

- [ ] **Step 1: Escrever a migration**

```sql
-- src/db/migrations/023_dados_cadastrais_paciente.sql
-- Clínica Exemplo Bot — migration 023: dados cadastrais completos do paciente
--
-- A ficha do paciente passa a ter uma seção de dados cadastrais completos,
-- editável pela recepção, no formato do sistema antigo da clínica (ver
-- docs/superpowers/specs/2026-09-03-ficha-impressao-paciente-design.md).
-- Todos os campos são opcionais — preenchidos aos poucos pela recepção,
-- não em massa. cpf e data_nascimento já existem (migration 010) e passam
-- a ser exibidos/editáveis pela primeira vez, sem mudança de schema aqui.

ALTER TABLE pacientes
  ADD COLUMN IF NOT EXISTS rg TEXT,
  ADD COLUMN IF NOT EXISTS endereco TEXT,
  ADD COLUMN IF NOT EXISTS numero TEXT,
  ADD COLUMN IF NOT EXISTS bairro TEXT,
  ADD COLUMN IF NOT EXISTS cidade TEXT,
  ADD COLUMN IF NOT EXISTS uf TEXT,
  ADD COLUMN IF NOT EXISTS cep TEXT,
  ADD COLUMN IF NOT EXISTS estado_civil TEXT,
  ADD COLUMN IF NOT EXISTS sexo TEXT,
  ADD COLUMN IF NOT EXISTS profissao TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS matricula_convenio TEXT;
```

- [ ] **Step 2: Escrever o teste da migration (mesmo padrão das migrations 020-022 já existentes)**

Adicionar ao final de `test/migrations.test.js`:

```javascript
const MIGRATION_023 = path.join(ROOT, "src/db/migrations/023_dados_cadastrais_paciente.sql");

test("migration 023: adiciona colunas cadastrais nullable em pacientes", async () => {
  const sql = await readFile(MIGRATION_023, "utf8");

  for (const coluna of [
    "rg", "endereco", "numero", "bairro", "cidade", "uf", "cep",
    "estado_civil", "sexo", "profissao", "email", "matricula_convenio",
  ]) {
    assert.match(
      sql,
      new RegExp(`ADD COLUMN IF NOT EXISTS ${coluna} TEXT`),
      `deve adicionar a coluna ${coluna}`
    );
  }
  // Nenhuma delas pode ser NOT NULL — são preenchidas aos poucos.
  assert.doesNotMatch(sql, /TEXT NOT NULL/);
});
```

- [ ] **Step 3: Rodar o teste**

Run: `node --test test/migrations.test.js`
Expected: PASS (5 testes: migrations 020-022 já existentes + 023 nova).

- [ ] **Step 4: Commit**

```bash
git add src/db/migrations/023_dados_cadastrais_paciente.sql test/migrations.test.js
git commit -m "feat: migration 023 — dados cadastrais completos do paciente"
```

---

### Task 2: `formatarData` — formatação de data sem hora

**Files:**
- Modify: `src/utils/data.js`
- Modify: `app.js`
- Test: `test/data.test.js`

**Interfaces:**
- Produces: `formatarData(valor) => string` — `"DD/MM/YYYY"` ou `""` se `valor` for ausente/inválido. Registrada em `app.locals.formatarData`.

- [ ] **Step 1: Escrever os testes**

Adicionar ao final de `test/data.test.js`:

```javascript
import { formatarDataHora, formatarData } from "../src/utils/data.js";
```

(troca o import existente de `formatarDataHora` sozinho por essa linha com os dois nomes)

```javascript
// pacientes.data_nascimento é DATE — o driver pg devolve isso como string
// "YYYY-MM-DD" pura (ver types.setTypeParser em src/db/pool.js), nunca como
// Date. formatarData não deve aplicar fuso horário (diferente de
// formatarDataHora) — uma data sem hora não tem o que converter, e usar
// .tz() arriscaria deslocar o dia.
test("formatarData: string YYYY-MM-DD vira DD/MM/AAAA", () => {
  assert.equal(formatarData("1956-06-13"), "13/06/1956");
});

test("formatarData: aceita Date também", () => {
  assert.equal(formatarData(new Date("2026-08-27T00:00:00.000Z")), "27/08/2026");
});

test("formatarData: null/undefined não quebra, vira string vazia", () => {
  assert.equal(formatarData(null), "");
  assert.equal(formatarData(undefined), "");
});

test("formatarData: valor inválido não quebra, vira string vazia", () => {
  assert.equal(formatarData("não é uma data"), "");
});
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `node --test test/data.test.js`
Expected: FAIL — `formatarData` não existe.

- [ ] **Step 3: Implementar**

Adicionar ao final de `src/utils/data.js`:

```javascript
/**
 * Formata uma data (sem hora) como DD/MM/AAAA — usado pra colunas DATE
 * (ex: pacientes.data_nascimento), que o driver pg devolve como string
 * "YYYY-MM-DD" pura (ver types.setTypeParser em src/db/pool.js), nunca
 * como objeto Date. Diferente de formatarDataHora, não aplica fuso
 * horário — uma data sem componente de hora não tem o que converter, e
 * usar .tz() aqui arriscaria deslocar o dia.
 */
export function formatarData(valor) {
  if (!valor) return "";
  const data = dayjs(valor);
  if (!data.isValid()) return "";
  return data.format("DD/MM/YYYY");
}
```

Em `app.js`, atualizar o import e o registro:

```javascript
import { formatarDataHora, formatarData } from "./utils/data.js";
```

```javascript
app.locals.formatarMoeda = formatarMoeda;
app.locals.formatarDataHora = formatarDataHora;
app.locals.formatarData = formatarData;
```

- [ ] **Step 4: Rodar os testes**

Run: `node --test test/data.test.js`
Expected: PASS em todos.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/data.js app.js test/data.test.js
git commit -m "feat: formatarData — formatação de data sem hora, sem conversão de fuso"
```

---

### Task 3: `pacienteModel.js` — `atualizarDadosPaciente` ganha os campos novos

**Files:**
- Modify: `src/models/pacienteModel.js`
- Test: `test/pacienteModelAtualizarDados.test.js` (novo)

**Interfaces:**
- Produces: `atualizarDadosPaciente(pacienteId, { nome, convenio, cpf, dataNascimento, rg, endereco, numero, bairro, cidade, uf, cep, estadoCivil, sexo, profissao, email, matriculaConvenio }) => Promise<void>` — assinatura estendida (todos os campos além de `pacienteId` são opcionais; `undefined` preserva o valor já gravado, via `COALESCE`).

- [ ] **Step 1: Escrever os testes**

```javascript
// test/pacienteModelAtualizarDados.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { atualizarDadosPaciente } from "../src/models/pacienteModel.js";

test("atualizarDadosPaciente: grava todos os campos novos quando informados", async (t) => {
  let sqlCapturado = null;
  let paramsCapturados = null;
  t.mock.method(pool, "query", async (sql, params) => {
    sqlCapturado = sql;
    paramsCapturados = params;
    return { rows: [] };
  });

  await atualizarDadosPaciente(5, {
    nome: "Ana Silva",
    convenio: "Mar Azul Saúde",
    cpf: "111.111.111-11",
    dataNascimento: "1990-01-01",
    rg: "22.222.222-2",
    endereco: "Rua Teste",
    numero: "123",
    bairro: "Centro",
    cidade: "São Paulo",
    uf: "SP",
    cep: "01000-000",
    estadoCivil: "Solteira",
    sexo: "F",
    profissao: "Professora",
    email: "ana@example.com",
    matriculaConvenio: "999888777",
  });

  assert.match(sqlCapturado, /UPDATE pacientes SET/);
  assert.deepEqual(paramsCapturados, [
    5, "Ana Silva", "Mar Azul Saúde", "111.111.111-11", "1990-01-01", "22.222.222-2",
    "Rua Teste", "123", "Centro", "São Paulo", "SP", "01000-000",
    "Solteira", "F", "Professora", "ana@example.com", "999888777",
  ]);
});

// Comportamento existente (chamada de criarAgendamento.js, só nome/convenio)
// precisa continuar funcionando sem alterar os demais campos.
test("atualizarDadosPaciente: chamada só com nome/convenio (comportamento existente) grava null nos campos novos", async (t) => {
  let paramsCapturados = null;
  t.mock.method(pool, "query", async (sql, params) => {
    paramsCapturados = params;
    return { rows: [] };
  });

  await atualizarDadosPaciente(5, { nome: "Bruno", convenio: "Particular" });

  assert.equal(paramsCapturados[0], 5);
  assert.equal(paramsCapturados[1], "Bruno");
  assert.equal(paramsCapturados[2], "Particular");
  // Campos novos não informados viram null no parâmetro — o SQL usa
  // COALESCE($n, coluna), então null preserva o valor já gravado no banco,
  // não apaga nada.
  for (let i = 3; i < paramsCapturados.length; i++) {
    assert.equal(paramsCapturados[i], null, `parâmetro índice ${i} deveria ser null`);
  }
});

test("atualizarDadosPaciente: usa COALESCE pra preservar valores não informados", async (t) => {
  let sqlCapturado = null;
  t.mock.method(pool, "query", async (sql) => {
    sqlCapturado = sql;
    return { rows: [] };
  });

  await atualizarDadosPaciente(5, { rg: "1.234.567-8" });

  assert.match(sqlCapturado, /rg = COALESCE\(\$6, rg\)/);
  assert.match(sqlCapturado, /nome = COALESCE\(\$2, nome\)/);
});
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `node --test test/pacienteModelAtualizarDados.test.js`
Expected: FAIL — assinatura atual não aceita os campos novos, SQL não bate.

- [ ] **Step 3: Implementar**

Em `src/models/pacienteModel.js`, substituir `atualizarDadosPaciente` (linhas 123-133) por:

```javascript
/**
 * Atualiza os dados cadastrais do paciente. Só sobrescreve os campos
 * informados (COALESCE) — undefined/null preserva o valor já gravado,
 * nunca apaga. Chamada tanto pelo bot (criarAgendamento.js, só
 * nome/convenio) quanto pela tela de edição do dashboard (todos os
 * campos, ver dashboardController.js).
 */
export async function atualizarDadosPaciente(pacienteId, {
  nome,
  convenio,
  cpf,
  dataNascimento,
  rg,
  endereco,
  numero,
  bairro,
  cidade,
  uf,
  cep,
  estadoCivil,
  sexo,
  profissao,
  email,
  matriculaConvenio,
}) {
  await pool.query(
    `UPDATE pacientes SET
       nome = COALESCE($2, nome),
       convenio = COALESCE($3, convenio),
       cpf = COALESCE($4, cpf),
       data_nascimento = COALESCE($5, data_nascimento),
       rg = COALESCE($6, rg),
       endereco = COALESCE($7, endereco),
       numero = COALESCE($8, numero),
       bairro = COALESCE($9, bairro),
       cidade = COALESCE($10, cidade),
       uf = COALESCE($11, uf),
       cep = COALESCE($12, cep),
       estado_civil = COALESCE($13, estado_civil),
       sexo = COALESCE($14, sexo),
       profissao = COALESCE($15, profissao),
       email = COALESCE($16, email),
       matricula_convenio = COALESCE($17, matricula_convenio)
     WHERE id = $1`,
    [
      pacienteId,
      nome ?? null,
      convenio ?? null,
      cpf ?? null,
      dataNascimento ?? null,
      rg ?? null,
      endereco ?? null,
      numero ?? null,
      bairro ?? null,
      cidade ?? null,
      uf ?? null,
      cep ?? null,
      estadoCivil ?? null,
      sexo ?? null,
      profissao ?? null,
      email ?? null,
      matriculaConvenio ?? null,
    ]
  );
}
```

- [ ] **Step 4: Rodar os testes**

Run: `node --test test/pacienteModelAtualizarDados.test.js`
Expected: PASS em todos.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS — `criarAgendamento.js` continua chamando com só `{ nome, convenio }`, os demais campos viram `null` no parâmetro e o `COALESCE` preserva o que já estava gravado.

- [ ] **Step 6: Commit**

```bash
git add src/models/pacienteModel.js test/pacienteModelAtualizarDados.test.js
git commit -m "feat: atualizarDadosPaciente ganha os campos cadastrais completos"
```

---

### Task 4: `dashboardController.js` — editar paciente e calcular idade na ficha

**Files:**
- Modify: `src/controllers/dashboardController.js`
- Test: `test/dashboardControllerEditarPaciente.test.js` (novo)

**Interfaces:**
- Consumes: `atualizarDadosPaciente` (Task 3) de `../models/pacienteModel.js`; `validarData` de `../utils/validacao.js` (já importado); `dayjs` de `../utils/dayjs.js` (importar).
- Produces:
  - `telaEditarPaciente(req, res, deps?)` — `GET /pacientes/:id/editar`.
  - `processarEditarPaciente(req, res, deps?)` — `POST /pacientes/:id/editar`.
  - `telaFichaPaciente` (já existe) passa a calcular `idade` e passar pra view.

- [ ] **Step 1: Escrever os testes**

```javascript
// test/dashboardControllerEditarPaciente.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  telaEditarPaciente,
  processarEditarPaciente,
  telaFichaPaciente,
} from "../src/controllers/dashboardController.js";

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

const PACIENTE = { id: 5, nome: "Ana", telefone: "5511999990000" };

test("telaEditarPaciente: id não numérico responde 404", async () => {
  const res = criarRespostaFalsa();
  await telaEditarPaciente({ params: { id: "abc" } }, res);
  assert.equal(res.statusCode, 404);
});

test("telaEditarPaciente: paciente inexistente responde 404", async () => {
  const res = criarRespostaFalsa();
  await telaEditarPaciente({ params: { id: "5" } }, res, { buscarPaciente: async () => null });
  assert.equal(res.statusCode, 404);
});

test("telaEditarPaciente: caminho feliz renderiza o formulário com os dados atuais", async () => {
  const res = criarRespostaFalsa();
  await telaEditarPaciente({ params: { id: "5" } }, res, { buscarPaciente: async () => PACIENTE });
  assert.equal(res.viewRenderizada, "pacientes/editar");
  assert.equal(res.dadosDaView.paciente.id, 5);
});

test("processarEditarPaciente: id não numérico responde 404", async () => {
  const res = criarRespostaFalsa();
  await processarEditarPaciente({ params: { id: "abc" }, body: {} }, res);
  assert.equal(res.statusCode, 404);
});

test("processarEditarPaciente: paciente inexistente responde 404", async () => {
  const res = criarRespostaFalsa();
  await processarEditarPaciente(
    { params: { id: "5" }, body: {} },
    res,
    { buscarPaciente: async () => null }
  );
  assert.equal(res.statusCode, 404);
});

test("processarEditarPaciente: data de nascimento inválida responde 400 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarEditarPaciente(
    { params: { id: "5" }, body: { data_nascimento: "31-02-2026" } },
    res,
    { buscarPaciente: async () => PACIENTE, atualizarPaciente: async () => { gravou = true; } }
  );
  assert.equal(res.statusCode, 400);
  assert.equal(gravou, false);
});

test("processarEditarPaciente: caminho feliz grava os campos e redireciona pra ficha", async () => {
  const res = criarRespostaFalsa();
  let campos = null;
  await processarEditarPaciente(
    {
      params: { id: "5" },
      body: {
        cpf: " 111.111.111-11 ",
        data_nascimento: "1990-01-01",
        rg: "",
        endereco: "Rua Teste",
        sexo: "F",
      },
    },
    res,
    {
      buscarPaciente: async () => PACIENTE,
      atualizarPaciente: async (id, dados) => { campos = { id, ...dados }; },
    }
  );

  assert.equal(res.redirectedTo, "/pacientes/5/ficha");
  assert.equal(campos.id, 5);
  assert.equal(campos.cpf, "111.111.111-11", "campo com espaços deve vir trimado");
  assert.equal(campos.dataNascimento, "1990-01-01");
  assert.equal(campos.rg, null, "campo vazio vira null, não string vazia");
  assert.equal(campos.endereco, "Rua Teste");
  assert.equal(campos.sexo, "F");
});

test("telaFichaPaciente: calcula idade a partir de data_nascimento", async () => {
  const res = criarRespostaFalsa();
  const pacienteComNascimento = { ...PACIENTE, data_nascimento: "1990-01-01" };
  await telaFichaPaciente(
    { params: { id: "5" } },
    res,
    {
      buscarPaciente: async () => pacienteComNascimento,
      buscarHistorico: async () => [],
      buscarPacotes: async () => [],
    }
  );
  assert.ok(res.dadosDaView.idade >= 35, "idade calculada deve ser um número plausível");
});

test("telaFichaPaciente: sem data_nascimento, idade é null", async () => {
  const res = criarRespostaFalsa();
  await telaFichaPaciente(
    { params: { id: "5" } },
    res,
    {
      buscarPaciente: async () => PACIENTE,
      buscarHistorico: async () => [],
      buscarPacotes: async () => [],
    }
  );
  assert.equal(res.dadosDaView.idade, null);
});
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `node --test test/dashboardControllerEditarPaciente.test.js`
Expected: FAIL — `telaEditarPaciente`/`processarEditarPaciente` não existem; `telaFichaPaciente` ainda não passa `idade`.

- [ ] **Step 3: Implementar**

No topo de `src/controllers/dashboardController.js`, adicionar aos imports existentes:

```javascript
import dayjs from "../utils/dayjs.js";
```

(o import de `atualizarDadosPaciente`, `buscarPacientePorId` e `validarData` já existem no arquivo — reaproveitados.)

Substituir `telaFichaPaciente` (linhas 247-267) por:

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

  const [historico, pacotes] = await Promise.all([
    buscarHistorico(pacienteId),
    buscarPacotes(pacienteId),
  ]);

  const idade = paciente.data_nascimento
    ? dayjs().diff(dayjs(paciente.data_nascimento), "year")
    : null;

  res.render("pacientes/ficha", { paciente, historico, pacotes, idade });
}
```

Adicionar, logo depois de `telaFichaPaciente`:

```javascript
export async function telaEditarPaciente(
  req,
  res,
  { buscarPaciente = buscarPacientePorId } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  if (!pacienteId) return res.status(404).send("Paciente não encontrado.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  res.render("pacientes/editar", { paciente });
}

function campoOuNull(valor) {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

export async function processarEditarPaciente(
  req,
  res,
  { buscarPaciente = buscarPacientePorId, atualizarPaciente = atualizarDadosPaciente } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  if (!pacienteId) return res.status(404).send("Paciente não encontrado.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  const body = req.body ?? {};
  const dataNascimento = campoOuNull(body.data_nascimento);
  if (dataNascimento && !validarData(dataNascimento)) {
    return res.status(400).send("Data de nascimento inválida.");
  }

  await atualizarPaciente(pacienteId, {
    cpf: campoOuNull(body.cpf),
    dataNascimento,
    rg: campoOuNull(body.rg),
    endereco: campoOuNull(body.endereco),
    numero: campoOuNull(body.numero),
    bairro: campoOuNull(body.bairro),
    cidade: campoOuNull(body.cidade),
    uf: campoOuNull(body.uf),
    cep: campoOuNull(body.cep),
    estadoCivil: campoOuNull(body.estado_civil),
    sexo: campoOuNull(body.sexo),
    profissao: campoOuNull(body.profissao),
    email: campoOuNull(body.email),
    matriculaConvenio: campoOuNull(body.matricula_convenio),
  });

  res.redirect(`/pacientes/${pacienteId}/ficha`);
}
```

- [ ] **Step 4: Rodar os testes**

Run: `node --test test/dashboardControllerEditarPaciente.test.js`
Expected: PASS em todos.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS — verificar em especial que `test/fichaPacienteView.test.js` ainda passa mesmo sem `idade` nos dados (a view só é atualizada no Task 6; até lá, o controller passa `idade` mas a view atual ainda ignora esse local, o que é inofensivo em EJS).

- [ ] **Step 6: Commit**

```bash
git add src/controllers/dashboardController.js test/dashboardControllerEditarPaciente.test.js
git commit -m "feat: controller de editar paciente e cálculo de idade na ficha"
```

---

### Task 5: Rotas novas

**Files:**
- Modify: `src/routes/dashboardRoutes.js`

**Interfaces:**
- Consumes: `telaEditarPaciente`, `processarEditarPaciente` (Task 4) de `../controllers/dashboardController.js`.

- [ ] **Step 1: Atualizar o import de `dashboardController.js`**

Adicionar ao bloco de import existente (perto de `telaFichaPaciente`, `telaPacientes`):

```javascript
  telaEditarPaciente,
  processarEditarPaciente,
```

- [ ] **Step 2: Adicionar as rotas**

Logo depois de `router.get("/pacientes/:id/ficha", ...)`:

```javascript
router.get("/pacientes/:id/editar", asyncHandler(exigirLogin), asyncHandler(telaEditarPaciente));
router.post(
  "/pacientes/:id/editar",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarEditarPaciente)
);
```

- [ ] **Step 3: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/routes/dashboardRoutes.js
git commit -m "feat: rotas de editar dados cadastrais do paciente"
```

---

### Task 6: Views — grade de dados cadastrais e formulário de edição

**Files:**
- Modify: `src/views/pacientes/ficha.ejs`
- Create: `src/views/pacientes/editar.ejs`
- Modify: `public/dashboard.css`
- Modify: `test/fichaPacienteView.test.js`

Sem teste automatizado novo pro CSS (visual, verificado manualmente no Task 7). A view `ficha.ejs` é coberta pelos testes existentes de `fichaPacienteView.test.js`, estendidos aqui.

- [ ] **Step 1: Escrever/estender os testes de `fichaPacienteView.test.js`**

No topo do arquivo, a função `renderizar` já espalha `...dados` sobre os padrões — adicionar `idade: null` aos padrões e `formatarData` ao objeto passado pro `ejs.renderFile`:

```javascript
import { formatarDataHora, formatarData } from "../src/utils/data.js";
```

```javascript
function renderizar(dados) {
  const caminho = path.join(VIEWS_DIR, "pacientes", "ficha.ejs");
  return ejs.renderFile(caminho, {
    paciente: PACIENTE,
    historico: [],
    pacotes: [],
    idade: null,
    csrfToken: "token-fake",
    usuarioAtual: ADMINISTRADORA,
    formatarDataHora,
    formatarData,
    ...dados,
  });
}
```

Adicionar ao final do arquivo:

```javascript
test("ficha: mostra os dados cadastrais preenchidos", async () => {
  const paciente = {
    ...PACIENTE,
    cpf: "111.111.111-11",
    rg: "22.222.222-2",
    data_nascimento: "1990-05-20",
    sexo: "F",
    endereco: "Rua Teste",
    numero: "123",
    bairro: "Centro",
    cidade: "São Paulo",
    uf: "SP",
    cep: "01000-000",
    estado_civil: "Solteira",
    profissao: "Professora",
    email: "ana@example.com",
    matricula_convenio: "999888777",
  };
  const html = await renderizar({ paciente, idade: 36 });

  assert.match(html, /111\.111\.111-11/);
  assert.match(html, /22\.222\.222-2/);
  assert.match(html, /20\/05\/1990/);
  assert.match(html, /36 anos/);
  assert.match(html, /Rua Teste/);
  assert.match(html, /Solteira/);
  assert.match(html, /Professora/);
  assert.match(html, /ana@example\.com/);
  assert.match(html, /999888777/);
  assert.match(html, /Ana Exemplo/);
});

test("ficha: campos cadastrais em branco não mostram 'Não informado'", async () => {
  const html = await renderizar({ paciente: PACIENTE, idade: null });

  assert.doesNotMatch(html, /Não informado/);
});

test("ficha: link para editar dados cadastrais está presente", async () => {
  const html = await renderizar({});
  assert.match(html, /href="\/pacientes\/7\/editar"/);
});
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `node --test test/fichaPacienteView.test.js`
Expected: FAIL — a view ainda não tem a grade de dados cadastrais nem o link de editar.

- [ ] **Step 3: Editar `ficha.ejs`**

Substituir o bloco de `.acoes-impressao` e `.patient-hero` (do início do arquivo até o fechamento de `</section>` do `patient-hero`, linhas 1-14) por:

```html
<%- include("../partials/header", { titulo: "Ficha do paciente" }) %>
<section class="ficha-paciente">
  <div class="acoes-impressao">
    <a class="button button--quiet" href="/pacientes">Voltar para pacientes</a>
    <a class="button button--quiet" href="/pacientes/<%= paciente.id %>/editar">Editar dados</a>
    <a class="button button--quiet" href="/pacientes/<%= paciente.id %>/controle-sessoes">Controle de sessões</a>
    <button class="button button--quiet" type="button" onclick="window.print()">Imprimir ficha</button>
  </div>
  <section class="dados-paciente" aria-labelledby="patient-name">
    <h1 id="patient-name"><%= paciente.nome %></h1>
    <dl class="ficha-cadastral">
      <div><dt>Número</dt><dd><%= paciente.id %></dd></div>
      <div><dt>Médico</dt><dd>Ana Exemplo</dd></div>
      <div class="campo-largo"><dt>Paciente</dt><dd><%= paciente.nome %></dd></div>
      <div>
        <dt>Nascimento</dt>
        <dd><%= formatarData(paciente.data_nascimento) %><%= idade !== null ? ` — ${idade} anos` : "" %></dd>
      </div>
      <div><dt>Sexo</dt><dd><%= paciente.sexo ?? "" %></dd></div>
      <div><dt>Entrada</dt><dd><%= formatarData(paciente.created_at) %></dd></div>
      <div class="campo-largo">
        <dt>Endereço</dt>
        <dd><%= [paciente.endereco, paciente.numero].filter(Boolean).join(", ") %><%= paciente.bairro ? ` - ${paciente.bairro}` : "" %></dd>
      </div>
      <div><dt>Estado civil</dt><dd><%= paciente.estado_civil ?? "" %></dd></div>
      <div><dt>Cidade</dt><dd><%= paciente.cidade ?? "" %></dd></div>
      <div><dt>UF</dt><dd><%= paciente.uf ?? "" %></dd></div>
      <div><dt>CEP</dt><dd><%= paciente.cep ?? "" %></dd></div>
      <div><dt>Telefone</dt><dd><%= paciente.telefone %></dd></div>
      <div><dt>CPF</dt><dd><%= paciente.cpf ?? "" %></dd></div>
      <div><dt>RG</dt><dd><%= paciente.rg ?? "" %></dd></div>
      <div><dt>Profissão</dt><dd><%= paciente.profissao ?? "" %></dd></div>
      <div class="campo-largo"><dt>E-Mail</dt><dd><%= paciente.email ?? "" %></dd></div>
      <div><dt>Categoria</dt><dd><%= paciente.convenio ?? "" %></dd></div>
      <div><dt>Matrícula</dt><dd><%= paciente.matricula_convenio ?? "" %></dd></div>
    </dl>
  </section>
```

O resto do arquivo (`.patient-history`, `.session-package`) fica exatamente como está.

- [ ] **Step 4: Adicionar CSS**

Em `public/dashboard.css`, adicionar (fora do bloco `@media print`, junto de outros estilos de página — perto de onde `.patient-hero`/`.patient-facts` já estavam definidos, se existirem, ou ao final do arquivo):

```css
.ficha-cadastral {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.5rem 1rem;
  margin: 1rem 0;
}
.ficha-cadastral > div {
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  padding: 0.35rem 0.5rem;
}
.ficha-cadastral .campo-largo {
  grid-column: span 4;
}
.ficha-cadastral dt {
  font-size: 0.75rem;
  color: #64748b;
  margin-bottom: 0.15rem;
}
.ficha-cadastral dd {
  margin: 0;
  font-weight: 600;
}
```

No bloco `@media print` já existente (linha 632-635), adicionar `.session-package` ao seletor que já esconde `.historico-agendamentos`/`.patient-history`:

Trocar:
```css
  .ficha-paciente .historico-agendamentos, .ficha-paciente .patient-history { display: none; }
```
por:
```css
  .ficha-paciente .historico-agendamentos, .ficha-paciente .patient-history, .ficha-paciente .session-package { display: none; }
```

- [ ] **Step 5: Criar `editar.ejs`**

```html
<!-- src/views/pacientes/editar.ejs -->
<%- include("../partials/header", { titulo: "Editar dados do paciente" }) %>
<header class="page-header">
  <div>
    <h1>Editar dados — <%= paciente.nome %></h1>
    <p>Dados cadastrais completos, usados na ficha de impressão.</p>
  </div>
  <a class="button button--quiet" href="/pacientes/<%= paciente.id %>/ficha">Voltar</a>
</header>

<form class="panel form-grid" method="post" action="/pacientes/<%= paciente.id %>/editar">
  <input type="hidden" name="_csrf" value="<%= csrfToken %>" />

  <label>
    CPF
    <input type="text" name="cpf" value="<%= paciente.cpf ?? '' %>" />
  </label>
  <label>
    RG
    <input type="text" name="rg" value="<%= paciente.rg ?? '' %>" />
  </label>
  <label>
    Data de nascimento
    <input type="date" name="data_nascimento" value="<%= paciente.data_nascimento ?? '' %>" />
  </label>
  <label>
    Sexo
    <select name="sexo">
      <option value="" <%= !paciente.sexo ? "selected" : "" %>>Não informado</option>
      <option value="F" <%= paciente.sexo === "F" ? "selected" : "" %>>Feminino</option>
      <option value="M" <%= paciente.sexo === "M" ? "selected" : "" %>>Masculino</option>
    </select>
  </label>
  <label>
    Estado civil
    <input type="text" name="estado_civil" value="<%= paciente.estado_civil ?? '' %>" />
  </label>
  <label>
    Profissão
    <input type="text" name="profissao" value="<%= paciente.profissao ?? '' %>" />
  </label>
  <label>
    E-mail
    <input type="email" name="email" value="<%= paciente.email ?? '' %>" />
  </label>

  <label>
    Endereço
    <input type="text" name="endereco" value="<%= paciente.endereco ?? '' %>" />
  </label>
  <label>
    Número
    <input type="text" name="numero" value="<%= paciente.numero ?? '' %>" />
  </label>
  <label>
    Bairro
    <input type="text" name="bairro" value="<%= paciente.bairro ?? '' %>" />
  </label>
  <label>
    Cidade
    <input type="text" name="cidade" value="<%= paciente.cidade ?? '' %>" />
  </label>
  <label>
    UF
    <input type="text" name="uf" maxlength="2" value="<%= paciente.uf ?? '' %>" />
  </label>
  <label>
    CEP
    <input type="text" name="cep" value="<%= paciente.cep ?? '' %>" />
  </label>

  <label>
    Matrícula do convênio
    <input type="text" name="matricula_convenio" value="<%= paciente.matricula_convenio ?? '' %>" />
  </label>

  <div class="toolbar">
    <button type="submit">Salvar</button>
  </div>
</form>
<%- include("../partials/footer") %>
```

- [ ] **Step 6: Rodar os testes**

Run: `node --test test/fichaPacienteView.test.js`
Expected: PASS em todos.

- [ ] **Step 7: Verificar sintaxe EJS de `editar.ejs`**

Run: `node -e "require('ejs').compile(require('fs').readFileSync('src/views/pacientes/editar.ejs','utf8'))"`
Expected: sem erro.

- [ ] **Step 8: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/views/pacientes/ficha.ejs src/views/pacientes/editar.ejs public/dashboard.css test/fichaPacienteView.test.js
git commit -m "feat: ficha do paciente ganha grade de dados cadastrais e tela de edição"
```

---

### Task 7: Verificação manual (dev, não produção)

**Files:** nenhum (só verificação).

- [ ] **Step 1: Rodar a migration 023 no banco de dev**

Mesmo processo usado pras migrations anteriores nesta sessão: aplicar o SQL de `023_dados_cadastrais_paciente.sql` contra o banco de dev (confirmar antes que é dev, não produção).

- [ ] **Step 2: Subir o servidor local**

Run: `node server.js` (com `LEMBRETE_CONSULTA_ATIVADO=false` no `.env` local).

- [ ] **Step 3: Exercitar o fluxo pelo navegador, com um paciente de TESTE (nunca dado real)**

- Criar (ou reaproveitar) um paciente de teste no banco de dev.
- Abrir a ficha dele — confirmar que a grade de dados cadastrais aparece, com "Médico: Ana Exemplo" e os demais campos em branco.
- Clicar em "Editar dados", preencher os campos, salvar — confirmar que volta pra ficha com os dados novos aparecendo.
- Confirmar que data de nascimento inválida (ex: campo de data vazio funciona, mas testar limites do input `type="date"` do navegador) não quebra nada.
- Clicar em "Imprimir ficha" (ou usar o preview de impressão do navegador, `Ctrl+P`/`Cmd+P`, sem confirmar a impressão de verdade) — confirmar visualmente que só a grade de dados cadastrais aparece, sem histórico de agendamentos nem pacote de sessões.

- [ ] **Step 4: Rodar a suíte inteira uma última vez**

Run: `npm test`
Expected: PASS — todos os testes (537 originais + os novos desta feature).

- [ ] **Step 5: Derrubar o servidor local**

Encerrar o processo `node server.js` iniciado no Step 2.

---

## Self-Review

**Cobertura da spec:** migration com campos nullable — Task 1. `formatarData` sem conversão de fuso — Task 2. `atualizarDadosPaciente` estendido, preservando comportamento existente — Task 3. Tela de edição, mesma permissão do resto do dashboard — Tasks 4-5. Grade de campos na ficha, "Médico" fixo, campo vazio sem "Não informado" — Task 6. Impressão mostrando só a grade (histórico/pacote escondidos) — Task 6 (CSS). Fora de escopo (importação em massa, campos Pai/Mãe, validação de formato) — nenhuma tarefa toca isso.

**Consistência de tipos/nomes:** `atualizarDadosPaciente` (Task 3) é chamada com os mesmos nomes de parâmetro (`dataNascimento`, `estadoCivil`, `matriculaConvenio`, camelCase) que `processarEditarPaciente` (Task 4) usa ao montar o objeto — verificado contra a assinatura exata definida no Task 3. `formatarData`/`idade` (Task 2, Task 4) são consumidos em `ficha.ejs` (Task 6) com os mesmos nomes de local passados por `telaFichaPaciente`.

**Nota de implementação:** o CSS de impressão hoje só esconde `.historico-agendamentos`/`.patient-history` — não `.session-package` (pacote de sessões), apesar da spec descrever que ambos já ficam escondidos. O Task 6 corrige isso como parte da mudança (adiciona `.session-package` ao mesmo seletor), pra que o comportamento final bata com o que a spec descreve.
