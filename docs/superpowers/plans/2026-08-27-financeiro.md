# Financeiro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar pra recepção uma tela `/financeiro` no dashboard pra registrar pagamentos (extrato, múltiplos lançamentos por agendamento) em qualquer agendamento — bot ou importado, passado ou futuro — mais um relatório mensal agregado.

**Architecture:** Tabela nova `pagamentos` (aponta pra `agendamentos` OU `agendamentos_importados`, `paciente_id` resolvido na escrita) + um model novo que combina as duas origens (cada agendamento trazendo seus lançamentos já feitos via `json_agg`) + duas rotas de escrita simples (só `INSERT`, sem transação) + uma rota de relatório agregado, tudo no dashboard EJS já existente.

**Tech Stack:** Express + EJS, `pg` (só `pool.query`, sem client transacional — não há corrida a proteger aqui), `node --test` com `pool.query` mockado (sem Postgres real nos testes).

**Spec:** [docs/superpowers/specs/2026-08-27-financeiro-design.md](../specs/2026-08-27-financeiro-design.md)

## Global Constraints

- `forma_pagamento` só aceita `'pix'` ou `'cartao'`; `status` só aceita `'pago'`, `'pendente'` ou `'aguardando_reembolso'` — qualquer outro valor no `POST` é 400.
- `pagamentos` deve sempre apontar pra exatamente uma origem (`agendamento_id` XOR `agendamento_importado_id`) — reforçado pelo `CHECK (num_nonnulls(...) = 1)` no banco.
- `parcelas`/`valor_acrescimo` só têm sentido com `forma_pagamento = 'cartao'` — se a forma for `'pix'`, o controller sempre normaliza os dois pra `null` antes de gravar (não é erro, é normalização silenciosa, mesmo padrão do `observacao_sessao?.trim() || null` do sub-projeto 3).
- `valor` precisa ser um número finito **maior que zero**. `valor_acrescimo` (quando presente) `>= 0`. `parcelas` (quando presente) é um inteiro `> 0`.
- **Sem "já passou" bloqueando o lançamento** — diferente do sub-projeto 3 (Presença), pagamento pode ser registrado em qualquer agendamento, passado ou futuro (adiantamento).
- **Múltiplos lançamentos por agendamento são permitidos e esperados** — toda escrita é um `INSERT` puro, nunca `UPDATE`/upsert. Não existe índice único em `pagamentos` sobre `agendamento_id`/`agendamento_importado_id`.
- `agendamentos_importados` não tem FK pra `pacientes` — `paciente_id` é resolvido na escrita via `buscarPacientePorTelefone` (já existe em `src/models/pacienteModel.js`), buscando pelo `telefone` do agendamento importado. Se não achar paciente correspondente, a escrita falha com um motivo específico (`paciente_nao_vinculado`), não um 404 genérico.
- Toda rota `POST` do dashboard exige `exigirLogin` (antes) + `exigirCsrf` (depois), mesmo padrão das rotas já existentes.
- `:id` de rota precisa ser validado como inteiro positivo (`Number.parseInt` + `Number.isInteger` + `>= 1`) **antes** de qualquer consulta ao banco, respondendo 404 se não for — isso foi um bug real encontrado e corrigido na revisão final do sub-projeto 3 (Presença); aqui entra desde o início, não como correção depois.
- Sem teste de integração com Postgres real — `pool.query` mockado via `t.mock.method`, mesmo padrão dos sub-projetos anteriores. Módulos exportando funções (`models/*.js`) não podem ser mockados via `t.mock.method` num `import * as` — testes de controller mockam `pool.query` diretamente e deixam o model real rodar por cima (mesmo padrão de `test/dashboardController.test.js`/`test/dashboardControllerPresenca.test.js`).
- Paginação da listagem combinada segue o mesmo padrão corrigido no sub-projeto 3: cada fonte busca exatamente `offsetSeguro + limiteSeguro` linhas (nunca um `LIMIT` fixo menor), pra nenhuma linha antiga ficar inalcançável.

---

## Task 1: Migration

**Files:**
- Create: `src/db/migrations/012_financeiro.sql`

**Interfaces:**
- Produces: tabela `pagamentos` (colunas: `id`, `agendamento_id`, `agendamento_importado_id`, `paciente_id`, `valor`, `forma_pagamento`, `parcelas`, `valor_acrescimo`, `status`, `data`, `observacao`, `registrado_por`, `registrado_em`) — usada por todas as tasks seguintes.

- [ ] **Step 1: Criar a migration**

```sql
-- src/db/migrations/012_financeiro.sql
-- Clínica Exemplo Bot — migration 012: financeiro (sub-projeto 4).
-- Rodar no SQL Editor do Neon (ou via psql) depois de 011_presenca_prontuario.sql.
-- ATENÇÃO: este projeto não tem banco de dev separado do de produção — só
-- aplicar depois de confirmar com o usuário (ver plano/spec deste sub-projeto).

CREATE TABLE IF NOT EXISTS pagamentos (
  id SERIAL PRIMARY KEY,
  agendamento_id INTEGER REFERENCES agendamentos(id),
  agendamento_importado_id INTEGER REFERENCES agendamentos_importados(id),
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id),
  valor NUMERIC(10,2) NOT NULL,
  forma_pagamento TEXT NOT NULL CHECK (forma_pagamento IN ('pix', 'cartao')),
  parcelas INTEGER,
  valor_acrescimo NUMERIC(10,2),
  status TEXT NOT NULL CHECK (status IN ('pago', 'pendente', 'aguardando_reembolso')),
  data DATE NOT NULL,
  observacao TEXT,
  registrado_por INTEGER NOT NULL REFERENCES usuarios(id),
  registrado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(agendamento_id, agendamento_importado_id) = 1),
  CHECK (parcelas IS NULL OR forma_pagamento = 'cartao'),
  CHECK (valor_acrescimo IS NULL OR forma_pagamento = 'cartao'),
  CHECK (valor > 0),
  CHECK (valor_acrescimo IS NULL OR valor_acrescimo >= 0),
  CHECK (parcelas IS NULL OR parcelas > 0)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER TABLE pagamentos ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON pagamentos FROM anon, authenticated;
  END IF;
END $$;
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: 0 erros (mesmo warning pré-existente de `calendarService.js`, sem relação).

- [ ] **Step 3: Commit**

```bash
git add src/db/migrations/012_financeiro.sql
git commit -m "feat: migration de financeiro (tabela pagamentos)"
```

---

## Task 2: Model — listagem combinada com pagamentos aninhados (`listarFinanceiro`)

**Files:**
- Create: `src/models/pagamentoModel.js`
- Test: `test/pagamentoModel.test.js`

**Interfaces:**
- Consumes: `pool` de `src/db/pool.js`; `validarData` de `src/utils/validacao.js`.
- Produces: `listarFinanceiro({ data, limite, offset } = {}) => Promise<Array<{ id, origem: 'bot'|'importado', paciente_nome, tipo_atendimento, data, hora, pagamentos: Array<{ id, valor, forma_pagamento, parcelas, valor_acrescimo, status, data, observacao, registrado_em }> }>>` — usado pela Task 5 (`telaFinanceiro`).

- [ ] **Step 1: Escrever os testes (falhando)**

```js
// test/pagamentoModel.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { listarFinanceiro } from "../src/models/pagamentoModel.js";

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

