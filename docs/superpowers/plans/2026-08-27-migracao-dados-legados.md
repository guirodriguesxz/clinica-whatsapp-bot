# Migração de dados legados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Popular `pacientes`/`agendamentos_importados` com os dados reais que hoje só existem no sistema de agenda anterior, a partir dos exports de agenda (`Agenda_Manha/Tarde_DD-MM-YYYY.xml`), via um script standalone, idempotente, com relatório de divergências para revisão humana antes de gravar.

**Architecture:** Um script CLI (`src/db/migrarSistemaAnterior.js`, mesmo padrão de `criar-primeiro-usuario.js`) chama um serviço novo (`src/services/importacaoLegadoService.js`) que faz parse do XML e decide criar/atualizar/pular cada linha direto no Postgres via `pool`. Dry-run por padrão; grava só com `--apply`. Zero acoplamento com `aiService`/`chatService`/webhook/`calendarService` — o script nunca aciona nada do bot.

**Tech Stack:** Node.js 20+ (ESM), Postgres (`pg`, `pool` já existente), `node --test` para os testes. Nenhuma dependência nova (parser XML escrito à mão — formato fixo e simples o suficiente pra não justificar uma lib).

**Spec:** [docs/superpowers/specs/2026-08-27-migracao-dados-legados-design.md](../specs/2026-08-27-migracao-dados-legados-design.md) — ver também a arquitetura macro em [docs/superpowers/specs/2026-08-27-sistema-clinica-arquitetura-macro-design.md](../specs/2026-08-27-sistema-clinica-arquitetura-macro-design.md).

## Global Constraints

- ESM apenas (`import`/`export`, nunca `require`).
- Testes com `node --test` (nenhum framework novo), seguindo o padrão de mockar `pool.query` diretamente com `t.mock.method` (ver `test/dashboardController.test.js`) — nunca mockar um model via `import *` (propriedades de namespace de módulo não são configuráveis).
- **Isolamento obrigatório do bot**: nenhum arquivo deste sub-projeto importa `aiService.js`, `chatService.js`, controllers de webhook, ou `calendarService.js`/`googleCalendar.js`. Só `pool` (`src/db/pool.js`), `normalizarTelefone` (`src/utils/phone.js`) e `CONVENIOS_FISIOTERAPIA` (`src/config/clinica.js`).
- Sempre normalizar telefone com `normalizarTelefone` antes de comparar ou gravar — nunca comparar telefone cru.
- Nunca sobrescrever `cpf`/`data_nascimento` de um paciente que já os tem preenchidos.
- `tipo_atendimento` é sempre `'fisioterapia'` fixo nos agendamentos inseridos por este script (sistema de agenda anterior só atende Fisioterapia — por isso a comparação de convênio usa `CONVENIOS_FISIOTERAPIA`, não `CONVENIOS_PSICOLOGIA`).
- Dry-run é o comportamento padrão do script — só grava no banco com a flag `--apply` explícita.
- Divergência de telefone ausente ou hora inválida **bloqueia a escrita** daquela linha (paciente e agendamento). Convênio não reconhecido é só **aviso** — grava normalmente, só entra no relatório pra revisão manual (nunca tenta adivinhar a normalização certa sozinho).
- Migrations continuam sendo aplicadas manualmente (`psql "$DATABASE_URL" -f ...` ou SQL Editor do Neon) — não existe runner automático neste projeto.
- Comentários só quando o "porquê" não é óbvio, seguindo o padrão já observado no código atual.

---

## Task 1: Migration `010_migracao_legado.sql`

**Files:**
- Create: `src/db/migrations/010_migracao_legado.sql`

**Interfaces:**
- Produces: colunas `pacientes.cpf` (TEXT), `pacientes.data_nascimento` (DATE); colunas `agendamentos_importados.tipo`/`obs`/`flag_f`/`flag_c`/`flag_e`/`chegou` (todas TEXT); índice único `idx_agendamentos_importados_unico`. Consumidas por `importacaoLegadoService.js` (Tasks 3–8).

- [ ] **Step 1: Checar colisão antes de criar o índice único**

Antes de aplicar a migration, rodar contra o banco de desenvolvimento (o índice
único vai falhar na criação se já existir uma colisão entre agendamentos
manuais já existentes):

```bash
psql "$DATABASE_URL" -c "
  SELECT regexp_replace(telefone, '\D', '', 'g') AS telefone_normalizado, data, hora, nome, count(*)
  FROM agendamentos_importados
  GROUP BY 1, 2, 3, 4
  HAVING count(*) > 1;
"
```

Expected: 0 linhas. **Se aparecer alguma linha, não apague nada de cara** —
confira se de fato é o mesmo agendamento inserido duas vezes (mesma pessoa)
ou duas pessoas reais diferentes que dividem telefone e coincidiram no
mesmo horário (nesse caso `nome` já diferencia as duas e a linha não deveria
aparecer aqui — se apareceu com `nome` igual também, aí sim é duplicata de
verdade e pode ser resolvida apagando uma cópia). Não seguir para o Step 2
com uma colisão real pendente.

- [ ] **Step 2: Escrever a migration**

```sql
-- Clínica Exemplo Bot — migration 010: migração de dados legados do sistema de agenda anterior.
-- Rodar no SQL Editor do Neon (ou via psql) depois de 009_usuarios_dashboard.sql
-- e 009_remetente_equipe.sql. Pré-requisito: rodar a checagem de colisão do
-- Step 1 do plano antes de aplicar esta migration.

ALTER TABLE pacientes
  ADD COLUMN IF NOT EXISTS cpf TEXT,
  ADD COLUMN IF NOT EXISTS data_nascimento DATE;

-- Campos do export do sistema de agenda anterior sem uso definido no código ainda —
-- guardados brutos (TEXT, sem conversão) pra não perder dado que a clínica
-- já tem, mesmo sem saber ainda pra que serve cada um (ver spec do
-- sub-projeto, seção "Escopo").
ALTER TABLE agendamentos_importados
  ADD COLUMN IF NOT EXISTS tipo TEXT,
  ADD COLUMN IF NOT EXISTS obs TEXT,
  ADD COLUMN IF NOT EXISTS flag_f TEXT,
  ADD COLUMN IF NOT EXISTS flag_c TEXT,
  ADD COLUMN IF NOT EXISTS flag_e TEXT,
  ADD COLUMN IF NOT EXISTS chegou TEXT;

-- Garante idempotência real: rodar o script de migração duas vezes sobre o
-- mesmo lote (ou um lote que se sobreponha) não duplica agendamento nenhum.
-- Inclui `nome` na chave: o mesmo telefone pode pertencer a mais de um
-- paciente (ex: família dividindo número) — telefone+data+hora sozinho
-- colidiria incorretamente entre duas pessoas reais com horário no mesmo
-- minuto (achado real ao checar o banco de desenvolvimento, ver spec).
CREATE UNIQUE INDEX IF NOT EXISTS idx_agendamentos_importados_unico
  ON agendamentos_importados (
    regexp_replace(telefone, '\D', '', 'g'), data, hora, nome
  );
```

