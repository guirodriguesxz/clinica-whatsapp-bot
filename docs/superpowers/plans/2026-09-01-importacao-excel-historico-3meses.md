# Importação retroativa via Excel (3 meses, sem telefone) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Importar o relatório histórico de 3 meses (01/07 a 30/09/2026) que a clínica exportou do sistema de agenda anterior em Excel — sem telefone/CPF/atendente — para `agendamentos_importados`/`registros_atendimento`, sem duplicar dado, sem criar paciente errado por homônimo, e sem exigir que a recepção mexa em terminal ou banco.

**Architecture:** Dois serviços novos e isolados — `importacaoExcelHistoricoService.js` (parse do `.xlsx`, matching só por nome exato normalizado, escrita em `agendamentos_importados`/`registros_atendimento`) e `planilhaRevisaoService.js` (gera e depois aplica a planilha que a recepção preenche pros casos ambíguos/sem match) — mais um script CLI de orquestração. Reaproveita `normalizarTexto` (`importacaoLegadoService.js`), `registrarPresencaImportado` (`registroAtendimentoModel.js`), `encontrarOuCriarPaciente` (`pacienteModel.js`) e `normalizarTelefone`/`formatarTelefoneExibicao` (`utils/phone.js`). **Nunca** modifica nem reaproveita `processarLinha` de `importacaoLegadoService.js` — ver spec, seção "Por que um caminho isolado".

**Tech Stack:** Node.js (ESM), `xlsx` (SheetJS, nova dependência) para ler/escrever `.xlsx`, `pg` via o `pool` já existente, `node --test` para os testes (mesmo padrão do resto do projeto).

**Spec:** [docs/superpowers/specs/2026-09-01-importacao-excel-historico-3meses-design.md](../specs/2026-09-01-importacao-excel-historico-3meses-design.md)

## Global Constraints

- **Este projeto não tem banco de dev/staging** — o `DATABASE_URL` local aponta pra produção real (Neon). Nenhuma task deste plano aplica a migration, cria usuário real, nem roda qualquer script com `--aplicar` contra o banco de verdade. Todo teste automatizado usa `pool.query` mockado via `t.mock.method(pool, "query", ...)`, nunca uma conexão real.
- Aplicar a migration, criar o usuário "Importação" de verdade e rodar `--aplicar` contra produção só acontece na Task 8, e só com autorização explícita do usuário nesta sessão — nunca por conta própria.
- **Isolamento do bot**: este código nunca importa nem chama `aiService`, `chatService`, rotas de webhook, ou `calendarService`. Só `INSERT`/`UPDATE`/`SELECT` direto via `pool`, e (indiretamente, via o cron já existente) o `lembreteService` pegando linhas futuras sem lembrete suprimido.
- Identificadores, comentários e mensagens de log em português, mesmo estilo do resto do projeto (comentário só quando explica um "porquê" não óbvio, não o "o quê").
- Rodar `npm run lint` antes de considerar qualquer task concluída (achado real do sub-projeto 2: um erro de lint passou despercebido por 8 reviews seguidas).
- `Tipo visita` (`CP`/`F`/`D`) é gravado bruto, sem nenhuma lógica de negócio ramificando sobre o valor — nenhuma task deste plano deve tentar interpretar esse campo.

---

## Task 1: Dependência `xlsx` + migration da coluna `tem_ficha`

**Files:**
- Modify: `package.json`
- Create: `src/db/migrations/015_importacao_excel_ficha.sql`

**Interfaces:**
- Consumes: nada.
- Produces: pacote `xlsx` instalado (usado pelas Tasks 2, 5 e 6); coluna `agendamentos_importados.tem_ficha` (só existe de fato em produção depois que a Task 8 aplicar a migration manualmente — as tasks de teste deste plano usam `pool` mockado e não dependem do schema real existir ainda).

- [ ] **Step 1: Instalar a dependência**

```bash
npm install xlsx@^0.18.5
```

- [ ] **Step 2: Confirmar que o pacote importa corretamente em ESM**

Run: `node -e "import('xlsx').then((m) => console.log('xlsx ok, funções:', typeof m.readFile, typeof m.utils.json_to_sheet))"`
Expected: `xlsx ok, funções: function function`

- [ ] **Step 3: Criar a migration (arquivo apenas — não aplicar agora)**

```sql
-- src/db/migrations/015_importacao_excel_ficha.sql
-- Clínica Exemplo Bot — migration 015: coluna tem_ficha em agendamentos_importados,
-- usada pela importação retroativa via Excel (relatório de 3 meses do
-- sistema de agenda anterior, sem telefone/CPF/atendente). Ver spec
-- docs/superpowers/specs/2026-09-01-importacao-excel-historico-3meses-design.md.
-- ATENÇÃO: este projeto não tem banco de dev separado do de produção — só
-- aplicar depois de confirmar com o usuário (ver Task 8 do plano deste
-- sub-projeto).

ALTER TABLE agendamentos_importados
  ADD COLUMN IF NOT EXISTS tem_ficha BOOLEAN;
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/db/migrations/015_importacao_excel_ficha.sql
git commit -m "chore: adiciona dependência xlsx e migration da coluna tem_ficha"
```

---

## Task 2: Parser do Excel (`parsearArquivoExcel`)

**Files:**
- Create: `src/services/importacaoExcelHistoricoService.js`
- Test: `test/importacaoExcelHistoricoService.test.js`

**Interfaces:**
- Consumes: `normalizarTexto` de `../services/importacaoLegadoService.js` (já existe, exportado).
- Produces: `parsearArquivoExcel(caminhoArquivo: string): Array<{ nome: string, data: string|null, hora: string, categoria: string|null, tipo: string|null, temFicha: boolean|null, presenca: 'compareceu'|'faltou'|null }>` — usado pela Task 3.

- [ ] **Step 1: Escrever os testes (falhando)**