test("listarFinanceiro: combina itens do bot e importados, mais recente primeiro", async (t) => {
  mockarConsultas(t, {
    bot: [{ id: 1, origem: "bot", data: "2026-08-20", hora: "10:00:00", pagamentos: [] }],
    importados: [{ id: 2, origem: "importado", data: "2026-08-25", hora: "09:00:00", pagamentos: [] }],
  });

  const itens = await listarFinanceiro({});

  assert.deepEqual(
    itens.map((i) => i.origem),
    ["importado", "bot"]
  );
});

test("listarFinanceiro: cada item carrega seus pagamentos já lançados", async (t) => {
  const pagamentosDoItem = [
    { id: 10, valor: "150.00", forma_pagamento: "pix", parcelas: null, valor_acrescimo: null, status: "pago", data: "2026-08-20", observacao: null, registrado_em: "2026-08-20T10:00:00Z" },
  ];
  mockarConsultas(t, {
    bot: [{ id: 1, origem: "bot", data: "2026-08-20", hora: "10:00:00", pagamentos: pagamentosDoItem }],
  });

  const itens = await listarFinanceiro({});

  assert.deepEqual(itens[0].pagamentos, pagamentosDoItem);
});

test("listarFinanceiro: aplica limite e offset sobre a lista já combinada", async (t) => {
  mockarConsultas(t, {
    bot: [
      { id: 1, data: "2026-08-20", hora: "10:00:00", pagamentos: [] },
      { id: 2, data: "2026-08-21", hora: "10:00:00", pagamentos: [] },
      { id: 3, data: "2026-08-22", hora: "10:00:00", pagamentos: [] },
    ],
  });

  const itens = await listarFinanceiro({ limite: 1, offset: 1 });

  assert.equal(itens.length, 1);
  assert.equal(itens[0].id, 2);
});

test("listarFinanceiro: com data inválida no filtro, ignora e não passa filtro nenhum", async (t) => {
  const chamadas = mockarConsultas(t);

  await listarFinanceiro({ data: "não-é-uma-data" });

  for (const { params } of chamadas) {
    assert.equal(params.at(-1), null);
  }
});

