# Cancelar e remarcar agendamentos importados — Plano de implementação

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use
> `superpowers:subagent-driven-development` (recomendado) ou
> `superpowers:executing-plans` para executar este plano tarefa por tarefa.
> Os passos usam checkboxes (`- [ ]`) para acompanhamento.

**Goal:** A recepção cancela e remarca agendamentos importados
(`agendamentos_importados`) pelo dashboard, com a mesma validação de
disponibilidade (expediente, capacidade, limite de 7 dias úteis) já usada
para agendamentos do bot — sem envolver o Google Calendar.

**Architecture:** Adiciona `status` real à tabela de importados (migration),
extrai a validação de disponibilidade de dentro de `criarEventoAgendamento`
para uma função reaproveitável, adiciona funções paralelas
`*Importado`/`*Bot` no model e no service de remarcação (mesmo padrão já
usado por `registrarPresencaBot`/`registrarPresencaImportado`), e torna o
controller e as rotas cientes de `:origem` (`bot` | `importado`).

**Tech Stack:** Node.js 20+, Express 4, EJS 6, `node:test` +
`node:assert/strict`, `pg` (mockado nos testes), `dayjs`.

**Spec:** `docs/superpowers/specs/2026-09-02-cancelar-remarcar-importados-design.md`

## Global Constraints

- Não sincronizar agendamentos importados com o Google Calendar (nem criar
  nem alterar evento).
- Não criar agendamento importado novo do zero — só cancelar/remarcar os
  327 já existentes.
- Mesma permissão de hoje: qualquer usuário logado (recepção ou
  administradora), sem exigir papel de administradora.
- `agendamentos_importados.status` usa exatamente os mesmos 5 valores de
  `agendamentos.status`: `confirmado`, `cancelado`, `concluido`,
  `compareceu`, `faltou` (mesmo `concluido` não sendo escrito por nenhum
  código hoje, em nenhuma das duas tabelas).
- Comportamento do bot no WhatsApp não muda — `criarEventoAgendamento`
  continua validando e criando evento exatamente como hoje.
- `git diff --check` e `npm run lint` limpos antes de cada commit.

---

## Estrutura de arquivos

```
src/
├── db/migrations/
│   └── 020_agendamentos_importados_status.sql   # novo
├── services/
│   ├── calendarService.js       # +validarDisponibilidadeAgendamento (export
│   │                              #   nova); contarPacientesNoSlot e
│   │                              #   buscarOcupacaoDoDia passam a excluir
│   │                              #   importados com status = 'cancelado'
│   └── remarcacaoService.js     # +remarcarConsultaImportada
├── models/
│   └── agendamentoModel.js      # buscarAgendaImportada seleciona ai.status
│                                  #   de verdade e ganha parâmetro
│                                  #   statusValido; listarAgendaUnificada
│                                  #   sempre consulta as duas origens;
│                                  #   +cancelarAgendamentoImportado,
│                                  #   +remarcarAgendamentoImportado,
│                                  #   +buscarAgendamentoImportadoPorId
├── controllers/
│   └── dashboardController.js   # processarCancelarAgendamento,
│                                  #   telaRemarcarAgendamento,
│                                  #   processarRemarcarAgendamento passam a
│                                  #   ler req.params.origem e despachar pro
│                                  #   par bot/importado certo
├── routes/
│   └── dashboardRoutes.js       # rotas de cancelar/remarcar ganham prefixo
│                                  #   :origem (bot | importado)
└── views/
    └── agendamentos/
        ├── lista.ejs             # remove a checagem origem === "bot" do
        │                          #   bloco de ações; badge de status para
        │                          #   das duas origens; URLs com origem
        └── remarcar.ejs           # URLs dos dois <form> passam a incluir
                                    #   agendamento.origem
test/
├── calendarService.test.js       # novo — cobre validarDisponibilidadeAgendamento
│                                   #   e a exclusão de importados cancelados
│                                   #   na contagem de capacidade
├── agendamentoModelUnificada.test.js   # atualizado + novos testes
├── remarcacaoService.test.js     # atualizado — já existe com testes de
│                                   #   remarcarConsulta (bot); ganha
│                                   #   testes de remarcarConsultaImportada
│                                   #   ao final do arquivo
├── dashboardControllerCancelarAgendamento.test.js   # atualizado + importado
├── dashboardControllerRemarcarAgendamento.test.js   # atualizado + importado
└── agendamentosListaView.test.js # atualizado + novos testes
```

---

### Task 1: Migration 020 — status em agendamentos_importados

**Files:**

- Create: `src/db/migrations/020_agendamentos_importados_status.sql`
- Test: `test/pagamentoModel.test.js` **não** — criar
  `test/migrations.test.js` (novo arquivo, primeira migration testada nesse
  arquivo; migrations futuras podem crescer aqui em vez de espalhar em
  arquivos de outro domínio como hoje acontece com a migration 013 dentro
  de `pagamentoModel.test.js`)

**Interfaces:**

- Produz: coluna `agendamentos_importados.status` (`TEXT NOT NULL DEFAULT
  'confirmado'`, `CHECK` com os 5 valores), consumida pelas Tasks 2-8.

- [ ] **Passo 1: Escrever o teste que lê o texto da migration**

Criar `test/migrations.test.js`:

```js
// test/migrations.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION_020 = path.join(ROOT, "src/db/migrations/020_agendamentos_importados_status.sql");

test("migration 020: adiciona status em agendamentos_importados com os mesmos 5 valores de agendamentos.status", async () => {
  const sql = await readFile(MIGRATION_020, "utf8");

  assert.match(
    sql,
    /ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'confirmado'/
  );
  assert.match(
    sql,
    /CHECK \(status IN \('confirmado', 'cancelado', 'concluido', 'compareceu', 'faltou'\)\)/
  );
});
```

- [ ] **Passo 2: Rodar o teste e confirmar a falha**

Executar: `node --test test/migrations.test.js`

Esperado: falha por `ENOENT` (arquivo da migration ainda não existe).

- [ ] **Passo 3: Escrever a migration**

Criar `src/db/migrations/020_agendamentos_importados_status.sql`:

```sql
-- Clínica Exemplo Bot — migration 020: status em agendamentos importados
--
-- Até aqui, agendamentos_importados não tinha status — a tabela era só
-- referência histórica da migração do Excel/sistema de agenda anterior (ver comentário
-- original na migration 005). A recepção agora também cancela e remarca
-- esses registros pelo dashboard, então eles precisam do mesmo ciclo de
-- vida que agendamentos.status já tem: confirmado -> cancelado, ou
-- confirmado -> compareceu/faltou via registro de presença.
--
-- DEFAULT 'confirmado' preenche as 327 linhas já existentes da migração —
-- nenhuma delas estava cancelada, então esse é o estado correto pra todas.

ALTER TABLE agendamentos_importados
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'confirmado';

ALTER TABLE agendamentos_importados DROP CONSTRAINT IF EXISTS agendamentos_importados_status_check;
ALTER TABLE agendamentos_importados ADD CONSTRAINT agendamentos_importados_status_check
  CHECK (status IN ('confirmado', 'cancelado', 'concluido', 'compareceu', 'faltou'));
```

- [ ] **Passo 4: Rodar o teste e confirmar que passa**

Executar: `node --test test/migrations.test.js`

Esperado: PASS.

- [ ] **Passo 5: Rodar lint e whitespace**

```bash
npm run lint
git diff --check
```

- [ ] **Passo 6: Commit**

```bash
git add src/db/migrations/020_agendamentos_importados_status.sql test/migrations.test.js
git commit -m "feat: adiciona status em agendamentos_importados (migration 020)"
```

---

### Task 2: Extrair validarDisponibilidadeAgendamento

**Files:**

- Modify: `src/services/calendarService.js:244-289` (dentro de
  `criarEventoAgendamento`)
