# Ficha de Avaliação Fisioterapêutica Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Digitalizar a ficha de avaliação fisioterapêutica em papel — um registro por avaliação, ligado ao paciente, com todas as perguntas da ficha como texto livre, histórico visível na ficha do paciente, e PDF gerado sob demanda.

**Architecture:** Nova tabela `avaliacoes_fisioterapeuticas` (uma linha por avaliação, todos os campos de conteúdo em texto livre nullable). Model/controller/PDF service dedicados, seguindo o padrão modular já usado em `convenioController.js`/`tissController.js` (dependências injetáveis por parâmetro default, testável com objeto de resposta falso). A ficha do paciente (`pacientes/ficha.ejs`) ganha uma seção nova listando as avaliações do paciente.

**Tech Stack:** Node.js, Express, PostgreSQL (`pg`), EJS, `pdfkit`, `node --test`.

**Spec:** [docs/superpowers/specs/2026-09-04-avaliacao-fisioterapeutica-design.md](../specs/2026-09-04-avaliacao-fisioterapeutica-design.md)

## Global Constraints

- Todas as 16 perguntas de anamnese + 2 campos de plano terapêutico são texto livre simples (`TEXT`, nullable) — sem checkbox, sem lógica condicional, sem validação de formato além do que o navegador já faz nativamente.
- Só `paciente_id` e `data_avaliacao` são obrigatórios no registro.
- Uma avaliação é independente de agendamento — sem vínculo com `agendamentos`/`agendamentos_importados`.
- Um paciente pode ter várias avaliações ao longo do tempo — sem substituir/apagar a anterior ao criar uma nova.
- Campo ausente no PDF é omitido (linha não aparece) — nunca "Não informado" nem string vazia impressa. Na tela, campo ausente aparece vazio, não "Não informado".
- Sem tela/rota de exclusão de avaliação nesta primeira versão.
- Permissão: qualquer usuário logado, sem exigir papel de administradora (mesmo nível do resto do dashboard de pacientes).
- Todo código novo segue o padrão de dependências injetáveis por parâmetro default (`{ buscar = buscarPadrao } = {}`), testável com um objeto de resposta falso, sem mock de `pool` nos controllers/views.

---

## Task 1: Migration — tabela `avaliacoes_fisioterapeuticas`

**Files:**
- Create: `src/db/migrations/033_avaliacoes_fisioterapeuticas.sql`
- Test: `test/migrations.test.js` (adicionar ao arquivo existente)

**Interfaces:**
- Produces: tabela `avaliacoes_fisioterapeuticas(id, paciente_id, data_avaliacao, esta_gravida, possui_marcapasso, possui_protese_metalica_implantes, possui_doencas_cardiacas, possui_hipertensao_arterial, possui_diabetes, possui_epilepsia, possui_historico_cancer, medicamentos_continuos_quais, cirurgia_qual, cirurgia_quando, tempo_ultima_cirurgia, dor_atual_local, dor_atual_intensidade, limitacoes_funcionais_quais, fisioterapia_anteriormente, objetivos_tratamento, condutas_propostas, registrado_por, registrado_em)`.

- [ ] **Step 1: Escrever a migration**

```sql
-- src/db/migrations/033_avaliacoes_fisioterapeuticas.sql
-- Clínica Exemplo Bot — migration 033: ficha de avaliação fisioterapêutica
--
-- Digitaliza a ficha em papel usada na consulta de avaliação (ver
-- docs/superpowers/specs/2026-09-04-avaliacao-fisioterapeutica-design.md).
-- Um paciente pode ter várias avaliações ao longo do tempo — cada linha é
-- uma avaliação independente, sem vínculo com agendamento. Todos os
-- campos de conteúdo são texto livre nullable (decisão do usuário: sem
-- checkbox, sem lógica condicional — a recepção digita a resposta como
-- está escrita no papel).

CREATE TABLE IF NOT EXISTS avaliacoes_fisioterapeuticas (
  id SERIAL PRIMARY KEY,
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id),
  data_avaliacao DATE NOT NULL,

  esta_gravida TEXT,
  possui_marcapasso TEXT,
  possui_protese_metalica_implantes TEXT,
  possui_doencas_cardiacas TEXT,
  possui_hipertensao_arterial TEXT,
  possui_diabetes TEXT,
  possui_epilepsia TEXT,
  possui_historico_cancer TEXT,
  medicamentos_continuos_quais TEXT,
  cirurgia_qual TEXT,
  cirurgia_quando TEXT,
  tempo_ultima_cirurgia TEXT,
  dor_atual_local TEXT,
  dor_atual_intensidade TEXT,
  limitacoes_funcionais_quais TEXT,
  fisioterapia_anteriormente TEXT,

  objetivos_tratamento TEXT,
  condutas_propostas TEXT,

  registrado_por INTEGER NOT NULL REFERENCES usuarios(id),
  registrado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_avaliacoes_fisioterapeuticas_paciente
  ON avaliacoes_fisioterapeuticas (paciente_id, data_avaliacao DESC);
```

- [ ] **Step 2: Escrever o teste da migration**

Adicionar em `test/migrations.test.js`, seguindo o padrão dos testes de
`MIGRATION_030`/`031`/`032` já existentes (constante de caminho +
`readFile` + `assert.match`/`assert.doesNotMatch`):

```js
const MIGRATION_033 = path.join(ROOT, "src/db/migrations/033_avaliacoes_fisioterapeuticas.sql");

test("migration 033: cria avaliacoes_fisioterapeuticas com paciente_id/data_avaliacao obrigatórios e resto nullable", async () => {
  const sql = await readFile(MIGRATION_033, "utf8");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS avaliacoes_fisioterapeuticas/);
  assert.match(sql, /paciente_id INTEGER NOT NULL REFERENCES pacientes\(id\)/);
  assert.match(sql, /data_avaliacao DATE NOT NULL/);
  assert.match(sql, /registrado_por INTEGER NOT NULL REFERENCES usuarios\(id\)/);

  for (const coluna of [
    "esta_gravida", "possui_marcapasso", "possui_protese_metalica_implantes",
    "possui_doencas_cardiacas", "possui_hipertensao_arterial", "possui_diabetes",
    "possui_epilepsia", "possui_historico_cancer", "medicamentos_continuos_quais",
    "cirurgia_qual", "cirurgia_quando", "tempo_ultima_cirurgia", "dor_atual_local",
    "dor_atual_intensidade", "limitacoes_funcionais_quais", "fisioterapia_anteriormente",
    "objetivos_tratamento", "condutas_propostas",
  ]) {
    assert.match(sql, new RegExp(`${coluna} TEXT`));
    assert.doesNotMatch(sql, new RegExp(`${coluna} TEXT NOT NULL`));
  }

  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_avaliacoes_fisioterapeuticas_paciente/);
});
```

- [ ] **Step 3: Rodar o teste**

Run: `node --test test/migrations.test.js`
Expected: PASS (todos os testes do arquivo, incluindo o novo)

- [ ] **Step 4: Commit**

```bash
git add src/db/migrations/033_avaliacoes_fisioterapeuticas.sql test/migrations.test.js
git commit -m "feat: migration da tabela de avaliação fisioterapêutica"
```

---

## Task 2: Model de avaliação fisioterapêutica

**Files:**
- Create: `src/models/avaliacaoFisioterapeuticaModel.js`
- Test: `test/avaliacaoFisioterapeuticaModel.test.js`