test("listarFinanceiro: com data válida, passa o filtro pras duas queries", async (t) => {
  const chamadas = mockarConsultas(t);

  await listarFinanceiro({ data: "2026-08-25" });

  for (const { params } of chamadas) {
    assert.equal(params.at(-1), "2026-08-25");
  }
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test test/pagamentoModel.test.js`
Expected: FAIL — `Cannot find module '../src/models/pagamentoModel.js'`.

- [ ] **Step 3: Implementar `listarFinanceiro`**

```js
// src/models/pagamentoModel.js
import { pool } from "../db/pool.js";
import { validarData } from "../utils/validacao.js";

const LIMITE_PADRAO_LISTAGEM = 50;
const LIMITE_MAXIMO_LISTAGEM = 200;

const CAMPOS_PAGAMENTO_JSON = `
  'id', pg.id,
  'valor', pg.valor,
  'forma_pagamento', pg.forma_pagamento,
  'parcelas', pg.parcelas,
  'valor_acrescimo', pg.valor_acrescimo,
  'status', pg.status,
  'data', pg.data,
  'observacao', pg.observacao,
  'registrado_em', pg.registrado_em
`;

async function buscarItensBot({ janela, filtroData }) {
  const { rows } = await pool.query(
    `SELECT
       a.id,
       'bot' AS origem,
       p.nome AS paciente_nome,
       a.tipo_atendimento,
       a.data,
       a.hora,
       COALESCE(
         json_agg(
           json_build_object(${CAMPOS_PAGAMENTO_JSON})
           ORDER BY pg.data DESC, pg.registrado_em DESC
         ) FILTER (WHERE pg.id IS NOT NULL),
         '[]'
       ) AS pagamentos
     FROM agendamentos a
     JOIN pacientes p ON p.id = a.paciente_id
     LEFT JOIN pagamentos pg ON pg.agendamento_id = a.id
     WHERE ($2::date IS NULL OR a.data = $2)
     GROUP BY a.id, p.nome, a.tipo_atendimento, a.data, a.hora
     ORDER BY a.data DESC, a.hora DESC
     LIMIT $1`,
    [janela, filtroData]
  );
  return rows;
}

async function buscarItensImportados({ janela, filtroData }) {
  const { rows } = await pool.query(
    `SELECT
       ai.id,
       'importado' AS origem,
       ai.nome AS paciente_nome,
       ai.tipo_atendimento,
       ai.data,
       ai.hora,
       COALESCE(
         json_agg(
           json_build_object(${CAMPOS_PAGAMENTO_JSON})
           ORDER BY pg.data DESC, pg.registrado_em DESC
         ) FILTER (WHERE pg.id IS NOT NULL),
         '[]'
       ) AS pagamentos
     FROM agendamentos_importados ai
     LEFT JOIN pagamentos pg ON pg.agendamento_importado_id = ai.id
     WHERE ($2::date IS NULL OR ai.data = $2)
     GROUP BY ai.id, ai.nome, ai.tipo_atendimento, ai.data, ai.hora
     ORDER BY ai.data DESC, ai.hora DESC
     LIMIT $1`,
    [janela, filtroData]
  );
  return rows;
}

/**
 * Lista combinada bot + importados pra tela /financeiro, cada item já com
 * seus pagamentos aninhados (json_agg, uma query por fonte — evita N+1).
 * Sem filtro de "já passou" (diferente de listarPresenca): pagamento pode
 * ser lançado em agendamento futuro (adiantamento). Mesmo padrão de janela
 * de paginação (offsetSeguro + limiteSeguro por fonte) corrigido no
 * sub-projeto 3, pra nenhuma linha antiga ficar inalcançável.
 */
export async function listarFinanceiro({ data, limite, offset } = {}) {
  const limiteSeguro = Math.max(1, Math.min(Number(limite) || LIMITE_PADRAO_LISTAGEM, LIMITE_MAXIMO_LISTAGEM));
  const offsetSeguro = Math.max(Number(offset) || 0, 0);
  const filtroData = validarData(data) ? data : null;
  const janela = offsetSeguro + limiteSeguro;

  const [itensBot, itensImportados] = await Promise.all([
    buscarItensBot({ janela, filtroData }),
    buscarItensImportados({ janela, filtroData }),
  ]);

  const combinados = [...itensBot, ...itensImportados].sort((x, y) =>
    `${y.data}T${y.hora}`.localeCompare(`${x.data}T${x.hora}`)
  );

  return combinados.slice(offsetSeguro, offsetSeguro + limiteSeguro);
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test test/pagamentoModel.test.js`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add src/models/pagamentoModel.js test/pagamentoModel.test.js
git commit -m "feat: listarFinanceiro combina agendamentos com pagamentos aninhados"
```

---

## Task 3: Model — registrar pagamento (`registrarPagamentoBot`, `registrarPagamentoImportado`)

**Files:**
- Modify: `src/models/pagamentoModel.js`
- Test: `test/pagamentoModel.test.js`

**Interfaces:**
- Consumes: `buscarPacientePorTelefone` de `src/models/pacienteModel.js` (já existe — `(telefone) => Promise<paciente|null>`).
- Produces:
  - `registrarPagamentoBot({ agendamentoId, valor, formaPagamento, parcelas, valorAcrescimo, status, data, observacao, registradoPor }) => Promise<{ pagamento: object } | { motivo: 'nao_encontrado' }>`
  - `registrarPagamentoImportado({ agendamentoImportadoId, valor, formaPagamento, parcelas, valorAcrescimo, status, data, observacao, registradoPor }) => Promise<{ pagamento: object } | { motivo: 'nao_encontrado' | 'paciente_nao_vinculado' }>`
  - Ambos usados pela Task 5 (controllers).

- [ ] **Step 1: Escrever os testes (falhando)**

Adicionar ao final de `test/pagamentoModel.test.js`:

```js
import { registrarPagamentoBot, registrarPagamentoImportado } from "../src/models/pagamentoModel.js";

function mockarQuery(t, impl) {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return impl(sql, params);
  });
  return chamadas;
}

const CAMPOS_BASE = {
  valor: 150,
  formaPagamento: "pix",
  parcelas: null,
  valorAcrescimo: null,
  status: "pago",
  data: "2026-08-27",
  observacao: null,
  registradoPor: 7,
};

test("registrarPagamentoBot: agendamento inexistente retorna motivo nao_encontrado", async (t) => {
  mockarQuery(t, () => ({ rows: [] }));

  const resultado = await registrarPagamentoBot({ agendamentoId: 999, ...CAMPOS_BASE });

  assert.deepEqual(resultado, { motivo: "nao_encontrado" });
});

test("registrarPagamentoBot: caminho feliz insere usando o paciente_id do agendamento", async (t) => {
  const pagamentoEsperado = { id: 1, agendamento_id: 5, paciente_id: 42, valor: "150.00" };
  const chamadas = mockarQuery(t, (sql) => {
    if (sql.includes("INSERT INTO pagamentos")) return { rows: [pagamentoEsperado] };
    return { rows: [{ id: 5, paciente_id: 42 }] };
  });

  const resultado = await registrarPagamentoBot({ agendamentoId: 5, ...CAMPOS_BASE });

  assert.deepEqual(resultado, { pagamento: pagamentoEsperado });
  const insercao = chamadas.find(({ sql }) => sql.includes("INSERT INTO pagamentos"));
  assert.equal(insercao.params[0], 5); // agendamento_id
  assert.equal(insercao.params[1], 42); // paciente_id resolvido
});

test("registrarPagamentoImportado: agendamento importado inexistente retorna motivo nao_encontrado", async (t) => {
  mockarQuery(t, () => ({ rows: [] }));

  const resultado = await registrarPagamentoImportado({ agendamentoImportadoId: 999, ...CAMPOS_BASE });

  assert.deepEqual(resultado, { motivo: "nao_encontrado" });
});

test("registrarPagamentoImportado: sem paciente cadastrado com o telefone retorna motivo paciente_nao_vinculado", async (t) => {
  mockarQuery(t, (sql) => {
    if (sql.includes("FROM agendamentos_importados")) return { rows: [{ id: 8, telefone: "5511999998888" }] };
    if (sql.includes("FROM pacientes")) return { rows: [] }; // buscarPacientePorTelefone não acha ninguém
    return { rows: [] };
  });

  const resultado = await registrarPagamentoImportado({ agendamentoImportadoId: 8, ...CAMPOS_BASE });

  assert.deepEqual(resultado, { motivo: "paciente_nao_vinculado" });
});

test("registrarPagamentoImportado: caminho feliz resolve paciente_id pelo telefone e insere", async (t) => {
  const pagamentoEsperado = { id: 2, agendamento_importado_id: 8, paciente_id: 55, valor: "150.00" };
  const chamadas = mockarQuery(t, (sql) => {
    if (sql.includes("INSERT INTO pagamentos")) return { rows: [pagamentoEsperado] };
    if (sql.includes("FROM agendamentos_importados")) return { rows: [{ id: 8, telefone: "5511999998888" }] };
    if (sql.includes("FROM pacientes")) return { rows: [{ id: 55, telefone: "5511999998888" }] };
    return { rows: [] };
  });

  const resultado = await registrarPagamentoImportado({ agendamentoImportadoId: 8, ...CAMPOS_BASE });

  assert.deepEqual(resultado, { pagamento: pagamentoEsperado });
  const insercao = chamadas.find(({ sql }) => sql.includes("INSERT INTO pagamentos"));
  assert.equal(insercao.params[0], 8); // agendamento_importado_id
  assert.equal(insercao.params[1], 55); // paciente_id resolvido via telefone
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test test/pagamentoModel.test.js`
Expected: FAIL — `registrarPagamentoBot`/`registrarPagamentoImportado` não exportados.

- [ ] **Step 3: Implementar as duas funções**

Adicionar ao topo de `src/models/pagamentoModel.js` (junto dos outros imports):

```js
import { buscarPacientePorTelefone } from "./pacienteModel.js";
```

E ao final do arquivo:

```js
async function buscarAgendamentoBotParaPagamento(id) {
  const { rows } = await pool.query(`SELECT id, paciente_id FROM agendamentos WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

async function buscarImportadoParaPagamento(id) {
  const { rows } = await pool.query(`SELECT id, telefone FROM agendamentos_importados WHERE id = $1`, [id]);
  const importado = rows[0];
  if (!importado) return null;
  const paciente = await buscarPacientePorTelefone(importado.telefone);
  return { id: importado.id, pacienteId: paciente?.id ?? null };
}

function paramsInsercao({ pacienteId, valor, formaPagamento, parcelas, valorAcrescimo, status, data, observacao, registradoPor }) {
  return [pacienteId, valor, formaPagamento, parcelas, valorAcrescimo, status, data, observacao, registradoPor];
}

/**
 * Registra um pagamento (lançamento novo, extrato — nunca edita um
 * existente) pra um agendamento do bot. paciente_id vem direto de
 * agendamentos.paciente_id (FK já garantida). Sem transação: uma única
 * escrita, sem restrição de unicidade a proteger.
 */
export async function registrarPagamentoBot({
  agendamentoId,
  valor,
  formaPagamento,
  parcelas,
  valorAcrescimo,
  status,
  data,
  observacao,
  registradoPor,
}) {
  const agendamento = await buscarAgendamentoBotParaPagamento(agendamentoId);
  if (!agendamento) return { motivo: "nao_encontrado" };

  const { rows } = await pool.query(
    `INSERT INTO pagamentos
       (agendamento_id, paciente_id, valor, forma_pagamento, parcelas, valor_acrescimo, status, data, observacao, registrado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      agendamentoId,
      ...paramsInsercao({
        pacienteId: agendamento.paciente_id,
        valor,
        formaPagamento,
        parcelas,
        valorAcrescimo,
        status,
        data,
        observacao,
        registradoPor,
      }),
    ]
  );
  return { pagamento: rows[0] };
}

/**
 * Registra um pagamento pra um agendamento importado. agendamentos_importados
 * não tem FK pra pacientes — paciente_id é resolvido buscando pelo telefone
 * (buscarPacientePorTelefone, já existente). Se não achar, a escrita não
 * acontece (motivo paciente_nao_vinculado) — paciente_id é NOT NULL no banco.
 */
export async function registrarPagamentoImportado({
  agendamentoImportadoId,
  valor,
  formaPagamento,
  parcelas,
  valorAcrescimo,
  status,
  data,
  observacao,
  registradoPor,
}) {
  const importado = await buscarImportadoParaPagamento(agendamentoImportadoId);
  if (!importado) return { motivo: "nao_encontrado" };
  if (!importado.pacienteId) return { motivo: "paciente_nao_vinculado" };

  const { rows } = await pool.query(
    `INSERT INTO pagamentos
       (agendamento_importado_id, paciente_id, valor, forma_pagamento, parcelas, valor_acrescimo, status, data, observacao, registrado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      agendamentoImportadoId,
      ...paramsInsercao({
        pacienteId: importado.pacienteId,
        valor,
        formaPagamento,
        parcelas,
        valorAcrescimo,
        status,
        data,
        observacao,
        registradoPor,
      }),
    ]
  );
  return { pagamento: rows[0] };
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test test/pagamentoModel.test.js`
Expected: PASS (10/10 no arquivo todo).

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: 0 erros.

- [ ] **Step 6: Commit**

```bash
git add src/models/pagamentoModel.js test/pagamentoModel.test.js
git commit -m "feat: registrarPagamentoBot e registrarPagamentoImportado"
```

---

## Task 4: Model — relatório mensal (`buscarRelatorioMensal`)

**Files:**
- Modify: `src/models/pagamentoModel.js`
- Test: `test/pagamentoModel.test.js`

**Interfaces:**
- Consumes: `dayjs` de `src/utils/dayjs.js`.
- Produces: `buscarRelatorioMensal({ mes } = {}) => Promise<{ mes: string, totalGeral: { total, quantidade }, porTipoAtendimento: Array<{ tipo_atendimento, total, quantidade }>, porFormaPagamento: Array<{ forma_pagamento, total, quantidade }>, porStatus: Array<{ status, total, quantidade }> }>` — usado pela Task 5 (`telaRelatorioFinanceiro`).

- [ ] **Step 1: Escrever os testes (falhando)**

Adicionar ao final de `test/pagamentoModel.test.js`:

```js
import dayjs from "../src/utils/dayjs.js";
import { buscarRelatorioMensal } from "../src/models/pagamentoModel.js";

test("buscarRelatorioMensal: com mes inválido, usa o mês atual", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push(params);
    return { rows: [] };
  });

  const relatorio = await buscarRelatorioMensal({ mes: "não-é-um-mes" });

  // Mesmo fuso usado por mesSeguro() na implementação — usar new Date()
  // puro (UTC) aqui criaria um teste flaky nas ~3h de virada de mês em que
  // UTC já avançou de dia mas America/Sao_Paulo ainda não (fuso -03:00).
  const mesAtual = dayjs().tz("America/Sao_Paulo").format("YYYY-MM");
  assert.equal(relatorio.mes, mesAtual);
  for (const params of chamadas) {
    assert.equal(params[0], `${mesAtual}-01`);
  }
});

test("buscarRelatorioMensal: com mes válido, usa o intervalo certo (início inclusivo, fim exclusivo)", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push(params);
    return { rows: [] };
  });

  await buscarRelatorioMensal({ mes: "2026-02" });

  for (const params of chamadas) {
    assert.equal(params[0], "2026-02-01");
    assert.equal(params[1], "2026-03-01"); // fevereiro tem 28/29 dias — fim exclusivo é sempre "primeiro dia do mês seguinte"
  }
});