```javascript
// test/importacaoExcelHistoricoService.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import XLSX from "xlsx";
import { parsearArquivoExcel } from "../src/services/importacaoExcelHistoricoService.js";

function escreverExcelExemplo(caminho, linhas) {
  const planilha = XLSX.utils.aoa_to_sheet([
    [
      "NomePaciente",
      "Data",
      "Hora",
      "Tipo visita",
      "Nome convênio",
      "Cadastrou",
      "Confirmou",
      "Ficha",
      "Status Ficha",
    ],
    ...linhas,
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, planilha, "Relatório");
  XLSX.writeFile(workbook, caminho);
}

test("parsearArquivoExcel extrai linhas reais e mapeia Ficha/Status Ficha", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "importacao-excel-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const caminho = join(dir, "relatorio.xlsx");

  escreverExcelExemplo(caminho, [
    ["Ana Clara Guabiraba Blumer", "07/07/2026", "09:00", "CP", "Particular", "Fulana", "", "Sim", "agendado e veio"],
    ["Antonia de Lima Gomes Souza", "27/07/2026", "10:30", "F", "Mar Azul Saúde", "Fulana", "", "Não", "agendado e não veio"],
    ["Sem Status", "01/08/2026", "11:00", "CP", "Particular", "Fulana", "", "", ""],
  ]);

  const linhas = parsearArquivoExcel(caminho);

  assert.equal(linhas.length, 3);
  assert.deepEqual(linhas[0], {
    nome: "Ana Clara Guabiraba Blumer",
    data: "2026-07-07",
    hora: "09:00",
    categoria: "Particular",
    tipo: "CP",
    temFicha: true,
    presenca: "compareceu",
  });
  assert.deepEqual(linhas[1], {
    nome: "Antonia de Lima Gomes Souza",
    data: "2026-07-27",
    hora: "10:30",
    categoria: "Mar Azul Saúde",
    tipo: "F",
    temFicha: false,
    presenca: "faltou",
  });
  assert.equal(linhas[2].temFicha, null);
  assert.equal(linhas[2].presenca, null);
});

test("parsearArquivoExcel ignora linha sem nome de paciente", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "importacao-excel-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const caminho = join(dir, "relatorio.xlsx");

  escreverExcelExemplo(caminho, [
    ["", "", "", "", "", "", "", "", ""],
    ["Yvone de Fatima de Souza", "01/07/2026", "08:00", "F", "Particular", "Fulana", "", "Sim", "agendado e veio"],
  ]);

  const linhas = parsearArquivoExcel(caminho);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].nome, "Yvone de Fatima de Souza");
});

test("parsearArquivoExcel lança erro claro se o cabeçalho não bater com o esperado", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "importacao-excel-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const caminho = join(dir, "relatorio-errado.xlsx");

  const planilha = XLSX.utils.aoa_to_sheet([["Coluna Qualquer"], ["valor"]]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, planilha, "Relatório");
  XLSX.writeFile(workbook, caminho);

  assert.throws(() => parsearArquivoExcel(caminho), /Coluna "NomePaciente" não encontrada/);
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test test/importacaoExcelHistoricoService.test.js`
Expected: FAIL — `Cannot find module '../src/services/importacaoExcelHistoricoService.js'`

- [ ] **Step 3: Implementar o parser**

```javascript
// src/services/importacaoExcelHistoricoService.js
import XLSX from "xlsx";
import { normalizarTexto } from "./importacaoLegadoService.js";

const COLUNAS_ESPERADAS = {
  nome: "NomePaciente",
  data: "Data",
  hora: "Hora",
  tipo: "Tipo visita",
  categoria: "Nome convênio",
  ficha: "Ficha",
  statusFicha: "Status Ficha",
};

function mapearIndiceColunas(cabecalho) {
  const indice = {};
  for (const [chave, rotulo] of Object.entries(COLUNAS_ESPERADAS)) {
    const posicao = cabecalho.findIndex(
      (valor) => normalizarTexto(String(valor ?? "")) === normalizarTexto(rotulo)
    );
    if (posicao === -1) {
      throw new Error(`Coluna "${rotulo}" não encontrada no cabeçalho do relatório Excel`);
    }
    indice[chave] = posicao;
  }
  return indice;
}

// A célula de data pode vir como Date real (se o Excel tiver formatação de
// data aplicada) ou como texto "DD/MM/YYYY" (comum quando o arquivo veio de
// conversão PDF→Excel, sem formatação real de célula) — trata os dois.
function converterData(valor) {
  if (valor instanceof Date) {
    const ano = valor.getFullYear();
    const mes = String(valor.getMonth() + 1).padStart(2, "0");
    const dia = String(valor.getDate()).padStart(2, "0");
    return `${ano}-${mes}-${dia}`;
  }
  const texto = String(valor ?? "").trim();
  const match = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, dia, mes, ano] = match;
  return `${ano}-${mes}-${dia}`;
}

function converterHora(valor) {
  if (valor instanceof Date) {
    const horas = String(valor.getHours()).padStart(2, "0");
    const minutos = String(valor.getMinutes()).padStart(2, "0");
    return `${horas}:${minutos}`;
  }
  return String(valor ?? "").trim();
}

function mapearTemFicha(valor) {
  const texto = normalizarTexto(String(valor ?? ""));
  if (texto === "sim") return true;
  if (texto === "nao") return false;
  return null;
}

// Checa "não veio" ANTES de "veio" de propósito — "agendado e não veio"
// contém a substring "veio" também, então a ordem inverte o resultado se
// trocada.
function mapearPresenca(valor) {
  const texto = normalizarTexto(String(valor ?? ""));
  if (texto.includes("nao veio")) return "faltou";
  if (texto.includes("veio")) return "compareceu";
  return null;
}

/**
 * Faz o parse do relatório histórico em Excel (.xlsx) que a clínica
 * conseguiu exportar em vez do XML esperado (ver spec) — sem
 * telefone/CPF/atendente, mas com presença (`Status Ficha`) que o formato
 * XML da migração anterior nunca teve.
 */
export function parsearArquivoExcel(caminhoArquivo) {
  const workbook = XLSX.readFile(caminhoArquivo, { cellDates: true });
  const planilha = workbook.Sheets[workbook.SheetNames[0]];
  const linhasBrutas = XLSX.utils.sheet_to_json(planilha, { header: 1, defval: "" });

  const [cabecalho, ...linhasDados] = linhasBrutas;
  const indice = mapearIndiceColunas(cabecalho);

  return linhasDados
    .filter((linha) => String(linha[indice.nome] ?? "").trim() !== "")
    .map((linha) => ({
      nome: String(linha[indice.nome]).trim(),
      data: converterData(linha[indice.data]),
      hora: converterHora(linha[indice.hora]),
      categoria: String(linha[indice.categoria] ?? "").trim() || null,
      tipo: String(linha[indice.tipo] ?? "").trim() || null,
      temFicha: mapearTemFicha(linha[indice.ficha]),
      presenca: mapearPresenca(linha[indice.statusFicha]),
    }));
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test test/importacaoExcelHistoricoService.test.js`
Expected: PASS (3 testes)

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: sem erros

- [ ] **Step 6: Commit**

```bash
git add src/services/importacaoExcelHistoricoService.js test/importacaoExcelHistoricoService.test.js
git commit -m "feat: parser do relatório Excel histórico do sistema de agenda anterior"
```

---

## Task 3: Matching por nome (`decidirLinha`)

**Files:**
- Modify: `src/services/importacaoExcelHistoricoService.js`
- Modify: `test/importacaoExcelHistoricoService.test.js`