**Interfaces:**
- Consumes: `pool` de `../db/pool.js`.
- Produces:
  - `listarAvaliacoesPaciente(pacienteId): Promise<Array<{id, dataAvaliacao}>>` — ordenado por data decrescente.
  - `buscarAvaliacaoDoPaciente(avaliacaoId, pacienteId): Promise<AvaliacaoCompleta | null>`, onde `AvaliacaoCompleta` tem `id, pacienteId, dataAvaliacao, estaGravida, possuiMarcapasso, possuiProteseMetalicaImplantes, possuiDoencasCardiacas, possuiHipertensaoArterial, possuiDiabetes, possuiEpilepsia, possuiHistoricoCancer, medicamentosContinuosQuais, cirurgiaQual, cirurgiaQuando, tempoUltimaCirurgia, dorAtualLocal, dorAtualIntensidade, limitacoesFuncionaisQuais, fisioterapiaAnteriormente, objetivosTratamento, condutasPropostas` (todos os campos camelCase). Retorna `null` se o id não existir OU pertencer a outro paciente.
  - `criarAvaliacao(dados): Promise<number>` — `dados` tem os mesmos campos de `AvaliacaoCompleta` (exceto `id`) mais `registradoPor`; retorna o `id` criado.
  - `atualizarAvaliacao(avaliacaoId, dados): Promise<void>` — `dados` tem `dataAvaliacao` + os 16 campos de anamnese + os 2 de plano terapêutico (sem `pacienteId`/`registradoPor`, que não mudam na edição).
- Usados por: `avaliacaoFisioterapeuticaController.js` (Task 4) e `telaFichaPaciente` em `dashboardController.js` (Task 6).

- [ ] **Step 1: Escrever o teste**

```js
// test/avaliacaoFisioterapeuticaModel.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import {
  listarAvaliacoesPaciente,
  buscarAvaliacaoDoPaciente,
  criarAvaliacao,
  atualizarAvaliacao,
} from "../src/models/avaliacaoFisioterapeuticaModel.js";

test("listarAvaliacoesPaciente: retorna id e data mapeados pra camelCase", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 3, data_avaliacao: "2026-09-01" }, { id: 1, data_avaliacao: "2026-01-10" }],
  }));

  const resultado = await listarAvaliacoesPaciente(7);

  assert.deepEqual(resultado, [
    { id: 3, dataAvaliacao: "2026-09-01" },
    { id: 1, dataAvaliacao: "2026-01-10" },
  ]);
});

test("buscarAvaliacaoDoPaciente: retorna null quando não encontrado", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await buscarAvaliacaoDoPaciente(99, 7);
  assert.equal(resultado, null);
});

test("buscarAvaliacaoDoPaciente: filtra por paciente_id na query (evita vazar avaliação de outro paciente)", async (t) => {
  let parametrosRecebidos = null;
  t.mock.method(pool, "query", async (_sql, parametros) => {
    parametrosRecebidos = parametros;
    return { rows: [] };
  });

  await buscarAvaliacaoDoPaciente(5, 7);

  assert.deepEqual(parametrosRecebidos, [5, 7]);
});

test("buscarAvaliacaoDoPaciente: mapeia todos os campos pra camelCase", async (t) => {
  const linha = {
    id: 5, paciente_id: 7, data_avaliacao: "2026-09-01",
    esta_gravida: "Não", possui_marcapasso: "Não",
    possui_protese_metalica_implantes: null, possui_doencas_cardiacas: null,
    possui_hipertensao_arterial: null, possui_diabetes: "Sim", possui_epilepsia: null,
    possui_historico_cancer: null, medicamentos_continuos_quais: "Losartana",
    cirurgia_qual: null, cirurgia_quando: null, tempo_ultima_cirurgia: null,
    dor_atual_local: "Lombar", dor_atual_intensidade: "7",
    limitacoes_funcionais_quais: null, fisioterapia_anteriormente: "Não",
    objetivos_tratamento: "Reduzir dor lombar", condutas_propostas: "Fortalecimento",
  };
  t.mock.method(pool, "query", async () => ({ rows: [linha] }));

  const resultado = await buscarAvaliacaoDoPaciente(5, 7);

  assert.equal(resultado.id, 5);
  assert.equal(resultado.pacienteId, 7);
  assert.equal(resultado.dataAvaliacao, "2026-09-01");
  assert.equal(resultado.possuiDiabetes, "Sim");
  assert.equal(resultado.medicamentosContinuosQuais, "Losartana");
  assert.equal(resultado.dorAtualLocal, "Lombar");
  assert.equal(resultado.dorAtualIntensidade, "7");
  assert.equal(resultado.objetivosTratamento, "Reduzir dor lombar");
  assert.equal(resultado.condutasPropostas, "Fortalecimento");
  assert.equal(resultado.possuiProteseMetalicaImplantes, null);
});

test("criarAvaliacao: grava os 21 campos na ordem certa e retorna o id", async (t) => {
  let parametrosRecebidos = null;
  t.mock.method(pool, "query", async (_sql, parametros) => {
    parametrosRecebidos = parametros;
    return { rows: [{ id: 42 }] };
  });

  const id = await criarAvaliacao({
    pacienteId: 7, dataAvaliacao: "2026-09-04",
    estaGravida: "Não", possuiMarcapasso: null, possuiProteseMetalicaImplantes: null,
    possuiDoencasCardiacas: null, possuiHipertensaoArterial: null, possuiDiabetes: "Sim",
    possuiEpilepsia: null, possuiHistoricoCancer: null, medicamentosContinuosQuais: "Losartana",
    cirurgiaQual: null, cirurgiaQuando: null, tempoUltimaCirurgia: null,
    dorAtualLocal: "Lombar", dorAtualIntensidade: "7", limitacoesFuncionaisQuais: null,
    fisioterapiaAnteriormente: "Não", objetivosTratamento: "Reduzir dor lombar",
    condutasPropostas: "Fortalecimento", registradoPor: 2,
  });

  assert.equal(id, 42);
  assert.deepEqual(parametrosRecebidos, [
    7, "2026-09-04", "Não", null, null, null, null, "Sim", null, null, "Losartana",
    null, null, null, "Lombar", "7", null, "Não", "Reduzir dor lombar", "Fortalecimento", 2,
  ]);
});

test("atualizarAvaliacao: grava os 19 campos de conteúdo na ordem certa", async (t) => {
  let parametrosRecebidos = null;
  t.mock.method(pool, "query", async (_sql, parametros) => {
    parametrosRecebidos = parametros;
    return { rows: [] };
  });

  await atualizarAvaliacao(5, {
    dataAvaliacao: "2026-09-05",
    estaGravida: "Não", possuiMarcapasso: null, possuiProteseMetalicaImplantes: null,
    possuiDoencasCardiacas: null, possuiHipertensaoArterial: null, possuiDiabetes: "Sim",
    possuiEpilepsia: null, possuiHistoricoCancer: null, medicamentosContinuosQuais: "Losartana",
    cirurgiaQual: null, cirurgiaQuando: null, tempoUltimaCirurgia: null,
    dorAtualLocal: "Lombar", dorAtualIntensidade: "5", limitacoesFuncionaisQuais: null,
    fisioterapiaAnteriormente: "Não", objetivosTratamento: "Reduzir dor lombar",
    condutasPropostas: "Fortalecimento e alongamento",
  });

  assert.deepEqual(parametrosRecebidos, [
    5, "2026-09-05", "Não", null, null, null, null, "Sim", null, null, "Losartana",
    null, null, null, "Lombar", "5", null, "Não", "Reduzir dor lombar", "Fortalecimento e alongamento",
  ]);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/avaliacaoFisioterapeuticaModel.test.js`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implementar o model**