test("buscarRelatorioMensal: monta o objeto com os 4 grupos a partir das 4 queries", async (t) => {
  let chamada = 0;
  t.mock.method(pool, "query", async () => {
    chamada += 1;
    if (chamada === 1) return { rows: [{ total: "300.00", quantidade: "2" }] };
    if (chamada === 2) return { rows: [{ tipo_atendimento: "fisioterapia", total: "300.00", quantidade: "2" }] };
    if (chamada === 3) return { rows: [{ forma_pagamento: "pix", total: "300.00", quantidade: "2" }] };
    return { rows: [{ status: "pago", total: "300.00", quantidade: "2" }] };
  });

  const relatorio = await buscarRelatorioMensal({ mes: "2026-08" });

  assert.deepEqual(relatorio.totalGeral, { total: "300.00", quantidade: "2" });
  assert.deepEqual(relatorio.porTipoAtendimento, [{ tipo_atendimento: "fisioterapia", total: "300.00", quantidade: "2" }]);
  assert.deepEqual(relatorio.porFormaPagamento, [{ forma_pagamento: "pix", total: "300.00", quantidade: "2" }]);
  assert.deepEqual(relatorio.porStatus, [{ status: "pago", total: "300.00", quantidade: "2" }]);
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test test/pagamentoModel.test.js`
Expected: FAIL — `buscarRelatorioMensal` não exportado.

- [ ] **Step 3: Implementar `buscarRelatorioMensal`**

Adicionar ao topo de `src/models/pagamentoModel.js`:

```js
import dayjs from "../utils/dayjs.js";
```

E ao final do arquivo:

```js
const REGEX_MES = /^\d{4}-\d{2}$/;

function mesSeguro(mes) {
  if (typeof mes === "string" && REGEX_MES.test(mes) && dayjs(`${mes}-01`, "YYYY-MM-DD").isValid()) {
    return mes;
  }
  return dayjs().tz("America/Sao_Paulo").format("YYYY-MM");
}

/**
 * Totais agregados do mês pra tela /financeiro/relatorio. 4 queries
 * separadas (total geral + 3 breakdowns) em vez de uma só com
 * GROUPING SETS — mais simples de ler e testar, sem precedente de SQL
 * avançado neste projeto. O breakdown por tipo_atendimento precisa de
 * COALESCE porque só uma das duas origens (agendamentos/agendamentos_importados)
 * está preenchida por linha.
 */
export async function buscarRelatorioMensal({ mes } = {}) {
  const mesResolvido = mesSeguro(mes);
  const inicio = `${mesResolvido}-01`;
  const fimExclusivo = dayjs(inicio, "YYYY-MM-DD").add(1, "month").format("YYYY-MM-DD");

  const [totalGeral, porTipo, porForma, porStatus] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(valor), 0) AS total, COUNT(*) AS quantidade
       FROM pagamentos WHERE data >= $1 AND data < $2`,
      [inicio, fimExclusivo]
    ),
    pool.query(
      `SELECT COALESCE(a.tipo_atendimento, ai.tipo_atendimento) AS tipo_atendimento,
              COALESCE(SUM(pg.valor), 0) AS total, COUNT(*) AS quantidade
       FROM pagamentos pg
       LEFT JOIN agendamentos a ON a.id = pg.agendamento_id
       LEFT JOIN agendamentos_importados ai ON ai.id = pg.agendamento_importado_id
       WHERE pg.data >= $1 AND pg.data < $2
       GROUP BY COALESCE(a.tipo_atendimento, ai.tipo_atendimento)`,
      [inicio, fimExclusivo]
    ),
    pool.query(
      `SELECT forma_pagamento, COALESCE(SUM(valor), 0) AS total, COUNT(*) AS quantidade
       FROM pagamentos WHERE data >= $1 AND data < $2
       GROUP BY forma_pagamento`,
      [inicio, fimExclusivo]
    ),
    pool.query(
      `SELECT status, COALESCE(SUM(valor), 0) AS total, COUNT(*) AS quantidade
       FROM pagamentos WHERE data >= $1 AND data < $2
       GROUP BY status`,
      [inicio, fimExclusivo]
    ),
  ]);

  return {
    mes: mesResolvido,
    totalGeral: totalGeral.rows[0] ?? { total: 0, quantidade: 0 },
    porTipoAtendimento: porTipo.rows,
    porFormaPagamento: porForma.rows,
    porStatus: porStatus.rows,
  };
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test test/pagamentoModel.test.js`
Expected: PASS (13/13 no arquivo todo).

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: 0 erros.

- [ ] **Step 6: Commit**

```bash
git add src/models/pagamentoModel.js test/pagamentoModel.test.js
git commit -m "feat: buscarRelatorioMensal agrega pagamentos por mês"
```

---

## Task 5: Controller (`telaFinanceiro`, `processarPagamento*`, `telaRelatorioFinanceiro`)

**Files:**
- Modify: `src/controllers/dashboardController.js`
- Test: `test/dashboardControllerFinanceiro.test.js` (novo arquivo — mantém os outros arquivos de teste do controller focados no que já cobrem)

**Interfaces:**
- Consumes: `listarFinanceiro`, `registrarPagamentoBot`, `registrarPagamentoImportado`, `buscarRelatorioMensal` (Tasks 2/3/4); `validarData` (`src/utils/validacao.js`); `req.usuarioAtual.id` (já injetado por `exigirLogin`).
- Produces: `telaFinanceiro(req, res)`, `processarPagamentoAgendamento(req, res)`, `processarPagamentoImportado(req, res)`, `telaRelatorioFinanceiro(req, res)` — usados pela Task 6 (rotas).

- [ ] **Step 1: Escrever os testes (falhando)**

```js
// test/dashboardControllerFinanceiro.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import {
  telaFinanceiro,
  processarPagamentoAgendamento,
  processarPagamentoImportado,
  telaRelatorioFinanceiro,
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

const CORPO_VALIDO = {
  valor: "150",
  forma_pagamento: "pix",
  status: "pago",
  data: "2026-08-27",
};

test("processarPagamentoAgendamento: valor inválido responde 400 sem consultar o banco", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await processarPagamentoAgendamento(
    criarRequisicao({ params: { id: "5" }, body: { ...CORPO_VALIDO, valor: "0" } }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(consultas.length, 0);
});

test("processarPagamentoAgendamento: forma_pagamento inválida responde 400", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const res = criarRespostaFalsa();

  await processarPagamentoAgendamento(
    criarRequisicao({ params: { id: "5" }, body: { ...CORPO_VALIDO, forma_pagamento: "boleto" } }),
    res
  );

  assert.equal(res.statusCode, 400);
});

test("processarPagamentoAgendamento: id não-numérico responde 404 sem consultar o banco", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await processarPagamentoAgendamento(criarRequisicao({ params: { id: "abc" }, body: CORPO_VALIDO }), res);

  assert.equal(res.statusCode, 404);
  assert.equal(consultas.length, 0);
});

test("processarPagamentoAgendamento: agendamento inexistente responde 404", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const res = criarRespostaFalsa();

  await processarPagamentoAgendamento(criarRequisicao({ params: { id: "999" }, body: CORPO_VALIDO }), res);

  assert.equal(res.statusCode, 404);
});

test("processarPagamentoAgendamento: caminho feliz normaliza parcelas/acréscimo pra null quando forma é pix e redireciona", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("INSERT INTO pagamentos")) return { rows: [{ id: 1 }] };
    return { rows: [{ id: 5, paciente_id: 42 }] };
  });
  const res = criarRespostaFalsa();

  await processarPagamentoAgendamento(
    criarRequisicao({
      params: { id: "5" },
      body: { ...CORPO_VALIDO, parcelas: "3", valor_acrescimo: "10" }, // pix não deveria usar isso
    }),
    res
  );

  assert.equal(res.redirectedTo, "/financeiro");
  const insercao = chamadas.find(({ sql }) => sql.includes("INSERT INTO pagamentos"));
  assert.equal(insercao.params[4], null); // parcelas
  assert.equal(insercao.params[5], null); // valor_acrescimo
});

test("processarPagamentoAgendamento: cartão com parcelas/acréscimo válidos passa os valores", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("INSERT INTO pagamentos")) return { rows: [{ id: 1 }] };
    return { rows: [{ id: 5, paciente_id: 42 }] };
  });
  const res = criarRespostaFalsa();

  await processarPagamentoAgendamento(
    criarRequisicao({
      params: { id: "5" },
      body: { ...CORPO_VALIDO, forma_pagamento: "cartao", parcelas: "3", valor_acrescimo: "10.50" },
    }),
    res
  );

  const insercao = chamadas.find(({ sql }) => sql.includes("INSERT INTO pagamentos"));
  assert.equal(insercao.params[4], 3);
  assert.equal(insercao.params[5], 10.5);
});

test("processarPagamentoImportado: paciente_nao_vinculado responde 400 com mensagem específica", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("FROM agendamentos_importados")) return { rows: [{ id: 8, telefone: "5511999998888" }] };
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await processarPagamentoImportado(criarRequisicao({ params: { id: "8" }, body: CORPO_VALIDO }), res);

  assert.equal(res.statusCode, 400);
  assert.match(res.corpo, /telefone não bate/);
});

test("processarPagamentoImportado: caminho feliz redireciona pra /financeiro", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("INSERT INTO pagamentos")) return { rows: [{ id: 2 }] };
    if (sql.includes("FROM agendamentos_importados")) return { rows: [{ id: 8, telefone: "5511999998888" }] };
    if (sql.includes("FROM pacientes")) return { rows: [{ id: 55 }] };
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await processarPagamentoImportado(criarRequisicao({ params: { id: "8" }, body: CORPO_VALIDO }), res);

  assert.equal(res.redirectedTo, "/financeiro");
});

test("telaFinanceiro: renderiza financeiro/lista com os itens combinados", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("agendamentos_importados")) return { rows: [] };
    return { rows: [{ id: 1, origem: "bot", data: "2026-08-20", hora: "10:00:00", pagamentos: [] }] };
  });
  const res = criarRespostaFalsa();

  await telaFinanceiro(criarRequisicao({ query: {} }), res);

  assert.equal(res.viewRenderizada, "financeiro/lista");
  assert.equal(res.dadosDaView.itens.length, 1);
});

test("telaRelatorioFinanceiro: renderiza financeiro/relatorio com o relatório do mês pedido", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const res = criarRespostaFalsa();

  await telaRelatorioFinanceiro(criarRequisicao({ query: { mes: "2026-08" } }), res);

  assert.equal(res.viewRenderizada, "financeiro/relatorio");
  assert.equal(res.dadosDaView.relatorio.mes, "2026-08");
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `node --test test/dashboardControllerFinanceiro.test.js`
Expected: FAIL — funções não exportadas.

- [ ] **Step 3: Implementar os controllers**

Em `src/controllers/dashboardController.js`, adicionar ao topo do arquivo:

```js
import {
  listarFinanceiro,
  registrarPagamentoBot,
  registrarPagamentoImportado,
  buscarRelatorioMensal,
} from "../models/pagamentoModel.js";
import { validarData } from "../utils/validacao.js";
```

E ao final do arquivo:

```js
const FORMA_PAGAMENTO_VALIDA = ["pix", "cartao"];
const STATUS_PAGAMENTO_VALIDO = ["pago", "pendente", "aguardando_reembolso"];

function idValido(valorBruto) {
  const id = Number.parseInt(valorBruto, 10);
  return Number.isInteger(id) && id >= 1 ? id : null;
}

function mensagemErroPagamento(motivo) {
  if (motivo === "paciente_nao_vinculado") {
    return "Não foi possível encontrar o paciente vinculado a este agendamento importado (telefone não bate com nenhum cadastro).";
  }
  return "Não foi possível registrar o pagamento.";
}

/**
 * Valida e normaliza o corpo do formulário de pagamento. Retorna null se
 * algo obrigatório for inválido — parcelas/valor_acrescimo são sempre
 * normalizados pra null quando forma_pagamento não é 'cartao' (normalização
 * silenciosa, não erro, mesmo padrão do observacao_sessao do sub-projeto 3).
 */
function validarCamposPagamento(body) {
  const valor = Number(body.valor);
  const formaPagamento = body.forma_pagamento;
  const status = body.status;
  const data = body.data;

  if (!Number.isFinite(valor) || valor <= 0) return null;
  if (!FORMA_PAGAMENTO_VALIDA.includes(formaPagamento)) return null;
  if (!STATUS_PAGAMENTO_VALIDO.includes(status)) return null;
  if (!validarData(data)) return null;

  const ehCartao = formaPagamento === "cartao";

  const parcelasBrutas = Number(body.parcelas);
  const parcelas = ehCartao && Number.isInteger(parcelasBrutas) && parcelasBrutas > 0 ? parcelasBrutas : null;

  const valorAcrescimoBruto = Number(body.valor_acrescimo);
  const valorAcrescimo =
    ehCartao && Number.isFinite(valorAcrescimoBruto) && valorAcrescimoBruto >= 0 ? valorAcrescimoBruto : null;

  return {
    valor,
    formaPagamento,
    status,
    data,
    parcelas,
    valorAcrescimo,
    observacao: body.observacao?.trim() || null,
  };
}

export async function telaFinanceiro(req, res) {
  const { data, limite, offset } = req.query;
  const itens = await listarFinanceiro({ data, limite, offset });
  res.render("financeiro/lista", { itens, filtroData: validarData(data) ? data : null });
}

export async function processarPagamentoAgendamento(req, res) {
  const id = idValido(req.params.id);
  if (!id) {
    return res.status(404).send("Agendamento não encontrado.");
  }

  const campos = validarCamposPagamento(req.body ?? {});
  if (!campos) {
    return res.status(400).send("Dados de pagamento inválidos.");
  }

  const resultado = await registrarPagamentoBot({
    agendamentoId: id,
    ...campos,
    registradoPor: req.usuarioAtual.id,
  });

  if (resultado.motivo === "nao_encontrado") {
    return res.status(404).send("Agendamento não encontrado.");
  }
  if (resultado.motivo) {
    return res.status(400).send(mensagemErroPagamento(resultado.motivo));
  }
  res.redirect("/financeiro");
}

export async function processarPagamentoImportado(req, res) {
  const id = idValido(req.params.id);
  if (!id) {
    return res.status(404).send("Agendamento não encontrado.");
  }

  const campos = validarCamposPagamento(req.body ?? {});
  if (!campos) {
    return res.status(400).send("Dados de pagamento inválidos.");
  }

  const resultado = await registrarPagamentoImportado({
    agendamentoImportadoId: id,
    ...campos,
    registradoPor: req.usuarioAtual.id,
  });

  if (resultado.motivo === "nao_encontrado") {
    return res.status(404).send("Agendamento não encontrado.");
  }
  if (resultado.motivo) {
    return res.status(400).send(mensagemErroPagamento(resultado.motivo));
  }
  res.redirect("/financeiro");
}

export async function telaRelatorioFinanceiro(req, res) {
  const relatorio = await buscarRelatorioMensal({ mes: req.query.mes });
  res.render("financeiro/relatorio", { relatorio });
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `node --test test/dashboardControllerFinanceiro.test.js`
Expected: PASS (10/10).

- [ ] **Step 5: Rodar a suíte inteira + lint**

Run: `npm test && npm run lint`
Expected: todos os testes passam, 0 erros de lint.

- [ ] **Step 6: Commit**

```bash
git add src/controllers/dashboardController.js test/dashboardControllerFinanceiro.test.js
git commit -m "feat: controllers de financeiro (telaFinanceiro, processarPagamento*, relatório)"
```

---

## Task 6: Rotas

**Files:**
- Modify: `src/routes/dashboardRoutes.js`

**Interfaces:**
- Consumes: `telaFinanceiro`, `processarPagamentoAgendamento`, `processarPagamentoImportado`, `telaRelatorioFinanceiro` (Task 5); `exigirLogin`, `exigirCsrf` (já existentes).
- Produces: `GET /financeiro`, `POST /financeiro/agendamento/:id`, `POST /financeiro/importado/:id`, `GET /financeiro/relatorio` — usados pela Task 7 (view) e pela verificação manual final.

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
  telaFinanceiro,
  processarPagamentoAgendamento,
  processarPagamentoImportado,
  telaRelatorioFinanceiro,
} from "../controllers/dashboardController.js";
```

E adicionar, depois das rotas de `/presenca`:

```js
router.get("/financeiro", asyncHandler(exigirLogin), asyncHandler(telaFinanceiro));
router.get("/financeiro/relatorio", asyncHandler(exigirLogin), asyncHandler(telaRelatorioFinanceiro));
router.post(
  "/financeiro/agendamento/:id",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarPagamentoAgendamento)
);
router.post(
  "/financeiro/importado/:id",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarPagamentoImportado)
);
```

`/financeiro/relatorio` precisa vir **antes** de qualquer rota `/financeiro/:algo` que pudesse colidir — não há colisão aqui (as rotas de `POST` têm prefixo `/agendamento`/`/importado`), mas a ordem acima evita ambiguidade se um segmento futuro for adicionado.

- [ ] **Step 2: Lint (sem teste dedicado de rotas neste projeto — mesma decisão do sub-projeto 3)**

Run: `npm run lint`
Expected: 0 erros.

- [ ] **Step 3: Commit**

```bash
git add src/routes/dashboardRoutes.js
git commit -m "feat: rotas /financeiro no dashboard"
```

---

## Task 7: Views (`financeiro/lista.ejs`, `financeiro/relatorio.ejs`) + link de navegação

**Files:**
- Create: `src/views/financeiro/lista.ejs`
- Create: `src/views/financeiro/relatorio.ejs`
- Modify: `src/views/partials/header.ejs`

**Interfaces:**
- Consumes: `itens`, `filtroData` (`telaFinanceiro`, Task 5); `relatorio` (`telaRelatorioFinanceiro`, Task 5); `csrfToken`/`usuarioAtual` (já injetados em `res.locals` por `exigirLogin`).

- [ ] **Step 1: Criar a lista**

```html
<!-- src/views/financeiro/lista.ejs -->
<%- include("../partials/header", { titulo: "Financeiro" }) %>
<h1>Financeiro</h1>
<p><a href="/financeiro/relatorio">Ver relatório mensal</a></p>
<form method="get" action="/financeiro">
  <label>Filtrar por data<input type="date" name="data" value="<%= filtroData ?? '' %>" /></label>
  <button type="submit">Filtrar</button>
  <% if (filtroData) { %>
  <a href="/financeiro">Limpar filtro</a>
  <% } %>