**Interfaces:**
- Consumes: `pool` de `../db/pool.js`; `normalizarTexto` (já importado na Task 2).
- Produces:
  - `buscarTodosPacientes(): Promise<Array<{id: number, nome: string, telefone: string}>>`
  - `encontrarCandidatosPaciente(nomeBuscado: string, pacientes: Array<{id,nome,telefone}>): Array<{id,nome,telefone}>`
  - `decidirLinha(linha, pacientes): {tipo: 'auto_vinculo', paciente, linha} | {tipo: 'revisao', candidatos: [], linha} | {tipo: 'divergencia', motivo: string, linha}` — usado pela Task 7 (CLI).

- [ ] **Step 1: Escrever os testes (falhando)**

Adicionar ao final de `test/importacaoExcelHistoricoService.test.js`:

```javascript
import { encontrarCandidatosPaciente, decidirLinha } from "../src/services/importacaoExcelHistoricoService.js";

function linhaValidaExemplo(sobrescreve = {}) {
  return {
    nome: "João da Silva",
    data: "2026-07-07",
    hora: "09:00",
    categoria: "Particular",
    tipo: "CP",
    temFicha: null,
    presenca: null,
    ...sobrescreve,
  };
}

test("encontrarCandidatosPaciente compara nome normalizado (acento/caixa)", () => {
  const pacientes = [
    { id: 1, nome: "João da Silva", telefone: "5511999990001" },
    { id: 2, nome: "Maria Souza", telefone: "5511999990002" },
  ];
  assert.deepEqual(encontrarCandidatosPaciente("joao da silva", pacientes), [pacientes[0]]);
  assert.deepEqual(encontrarCandidatosPaciente("Joana Pereira", pacientes), []);
});

test("encontrarCandidatosPaciente retorna todos os homônimos", () => {
  const pacientes = [
    { id: 1, nome: "Ana Clara", telefone: "5511999990001" },
    { id: 2, nome: "ana clara", telefone: "5511999990002" },
  ];
  assert.equal(encontrarCandidatosPaciente("Ana Clara", pacientes).length, 2);
});

test("decidirLinha: nome único → auto_vinculo", () => {
  const pacientes = [{ id: 1, nome: "João da Silva", telefone: "5511999990001" }];
  const decisao = decidirLinha(linhaValidaExemplo(), pacientes);
  assert.equal(decisao.tipo, "auto_vinculo");
  assert.equal(decisao.paciente.id, 1);
});

test("decidirLinha: nome ambíguo → revisao com candidatos", () => {
  const pacientes = [
    { id: 1, nome: "João da Silva", telefone: "5511999990001" },
    { id: 2, nome: "João da Silva", telefone: "5511999990002" },
  ];
  const decisao = decidirLinha(linhaValidaExemplo(), pacientes);
  assert.equal(decisao.tipo, "revisao");
  assert.equal(decisao.candidatos.length, 2);
});

test("decidirLinha: sem match → revisao com lista vazia de candidatos", () => {
  const decisao = decidirLinha(linhaValidaExemplo({ nome: "Ninguém Cadastrado" }), []);
  assert.equal(decisao.tipo, "revisao");
  assert.deepEqual(decisao.candidatos, []);
});

test("decidirLinha: hora inválida → divergência, não chega a comparar nome", () => {
  const decisao = decidirLinha(linhaValidaExemplo({ hora: "25:99" }), []);
  assert.deepEqual(decisao, {
    tipo: "divergencia",
    motivo: 'hora inválida ("25:99")',
    linha: linhaValidaExemplo({ hora: "25:99" }),
  });
});

test("decidirLinha: data ausente/inválida → divergência", () => {
  const decisao = decidirLinha(linhaValidaExemplo({ data: null }), []);
  assert.deepEqual(decisao, {
    tipo: "divergencia",
    motivo: "data inválida",
    linha: linhaValidaExemplo({ data: null }),
  });
});

test("buscarTodosPacientes consulta id/nome/telefone de todos os pacientes", async (t) => {
  const { pool } = await import("../src/db/pool.js");
  const { buscarTodosPacientes } = await import("../src/services/importacaoExcelHistoricoService.js");
  t.mock.method(pool, "query", async (sql) => {
    assert.match(sql, /SELECT id, nome, telefone FROM pacientes/);
    return { rows: [{ id: 1, nome: "João da Silva", telefone: "5511999990001" }] };
  });

  const pacientes = await buscarTodosPacientes();
  assert.deepEqual(pacientes, [{ id: 1, nome: "João da Silva", telefone: "5511999990001" }]);
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test test/importacaoExcelHistoricoService.test.js`
Expected: FAIL — `encontrarCandidatosPaciente is not a function` (e similares)

- [ ] **Step 3: Implementar**

Adicionar ao final de `src/services/importacaoExcelHistoricoService.js`:

```javascript
import { pool } from "../db/pool.js";

const REGEX_HORA_VALIDA = /^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;

export async function buscarTodosPacientes() {
  const { rows } = await pool.query("SELECT id, nome, telefone FROM pacientes");
  return rows;
}

export function encontrarCandidatosPaciente(nomeBuscado, pacientes) {
  const alvo = normalizarTexto(nomeBuscado);
  return pacientes.filter((paciente) => normalizarTexto(paciente.nome) === alvo);
}

function validarLinha(linha) {
  if (!linha.data) return "data inválida";
  if (!REGEX_HORA_VALIDA.test(linha.hora)) return `hora inválida ("${linha.hora}")`;
  return null;
}

/**
 * Decide o destino de uma linha: vínculo automático (nome bate com
 * exatamente um paciente já cadastrado), revisão manual (zero ou mais de
 * um candidato — nunca escolhe sozinho, ver spec "Escopo"), ou divergência
 * (data/hora inválida, nem chega a comparar nome).
 */
export function decidirLinha(linha, pacientes) {
  const erroValidacao = validarLinha(linha);
  if (erroValidacao) {
    return { tipo: "divergencia", motivo: erroValidacao, linha };
  }

  const candidatos = encontrarCandidatosPaciente(linha.nome, pacientes);
  if (candidatos.length === 1) {
    return { tipo: "auto_vinculo", paciente: candidatos[0], linha };
  }
  return { tipo: "revisao", candidatos, linha };
}
```

Mover o `import { pool } from "../db/pool.js";` pro topo do arquivo (junto dos outros imports), não repetir no meio do arquivo.

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test test/importacaoExcelHistoricoService.test.js`
Expected: PASS (todos os testes, incluindo os da Task 2)

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: sem erros

- [ ] **Step 6: Commit**

```bash
git add src/services/importacaoExcelHistoricoService.js test/importacaoExcelHistoricoService.test.js
git commit -m "feat: matching por nome exato normalizado (importação Excel histórico)"
```

---

## Task 4: Escrita do agendamento + presença (`aplicarLinhaResolvida`)

**Files:**
- Modify: `src/services/importacaoExcelHistoricoService.js`
- Modify: `test/importacaoExcelHistoricoService.test.js`

**Interfaces:**
- Consumes: `pool`; `registrarPresencaImportado` de `../models/registroAtendimentoModel.js` (já existe).
- Produces: `aplicarLinhaResolvida({ linha, telefone, usuarioImportacaoId }, { aplicar }): Promise<{ eventos: Array<{tipo: string, motivo?: string}> }>` — usado pela Task 6 (`planilhaRevisaoService.js`) e pela Task 7 (CLI).

- [ ] **Step 1: Escrever os testes (falhando)**

Adicionar ao final de `test/importacaoExcelHistoricoService.test.js`:

```javascript
import { aplicarLinhaResolvida } from "../src/services/importacaoExcelHistoricoService.js";