- Create: `test/calendarService.test.js`

**Interfaces:**

- Consome: `CLINICA` (`src/config/clinica.js`), `contarPacientesNoSlot`
  (função privada já existente no mesmo arquivo), `pool`
  (`src/db/pool.js`), `dayjs` (`src/utils/dayjs.js`).
- Produz: `export async function validarDisponibilidadeAgendamento({ data,
  hora, tipoAtendimento })` — lança `Error` com `.codigo` igual a
  `FORA_DO_HORARIO_FUNCIONAMENTO`, `DATA_NO_PASSADO`, `FORA_DO_LIMITE_DIAS`
  ou `HORARIO_LOTADO`; não lança nada e não retorna nada (`undefined`)
  quando o horário está disponível. Consumida pela Task 5
  (`remarcarConsultaImportada`).

- [ ] **Passo 1: Escrever os testes que falham**

Criar `test/calendarService.test.js`:

```js
// test/calendarService.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { validarDisponibilidadeAgendamento } from "../src/services/calendarService.js";
import dayjs from "../src/utils/dayjs.js";
import { CLINICA } from "../src/config/clinica.js";

function proximaSegunda() {
  let d = dayjs().tz(CLINICA.timezone).add(1, "day");
  while (CLINICA.diasFechados.includes(d.day())) d = d.add(1, "day");
  return d;
}

test("validarDisponibilidadeAgendamento: horário dentro do expediente e livre não lança nada", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ total: 0 }] }));

  const dia = proximaSegunda().format("YYYY-MM-DD");
  await assert.doesNotReject(() =>
    validarDisponibilidadeAgendamento({ data: dia, hora: "08:00", tipoAtendimento: "fisioterapia" })
  );
});

test("validarDisponibilidadeAgendamento: fora do expediente lança FORA_DO_HORARIO_FUNCIONAMENTO", async () => {
  const dia = proximaSegunda().format("YYYY-MM-DD");
  await assert.rejects(
    () => validarDisponibilidadeAgendamento({ data: dia, hora: "05:00", tipoAtendimento: "fisioterapia" }),
    (err) => err.codigo === "FORA_DO_HORARIO_FUNCIONAMENTO"
  );
});

test("validarDisponibilidadeAgendamento: fim de semana lança FORA_DO_HORARIO_FUNCIONAMENTO", async () => {
  let d = dayjs().tz(CLINICA.timezone).add(1, "day");
  while (!CLINICA.diasFechados.includes(d.day())) d = d.add(1, "day");

  await assert.rejects(
    () => validarDisponibilidadeAgendamento({ data: d.format("YYYY-MM-DD"), hora: "08:00", tipoAtendimento: "fisioterapia" }),
    (err) => err.codigo === "FORA_DO_HORARIO_FUNCIONAMENTO"
  );
});

test("validarDisponibilidadeAgendamento: data no passado lança DATA_NO_PASSADO", async () => {
  const ontem = dayjs().tz(CLINICA.timezone).subtract(1, "day").format("YYYY-MM-DD");
  await assert.rejects(
    () => validarDisponibilidadeAgendamento({ data: ontem, hora: "08:00", tipoAtendimento: "fisioterapia" }),
    (err) => err.codigo === "DATA_NO_PASSADO"
  );
});

test("validarDisponibilidadeAgendamento: além de 7 dias úteis lança FORA_DO_LIMITE_DIAS", async () => {
  const longe = dayjs().tz(CLINICA.timezone).add(30, "day").format("YYYY-MM-DD");
  await assert.rejects(
    () => validarDisponibilidadeAgendamento({ data: longe, hora: "08:00", tipoAtendimento: "fisioterapia" }),
    (err) => err.codigo === "FORA_DO_LIMITE_DIAS"
  );
});

test("validarDisponibilidadeAgendamento: capacidade lotada lança HORARIO_LOTADO", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ total: 7 }] }));

  const dia = proximaSegunda().format("YYYY-MM-DD");
  await assert.rejects(
    () => validarDisponibilidadeAgendamento({ data: dia, hora: "08:00", tipoAtendimento: "fisioterapia" }),
    (err) => err.codigo === "HORARIO_LOTADO"
  );
});

test("validarDisponibilidadeAgendamento: tipo sem limite configurado (psicologia) não consulta capacidade", async (t) => {
  let consultou = false;
  t.mock.method(pool, "query", async () => ((consultou = true), { rows: [{ total: 999 }] }));

  const dia = proximaSegunda().format("YYYY-MM-DD");
  await assert.doesNotReject(() =>
    validarDisponibilidadeAgendamento({ data: dia, hora: "08:00", tipoAtendimento: "psicologia" })
  );
  assert.equal(consultou, false, "psicologia não tem capacidadeMaximaPorHorario configurada");
});
```

- [ ] **Passo 2: Rodar os testes e confirmar a falha**

Executar: `node --test test/calendarService.test.js`

Esperado: falha porque `validarDisponibilidadeAgendamento` ainda não existe
(erro de import).

- [ ] **Passo 3: Extrair a função em calendarService.js**

Em `src/services/calendarService.js`, localizar `criarEventoAgendamento`
(por volta da linha 244) e substituir o bloco de validação (do `const
duracao = ...` até o fechamento do `if (Number.isFinite(capacidadeMaxima))
{ ... }`, antes de `const eConvenio = ehConvenio(convenio);`) por uma
chamada à nova função, movendo exatamente essas linhas para fora:

```js
export async function validarDisponibilidadeAgendamento({ data, hora, tipoAtendimento }) {
  const duracao = CLINICA.duracaoConsultaMinutos[tipoAtendimento] ?? 50;
  const inicio = dayjs.tz(`${data}T${hora}`, CLINICA.timezone);
  const fim = inicio.add(duracao, "minute");

  // listarHorariosDisponiveis só filtra esses casos ao *sugerir* horário —
  // aqui é a checagem que realmente impede a criação/remarcação fora do
  // expediente, mesmo que o modelo chame criar_agendamento direto sem
  // antes checar disponibilidade.
  const periodo = periodoContendo(inicio, fim, periodosDoDia(inicio));
  if (!isDiaUtil(inicio) || !periodo) {
    const erro = new Error("FORA_DO_HORARIO_FUNCIONAMENTO");
    erro.codigo = "FORA_DO_HORARIO_FUNCIONAMENTO";
    throw erro;
  }

  const agora = dayjs().tz(CLINICA.timezone);
  if (inicio.isBefore(agora)) {
    const erro = new Error("DATA_NO_PASSADO");
    erro.codigo = "DATA_NO_PASSADO";
    throw erro;
  }

  if (inicio.isAfter(limiteDeAgendamento(), "day")) {
    const erro = new Error("FORA_DO_LIMITE_DIAS");
    erro.codigo = "FORA_DO_LIMITE_DIAS";
    throw erro;
  }

  const capacidadeMaxima = CLINICA.capacidadeMaximaPorHorario?.[tipoAtendimento] ?? Infinity;
  if (Number.isFinite(capacidadeMaxima)) {
    const ocupacaoAtual = await contarPacientesNoSlot(data, hora, tipoAtendimento);
    if (ocupacaoAtual >= capacidadeMaxima) {
      const erro = new Error("HORARIO_LOTADO");
      erro.codigo = "HORARIO_LOTADO";
      throw erro;
    }
  }
}

export async function criarEventoAgendamento({
  nomePaciente,
  data,
  hora,
  tipoAtendimento,
  convenio,
  telefone,
  primeiraConsulta,
  queixaPrincipal,
}) {
  await validarDisponibilidadeAgendamento({ data, hora, tipoAtendimento });

  const duracao = CLINICA.duracaoConsultaMinutos[tipoAtendimento] ?? 50;
  const inicio = dayjs.tz(`${data}T${hora}`, CLINICA.timezone);
  const fim = inicio.add(duracao, "minute");

  const eConvenio = ehConvenio(convenio);
  // Retorno é o caso menos comum (maioria é primeira consulta) — só marca no
  // título quando for retorno, pra não poluir o caso padrão. Visível de
  // cara na visão de mês/semana do Calendar, sem precisar abrir o evento.
  const ehRetorno = primeiraConsulta === false;
  const linhasDescricao = [`<b>${nomePaciente}</b>`];
  if (telefone) linhasDescricao.push(`Telefone: ${formatarTelefoneExibicao(telefone)}`);
  linhasDescricao.push(ehRetorno ? "Retorno" : "Primeira consulta");
  if (queixaPrincipal) linhasDescricao.push(`Queixa principal: ${queixaPrincipal}`);
  linhasDescricao.push("Agendado automaticamente via WhatsApp (Clínica Exemplo Bot).");

  const { data: evento } = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: {
      // Nome do paciente primeiro no título (não só no meio) — é o que a
      // recepção precisa bater o olho e digitar no sistema de agenda anterior, sem
      // precisar abrir o evento nem ler o resto.
      summary: `${nomePaciente} - ${tipoAtendimento[0].toUpperCase()}${tipoAtendimento.slice(1)}${eConvenio ? ` (${convenio})` : " (Particular)"}${ehRetorno ? " [RETORNO]" : ""}`,
      description: linhasDescricao.join("\n"),
      colorId: COR_AGENDADO_PELO_BOT,
      start: { dateTime: inicio.toISOString(), timeZone: CLINICA.timezone },
      end: { dateTime: fim.toISOString(), timeZone: CLINICA.timezone },
    },
  });

  return evento;
}
```