- [ ] **Step 3: Aplicar a migration no banco de desenvolvimento**

Run: `psql "$DATABASE_URL" -f src/db/migrations/010_migracao_legado.sql`

Expected: nenhum erro. Confirmar com `psql "$DATABASE_URL" -c "\d pacientes"` e
`psql "$DATABASE_URL" -c "\d agendamentos_importados"` que as colunas novas
aparecem.

- [ ] **Step 4: Commit**

```bash
git add src/db/migrations/010_migracao_legado.sql
git commit -m "feat: adiciona colunas de migração legada e índice único (migration 010)"
```

---

## Task 2: Parser do XML — linhas reais, cabeçalho e slots vazios

**Files:**
- Create: `src/services/importacaoLegadoService.js`
- Create: `test/fixtures/agenda-exemplo.xml`
- Test: `test/importacaoLegadoService.test.js`

**Interfaces:**
- Produces: `parsearArquivoAgenda(conteudoXml, dataArquivo)` → `Array<{ data, hora, nome, telefoneNormalizado, cpf, nascimento, categoria, atendente, tipo, obs, flagF, flagC, flagE, chegou }>` — `telefoneNormalizado` já passou por `completarDDI` (completa "55" só quando o resultado de `normalizarTelefone` tem 10 ou 11 dígitos; mantém como está se for mais curto). Consumida por `importarDiretorio` (Task 9) e pelos testes de `processarLinha` (Tasks 3–8).

- [ ] **Step 1: Criar a fixture de teste**

```xml
<?xml version="1.0" standalone="yes"?>
<NewDataSet>
  <Table1>
   <Hora>Hora</Hora>
   <Paciente>Paciente</Paciente>
   <Obs>Obs</Obs>
   <CPF>CPF</CPF>
   <Nascimento>Nascimento</Nascimento>
   <Telefone>Telefone</Telefone>
   <Categoria>Categoria</Categoria>
   <Tipo>Tipo</Tipo>
   <F>F</F>
   <Atendente>Atendente</Atendente>
   <C>C</C>
   <E>E</E>
   <Chegou>Chegou</Chegou>
  </Table1>
  <Table1>
   <Hora>07:00</Hora>
   <Paciente>MARIA DA SILVA</Paciente>
   <Obs>MATRICULA 123 - SENHA ABC</Obs>
   <CPF>111.111.111-11</CPF>
   <Nascimento>20/11/1971</Nascimento>
   <Telefone>11 99999-1111</Telefone>
   <Categoria>Particular</Categoria>
   <Tipo>OK</Tipo>
   <F>S</F>
   <Atendente>Carlos</Atendente>
   <C> </C>
   <E></E>
   <Chegou></Chegou>
  </Table1>
  <Table1>
   <Hora>07:30</Hora>
   <Paciente></Paciente>
   <Obs></Obs>
   <CPF></CPF>
   <Nascimento></Nascimento>
   <Telefone></Telefone>
   <Categoria></Categoria>
   <Tipo></Tipo>
   <F></F>
   <Atendente></Atendente>
   <C></C>
   <E></E>
   <Chegou></Chegou>
  </Table1>
  <Table1>
   <Hora>08:00</Hora>
   <Paciente>JOAO SEM TELEFONE</Paciente>
   <Obs></Obs>
   <CPF></CPF>
   <Nascimento></Nascimento>
   <Telefone></Telefone>
   <Categoria>Mar Azul Saúde</Categoria>
   <Tipo>AVAL</Tipo>
   <F></F>
   <Atendente>Bruno</Atendente>
   <C></C>
   <E>E</E>
   <Chegou>Chegou</Chegou>
  </Table1>
</NewDataSet>
```

- [ ] **Step 2: Escrever o teste do parser**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parsearArquivoAgenda } from "../src/services/importacaoLegadoService.js";

const FIXTURE_PATH = fileURLToPath(new URL("./fixtures/agenda-exemplo.xml", import.meta.url));

test("parsearArquivoAgenda pula cabeçalho e slot vazio, extrai linhas reais", async () => {
  const conteudo = await readFile(FIXTURE_PATH, "utf8");
  const linhas = parsearArquivoAgenda(conteudo, "2026-08-26");

  assert.equal(linhas.length, 2, "deve ignorar a linha de cabeçalho e o slot vazio das 07:30");

  const [maria, joao] = linhas;

  assert.deepEqual(maria, {
    data: "2026-08-26",
    hora: "07:00",
    nome: "MARIA DA SILVA",
    telefoneNormalizado: "5511999991111",
    cpf: "111.111.111-11",
    nascimento: "1971-11-20",
    categoria: "Particular",
    atendente: "Carlos",
    tipo: "OK",
    obs: "MATRICULA 123 - SENHA ABC",
    flagF: "S",
    flagC: null,
    flagE: null,
    chegou: null,
  });

  assert.equal(joao.nome, "JOAO SEM TELEFONE");
  assert.equal(joao.telefoneNormalizado, null, "sem telefone no export → null, não string vazia");
  assert.equal(joao.cpf, null);
  assert.equal(joao.nascimento, null);
});