function linhaResolvidaExemplo(sobrescreve = {}) {
  return {
    nome: "Ana Clara Guabiraba Blumer",
    // Data fixa no passado, independente de quando o teste rodar de verdade.
    data: "2020-07-07",
    hora: "09:00",
    categoria: "Particular",
    tipo: "CP",
    temFicha: true,
    presenca: "compareceu",
    ...sobrescreve,
  };
}

test("aplicarLinhaResolvida: linha nova no passado, --aplicar grava agendamento e presença", async (t) => {
  const { pool } = await import("../src/db/pool.js");
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("SELECT id FROM agendamentos_importados")) return { rows: [] };
    if (sql.includes("INSERT INTO agendamentos_importados")) return { rows: [{ id: 77 }] };
    if (sql.includes("AS ja_passou")) return { rows: [{ id: 77, ja_passou: true }] };
    if (sql.includes("INSERT INTO registros_atendimento")) return { rows: [{ id: 1, presenca: "compareceu" }] };
    return { rows: [] };
  });

  const resultado = await aplicarLinhaResolvida(
    { linha: linhaResolvidaExemplo(), telefone: "5511999990001", usuarioImportacaoId: 9 },
    { aplicar: true }
  );

  assert.deepEqual(
    resultado.eventos.map((e) => e.tipo),
    ["agendamento_novo", "presenca_registrada"]
  );

  const insert = chamadas.find((c) => c.sql.includes("INSERT INTO agendamentos_importados"));
  assert.deepEqual(insert.params, [
    "5511999990001",
    "Ana Clara Guabiraba Blumer",
    "2020-07-07",
    "09:00",
    "Particular",
    "CP",
    true,
  ]);
});

test("aplicarLinhaResolvida: data futura preenche lembrete_2h_enviado_em no próprio insert", async (t) => {
  const { pool } = await import("../src/db/pool.js");
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("SELECT id FROM agendamentos_importados")) return { rows: [] };
    if (sql.includes("INSERT INTO agendamentos_importados")) return { rows: [{ id: 78 }] };
    return { rows: [] };
  });

  await aplicarLinhaResolvida(
    { linha: linhaResolvidaExemplo({ data: "2099-01-01", presenca: null }), telefone: "5511999990001", usuarioImportacaoId: 9 },
    { aplicar: true }
  );

  const insert = chamadas.find((c) => c.sql.includes("INSERT INTO agendamentos_importados"));
  assert.ok(
    insert.sql.includes("CASE WHEN $3::date > CURRENT_DATE THEN now() ELSE NULL END"),
    "a supressão de lembrete precisa acontecer no próprio INSERT, sem passo separado (ver spec)"
  );
});

test("aplicarLinhaResolvida: dry-run não grava nada", async (t) => {
  const { pool } = await import("../src/db/pool.js");
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("SELECT id FROM agendamentos_importados")) return { rows: [] };
    return { rows: [] };
  });

  const resultado = await aplicarLinhaResolvida(
    { linha: linhaResolvidaExemplo(), telefone: "5511999990001", usuarioImportacaoId: 9 },
    { aplicar: false }
  );

  assert.deepEqual(resultado.eventos.map((e) => e.tipo), ["agendamento_novo"]);
  assert.ok(chamadas.every((c) => c.sql.trim().toUpperCase().startsWith("SELECT")));
});

test("aplicarLinhaResolvida: agendamento já existe → não insere de novo, mas ainda registra presença", async (t) => {
  const { pool } = await import("../src/db/pool.js");
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("SELECT id FROM agendamentos_importados")) return { rows: [{ id: 55 }] };
    if (sql.includes("AS ja_passou")) return { rows: [{ id: 55, ja_passou: true }] };
    if (sql.includes("INSERT INTO registros_atendimento")) return { rows: [{ id: 2, presenca: "compareceu" }] };
    return { rows: [] };
  });

  const resultado = await aplicarLinhaResolvida(
    { linha: linhaResolvidaExemplo(), telefone: "5511999990001", usuarioImportacaoId: 9 },
    { aplicar: true }
  );

  assert.deepEqual(resultado.eventos.map((e) => e.tipo), ["agendamento_ja_existe", "presenca_registrada"]);
  assert.ok(!chamadas.some((c) => c.sql.includes("INSERT INTO agendamentos_importados")));
});

test("aplicarLinhaResolvida: sem presença informada não chama registrarPresencaImportado", async (t) => {
  const { pool } = await import("../src/db/pool.js");
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("SELECT id FROM agendamentos_importados")) return { rows: [] };
    if (sql.includes("INSERT INTO agendamentos_importados")) return { rows: [{ id: 80 }] };
    return { rows: [] };
  });

  const resultado = await aplicarLinhaResolvida(
    { linha: linhaResolvidaExemplo({ presenca: null }), telefone: "5511999990001", usuarioImportacaoId: 9 },
    { aplicar: true }
  );

  assert.deepEqual(resultado.eventos.map((e) => e.tipo), ["agendamento_novo"]);
  assert.ok(!chamadas.some((c) => c.sql.includes("INSERT INTO registros_atendimento")));
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test test/importacaoExcelHistoricoService.test.js`
Expected: FAIL — `aplicarLinhaResolvida is not a function`

- [ ] **Step 3: Implementar**

Adicionar ao final de `src/services/importacaoExcelHistoricoService.js`:

```javascript
import { registrarPresencaImportado } from "../models/registroAtendimentoModel.js";

/**
 * Grava (ou confirma que já existe) o agendamento importado, e registra
 * presença quando `linha.presenca` está resolvida. A supressão de lembrete
 * pra data futura acontece dentro do próprio INSERT (`CASE WHEN`), nunca
 * como passo separado depois — decisão da spec, pra não depender de
 * comparar timestamp e arriscar esquecer o passo.
 */
