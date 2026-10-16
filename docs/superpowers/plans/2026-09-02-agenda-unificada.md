# Agenda unificada (Agendamentos + Presença) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir as telas somente-leitura `/agendamentos` e `/presenca` por uma única tela `/agendamentos` com filtros (data, status, tipo de atendimento, paciente/telefone) e ações reais por linha: cancelar, remarcar e marcar presença.

**Architecture:** Uma nova função de modelo (`listarAgendaUnificada`) une `agendamentos` (bot) e `agendamentos_importados` (sistema de agenda anterior) numa listagem só, com paginação em memória (mesma técnica já usada em `listarPresenca`). A sequência delicada de remarcação (criar evento novo → gravar no banco → cancelar evento antigo, com reversão em caso de falha) é extraída de `src/functions/remarcarAgendamento.js` para um serviço compartilhado (`remarcacaoService.js`), usado tanto pelo bot quanto por um novo controller do dashboard. Cancelamento pelo dashboard é uma ação direta (sem serviço compartilhado, é só duas chamadas). As rotas e a view de `/presenca` são absorvidas dentro de `/agendamentos`.

**Tech Stack:** Node.js (ESM), Express, EJS, `pg` (Postgres/Neon), `node:test` + `node:assert/strict` (mock de `pool.query`/`pool.connect` via `t.mock.method`, sem Postgres real), Google Calendar API (`googleapis`, já configurado em `calendarService.js`).

**Spec:** [docs/superpowers/specs/2026-09-02-agenda-unificada-design.md](../specs/2026-09-02-agenda-unificada-design.md)

## Global Constraints

- Sem migration nova — `agendamentos.status` já aceita os 5 valores e `registros_atendimento` já existe (migration 011).
- Nenhuma mudança de comportamento do bot: a extração de `remarcarAgendamento.js` para o serviço compartilhado preserva exatamente as mesmas mensagens e códigos de erro que já existem hoje.
- Cancelar/remarcar só existem para agendamentos de origem `bot`; `agendamentos_importados` nunca ganha essas ações (sem `status` nem vínculo com o Calendar).
- Recepção e administradora têm acesso igual a todas as ações desta tela — nenhuma rota nova usa `exigirPapel`.
- Toda escrita no banco feita a partir de uma ação do dashboard usa CSRF (`exigirCsrf`), mesmo padrão já usado em todo o resto do dashboard.
- Zero JavaScript no cliente — mesmo padrão zero-JS já usado em todo o dashboard hoje. O fluxo de remarcação em 2 passos é feito com 2 requisições GET reais (não AJAX), numa página dedicada (`agendamentos/remarcar.ejs`), o mesmo padrão já usado por `pacientes/ficha.ejs`/`controle-sessoes.ejs` (páginas próprias linkadas da listagem, não inline).
- Erros de validação nas novas rotas POST respondem com `res.status(4xx).send("mensagem em português")`, mesmo padrão já usado em `processarCriarPacote`/`processarCancelarPacote`/`processarEstorno` — sem flash messages, sem re-render com erro inline.

---

## Contexto de arquivos existentes (ler antes de começar)

- `src/models/agendamentoModel.js` — já tem `STATUS_VALIDOS`, `cancelarAgendamento(id)` (sem guarda de status — usada pelo bot, não mexer), `remarcarAgendamento({id, data, hora, googleEventId})` (grava no banco, não mexer na assinatura).
- `src/models/registroAtendimentoModel.js` — tem `jaPassouSql(alias)` local (vai virar compartilhado) e `listarPresenca`/`registrarPresencaBot`/`registrarPresencaImportado` (não mexer nessas três).
- `src/services/calendarService.js` — `listarHorariosDisponiveis({data, tipoAtendimento})`, `criarEventoAgendamento({...})` (lança erro com `.codigo` em `FORA_DO_HORARIO_FUNCIONAMENTO`/`DATA_NO_PASSADO`/`FORA_DO_LIMITE_DIAS`/`HORARIO_LOTADO`), `cancelarEventoAgendamento(googleEventId)`.
- `src/functions/remarcarAgendamento.js` — function-calling do bot, será refatorada na Task 4.
- `src/controllers/dashboardController.js` — `telaAgendamentos`, `telaPresenca`, `processarPresencaAgendamento`, `processarPresencaImportado`, `gerarLaudoBot`, `gerarLaudoImportado` já existem; `telaAgendamentos`/`telaPresenca` serão reescritas/removidas na Task 7.
- `src/routes/dashboardRoutes.js` — rotas de `/agendamentos` e `/presenca` serão reescritas na Task 7.
- `src/views/agendamentos/lista.ejs`, `src/views/presenca/lista.ejs`, `src/views/partials/header.ejs` — reescritas/removidas na Task 7.
- Padrão de teste do projeto: mockar `pool.query`/`pool.connect` via `t.mock.method(pool, "query"/"connect", ...)` (ver `test/dashboardControllerPresenca.test.js`); quando a função sob teste chama outra função/serviço (não uma query direta), usar injeção de dependência por parâmetro opcional com default (ver `telaFichaPaciente(req, res, {buscarPaciente = buscarPacientePorId} = {})` em `dashboardController.js`) — este projeto nunca mocka exports de função soltos via `t.mock.method` num module namespace, só métodos de objeto (`pool`, `evolutionApi`, `openai.chat.completions`).

---

### Task 1: Extrair `jaPassouSql` para um util compartilhado

**Files:**
- Create: `src/utils/sqlAgenda.js`
- Modify: `src/models/registroAtendimentoModel.js` (remove a função local, importa do novo util)
- Test: nenhum teste novo — a suíte existente de `registroAtendimentoModel` já cobre o comportamento, que não muda.

**Interfaces:**
- Produces: `jaPassouSql(alias: string): string` — fragmento SQL booleano "já aconteceu", usado por `registroAtendimentoModel.js` (Task 1) e pelo novo `listarAgendaUnificada` (Task 2).

- [ ] **Step 1: Criar o util compartilhado**

```js
// src/utils/sqlAgenda.js

/**
 * Fragmento SQL "já aconteceu" pra uma tabela com colunas data/hora — usa
 * conversão explícita de fuso (America/Sao_Paulo) em vez de CURRENT_TIME
 * puro, porque o fuso da sessão do Postgres não é garantido ser o da
 * clínica (ex: Neon roda em UTC por padrão). Compartilhado entre a fila de
 * presença (registroAtendimentoModel) e a agenda unificada (agendamentoModel)
 * — mesma regra, duas listagens diferentes.
 */
export function jaPassouSql(alias) {
  return `(${alias}.data < CURRENT_DATE OR (${alias}.data = CURRENT_DATE AND ${alias}.hora <= (now() AT TIME ZONE 'America/Sao_Paulo')::time))`;
}
```

- [ ] **Step 2: Atualizar `registroAtendimentoModel.js` para importar em vez de definir localmente**

Em `src/models/registroAtendimentoModel.js`:
- Remover a função `function jaPassouSql(alias) { ... }` (linhas atuais ~11-13, junto com o comentário acima dela).
- Adicionar ao topo do arquivo: `import { jaPassouSql } from "../utils/sqlAgenda.js";`

O resto do arquivo (`buscarItensBot`, `buscarItensImportados`, etc.) continua chamando `jaPassouSql("a")`/`jaPassouSql("ai")` exatamente igual — só muda de onde a função vem.

- [ ] **Step 3: Rodar a suíte existente pra confirmar que nada quebrou**

Run: `npm test 2>&1 | tail -15`
Expected: `# fail 0` (mesmo total de testes de antes, 355 passando)

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: 0 erros (o warning pré-existente em `calendarService.js:108` continua, é esperado)

- [ ] **Step 5: Commit**

```bash
git add src/utils/sqlAgenda.js src/models/registroAtendimentoModel.js
git commit -m "refactor: extrai jaPassouSql para util compartilhado"
```

---

### Task 2: Modelo — listagem unificada e busca por id

**Files:**
- Modify: `src/models/agendamentoModel.js` (adiciona `buscarAgendamentoComPacientePorId`, `cancelarAgendamentoConfirmado`, `listarAgendaUnificada` + 2 helpers privados)
- Test: Create `test/agendamentoModelUnificada.test.js`

**Interfaces:**
- Consumes: `pool` de `../db/pool.js`; `limiteSeguroListagem`/`offsetSeguroListagem` de `../utils/paginacao.js`; `validarData`/`validarTipoAtendimento` de `../utils/validacao.js`; `jaPassouSql` de `../utils/sqlAgenda.js` (Task 1); `STATUS_VALIDOS` (já existe no próprio arquivo).
- Produces:
  - `buscarAgendamentoComPacientePorId(id: number): Promise<Agendamento|null>` — usado pelas Tasks 5 e 6.
  - `cancelarAgendamentoConfirmado(id: number): Promise<Agendamento|null>` — usado pela Task 5.
  - `listarAgendaUnificada({data, status, tipoAtendimento, busca, limite, offset}): Promise<Array<{id, origem, paciente_nome, paciente_telefone, tipo_atendimento, data, hora, status, google_event_id, ja_passou, presenca, observacao_sessao, registrado_por, registrado_em, registrado_por_nome}>>` — usado pela Task 7.

- [ ] **Step 1: Escrever os testes (falhando) de `listarAgendaUnificada`**