test("parsearArquivoAgenda completa DDI só quando dá pra saber que só falta o '55'", async () => {
  // Caso real encontrado no export: telefone fixo sem DDD ("2267-6690",
  // 8 dígitos) — não dá pra completar com segurança, tem que ficar como
  // está em vez de arriscar um DDD errado.
  const xml = `<NewDataSet>
  <Table1>
   <Hora>09:00</Hora>
   <Paciente>PACIENTE COM DDD</Paciente>
   <Obs></Obs><CPF></CPF><Nascimento></Nascimento>
   <Telefone>11 98888-7777</Telefone>
   <Categoria></Categoria><Tipo></Tipo><F></F><Atendente></Atendente><C></C><E></E><Chegou></Chegou>
  </Table1>
  <Table1>
   <Hora>09:30</Hora>
   <Paciente>PACIENTE SEM DDD</Paciente>
   <Obs></Obs><CPF></CPF><Nascimento></Nascimento>
   <Telefone>2267-6690</Telefone>
   <Categoria></Categoria><Tipo></Tipo><F></F><Atendente></Atendente><C></C><E></E><Chegou></Chegou>
  </Table1>
</NewDataSet>`;

  const [comDDD, semDDD] = parsearArquivoAgenda(xml, "2026-08-26");

  assert.equal(comDDD.telefoneNormalizado, "5511988887777", "11 dígitos (DDD+número) → completa o 55");
  assert.equal(semDDD.telefoneNormalizado, "22676690", "8 dígitos (sem DDD) → mantém como está, não inventa DDD");
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run: `node --test test/importacaoLegadoService.test.js`
Expected: FAIL com `parsearArquivoAgenda is not a function` (o arquivo de serviço ainda não existe).

- [ ] **Step 4: Implementar o parser**

```javascript
import { normalizarTelefone } from "../utils/phone.js";

function decodificarEntidades(texto) {
  return texto
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extrairTag(bloco, tag) {
  const match = bloco.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? decodificarEntidades(match[1]).trim() : "";
}

function converterNascimento(dataBr) {
  const match = dataBr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, dia, mes, ano] = match;
  return `${ano}-${mes}-${dia}`;
}

/**
 * Faz o parse de um arquivo de agenda do sistema de agenda anterior (formato
 * NewDataSet/Table1). `dataArquivo` (YYYY-MM-DD) vem do nome do arquivo
 * (ex: Agenda_Manha_26-08-2026.xml → "2026-08-26") — o XML em si não traz a
 * data da linha, só a hora.
 */
// O export do sistema de agenda anterior traz telefone digitado localmente, sem DDI
// (convenção normal: ninguém escreve o próprio código de país no cadastro
// da própria clínica) — `normalizarTelefone` só remove não-dígitos, não
// completa DDI. Sem completar, um paciente que já é usuário real do bot
// (telefone salvo com DDI, ex: "5511999991111") nunca bateria com o mesmo
// telefone vindo do sistema de agenda anterior ("11999991111"), e viraria um paciente
// duplicado. Só completa quando o resultado tem exatamente 10 ou 11
// dígitos (DDD + número, faltando só o "55") — um número mais curto (ex:
// "22676690", 8 dígitos, fixo sem DDD — caso real encontrado no export)
// não tem como ser completado com segurança, então fica como está em vez
// de arriscar um DDD errado.
function completarDDI(telefoneNormalizado) {
  if (!telefoneNormalizado) return null;
  if (telefoneNormalizado.length === 10 || telefoneNormalizado.length === 11) {
    return `55${telefoneNormalizado}`;
  }
  return telefoneNormalizado;
}

export function parsearArquivoAgenda(conteudoXml, dataArquivo) {
  const blocos = conteudoXml.match(/<Table1>[\s\S]*?<\/Table1>/g) ?? [];
  const linhas = [];

  for (const bloco of blocos) {
    const hora = extrairTag(bloco, "Hora");
    if (hora === "Hora") continue; // linha de cabeçalho (valor = nome da própria tag)

    const nome = extrairTag(bloco, "Paciente");
    const telefoneCru = extrairTag(bloco, "Telefone");
    if (!nome && !telefoneCru) continue; // slot vazio da grade, ninguém marcado

    linhas.push({
      data: dataArquivo,
      hora,
      nome,
      telefoneNormalizado: telefoneCru ? completarDDI(normalizarTelefone(telefoneCru)) : null,
      cpf: extrairTag(bloco, "CPF") || null,
      nascimento: converterNascimento(extrairTag(bloco, "Nascimento")),
      categoria: extrairTag(bloco, "Categoria") || null,
      atendente: extrairTag(bloco, "Atendente") || null,
      tipo: extrairTag(bloco, "Tipo") || null,
      obs: extrairTag(bloco, "Obs") || null,
      flagF: extrairTag(bloco, "F") || null,
      flagC: extrairTag(bloco, "C") || null,
      flagE: extrairTag(bloco, "E") || null,
      chegou: extrairTag(bloco, "Chegou") || null,
    });
  }

  return linhas;
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `node --test test/importacaoLegadoService.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/importacaoLegadoService.js test/importacaoLegadoService.test.js test/fixtures/agenda-exemplo.xml
git commit -m "feat: adiciona parser do export de agenda do sistema de agenda anterior"
```

---

## Task 3: `processarLinha` — paciente novo

**Files:**
- Modify: `src/services/importacaoLegadoService.js`
- Test: `test/importacaoLegadoService.test.js`

**Interfaces:**
- Consumes: linha no formato produzido por `parsearArquivoAgenda` (Task 2).
- Produces: `processarLinha(linha, { aplicar }) → Promise<{ eventos: Array<{ tipo: string, motivo?: string }> }>`. Tipos de evento usados por todas as tasks seguintes: `"paciente_novo"`, `"paciente_atualizado"`, `"agendamento_novo"`, `"agendamento_ja_existe"`, `"divergencia"` (bloqueia escrita, com `motivo`), `"aviso"` (não bloqueia, com `motivo`).

- [ ] **Step 1: Escrever o teste — paciente novo, dry-run não grava**

```javascript
import { pool } from "../src/db/pool.js";

function linhaDeExemplo(sobrescreve = {}) {
  return {
    data: "2026-08-26",
    hora: "07:00",
    nome: "MARIA DA SILVA",
    telefoneNormalizado: "5511999991111",
    cpf: "111.111.111-11",
    nascimento: "1971-11-20",
    categoria: "Particular",
    atendente: "Carlos",
    tipo: "OK",
    obs: null,
    flagF: "S",
    flagC: null,
    flagE: null,
    chegou: null,
    ...sobrescreve,
  };
}

test("processarLinha: paciente novo, dry-run não grava nada", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("FROM pacientes")) return { rows: [] };
    if (sql.includes("FROM agendamentos_importados")) return { rows: [] };
    return { rows: [] };
  });

  const resultado = await processarLinha(linhaDeExemplo(), { aplicar: false });

  assert.deepEqual(
    resultado.eventos.map((e) => e.tipo),
    ["paciente_novo", "agendamento_novo"]
  );
  assert.ok(
    chamadas.every((c) => c.sql.trim().toUpperCase().startsWith("SELECT")),
    "dry-run não deve executar nenhum INSERT/UPDATE"
  );
});

test("processarLinha: paciente novo, --apply insere paciente e agendamento", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("SELECT id, nome, cpf, data_nascimento FROM pacientes")) return { rows: [] };
    if (sql.includes("SELECT id FROM agendamentos_importados")) return { rows: [] };
    return { rows: [] };
  });

  await processarLinha(linhaDeExemplo(), { aplicar: true });

  const insertPaciente = chamadas.find((c) => c.sql.includes("INSERT INTO pacientes"));
  assert.ok(insertPaciente, "deveria ter inserido o paciente");
  assert.deepEqual(insertPaciente.params, [
    "MARIA DA SILVA",
    "5511999991111",
    "Particular",
    "111.111.111-11",
    "1971-11-20",
  ]);

  const insertAgendamento = chamadas.find((c) => c.sql.includes("INSERT INTO agendamentos_importados"));
  assert.ok(insertAgendamento, "deveria ter inserido o agendamento");
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node --test test/importacaoLegadoService.test.js`
Expected: FAIL com `processarLinha is not a function`.

- [ ] **Step 3: Implementar `processarLinha` (parte paciente novo + agendamento, sem validações ainda — vêm nas Tasks 6 e 7)**

```javascript
import { pool } from "../db/pool.js";