export async function aplicarLinhaResolvida({ linha, telefone, usuarioImportacaoId }, { aplicar }) {
  const eventos = [];

  const { rows: existentes } = await pool.query(
    `SELECT id FROM agendamentos_importados WHERE telefone = $1 AND data = $2 AND hora = $3 AND nome = $4`,
    [telefone, linha.data, linha.hora, linha.nome]
  );

  let agendamentoImportadoId = existentes[0]?.id ?? null;

  if (agendamentoImportadoId) {
    eventos.push({ tipo: "agendamento_ja_existe" });
  } else {
    eventos.push({ tipo: "agendamento_novo" });
    if (aplicar) {
      const { rows } = await pool.query(
        `INSERT INTO agendamentos_importados
           (telefone, nome, data, hora, tipo_atendimento, convenio, tipo, tem_ficha, lembrete_2h_enviado_em)
         VALUES ($1, $2, $3, $4, 'fisioterapia', $5, $6, $7,
           CASE WHEN $3::date > CURRENT_DATE THEN now() ELSE NULL END)
         ON CONFLICT (regexp_replace(telefone, '\\D', '', 'g'), data, hora, nome) DO NOTHING
         RETURNING id`,
        [telefone, linha.nome, linha.data, linha.hora, linha.categoria, linha.tipo, linha.temFicha]
      );
      agendamentoImportadoId = rows[0]?.id ?? null;
    }
  }

  if (aplicar && agendamentoImportadoId && linha.presenca) {
    const resultado = await registrarPresencaImportado({
      agendamentoImportadoId,
      presenca: linha.presenca,
      observacaoSessao: null,
      registradoPor: usuarioImportacaoId,
    });
    eventos.push(
      resultado.registro
        ? { tipo: "presenca_registrada" }
        : { tipo: "presenca_nao_registrada", motivo: resultado.motivo }
    );
  }

  return { eventos };
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test test/importacaoExcelHistoricoService.test.js`
Expected: PASS (todos)

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: sem erros

- [ ] **Step 6: Commit**

```bash
git add src/services/importacaoExcelHistoricoService.js test/importacaoExcelHistoricoService.test.js
git commit -m "feat: grava agendamento importado + presença com lembrete suprimido no insert"
```

---

## Task 5: Gerar a planilha de revisão (`gerarPlanilhaRevisao`)

**Files:**
- Create: `src/services/planilhaRevisaoService.js`
- Test: `test/planilhaRevisaoService.test.js`

**Interfaces:**
- Consumes: `formatarTelefoneExibicao` de `../utils/phone.js` (já existe).
- Produces: `gerarPlanilhaRevisao(pendencias: Array<{linha, candidatos: Array<{id,nome,telefone}>, motivo?: string}>, caminhoSaida: string): void` — usado pela Task 7 (CLI).

- [ ] **Step 1: Escrever os testes (falhando)**

```javascript
// test/planilhaRevisaoService.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import XLSX from "xlsx";
import { gerarPlanilhaRevisao } from "../src/services/planilhaRevisaoService.js";

test("gerarPlanilhaRevisao escreve uma linha por pendência, com candidatos formatados", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "planilha-revisao-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const caminho = join(dir, "revisao.xlsx");

  gerarPlanilhaRevisao(
    [
      {
        linha: { nome: "Ana Clara", data: "2026-07-07", hora: "09:00", categoria: "Particular", tipo: "CP" },
        candidatos: [
          { id: 1, nome: "Ana Clara", telefone: "5511999990001" },
          { id: 2, nome: "Ana Clara", telefone: "5511999990002" },
        ],
      },
      {
        linha: { nome: "Paciente Novo", data: "2026-07-08", hora: "10:00", categoria: null, tipo: "F" },
        candidatos: [],
      },
    ],
    caminho
  );

  const workbook = XLSX.readFile(caminho);
  const linhas = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });

  assert.equal(linhas.length, 2);
  assert.equal(linhas[0].Nome, "Ana Clara");
  assert.match(linhas[0].Candidatos, /#1 Ana Clara/);
  assert.match(linhas[0].Candidatos, /#2 Ana Clara/);
  assert.equal(linhas[0].Motivo, "2 pacientes cadastrados com esse nome");
  assert.equal(linhas[1].Motivo, "nenhum paciente cadastrado com esse nome");
  assert.equal(linhas[0].decisao, "");
  assert.equal(linhas[0].telefone_novo, "");
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/planilhaRevisaoService.test.js`
Expected: FAIL — `Cannot find module '../src/services/planilhaRevisaoService.js'`

- [ ] **Step 3: Implementar**

```javascript
// src/services/planilhaRevisaoService.js
import XLSX from "xlsx";
import { formatarTelefoneExibicao } from "../utils/phone.js";

/**
 * Gera a planilha que a recepção preenche pra resolver os casos que o
 * matching automático (por nome exato) não conseguiu decidir sozinho —
 * nunca escolhe um candidato por conta própria (ver spec "Escopo").
 */
export function gerarPlanilhaRevisao(pendencias, caminhoSaida) {
  const linhas = pendencias.map(({ linha, candidatos = [], motivo }) => ({
    Nome: linha.nome,
    Data: linha.data ?? "",
    Hora: linha.hora ?? "",
    Convenio: linha.categoria ?? "",
    "Tipo visita": linha.tipo ?? "",
    Motivo:
      motivo ??
      (candidatos.length === 0
        ? "nenhum paciente cadastrado com esse nome"
        : `${candidatos.length} pacientes cadastrados com esse nome`),
    Candidatos: candidatos
      .map((c) => `#${c.id} ${c.nome} (${formatarTelefoneExibicao(c.telefone)})`)
      .join(" | "),
    decisao: "",
    telefone_novo: "",
    observacao: "",
  }));

  const planilha = XLSX.utils.json_to_sheet(linhas);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, planilha, "Revisão");
  XLSX.writeFile(workbook, caminhoSaida);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/planilhaRevisaoService.test.js`
Expected: PASS

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: sem erros

- [ ] **Step 6: Commit**

```bash
git add src/services/planilhaRevisaoService.js test/planilhaRevisaoService.test.js
git commit -m "feat: gera planilha de revisão manual pra recepção"
```

---

## Task 6: Aplicar a planilha revisada (`aplicarPlanilhaRevisada`)

**Files:**
- Modify: `src/services/planilhaRevisaoService.js`
- Modify: `test/planilhaRevisaoService.test.js`

**Interfaces:**
- Consumes: `aplicarLinhaResolvida` (Task 4); `encontrarOuCriarPaciente` de `../models/pacienteModel.js` (já existe); `normalizarTelefone` de `../utils/phone.js` (já existe); `pool`.
- Produces: `aplicarPlanilhaRevisada(caminhoPlanilha: string, { aplicar, usuarioImportacaoId }): Promise<{ eventos: [], naoImportadas: Array<{nome, motivo}> }>` — usado pela Task 7 (CLI).

- [ ] **Step 1: Escrever os testes (falhando)**

Adicionar ao final de `test/planilhaRevisaoService.test.js`:

```javascript
import { aplicarPlanilhaRevisada } from "../src/services/planilhaRevisaoService.js";

function escreverPlanilhaRevisada(caminho, linhas) {
  const planilha = XLSX.utils.json_to_sheet(linhas);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, planilha, "Revisão");
  XLSX.writeFile(workbook, caminho);
}

test("aplicarPlanilhaRevisada: decisão com ID existente vincula ao paciente já cadastrado", async (t) => {
  const { pool } = await import("../src/db/pool.js");
  const dir = await mkdtemp(join(tmpdir(), "planilha-aplicada-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const caminho = join(dir, "revisao.xlsx");

  escreverPlanilhaRevisada(caminho, [
    {
      Nome: "Ana Clara",
      Data: "2020-07-07",
      Hora: "09:00",
      Convenio: "Particular",
      "Tipo visita": "CP",
      decisao: "5",
      telefone_novo: "",
      observacao: "",
    },
  ]);

  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("SELECT telefone FROM pacientes")) return { rows: [{ telefone: "5511999990009" }] };
    if (sql.includes("SELECT id FROM agendamentos_importados")) return { rows: [] };
    if (sql.includes("INSERT INTO agendamentos_importados")) return { rows: [{ id: 90 }] };
    return { rows: [] };
  });

  const resultado = await aplicarPlanilhaRevisada(caminho, { aplicar: true, usuarioImportacaoId: 9 });

  assert.deepEqual(resultado.eventos.map((e) => e.tipo), ["agendamento_novo"]);
  const insert = chamadas.find((c) => c.sql.includes("INSERT INTO agendamentos_importados"));
  assert.equal(insert.params[0], "5511999990009");
});