```js
// test/agendamentoModelUnificada.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import {
  listarAgendaUnificada,
  buscarAgendamentoComPacientePorId,
  cancelarAgendamentoConfirmado,
} from "../src/models/agendamentoModel.js";

function mockarQuery(t, { bot = [], importado = [] } = {}) {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("agendamentos_importados")) return { rows: importado };
    return { rows: bot };
  });
  return chamadas;
}

test("listarAgendaUnificada: sem filtros, busca as duas origens e ordena por data/hora crescente", async (t) => {
  const chamadas = mockarQuery(t, {
    bot: [{ id: 1, origem: "bot", data: "2026-09-05", hora: "09:00:00" }],
    importado: [{ id: 2, origem: "importado", data: "2026-09-03", hora: "08:00:00" }],
  });

  const resultado = await listarAgendaUnificada({});

  assert.equal(chamadas.length, 2, "deve consultar as duas origens");
  assert.deepEqual(
    resultado.map((r) => r.id),
    [2, 1],
    "importado (03/09) deve vir antes do bot (05/09)"
  );
});

test("listarAgendaUnificada: sem filtro de data, aplica data >= hoje nas duas origens", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({});

  for (const { sql, params } of chamadas) {
    assert.equal(params[1], null, "parâmetro de data deve ser null (sem filtro explícito)");
    assert.match(sql, /data >= CURRENT_DATE/);
  }
});

test("listarAgendaUnificada: filtro de data explícito ignora a regra 'a partir de hoje'", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({ data: "2026-08-20" });

  for (const { params } of chamadas) {
    assert.equal(params[1], "2026-08-20");
  }
});

test("listarAgendaUnificada: data inválida é ignorada (tratada como sem filtro)", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({ data: "20-08-2026" });

  assert.equal(chamadas[0].params[1], null);
});

test("listarAgendaUnificada: filtro de status só consulta a origem bot", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({ status: "cancelado" });

  assert.equal(chamadas.length, 1, "não deve consultar agendamentos_importados quando status está definido");
  assert.doesNotMatch(chamadas[0].sql, /agendamentos_importados/);
  assert.equal(chamadas[0].params[2], "cancelado");
});

test("listarAgendaUnificada: status inválido é ignorado e as duas origens são consultadas", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({ status: "inventado" });

  assert.equal(chamadas.length, 2);
});

test("listarAgendaUnificada: filtro de tipo de atendimento aplica nas duas origens", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({ tipoAtendimento: "psicologia" });

  const botChamada = chamadas.find((c) => !c.sql.includes("agendamentos_importados"));
  const importadoChamada = chamadas.find((c) => c.sql.includes("agendamentos_importados"));
  assert.equal(botChamada.params[3], "psicologia");
  assert.equal(importadoChamada.params[2], "psicologia");
});

test("listarAgendaUnificada: busca por nome não aplica filtro de telefone (evita casar tudo)", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({ busca: "Maria" });

  const botChamada = chamadas.find((c) => !c.sql.includes("agendamentos_importados"));
  assert.equal(botChamada.params[4], "Maria");
  assert.equal(botChamada.params[5], null, "sem dígitos na busca, o parâmetro de telefone deve ser null");
});

test("listarAgendaUnificada: busca por telefone extrai só os dígitos", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({ busca: "(11) 99999-0000" });

  const botChamada = chamadas.find((c) => !c.sql.includes("agendamentos_importados"));
  assert.equal(botChamada.params[5], "11999990000");
});

test("listarAgendaUnificada: pagina em memória buscando a janela offset+limite de cada origem", async (t) => {
  const chamadas = mockarQuery(t, {
    bot: Array.from({ length: 3 }, (_, i) => ({
      id: i,
      origem: "bot",
      data: "2026-09-05",
      hora: `0${i}:00:00`,
    })),
    importado: [],
  });

  const resultado = await listarAgendaUnificada({ limite: 2, offset: 1 });

  const botChamada = chamadas.find((c) => !c.sql.includes("agendamentos_importados"));
  assert.equal(botChamada.params[0], 3, "LIMIT deve ser offset(1) + limite(2) = 3");
  assert.equal(resultado.length, 2, "resultado final deve respeitar o limite pedido, não a janela interna");
});

test("buscarAgendamentoComPacientePorId: junta dados do paciente", async (t) => {
  t.mock.method(pool, "query", async (sql, params) => {
    assert.equal(params[0], 5);
    return { rows: [{ id: 5, paciente_nome: "Ana", paciente_telefone: "11999990000" }] };
  });

  const resultado = await buscarAgendamentoComPacientePorId(5);

  assert.equal(resultado.paciente_nome, "Ana");
});

test("buscarAgendamentoComPacientePorId: retorna null quando não existe", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await buscarAgendamentoComPacientePorId(999);

  assert.equal(resultado, null);
});

test("cancelarAgendamentoConfirmado: só cancela se o status atual for confirmado", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [{ id: 5, status: "cancelado" }] };
  });

  await cancelarAgendamentoConfirmado(5);

  assert.match(chamadas[0].sql, /AND status = 'confirmado'/);
  assert.deepEqual(chamadas[0].params, [5]);
});

test("cancelarAgendamentoConfirmado: retorna null quando 0 linhas afetadas (corrida)", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await cancelarAgendamentoConfirmado(5);

  assert.equal(resultado, null);
});
```

- [ ] **Step 2: Rodar os testes novos e confirmar que falham (as funções ainda não existem)**

Run: `node --test test/agendamentoModelUnificada.test.js 2>&1 | tail -30`
Expected: falhas de import (`listarAgendaUnificada`/`buscarAgendamentoComPacientePorId`/`cancelarAgendamentoConfirmado` não exportados)

- [ ] **Step 3: Implementar em `src/models/agendamentoModel.js`**

Adicionar ao topo do arquivo (junto aos imports existentes):

```js
import { validarData, validarTipoAtendimento } from "../utils/validacao.js";
import { jaPassouSql } from "../utils/sqlAgenda.js";
```

Adicionar ao final do arquivo:

```js
export async function buscarAgendamentoComPacientePorId(id) {
  const { rows } = await pool.query(
    `SELECT a.*, p.nome AS paciente_nome, p.telefone AS paciente_telefone, p.convenio AS paciente_convenio
     FROM agendamentos a
     JOIN pacientes p ON p.id = a.paciente_id
     WHERE a.id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

/**
 * Cancela só se o agendamento ainda estiver confirmado — protege contra
 * cancelar duas vezes (duas abas do dashboard) ou cancelar algo já
 * concluído/remarcado por outra pessoa entretanto. 0 linhas afetadas
 * sinaliza corrida pro controller responder 409 (mesmo padrão de
 * registrarPresencaBot).
 */
export async function cancelarAgendamentoConfirmado(id) {
  const { rows } = await pool.query(
    `UPDATE agendamentos SET status = 'cancelado' WHERE id = $1 AND status = 'confirmado' RETURNING *`,
    [id]
  );
  return rows[0] ?? null;
}

async function buscarAgendaBot({ dataValida, statusValido, tipoValido, buscaValida, buscaDigitos, janela }) {
  const { rows } = await pool.query(
    `SELECT
       a.id, 'bot' AS origem, p.nome AS paciente_nome, p.telefone AS paciente_telefone,
       a.tipo_atendimento, a.data, a.hora, a.status, a.google_event_id,
       ${jaPassouSql("a")} AS ja_passou,
       ra.presenca, ra.observacao_sessao, ra.registrado_por, ra.registrado_em, u.nome AS registrado_por_nome
     FROM agendamentos a
     JOIN pacientes p ON p.id = a.paciente_id
     LEFT JOIN registros_atendimento ra ON ra.agendamento_id = a.id
     LEFT JOIN usuarios u ON u.id = ra.registrado_por
     WHERE ($2::date IS NULL OR a.data = $2::date)
       AND ($2::date IS NOT NULL OR a.data >= CURRENT_DATE)
       AND ($3::text IS NULL OR a.status = $3)
       AND ($4::text IS NULL OR a.tipo_atendimento = $4)
       AND ($5::text IS NULL OR p.nome ILIKE '%' || $5 || '%'
            OR ($6::text IS NOT NULL AND regexp_replace(p.telefone, '\\D', '', 'g') LIKE '%' || $6 || '%'))
     ORDER BY a.data ASC, a.hora ASC
     LIMIT $1`,
    [janela, dataValida, statusValido, tipoValido, buscaValida, buscaDigitos]
  );
  return rows;
}

async function buscarAgendaImportada({ dataValida, tipoValido, buscaValida, buscaDigitos, janela }) {
  const { rows } = await pool.query(
    `SELECT
       ai.id, 'importado' AS origem, ai.nome AS paciente_nome, ai.telefone AS paciente_telefone,
       ai.tipo_atendimento, ai.data, ai.hora, NULL::text AS status, NULL::text AS google_event_id,
       ${jaPassouSql("ai")} AS ja_passou,
       ra.presenca, ra.observacao_sessao, ra.registrado_por, ra.registrado_em, u.nome AS registrado_por_nome
     FROM agendamentos_importados ai
     LEFT JOIN registros_atendimento ra ON ra.agendamento_importado_id = ai.id
     LEFT JOIN usuarios u ON u.id = ra.registrado_por
     WHERE ($2::date IS NULL OR ai.data = $2::date)
       AND ($2::date IS NOT NULL OR ai.data >= CURRENT_DATE)
       AND ($3::text IS NULL OR ai.tipo_atendimento = $3)
       AND ($4::text IS NULL OR ai.nome ILIKE '%' || $4 || '%'
            OR ($5::text IS NOT NULL AND regexp_replace(ai.telefone, '\\D', '', 'g') LIKE '%' || $5 || '%'))
     ORDER BY ai.data ASC, ai.hora ASC
     LIMIT $1`,
    [janela, dataValida, tipoValido, buscaValida, buscaDigitos]
  );
  return rows;
}