</form>
<table>
  <thead>
    <tr>
      <th>Data</th>
      <th>Hora</th>
      <th>Paciente</th>
      <th>Tipo</th>
      <th>Origem</th>
      <th>Pagamentos</th>
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
        <% if (item.pagamentos.length) { %>
        <ul>
          <% item.pagamentos.forEach((p) => { %>
          <li>
            R$ <%= p.valor %> — <%= p.forma_pagamento %><% if (p.parcelas) { %> (<%= p.parcelas %>x, +R$ <%= p.valor_acrescimo %>)<% } %>
            — <%= p.status %> — <%= p.data %>
            <% if (p.observacao) { %><br /><em><%= p.observacao %></em><% } %>
          </li>
          <% }) %>
        </ul>
        <% } %>
        <form
          method="post"
          action="/financeiro/<%= item.origem === 'bot' ? 'agendamento' : 'importado' %>/<%= item.id %>"
        >
          <input type="hidden" name="_csrf" value="<%= csrfToken %>" />
          <label>Valor<input type="number" name="valor" step="0.01" min="0.01" required /></label>
          <label
            >Forma
            <select name="forma_pagamento" required>
              <option value="pix">Pix</option>
              <option value="cartao">Cartão</option>
            </select>
          </label>
          <label>Parcelas (só cartão)<input type="number" name="parcelas" min="1" /></label>
          <label>Acréscimo (só cartão)<input type="number" name="valor_acrescimo" step="0.01" min="0" /></label>
          <label
            >Status
            <select name="status" required>
              <option value="pago">Pago</option>
              <option value="pendente">Pendente</option>
              <option value="aguardando_reembolso">Aguardando reembolso</option>
            </select>
          </label>
          <label>Data do pagamento<input type="date" name="data" required /></label>
          <label>Observação<input type="text" name="observacao" /></label>
          <button type="submit">Adicionar pagamento</button>
        </form>
      </td>
    </tr>
    <% }) %>
  </tbody>