test("aplicarPlanilhaRevisada: decisão NOVO com telefone cria paciente e agendamento", async (t) => {
  const { pool } = await import("../src/db/pool.js");
  const dir = await mkdtemp(join(tmpdir(), "planilha-aplicada-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const caminho = join(dir, "revisao.xlsx");

  escreverPlanilhaRevisada(caminho, [
    {
      Nome: "Paciente Novo De Verdade",
      Data: "2020-07-07",
      Hora: "09:00",
      Convenio: "Particular",
      "Tipo visita": "CP",
      decisao: "NOVO",
      telefone_novo: "11988887777",
      observacao: "",
    },
  ]);

  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("SELECT * FROM pacientes WHERE telefone")) return { rows: [] };
    if (sql.includes("INSERT INTO pacientes")) {
      return { rows: [{ id: 200, nome: "Paciente Novo De Verdade", telefone: "11988887777" }] };
    }
    if (sql.includes("SELECT id FROM agendamentos_importados")) return { rows: [] };
    if (sql.includes("INSERT INTO agendamentos_importados")) return { rows: [{ id: 91 }] };
    return { rows: [] };
  });

  const resultado = await aplicarPlanilhaRevisada(caminho, { aplicar: true, usuarioImportacaoId: 9 });

  assert.deepEqual(resultado.eventos.map((e) => e.tipo), ["agendamento_novo"]);
  assert.ok(chamadas.some((c) => c.sql.includes("INSERT INTO pacientes")), "deveria ter criado o paciente novo");
});

test("aplicarPlanilhaRevisada: NOVO sem telefone não grava nada, entra em naoImportadas", async (t) => {
  const { pool } = await import("../src/db/pool.js");
  const dir = await mkdtemp(join(tmpdir(), "planilha-aplicada-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const caminho = join(dir, "revisao.xlsx");

  escreverPlanilhaRevisada(caminho, [
    { Nome: "Sem Telefone", Data: "2020-07-07", Hora: "09:00", Convenio: "", "Tipo visita": "", decisao: "NOVO", telefone_novo: "", observacao: "" },
  ]);

  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [] };
  });

  const resultado = await aplicarPlanilhaRevisada(caminho, { aplicar: true, usuarioImportacaoId: 9 });

  assert.equal(chamadas.length, 0);
  assert.deepEqual(resultado.naoImportadas, [{ nome: "Sem Telefone", motivo: "NOVO sem telefone informado" }]);
});