/**
 * Listagem unificada pra tela /agendamentos: junta bot + importados,
 * filtra e pagina em memória — mesma técnica de listarPresenca (busca até
 * offset+limite linhas de CADA origem, combina, ordena e só então corta a
 * página final; um LIMIT fixo por origem deixaria linhas antigas
 * inalcançáveis assim que uma origem crescesse além do fixo).
 *
 * status só existe pro lado bot — quando informado, a origem importada nem
 * é consultada (evita trazer linha que nunca vai bater o filtro).
 *
 * busca casa nome (ILIKE) OU telefone (dígitos). Importante: quando a busca
 * não tem nenhum dígito, o parâmetro de telefone vai como null — comparar
 * contra uma string vazia faria `LIKE '%%'` casar QUALQUER telefone.
 */
export async function listarAgendaUnificada({ data, status, tipoAtendimento, busca, limite, offset } = {}) {
  const limiteSeguro = limiteSeguroListagem(limite);
  const offsetSeguro = offsetSeguroListagem(offset);
  const janela = offsetSeguro + limiteSeguro;

  const dataValida = validarData(data) ? data : null;
  const statusValido = STATUS_VALIDOS.includes(status) ? status : null;
  const tipoValido = validarTipoAtendimento(tipoAtendimento) ? tipoAtendimento : null;
  const buscaValida = typeof busca === "string" && busca.trim() ? busca.trim() : null;
  const buscaDigitos = buscaValida ? buscaValida.replace(/\D/g, "") || null : null;

  const [itensBot, itensImportados] = await Promise.all([
    buscarAgendaBot({ dataValida, statusValido, tipoValido, buscaValida, buscaDigitos, janela }),
    statusValido
      ? Promise.resolve([])
      : buscarAgendaImportada({ dataValida, tipoValido, buscaValida, buscaDigitos, janela }),
  ]);

  const combinados = [...itensBot, ...itensImportados].sort((x, y) =>
    `${x.data}T${x.hora}`.localeCompare(`${y.data}T${y.hora}`)
  );

  return combinados.slice(offsetSeguro, offsetSeguro + limiteSeguro);
}
```

Nota: `STATUS_VALIDOS` já existe no arquivo (definido antes de `listarAgendamentos`) — não redeclarar.

- [ ] **Step 4: Rodar os testes novos e confirmar que passam**

Run: `node --test test/agendamentoModelUnificada.test.js 2>&1 | tail -30`
Expected: todos os testes deste arquivo em verde

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test 2>&1 | tail -15`
Expected: `# fail 0`

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: 0 erros

- [ ] **Step 7: Commit**

```bash
git add src/models/agendamentoModel.js test/agendamentoModelUnificada.test.js
git commit -m "feat: adiciona listagem unificada de agenda (bot + importados)"
```

---

### Task 3: `remarcacaoService.js` — extrair a sequência segura de remarcação

**Files:**
- Create: `src/services/remarcacaoService.js`
- Test: Create `test/remarcacaoService.test.js`

**Interfaces:**
- Consumes: `criarEventoAgendamento`/`cancelarEventoAgendamento` de `../services/calendarService.js` (defaults injetáveis); `remarcarAgendamento` (renomeado `remarcarAgendamentoNoBanco` no import) de `../models/agendamentoModel.js` (default injetável); `capturarErro` de `../config/sentry.js`.
- Produces: `remarcarConsulta({agendamento, novaData, novaHora}, {criarEvento?, cancelarEvento?, salvarNoBanco?}): Promise<Agendamento>` — lança erro com `.codigo` (`FORA_DO_HORARIO_FUNCIONAMENTO`/`DATA_NO_PASSADO`/`FORA_DO_LIMITE_DIAS`/`HORARIO_LOTADO` vindos de `criarEvento`, ou `FALHA_AO_GRAVAR` se `salvarNoBanco` falhar). Usado pelas Tasks 4 e 6.

- [ ] **Step 1: Escrever os testes (falhando)**

```js
// test/remarcacaoService.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { remarcarConsulta } from "../src/services/remarcacaoService.js";

const AGENDAMENTO = {
  id: 5,
  paciente_nome: "Ana",
  tipo_atendimento: "fisioterapia",
  paciente_convenio: "Particular",
  paciente_telefone: "11999990000",
  primeira_consulta: true,
  queixa_principal: "Dor no ombro",
  google_event_id: "evt-antigo",
};

test("remarcarConsulta: caminho feliz cria evento novo, grava no banco e cancela o evento antigo", async () => {
  const chamadas = [];
  const resultado = await remarcarConsulta(
    { agendamento: AGENDAMENTO, novaData: "2026-09-10", novaHora: "14:00" },
    {
      criarEvento: async (args) => {
        chamadas.push(["criarEvento", args]);
        return { id: "evt-novo" };
      },
      salvarNoBanco: async (args) => {
        chamadas.push(["salvarNoBanco", args]);
        return { id: 5, data: "2026-09-10", hora: "14:00", tipo_atendimento: "fisioterapia" };
      },
      cancelarEvento: async (id) => {
        chamadas.push(["cancelarEvento", id]);
      },
    }
  );

  assert.equal(resultado.data, "2026-09-10");
  assert.deepEqual(
    chamadas.map((c) => c[0]),
    ["criarEvento", "salvarNoBanco", "cancelarEvento"],
    "ordem tem que ser: cria novo -> grava banco -> só então cancela o antigo"
  );
  assert.equal(chamadas[1][1].googleEventId, "evt-novo", "deve gravar o id do evento NOVO no banco");
  assert.equal(chamadas[2][1], "evt-antigo", "deve cancelar o evento ANTIGO");
});

test("remarcarConsulta: erro de validação do Calendar propaga com o mesmo código, sem tentar gravar no banco", async () => {
  let salvouNoBanco = false;

  await assert.rejects(
    () =>
      remarcarConsulta(
        { agendamento: AGENDAMENTO, novaData: "2026-09-10", novaHora: "14:00" },
        {
          criarEvento: async () => {
            const erro = new Error("HORARIO_LOTADO");
            erro.codigo = "HORARIO_LOTADO";
            throw erro;
          },
          salvarNoBanco: async () => {
            salvouNoBanco = true;
          },
        }
      ),
    (err) => err.codigo === "HORARIO_LOTADO"
  );
  assert.equal(salvouNoBanco, false);
});

test("remarcarConsulta: falha ao gravar no banco reverte o evento novo e lança FALHA_AO_GRAVAR", async () => {
  let eventoRevertido = null;

  await assert.rejects(
    () =>
      remarcarConsulta(
        { agendamento: AGENDAMENTO, novaData: "2026-09-10", novaHora: "14:00" },
        {
          criarEvento: async () => ({ id: "evt-novo" }),
          salvarNoBanco: async () => {
            throw new Error("conexão caiu");
          },
          cancelarEvento: async (id) => {
            eventoRevertido = id;
          },
        }
      ),
    (err) => err.codigo === "FALHA_AO_GRAVAR"
  );
  assert.equal(eventoRevertido, "evt-novo", "deve reverter o evento NOVO, não o antigo");
});

test("remarcarConsulta: reversão do evento novo falhando não esconde o erro original", async () => {
  await assert.rejects(
    () =>
      remarcarConsulta(
        { agendamento: AGENDAMENTO, novaData: "2026-09-10", novaHora: "14:00" },
        {
          criarEvento: async () => ({ id: "evt-novo" }),
          salvarNoBanco: async () => {
            throw new Error("conexão caiu");
          },
          cancelarEvento: async () => {
            throw new Error("Calendar indisponível pra reverter");
          },
        }
      ),
    (err) => err.codigo === "FALHA_AO_GRAVAR"
  );
});

test("remarcarConsulta: sucesso mesmo se cancelar o evento antigo falhar (não é fatal)", async () => {
  const resultado = await remarcarConsulta(
    { agendamento: AGENDAMENTO, novaData: "2026-09-10", novaHora: "14:00" },
    {
      criarEvento: async () => ({ id: "evt-novo" }),
      salvarNoBanco: async () => ({ id: 5, data: "2026-09-10", hora: "14:00" }),
      cancelarEvento: async () => {
        throw new Error("evento antigo já tinha sido apagado manualmente");
      },
    }
  );

  assert.equal(resultado.data, "2026-09-10");
});

test("remarcarConsulta: agendamento sem google_event_id não tenta cancelar evento antigo", async () => {
  let cancelarChamado = false;
  const agendamentoSemEvento = { ...AGENDAMENTO, google_event_id: null };

  await remarcarConsulta(
    { agendamento: agendamentoSemEvento, novaData: "2026-09-10", novaHora: "14:00" },
    {
      criarEvento: async () => ({ id: "evt-novo" }),
      salvarNoBanco: async () => ({ id: 5, data: "2026-09-10", hora: "14:00" }),
      cancelarEvento: async () => {
        cancelarChamado = true;
      },
    }
  );

  assert.equal(cancelarChamado, false);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/remarcacaoService.test.js 2>&1 | tail -20`
Expected: falha de import (`remarcacaoService.js` ainda não existe)

- [ ] **Step 3: Implementar**