Nada nesse corpo muda — é exatamente o que já existe hoje em
`criarEventoAgendamento`, só que agora depois da chamada a
`validarDisponibilidadeAgendamento` em vez da validação inline. As funções
privadas `periodoContendo`, `periodosDoDia`, `isDiaUtil`,
`limiteDeAgendamento`, `ehConvenio` e as constantes `CALENDAR_ID`,
`COR_AGENDADO_PELO_BOT` continuam exatamente onde estão no arquivo — só
`validarDisponibilidadeAgendamento` e `criarEventoAgendamento` mudam de
posição/corpo.

`inicio`/`duracao`/`fim` são recalculados dentro de
`criarEventoAgendamento` (cálculo de 3 linhas, não é a validação em si) —
`criarEventoAgendamento` ainda precisa deles para montar o payload do
evento do Calendar. `validarDisponibilidadeAgendamento` fica antes de
`criarEventoAgendamento` no arquivo, já que a segunda agora chama a
primeira.

- [ ] **Passo 4: Rodar os testes e confirmar que passam**

Executar: `node --test test/calendarService.test.js`

Esperado: PASS (7 testes).

- [ ] **Passo 5: Rodar lint, whitespace e a suíte completa**

```bash
npm run lint
git diff --check
npm test
```

Esperado: tudo passa — `criarEventoAgendamento` não muda de comportamento
externo, só passa a chamar a função extraída internamente.

- [ ] **Passo 6: Commit**

```bash
git add src/services/calendarService.js test/calendarService.test.js
git commit -m "refactor: extrai validarDisponibilidadeAgendamento de criarEventoAgendamento"
```

---

### Task 3: Excluir importados cancelados da contagem de capacidade

**Files:**

- Modify: `src/services/calendarService.js` (`contarPacientesNoSlot` e
  `buscarOcupacaoDoDia`)
- Modify: `test/calendarService.test.js`

**Interfaces:**

- Consome: nada novo (mesmas funções privadas já existentes).
- Produz: mesmo comportamento externo de `contarPacientesNoSlot`/
  `buscarOcupacaoDoDia`, só que agora ignora `agendamentos_importados` com
  `status = 'cancelado'`. Consumido pela Task 2 (`validarDisponibilidade
  Agendamento`, indiretamente via `contarPacientesNoSlot`) e pela Task 4
  (`listarHorariosDisponiveis`, que já usa `buscarOcupacaoDoDia`).

- [ ] **Passo 1: Escrever o teste que falha**

Adicionar a `test/calendarService.test.js` (o mock de `pool.query` precisa
inspecionar o SQL, não só devolver linhas fixas — trocar pra um mock que
captura a query):

```js
test("validarDisponibilidadeAgendamento: a query de capacidade exclui importados cancelados", async (t) => {
  let sqlCapturado = null;
  t.mock.method(pool, "query", async (sql) => {
    sqlCapturado = sql;
    return { rows: [{ total: 0 }] };
  });

  const dia = proximaSegunda().format("YYYY-MM-DD");
  await validarDisponibilidadeAgendamento({ data: dia, hora: "08:00", tipoAtendimento: "fisioterapia" });

  assert.match(sqlCapturado, /agendamentos_importados/);
  assert.match(sqlCapturado, /status <> 'cancelado'/);
});
```

- [ ] **Passo 2: Rodar o teste e confirmar a falha**

Executar: `node --test test/calendarService.test.js`

Esperado: falha — a query atual de `contarPacientesNoSlot` não tem
`status <> 'cancelado'` na parte de `agendamentos_importados` (conta a
linha sem filtrar status nenhum).

- [ ] **Passo 3: Atualizar as duas queries**

Em `src/services/calendarService.js`, função `contarPacientesNoSlot`:

```js
async function contarPacientesNoSlot(data, hora, tipoAtendimento) {
  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM agendamentos
          WHERE status = 'confirmado' AND data = $1 AND hora = $2 AND tipo_atendimento = $3)
       + (SELECT COUNT(*)::int FROM agendamentos_importados
          WHERE status <> 'cancelado' AND data = $1 AND hora = $2 AND tipo_atendimento = $3) AS total`,
    [data, hora, tipoAtendimento]
  );
  return rows[0].total;
}
```

Função `buscarOcupacaoDoDia`:

```js
async function buscarOcupacaoDoDia(data, tipoAtendimento) {
  const { rows } = await pool.query(
    `SELECT hora, COUNT(*)::int AS total FROM (
       SELECT hora FROM agendamentos WHERE status = 'confirmado' AND data = $1 AND tipo_atendimento = $2
       UNION ALL
       SELECT hora FROM agendamentos_importados WHERE status <> 'cancelado' AND data = $1 AND tipo_atendimento = $2
     ) t
     GROUP BY hora`,
    [data, tipoAtendimento]
  );
  const ocupacaoPorHorario = {};
  for (const row of rows) {
    ocupacaoPorHorario[row.hora.slice(0, 5)] = row.total;
  }
  return ocupacaoPorHorario;
}
```

(Só a cláusula `WHERE` de `agendamentos_importados` muda nas duas — o resto
é idêntico ao que já existe.)

- [ ] **Passo 4: Rodar os testes e confirmar que passam**

Executar: `node --test test/calendarService.test.js`

Esperado: PASS.

- [ ] **Passo 5: Verificar a tarefa**

```bash
npm run lint
git diff --check
npm test
```

- [ ] **Passo 6: Commit**

```bash
git add src/services/calendarService.js test/calendarService.test.js
git commit -m "fix: exclui importados cancelados da contagem de capacidade por horário"
```

---

### Task 4: Model — status real, listarAgendaUnificada e funções de escrita para importado

**Files:**

- Modify: `src/models/agendamentoModel.js`
- Modify: `test/agendamentoModelUnificada.test.js`

**Interfaces:**

- Consome: `pool`, `jaPassouSql`, `validarData`, `validarTipoAtendimento`
  (já importados no arquivo).
- Produz:
  - `buscarAgendaImportada` ganha parâmetro `statusValido` e seleciona
    `ai.status` de verdade.
  - `listarAgendaUnificada` sempre consulta as duas origens (não pula mais
    importados quando `status` é informado).
  - `export async function cancelarAgendamentoImportado(id)` — mesmo
    contrato de `cancelarAgendamentoConfirmado`, mas em
    `agendamentos_importados`.
  - `export async function remarcarAgendamentoImportado({ id, data, hora })`
    — atualiza `agendamentos_importados`, `WHERE id = $1 AND status =
    'confirmado'`, `RETURNING *`.
  - `export async function buscarAgendamentoImportadoPorId(id)` — retorna
    `{ ...linha, paciente_nome, paciente_telefone, ja_passou }` (mesmo
    formato de campo que `buscarAgendamentoComPacientePorId` usa pro bot,
    pra controller/view tratarem os dois de forma uniforme).

Consumidos pelas Tasks 5 e 6.

- [ ] **Passo 1: Escrever os testes que falham**

Em `test/agendamentoModelUnificada.test.js`, **substituir** o teste
`"listarAgendaUnificada: filtro de status só consulta a origem bot"`
(atualmente nas linhas 65-73) por:

```js
test("listarAgendaUnificada: filtro de status consulta as duas origens", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({ status: "cancelado" });

  assert.equal(chamadas.length, 2, "deve consultar bot e importados mesmo com status definido");
  const botChamada = chamadas.find((c) => !c.sql.includes("agendamentos_importados"));
  const importadoChamada = chamadas.find((c) => c.sql.includes("agendamentos_importados"));
  assert.equal(botChamada.params[2], "cancelado");
  assert.equal(importadoChamada.params[2], "cancelado");
});
```

E **atualizar** o índice no teste de tipo de atendimento (linha ~89-92,
`importadoChamada.params[2]` vira `params[3]` porque `statusValido` entra
como o novo terceiro parâmetro de `buscarAgendaImportada`):

```js
test("listarAgendaUnificada: filtro de tipo de atendimento aplica nas duas origens", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({ tipoAtendimento: "psicologia" });

  const botChamada = chamadas.find((c) => !c.sql.includes("agendamentos_importados"));
  const importadoChamada = chamadas.find((c) => c.sql.includes("agendamentos_importados"));
  assert.equal(botChamada.params[3], "psicologia");
  assert.equal(importadoChamada.params[3], "psicologia");
});
```

No topo do arquivo, o import já existente:

```js
import {
  listarAgendaUnificada,
  buscarAgendamentoComPacientePorId,
  cancelarAgendamentoConfirmado,
} from "../src/models/agendamentoModel.js";
```

vira:

```js
import {
  listarAgendaUnificada,
  buscarAgendamentoComPacientePorId,
  cancelarAgendamentoConfirmado,
  cancelarAgendamentoImportado,
  remarcarAgendamentoImportado,
  buscarAgendamentoImportadoPorId,
} from "../src/models/agendamentoModel.js";
```

E adicionar ao final do arquivo (novos testes para as três funções novas):

```js
test("cancelarAgendamentoImportado: só cancela se o status atual for confirmado", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [{ id: 9, status: "cancelado" }] };
  });

  const resultado = await cancelarAgendamentoImportado(9);

  assert.match(chamadas[0].sql, /UPDATE agendamentos_importados SET status = 'cancelado'/);
  assert.match(chamadas[0].sql, /AND status = 'confirmado'/);
  assert.deepEqual(chamadas[0].params, [9]);
  assert.equal(resultado.status, "cancelado");
});

test("cancelarAgendamentoImportado: 0 linhas afetadas retorna null (corrida)", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await cancelarAgendamentoImportado(9);

  assert.equal(resultado, null);
});

test("remarcarAgendamentoImportado: grava nova data/hora só se confirmado", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [{ id: 9, data: "2026-09-15", hora: "09:00:00" }] };
  });

  const resultado = await remarcarAgendamentoImportado({ id: 9, data: "2026-09-15", hora: "09:00" });

  assert.match(chamadas[0].sql, /UPDATE agendamentos_importados SET data = \$2, hora = \$3/);
  assert.match(chamadas[0].sql, /AND status = 'confirmado'/);
  assert.deepEqual(chamadas[0].params, [9, "2026-09-15", "09:00"]);
  assert.equal(resultado.data, "2026-09-15");
});

test("remarcarAgendamentoImportado: 0 linhas afetadas retorna null", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await remarcarAgendamentoImportado({ id: 9, data: "2026-09-15", hora: "09:00" });

  assert.equal(resultado, null);
});

test("buscarAgendamentoImportadoPorId: retorna paciente_nome/paciente_telefone no mesmo formato do bot", async (t) => {
  t.mock.method(pool, "query", async (sql, params) => {
    assert.equal(params[0], 9);
    return {
      rows: [
        {
          id: 9,
          nome: "Ciclano",
          telefone: "11999990000",
          data: "2026-09-15",
          hora: "09:00:00",
          tipo_atendimento: "fisioterapia",
          status: "confirmado",
          ja_passou: false,
        },
      ],
    };
  });

  const resultado = await buscarAgendamentoImportadoPorId(9);

  assert.equal(resultado.paciente_nome, "Ciclano");
  assert.equal(resultado.paciente_telefone, "11999990000");
  assert.equal(resultado.ja_passou, false);
});

test("buscarAgendamentoImportadoPorId: retorna null quando não existe", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await buscarAgendamentoImportadoPorId(999);

  assert.equal(resultado, null);
});
```

- [ ] **Passo 2: Rodar os testes e confirmar a falha**

Executar: `node --test test/agendamentoModelUnificada.test.js`

Esperado: os testes das três funções novas falham por import inexistente;
o teste de status reescrito falha porque `buscarAgendaImportada` ainda é
pulada quando `status` está definido; o teste de tipo falha pelo índice
errado.

- [ ] **Passo 3: Atualizar buscarAgendaImportada e listarAgendaUnificada**

Em `src/models/agendamentoModel.js`, substituir `buscarAgendaImportada`
por:

```js
async function buscarAgendaImportada({ dataValida, statusValido, tipoValido, buscaValida, buscaDigitos, janela }) {
  const { rows } = await pool.query(
    `SELECT
       ai.id, 'importado' AS origem, ai.nome AS paciente_nome, ai.telefone AS paciente_telefone,
       ai.tipo_atendimento, ai.data, ai.hora, ai.status, NULL::text AS google_event_id,
       ${jaPassouSql("ai")} AS ja_passou,
       ra.presenca, ra.observacao_sessao, ra.profissional_responsavel, ra.registrado_por, ra.registrado_em, u.nome AS registrado_por_nome
     FROM agendamentos_importados ai
     LEFT JOIN registros_atendimento ra ON ra.agendamento_importado_id = ai.id
     LEFT JOIN usuarios u ON u.id = ra.registrado_por
     WHERE ($2::date IS NULL OR ai.data = $2::date)
       AND ($2::date IS NOT NULL OR ai.data >= CURRENT_DATE)
       AND ($3::text IS NULL OR ai.status = $3)
       AND ($4::text IS NULL OR ai.tipo_atendimento = $4)
       AND ($5::text IS NULL OR ai.nome ILIKE '%' || $5 || '%'
            OR ($6::text IS NOT NULL AND regexp_replace(ai.telefone, '\\D', '', 'g') LIKE '%' || $6 || '%'))
     ORDER BY ai.data ASC, ai.hora ASC
     LIMIT $1`,
    [janela, dataValida, statusValido, tipoValido, buscaValida, buscaDigitos]
  );
  return rows;
}
```

E o corpo de `listarAgendaUnificada` (a partir do comentário JSDoc que
começa com "Listagem unificada pra tela /agendamentos"):

```js
/**
 * Listagem unificada pra tela /agendamentos: junta bot + importados,
 * filtra e pagina em memória — mesma técnica de listarPresenca (busca até
 * offset+limite linhas de CADA origem, combina, ordena e só então corta a
 * página final; um LIMIT fixo por origem deixaria linhas antigas
 * inalcançáveis assim que uma origem crescesse além do fixo).
 *
 * status agora existe nas duas origens (migration 020) — sempre consulta
 * bot e importados, independente do filtro de status estar definido.
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
    buscarAgendaImportada({ dataValida, statusValido, tipoValido, buscaValida, buscaDigitos, janela }),
  ]);

  const combinados = [...itensBot, ...itensImportados].sort((x, y) =>
    `${x.data}T${x.hora}`.localeCompare(`${y.data}T${y.hora}`)
  );

  return combinados.slice(offsetSeguro, offsetSeguro + limiteSeguro);
}
```

(Só o `Promise.all` muda — troca `statusValido ? Promise.resolve([]) :
buscarAgendaImportada(...)` por uma chamada direta com `statusValido`
incluído; o resto da função é idêntico ao que já existe hoje.)

- [ ] **Passo 4: Adicionar as três funções novas**

Logo depois de `cancelarAgendamentoConfirmado` (por volta da linha 186),
adicionar:

```js
/**
 * Mesmo contrato de cancelarAgendamentoConfirmado, para
 * agendamentos_importados: só cancela se ainda confirmado, 0 linhas
 * afetadas sinaliza corrida pro controller responder 409.
 */