test("aplicarPlanilhaRevisada: decisão em branco ou IGNORAR não grava nada", async (t) => {
  const { pool } = await import("../src/db/pool.js");
  const dir = await mkdtemp(join(tmpdir(), "planilha-aplicada-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const caminho = join(dir, "revisao.xlsx");

  escreverPlanilhaRevisada(caminho, [
    { Nome: "Ignorado", Data: "2020-07-07", Hora: "09:00", Convenio: "", "Tipo visita": "", decisao: "IGNORAR", telefone_novo: "", observacao: "" },
    { Nome: "Em Branco", Data: "2020-07-07", Hora: "09:00", Convenio: "", "Tipo visita": "", decisao: "", telefone_novo: "", observacao: "" },
  ]);

  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [] };
  });

  const resultado = await aplicarPlanilhaRevisada(caminho, { aplicar: true, usuarioImportacaoId: 9 });

  assert.equal(chamadas.length, 0);
  assert.equal(resultado.naoImportadas.length, 2);
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `node --test test/planilhaRevisaoService.test.js`
Expected: FAIL — `aplicarPlanilhaRevisada is not a function`

- [ ] **Step 3: Implementar**

Adicionar ao topo e ao final de `src/services/planilhaRevisaoService.js`:

```javascript
import { pool } from "../db/pool.js";
import { encontrarOuCriarPaciente } from "../models/pacienteModel.js";
import { normalizarTelefone } from "../utils/phone.js";
import { aplicarLinhaResolvida } from "./importacaoExcelHistoricoService.js";

/**
 * Lê a planilha de revisão já preenchida pela recepção e aplica cada
 * decisão. Nunca cria paciente sem telefone informado manualmente —
 * `pacientes.telefone` é `NOT NULL UNIQUE`, essa fonte de dados não traz
 * telefone nenhum (ver spec "Modelo de dados").
 */
export async function aplicarPlanilhaRevisada(caminhoPlanilha, { aplicar, usuarioImportacaoId }) {
  const workbook = XLSX.readFile(caminhoPlanilha);
  const linhasPlanilha = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });

  const eventos = [];
  const naoImportadas = [];

  for (const linhaPlanilha of linhasPlanilha) {
    const decisao = String(linhaPlanilha.decisao ?? "").trim();
    const linha = {
      nome: String(linhaPlanilha.Nome ?? "").trim(),
      data: String(linhaPlanilha.Data ?? "").trim(),
      hora: String(linhaPlanilha.Hora ?? "").trim(),
      categoria: String(linhaPlanilha.Convenio ?? "").trim() || null,
      tipo: String(linhaPlanilha["Tipo visita"] ?? "").trim() || null,
      temFicha: null,
      presenca: null,
    };

    if (!decisao || decisao.toUpperCase() === "IGNORAR") {
      naoImportadas.push({ nome: linha.nome, motivo: "sem decisão da recepção" });
      continue;
    }

    let telefone;
    if (decisao.toUpperCase() === "NOVO") {
      const telefoneNovo = normalizarTelefone(String(linhaPlanilha.telefone_novo ?? ""));
      if (!telefoneNovo) {
        naoImportadas.push({ nome: linha.nome, motivo: "NOVO sem telefone informado" });
        continue;
      }
      telefone = telefoneNovo;
      if (aplicar) {
        await encontrarOuCriarPaciente({ nome: linha.nome, telefone, convenio: linha.categoria });
      }
    } else {
      const idPaciente = Number(decisao);
      if (!Number.isInteger(idPaciente)) {
        naoImportadas.push({ nome: linha.nome, motivo: `decisão inválida ("${decisao}")` });
        continue;
      }
      const { rows } = await pool.query("SELECT telefone FROM pacientes WHERE id = $1", [idPaciente]);
      if (!rows[0]) {
        naoImportadas.push({ nome: linha.nome, motivo: `paciente #${idPaciente} não encontrado` });
        continue;
      }
      telefone = rows[0].telefone;
    }

    const resultado = await aplicarLinhaResolvida({ linha, telefone, usuarioImportacaoId }, { aplicar });
    eventos.push(...resultado.eventos);
  }

  return { eventos, naoImportadas };
}
```

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `node --test test/planilhaRevisaoService.test.js`
Expected: PASS (todos)

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: sem erros

- [ ] **Step 6: Commit**

```bash
git add src/services/planilhaRevisaoService.js test/planilhaRevisaoService.test.js
git commit -m "feat: aplica decisões da planilha de revisão preenchida pela recepção"
```

---

## Task 7: Script CLI de orquestração

**Files:**
- Create: `src/db/importarExcelHistorico.js`

**Interfaces:**
- Consumes: `parsearArquivoExcel`, `buscarTodosPacientes`, `decidirLinha`, `aplicarLinhaResolvida` (Tasks 2-4); `gerarPlanilhaRevisao`, `aplicarPlanilhaRevisada` (Tasks 5-6); `buscarUsuarioPorEmail` de `../models/usuarioModel.js` (já existe); `pool`.
- Produces: comando de linha de comando `node src/db/importarExcelHistorico.js`. Sem teste automatizado dedicado — mesmo padrão do `migrarSistemaAnterior.js` existente (CLI fino, toda a lógica testável já está nos services).

- [ ] **Step 1: Implementar o script**

```javascript
// src/db/importarExcelHistorico.js
// Importa o relatório histórico de 3 meses do sistema de agenda anterior (Excel .xlsx,
// sem telefone/CPF/atendente — ver spec
// docs/superpowers/specs/2026-09-01-importacao-excel-historico-3meses-design.md).
// Só faz INSERT/UPDATE/SELECT direto via pool — nunca chama aiService/
// chatService/webhook/calendarService.
//
// Script 1 (gerar planilha de revisão pra quem não tem match único de nome,
// sempre dry-run):
//   node src/db/importarExcelHistorico.js --arquivo <relatorio.xlsx>
//
// Script 2 (aplicar de verdade — auto-vínculo, e opcionalmente a planilha
// já revisada pela recepção):
//   node src/db/importarExcelHistorico.js --arquivo <relatorio.xlsx> --aplicar
//     [--planilha-revisada <revisao-preenchida.xlsx>]

import "dotenv/config";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parsearArquivoExcel,
  buscarTodosPacientes,
  decidirLinha,
  aplicarLinhaResolvida,
} from "../services/importacaoExcelHistoricoService.js";
import { gerarPlanilhaRevisao, aplicarPlanilhaRevisada } from "../services/planilhaRevisaoService.js";
import { buscarUsuarioPorEmail } from "../models/usuarioModel.js";
import { pool } from "./pool.js";

const EMAIL_USUARIO_IMPORTACAO = "importacao@clinicaexemplo.local";

const args = process.argv.slice(2);
const aplicar = args.includes("--aplicar");
const indiceArquivo = args.indexOf("--arquivo");
const arquivo = indiceArquivo !== -1 ? args[indiceArquivo + 1] : null;
const indicePlanilha = args.indexOf("--planilha-revisada");
const planilhaRevisada = indicePlanilha !== -1 ? args[indicePlanilha + 1] : null;

if (!arquivo) {
  console.error(
    "Uso: node src/db/importarExcelHistorico.js --arquivo <relatorio.xlsx> [--aplicar] [--planilha-revisada <arquivo>]"
  );
  process.exit(1);
}

let usuarioImportacaoId = null;
if (aplicar) {
  const usuario = await buscarUsuarioPorEmail(EMAIL_USUARIO_IMPORTACAO);
  if (!usuario) {
    console.error(
      `Usuário genérico "${EMAIL_USUARIO_IMPORTACAO}" não encontrado. Crie antes com:\n` +
        `node src/db/criar-primeiro-usuario.js "Importação" ${EMAIL_USUARIO_IMPORTACAO} "<senha forte>"`
    );
    process.exit(1);
  }
  usuarioImportacaoId = usuario.id;
}

const linhas = parsearArquivoExcel(arquivo);
const pacientes = await buscarTodosPacientes();

const relatorio = {
  agendamentosNovos: 0,
  agendamentosJaExistentes: 0,
  presencasRegistradas: 0,
  divergencias: [],
  pendentesRevisao: [],
};

for (const linha of linhas) {
  const decisao = decidirLinha(linha, pacientes);

  if (decisao.tipo === "divergencia") {
    relatorio.divergencias.push({ nome: linha.nome, motivo: decisao.motivo });
    continue;
  }

  if (decisao.tipo === "revisao") {
    relatorio.pendentesRevisao.push({ linha: decisao.linha, candidatos: decisao.candidatos });
    continue;
  }

  const { eventos } = await aplicarLinhaResolvida(
    { linha: decisao.linha, telefone: decisao.paciente.telefone, usuarioImportacaoId },
    { aplicar }
  );
  for (const evento of eventos) {
    if (evento.tipo === "agendamento_novo") relatorio.agendamentosNovos++;
    else if (evento.tipo === "agendamento_ja_existe") relatorio.agendamentosJaExistentes++;
    else if (evento.tipo === "presenca_registrada") relatorio.presencasRegistradas++;
  }
}

if (relatorio.pendentesRevisao.length > 0) {
  const caminhoPlanilha = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "planilha-revisao-pendente.xlsx");
  gerarPlanilhaRevisao(relatorio.pendentesRevisao, caminhoPlanilha);
  console.log(`Planilha de revisão gerada em: ${caminhoPlanilha}`);
}

let resultadoPlanilhaAplicada = null;
if (aplicar && planilhaRevisada) {
  resultadoPlanilhaAplicada = await aplicarPlanilhaRevisada(planilhaRevisada, { aplicar, usuarioImportacaoId });
}