```js
// src/services/remarcacaoService.js
import { capturarErro } from "../config/sentry.js";
import {
  criarEventoAgendamento,
  cancelarEventoAgendamento,
} from "./calendarService.js";
import { remarcarAgendamento as remarcarAgendamentoNoBanco } from "../models/agendamentoModel.js";

/**
 * Sequência segura de remarcação, compartilhada entre o bot
 * (src/functions/remarcarAgendamento.js) e o dashboard
 * (dashboardController.processarRemarcarAgendamento): cria o evento novo
 * antes de qualquer escrita no banco, só grava a nova data/hora depois que
 * o evento existe, e só cancela o evento antigo depois que o banco
 * confirmou — nessa ordem, uma falha no meio nunca deixa o paciente sem
 * consulta. Erros de validação de horário propagam com `err.codigo` (os
 * mesmos de criarEventoAgendamento); cada chamador decide como traduzir
 * isso pra usuário final (mensagem de IA vs. mensagem de dashboard).
 */
export async function remarcarConsulta(
  { agendamento, novaData, novaHora },
  {
    criarEvento = criarEventoAgendamento,
    cancelarEvento = cancelarEventoAgendamento,
    salvarNoBanco = remarcarAgendamentoNoBanco,
  } = {}
) {
  const novoEvento = await criarEvento({
    nomePaciente: agendamento.paciente_nome,
    data: novaData,
    hora: novaHora,
    tipoAtendimento: agendamento.tipo_atendimento,
    convenio: agendamento.paciente_convenio,
    telefone: agendamento.paciente_telefone,
    primeiraConsulta: agendamento.primeira_consulta,
    queixaPrincipal: agendamento.queixa_principal,
  });

  let agendamentoAtualizado;
  try {
    agendamentoAtualizado = await salvarNoBanco({
      id: agendamento.id,
      data: novaData,
      hora: novaHora,
      googleEventId: novoEvento.id,
    });
  } catch (err) {
    capturarErro(
      "[remarcacaoService] Falha ao gravar remarcação — revertendo evento novo:",
      err
    );
    try {
      await cancelarEvento(novoEvento.id);
    } catch (errReversao) {
      capturarErro("[remarcacaoService] Falha ao reverter evento novo:", errReversao);
    }
    const erro = new Error("FALHA_AO_GRAVAR");
    erro.codigo = "FALHA_AO_GRAVAR";
    throw erro;
  }

  if (agendamento.google_event_id) {
    try {
      await cancelarEvento(agendamento.google_event_id);
    } catch (err) {
      capturarErro(
        "[remarcacaoService] Falha ao remover evento antigo após remarcação bem-sucedida:",
        err
      );
    }
  }

  return agendamentoAtualizado;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/remarcacaoService.test.js 2>&1 | tail -20`
Expected: todos verdes

- [ ] **Step 5: Suíte inteira + lint**

Run: `npm test 2>&1 | tail -15 && npm run lint`
Expected: `# fail 0`, 0 erros de lint

- [ ] **Step 6: Commit**

```bash
git add src/services/remarcacaoService.js test/remarcacaoService.test.js
git commit -m "feat: extrai sequência segura de remarcação para serviço compartilhado"
```

---

### Task 4: Refatorar `src/functions/remarcarAgendamento.js` (bot) para usar o serviço

**Files:**
- Modify: `src/functions/remarcarAgendamento.js`
- Test: Create `test/remarcarAgendamentoFunction.test.js` (não existia teste nenhum pra essa function antes)

**Interfaces:**
- Consumes: `remarcarConsulta` de `../services/remarcacaoService.js` (Task 3).
- Produces: mesma assinatura pública de sempre — `remarcarAgendamento({agendamento_id, nova_data, nova_hora}, {pacienteId, telefone})` — ganha um 3º parâmetro opcional de injeção de dependência só pra testes, sem afetar `src/functions/index.js` (que chama só com 2 argumentos).

- [ ] **Step 1: Escrever os testes (falhando)**

```js
// test/remarcarAgendamentoFunction.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { remarcarAgendamento } from "../src/functions/remarcarAgendamento.js";

const AGENDAMENTO = {
  id: 5,
  data: "2026-09-05",
  hora: "10:00:00",
  paciente_nome: "Ana",
  tipo_atendimento: "fisioterapia",
};

test("remarcarAgendamento: formato de data inválido não consulta nada", async () => {
  let consultou = false;
  const resultado = await remarcarAgendamento(
    { agendamento_id: 1, nova_data: "05/09/2026", nova_hora: "10:00" },
    { pacienteId: 1, telefone: "5511999990000" },
    { buscarAgendamento: async () => ((consultou = true), null) }
  );

  assert.equal(resultado.sucesso, false);
  assert.match(resultado.motivo, /Formato de data inválido/);
  assert.equal(consultou, false);
});

test("remarcarAgendamento: formato de hora inválido não consulta nada", async () => {
  let consultou = false;
  const resultado = await remarcarAgendamento(
    { agendamento_id: 1, nova_data: "2026-09-05", nova_hora: "25:99" },
    { pacienteId: 1, telefone: "5511999990000" },
    { buscarAgendamento: async () => ((consultou = true), null) }
  );

  assert.equal(resultado.sucesso, false);
  assert.match(resultado.motivo, /Formato de hora inválido/);
  assert.equal(consultou, false);
});

test("remarcarAgendamento: agendamento não encontrado e sem importado dá mensagem genérica", async () => {
  const resultado = await remarcarAgendamento(
    { agendamento_id: 1, nova_data: "2026-09-05", nova_hora: "10:00" },
    { pacienteId: 1, telefone: "5511999990000" },
    {
      buscarAgendamento: async () => null,
      buscarAgendamentoImportado: async () => null,
    }
  );

  assert.equal(resultado.sucesso, false);
  assert.match(resultado.motivo, /Não encontrei esse agendamento/);
});

test("remarcarAgendamento: agendamento não encontrado mas existe importado orienta a falar com a recepção", async () => {
  const resultado = await remarcarAgendamento(
    { agendamento_id: 1, nova_data: "2026-09-05", nova_hora: "10:00" },
    { pacienteId: 1, telefone: "5511999990000" },
    {
      buscarAgendamento: async () => null,
      buscarAgendamentoImportado: async () => ({ nome: "Ana" }),
    }
  );

  assert.equal(resultado.sucesso, false);
  assert.match(resultado.motivo, /recepção da clínica/);
});

test("remarcarAgendamento: nova data/hora igual à atual é rejeitada sem chamar o serviço", async () => {
  let servicoChamado = false;
  const resultado = await remarcarAgendamento(
    { agendamento_id: 5, nova_data: "2026-09-05", nova_hora: "10:00" },
    { pacienteId: 1, telefone: "5511999990000" },
    {
      buscarAgendamento: async () => AGENDAMENTO,
      executarRemarcacao: async () => ((servicoChamado = true), {}),
    }
  );

  assert.equal(resultado.sucesso, false);
  assert.match(resultado.motivo, /igual à consulta já marcada/);
  assert.equal(servicoChamado, false);
});

test("remarcarAgendamento: caminho feliz chama o serviço e devolve os dados formatados", async () => {
  const resultado = await remarcarAgendamento(
    { agendamento_id: 5, nova_data: "2026-09-10", nova_hora: "14:00" },
    { pacienteId: 1, telefone: "5511999990000" },
    {
      buscarAgendamento: async () => AGENDAMENTO,
      executarRemarcacao: async ({ agendamento, novaData, novaHora }) => {
        assert.equal(agendamento.id, 5);
        assert.equal(novaData, "2026-09-10");
        assert.equal(novaHora, "14:00");
        return { data: "2026-09-10", hora: "14:00", tipo_atendimento: "fisioterapia" };
      },
    }
  );

  assert.equal(resultado.sucesso, true);
  assert.equal(resultado.data_anterior, "2026-09-05");
  assert.equal(resultado.hora_anterior, "10:00:00");
  assert.equal(resultado.data, "2026-09-10");
  assert.ok(resultado.diaSemana, "deve calcular o dia da semana da nova data");
});

test("remarcarAgendamento: erro conhecido do serviço vira mensagem amigável pro paciente", async () => {
  const resultado = await remarcarAgendamento(
    { agendamento_id: 5, nova_data: "2026-09-10", nova_hora: "14:00" },
    { pacienteId: 1, telefone: "5511999990000" },
    {
      buscarAgendamento: async () => AGENDAMENTO,
      executarRemarcacao: async () => {
        const erro = new Error("HORARIO_LOTADO");
        erro.codigo = "HORARIO_LOTADO";
        throw erro;
      },
    }
  );

  assert.equal(resultado.sucesso, false);
  assert.match(resultado.motivo, /número máximo de pacientes/);
});

test("remarcarAgendamento: erro desconhecido do serviço propaga (não é engolido)", async () => {
  await assert.rejects(() =>
    remarcarAgendamento(
      { agendamento_id: 5, nova_data: "2026-09-10", nova_hora: "14:00" },
      { pacienteId: 1, telefone: "5511999990000" },
      {
        buscarAgendamento: async () => AGENDAMENTO,
        executarRemarcacao: async () => {
          throw new Error("erro inesperado de banco");
        },
      }
    )
  );
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/remarcarAgendamentoFunction.test.js 2>&1 | tail -30`
Expected: falha — a function ainda não aceita o 3º parâmetro de injeção

- [ ] **Step 3: Refatorar `src/functions/remarcarAgendamento.js`**

Substituir os imports do topo e a função inteira por:

```js
import { remarcarConsulta } from "../services/remarcacaoService.js";
import { nomeDiaSemana } from "../services/calendarService.js";
import { buscarAgendamentoConfirmadoPorId } from "../models/agendamentoModel.js";
import { buscarProximoAgendamentoImportado } from "../models/agendamentoImportadoModel.js";
import { validarData, validarHora } from "../utils/validacao.js";
import { CLINICA } from "../config/clinica.js";
import dayjs from "../utils/dayjs.js";

const MOTIVO_POR_CODIGO_ERRO = {
  FORA_DO_HORARIO_FUNCIONAMENTO:
    "Esse horário está fora do funcionamento da clínica (seg-sex, dentro do horário configurado) ou cai num fim de semana. Consulte checar_disponibilidade para ver horários válidos.",
  DATA_NO_PASSADO: "Essa nova data/hora já passou. Peça ao paciente uma data e hora futuras.",
  FORA_DO_LIMITE_DIAS:
    "Só é possível remarcar dentro de 7 dias úteis a partir de hoje. Peça ao paciente uma data mais próxima.",
  HORARIO_LOTADO:
    "Esse horário já atingiu o número máximo de pacientes. Consulte checar_disponibilidade novamente e ofereça outras opções ao paciente.",
  FALHA_AO_GRAVAR:
    "Não foi possível concluir a remarcação por um problema técnico. Peça para o paciente tentar novamente em instantes.",
};

const MOTIVO_SO_AGENDAMENTO_IMPORTADO =
  "Esse paciente não tem nenhum agendamento feito pelo bot para remarcar — a consulta dele foi marcada fora do bot (sistema interno da clínica). NÃO tente de novo por aqui: oriente o paciente a confirmar a remarcação diretamente com a recepção da clínica.";

/**
 * Handler da function remarcar_agendamento. O agendamento_id normalmente
 * vem de uma listagem anterior (listar_agendamentos) e é sempre validado
 * contra o pacienteId do contexto antes de qualquer alteração. A sequência
 * segura (criar evento novo -> gravar no banco -> cancelar evento antigo)
 * vive em remarcacaoService.remarcarConsulta, compartilhada com o
 * dashboard.
 */
export async function remarcarAgendamento(
  { agendamento_id, nova_data, nova_hora },
  { pacienteId, telefone },
  {
    buscarAgendamento = buscarAgendamentoConfirmadoPorId,
    buscarAgendamentoImportado = buscarProximoAgendamentoImportado,
    executarRemarcacao = remarcarConsulta,
  } = {}
) {
  if (!validarData(nova_data)) {
    return {
      sucesso: false,
      motivo: `Formato de data inválido: "${nova_data}". Use o formato YYYY-MM-DD.`,
    };
  }
  if (!validarHora(nova_hora)) {
    return {
      sucesso: false,
      motivo: `Formato de hora inválido: "${nova_hora}". Use o formato HH:mm (24h).`,
    };
  }

  const agendamento = await buscarAgendamento(agendamento_id, pacienteId);
  if (!agendamento) {
    const agendamentoImportado = await buscarAgendamentoImportado(telefone);
    return {
      sucesso: false,
      motivo: agendamentoImportado
        ? MOTIVO_SO_AGENDAMENTO_IMPORTADO
        : "Não encontrei esse agendamento confirmado para esse paciente. Use listar_agendamentos para ver os IDs corretos.",
    };
  }

  if (agendamento.data === nova_data && agendamento.hora.slice(0, 5) === nova_hora) {
    return { sucesso: false, motivo: "A nova data/hora é igual à consulta já marcada." };
  }

  let agendamentoAtualizado;
  try {
    agendamentoAtualizado = await executarRemarcacao({
      agendamento,
      novaData: nova_data,
      novaHora: nova_hora,
    });
  } catch (err) {
    const motivo = MOTIVO_POR_CODIGO_ERRO[err.codigo];
    if (motivo) {
      return { sucesso: false, motivo };
    }
    throw err;
  }

  return {
    sucesso: true,
    data_anterior: agendamento.data,
    hora_anterior: agendamento.hora,
    data: agendamentoAtualizado.data,
    diaSemana: nomeDiaSemana(dayjs.tz(agendamentoAtualizado.data, CLINICA.timezone)),
    hora: agendamentoAtualizado.hora,
    tipo_atendimento: agendamentoAtualizado.tipo_atendimento,
  };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/remarcarAgendamentoFunction.test.js 2>&1 | tail -30`
Expected: todos verdes

- [ ] **Step 5: Suíte inteira + lint**

Run: `npm test 2>&1 | tail -15 && npm run lint`
Expected: `# fail 0`, 0 erros

- [ ] **Step 6: Commit**

```bash
git add src/functions/remarcarAgendamento.js test/remarcarAgendamentoFunction.test.js
git commit -m "refactor: bot passa a usar o serviço compartilhado de remarcação"
```

---

### Task 5: Dashboard — ação de cancelar

**Files:**
- Modify: `src/controllers/dashboardController.js` (adiciona `processarCancelarAgendamento`)
- Modify: `src/routes/dashboardRoutes.js` (adiciona `POST /agendamentos/:id/cancelar`)
- Test: Create `test/dashboardControllerCancelarAgendamento.test.js`

**Interfaces:**
- Consumes: `buscarAgendamentoComPacientePorId`/`cancelarAgendamentoConfirmado` de `../models/agendamentoModel.js` (Task 2); `cancelarEventoAgendamento` de `../services/calendarService.js`; `idSeguro` de `../utils/paginacao.js`; `capturarErro` de `../config/sentry.js`.
- Produces: `processarCancelarAgendamento(req, res, {buscarAgendamento?, cancelarEvento?, cancelarNoBanco?})` — usado pela rota `POST /agendamentos/:id/cancelar`.

- [ ] **Step 1: Escrever os testes (falhando)**

```js
// test/dashboardControllerCancelarAgendamento.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { processarCancelarAgendamento } from "../src/controllers/dashboardController.js";

function criarRespostaFalsa() {
  return {
    statusCode: 200,
    corpo: null,
    redirectedTo: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(corpo) {
      this.corpo = corpo;
      return this;
    },
    redirect(url) {
      this.redirectedTo = url;
    },
  };
}

function criarRequisicao(params) {
  return { params, body: {} };
}

test("processarCancelarAgendamento: id não numérico responde 404 sem consultar nada", async () => {
  let consultou = false;
  const res = criarRespostaFalsa();

  await processarCancelarAgendamento(criarRequisicao({ id: "abc" }), res, {
    buscarAgendamento: async () => ((consultou = true), null),
  });

  assert.equal(res.statusCode, 404);
  assert.equal(consultou, false);
});

test("processarCancelarAgendamento: agendamento inexistente responde 404", async () => {
  const res = criarRespostaFalsa();

  await processarCancelarAgendamento(criarRequisicao({ id: "5" }), res, {
    buscarAgendamento: async () => null,
  });

  assert.equal(res.statusCode, 404);
});

test("processarCancelarAgendamento: falha ao cancelar no Calendar responde 500 sem tocar no banco", async () => {
  let cancelouNoBanco = false;
  const res = criarRespostaFalsa();

  await processarCancelarAgendamento(criarRequisicao({ id: "5" }), res, {
    buscarAgendamento: async () => ({ id: 5, google_event_id: "evt-1" }),
    cancelarEvento: async () => {
      throw new Error("Calendar fora do ar");
    },
    cancelarNoBanco: async () => ((cancelouNoBanco = true), {}),
  });

  assert.equal(res.statusCode, 500);
  assert.equal(cancelouNoBanco, false);
});

test("processarCancelarAgendamento: corrida (0 linhas afetadas) responde 409", async () => {
  const res = criarRespostaFalsa();

  await processarCancelarAgendamento(criarRequisicao({ id: "5" }), res, {
    buscarAgendamento: async () => ({ id: 5, google_event_id: "evt-1" }),
    cancelarEvento: async () => {},
    cancelarNoBanco: async () => null,
  });

  assert.equal(res.statusCode, 409);
});

test("processarCancelarAgendamento: caminho feliz cancela no Calendar, no banco e redireciona", async () => {
  const chamadas = [];
  const res = criarRespostaFalsa();

  await processarCancelarAgendamento(criarRequisicao({ id: "5" }), res, {
    buscarAgendamento: async () => ({ id: 5, google_event_id: "evt-1" }),
    cancelarEvento: async (id) => chamadas.push(["cancelarEvento", id]),
    cancelarNoBanco: async (id) => (chamadas.push(["cancelarNoBanco", id]), { id: 5, status: "cancelado" }),
  });

  assert.deepEqual(chamadas, [
    ["cancelarEvento", "evt-1"],
    ["cancelarNoBanco", 5],
  ]);
  assert.equal(res.redirectedTo, "/agendamentos");
});

test("processarCancelarAgendamento: agendamento sem google_event_id pula direto pro cancelamento no banco", async () => {
  let cancelarEventoChamado = false;
  const res = criarRespostaFalsa();

  await processarCancelarAgendamento(criarRequisicao({ id: "5" }), res, {
    buscarAgendamento: async () => ({ id: 5, google_event_id: null }),
    cancelarEvento: async () => {
      cancelarEventoChamado = true;
    },
    cancelarNoBanco: async () => ({ id: 5, status: "cancelado" }),
  });

  assert.equal(cancelarEventoChamado, false);
  assert.equal(res.redirectedTo, "/agendamentos");
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/dashboardControllerCancelarAgendamento.test.js 2>&1 | tail -30`
Expected: falha — `processarCancelarAgendamento` não existe ainda

- [ ] **Step 3: Implementar em `src/controllers/dashboardController.js`**

Adicionar aos imports do topo:

```js
import {
  buscarAgendamentoComPacientePorId,
  cancelarAgendamentoConfirmado,
} from "../models/agendamentoModel.js";
import { cancelarEventoAgendamento } from "../services/calendarService.js";
```

(Nota: `listarAgendamentos` já está importado — mantém.)

Adicionar a função (perto de `telaAgendamentos`):