</table>
<%- include("../partials/footer") %>
```

- [ ] **Step 2: Criar o relatório**

```html
<!-- src/views/financeiro/relatorio.ejs -->
<%- include("../partials/header", { titulo: "Relatório financeiro" }) %>
<h1>Relatório financeiro — <%= relatorio.mes %></h1>
<p><a href="/financeiro">Voltar pro financeiro</a></p>

<h2>Total geral</h2>
<p>R$ <%= relatorio.totalGeral.total %> (<%= relatorio.totalGeral.quantidade %> lançamentos)</p>

<h2>Por tipo de atendimento</h2>
<table>
  <thead>
    <tr>
      <th>Tipo</th>
      <th>Total</th>
      <th>Quantidade</th>
    </tr>
  </thead>
  <tbody>
    <% relatorio.porTipoAtendimento.forEach((linha) => { %>
    <tr>
      <td><%= linha.tipo_atendimento %></td>
      <td>R$ <%= linha.total %></td>
      <td><%= linha.quantidade %></td>
    </tr>
    <% }) %>
  </tbody>
</table>

<h2>Por forma de pagamento</h2>
<table>
  <thead>
    <tr>
      <th>Forma</th>
      <th>Total</th>
      <th>Quantidade</th>
    </tr>
  </thead>
  <tbody>
    <% relatorio.porFormaPagamento.forEach((linha) => { %>
    <tr>
      <td><%= linha.forma_pagamento %></td>
      <td>R$ <%= linha.total %></td>
      <td><%= linha.quantidade %></td>
    </tr>
    <% }) %>
  </tbody>