export async function cancelarAgendamentoImportado(id) {
  const { rows } = await pool.query(
    `UPDATE agendamentos_importados SET status = 'cancelado' WHERE id = $1 AND status = 'confirmado' RETURNING *`,
    [id]
  );
  return rows[0] ?? null;
}

/**
 * Atualiza data/hora de um agendamento importado (remarcação). Diferente
 * de remarcarAgendamento (bot), não tem google_event_id pra gravar — esses
 * registros nunca tiveram evento no Calendar — e protege contra remarcar
 * um já cancelado (o bot não tem essa proteção nesta query porque o
 * controller já garante status === "confirmado" antes de chamar; aqui
 * mantemos a proteção também no banco por segurança extra, já que esta é
 * uma função nova).
 */
export async function remarcarAgendamentoImportado({ id, data, hora }) {
  const { rows } = await pool.query(
    `UPDATE agendamentos_importados SET data = $2, hora = $3 WHERE id = $1 AND status = 'confirmado' RETURNING *`,
    [id, data, hora]
  );
  return rows[0] ?? null;
}

/**
 * Busca um agendamento importado por id, no mesmo formato de campo que
 * buscarAgendamentoComPacientePorId usa pro bot (paciente_nome,
 * paciente_telefone, ja_passou) — permite ao controller/view tratar as
 * duas origens sem checar o nome do campo.
 */
export async function buscarAgendamentoImportadoPorId(id) {
  const { rows } = await pool.query(
    `SELECT ai.*, ai.nome AS paciente_nome, ai.telefone AS paciente_telefone,
       ${jaPassouSql("ai")} AS ja_passou
     FROM agendamentos_importados ai
     WHERE ai.id = $1`,
    [id]
  );
  return rows[0] ?? null;
}
```

- [ ] **Passo 5: Rodar os testes e confirmar que passam**

Executar: `node --test test/agendamentoModelUnificada.test.js`

Esperado: PASS.

- [ ] **Passo 6: Verificar a tarefa**

```bash
node --test test/agendamentoModelUnificada.test.js test/dashboardControllerTelaAgendamentos.test.js
npm run lint
git diff --check
```

- [ ] **Passo 7: Commit**

```bash
git add src/models/agendamentoModel.js test/agendamentoModelUnificada.test.js
git commit -m "feat: status real de importados no model + cancelarAgendamentoImportado/remarcarAgendamentoImportado"
```

---

### Task 5: remarcarConsultaImportada

**Files:**

- Modify: `src/services/remarcacaoService.js`
- Modify: `test/remarcacaoService.test.js` (arquivo já existe, com 140
  linhas de testes de `remarcarConsulta` — o do bot; adicionar ao final,
  não sobrescrever)

**Interfaces:**

- Consome: `validarDisponibilidadeAgendamento` (Task 2),
  `remarcarAgendamentoImportado` (Task 4, importado como
  `remarcarAgendamentoImportadoNoBanco`).
- Produz: `export async function remarcarConsultaImportada({ agendamento,
  novaData, novaHora }, { validarDisponibilidade, salvarNoBanco } = {})` —
  valida disponibilidade, grava no banco, retorna o agendamento
  atualizado; propaga `err.codigo` da validação sem capturar. Consumida
  pela Task 6.

- [ ] **Passo 1: Escrever os testes que falham**

`test/remarcacaoService.test.js` já existe com 140 linhas de testes de
`remarcarConsulta` (a versão do bot, com Google Calendar) — **não
sobrescrever o arquivo**. Adicionar ao import do topo (já existe uma linha
`import { remarcarConsulta } from "../src/services/remarcacaoService.js";`
— trocar por):

```js
import { remarcarConsulta, remarcarConsultaImportada } from "../src/services/remarcacaoService.js";
```

E adicionar ao **final** do arquivo (depois do último teste existente,
`"remarcarConsulta: agendamento sem google_event_id não tenta cancelar
evento antigo"`):

```js
const AGENDAMENTO_IMPORTADO = { id: 9, tipo_atendimento: "fisioterapia" };

test("remarcarConsultaImportada: valida disponibilidade antes de gravar", async () => {
  const chamadas = [];

  await remarcarConsultaImportada(
    { agendamento: AGENDAMENTO_IMPORTADO, novaData: "2026-09-15", novaHora: "09:00" },
    {
      validarDisponibilidade: async (args) => chamadas.push(["validar", args]),
      salvarNoBanco: async (args) => (chamadas.push(["salvar", args]), { id: 9, data: "2026-09-15", hora: "09:00" }),
    }
  );

  assert.deepEqual(chamadas[0], [
    "validar",
    { data: "2026-09-15", hora: "09:00", tipoAtendimento: "fisioterapia" },
  ]);
  assert.deepEqual(chamadas[1], ["salvar", { id: 9, data: "2026-09-15", hora: "09:00" }]);
});

test("remarcarConsultaImportada: erro de validação propaga sem chamar salvarNoBanco", async () => {
  let salvou = false;

  await assert.rejects(
    () =>
      remarcarConsultaImportada(
        { agendamento: AGENDAMENTO_IMPORTADO, novaData: "2026-09-15", novaHora: "09:00" },
        {
          validarDisponibilidade: async () => {
            const erro = new Error("HORARIO_LOTADO");
            erro.codigo = "HORARIO_LOTADO";
            throw erro;
          },
          salvarNoBanco: async () => ((salvou = true), {}),
        }
      ),
    (err) => err.codigo === "HORARIO_LOTADO"
  );
  assert.equal(salvou, false);
});

test("remarcarConsultaImportada: retorna o agendamento atualizado", async () => {
  const atualizado = { id: 9, data: "2026-09-15", hora: "09:00" };

  const resultado = await remarcarConsultaImportada(
    { agendamento: AGENDAMENTO_IMPORTADO, novaData: "2026-09-15", novaHora: "09:00" },
    { validarDisponibilidade: async () => {}, salvarNoBanco: async () => atualizado }
  );

  assert.equal(resultado, atualizado);
});
```

- [ ] **Passo 2: Rodar os testes e confirmar a falha**

Executar: `node --test test/remarcacaoService.test.js`

Esperado: falha por import inexistente.

- [ ] **Passo 3: Implementar**

Em `src/services/remarcacaoService.js`, adicionar aos imports do topo:

```js
import { validarDisponibilidadeAgendamento } from "./calendarService.js";
import {
  remarcarAgendamento as remarcarAgendamentoNoBanco,
  remarcarAgendamentoImportado as remarcarAgendamentoImportadoNoBanco,
} from "../models/agendamentoModel.js";
```