```js
export async function processarCancelarAgendamento(
  req,
  res,
  {
    buscarAgendamento = buscarAgendamentoComPacientePorId,
    cancelarEvento = cancelarEventoAgendamento,
    cancelarNoBanco = cancelarAgendamentoConfirmado,
  } = {}
) {
  const agendamentoId = idSeguro(req.params.id);
  if (!agendamentoId) return res.status(404).send("Agendamento não encontrado.");

  const agendamento = await buscarAgendamento(agendamentoId);
  if (!agendamento) return res.status(404).send("Agendamento não encontrado.");

  if (agendamento.google_event_id) {
    try {
      await cancelarEvento(agendamento.google_event_id);
    } catch (err) {
      capturarErro("[dashboardController] Falha ao cancelar evento no Calendar:", err);
      return res
        .status(500)
        .send("Não foi possível cancelar por um problema técnico. Tente novamente.");
    }
  }

  const cancelado = await cancelarNoBanco(agendamentoId);
  if (!cancelado) {
    return res
      .status(409)
      .send("Esse agendamento já foi atualizado por outra pessoa — recarregue a página e tente de novo.");
  }

  res.redirect("/agendamentos");
}
```

- [ ] **Step 4: Adicionar a rota em `src/routes/dashboardRoutes.js`**

Adicionar ao import de controllers: `processarCancelarAgendamento,` (junto aos outros já importados de `dashboardController.js`).

Adicionar logo depois da rota `GET /agendamentos`:

```js
router.post(
  "/agendamentos/:id/cancelar",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarCancelarAgendamento)
);
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `node --test test/dashboardControllerCancelarAgendamento.test.js 2>&1 | tail -30`
Expected: todos verdes

- [ ] **Step 6: Suíte inteira + lint**

Run: `npm test 2>&1 | tail -15 && npm run lint`
Expected: `# fail 0`, 0 erros

- [ ] **Step 7: Commit**

```bash
git add src/controllers/dashboardController.js src/routes/dashboardRoutes.js test/dashboardControllerCancelarAgendamento.test.js
git commit -m "feat: adiciona cancelamento de agendamento pelo dashboard"
```

---

### Task 6: Dashboard — ação de remarcar (view em 2 passos + POST)

**Files:**
- Create: `src/views/agendamentos/remarcar.ejs`
- Modify: `src/controllers/dashboardController.js` (adiciona `telaRemarcarAgendamento`, `processarRemarcarAgendamento`)
- Modify: `src/routes/dashboardRoutes.js` (adiciona `GET`/`POST /agendamentos/:id/remarcar`)
- Test: Create `test/dashboardControllerRemarcarAgendamento.test.js`

**Interfaces:**
- Consumes: `buscarAgendamentoComPacientePorId` (Task 2); `listarHorariosDisponiveis` de `../services/calendarService.js`; `remarcarConsulta` de `../services/remarcacaoService.js` (Task 3); `validarData`/`validarHora` de `../utils/validacao.js`.
- Produces: `telaRemarcarAgendamento(req, res, {buscarAgendamento?, buscarHorarios?})`, `processarRemarcarAgendamento(req, res, {buscarAgendamento?, executarRemarcacao?})`.

- [ ] **Step 1: Escrever os testes (falhando)**

```js
// test/dashboardControllerRemarcarAgendamento.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  telaRemarcarAgendamento,
  processarRemarcarAgendamento,
} from "../src/controllers/dashboardController.js";

function criarRespostaFalsa() {
  return {
    statusCode: 200,
    corpo: null,
    redirectedTo: null,
    viewRenderizada: null,
    dadosDaView: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(corpo) {
      this.corpo = corpo;
      return this;
    },
    redirect(url) {
      this.redirectedTo = url;
    },
    render(view, dados) {
      this.viewRenderizada = view;
      this.dadosDaView = dados;
    },
  };
}

const AGENDAMENTO = { id: 5, status: "confirmado", tipo_atendimento: "fisioterapia" };

test("telaRemarcarAgendamento: id não numérico responde 404", async () => {
  const res = criarRespostaFalsa();
  await telaRemarcarAgendamento({ params: { id: "abc" }, query: {} }, res, {
    buscarAgendamento: async () => AGENDAMENTO,
  });
  assert.equal(res.statusCode, 404);
});

test("telaRemarcarAgendamento: agendamento não confirmado responde 404", async () => {
  const res = criarRespostaFalsa();
  await telaRemarcarAgendamento({ params: { id: "5" }, query: {} }, res, {
    buscarAgendamento: async () => ({ ...AGENDAMENTO, status: "cancelado" }),
  });
  assert.equal(res.statusCode, 404);
});

test("telaRemarcarAgendamento: sem data escolhida, renderiza sem buscar horários", async () => {
  let buscouHorarios = false;
  const res = criarRespostaFalsa();

  await telaRemarcarAgendamento({ params: { id: "5" }, query: {} }, res, {
    buscarAgendamento: async () => AGENDAMENTO,
    buscarHorarios: async () => ((buscouHorarios = true), []),
  });

  assert.equal(res.viewRenderizada, "agendamentos/remarcar");
  assert.equal(res.dadosDaView.dataEscolhida, null);
  assert.equal(buscouHorarios, false);
});

test("telaRemarcarAgendamento: com data válida, busca horários daquele dia e tipo", async () => {
  const res = criarRespostaFalsa();

  await telaRemarcarAgendamento({ params: { id: "5" }, query: { data: "2026-09-10" } }, res, {
    buscarAgendamento: async () => AGENDAMENTO,
    buscarHorarios: async ({ data, tipoAtendimento }) => {
      assert.equal(data, "2026-09-10");
      assert.equal(tipoAtendimento, "fisioterapia");
      return [{ data: "2026-09-10", hora: "09:00", diaSemana: "quinta" }];
    },
  });

  assert.equal(res.dadosDaView.dataEscolhida, "2026-09-10");
  assert.equal(res.dadosDaView.horarios.length, 1);
});

test("processarRemarcarAgendamento: data/hora inválida responde 400 sem consultar nada", async () => {
  let consultou = false;
  const res = criarRespostaFalsa();

  await processarRemarcarAgendamento(
    { params: { id: "5" }, body: { data: "10-09-2026", hora: "14:00" } },
    res,
    { buscarAgendamento: async () => ((consultou = true), AGENDAMENTO) }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(consultou, false);
});

test("processarRemarcarAgendamento: agendamento não confirmado responde 404", async () => {
  const res = criarRespostaFalsa();

  await processarRemarcarAgendamento(
    { params: { id: "5" }, body: { data: "2026-09-10", hora: "14:00" } },
    res,
    { buscarAgendamento: async () => ({ ...AGENDAMENTO, status: "cancelado" }) }
  );

  assert.equal(res.statusCode, 404);
});

test("processarRemarcarAgendamento: erro conhecido do serviço vira mensagem 400", async () => {
  const res = criarRespostaFalsa();

  await processarRemarcarAgendamento(
    { params: { id: "5" }, body: { data: "2026-09-10", hora: "14:00" } },
    res,
    {
      buscarAgendamento: async () => AGENDAMENTO,
      executarRemarcacao: async () => {
        const erro = new Error("HORARIO_LOTADO");
        erro.codigo = "HORARIO_LOTADO";
        throw erro;
      },
    }
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.corpo, /lotado/i);
});

test("processarRemarcarAgendamento: erro desconhecido propaga", async () => {
  await assert.rejects(() =>
    processarRemarcarAgendamento(
      { params: { id: "5" }, body: { data: "2026-09-10", hora: "14:00" } },
      criarRespostaFalsa(),
      {
        buscarAgendamento: async () => AGENDAMENTO,
        executarRemarcacao: async () => {
          throw new Error("erro inesperado");
        },
      }
    )
  );
});

test("processarRemarcarAgendamento: caminho feliz chama o serviço e redireciona", async () => {
  const res = criarRespostaFalsa();

  await processarRemarcarAgendamento(
    { params: { id: "5" }, body: { data: "2026-09-10", hora: "14:00" } },
    res,
    {
      buscarAgendamento: async () => AGENDAMENTO,
      executarRemarcacao: async ({ agendamento, novaData, novaHora }) => {
        assert.equal(agendamento.id, 5);
        assert.equal(novaData, "2026-09-10");
        assert.equal(novaHora, "14:00");
        return {};
      },
    }
  );

  assert.equal(res.redirectedTo, "/agendamentos");
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/dashboardControllerRemarcarAgendamento.test.js 2>&1 | tail -30`
Expected: falha — funções ainda não existem

- [ ] **Step 3: Implementar em `src/controllers/dashboardController.js`**

Adicionar aos imports do topo:

```js
import { listarHorariosDisponiveis } from "../services/calendarService.js";
import { remarcarConsulta } from "../services/remarcacaoService.js";
import { validarData, validarHora } from "../utils/validacao.js";
```

Adicionar as funções (perto de `processarCancelarAgendamento`):