</table>

<h2>Por status</h2>
<table>
  <thead>
    <tr>
      <th>Status</th>
      <th>Total</th>
      <th>Quantidade</th>
    </tr>
  </thead>
  <tbody>
    <% relatorio.porStatus.forEach((linha) => { %>
    <tr>
      <td><%= linha.status %></td>
      <td>R$ <%= linha.total %></td>
      <td><%= linha.quantidade %></td>
    </tr>
    <% }) %>
  </tbody>
</table>
<%- include("../partials/footer") %>
```

- [ ] **Step 3: Adicionar o link no menu**

Em `src/views/partials/header.ejs`, mudar:

```html
<a href="/agendamentos">Agendamentos</a>
<a href="/pacientes">Pacientes</a>
<a href="/presenca">Presença</a>
<a href="/usuarios/novo">Novo usuário</a>
```

para:

```html
<a href="/agendamentos">Agendamentos</a>
<a href="/pacientes">Pacientes</a>
<a href="/presenca">Presença</a>
<a href="/financeiro">Financeiro</a>
<a href="/usuarios/novo">Novo usuário</a>
```

- [ ] **Step 4: Rodar a suíte inteira + lint**

Run: `npm test && npm run lint`
Expected: todos os testes passam, 0 erros.

- [ ] **Step 5: Commit**

```bash
git add src/views/financeiro/ src/views/partials/header.ejs
git commit -m "feat: telas /financeiro e /financeiro/relatorio no dashboard"
```

---

## Verificação manual e aplicação da migration (fora das tasks — requer aprovação explícita)

**Antes de considerar este sub-projeto pronto pra mergear:**

1. **Não aplicar `012_financeiro.sql` contra o banco sem antes reportar o plano ao usuário e receber aprovação explícita** — este projeto não tem banco de dev separado do de produção.
2. Depois de aprovado e aplicado: importar `src/app.js` direto (nunca `server.js`, pra não armar os crons de lembrete/WhatsApp/OpenAI) numa porta local, com dados de teste claramente marcados, e confirmar manualmente:
   - Lançar pagamento num agendamento do bot e num importado, incluindo um caso `pix` (parcelas/acréscimo viram `null` mesmo se enviados) e um `cartao` com parcelas/acréscimo.
   - Lançar **dois** pagamentos no mesmo agendamento e confirmar que os dois aparecem (extrato, não substituição).
   - Lançar pagamento num agendamento **futuro** (adiantamento) e confirmar que não é bloqueado.
   - Tentar lançar num agendamento importado cujo telefone não bate com nenhum paciente cadastrado (se existir um caso assim nos dados reais, ou criar um de teste) — confirmar mensagem de erro clara, não um 500.
   - `GET /financeiro/relatorio?mes=YYYY-MM` bate com a soma manual dos pagamentos de teste lançados naquele mês.
   - `?data=YYYY-MM-DD` filtra corretamente a listagem.
3. Só depois dessa verificação: seguir pro fluxo de revisão do branch inteiro + merge em `main` (`superpowers:finishing-a-development-branch`).