(troca a linha única de import de `remarcarAgendamento` pela versão acima,
que importa os dois). No final do arquivo, adicionar:

```js
/**
 * Remarcação de agendamento importado: sem Calendar envolvido (esses
 * registros nunca tiveram evento lá), então não precisa da sequência
 * criar-depois-cancelar de remarcarConsulta — só valida disponibilidade e
 * grava a nova data/hora.
 */
export async function remarcarConsultaImportada(
  { agendamento, novaData, novaHora },
  {
    validarDisponibilidade = validarDisponibilidadeAgendamento,
    salvarNoBanco = remarcarAgendamentoImportadoNoBanco,
  } = {}
) {
  await validarDisponibilidade({
    data: novaData,
    hora: novaHora,
    tipoAtendimento: agendamento.tipo_atendimento,
  });

  return salvarNoBanco({ id: agendamento.id, data: novaData, hora: novaHora });
}
```

- [ ] **Passo 4: Rodar os testes e confirmar que passam**

Executar: `node --test test/remarcacaoService.test.js`

Esperado: PASS.

- [ ] **Passo 5: Verificar a tarefa**

```bash
node --test test/remarcacaoService.test.js test/remarcarAgendamentoFunction.test.js
npm run lint
git diff --check
```

Esperado: tudo passa — `remarcarAgendamentoFunction.test.js` cobre o bot
usando `remarcarConsulta`, que não foi tocada nesta tarefa.

- [ ] **Passo 6: Commit**

```bash
git add src/services/remarcacaoService.js test/remarcacaoService.test.js
git commit -m "feat: adiciona remarcarConsultaImportada (sem Google Calendar)"
```

---

### Task 6: Controller — origem-aware cancelar/remarcar

**Files:**

- Modify: `src/controllers/dashboardController.js`
- Modify: `test/dashboardControllerCancelarAgendamento.test.js`
- Modify: `test/dashboardControllerRemarcarAgendamento.test.js`

**Interfaces:**

- Consome: `buscarAgendamentoComPacientePorId`,
  `buscarAgendamentoImportadoPorId`, `cancelarAgendamentoConfirmado`,
  `cancelarAgendamentoImportado` (Task 4); `remarcarConsulta`,
  `remarcarConsultaImportada` (Task 5).
- Produz: `processarCancelarAgendamento`, `telaRemarcarAgendamento`,
  `processarRemarcarAgendamento` passam a ler `req.params.origem`
  (`"importado"` ou qualquer outro valor/ausente = `"bot"`, mantendo
  compatibilidade se uma rota antiga chamar sem o parâmetro). Consumida
  pela Task 7 (rotas) e Task 8 (views).

- [ ] **Passo 1: Escrever os testes que falham**

Em `test/dashboardControllerCancelarAgendamento.test.js`, renomear as
chaves de override nos testes existentes de `buscarAgendamento` para
`buscarAgendamentoBot` e de `cancelarNoBanco` para `cancelarNoBancoBot` em
**todos** os `await processarCancelarAgendamento(...)` do arquivo (5
ocorrências). Exemplo da primeira:

```js
test("processarCancelarAgendamento: id não numérico responde 404 sem consultar nada", async () => {
  let consultou = false;
  const res = criarRespostaFalsa();

  await processarCancelarAgendamento(criarRequisicao({ id: "abc" }), res, {
    buscarAgendamentoBot: async () => ((consultou = true), null),
  });

  assert.equal(res.statusCode, 404);
  assert.equal(consultou, false);
});
```