```js
const MENSAGEM_ERRO_REMARCACAO = {
  FORA_DO_HORARIO_FUNCIONAMENTO: "Esse horário está fora do funcionamento da clínica.",
  DATA_NO_PASSADO: "Essa data/hora já passou.",
  FORA_DO_LIMITE_DIAS: "Só é possível remarcar dentro de 7 dias úteis a partir de hoje.",
  HORARIO_LOTADO: "Esse horário já está lotado — escolha outro.",
  FALHA_AO_GRAVAR: "Não foi possível concluir a remarcação por um problema técnico. Tente novamente.",
};

export async function telaRemarcarAgendamento(
  req,
  res,
  {
    buscarAgendamento = buscarAgendamentoComPacientePorId,
    buscarHorarios = listarHorariosDisponiveis,
  } = {}
) {
  const agendamentoId = idSeguro(req.params.id);
  if (!agendamentoId) return res.status(404).send("Agendamento não encontrado.");

  const agendamento = await buscarAgendamento(agendamentoId);
  if (!agendamento || agendamento.status !== "confirmado") {
    return res.status(404).send("Agendamento não encontrado ou não pode mais ser remarcado.");
  }

  const dataEscolhida = validarData(req.query.data) ? req.query.data : null;
  const horarios = dataEscolhida
    ? await buscarHorarios({ data: dataEscolhida, tipoAtendimento: agendamento.tipo_atendimento })
    : [];

  res.render("agendamentos/remarcar", { agendamento, dataEscolhida, horarios });
}

export async function processarRemarcarAgendamento(
  req,
  res,
  {
    buscarAgendamento = buscarAgendamentoComPacientePorId,
    executarRemarcacao = remarcarConsulta,
  } = {}
) {
  const agendamentoId = idSeguro(req.params.id);
  if (!agendamentoId) return res.status(404).send("Agendamento não encontrado.");

  const { data: novaData, hora: novaHora } = req.body ?? {};
  if (!validarData(novaData) || !validarHora(novaHora)) {
    return res.status(400).send("Data ou hora inválida.");
  }

  const agendamento = await buscarAgendamento(agendamentoId);
  if (!agendamento || agendamento.status !== "confirmado") {
    return res.status(404).send("Agendamento não encontrado ou não pode mais ser remarcado.");
  }

  try {
    await executarRemarcacao({ agendamento, novaData, novaHora });
  } catch (err) {
    const mensagem = MENSAGEM_ERRO_REMARCACAO[err.codigo];
    if (mensagem) return res.status(400).send(mensagem);
    throw err;
  }

  res.redirect("/agendamentos");
}
```

- [ ] **Step 4: Criar a view `src/views/agendamentos/remarcar.ejs`**

```html
<!-- src/views/agendamentos/remarcar.ejs -->
<%- include("../partials/header", { titulo: "Remarcar consulta" }) %>
<h1>Remarcar consulta</h1>
<div class="dados-paciente">
  <p><strong><%= agendamento.paciente_nome %></strong> — <%= agendamento.tipo_atendimento %></p>
  <p>Consulta atual: <%= agendamento.data %> às <%= agendamento.hora %></p>
</div>

<form method="get" action="/agendamentos/<%= agendamento.id %>/remarcar">
  <label>Nova data<input type="date" name="data" value="<%= dataEscolhida ?? '' %>" required /></label>
  <button type="submit">Ver horários livres</button>
</form>

<% if (dataEscolhida) { %>
  <% if (horarios.length === 0) { %>
  <p class="erro">Nenhum horário livre nesse dia.</p>
  <% } else { %>
  <form method="post" action="/agendamentos/<%= agendamento.id %>/remarcar">
    <input type="hidden" name="_csrf" value="<%= csrfToken %>" />
    <input type="hidden" name="data" value="<%= dataEscolhida %>" />
    <% horarios.forEach((h) => { %>
    <label><input type="radio" name="hora" value="<%= h.hora %>" required /> <%= h.hora %></label>
    <% }) %>
    <button type="submit">Confirmar remarcação</button>
  </form>
  <% } %>
<% } %>
<p><a href="/agendamentos">Voltar</a></p>
<%- include("../partials/footer") %>
```

- [ ] **Step 5: Adicionar as rotas em `src/routes/dashboardRoutes.js`**

Adicionar ao import: `telaRemarcarAgendamento, processarRemarcarAgendamento,`.

Adicionar logo depois da rota de cancelar (Task 5):

```js
router.get(
  "/agendamentos/:id/remarcar",
  asyncHandler(exigirLogin),
  asyncHandler(telaRemarcarAgendamento)
);
router.post(
  "/agendamentos/:id/remarcar",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarRemarcarAgendamento)
);
```

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `node --test test/dashboardControllerRemarcarAgendamento.test.js 2>&1 | tail -40`
Expected: todos verdes

- [ ] **Step 7: Suíte inteira + lint**

Run: `npm test 2>&1 | tail -15 && npm run lint`
Expected: `# fail 0`, 0 erros

- [ ] **Step 8: Commit**

```bash
git add src/controllers/dashboardController.js src/routes/dashboardRoutes.js src/views/agendamentos/remarcar.ejs test/dashboardControllerRemarcarAgendamento.test.js
git commit -m "feat: adiciona remarcação de agendamento pelo dashboard"
```

---

### Task 7: Unificar rotas, controller e view (Agendamentos absorve Presença)

Esta é a task que efetivamente junta as duas telas. Ao final dela, `/presenca` deixa de existir.

**Files:**
- Modify: `src/controllers/dashboardController.js` (reescreve `telaAgendamentos`; remove `telaPresenca`; `processarPresencaAgendamento`/`processarPresencaImportado` só mudam o `redirect`)
- Modify: `src/routes/dashboardRoutes.js` (remove `GET /presenca`; renomeia as 4 rotas de presença/laudo pra dentro de `/agendamentos`)
- Modify: `src/views/partials/header.ejs` (remove o link "Presença")
- Modify: `src/views/agendamentos/lista.ejs` (reescrita completa — filtros + tabela com ações condicionais)
- Delete: `src/views/presenca/lista.ejs`
- Modify: `test/dashboardControllerPresenca.test.js` (redirects e `viewRenderizada` apontam pra `/agendamentos`)
- Test: Create `test/dashboardControllerTelaAgendamentos.test.js`

**Interfaces:**
- Consumes: `listarAgendaUnificada` (Task 2).
- Produces: `telaAgendamentos(req, res, {listarAgenda?})` reescrita.

- [ ] **Step 1: Escrever os testes (falhando) de `telaAgendamentos`**

```js
// test/dashboardControllerTelaAgendamentos.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { telaAgendamentos } from "../src/controllers/dashboardController.js";

function criarRespostaFalsa() {
  return {
    viewRenderizada: null,
    dadosDaView: null,
    render(view, dados) {
      this.viewRenderizada = view;
      this.dadosDaView = dados;
    },
  };
}

test("telaAgendamentos: repassa os filtros da query string pro modelo", async () => {
  let filtrosRecebidos = null;
  const res = criarRespostaFalsa();

  await telaAgendamentos(
    {
      query: {
        data: "2026-09-10",
        status: "confirmado",
        tipo_atendimento: "psicologia",
        busca: "Ana",
        limite: "20",
        offset: "0",
      },
    },
    res,
    {
      listarAgenda: async (filtros) => {
        filtrosRecebidos = filtros;
        return [];
      },
    }
  );

  assert.deepEqual(filtrosRecebidos, {
    data: "2026-09-10",
    status: "confirmado",
    tipoAtendimento: "psicologia",
    busca: "Ana",
    limite: "20",
    offset: "0",
  });
});

test("telaAgendamentos: renderiza agendamentos/lista com os itens e os filtros recebidos", async () => {
  const res = criarRespostaFalsa();

  await telaAgendamentos({ query: { status: "cancelado" } }, res, {
    listarAgenda: async () => [{ id: 1, origem: "bot" }],
  });

  assert.equal(res.viewRenderizada, "agendamentos/lista");
  assert.equal(res.dadosDaView.itens.length, 1);
  assert.equal(res.dadosDaView.filtros.status, "cancelado");
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/dashboardControllerTelaAgendamentos.test.js 2>&1 | tail -30`

- [ ] **Step 3: Reescrever `telaAgendamentos` e remover `telaPresenca`**

Em `src/controllers/dashboardController.js`:

Trocar o import `import { listarAgendamentos } from "../models/agendamentoModel.js";` (topo do arquivo) por:

```js
import {
  buscarAgendamentoComPacientePorId,
  cancelarAgendamentoConfirmado,
  listarAgendaUnificada,
} from "../models/agendamentoModel.js";
```

(As duas primeiras já foram adicionadas nas Tasks 5/6 — aqui só garanta que `listarAgendaUnificada` está junto e `listarAgendamentos` não é mais importado neste arquivo — ele continua existindo no model e sendo usado por `adminController.js`, só não é mais usado aqui.)

Substituir a função `telaAgendamentos` inteira por:

```js
export async function telaAgendamentos(
  req,
  res,
  { listarAgenda = listarAgendaUnificada } = {}
) {
  const { data, status, tipo_atendimento: tipoAtendimento, busca, limite, offset } = req.query;
  const itens = await listarAgenda({ data, status, tipoAtendimento, busca, limite, offset });
  res.render("agendamentos/lista", {
    itens,
    filtros: { data: data ?? "", status: status ?? "", tipo_atendimento: tipoAtendimento ?? "", busca: busca ?? "" },
  });
}
```

Remover completamente a função `telaPresenca` (não existe mais rota `GET /presenca` que a use).

Em `processarPresencaAgendamento` e `processarPresencaImportado`, trocar as duas ocorrências de `res.redirect("/presenca")` por `res.redirect("/agendamentos")`.

- [ ] **Step 4: Atualizar `test/dashboardControllerPresenca.test.js`**

Trocar as duas asserções `assert.equal(res.redirectedTo, "/presenca");` por `assert.equal(res.redirectedTo, "/agendamentos");`.

Remover o teste `"telaPresenca: renderiza presenca/lista com os itens combinados e a flag todos"` inteiro (a função não existe mais — coberto agora por `dashboardControllerTelaAgendamentos.test.js`), e remover o import de `telaPresenca` do topo do arquivo (mantém `processarPresencaAgendamento`/`processarPresencaImportado`).