console.log(
  aplicar ? "=== IMPORTAÇÃO APLICADA ===" : "=== DRY-RUN (nada foi gravado — use --aplicar pra gravar de verdade) ==="
);
console.log(`Arquivo: ${arquivo}`);
console.log(`Agendamentos novos (auto-vínculo): ${relatorio.agendamentosNovos}`);
console.log(`Agendamentos já existentes: ${relatorio.agendamentosJaExistentes}`);
console.log(`Registros de presença gravados: ${relatorio.presencasRegistradas}`);
console.log(`Divergências (data/hora inválida): ${relatorio.divergencias.length}`);
for (const divergencia of relatorio.divergencias) {
  console.log(`  - ${divergencia.nome}: ${divergencia.motivo}`);
}
console.log(`Pendentes de revisão manual: ${relatorio.pendentesRevisao.length}`);
if (resultadoPlanilhaAplicada) {
  console.log(`--- Planilha revisada aplicada ---`);
  console.log(`Eventos: ${resultadoPlanilhaAplicada.eventos.length}`);
  console.log(`Não importadas: ${resultadoPlanilhaAplicada.naoImportadas.length}`);
  for (const naoImportada of resultadoPlanilhaAplicada.naoImportadas) {
    console.log(`  - ${naoImportada.nome}: ${naoImportada.motivo}`);
  }
}

await pool.end();
```

- [ ] **Step 2: Verificação manual com um arquivo de teste pequeno (não é o relatório real, e sem `--aplicar`)**

Criar um `.xlsx` de teste com 2-3 linhas (mesmas colunas do relatório real) num diretório fora do repo, e rodar:

Run: `node src/db/importarExcelHistorico.js --arquivo /caminho/para/teste-pequeno.xlsx`
Expected: imprime o resumo (dry-run), sem erro. Nota: mesmo em dry-run, `buscarTodosPacientes` faz uma leitura real (só `SELECT`) contra o banco de produção — não escreve nada, mas precisa de `DATABASE_URL` válido no `.env` local.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: sem erros

- [ ] **Step 4: Commit**

```bash
git add src/db/importarExcelHistorico.js
git commit -m "feat: script CLI de orquestração da importação Excel histórica"
```

---

## Task 8: Documentação + checklist de produção (requer autorização explícita)

**Files:**
- Modify: `OPERACAO.md`

**Interfaces:**
- Consumes: nada de código.
- Produces: documentação atualizada + checklist manual. **Nenhum destes passos é executado automaticamente por este plano** — cada um exige autorização explícita do usuário nesta sessão antes de rodar.

- [ ] **Step 1: Adicionar seção em `OPERACAO.md`**

Adicionar logo depois da seção existente "Lembretes automáticos pausados para os agendamentos importados do sistema antigo":

```markdown
### Importação do relatório de 3 meses (Excel, 01/07 a 30/09/2026)

Além da importação de 27/08/2026 (exports diários `Agenda_Manha/Tarde`), foi
importado também um relatório histórico de 3 meses que a clínica exportou
do sistema de agenda anterior em Excel (formato diferente, sem telefone/CPF —
identificação dos pacientes feita só por nome, com revisão manual da
recepção para os casos ambíguos). Mesmo procedimento de segurança: os
lembretes automáticos de 2h-antes ficaram desligados só para os
agendamentos futuros dessa importação. A reativação usa o mesmo comando SQL
já documentado acima (mesma tabela, mesma condição) — não é preciso rodar
nada diferente.
```

- [ ] **Step 2: Commit da documentação**

```bash
git add OPERACAO.md
git commit -m "docs: registra a importação do relatório Excel de 3 meses em OPERACAO.md"
```

- [ ] **Step 3: Checklist de produção — NÃO EXECUTAR sem autorização explícita do usuário nesta sessão, um item de cada vez**

1. Aplicar a migration 015 no Neon (mesmo processo já usado nas migrations anteriores — SQL Editor do Neon ou `psql`).
2. Criar o usuário genérico "Importação":
   ```bash
   node src/db/criar-primeiro-usuario.js "Importação" importacao@clinicaexemplo.local "<senha forte gerada>"
   ```
3. Confirmar com a clínica (a tia do usuário) o significado real de `Tipo visita` (`CP`/`F`/`D`) — não bloqueia a importação (o dado já é gravado bruto), mas vale registrar a resposta depois, quando ela confirmar.
4. Rodar o Script 1 (dry-run) contra o relatório real:
   ```bash
   node src/db/importarExcelHistorico.js --arquivo <caminho do relatório real .xlsx>
   ```
   Revisar o resumo impresso e a planilha `planilha-revisao-pendente.xlsx` gerada.
5. Entregar a planilha pra recepção preencher (`decisao`, `telefone_novo` quando for `NOVO`, `observacao` livre).
6. Rodar o Script 2 com `--aplicar` (e `--planilha-revisada` apontando pra planilha já devolvida pela recepção):
   ```bash
   node src/db/importarExcelHistorico.js --arquivo <relatorio.xlsx> --aplicar --planilha-revisada <planilha-devolvida.xlsx>
   ```
   Isso só roda contra produção de verdade — confirmar com o usuário imediatamente antes de executar.

---

## Self-Review (executado ao escrever este plano)

**Cobertura da spec:** parser isolado (Task 2), matching só por nome exato (Task 3), planilha de revisão em dois scripts (Tasks 5-6), supressão de lembrete no próprio insert (Task 4), `Status Ficha`→presença e `Ficha`→`tem_ficha` (Tasks 2 e 4), `Cadastrou` fica só no arquivo original (nenhuma task grava esse campo — confirmado, nenhuma referência a "Cadastrou" em nenhum INSERT), usuário genérico "Importação" (Task 7 busca por email, Task 8 cria de verdade), `Tipo visita` gravado bruto sem interpretação (Task 2/4, nenhuma lógica ramifica sobre `linha.tipo`). Isolamento do bot: nenhuma task importa `aiService`/`chatService`/`calendarService`/rotas de webhook — confirmado em todos os arquivos criados/modificados.

**Placeholders:** nenhum "TBD"/"implementar depois" — todo step tem código completo ou comando exato.

**Consistência de tipos:** `parsearArquivoExcel` retorna `{nome, data, hora, categoria, tipo, temFicha, presenca}` (Task 2) — usado exatamente com esses nomes de campo em `decidirLinha` (Task 3), `aplicarLinhaResolvida` (Task 4) e na reconstrução de `linha` em `aplicarPlanilhaRevisada` (Task 6). `aplicarLinhaResolvida` sempre recebe `{linha, telefone, usuarioImportacaoId}` nas duas chamadas (Task 7 e Task 6). Eventos usam os mesmos nomes de `tipo` em todo lugar que os consome (`agendamento_novo`, `agendamento_ja_existe`, `presenca_registrada`, `presenca_nao_registrada`).