```js
// src/models/avaliacaoFisioterapeuticaModel.js
import { pool } from "../db/pool.js";

export async function listarAvaliacoesPaciente(pacienteId) {
  const { rows } = await pool.query(
    `SELECT id, data_avaliacao FROM avaliacoes_fisioterapeuticas
     WHERE paciente_id = $1
     ORDER BY data_avaliacao DESC, id DESC`,
    [pacienteId]
  );
  return rows.map((r) => ({ id: r.id, dataAvaliacao: r.data_avaliacao }));
}

/**
 * Escopado por paciente_id — nunca retorna uma avaliação de outro
 * paciente, mesmo que o id exista (evita adivinhar id e acessar/editar
 * avaliação de paciente errado via URL).
 */
export async function buscarAvaliacaoDoPaciente(avaliacaoId, pacienteId) {
  const { rows } = await pool.query(
    `SELECT id, paciente_id, data_avaliacao, esta_gravida, possui_marcapasso,
            possui_protese_metalica_implantes, possui_doencas_cardiacas,
            possui_hipertensao_arterial, possui_diabetes, possui_epilepsia,
            possui_historico_cancer, medicamentos_continuos_quais, cirurgia_qual,
            cirurgia_quando, tempo_ultima_cirurgia, dor_atual_local,
            dor_atual_intensidade, limitacoes_funcionais_quais,
            fisioterapia_anteriormente, objetivos_tratamento, condutas_propostas
     FROM avaliacoes_fisioterapeuticas
     WHERE id = $1 AND paciente_id = $2`,
    [avaliacaoId, pacienteId]
  );
  const registro = rows[0];
  if (!registro) return null;

  return {
    id: registro.id,
    pacienteId: registro.paciente_id,
    dataAvaliacao: registro.data_avaliacao,
    estaGravida: registro.esta_gravida,
    possuiMarcapasso: registro.possui_marcapasso,
    possuiProteseMetalicaImplantes: registro.possui_protese_metalica_implantes,
    possuiDoencasCardiacas: registro.possui_doencas_cardiacas,
    possuiHipertensaoArterial: registro.possui_hipertensao_arterial,
    possuiDiabetes: registro.possui_diabetes,
    possuiEpilepsia: registro.possui_epilepsia,
    possuiHistoricoCancer: registro.possui_historico_cancer,
    medicamentosContinuosQuais: registro.medicamentos_continuos_quais,
    cirurgiaQual: registro.cirurgia_qual,
    cirurgiaQuando: registro.cirurgia_quando,
    tempoUltimaCirurgia: registro.tempo_ultima_cirurgia,
    dorAtualLocal: registro.dor_atual_local,
    dorAtualIntensidade: registro.dor_atual_intensidade,
    limitacoesFuncionaisQuais: registro.limitacoes_funcionais_quais,
    fisioterapiaAnteriormente: registro.fisioterapia_anteriormente,
    objetivosTratamento: registro.objetivos_tratamento,
    condutasPropostas: registro.condutas_propostas,
  };
}

export async function criarAvaliacao({
  pacienteId, dataAvaliacao, estaGravida, possuiMarcapasso,
  possuiProteseMetalicaImplantes, possuiDoencasCardiacas, possuiHipertensaoArterial,
  possuiDiabetes, possuiEpilepsia, possuiHistoricoCancer, medicamentosContinuosQuais,
  cirurgiaQual, cirurgiaQuando, tempoUltimaCirurgia, dorAtualLocal, dorAtualIntensidade,
  limitacoesFuncionaisQuais, fisioterapiaAnteriormente, objetivosTratamento,
  condutasPropostas, registradoPor,
}) {
  const { rows } = await pool.query(
    `INSERT INTO avaliacoes_fisioterapeuticas (
       paciente_id, data_avaliacao, esta_gravida, possui_marcapasso,
       possui_protese_metalica_implantes, possui_doencas_cardiacas,
       possui_hipertensao_arterial, possui_diabetes, possui_epilepsia,
       possui_historico_cancer, medicamentos_continuos_quais, cirurgia_qual,
       cirurgia_quando, tempo_ultima_cirurgia, dor_atual_local,
       dor_atual_intensidade, limitacoes_funcionais_quais,
       fisioterapia_anteriormente, objetivos_tratamento, condutas_propostas,
       registrado_por
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     RETURNING id`,
    [
      pacienteId, dataAvaliacao, estaGravida, possuiMarcapasso,
      possuiProteseMetalicaImplantes, possuiDoencasCardiacas, possuiHipertensaoArterial,
      possuiDiabetes, possuiEpilepsia, possuiHistoricoCancer, medicamentosContinuosQuais,
      cirurgiaQual, cirurgiaQuando, tempoUltimaCirurgia, dorAtualLocal, dorAtualIntensidade,
      limitacoesFuncionaisQuais, fisioterapiaAnteriormente, objetivosTratamento,
      condutasPropostas, registradoPor,
    ]
  );
  return rows[0].id;
}

export async function atualizarAvaliacao(avaliacaoId, {
  dataAvaliacao, estaGravida, possuiMarcapasso, possuiProteseMetalicaImplantes,
  possuiDoencasCardiacas, possuiHipertensaoArterial, possuiDiabetes, possuiEpilepsia,
  possuiHistoricoCancer, medicamentosContinuosQuais, cirurgiaQual, cirurgiaQuando,
  tempoUltimaCirurgia, dorAtualLocal, dorAtualIntensidade, limitacoesFuncionaisQuais,
  fisioterapiaAnteriormente, objetivosTratamento, condutasPropostas,
}) {
  await pool.query(
    `UPDATE avaliacoes_fisioterapeuticas SET
       data_avaliacao = $2, esta_gravida = $3, possui_marcapasso = $4,
       possui_protese_metalica_implantes = $5, possui_doencas_cardiacas = $6,
       possui_hipertensao_arterial = $7, possui_diabetes = $8, possui_epilepsia = $9,
       possui_historico_cancer = $10, medicamentos_continuos_quais = $11,
       cirurgia_qual = $12, cirurgia_quando = $13, tempo_ultima_cirurgia = $14,
       dor_atual_local = $15, dor_atual_intensidade = $16,
       limitacoes_funcionais_quais = $17, fisioterapia_anteriormente = $18,
       objetivos_tratamento = $19, condutas_propostas = $20
     WHERE id = $1`,
    [
      avaliacaoId, dataAvaliacao, estaGravida, possuiMarcapasso,
      possuiProteseMetalicaImplantes, possuiDoencasCardiacas, possuiHipertensaoArterial,
      possuiDiabetes, possuiEpilepsia, possuiHistoricoCancer, medicamentosContinuosQuais,
      cirurgiaQual, cirurgiaQuando, tempoUltimaCirurgia, dorAtualLocal, dorAtualIntensidade,
      limitacoesFuncionaisQuais, fisioterapiaAnteriormente, objetivosTratamento,
      condutasPropostas,
    ]
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/avaliacaoFisioterapeuticaModel.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/models/avaliacaoFisioterapeuticaModel.js test/avaliacaoFisioterapeuticaModel.test.js
git commit -m "feat: model de avaliação fisioterapêutica"
```

---

## Task 3: Serviço de PDF da avaliação

**Files:**
- Create: `src/services/avaliacaoFisioterapeuticaPdfService.js`
- Test: `test/avaliacaoFisioterapeuticaPdfService.test.js`

**Interfaces:**
- Produces: `linhasAnamnesePdf(dados): string[]` (função pura), `gerarPdfAvaliacao(dados): Promise<Buffer>`, onde `dados` tem `pacienteNome`, `dataAvaliacao`, e os 16 campos de anamnese + `objetivosTratamento`/`condutasPropostas` em camelCase (mesmo formato de `AvaliacaoCompleta` da Task 2, mais `pacienteNome`).
- Usado por: `avaliacaoFisioterapeuticaController.js` (Task 4).

- [ ] **Step 1: Escrever o teste**

```js
// test/avaliacaoFisioterapeuticaPdfService.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { linhasAnamnesePdf, gerarPdfAvaliacao } from "../src/services/avaliacaoFisioterapeuticaPdfService.js";

const AVALIACAO_COMPLETA = {
  pacienteNome: "Maria", dataAvaliacao: "2026-09-01",
  estaGravida: "Não", possuiMarcapasso: "Não", possuiProteseMetalicaImplantes: "Não",
  possuiDoencasCardiacas: "Não", possuiHipertensaoArterial: "Sim", possuiDiabetes: "Não",
  possuiEpilepsia: "Não", possuiHistoricoCancer: "Não", medicamentosContinuosQuais: "Losartana",
  cirurgiaQual: null, cirurgiaQuando: null, tempoUltimaCirurgia: null,
  dorAtualLocal: "Lombar", dorAtualIntensidade: "7", limitacoesFuncionaisQuais: null,
  fisioterapiaAnteriormente: "Não", objetivosTratamento: "Reduzir dor lombar",
  condutasPropostas: "Fortalecimento e alongamento",
};

test("linhasAnamnesePdf: inclui só as perguntas com resposta preenchida", () => {
  const linhas = linhasAnamnesePdf(AVALIACAO_COMPLETA);

  assert.ok(linhas.some((l) => l.includes("Possui hipertensão arterial?") && l.includes("Sim")));
  assert.ok(linhas.some((l) => l.includes("Sente dor atualmente? Local") && l.includes("Lombar")));
  assert.ok(!linhas.some((l) => l.toLowerCase().includes("cirurgia")));
});

test("linhasAnamnesePdf: sem nenhuma resposta preenchida, devolve lista vazia", () => {
  const linhas = linhasAnamnesePdf({});
  assert.deepEqual(linhas, []);
});

test("gerarPdfAvaliacao: gera um PDF de verdade em memória (smoke test, sem mock)", async () => {
  const buffer = await gerarPdfAvaliacao(AVALIACAO_COMPLETA);

  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 0);
  assert.equal(buffer.subarray(0, 4).toString("latin1"), "%PDF");
});

test("gerarPdfAvaliacao: funciona com todos os campos de conteúdo ausentes", async () => {
  const buffer = await gerarPdfAvaliacao({ pacienteNome: "João", dataAvaliacao: "2026-09-01" });

  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 0);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/avaliacaoFisioterapeuticaPdfService.test.js`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implementar o serviço**

```js
// src/services/avaliacaoFisioterapeuticaPdfService.js
import PDFDocument from "pdfkit";

const NOME_CLINICA = "Clínica Exemplo — Fisioterapia & Psicologia";

const PERGUNTAS_ANAMNESE = [
  { campo: "estaGravida", rotulo: "Está grávida?" },
  { campo: "possuiMarcapasso", rotulo: "Possui marcapasso?" },
  { campo: "possuiProteseMetalicaImplantes", rotulo: "Possui prótese metálica ou implantes?" },
  { campo: "possuiDoencasCardiacas", rotulo: "Possui doenças cardíacas?" },
  { campo: "possuiHipertensaoArterial", rotulo: "Possui hipertensão arterial?" },
  { campo: "possuiDiabetes", rotulo: "Possui diabetes?" },
  { campo: "possuiEpilepsia", rotulo: "Possui epilepsia?" },
  { campo: "possuiHistoricoCancer", rotulo: "Possui histórico de câncer?" },
  { campo: "medicamentosContinuosQuais", rotulo: "Faz uso de medicamentos contínuos? Quais?" },
  { campo: "cirurgiaQual", rotulo: "Já realizou cirurgia? Qual?" },
  { campo: "cirurgiaQuando", rotulo: "Quando?" },
  { campo: "tempoUltimaCirurgia", rotulo: "Quanto tempo da última cirurgia?" },
  { campo: "dorAtualLocal", rotulo: "Sente dor atualmente? Local" },
  { campo: "dorAtualIntensidade", rotulo: "Intensidade da dor (0-10)" },
  { campo: "limitacoesFuncionaisQuais", rotulo: "Apresenta limitações funcionais? Quais?" },
  { campo: "fisioterapiaAnteriormente", rotulo: "Já realizou fisioterapia anteriormente?" },
];

/**
 * Linhas da anamnese pro PDF — extraída como função pura, mesmo motivo de
 * linhasCabecalhoLaudo em laudoPdfService.js: pdfkit não permite
 * inspecionar o que já foi escrito antes de doc.end(), então isolar a
 * regra "campo vazio não aparece" deixa isso testável sem gerar PDF de
 * verdade a cada caso.
 */
export function linhasAnamnesePdf(dados) {
  return PERGUNTAS_ANAMNESE
    .filter(({ campo }) => dados[campo])
    .map(({ campo, rotulo }) => `${rotulo} ${dados[campo]}`);
}

/**
 * Gera o PDF da avaliação em memória — nunca salvo em disco/banco, mesmo
 * padrão dos Laudos e do Guia de convênio. Sem identidade visual.
 */
export function gerarPdfAvaliacao(dados) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).text(NOME_CLINICA, { align: "center" });
    doc.moveDown(2);

    doc.fontSize(12);
    doc.text(`Paciente: ${dados.pacienteNome}`);
    doc.text(`Data da avaliação: ${dados.dataAvaliacao}`);
    doc.moveDown();

    doc.fontSize(14).text("Anamnese", { underline: true });
    doc.fontSize(12);
    for (const linha of linhasAnamnesePdf(dados)) {
      doc.text(linha);
    }
    doc.moveDown();

    doc.fontSize(14).text("Plano terapêutico", { underline: true });
    doc.fontSize(12);
    if (dados.objetivosTratamento) {
      doc.text(`Objetivos do tratamento: ${dados.objetivosTratamento}`);
    }
    if (dados.condutasPropostas) {
      doc.text(`Condutas propostas: ${dados.condutasPropostas}`);
    }

    doc.end();
  });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/avaliacaoFisioterapeuticaPdfService.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/avaliacaoFisioterapeuticaPdfService.js test/avaliacaoFisioterapeuticaPdfService.test.js
git commit -m "feat: serviço de geração do PDF de avaliação fisioterapêutica"
```

---

## Task 4: Controller de avaliação fisioterapêutica

**Files:**
- Create: `src/controllers/avaliacaoFisioterapeuticaController.js`
- Test: `test/avaliacaoFisioterapeuticaController.test.js`

**Interfaces:**
- Consumes: `buscarPacientePorId` de `../models/pacienteModel.js`; `criarAvaliacao`, `buscarAvaliacaoDoPaciente`, `atualizarAvaliacao` de `../models/avaliacaoFisioterapeuticaModel.js` (Task 2); `gerarPdfAvaliacao` de `../services/avaliacaoFisioterapeuticaPdfService.js` (Task 3); `slugArquivo` de `../utils/slugArquivo.js`; `idSeguro` de `../utils/paginacao.js`; `validarData` de `../utils/validacao.js`.
- Produces: `telaNovaAvaliacao`, `processarNovaAvaliacao`, `telaEditarAvaliacao`, `processarEditarAvaliacao`, `gerarPdfAvaliacaoController` — todos `(req, res, deps = {})` — usados nas rotas da Task 5.

- [ ] **Step 1: Escrever o teste**

```js
// test/avaliacaoFisioterapeuticaController.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  telaNovaAvaliacao,
  processarNovaAvaliacao,
  telaEditarAvaliacao,
  processarEditarAvaliacao,
  gerarPdfAvaliacaoController,
} from "../src/controllers/avaliacaoFisioterapeuticaController.js";

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

const PACIENTE = { id: 7, nome: "Ana Silva" };
const AVALIACAO = {
  id: 5, pacienteId: 7, dataAvaliacao: "2026-09-01",
  estaGravida: "Não", possuiMarcapasso: null, possuiProteseMetalicaImplantes: null,
  possuiDoencasCardiacas: null, possuiHipertensaoArterial: null, possuiDiabetes: "Sim",
  possuiEpilepsia: null, possuiHistoricoCancer: null, medicamentosContinuosQuais: null,
  cirurgiaQual: null, cirurgiaQuando: null, tempoUltimaCirurgia: null,
  dorAtualLocal: "Lombar", dorAtualIntensidade: "7", limitacoesFuncionaisQuais: null,
  fisioterapiaAnteriormente: "Não", objetivosTratamento: "Reduzir dor", condutasPropostas: "Fortalecimento",
};

test("telaNovaAvaliacao: paciente inexistente responde 404", async () => {
  const res = criarRespostaFalsa();
  await telaNovaAvaliacao({ params: { id: "7" } }, res, { buscarPaciente: async () => null });
  assert.equal(res.statusCode, 404);
});

test("telaNovaAvaliacao: caminho feliz renderiza o formulário sem avaliacao", async () => {
  const res = criarRespostaFalsa();
  await telaNovaAvaliacao({ params: { id: "7" } }, res, { buscarPaciente: async () => PACIENTE });

  assert.equal(res.viewRenderizada, "avaliacoes/formulario");
  assert.equal(res.dadosDaView.paciente, PACIENTE);
  assert.equal(res.dadosDaView.avaliacao, null);
  assert.equal(res.dadosDaView.acaoForm, "/pacientes/7/avaliacoes/nova");
});

test("processarNovaAvaliacao: data inválida responde 400 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarNovaAvaliacao(
    { params: { id: "7" }, body: { data_avaliacao: "não-é-data" }, usuarioAtual: { id: 2 } },
    res,
    { buscarPaciente: async () => PACIENTE, criar: async () => { gravou = true; } }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(gravou, false);
});

test("processarNovaAvaliacao: caminho feliz grava com registradoPor do usuário logado e redireciona pra ficha", async () => {
  const res = criarRespostaFalsa();
  let dadosGravados = null;
  await processarNovaAvaliacao(
    {
      params: { id: "7" },
      body: {
        data_avaliacao: "2026-09-01", esta_gravida: "Não", possui_diabetes: "Sim",
        dor_atual_local: "Lombar", dor_atual_intensidade: "7",
        objetivos_tratamento: "Reduzir dor", condutas_propostas: "Fortalecimento",
      },
      usuarioAtual: { id: 2 },
    },
    res,
    { buscarPaciente: async () => PACIENTE, criar: async (dados) => { dadosGravados = dados; return 42; } }
  );

  assert.equal(dadosGravados.pacienteId, 7);
  assert.equal(dadosGravados.dataAvaliacao, "2026-09-01");
  assert.equal(dadosGravados.estaGravida, "Não");
  assert.equal(dadosGravados.possuiDiabetes, "Sim");
  assert.equal(dadosGravados.dorAtualLocal, "Lombar");
  assert.equal(dadosGravados.registradoPor, 2);
  assert.equal(res.redirectedTo, "/pacientes/7/ficha");
});

test("telaEditarAvaliacao: avaliação inexistente (ou de outro paciente) responde 404", async () => {
  const res = criarRespostaFalsa();
  await telaEditarAvaliacao(
    { params: { id: "7", avaliacaoId: "5" } },
    res,
    { buscarPaciente: async () => PACIENTE, buscarAvaliacao: async () => null }
  );

  assert.equal(res.statusCode, 404);
});

test("telaEditarAvaliacao: caminho feliz renderiza o formulário pré-preenchido", async () => {
  const res = criarRespostaFalsa();
  await telaEditarAvaliacao(
    { params: { id: "7", avaliacaoId: "5" } },
    res,
    { buscarPaciente: async () => PACIENTE, buscarAvaliacao: async () => AVALIACAO }
  );

  assert.equal(res.viewRenderizada, "avaliacoes/formulario");
  assert.equal(res.dadosDaView.avaliacao, AVALIACAO);
  assert.equal(res.dadosDaView.acaoForm, "/pacientes/7/avaliacoes/5/editar");
});

test("processarEditarAvaliacao: avaliação inexistente responde 404 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarEditarAvaliacao(
    { params: { id: "7", avaliacaoId: "5" }, body: { data_avaliacao: "2026-09-01" } },
    res,
    { buscarAvaliacao: async () => null, atualizar: async () => { gravou = true; } }
  );

  assert.equal(res.statusCode, 404);
  assert.equal(gravou, false);
});

test("processarEditarAvaliacao: caminho feliz grava e redireciona pra ficha", async () => {
  const res = criarRespostaFalsa();
  let idAtualizado = null;
  let dadosAtualizados = null;
  await processarEditarAvaliacao(
    {
      params: { id: "7", avaliacaoId: "5" },
      body: { data_avaliacao: "2026-09-05", possui_diabetes: "Sim", condutas_propostas: "Novo plano" },
    },
    res,
    {
      buscarAvaliacao: async () => AVALIACAO,
      atualizar: async (id, dados) => { idAtualizado = id; dadosAtualizados = dados; },
    }
  );

  assert.equal(idAtualizado, 5);
  assert.equal(dadosAtualizados.dataAvaliacao, "2026-09-05");
  assert.equal(dadosAtualizados.possuiDiabetes, "Sim");
  assert.equal(dadosAtualizados.condutasPropostas, "Novo plano");
  assert.equal(res.redirectedTo, "/pacientes/7/ficha");
});

test("gerarPdfAvaliacaoController: avaliação inexistente responde 404", async () => {
  const res = criarRespostaFalsa();
  await gerarPdfAvaliacaoController(
    { params: { id: "7", avaliacaoId: "5" } },
    res,
    { buscarPaciente: async () => PACIENTE, buscarAvaliacao: async () => null }
  );

  assert.equal(res.statusCode, 404);
});

test("gerarPdfAvaliacaoController: caminho feliz responde PDF com Content-Disposition correto", async () => {
  const res = criarRespostaFalsa();
  let dadosPassadosPraPdf = null;
  await gerarPdfAvaliacaoController(
    { params: { id: "7", avaliacaoId: "5" } },
    res,
    {
      buscarPaciente: async () => PACIENTE,
      buscarAvaliacao: async () => AVALIACAO,
      gerarPdf: (dados) => { dadosPassadosPraPdf = dados; return Promise.resolve(Buffer.from("PDF-FAKE")); },
    }
  );

  assert.equal(res.corpo.toString(), "PDF-FAKE");
  assert.equal(res.headers["Content-Type"], "application/pdf");
  assert.match(res.headers["Content-Disposition"], /attachment; filename="avaliacao-ana-silva-2026-09-01\.pdf"/);
  assert.equal(dadosPassadosPraPdf.pacienteNome, "Ana Silva");
  assert.equal(dadosPassadosPraPdf.dataAvaliacao, "2026-09-01");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/avaliacaoFisioterapeuticaController.test.js`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implementar o controller**

```js
// src/controllers/avaliacaoFisioterapeuticaController.js
import { buscarPacientePorId } from "../models/pacienteModel.js";
import {
  criarAvaliacao,
  buscarAvaliacaoDoPaciente,
  atualizarAvaliacao,
} from "../models/avaliacaoFisioterapeuticaModel.js";
import { gerarPdfAvaliacao } from "../services/avaliacaoFisioterapeuticaPdfService.js";
import { slugArquivo } from "../utils/slugArquivo.js";
import { idSeguro } from "../utils/paginacao.js";
import { validarData } from "../utils/validacao.js";

function campoOuNulo(valor) {
  const texto = String(valor ?? "").trim();
  return texto || null;
}

function camposConteudoDoBody(body) {
  return {
    estaGravida: campoOuNulo(body.esta_gravida),
    possuiMarcapasso: campoOuNulo(body.possui_marcapasso),
    possuiProteseMetalicaImplantes: campoOuNulo(body.possui_protese_metalica_implantes),
    possuiDoencasCardiacas: campoOuNulo(body.possui_doencas_cardiacas),
    possuiHipertensaoArterial: campoOuNulo(body.possui_hipertensao_arterial),
    possuiDiabetes: campoOuNulo(body.possui_diabetes),
    possuiEpilepsia: campoOuNulo(body.possui_epilepsia),
    possuiHistoricoCancer: campoOuNulo(body.possui_historico_cancer),
    medicamentosContinuosQuais: campoOuNulo(body.medicamentos_continuos_quais),
    cirurgiaQual: campoOuNulo(body.cirurgia_qual),
    cirurgiaQuando: campoOuNulo(body.cirurgia_quando),
    tempoUltimaCirurgia: campoOuNulo(body.tempo_ultima_cirurgia),
    dorAtualLocal: campoOuNulo(body.dor_atual_local),
    dorAtualIntensidade: campoOuNulo(body.dor_atual_intensidade),
    limitacoesFuncionaisQuais: campoOuNulo(body.limitacoes_funcionais_quais),
    fisioterapiaAnteriormente: campoOuNulo(body.fisioterapia_anteriormente),
    objetivosTratamento: campoOuNulo(body.objetivos_tratamento),
    condutasPropostas: campoOuNulo(body.condutas_propostas),
  };
}

export async function telaNovaAvaliacao(req, res, { buscarPaciente = buscarPacientePorId } = {}) {
  const pacienteId = idSeguro(req.params.id);
  if (!pacienteId) return res.status(404).send("Paciente não encontrado.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  res.render("avaliacoes/formulario", {
    paciente,
    avaliacao: null,
    erro: null,
    acaoForm: `/pacientes/${pacienteId}/avaliacoes/nova`,
  });
}

export async function processarNovaAvaliacao(
  req,
  res,
  { buscarPaciente = buscarPacientePorId, criar = criarAvaliacao } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  if (!pacienteId) return res.status(404).send("Paciente não encontrado.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  const body = req.body ?? {};
  const dataAvaliacao = String(body.data_avaliacao ?? "").trim();
  if (!validarData(dataAvaliacao)) return res.status(400).send("Data da avaliação inválida.");

  await criar({
    pacienteId,
    dataAvaliacao,
    ...camposConteudoDoBody(body),
    registradoPor: req.usuarioAtual.id,
  });

  res.redirect(`/pacientes/${pacienteId}/ficha`);
}

export async function telaEditarAvaliacao(
  req,
  res,
  { buscarPaciente = buscarPacientePorId, buscarAvaliacao = buscarAvaliacaoDoPaciente } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  const avaliacaoId = idSeguro(req.params.avaliacaoId);
  if (!pacienteId || !avaliacaoId) return res.status(404).send("Avaliação não encontrada.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  const avaliacao = await buscarAvaliacao(avaliacaoId, pacienteId);
  if (!avaliacao) return res.status(404).send("Avaliação não encontrada.");

  res.render("avaliacoes/formulario", {
    paciente,
    avaliacao,
    erro: null,
    acaoForm: `/pacientes/${pacienteId}/avaliacoes/${avaliacaoId}/editar`,
  });
}

export async function processarEditarAvaliacao(
  req,
  res,
  { buscarAvaliacao = buscarAvaliacaoDoPaciente, atualizar = atualizarAvaliacao } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  const avaliacaoId = idSeguro(req.params.avaliacaoId);
  if (!pacienteId || !avaliacaoId) return res.status(404).send("Avaliação não encontrada.");

  const avaliacao = await buscarAvaliacao(avaliacaoId, pacienteId);
  if (!avaliacao) return res.status(404).send("Avaliação não encontrada.");

  const body = req.body ?? {};
  const dataAvaliacao = String(body.data_avaliacao ?? "").trim();
  if (!validarData(dataAvaliacao)) return res.status(400).send("Data da avaliação inválida.");

  await atualizar(avaliacaoId, {
    dataAvaliacao,
    ...camposConteudoDoBody(body),
  });

  res.redirect(`/pacientes/${pacienteId}/ficha`);
}

export async function gerarPdfAvaliacaoController(
  req,
  res,
  {
    buscarPaciente = buscarPacientePorId,
    buscarAvaliacao = buscarAvaliacaoDoPaciente,
    gerarPdf = gerarPdfAvaliacao,
  } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  const avaliacaoId = idSeguro(req.params.avaliacaoId);
  if (!pacienteId || !avaliacaoId) return res.status(404).send("Avaliação não encontrada.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  const avaliacao = await buscarAvaliacao(avaliacaoId, pacienteId);
  if (!avaliacao) return res.status(404).send("Avaliação não encontrada.");

  const pdf = await gerarPdf({ pacienteNome: paciente.nome, ...avaliacao });
  const nomeArquivo = `avaliacao-${slugArquivo(paciente.nome)}-${avaliacao.dataAvaliacao}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo}"`);
  res.send(pdf);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/avaliacaoFisioterapeuticaController.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/controllers/avaliacaoFisioterapeuticaController.js test/avaliacaoFisioterapeuticaController.test.js