(Aplicar a mesma troca de nome de chave — sem mudar mais nada — nos outros
4 testes do arquivo: "agendamento inexistente", "falha ao cancelar no
Calendar", "corrida", "caminho feliz".)

Adicionar ao final do arquivo:

```js
test("processarCancelarAgendamento: origem importado não toca no Calendar", async () => {
  const res = criarRespostaFalsa();
  let chamouCalendar = false;

  await processarCancelarAgendamento({ params: { origem: "importado", id: "9" }, body: {} }, res, {
    buscarAgendamentoImportado: async () => ({ id: 9, ja_passou: false }),
    cancelarEvento: async () => (chamouCalendar = true),
    cancelarNoBancoImportado: async () => ({ id: 9, status: "cancelado" }),
  });

  assert.equal(chamouCalendar, false);
  assert.equal(res.redirectedTo, "/agendamentos");
});

test("processarCancelarAgendamento: origem importado, corrida (0 linhas) responde 409", async () => {
  const res = criarRespostaFalsa();

  await processarCancelarAgendamento({ params: { origem: "importado", id: "9" }, body: {} }, res, {
    buscarAgendamentoImportado: async () => ({ id: 9, ja_passou: false }),
    cancelarNoBancoImportado: async () => null,
  });

  assert.equal(res.statusCode, 409);
});

test("processarCancelarAgendamento: origem importado inexistente responde 404", async () => {
  const res = criarRespostaFalsa();

  await processarCancelarAgendamento({ params: { origem: "importado", id: "9" }, body: {} }, res, {
    buscarAgendamentoImportado: async () => null,
  });

  assert.equal(res.statusCode, 404);
});
```

Em `test/dashboardControllerRemarcarAgendamento.test.js`, adicionar ao
final do arquivo:

```js
const AGENDAMENTO_IMPORTADO = { id: 9, status: "confirmado", tipo_atendimento: "fisioterapia" };

test("telaRemarcarAgendamento: origem importado usa buscarAgendamentoImportado", async () => {
  const res = criarRespostaFalsa();

  await telaRemarcarAgendamento({ params: { origem: "importado", id: "9" }, query: {} }, res, {
    buscarAgendamentoImportado: async () => AGENDAMENTO_IMPORTADO,
  });

  assert.equal(res.viewRenderizada, "agendamentos/remarcar");
  assert.equal(res.dadosDaView.agendamento.origem, "importado");
});

test("processarRemarcarAgendamento: origem importado chama executarRemarcacaoImportado", async () => {
  const res = criarRespostaFalsa();
  let chamouBot = false;

  await processarRemarcarAgendamento(
    { params: { origem: "importado", id: "9" }, body: { data: "2026-09-10", hora: "14:00" } },
    res,
    {
      buscarAgendamentoImportado: async () => AGENDAMENTO_IMPORTADO,
      executarRemarcacaoBot: async () => (chamouBot = true),
      executarRemarcacaoImportado: async ({ agendamento, novaData, novaHora }) => {
        assert.equal(agendamento.id, 9);
        assert.equal(novaData, "2026-09-10");
        assert.equal(novaHora, "14:00");
        return {};
      },
    }
  );

  assert.equal(chamouBot, false);
  assert.equal(res.redirectedTo, "/agendamentos");
});
```

Também renomear, nos testes já existentes desse arquivo, as chaves
`buscarAgendamento` → `buscarAgendamentoBot` e `executarRemarcacao` →
`executarRemarcacaoBot` (7 ocorrências ao todo, uma por teste que passa
essas opções).

- [ ] **Passo 2: Rodar os testes e confirmar a falha**

```bash
node --test test/dashboardControllerCancelarAgendamento.test.js test/dashboardControllerRemarcarAgendamento.test.js
```

Esperado: falhas — as chaves antigas (`buscarAgendamento`,
`cancelarNoBanco`, `executarRemarcacao`) ainda são as que o controller
usa, então os testes renomeados não conseguem injetar o mock certo (os
originais ficam com o valor default e tentam bater no banco de verdade,
ou os testes novos de `origem: "importado"` caem no branch de bot, que
usa mocks default que não foram fornecidos).

- [ ] **Passo 3: Reescrever os três handlers**

Em `src/controllers/dashboardController.js`, atualizar o bloco de import
de `agendamentoModel.js`:

```js
import {
  buscarAgendamentoComPacientePorId,
  buscarAgendamentoImportadoPorId,
  cancelarAgendamentoConfirmado,
  cancelarAgendamentoImportado,
  listarAgendaUnificada,
} from "../models/agendamentoModel.js";
```

E o import de `remarcacaoService.js`:

```js
import { remarcarConsulta, remarcarConsultaImportada } from "../services/remarcacaoService.js";
```

Substituir `processarCancelarAgendamento` inteira por:

```js
export async function processarCancelarAgendamento(
  req,
  res,
  {
    buscarAgendamentoBot = buscarAgendamentoComPacientePorId,
    buscarAgendamentoImportado = buscarAgendamentoImportadoPorId,
    cancelarEvento = cancelarEventoAgendamento,
    cancelarNoBancoBot = cancelarAgendamentoConfirmado,
    cancelarNoBancoImportado = cancelarAgendamentoImportado,
  } = {}
) {
  const origem = req.params.origem === "importado" ? "importado" : "bot";
  const agendamentoId = idSeguro(req.params.id);
  if (!agendamentoId) return res.status(404).send("Agendamento não encontrado.");

  const buscarAgendamento = origem === "importado" ? buscarAgendamentoImportado : buscarAgendamentoBot;
  const agendamento = await buscarAgendamento(agendamentoId);
  if (!agendamento || agendamento.ja_passou) return res.status(404).send("Agendamento não encontrado.");

  if (origem === "bot" && agendamento.google_event_id) {
    try {
      await cancelarEvento(agendamento.google_event_id);
    } catch (err) {
      capturarErro("[dashboardController] Falha ao cancelar evento no Calendar:", err);
      return res
        .status(500)
        .send("Não foi possível cancelar por um problema técnico. Tente novamente.");
    }
  }

  const cancelarNoBanco = origem === "importado" ? cancelarNoBancoImportado : cancelarNoBancoBot;
  const cancelado = await cancelarNoBanco(agendamentoId);
  if (!cancelado) {
    return res
      .status(409)
      .send("Esse agendamento já foi atualizado por outra pessoa — recarregue a página e tente de novo.");
  }

  res.redirect("/agendamentos");
}
```

Substituir `telaRemarcarAgendamento` inteira por:

```js
export async function telaRemarcarAgendamento(
  req,
  res,
  {
    buscarAgendamentoBot = buscarAgendamentoComPacientePorId,
    buscarAgendamentoImportado = buscarAgendamentoImportadoPorId,
    buscarHorarios = listarHorariosDisponiveis,
  } = {}
) {
  const origem = req.params.origem === "importado" ? "importado" : "bot";
  const agendamentoId = idSeguro(req.params.id);
  if (!agendamentoId) return res.status(404).send("Agendamento não encontrado.");

  const buscarAgendamento = origem === "importado" ? buscarAgendamentoImportado : buscarAgendamentoBot;
  const agendamento = await buscarAgendamento(agendamentoId);
  if (!agendamento || agendamento.status !== "confirmado" || agendamento.ja_passou) {
    return res.status(404).send("Agendamento não encontrado ou não pode mais ser remarcado.");
  }

  const dataEscolhida = validarData(req.query.data) ? req.query.data : null;
  const horarios = dataEscolhida
    ? await buscarHorarios({
        data: dataEscolhida,
        tipoAtendimento: agendamento.tipo_atendimento,
        amostrar: false,
      })
    : [];

  res.render("agendamentos/remarcar", { agendamento: { ...agendamento, origem }, dataEscolhida, horarios });
}
```

Substituir `processarRemarcarAgendamento` inteira por:

```js
export async function processarRemarcarAgendamento(
  req,
  res,
  {
    buscarAgendamentoBot = buscarAgendamentoComPacientePorId,
    buscarAgendamentoImportado = buscarAgendamentoImportadoPorId,
    executarRemarcacaoBot = remarcarConsulta,
    executarRemarcacaoImportado = remarcarConsultaImportada,
  } = {}
) {
  const origem = req.params.origem === "importado" ? "importado" : "bot";
  const agendamentoId = idSeguro(req.params.id);
  if (!agendamentoId) return res.status(404).send("Agendamento não encontrado.");

  const { data: novaData, hora: novaHora } = req.body ?? {};
  if (!validarData(novaData) || !validarHora(novaHora)) {
    return res.status(400).send("Data ou hora inválida.");
  }

  const buscarAgendamento = origem === "importado" ? buscarAgendamentoImportado : buscarAgendamentoBot;
  const agendamento = await buscarAgendamento(agendamentoId);
  if (!agendamento || agendamento.status !== "confirmado" || agendamento.ja_passou) {
    return res.status(404).send("Agendamento não encontrado ou não pode mais ser remarcado.");
  }

  const executarRemarcacao = origem === "importado" ? executarRemarcacaoImportado : executarRemarcacaoBot;
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

- [ ] **Passo 4: Rodar os testes e confirmar que passam**

```bash
node --test test/dashboardControllerCancelarAgendamento.test.js test/dashboardControllerRemarcarAgendamento.test.js
```

Esperado: PASS.

- [ ] **Passo 5: Verificar a tarefa**

```bash
npm run lint
git diff --check
npm test
```

- [ ] **Passo 6: Commit**

```bash
git add src/controllers/dashboardController.js test/dashboardControllerCancelarAgendamento.test.js test/dashboardControllerRemarcarAgendamento.test.js
git commit -m "feat: controller de cancelar/remarcar passa a reconhecer origem bot/importado"
```

---

### Task 7: Rotas com prefixo :origem

**Files:**

- Modify: `src/routes/dashboardRoutes.js`

**Interfaces:**

- Consome: `processarCancelarAgendamento`, `telaRemarcarAgendamento`,
  `processarRemarcarAgendamento` (já importados, sem mudança de nome —
  Task 6 só mudou o comportamento interno).
- Produz: rotas `POST /agendamentos/:origem/:id/cancelar`, `GET
  /agendamentos/:origem/:id/remarcar`, `POST
  /agendamentos/:origem/:id/remarcar`.

- [ ] **Passo 1: Localizar as rotas atuais**

Em `src/routes/dashboardRoutes.js`, localizar (por volta da linha 75-89):

```js
router.post(
  "/agendamentos/:id/cancelar",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarCancelarAgendamento)
);
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

- [ ] **Passo 2: Substituir pelo padrão com :origem**

```js
router.post(
  "/agendamentos/:origem/:id/cancelar",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarCancelarAgendamento)
);
router.get(
  "/agendamentos/:origem/:id/remarcar",
  asyncHandler(exigirLogin),
  asyncHandler(telaRemarcarAgendamento)
);
router.post(
  "/agendamentos/:origem/:id/remarcar",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarRemarcarAgendamento)
);
```

Não há teste de rota dedicado para essas três (confirmar com `grep -rn
"'/agendamentos/:id/cancelar'\|/agendamentos/:id/remarcar" test/` antes de
prosseguir — se algum teste depender do path exato, é o único lugar que
precisaria de ajuste nesta tarefa).

- [ ] **Passo 3: Rodar a suíte completa**

```bash
npm test
npm run lint
git diff --check
```

Esperado: tudo passa — nenhum teste depende do path da rota HTTP em si
(os testes de controller chamam as funções diretamente, sem passar pelo
Express router).

- [ ] **Passo 4: Commit**

```bash
git add src/routes/dashboardRoutes.js
git commit -m "feat: rotas de cancelar/remarcar ganham prefixo :origem (bot/importado)"
```

---

### Task 8: Views — lista.ejs e remarcar.ejs

**Files:**

- Modify: `src/views/agendamentos/lista.ejs`
- Modify: `src/views/agendamentos/remarcar.ejs`
- Modify: `test/agendamentosListaView.test.js`

**Interfaces:**

- Consome: `item.origem`, `item.status`, `item.ja_passou` (já fornecidos
  pela view hoje); `agendamento.origem` (novo, produzido pela Task 6 em
  `telaRemarcarAgendamento`).