- [ ] **Step 5: Reescrever `src/routes/dashboardRoutes.js`**

Remover a linha `router.get("/presenca", asyncHandler(exigirLogin), asyncHandler(telaPresenca));` e remover `telaPresenca` do import.

Substituir as 4 rotas de presença/laudo (que hoje usam prefixo `/presenca/...`) por:

```js
router.post(
  "/agendamentos/bot/:id/presenca",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarPresencaAgendamento)
);
router.post(
  "/agendamentos/importado/:id/presenca",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarPresencaImportado)
);
router.get(
  "/agendamentos/bot/:id/laudo",
  asyncHandler(exigirLogin),
  asyncHandler(gerarLaudoBot)
);
router.get(
  "/agendamentos/importado/:id/laudo",
  asyncHandler(exigirLogin),
  asyncHandler(gerarLaudoImportado)
);
```

(Os nomes das funções controller — `processarPresencaAgendamento`, `processarPresencaImportado`, `gerarLaudoBot`, `gerarLaudoImportado` — continuam os mesmos, só a URL muda.)

- [ ] **Step 6: Remover o link "Presença" de `src/views/partials/header.ejs`**

Remover a linha:

```html
<a class="<%= ativo('/presenca') %>" href="/presenca">Presença</a>
```

- [ ] **Step 7: Reescrever `src/views/agendamentos/lista.ejs`**

```html
<!-- src/views/agendamentos/lista.ejs -->
<%- include("../partials/header", { titulo: "Agendamentos" }) %>
<h1>Agendamentos</h1>

<form method="get" action="/agendamentos">
  <label>Data<input type="date" name="data" value="<%= filtros.data %>" /></label>
  <label>
    Status
    <select name="status">
      <option value="">Todos</option>
      <option value="confirmado" <%= filtros.status === "confirmado" ? "selected" : "" %>>Confirmado</option>
      <option value="cancelado" <%= filtros.status === "cancelado" ? "selected" : "" %>>Cancelado</option>
      <option value="compareceu" <%= filtros.status === "compareceu" ? "selected" : "" %>>Compareceu</option>
      <option value="faltou" <%= filtros.status === "faltou" ? "selected" : "" %>>Faltou</option>
    </select>
  </label>
  <label>
    Tipo
    <select name="tipo_atendimento">
      <option value="">Todos</option>
      <option value="fisioterapia" <%= filtros.tipo_atendimento === "fisioterapia" ? "selected" : "" %>>Fisioterapia</option>
      <option value="psicologia" <%= filtros.tipo_atendimento === "psicologia" ? "selected" : "" %>>Psicologia</option>
    </select>
  </label>
  <label>Paciente / telefone<input type="text" name="busca" value="<%= filtros.busca %>" /></label>
  <button type="submit">Filtrar</button>
  <a href="/agendamentos">Limpar filtros</a>
</form>

<table>
  <thead>
    <tr>
      <th>Data</th>
      <th>Hora</th>
      <th>Paciente</th>
      <th>Tipo</th>
      <th>Origem</th>
      <th>Status</th>
      <th>Ações</th>
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
        <% if (item.origem === "importado") { %>—
        <% } else if (item.status === "cancelado") { %>
        <span class="badge-estornado">Cancelado</span>
        <% } else { %><%= item.status %><% } %>
      </td>
      <td>
        <% if (item.origem === "bot" && item.status === "confirmado" && !item.ja_passou) { %>
        <a href="/agendamentos/<%= item.id %>/remarcar">Remarcar</a>
        <form method="post" action="/agendamentos/<%= item.id %>/cancelar" style="display: inline">
          <input type="hidden" name="_csrf" value="<%= csrfToken %>" />
          <button type="submit">Cancelar</button>
        </form>
        <% } else if (item.ja_passou && item.status !== "cancelado") { %>
        <form
          method="post"
          action="/agendamentos/<%= item.origem === 'bot' ? 'bot' : 'importado' %>/<%= item.id %>/presenca"
        >
          <input type="hidden" name="_csrf" value="<%= csrfToken %>" />
          <label>
            <input type="radio" name="presenca" value="compareceu" <%= item.presenca === "compareceu" ? "checked" : "" %> required />
            Compareceu
          </label>
          <label>
            <input type="radio" name="presenca" value="faltou" <%= item.presenca === "faltou" ? "checked" : "" %> />
            Faltou
          </label>
          <br />
          <textarea name="observacao_sessao" placeholder="Observação (opcional)"><%= item.observacao_sessao ?? "" %></textarea>
          <br />
          <input
            type="text"
            name="profissional_responsavel"
            placeholder="Profissional responsável (opcional)"
            value="<%= item.profissional_responsavel ?? '' %>"
          />
          <br />
          <button type="submit"><%= item.presenca ? "Corrigir" : "Registrar" %></button>
        </form>
        <% if (item.presenca) { %>
        <p class="registro-info">Registrado por <%= item.registrado_por_nome %> em <%= item.registrado_em %></p>
        <% } %> <% if (item.observacao_sessao) { %>
        <a href="/agendamentos/<%= item.origem === 'bot' ? 'bot' : 'importado' %>/<%= item.id %>/laudo">Gerar laudo</a>
        <% } %>
        <% } else { %>—
        <% } %>
      </td>
    </tr>
    <% }) %>
  </tbody>
</table>
<%- include("../partials/footer") %>
```

- [ ] **Step 8: Apagar `src/views/presenca/lista.ejs`**

```bash
git rm src/views/presenca/lista.ejs
```

- [ ] **Step 9: Rodar os testes novos e confirmar que passam**

Run: `node --test test/dashboardControllerTelaAgendamentos.test.js test/dashboardControllerPresenca.test.js 2>&1 | tail -40`
Expected: todos verdes

- [ ] **Step 10: Suíte inteira + lint**

Run: `npm test 2>&1 | tail -15 && npm run lint`
Expected: `# fail 0`, 0 erros

- [ ] **Step 11: Commit**

```bash
git add src/controllers/dashboardController.js src/routes/dashboardRoutes.js src/views/partials/header.ejs src/views/agendamentos/lista.ejs test/dashboardControllerPresenca.test.js test/dashboardControllerTelaAgendamentos.test.js
git commit -m "feat: unifica Agendamentos e Presença numa tela só, com filtros e ações"
```

---

### Task 8: Verificação manual e fechamento

**Files:**
- Modify: `TODO.md`, `CONTEXT.md` (registrar o estado novo)

- [ ] **Step 1: Suíte completa, lint e verificação de diff**

Run: `npm test 2>&1 | tail -15 && npm run lint && git diff --check`
Expected: `# fail 0`, 0 erros de lint, `git diff --check` sem saída

- [ ] **Step 2: Verificação manual local (sem afetar produção)**

Rodar o dashboard localmente (`npm run dev` ou equivalente já documentado no projeto) contra o Neon real, autenticado como um usuário de teste já existente, e exercitar manualmente:
1. Abrir `/agendamentos` sem filtro — confirmar que só aparecem consultas de hoje em diante, mais próximas primeiro.
2. Aplicar cada filtro (data passada, status, tipo, busca por nome e por telefone) isoladamente e combinados.
3. Cancelar um agendamento de teste do bot — confirmar que o evento some do Google Calendar de teste e o status vira `cancelado` na tela.
4. Remarcar um agendamento de teste do bot — escolher uma nova data, confirmar que só aparecem horários realmente livres, remarcar e conferir no Calendar de teste que o evento antigo sumiu e o novo está no horário certo.
5. Marcar presença (compareceu e faltou) tanto num agendamento do bot quanto num importado, incluindo corrigir um registro já feito.
6. Confirmar que `/presenca` não existe mais (404) e que o menu não tem mais o link "Presença".

Não usar dados de pacientes reais nem o número de WhatsApp conectado em produção para este teste — usar um agendamento de teste específico para isso, e cancelar/limpar os dados de teste no Neon depois (mesmo padrão de higiene de dados de teste já usado neste projeto).

- [ ] **Step 3: Atualizar `TODO.md` e `CONTEXT.md`**

Adicionar uma entrada em `TODO.md` (seção "Antes de produção" ou equivalente) registrando: agenda unificada implementada e testada localmente (data de hoje), ainda sem push/deploy — mesmo formato das entradas já existentes no arquivo.

- [ ] **Step 4: Commit da documentação**

```bash
git add TODO.md CONTEXT.md
git commit -m "docs: registra a agenda unificada implementada e testada localmente"
```

**Não fazer push nem deploy nesta task** — commit local apenas, aguardando autorização explícita do usuário (mesmo padrão de todo o resto do projeto).

---

## Self-Review

**Cobertura da spec:** filtros (data/status/tipo/busca) → Task 2; ações por linha (cancelar/remarcar/presença/nenhuma) → Tasks 5, 6, 7; extração do serviço de remarcação → Tasks 3-4; retirada de `/presenca` → Task 7; sem migration nova → confirmado, nenhuma task cria migration; testes → cada task de código tem sua própria task de teste; verificação manual → Task 8.

**Placeholders:** nenhum "TBD"/"implementar depois" — todo código é completo e executável como escrito.

**Consistência de tipos:** `remarcarConsulta({agendamento, novaData, novaHora}, {criarEvento, cancelarEvento, salvarNoBanco})` usado igual nas Tasks 3, 4 e 6. `buscarAgendamentoComPacientePorId(id)` usado igual nas Tasks 5 e 6. `listarAgendaUnificada({data, status, tipoAtendimento, busca, limite, offset})` definido na Task 2 e consumido com os mesmos nomes de campo na Task 7.