git commit -m "feat: controller de avaliação fisioterapêutica"
```

---

## Task 5: View do formulário + rotas

**Files:**
- Create: `src/views/avaliacoes/formulario.ejs`
- Modify: `src/routes/dashboardRoutes.js`
- Test: `test/avaliacaoFormularioView.test.js`

**Interfaces:**
- Consumes: `telaNovaAvaliacao`, `processarNovaAvaliacao`, `telaEditarAvaliacao`, `processarEditarAvaliacao`, `gerarPdfAvaliacaoController` (Task 4).

- [ ] **Step 1: Escrever o teste da view**

```js
// test/avaliacaoFormularioView.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import ejs from "ejs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VIEWS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/views");

async function renderizar(dados) {
  return ejs.renderFile(path.join(VIEWS_DIR, "avaliacoes/formulario.ejs"), {
    csrfToken: "token-teste",
    paciente: { id: 7, nome: "Ana Silva" },
    avaliacao: null,
    erro: null,
    acaoForm: "/pacientes/7/avaliacoes/nova",
    ...dados,
  });
}

test("formulario: sem avaliacao, todos os campos vêm vazios e não mostra link de PDF", async () => {
  const html = await renderizar({});

  assert.match(html, /name="data_avaliacao"/);
  assert.match(html, /name="esta_gravida"/);
  assert.match(html, /name="possui_marcapasso"/);
  assert.match(html, /name="possui_protese_metalica_implantes"/);
  assert.match(html, /name="possui_doencas_cardiacas"/);
  assert.match(html, /name="possui_hipertensao_arterial"/);
  assert.match(html, /name="possui_diabetes"/);
  assert.match(html, /name="possui_epilepsia"/);
  assert.match(html, /name="possui_historico_cancer"/);
  assert.match(html, /name="medicamentos_continuos_quais"/);
  assert.match(html, /name="cirurgia_qual"/);
  assert.match(html, /name="cirurgia_quando"/);
  assert.match(html, /name="tempo_ultima_cirurgia"/);
  assert.match(html, /name="dor_atual_local"/);
  assert.match(html, /name="dor_atual_intensidade"/);
  assert.match(html, /name="limitacoes_funcionais_quais"/);
  assert.match(html, /name="fisioterapia_anteriormente"/);
  assert.match(html, /name="objetivos_tratamento"/);
  assert.match(html, /name="condutas_propostas"/);
  assert.doesNotMatch(html, /value="null"/);
  assert.doesNotMatch(html, /\/pdf"/);
});

test("formulario: com avaliacao preenchida, campos vêm pré-preenchidos e mostra link de PDF", async () => {
  const html = await renderizar({
    avaliacao: {
      id: 5, dataAvaliacao: "2026-09-01", estaGravida: "Não", possuiDiabetes: "Sim",
      dorAtualLocal: "Lombar", dorAtualIntensidade: "7", objetivosTratamento: "Reduzir dor",
      condutasPropostas: "Fortalecimento",
    },
    acaoForm: "/pacientes/7/avaliacoes/5/editar",
  });

  assert.match(html, /name="data_avaliacao"[^>]*value="2026-09-01"/);
  assert.match(html, /name="possui_diabetes"[^>]*value="Sim"/);
  assert.match(html, />Reduzir dor</);
  assert.match(html, /href="\/pacientes\/7\/avaliacoes\/5\/pdf"/);
});

test("formulario: mostra mensagem de erro quando presente", async () => {
  const html = await renderizar({ erro: "Data da avaliação inválida." });
  assert.match(html, /Data da avaliação inválida\./);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/avaliacaoFormularioView.test.js`
Expected: FAIL (view não existe)

- [ ] **Step 3: Criar a view**

```html
<!-- src/views/avaliacoes/formulario.ejs -->
<%- include("../partials/header", { titulo: avaliacao ? "Editar avaliação" : "Nova avaliação" }) %>
<header class="page-header">
  <div>
    <h1><%= avaliacao ? "Editar avaliação" : "Nova avaliação" %></h1>
    <p>Paciente: <%= paciente.nome %></p>
  </div>
  <a class="button button--quiet" href="/pacientes/<%= paciente.id %>/ficha">Voltar para a ficha</a>
</header>

<form class="focused-form" method="post" action="<%= acaoForm %>">
  <input type="hidden" name="_csrf" value="<%= csrfToken %>" />
  <% if (erro) { %>
  <p class="erro"><%= erro %></p>
  <% } %>

  <div class="form-grid">
    <label>Data da avaliação<input type="date" name="data_avaliacao" value="<%= avaliacao?.dataAvaliacao ?? '' %>" required /></label>
  </div>

  <fieldset>
    <legend>Anamnese</legend>
    <label>Está grávida?<input type="text" name="esta_gravida" value="<%= avaliacao?.estaGravida ?? '' %>" /></label>
    <label>Possui marcapasso?<input type="text" name="possui_marcapasso" value="<%= avaliacao?.possuiMarcapasso ?? '' %>" /></label>
    <label>Possui prótese metálica ou implantes?<input type="text" name="possui_protese_metalica_implantes" value="<%= avaliacao?.possuiProteseMetalicaImplantes ?? '' %>" /></label>
    <label>Possui doenças cardíacas?<input type="text" name="possui_doencas_cardiacas" value="<%= avaliacao?.possuiDoencasCardiacas ?? '' %>" /></label>
    <label>Possui hipertensão arterial?<input type="text" name="possui_hipertensao_arterial" value="<%= avaliacao?.possuiHipertensaoArterial ?? '' %>" /></label>
    <label>Possui diabetes?<input type="text" name="possui_diabetes" value="<%= avaliacao?.possuiDiabetes ?? '' %>" /></label>
    <label>Possui epilepsia?<input type="text" name="possui_epilepsia" value="<%= avaliacao?.possuiEpilepsia ?? '' %>" /></label>
    <label>Possui histórico de câncer?<input type="text" name="possui_historico_cancer" value="<%= avaliacao?.possuiHistoricoCancer ?? '' %>" /></label>
    <label>Faz uso de medicamentos contínuos? Quais?<input type="text" name="medicamentos_continuos_quais" value="<%= avaliacao?.medicamentosContinuosQuais ?? '' %>" /></label>
    <label>Já realizou cirurgia? Qual?<input type="text" name="cirurgia_qual" value="<%= avaliacao?.cirurgiaQual ?? '' %>" /></label>
    <label>Quando?<input type="text" name="cirurgia_quando" value="<%= avaliacao?.cirurgiaQuando ?? '' %>" /></label>
    <label>Quanto tempo da última cirurgia?<input type="text" name="tempo_ultima_cirurgia" value="<%= avaliacao?.tempoUltimaCirurgia ?? '' %>" /></label>
    <label>Sente dor atualmente? Local<input type="text" name="dor_atual_local" value="<%= avaliacao?.dorAtualLocal ?? '' %>" /></label>
    <label>Intensidade da dor (0-10)<input type="text" name="dor_atual_intensidade" value="<%= avaliacao?.dorAtualIntensidade ?? '' %>" /></label>
    <label>Apresenta limitações funcionais? Quais?<input type="text" name="limitacoes_funcionais_quais" value="<%= avaliacao?.limitacoesFuncionaisQuais ?? '' %>" /></label>
    <label>Já realizou fisioterapia anteriormente?<input type="text" name="fisioterapia_anteriormente" value="<%= avaliacao?.fisioterapiaAnteriormente ?? '' %>" /></label>
  </fieldset>

  <fieldset>
    <legend>Plano terapêutico</legend>
    <label>Objetivos do tratamento<textarea name="objetivos_tratamento" rows="4"><%= avaliacao?.objetivosTratamento ?? '' %></textarea></label>
    <label>Condutas propostas<textarea name="condutas_propostas" rows="4"><%= avaliacao?.condutasPropostas ?? '' %></textarea></label>
  </fieldset>

  <div class="toolbar">
    <button type="submit">Salvar</button>
    <% if (avaliacao) { %>
    <a class="button button--quiet" href="/pacientes/<%= paciente.id %>/avaliacoes/<%= avaliacao.id %>/pdf">Gerar PDF</a>
    <% } %>
  </div>
</form>
<%- include("../partials/footer") %>
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/avaliacaoFormularioView.test.js`
Expected: PASS

- [ ] **Step 5: Adicionar as rotas**

Em `src/routes/dashboardRoutes.js`, adicionar ao bloco de imports:

```js
import {
  telaNovaAvaliacao,
  processarNovaAvaliacao,
  telaEditarAvaliacao,
  processarEditarAvaliacao,
  gerarPdfAvaliacaoController,
} from "../controllers/avaliacaoFisioterapeuticaController.js";
```

E, logo após as rotas de `/pacientes/:id/controle-sessoes` já existentes:

```js
router.get(
  "/pacientes/:id/avaliacoes/nova",
  asyncHandler(exigirLogin),
  asyncHandler(telaNovaAvaliacao)
);
router.post(
  "/pacientes/:id/avaliacoes/nova",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarNovaAvaliacao)
);
router.get(
  "/pacientes/:id/avaliacoes/:avaliacaoId/editar",
  asyncHandler(exigirLogin),
  asyncHandler(telaEditarAvaliacao)
);
router.post(
  "/pacientes/:id/avaliacoes/:avaliacaoId/editar",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarEditarAvaliacao)
);
router.get(
  "/pacientes/:id/avaliacoes/:avaliacaoId/pdf",
  asyncHandler(exigirLogin),
  asyncHandler(gerarPdfAvaliacaoController)
);
```

- [ ] **Step 6: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/views/avaliacoes/formulario.ejs src/routes/dashboardRoutes.js test/avaliacaoFormularioView.test.js
git commit -m "feat: tela e rotas de criar/editar avaliação fisioterapêutica"
```

---

## Task 6: Seção de avaliações na ficha do paciente

**Files:**
- Modify: `src/controllers/dashboardController.js` (`telaFichaPaciente`)
- Modify: `src/views/pacientes/ficha.ejs`
- Test: `test/dashboardController.test.js` (ajustar teste existente de `telaFichaPaciente`)
- Test: `test/fichaPacienteView.test.js` (adicionar testes novos + ajustar helper `renderizar`)

**Interfaces:**
- Consumes: `listarAvaliacoesPaciente` de `../models/avaliacaoFisioterapeuticaModel.js` (Task 2).

- [ ] **Step 1: Atualizar o teste existente de `telaFichaPaciente` em `test/dashboardController.test.js`**

Localizar o teste `"telaFichaPaciente mostra dados, histórico e pacotes do paciente solicitado"` (por volta da linha 238) e atualizar pra injetar `buscarAvaliacoes` e conferir `avaliacoes` no resultado:

```js
test("telaFichaPaciente mostra dados, histórico, pacotes e avaliações do paciente solicitado", async () => {
  const res = criarRespostaFalsa();
  const paciente = { id: 7, nome: "Ana Silva", telefone: "5511999999999", convenio: "Particular" };
  const historico = [{ data: "2026-08-30", hora: "09:00", tipo_atendimento: "fisioterapia", status: "confirmado" }];
  const pacotes = [{ id: 1, quantidade_total: 10, cancelado: false, created_at: "2026-08-01", quantidade_usada: 3 }];
  const avaliacoes = [{ id: 3, dataAvaliacao: "2026-09-01" }];

  await telaFichaPaciente(
    { params: { id: "7" } },
    res,
    {
      buscarPaciente: async (id) => (id === 7 ? paciente : null),
      buscarHistorico: async (id) => (id === 7 ? historico : []),
      buscarPacotes: async (id) => (id === 7 ? pacotes : []),
      buscarAvaliacoes: async (id) => (id === 7 ? avaliacoes : []),
    }
  );

  assert.equal(res.viewRenderizada, "pacientes/ficha");
  assert.deepEqual(res.dadosDaView, { paciente, historico, pacotes, avaliacoes, idade: null });
});
```

Substituir o teste antigo por esse (mesmo nome de `describe`/posição, só acrescentando `avaliacoes`). Os outros testes de `telaFichaPaciente` no mesmo arquivo (ex.: `"telaFichaPaciente rejeita identificador inválido sem consultar dados"`) não usam `buscarAvaliacoes` — como o parâmetro é opcional com default, eles continuam passando sem alteração.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/dashboardController.test.js`
Expected: FAIL (`avaliacoes` ausente do objeto renderizado)

- [ ] **Step 3: Atualizar `telaFichaPaciente`**

Em `src/controllers/dashboardController.js`, adicionar o import:

```js
import { listarAvaliacoesPaciente } from "../models/avaliacaoFisioterapeuticaModel.js";
```

E atualizar a função (por volta da linha 669):

```js
export async function telaFichaPaciente(
  req,
  res,
  {
    buscarPaciente = buscarPacientePorIdPadrao,
    buscarHistorico = listarHistoricoPaciente,
    buscarPacotes = listarPacotesPaciente,
    buscarAvaliacoes = listarAvaliacoesPaciente,
  } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  if (!pacienteId) return res.status(404).send("Paciente não encontrado.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  const [historico, pacotes, avaliacoes] = await Promise.all([
    buscarHistorico(pacienteId),
    buscarPacotes(pacienteId),
    buscarAvaliacoes(pacienteId),
  ]);

  const idade = paciente.data_nascimento
    ? dayjs().diff(dayjs(paciente.data_nascimento), "year")
    : null;

  res.render("pacientes/ficha", { paciente, historico, pacotes, avaliacoes, idade });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/dashboardController.test.js`
Expected: PASS

- [ ] **Step 5: Atualizar o helper `renderizar` e adicionar testes em `test/fichaPacienteView.test.js`**

Adicionar `avaliacoes: []` ao objeto default da função `renderizar` (por volta da linha 20 do arquivo, junto de `pacotes: []` / `idade: null`):

```js
function renderizar(dados) {
  const caminho = path.join(VIEWS_DIR, "pacientes", "ficha.ejs");
  return ejs.renderFile(caminho, {
    paciente: PACIENTE,
    historico: [],
    pacotes: [],
    avaliacoes: [],
    idade: null,
    csrfToken: "token-fake",
    usuarioAtual: ADMINISTRADORA,
    formatarDataHora,
    formatarData,
    ...dados,
  });
}
```

E adicionar os testes novos:

```js
test("ficha: sem avaliações, mostra mensagem de nenhuma avaliação registrada", async () => {
  const html = await renderizar({ avaliacoes: [] });

  assert.match(html, /Nenhuma avaliação registrada/);
  assert.match(html, /href="\/pacientes\/7\/avaliacoes\/nova"/);
});

test("ficha: com avaliações, lista cada uma com data e link de editar", async () => {
  const html = await renderizar({
    avaliacoes: [{ id: 3, dataAvaliacao: "2026-09-01" }, { id: 1, dataAvaliacao: "2026-01-10" }],
  });

  assert.match(html, /href="\/pacientes\/7\/avaliacoes\/3\/editar"/);
  assert.match(html, /href="\/pacientes\/7\/avaliacoes\/1\/editar"/);
  assert.doesNotMatch(html, /Nenhuma avaliação registrada/);
});
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `node --test test/fichaPacienteView.test.js`
Expected: FAIL (seção ainda não existe na view)

- [ ] **Step 7: Adicionar a seção em `src/views/pacientes/ficha.ejs`**

Logo depois da seção `<section class="patient-history" aria-labelledby="patient-history-title">` (histórico de agendamentos) já existente, adicionar:

```html
<section class="patient-history" aria-labelledby="patient-evaluations-title">
  <div class="section-heading">
    <h2 id="patient-evaluations-title">Avaliações fisioterapêuticas</h2>
  </div>
  <div class="toolbar">
    <a class="button button--quiet" href="/pacientes/<%= paciente.id %>/avaliacoes/nova">Nova avaliação</a>
  </div>
  <% if (avaliacoes.length === 0) { %>
  <p>Nenhuma avaliação registrada.</p>
  <% } else { %>
  <div class="patient-table-wrap"><table class="data-table">
    <thead><tr><th>Data</th><th></th></tr></thead>
    <tbody>
      <% avaliacoes.forEach((avaliacao) => { %>
      <tr>
        <td><%= formatarData(avaliacao.dataAvaliacao) %></td>
        <td><a href="/pacientes/<%= paciente.id %>/avaliacoes/<%= avaliacao.id %>/editar">Ver / editar</a></td>
      </tr>
      <% }) %>
    </tbody>
  </table></div>
  <% } %>
</section>
```

- [ ] **Step 8: Rodar e ver passar**

Run: `node --test test/fichaPacienteView.test.js`
Expected: PASS

- [ ] **Step 9: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/controllers/dashboardController.js src/views/pacientes/ficha.ejs test/dashboardController.test.js test/fichaPacienteView.test.js
git commit -m "feat: seção de avaliações fisioterapêuticas na ficha do paciente"
```

---

## Task 7: Verificação final

**Files:** nenhum arquivo novo — só validação.

- [ ] **Step 1: Rodar a suíte completa**

Run: `npm test`
Expected: PASS (todos os testes, incluindo os de todas as tasks anteriores)

- [ ] **Step 2: Rodar o lint**

Run: `npm run lint`
Expected: sem erros

- [ ] **Step 3: Checklist manual (se houver ambiente local com banco de dev disponível)**

- Abrir a ficha de um paciente de teste → seção "Avaliações fisioterapêuticas" aparece vazia com botão "Nova avaliação".
- Criar uma avaliação preenchendo alguns campos e deixando outros em branco → salva → volta pra ficha → avaliação aparece na lista com a data certa.
- Clicar em "Ver / editar" → formulário abre pré-preenchido, campos em branco aparecem vazios (não "null").
- Editar um campo e salvar → volta pra ficha, mudança persistida.
- Clicar em "Gerar PDF" → baixa um PDF com as perguntas preenchidas e sem as vazias.
- Criar uma segunda avaliação pro mesmo paciente → as duas aparecem na lista, cada uma editável/gerável separadamente.

Se não houver banco de dev disponível nesta sessão, documentar isso explicitamente e não simular essa etapa.

- [ ] **Step 4: Nenhum commit nesta task** (é só checkpoint de verificação — se algo falhar, corrigir na task correspondente e recomitar lá).