- [ ] **Passo 1: Escrever os testes que falham**

Em `test/agendamentosListaView.test.js`, **substituir** o teste
`"agendamentos/lista: importado futuro não mostra nenhuma ação"` por:

```js
test("agendamentos/lista: importado confirmado e futuro mostra ações de remarcar/cancelar", async () => {
  const html = await renderizar({
    itens: [
      {
        id: 9,
        origem: "importado",
        status: "confirmado",
        ja_passou: false,
        data: "2026-09-10",
        hora: "10:00:00",
        paciente_nome: "Ciclano",
        tipo_atendimento: "fisioterapia",
        presenca: null,
        observacao_sessao: null,
        profissional_responsavel: null,
        registrado_por_nome: null,
        registrado_em: null,
      },
    ],
  });

  assert.match(html, /href="\/agendamentos\/importado\/9\/remarcar"/);
  assert.match(html, /action="\/agendamentos\/importado\/9\/cancelar"/);
  assert.doesNotMatch(html, /name="presenca"/);
});

test("agendamentos/lista: importado cancelado mostra badge Cancelado e nenhuma ação", async () => {
  const html = await renderizar({
    itens: [
      {
        id: 10,
        origem: "importado",
        status: "cancelado",
        ja_passou: false,
        data: "2026-09-10",
        hora: "10:00:00",
        paciente_nome: "Ciclano",
        tipo_atendimento: "fisioterapia",
        presenca: null,
        observacao_sessao: null,
        profissional_responsavel: null,
        registrado_por_nome: null,
        registrado_em: null,
      },
    ],
  });

  assert.match(html, /badge-estornado is-danger">\s*Cancelado/);
  assert.doesNotMatch(html, /\/remarcar/);
  assert.doesNotMatch(html, /\/cancelar/);
});
```

Atualizar o teste `"agendamentos/lista: bot confirmado e futuro mostra
ações de remarcar/cancelar (não presença)"` (URLs ganham o prefixo `bot/`):

```js
  assert.match(html, /href="\/agendamentos\/bot\/2\/remarcar"/);
  assert.match(html, /action="\/agendamentos\/bot\/2\/cancelar"/);
```

- [ ] **Passo 2: Rodar os testes e confirmar a falha**

Executar: `node --test test/agendamentosListaView.test.js`

Esperado: falha — a view ainda restringe ações a `item.origem === "bot"` e
usa URLs sem prefixo de origem.

- [ ] **Passo 3: Atualizar lista.ejs**

Em `src/views/agendamentos/lista.ejs`, o bloco de badge de status
(coluna Status) — remover o branch de `origem === "importado"`:

```ejs
<td>
  <% if (item.status === "cancelado") { %>
    <span class="badge badge-estornado is-danger">Cancelado</span>
  <% } else if (item.status === "compareceu") { %>
    <span class="badge is-success">Compareceu</span>
  <% } else if (item.status === "faltou") { %>
    <span class="badge is-warning">Faltou</span>
  <% } else { %>
    <span class="badge"><%= item.status %></span>
  <% } %>
</td>
```

E o bloco de ações por linha — trocar `item.origem === "bot" &&` por
nada (a condição passa a valer pras duas origens) e incluir
`item.origem` nas duas URLs:

```ejs
<td>
  <% if (item.status === "confirmado" && !item.ja_passou) { %>
    <div class="row-actions">
      <a class="button button--quiet" href="/agendamentos/<%= item.origem %>/<%= item.id %>/remarcar">Remarcar</a>
      <form method="post" action="/agendamentos/<%= item.origem %>/<%= item.id %>/cancelar" onsubmit="return confirm('Cancelar este agendamento?')">
        <input type="hidden" name="_csrf" value="<%= csrfToken %>" />
        <button class="button is-danger" type="submit">Cancelar</button>
      </form>
    </div>
  <% } else if (item.ja_passou && item.status !== "cancelado") { %>
    <details class="attendance-panel">
      <summary><%= item.presenca ? "Corrigir presença" : "Registrar presença" %></summary>
      <form method="post" action="/agendamentos/<%= item.origem === 'bot' ? 'bot' : 'importado' %>/<%= item.id %>/presenca">
        <input type="hidden" name="_csrf" value="<%= csrfToken %>" />
        <label>
          <input type="radio" name="presenca" value="compareceu" <%= item.presenca === "compareceu" ? "checked" : "" %> required />
          Compareceu
        </label>
        <label>
          <input type="radio" name="presenca" value="faltou" <%= item.presenca === "faltou" ? "checked" : "" %> />
          Faltou
        </label>
        <textarea name="observacao_sessao" placeholder="Observação (opcional)"><%= item.observacao_sessao ?? "" %></textarea>
        <input type="text" name="profissional_responsavel" placeholder="Profissional responsável (opcional)" value="<%= item.profissional_responsavel ?? '' %>" />
        <button type="submit"><%= item.presenca ? "Corrigir" : "Registrar" %></button>
      </form>
    </details>
    <% if (item.presenca) { %>
      <p class="registro-info">Registrado por <%= item.registrado_por_nome %> em <%= formatarDataHora(item.registrado_em) %></p>
    <% } %>
    <% if (item.observacao_sessao) { %>
      <a href="/agendamentos/<%= item.origem === 'bot' ? 'bot' : 'importado' %>/<%= item.id %>/laudo">Gerar laudo</a>
    <% } %>
  <% } else { %>
    —
  <% } %>
</td>
```

Esse bloco inteiro (a `<td>` de Ações) substitui a atual: só a condição de
abertura (`item.origem === "bot" &&` removida) e as duas URLs do primeiro
`if` mudam — o branch `else if` (presença/laudo, que já usa `item.origem
=== 'bot' ? 'bot' : 'importado'` nas próprias URLs) e o `else` (traço)
ficam exatamente como estão hoje; reproduzidos aqui por completo só para o
executor colar o bloco todo sem precisar caçar onde termina.

- [ ] **Passo 4: Atualizar remarcar.ejs**

Em `src/views/agendamentos/remarcar.ejs`, os dois `<form ...
action="/agendamentos/<%= agendamento.id %>/remarcar">` passam a incluir a
origem:

```ejs
<form class="panel form-grid" method="get" action="/agendamentos/<%= agendamento.origem %>/<%= agendamento.id %>/remarcar">
```

e

```ejs
<form class="panel" method="post" action="/agendamentos/<%= agendamento.origem %>/<%= agendamento.id %>/remarcar">
```

- [ ] **Passo 5: Rodar os testes e confirmar que passam**

```bash
node --test test/agendamentosListaView.test.js
```

Esperado: PASS.

- [ ] **Passo 6: Verificar a tarefa**

```bash
npm test
npm run lint
git diff --check
```

- [ ] **Passo 7: Commit**

```bash
git add src/views/agendamentos/lista.ejs src/views/agendamentos/remarcar.ejs test/agendamentosListaView.test.js
git commit -m "feat: agenda mostra remarcar/cancelar para importados também"
```

---

### Task 9: Verificação final

**Files:**

- Nenhum arquivo novo — só verificação.

- [ ] **Passo 1: Suíte completa, lint, whitespace**

```bash
npm test
npm run lint
git diff --check
```

Esperado: tudo limpo.

- [ ] **Passo 2: Confirmar escopo do diff**

```bash
git log --oneline main..HEAD
git diff main --stat
```

Confirmar que o diff toca só os arquivos listados em "Estrutura de
arquivos" acima — nenhuma mudança em `server.js`, rotas do bot fora de
`dashboardRoutes.js`, ou schema além da migration 020.

- [ ] **Passo 3: Registrar pendências**

Nenhuma migration é aplicada em produção nem há push/deploy como parte
deste plano — isso segue exigindo autorização explícita separada do
usuário, igual ao resto do projeto (`TODO.md`).