// Compara nomes/textos ignorando acento e caixa — usado tanto pra detectar
// se um telefone já cadastrado pertence a OUTRO paciente (família dividindo
// número) quanto, na Task 7, pra checar convênio. `̀-ͯ` é a faixa
// Unicode das marcas diacríticas combinantes deixadas por normalize("NFD").
export function normalizarTexto(texto) {
  return texto
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .toLowerCase()
    .trim();
}

export async function processarLinha(linha, { aplicar }) {
  const eventos = [];

  if (!linha.telefoneNormalizado) {
    eventos.push({ tipo: "divergencia", motivo: "sem telefone, não é possível associar a um paciente" });
    return { eventos };
  }

  const { rows: pacientesExistentes } = await pool.query(
    `SELECT id, nome, cpf, data_nascimento FROM pacientes WHERE telefone = $1`,
    [linha.telefoneNormalizado]
  );
  const pacienteExistente = pacientesExistentes[0] ?? null;

  if (!pacienteExistente) {
    eventos.push({ tipo: "paciente_novo" });
    if (aplicar) {
      await pool.query(
        `INSERT INTO pacientes (nome, telefone, convenio, cpf, data_nascimento)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (telefone) DO NOTHING`,
        [linha.nome, linha.telefoneNormalizado, linha.categoria, linha.cpf, linha.nascimento]
      );
    }
  } else if (normalizarTexto(pacienteExistente.nome) !== normalizarTexto(linha.nome)) {
    // Mesmo telefone, nome diferente do já cadastrado — provável família
    // dividindo o número (achado real, ver spec "Idempotência"). Nunca
    // grava CPF/nascimento aqui: escrever o documento de uma pessoa no
    // cadastro de outra é pior do que só deixar de preencher o campo.
    eventos.push({
      tipo: "aviso",
      motivo: `telefone já cadastrado para outro paciente ("${pacienteExistente.nome}") — CPF/nascimento de "${linha.nome}" não foram gravados, revisar manualmente`,
    });
  } else if (!pacienteExistente.cpf || !pacienteExistente.data_nascimento) {
    eventos.push({ tipo: "paciente_atualizado" });
    if (aplicar) {
      await pool.query(
        `UPDATE pacientes
         SET cpf = COALESCE(cpf, $1), data_nascimento = COALESCE(data_nascimento, $2)
         WHERE id = $3`,
        [linha.cpf, linha.nascimento, pacienteExistente.id]
      );
    }
  }

  // `nome` entra na comparação porque o mesmo telefone pode ter mais de um
  // paciente (ex: família dividindo número) — telefone+data+hora sozinho
  // colidiria entre duas pessoas reais agendadas no mesmo horário.
  const { rows: agendamentosExistentes } = await pool.query(
    `SELECT id FROM agendamentos_importados WHERE telefone = $1 AND data = $2 AND hora = $3 AND nome = $4`,
    [linha.telefoneNormalizado, linha.data, linha.hora, linha.nome]
  );

  if (agendamentosExistentes.length > 0) {
    eventos.push({ tipo: "agendamento_ja_existe" });
    return { eventos };
  }

  eventos.push({ tipo: "agendamento_novo" });
  if (aplicar) {
    await pool.query(
      `INSERT INTO agendamentos_importados
         (telefone, nome, data, hora, tipo_atendimento, convenio, atendente, tipo, obs, flag_f, flag_c, flag_e, chegou)
       VALUES ($1, $2, $3, $4, 'fisioterapia', $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (regexp_replace(telefone, '\\D', '', 'g'), data, hora, nome) DO NOTHING`,
      [
        linha.telefoneNormalizado,
        linha.nome,
        linha.data,
        linha.hora,
        linha.categoria,
        linha.atendente,
        linha.tipo,
        linha.obs,
        linha.flagF,
        linha.flagC,
        linha.flagE,
        linha.chegou,
      ]
    );
  }

  return { eventos };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `node --test test/importacaoLegadoService.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/importacaoLegadoService.js test/importacaoLegadoService.test.js
git commit -m "feat: processarLinha cria paciente e agendamento novos"
```

---

## Task 4: `processarLinha` — paciente existente (atualiza / não sobrescreve)

**Files:**
- Modify: `test/importacaoLegadoService.test.js` (implementação já escrita na Task 3, esta task só cobre os dois ramos restantes com teste)

**Interfaces:**
- Consumes/Produces: mesmas de `processarLinha` (Task 3).

- [ ] **Step 1: Escrever os testes dos dois ramos**

```javascript
test("processarLinha: paciente existente (mesmo nome) sem CPF/nascimento → atualiza", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("SELECT id, nome, cpf, data_nascimento FROM pacientes")) {
      return { rows: [{ id: 42, nome: "MARIA DA SILVA", cpf: null, data_nascimento: null }] };
    }
    if (sql.includes("SELECT id FROM agendamentos_importados")) return { rows: [] };
    return { rows: [] };
  });

  const resultado = await processarLinha(linhaDeExemplo(), { aplicar: true });

  assert.deepEqual(
    resultado.eventos.map((e) => e.tipo),
    ["paciente_atualizado", "agendamento_novo"]
  );
  const update = chamadas.find((c) => c.sql.includes("UPDATE pacientes"));
  assert.ok(update, "deveria ter atualizado o paciente existente");
  assert.deepEqual(update.params, ["111.111.111-11", "1971-11-20", 42]);
});

test("processarLinha: paciente já com CPF e nascimento (mesmo nome) → não sobrescreve", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("SELECT id, nome, cpf, data_nascimento FROM pacientes")) {
      return { rows: [{ id: 42, nome: "MARIA DA SILVA", cpf: "999.999.999-99", data_nascimento: "1990-01-01" }] };
    }
    if (sql.includes("SELECT id FROM agendamentos_importados")) return { rows: [] };
    return { rows: [] };
  });

  const resultado = await processarLinha(linhaDeExemplo(), { aplicar: true });

  assert.deepEqual(
    resultado.eventos.map((e) => e.tipo),
    ["agendamento_novo"],
    "não deve gerar evento paciente_atualizado quando já tem os dois campos"
  );
  assert.ok(
    !chamadas.some((c) => c.sql.includes("UPDATE pacientes")),
    "não deve nem tentar fazer UPDATE"
  );
});

test("processarLinha: mesmo telefone, nome diferente do cadastrado → aviso, não grava CPF/nascimento", async (t) => {
  // Achado real (2026-08-27): telefone pode ser de família — um número já
  // cadastrado pra "PACIENTE EXEMPLO UM" aparecendo numa linha da
  // "PACIENTE EXEMPLO DOIS" não deve escrever o CPF dela no cadastro
  // dele.
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("SELECT id, nome, cpf, data_nascimento FROM pacientes")) {
      return { rows: [{ id: 42, nome: "PACIENTE EXEMPLO UM", cpf: null, data_nascimento: null }] };
    }
    if (sql.includes("SELECT id FROM agendamentos_importados")) return { rows: [] };
    return { rows: [] };
  });

  const resultado = await processarLinha(linhaDeExemplo({ nome: "PACIENTE EXEMPLO DOIS" }), {
    aplicar: true,
  });

  assert.deepEqual(
    resultado.eventos.map((e) => e.tipo),
    ["aviso", "agendamento_novo"]
  );
  assert.equal(
    resultado.eventos[0].motivo,
    'telefone já cadastrado para outro paciente ("PACIENTE EXEMPLO UM") — CPF/nascimento de "PACIENTE EXEMPLO DOIS" não foram gravados, revisar manualmente'
  );
  assert.ok(!chamadas.some((c) => c.sql.includes("UPDATE pacientes") || c.sql.includes("INSERT INTO pacientes")));
});
```

- [ ] **Step 2: Rodar os testes e confirmar que passam**

Run: `node --test test/importacaoLegadoService.test.js`
Expected: PASS (a implementação da Task 3 já cobre os dois ramos — este passo é confirmação; se falhar, é sinal de bug introduzido na Task 3, corrigir ali).

- [ ] **Step 3: Commit**

```bash
git add test/importacaoLegadoService.test.js
git commit -m "test: cobre atualização e não-sobrescrita de CPF/nascimento em processarLinha"
```

---

## Task 5: `processarLinha` — divergência sem telefone

**Files:**
- Modify: `test/importacaoLegadoService.test.js` (implementação já escrita na Task 3)

**Interfaces:**
- Consumes/Produces: mesmas de `processarLinha` (Task 3).

- [ ] **Step 1: Escrever o teste**

```javascript
test("processarLinha: sem telefone → divergência, nenhuma query executada", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [] };
  });

  const resultado = await processarLinha(linhaDeExemplo({ telefoneNormalizado: null }), { aplicar: true });

  assert.deepEqual(resultado.eventos, [
    { tipo: "divergencia", motivo: "sem telefone, não é possível associar a um paciente" },
  ]);
  assert.equal(chamadas.length, 0, "não deve nem consultar o banco quando não há telefone");
});
```

- [ ] **Step 2: Rodar o teste e confirmar que passa**

Run: `node --test test/importacaoLegadoService.test.js`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/importacaoLegadoService.test.js
git commit -m "test: cobre divergência de linha sem telefone em processarLinha"
```

---

## Task 6: `processarLinha` — divergência de hora inválida

**Files:**
- Modify: `src/services/importacaoLegadoService.js`
- Test: `test/importacaoLegadoService.test.js`

**Interfaces:**
- Consumes/Produces: mesmas de `processarLinha` (Task 3). Este passo roda **antes** da checagem de telefone que já existia, então precisa vir antes dela no corpo da função (uma linha com hora inválida E sem telefone deve reportar o motivo de hora, não de telefone — a ordem escolhida prioriza o problema mais "estrutural").

- [ ] **Step 1: Escrever o teste**

```javascript
test("processarLinha: hora em formato inesperado → divergência, linha ignorada", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [] };
  });

  const resultado = await processarLinha(linhaDeExemplo({ hora: "25:99" }), { aplicar: true });

  assert.deepEqual(resultado.eventos, [
    { tipo: "divergencia", motivo: 'hora inválida ("25:99"), linha ignorada' },
  ]);
  assert.equal(chamadas.length, 0, "não deve consultar nem gravar nada com hora inválida");
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node --test test/importacaoLegadoService.test.js`
Expected: FAIL — `25:99` passa direto pela lógica atual e a query de `SELECT ... FROM pacientes` é chamada (o teste falha no `assert.equal(chamadas.length, 0, ...)`).

- [ ] **Step 3: Adicionar a validação de hora no início de `processarLinha`**

Em `src/services/importacaoLegadoService.js`, adicionar logo no início da função (antes da checagem de telefone):

```javascript
// `\d{2}:\d{2}` sozinho aceitaria "25:99" (dígitos certos, valor
// impossível) — o teste deste task espera rejeitar exatamente esse caso,
// então a faixa de hora (00-23) e minuto/segundo (00-59) precisa estar na
// regex, não só o formato.
const REGEX_HORA_VALIDA = /^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;
```

(declarar no topo do arquivo, junto dos outros `const`/`function` de nível de módulo) e, dentro de `processarLinha`:

```javascript
export async function processarLinha(linha, { aplicar }) {
  const eventos = [];

  if (!REGEX_HORA_VALIDA.test(linha.hora)) {
    eventos.push({ tipo: "divergencia", motivo: `hora inválida ("${linha.hora}"), linha ignorada` });
    return { eventos };
  }

  if (!linha.telefoneNormalizado) {
    // ... resto da função como já estava
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `node --test test/importacaoLegadoService.test.js`
Expected: PASS (incluindo todos os testes das Tasks 3–5, que continuam passando — `linhaDeExemplo()` já usa `hora: "07:00"`, válida).

- [ ] **Step 5: Commit**

```bash
git add src/services/importacaoLegadoService.js test/importacaoLegadoService.test.js
git commit -m "feat: processarLinha reporta divergência para hora em formato inválido"
```

---

## Task 7: `processarLinha` — aviso de convênio não reconhecido

**Files:**
- Modify: `src/services/importacaoLegadoService.js`
- Test: `test/importacaoLegadoService.test.js`

**Interfaces:**
- Consumes: `CONVENIOS_FISIOTERAPIA` (`src/config/clinica.js`, já existente), `normalizarTexto` (definida na Task 3).
- Consumes/Produces: mesmas de `processarLinha` (Task 3), mais o evento `"aviso"` (não bloqueia gravação — já introduzido na Task 3 pra telefone de outro paciente, reaproveitado aqui pra convênio).

- [ ] **Step 1: Escrever os testes**

```javascript
test('processarLinha: convênio "Particular" nunca gera aviso', async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("FROM pacientes")) return { rows: [] };
    if (sql.includes("FROM agendamentos_importados")) return { rows: [] };
    return { rows: [] };
  });

  const resultado = await processarLinha(linhaDeExemplo({ categoria: "Particular" }), { aplicar: false });

  assert.ok(!resultado.eventos.some((e) => e.tipo === "aviso"));
});

test("processarLinha: convênio reconhecido (variação de acento/caixa) não gera aviso", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("FROM pacientes")) return { rows: [] };
    if (sql.includes("FROM agendamentos_importados")) return { rows: [] };
    return { rows: [] };
  });

  // "Norte" (sem acento, sem "Intermed") é como o export costuma
  // vir — precisa bater com "Norte Intermed" da lista oficial.
  const resultado = await processarLinha(linhaDeExemplo({ categoria: "Norte" }), { aplicar: false });

  assert.ok(!resultado.eventos.some((e) => e.tipo === "aviso"));
});

test("processarLinha: convênio truncado no export (só a primeira palavra) não gera aviso", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("FROM pacientes")) return { rows: [] };
    if (sql.includes("FROM agendamentos_importados")) return { rows: [] };
    return { rows: [] };
  });

  // Caso real do export: "Santa Luz" (duas palavras, sem acento)
  // precisa bater com "Santa Luz Saúde" da lista oficial — a
  // comparação por primeira palavra tem que rodar dos DOIS lados (export
  // truncado E nome oficial truncado), não só de um.
  const resultado = await processarLinha(linhaDeExemplo({ categoria: "Santa Luz" }), { aplicar: false });

  assert.ok(!resultado.eventos.some((e) => e.tipo === "aviso"));
});

test("processarLinha: convênio não reconhecido → aviso, mas grava normalmente", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("FROM pacientes")) return { rows: [] };
    if (sql.includes("FROM agendamentos_importados")) return { rows: [] };
    return { rows: [] };
  });

  const resultado = await processarLinha(linhaDeExemplo({ categoria: "Convenio Que Nao Existe" }), {
    aplicar: true,
  });

  assert.deepEqual(
    resultado.eventos.map((e) => e.tipo),
    ["aviso", "paciente_novo", "agendamento_novo"]
  );
  assert.equal(
    resultado.eventos[0].motivo,
    'convênio "Convenio Que Nao Existe" não bate com nenhum convênio credenciado conhecido — revisar manualmente'
  );
  assert.ok(chamadas.some((c) => c.sql.includes("INSERT INTO pacientes")), "aviso não deve bloquear a gravação");
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test test/importacaoLegadoService.test.js`
Expected: FAIL nos dois primeiros testes NÃO (não geram aviso porque a lógica de aviso ainda não existe, então já passam por acidente) — mas o terceiro teste FAIL, porque `resultado.eventos` ainda não tem o tipo `"aviso"` na posição esperada.

- [ ] **Step 3: Implementar a checagem de convênio**

No topo de `src/services/importacaoLegadoService.js` (reaproveitando
`normalizarTexto`, já definido na Task 3 pra comparar nome de paciente —
mesma função serve pra convênio):

```javascript
import { CONVENIOS_FISIOTERAPIA } from "../config/clinica.js";

// Compara só a primeira palavra normalizada, dos dois lados: o export traz
// o convênio truncado/abreviado (ex: "Norte", "Santa Luz"), e a
// lista oficial tem o nome completo (ex: "Norte Intermed", "São
// Cristóvão Saúde") — comparar a string inteira quase nunca bateria.
// Reduzir os dois lados à primeira palavra é uma checagem de "pertence a
// algum credenciado", não de "identifica qual" — por isso colisão de
// primeira palavra entre dois convênios diferentes não é um problema:
// existe pelo menos uma de verdade ("Santa Luz Saúde" e "Bom Porto Saúde"
// colidem em "sao", por exemplo), e não precisamos saber qual, só que
// alguma bate. Só viraria problema se um convênio SEM ser credenciado
// coincidisse na primeira palavra com um credenciado — não observado até
// agora, mas o motivo de aceitar esse risco é a assimetria de custo: um
// aviso a menos é só menos visibilidade, nunca corrompe dado gravado.
const CONVENIOS_FISIOTERAPIA_PRIMEIRA_PALAVRA = new Set(
  CONVENIOS_FISIOTERAPIA.map((convenio) => normalizarTexto(convenio).split(" ")[0])
);
```

Dentro de `processarLinha`, logo após a checagem de hora e antes da checagem de
telefone (um convênio não reconhecido é só aviso, não deve impedir a
checagem de telefone/agendamento de rodar):

```javascript
  if (linha.categoria && normalizarTexto(linha.categoria) !== "particular") {
    const primeiraPalavra = normalizarTexto(linha.categoria).split(" ")[0];
    if (!CONVENIOS_FISIOTERAPIA_PRIMEIRA_PALAVRA.has(primeiraPalavra)) {
      eventos.push({
        tipo: "aviso",
        motivo: `convênio "${linha.categoria}" não bate com nenhum convênio credenciado conhecido — revisar manualmente`,
      });
    }
  }
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test test/importacaoLegadoService.test.js`
Expected: PASS (incluindo todos os testes anteriores — `linhaDeExemplo()` usa `categoria: "Particular"`, que nunca gera aviso).

- [ ] **Step 5: Commit**

```bash
git add src/services/importacaoLegadoService.js test/importacaoLegadoService.test.js
git commit -m "feat: processarLinha avisa sobre convênio não reconhecido sem bloquear gravação"
```

---

## Task 8: `processarLinha` — idempotência (agendamento já existente)

**Files:**
- Modify: `test/importacaoLegadoService.test.js` (implementação já escrita na Task 3)

**Interfaces:**
- Consumes/Produces: mesmas de `processarLinha` (Task 3).

- [ ] **Step 1: Escrever o teste — rodar duas vezes, segunda não insere de novo**

```javascript
test("processarLinha: rodar duas vezes com o mesmo estado não duplica agendamento", async (t) => {
  const tabelaAgendamentos = []; // simula o estado do banco entre as duas chamadas
  t.mock.method(pool, "query", async (sql, params) => {
    if (sql.includes("SELECT id, nome, cpf, data_nascimento FROM pacientes")) {
      return { rows: [{ id: 42, nome: "MARIA DA SILVA", cpf: "111.111.111-11", data_nascimento: "1971-11-20" }] };
    }
    if (sql.includes("SELECT id FROM agendamentos_importados")) {
      const [telefone, data, hora, nome] = params;
      const existente = tabelaAgendamentos.find(
        (a) => a.telefone === telefone && a.data === data && a.hora === hora && a.nome === nome
      );
      return { rows: existente ? [{ id: existente.id }] : [] };
    }
    if (sql.includes("INSERT INTO agendamentos_importados")) {
      const [telefone, nome, data, hora] = params;
      tabelaAgendamentos.push({ id: tabelaAgendamentos.length + 1, telefone, nome, data, hora });
      return { rows: [] };
    }
    return { rows: [] };
  });

  const linha = linhaDeExemplo();
  const primeira = await processarLinha(linha, { aplicar: true });
  const segunda = await processarLinha(linha, { aplicar: true });

  assert.deepEqual(
    primeira.eventos.map((e) => e.tipo),
    ["agendamento_novo"]
  );
  assert.deepEqual(
    segunda.eventos.map((e) => e.tipo),
    ["agendamento_ja_existe"],
    "segunda execução com o mesmo dado não deve gerar agendamento_novo de novo"
  );
  assert.equal(tabelaAgendamentos.length, 1, "só deve existir um agendamento na tabela simulada");
});

test("processarLinha: duas pessoas diferentes no mesmo telefone/data/hora não colidem no agendamento", async (t) => {
  // Achado real (2026-08-27): família dividindo telefone, dois pacientes
  // agendados no mesmo horário — nome precisa entrar na chave de
  // agendamentos_importados, senão o segundo paciente seria incorretamente
  // tratado como "já existe" e nunca gravado. `pacientes` já é coberto
  // pelo teste de aviso da Task 4 — aqui o mock devolve o PACIENTE EXEMPLO UM já
  // cadastrada pra isolar só o comportamento de agendamentos_importados.
  const tabelaAgendamentos = [];
  t.mock.method(pool, "query", async (sql, params) => {
    if (sql.includes("SELECT id, nome, cpf, data_nascimento FROM pacientes")) {
      return { rows: [{ id: 42, nome: "PACIENTE EXEMPLO UM", cpf: "111.111.111-11", data_nascimento: "1980-01-01" }] };
    }
    if (sql.includes("SELECT id FROM agendamentos_importados")) {
      const [telefone, data, hora, nome] = params;
      const existente = tabelaAgendamentos.find(
        (a) => a.telefone === telefone && a.data === data && a.hora === hora && a.nome === nome
      );
      return { rows: existente ? [{ id: existente.id }] : [] };
    }
    if (sql.includes("INSERT INTO agendamentos_importados")) {
      const [telefone, nome, data, hora] = params;
      tabelaAgendamentos.push({ id: tabelaAgendamentos.length + 1, telefone, nome, data, hora });
      return { rows: [] };
    }
    return { rows: [] };
  });

  const linha1 = linhaDeExemplo({ nome: "PACIENTE EXEMPLO UM", telefoneNormalizado: "5511999990003" });
  const linha2 = linhaDeExemplo({ nome: "PACIENTE EXEMPLO DOIS", telefoneNormalizado: "5511999990003" });

  const resultado1 = await processarLinha(linha1, { aplicar: true });
  const resultado2 = await processarLinha(linha2, { aplicar: true });

  assert.deepEqual(resultado1.eventos.map((e) => e.tipo), ["agendamento_novo"]);
  assert.deepEqual(
    resultado2.eventos.map((e) => e.tipo),
    ["aviso", "agendamento_novo"],
    "segunda pessoa no mesmo telefone/data/hora deve gravar o agendamento normalmente, não ser tratada como duplicata"
  );
  assert.equal(tabelaAgendamentos.length, 2, "as duas pessoas devem ter uma linha de agendamento cada");
});
```

- [ ] **Step 2: Rodar o teste e confirmar que passa**

Run: `node --test test/importacaoLegadoService.test.js`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/importacaoLegadoService.test.js
git commit -m "test: cobre idempotência de processarLinha em execuções repetidas"
```

---

## Task 9: `importarDiretorio` — agregador de arquivos + relatório

**Files:**
- Modify: `src/services/importacaoLegadoService.js`
- Test: `test/importacaoLegadoService.test.js`

**Interfaces:**
- Consumes: `parsearArquivoAgenda` (Task 2), `processarLinha` (Tasks 3–7).
- Produces: `importarDiretorio(diretorio, { aplicar }) → Promise<{ pacientesNovos, pacientesAtualizados, agendamentosNovos, agendamentosJaExistentes, divergencias: Array<{ nome, arquivo, motivo }>, avisos: Array<{ nome, arquivo, motivo }> }>`. Consumida por `migrarSistemaAnterior.js` (Task 10).

- [ ] **Step 1: Escrever o teste — dois arquivos reais em diretório temporário**

```javascript
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("importarDiretorio lê Agenda_*.xml do diretório e agrega o relatório", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "importacao-legado-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  await writeFile(join(dir, "Agenda_Manha_26-08-2026.xml"), await readFile(FIXTURE_PATH, "utf8"));
  await writeFile(join(dir, "nao_e_agenda.xml"), "<NewDataSet></NewDataSet>");

  t.mock.method(pool, "query", async (sql, params) => {
    if (sql.includes("SELECT id, nome, cpf, data_nascimento FROM pacientes")) return { rows: [] };
    if (sql.includes("SELECT id FROM agendamentos_importados")) return { rows: [] };
    return { rows: [] };
  });

  const relatorio = await importarDiretorio(dir, { aplicar: false });

  assert.equal(relatorio.pacientesNovos, 1);
  assert.equal(relatorio.agendamentosNovos, 1);
  assert.equal(relatorio.agendamentosJaExistentes, 0);
  assert.deepEqual(relatorio.divergencias, [
    {
      nome: "JOAO SEM TELEFONE",
      arquivo: "Agenda_Manha_26-08-2026.xml",
      motivo: "sem telefone, não é possível associar a um paciente",
    },
  ]);
  assert.deepEqual(relatorio.avisos, [], "MARIA DA SILVA usa convênio Particular, não deveria gerar aviso");
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node --test test/importacaoLegadoService.test.js`
Expected: FAIL com `importarDiretorio is not a function`.

- [ ] **Step 3: Implementar `importarDiretorio`**

```javascript
import { readdir, readFile as lerArquivo } from "node:fs/promises";
import { join as juntarCaminho } from "node:path";

const REGEX_ARQUIVO_AGENDA = /^Agenda_(?:Manha|Tarde)_(\d{2})-(\d{2})-(\d{4})\.xml$/;

export async function importarDiretorio(diretorio, { aplicar }) {
  const todosArquivos = await readdir(diretorio);
  const arquivos = todosArquivos.filter((nome) => REGEX_ARQUIVO_AGENDA.test(nome)).sort();

  const relatorio = {
    pacientesNovos: 0,
    pacientesAtualizados: 0,
    agendamentosNovos: 0,
    agendamentosJaExistentes: 0,
    divergencias: [],
    avisos: [],
  };

  for (const arquivo of arquivos) {
    const [, dia, mes, ano] = arquivo.match(REGEX_ARQUIVO_AGENDA);
    const dataArquivo = `${ano}-${mes}-${dia}`;
    const conteudo = await lerArquivo(juntarCaminho(diretorio, arquivo), "utf8");
    const linhas = parsearArquivoAgenda(conteudo, dataArquivo);

    for (const linha of linhas) {
      const { eventos } = await processarLinha(linha, { aplicar });
      for (const evento of eventos) {
        if (evento.tipo === "paciente_novo") relatorio.pacientesNovos++;
        else if (evento.tipo === "paciente_atualizado") relatorio.pacientesAtualizados++;
        else if (evento.tipo === "agendamento_novo") relatorio.agendamentosNovos++;
        else if (evento.tipo === "agendamento_ja_existe") relatorio.agendamentosJaExistentes++;
        else if (evento.tipo === "divergencia") {
          relatorio.divergencias.push({ nome: linha.nome, arquivo, motivo: evento.motivo });
        } else if (evento.tipo === "aviso") {
          relatorio.avisos.push({ nome: linha.nome, arquivo, motivo: evento.motivo });
        }
      }
    }
  }

  return relatorio;
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `node --test test/importacaoLegadoService.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/importacaoLegadoService.js test/importacaoLegadoService.test.js
git commit -m "feat: importarDiretorio agrega arquivos de agenda num relatório único"
```

---

## Task 10: CLI `migrarSistemaAnterior.js`

**Files:**
- Create: `src/db/migrarSistemaAnterior.js`

**Interfaces:**
- Consumes: `importarDiretorio` (Task 9).

- [ ] **Step 1: Implementar o script**

```javascript
// src/db/migrarSistemaAnterior.js
// Migra dados legados do sistema de agenda anterior (exports Agenda_Manha/Tarde_DD-MM-YYYY.xml)
// pra pacientes/agendamentos_importados. Só faz INSERT/UPDATE direto via
// pool — nunca chama aiService/chatService/webhook/calendarService (ver
// spec, "Isolamento do bot").
//
// Uso: node src/db/migrarSistemaAnterior.js [--dir CAMINHO] [--apply]
// Sem --apply: dry-run, só mostra o relatório, nada é gravado.

import "dotenv/config";
import { importarDiretorio } from "../services/importacaoLegadoService.js";
import { pool } from "./pool.js";

const args = process.argv.slice(2);
const aplicar = args.includes("--apply");
const indiceDir = args.indexOf("--dir");
const diretorio = indiceDir !== -1 ? args[indiceDir + 1] : `${process.env.HOME}/Downloads`;

const relatorio = await importarDiretorio(diretorio, { aplicar });

console.log(
  aplicar ? "=== IMPORTAÇÃO APLICADA ===" : "=== DRY-RUN (nada foi gravado — use --apply pra gravar de verdade) ==="
);
console.log(`Diretório: ${diretorio}`);
console.log(`Pacientes novos: ${relatorio.pacientesNovos}`);
console.log(`Pacientes atualizados (CPF/nascimento preenchido): ${relatorio.pacientesAtualizados}`);
console.log(`Agendamentos novos: ${relatorio.agendamentosNovos}`);
console.log(`Agendamentos já existentes (ignorados): ${relatorio.agendamentosJaExistentes}`);
console.log(`Divergências (não gravadas): ${relatorio.divergencias.length}`);
for (const divergencia of relatorio.divergencias) {
  console.log(`  - ${divergencia.nome} (${divergencia.arquivo}): ${divergencia.motivo}`);
}
console.log(`Avisos (gravadas, mas revisar): ${relatorio.avisos.length}`);
for (const aviso of relatorio.avisos) {
  console.log(`  - ${aviso.nome} (${aviso.arquivo}): ${aviso.motivo}`);
}

await pool.end();
```

- [ ] **Step 2: Smoke test manual contra a fixture de teste**

```bash
mkdir -p /tmp/agenda-smoke-test
cp test/fixtures/agenda-exemplo.xml "/tmp/agenda-smoke-test/Agenda_Manha_26-08-2026.xml"
node src/db/migrarSistemaAnterior.js --dir /tmp/agenda-smoke-test
```

Expected: imprime `=== DRY-RUN ===`, `Pacientes novos: 1`, `Agendamentos novos: 1`,
`Divergências (não gravadas): 1` (JOAO SEM TELEFONE), `Avisos (gravadas, mas revisar): 0`,
sem erro de conexão nem stack trace. Limpar depois: `rm -rf /tmp/agenda-smoke-test`.

- [ ] **Step 3: Commit**

```bash
git add src/db/migrarSistemaAnterior.js
git commit -m "feat: adiciona CLI de migração de dados legados do sistema de agenda anterior"
```

---

## Task 11: Verificação manual final contra os arquivos reais

**Files:** nenhum arquivo novo — só execução e conferência.

- [ ] **Step 1: Rodar lint e a suíte completa**

Run: `npm run lint && npm test`
Expected: 0 erros de lint, todos os testes passando (incluindo os já existentes do resto do projeto).

- [ ] **Step 2: Dry-run contra os arquivos reais**

```bash
node src/db/migrarSistemaAnterior.js --dir ~/Downloads
```

Expected: `Agendamentos novos` = 307 (contagem levantada na spec para o lote de
25–31/08/2026, assumindo nenhum outro agendamento manual coincidente já
gravado); `Divergências` = 3 (os pacientes sem telefone já identificados,
mais qualquer hora inválida que porventura exista e não tenha sido
detectada na análise manual anterior); conferir a lista de `Avisos` de
convênio manualmente — nomes como "Norte"/"Santa Luz" (sem acento)
não deveriam aparecer aqui (a normalização da Task 7 cobre isso), só
convênios genuinamente não credenciados. Se os números não baterem,
investigar antes de prosseguir — não seguir pro Step 3 com uma discrepância
não explicada.

- [ ] **Step 3: Aplicar contra o banco de desenvolvimento**

```bash
node src/db/migrarSistemaAnterior.js --dir ~/Downloads --apply
```

Expected: mesmo relatório do Step 2, agora marcado como aplicado. Confirmar
com uma consulta direta:

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM agendamentos_importados WHERE tipo IS NOT NULL;"
```

Expected: contagem bate com `Agendamentos novos` do relatório.

- [ ] **Step 4: Rodar o script de novo (confirmar idempotência com dados reais)**

```bash
node src/db/migrarSistemaAnterior.js --dir ~/Downloads --apply
```

Expected: `Agendamentos novos: 0`, `Agendamentos já existentes: 307` (ou o
número real do Step 2) — nada duplicado.

Esta é a última task do sub-projeto — depois dela, seguir para
`superpowers:finishing-a-development-branch` (revisão do branch inteiro,
igual foi feito no sub-projeto 1) antes de decidir merge/PR/manter como está.
