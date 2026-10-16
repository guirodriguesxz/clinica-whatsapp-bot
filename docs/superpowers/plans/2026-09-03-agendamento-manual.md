# Agendamento Manual (Criar/Editar) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar a recepção e a administradora criar e editar agendamentos manualmente pelo dashboard (Fisioterapia e Psicologia), sincronizando com o Google Calendar do mesmo jeito que o bot já faz, com busca de paciente por nome e rastreabilidade de quem criou/editou.

**Architecture:** Reaproveita ao máximo o que já existe — `criarEventoAgendamento`, `validarDisponibilidadeAgendamento`, `encontrarOuCriarPaciente`, a tabela `agendamentos` (para manual, junto com os do bot) e `agendamentos_importados` (Excel). Adiciona rotas/telas novas no dashboard, duas funções de serviço novas (`editarConsulta`/`editarConsultaImportada`) que espelham o padrão seguro já usado por `remarcarConsulta` (cria evento novo → grava banco → cancela evento antigo), e um endpoint JSON de autocomplete de paciente.

**Tech Stack:** Node.js, Express, EJS, Postgres (Neon) via `pg`, Google Calendar API (`googleapis`), `node --test` para testes, `dayjs` para datas.

**Spec:** `docs/superpowers/specs/2026-09-03-agendamento-manual-design.md`

## Global Constraints

- Nunca alterar o comportamento do bot no WhatsApp (`chatService`, webhook, function-calling) — `criarEventoAgendamento`/`validarDisponibilidadeAgendamento`/`encontrarOuCriarPaciente` continuam se comportando exatamente igual para quem já os chama hoje (bot). Qualquer parâmetro novo tem valor padrão que preserva o comportamento atual.
- Qualquer usuário logado (administradora ou recepção) pode criar/editar — sem `exigirPapel("administradora")`.
- Migration é um arquivo local, aplicada manualmente pelo usuário (Neon SQL Editor) — nunca rodar contra produção sem autorização explícita.
- Todas as rotas POST exigem `exigirCsrf` (token `_csrf` no corpo); todas exigem `exigirLogin`.
- Testes: `node --test test/`, sem framework de mock — `pool.query`/`calendar.events.*` mockados manualmente com `t.mock.method` (node:test nativo) ou dependência injetada via parâmetro (mesmo padrão de `remarcarConsulta`/`processarRemarcarAgendamento`).
- Rodar `npm test` depois de cada tarefa antes de commitar — os 458 testes existentes continuam passando.

---

## File Structure

```
src/
├── db/migrations/
│   └── 021_agendamento_manual_rastreabilidade.sql   # nova
├── config/
│   └── clinica.js                       # +capacidadeMaximaPorHorario.psicologia
├── utils/
│   └── phone.js                         # +normalizarTelefoneComDDI
├── services/
│   ├── calendarService.js               # periodosDoDia fica tipo-aware
│   │                                     #   (bugfix: psicologia usava o
│   │                                     #   horário da Fisioterapia);
│   │                                     #   +montarDetalhesEvento (interno),
│   │                                     #   +atualizarEventoAgendamento,
│   │                                     #   criarEventoAgendamento ganha
│   │                                     #   origemDescricao opcional
│   └── remarcacaoService.js             # +editarConsulta,
│                                         #   +editarConsultaImportada
├── models/
│   ├── agendamentoModel.js              # inserirAgendamento aceita
│   │                                     #   criadoPorUsuarioId;
│   │                                     #   +editarAgendamento,
│   │                                     #   +editarAgendamentoImportado
│   └── pacienteModel.js                 # +buscarPacientesPorNomeOuTelefone
├── controllers/
│   └── dashboardController.js           # +telaNovoAgendamento,
│                                         #   +processarNovoAgendamento,
│                                         #   +telaEditarAgendamento,
│                                         #   +processarEditarAgendamento,
│                                         #   +buscarPacientesJson
├── routes/
│   └── dashboardRoutes.js               # rotas novas
└── views/
    └── agendamentos/
        ├── lista.ejs                     # +link "Novo agendamento",
        │                                  #   +botão "Editar"
        ├── novo.ejs                      # nova
        └── editar.ejs                    # nova
test/
├── migrations.test.js                    # +migration 021
├── calendarService.test.js               # atualiza teste de capacidade de
│                                          #   psicologia (deixou de ser
│                                          #   ilimitada); +testes de horário
│                                          #   próprio da psicologia;
│                                          #   +testes de
│                                          #   atualizarEventoAgendamento
├── phone.test.js                         # nova — normalizarTelefoneComDDI
├── pacienteModelBusca.test.js            # nova — buscarPacientesPorNomeOuTelefone
├── agendamentoModelEditar.test.js        # nova — editarAgendamento,
│                                          #   editarAgendamentoImportado,
│                                          #   inserirAgendamento com
│                                          #   criadoPorUsuarioId
├── remarcacaoServiceEditar.test.js       # nova — editarConsulta,
│                                          #   editarConsultaImportada
├── dashboardControllerNovoAgendamento.test.js    # nova
├── dashboardControllerEditarAgendamento.test.js  # nova
└── dashboardControllerBuscaPacientes.test.js     # nova
```

---

### Task 1: Migration 021 — colunas de rastreabilidade

**Files:**
- Create: `src/db/migrations/021_agendamento_manual_rastreabilidade.sql`
- Test: `test/migrations.test.js`

**Interfaces:**
- Produces: colunas `agendamentos.criado_por_usuario_id`, `agendamentos.atualizado_por_usuario_id`, `agendamentos_importados.criado_por_usuario_id`, `agendamentos_importados.atualizado_por_usuario_id` — todas `INTEGER REFERENCES usuarios(id)`, nullable.

- [ ] **Step 1: Escrever a migration**

```sql
-- src/db/migrations/021_agendamento_manual_rastreabilidade.sql
-- Clínica Exemplo Bot — migration 021: rastreabilidade de agendamento manual
--
-- A recepção passa a poder criar e editar agendamentos manualmente pelo
-- dashboard (ver docs/superpowers/specs/2026-09-03-agendamento-manual-design.md).
-- NULL continua significando "criado pelo bot" (em agendamentos) ou "um dos
-- 327 originais da migração do Excel, nunca editado" (em
-- agendamentos_importados) — nenhuma linha existente precisa de UPDATE.

ALTER TABLE agendamentos
  ADD COLUMN IF NOT EXISTS criado_por_usuario_id INTEGER REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS atualizado_por_usuario_id INTEGER REFERENCES usuarios(id);

ALTER TABLE agendamentos_importados
  ADD COLUMN IF NOT EXISTS criado_por_usuario_id INTEGER REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS atualizado_por_usuario_id INTEGER REFERENCES usuarios(id);
```

- [ ] **Step 2: Escrever o teste da migration (mesmo padrão de `test/migrations.test.js` pra migration 020)**

Adicionar ao final de `test/migrations.test.js`:

```javascript
const MIGRATION_021 = path.join(ROOT, "src/db/migrations/021_agendamento_manual_rastreabilidade.sql");

test("migration 021: adiciona colunas de rastreabilidade nullable em agendamentos e agendamentos_importados", async () => {
  const sql = await readFile(MIGRATION_021, "utf8");

  assert.match(
    sql,
    /ALTER TABLE agendamentos\s+ADD COLUMN IF NOT EXISTS criado_por_usuario_id INTEGER REFERENCES usuarios\(id\),\s+ADD COLUMN IF NOT EXISTS atualizado_por_usuario_id INTEGER REFERENCES usuarios\(id\);/
  );
  assert.match(
    sql,
    /ALTER TABLE agendamentos_importados\s+ADD COLUMN IF NOT EXISTS criado_por_usuario_id INTEGER REFERENCES usuarios\(id\),\s+ADD COLUMN IF NOT EXISTS atualizado_por_usuario_id INTEGER REFERENCES usuarios\(id\);/
  );
  // Sem NOT NULL em nenhuma das quatro — precisam continuar nullable
  // (NULL = criado pelo bot / um dos 327 originais do Excel).
  assert.doesNotMatch(sql, /criado_por_usuario_id[^,]*NOT NULL/);
  assert.doesNotMatch(sql, /atualizado_por_usuario_id[^,]*NOT NULL/);
});
```

- [ ] **Step 3: Rodar o teste**

Run: `node --test test/migrations.test.js`
Expected: PASS (3 testes: migration 020 já existente + migration 021 nova)

- [ ] **Step 4: Commit**

```bash
git add src/db/migrations/021_agendamento_manual_rastreabilidade.sql test/migrations.test.js
git commit -m "feat: migration 021 — rastreabilidade de agendamento manual"
```

---

### Task 2: `calendarService.js` — Psicologia usa seu próprio horário + capacidade

Hoje `validarDisponibilidadeAgendamento`/`slotsLivresDoDia` usam sempre
`CLINICA.horarioFuncionamento` (o da Fisioterapia — dois períodos, com
intervalo de almoço 11:30-13:00), porque até agora só a Fisioterapia passava
por essa checagem. `CLINICA.horarioFuncionamentoPsicologia` (um período único
08:00-18:40, sem intervalo) existe só como informativo. Ao permitir
agendamento manual de Psicologia, isso vira um bug real: um horário de
Psicologia às 12:00 (dentro do expediente real da Psicologia, mas dentro do
"almoço" da Fisioterapia) seria rejeitado incorretamente.

**Files:**
- Modify: `src/config/clinica.js`
- Modify: `src/services/calendarService.js:38-43` (`periodosDoDia`) e chamadores
- Test: `test/calendarService.test.js`

**Interfaces:**
- Produces: `periodosDoDia(diaDayjs, tipoAtendimento)` (assinatura muda — antes só recebia `diaDayjs`); `validarDisponibilidadeAgendamento({ data, hora, tipoAtendimento })` continua com a mesma assinatura pública.

- [ ] **Step 1: Escrever os testes que hoje falhariam (fixar o teste existente + adicionar os novos)**

Em `test/calendarService.test.js`, **substituir** o teste `"validarDisponibilidadeAgendamento: tipo sem limite configurado (psicologia) não consulta capacidade"` (linhas 68-77) — ele fica factualmente errado depois desta tarefa — por:

```javascript
test("validarDisponibilidadeAgendamento: psicologia agora tem capacidade 1 por horário e lança HORARIO_LOTADO quando ocupado", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ total: 1 }] }));

  const dia = proximoDiaUtil().format("YYYY-MM-DD");
  await assert.rejects(
    () => validarDisponibilidadeAgendamento({ data: dia, hora: "08:00", tipoAtendimento: "psicologia" }),
    (err) => err.codigo === "HORARIO_LOTADO"
  );
});

test("validarDisponibilidadeAgendamento: psicologia livre (capacidade 1, ocupação 0) não lança nada", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ total: 0 }] }));

  const dia = proximoDiaUtil().format("YYYY-MM-DD");
  await assert.doesNotReject(() =>
    validarDisponibilidadeAgendamento({ data: dia, hora: "08:00", tipoAtendimento: "psicologia" })
  );
});
```

E adicionar, no final do arquivo:

```javascript
test("validarDisponibilidadeAgendamento: psicologia usa seu próprio horário de funcionamento, sem o intervalo de almoço da Fisioterapia", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ total: 0 }] }));

  const dia = proximoDiaUtil().format("YYYY-MM-DD");
  // 12:00 cai no intervalo de almoço da Fisioterapia (11:30-13:00) mas está
  // dentro do expediente único da Psicologia (08:00-18:40) — antes desta
  // tarefa, isso lançava FORA_DO_HORARIO_FUNCIONAMENTO por engano.
  await assert.doesNotReject(() =>
    validarDisponibilidadeAgendamento({ data: dia, hora: "12:00", tipoAtendimento: "psicologia" })
  );
});

test("validarDisponibilidadeAgendamento: fisioterapia continua rejeitando o horário de almoço (comportamento inalterado)", async () => {
  const dia = proximoDiaUtil().format("YYYY-MM-DD");
  await assert.rejects(
    () => validarDisponibilidadeAgendamento({ data: dia, hora: "12:00", tipoAtendimento: "fisioterapia" }),
    (err) => err.codigo === "FORA_DO_HORARIO_FUNCIONAMENTO"
  );
});
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `node --test test/calendarService.test.js`
Expected: FAIL nos 4 testes novos/alterados (psicologia ainda sem capacidade configurada, e ainda usando o horário da Fisioterapia).

- [ ] **Step 3: `clinica.js` — capacidade de Psicologia**

Em `src/config/clinica.js`, dentro de `capacidadeMaximaPorHorario`:

```javascript
  capacidadeMaximaPorHorario: {
    fisioterapia: 7,
    psicologia: 1,
  },
```

- [ ] **Step 4: `calendarService.js` — `periodosDoDia` fica tipo-aware**

Substituir (linhas 38-43):

```javascript
function periodosDoDia(diaDayjs) {
  return CLINICA.horarioFuncionamento.periodos.map((p) => ({
    inicio: horaParaDayjs(diaDayjs, p.inicio),
    fim: horaParaDayjs(diaDayjs, p.fim),
  }));
}
```

por:

```javascript
function periodosDoDia(diaDayjs, tipoAtendimento) {
  const configuracao =
    tipoAtendimento === "psicologia"
      ? CLINICA.horarioFuncionamentoPsicologia
      : CLINICA.horarioFuncionamento;
  return configuracao.periodos.map((p) => ({
    inicio: horaParaDayjs(diaDayjs, p.inicio),
    fim: horaParaDayjs(diaDayjs, p.fim),
  }));
}
```

E atualizar os dois chamadores:

Em `slotsLivresDoDia` (linha ~92): trocar `const periodos = periodosDoDia(diaDayjs);` por `const periodos = periodosDoDia(diaDayjs, tipoAtendimento);` (a função já recebe `tipoAtendimento` como parâmetro).

Em `validarDisponibilidadeAgendamento` (linha ~253): trocar `const periodo = periodoContendo(inicio, fim, periodosDoDia(inicio));` por `const periodo = periodoContendo(inicio, fim, periodosDoDia(inicio, tipoAtendimento));`.

- [ ] **Step 5: Rodar os testes de novo**

Run: `node --test test/calendarService.test.js`
Expected: PASS em todos.

- [ ] **Step 6: Rodar a suíte inteira (checar regressão em quem usa `slotsLivresDoDia`/`listarHorariosDisponiveis` pra fisioterapia)**

Run: `npm test`
Expected: PASS nos 458+ testes existentes (nenhum deles passa `tipoAtendimento: "psicologia"` pra `listarHorariosDisponiveis`, então o comportamento pra fisioterapia — o único exercitado hoje — fica idêntico).

- [ ] **Step 7: Commit**

```bash
git add src/config/clinica.js src/services/calendarService.js test/calendarService.test.js
git commit -m "fix: psicologia usa seu próprio horário de funcionamento e ganha capacidade de 1 por horário"
```

---

### Task 3: `calendarService.js` — texto de origem do evento + `atualizarEventoAgendamento`

**Files:**
- Modify: `src/services/calendarService.js`
- Test: `test/calendarService.test.js`

**Interfaces:**
- Consumes: `CALENDAR_ID`, `calendar` de `../config/googleCalendar.js` (já importados); `ehConvenio`, `formatarTelefoneExibicao` (já existem no arquivo).
- Produces:
  - `criarEventoAgendamento({ nomePaciente, data, hora, tipoAtendimento, convenio, telefone, primeiraConsulta, queixaPrincipal, origemDescricao = "Agendado automaticamente via WhatsApp (Clínica Exemplo Bot)." })` — assinatura estendida, comportamento padrão idêntico ao de hoje pra quem não passa `origemDescricao` (o bot).
  - `atualizarEventoAgendamento(googleEventId, { nomePaciente, tipoAtendimento, convenio, telefone, primeiraConsulta, queixaPrincipal })` — novo. Usa `origemDescricao: "Agendado manualmente pelo dashboard (Clínica Exemplo Bot)."` fixo.

- [ ] **Step 1: Escrever os testes**

Adicionar a `test/calendarService.test.js` (precisa de um mock de `calendar` — importar de `../src/config/googleCalendar.js`):

```javascript
import { calendar } from "../src/config/googleCalendar.js";
import { criarEventoAgendamento, atualizarEventoAgendamento } from "../src/services/calendarService.js";
```

```javascript
test("criarEventoAgendamento: sem origemDescricao, usa o texto padrão do bot (comportamento inalterado)", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ total: 0 }] }));
  let requestBodyCapturado = null;
  t.mock.method(calendar.events, "insert", async ({ requestBody }) => {
    requestBodyCapturado = requestBody;
    return { data: { id: "evt-1" } };
  });

  const dia = proximoDiaUtil().format("YYYY-MM-DD");
  await criarEventoAgendamento({
    nomePaciente: "Ana",
    data: dia,
    hora: "08:00",
    tipoAtendimento: "fisioterapia",
    convenio: "Particular",
    telefone: "5511999990000",
    primeiraConsulta: true,
  });

  assert.match(requestBodyCapturado.description, /Agendado automaticamente via WhatsApp \(Clínica Exemplo Bot\)\.$/);
});

test("criarEventoAgendamento: com origemDescricao customizado, usa o texto informado", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ total: 0 }] }));
  let requestBodyCapturado = null;
  t.mock.method(calendar.events, "insert", async ({ requestBody }) => {
    requestBodyCapturado = requestBody;
    return { data: { id: "evt-1" } };
  });

  const dia = proximoDiaUtil().format("YYYY-MM-DD");
  await criarEventoAgendamento({
    nomePaciente: "Ana",
    data: dia,
    hora: "08:00",
    tipoAtendimento: "fisioterapia",
    convenio: "Particular",
    telefone: "5511999990000",
    primeiraConsulta: true,
    origemDescricao: "Agendado manualmente pelo dashboard (Clínica Exemplo Bot).",
  });

  assert.match(requestBodyCapturado.description, /Agendado manualmente pelo dashboard \(Clínica Exemplo Bot\)\.$/);
});

test("atualizarEventoAgendamento: faz patch com summary/description novos e texto de origem manual", async (t) => {
  let chamada = null;
  t.mock.method(calendar.events, "patch", async (args) => {
    chamada = args;
    return { data: { id: "evt-1" } };
  });

  await atualizarEventoAgendamento("evt-1", {
    nomePaciente: "Bruno",
    tipoAtendimento: "psicologia",
    convenio: "Particular",
    telefone: "5511988880000",
    primeiraConsulta: true,
    queixaPrincipal: null,
  });

  assert.equal(chamada.eventId, "evt-1");
  assert.match(chamada.requestBody.summary, /^Bruno - Psicologia \(Particular\)/);
  assert.match(chamada.requestBody.description, /<b>Bruno<\/b>/);
  assert.match(chamada.requestBody.description, /Agendado manualmente pelo dashboard \(Clínica Exemplo Bot\)\.$/);
});
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `node --test test/calendarService.test.js`
Expected: FAIL (`atualizarEventoAgendamento` não existe ainda; `criarEventoAgendamento` ainda não aceita `origemDescricao`).

- [ ] **Step 3: Implementar**

Em `src/services/calendarService.js`, extrair a montagem de `summary`/`description` de dentro de `criarEventoAgendamento` para uma função interna nova, e usá-la também em `atualizarEventoAgendamento`. Substituir o bloco de `criarEventoAgendamento` (linhas 284-326) por:

```javascript
function montarDetalhesEvento({
  nomePaciente,
  tipoAtendimento,
  convenio,
  telefone,
  primeiraConsulta,
  queixaPrincipal,
  origemDescricao,
}) {
  const eConvenio = ehConvenio(convenio);
  const ehRetorno = primeiraConsulta === false;
  const linhasDescricao = [`<b>${nomePaciente}</b>`];
  if (telefone) linhasDescricao.push(`Telefone: ${formatarTelefoneExibicao(telefone)}`);
  linhasDescricao.push(ehRetorno ? "Retorno" : "Primeira consulta");
  if (queixaPrincipal) linhasDescricao.push(`Queixa principal: ${queixaPrincipal}`);
  linhasDescricao.push(origemDescricao);

  return {
    summary: `${nomePaciente} - ${tipoAtendimento[0].toUpperCase()}${tipoAtendimento.slice(1)}${eConvenio ? ` (${convenio})` : " (Particular)"}${ehRetorno ? " [RETORNO]" : ""}`,
    description: linhasDescricao.join("\n"),
  };
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
  origemDescricao = "Agendado automaticamente via WhatsApp (Clínica Exemplo Bot).",
}) {
  await validarDisponibilidadeAgendamento({ data, hora, tipoAtendimento });

  const duracao = CLINICA.duracaoConsultaMinutos[tipoAtendimento] ?? 50;
  const inicio = dayjs.tz(`${data}T${hora}`, CLINICA.timezone);
  const fim = inicio.add(duracao, "minute");

  const { summary, description } = montarDetalhesEvento({
    nomePaciente,
    tipoAtendimento,
    convenio,
    telefone,
    primeiraConsulta,
    queixaPrincipal,
    origemDescricao,
  });

  const { data: evento } = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: {
      summary,
      description,
      colorId: COR_AGENDADO_PELO_BOT,
      start: { dateTime: inicio.toISOString(), timeZone: CLINICA.timezone },
      end: { dateTime: fim.toISOString(), timeZone: CLINICA.timezone },
    },
  });

  return evento;
}

/**
 * Atualiza o título/descrição de um evento já existente, sem mudar
 * data/hora — usado quando "Editar" só troca o paciente vinculado (ver
 * editarConsulta em remarcacaoService.js). Trocar data/hora/tipo continua
 * indo pelo caminho de recriar o evento (criarEventoAgendamento +
 * cancelarEventoAgendamento), igual à remarcação, porque mudar o horário do
 * evento exige recalcular start/end.
 */
export async function atualizarEventoAgendamento(
  googleEventId,
  { nomePaciente, tipoAtendimento, convenio, telefone, primeiraConsulta, queixaPrincipal }
) {
  const { summary, description } = montarDetalhesEvento({
    nomePaciente,
    tipoAtendimento,
    convenio,
    telefone,
    primeiraConsulta,
    queixaPrincipal,
    origemDescricao: "Agendado manualmente pelo dashboard (Clínica Exemplo Bot).",
  });

  const { data: evento } = await calendar.events.patch({
    calendarId: CALENDAR_ID,
    eventId: googleEventId,
    requestBody: { summary, description },
  });

  return evento;
}
```

- [ ] **Step 4: Rodar os testes**

Run: `node --test test/calendarService.test.js`
Expected: PASS em todos.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS — `src/functions/criarAgendamento.js` e `remarcacaoService.js` chamam `criarEventoAgendamento` sem `origemDescricao`, então continuam recebendo o texto padrão do bot.

- [ ] **Step 6: Commit**

```bash
git add src/services/calendarService.js test/calendarService.test.js
git commit -m "feat: calendarService ganha atualizarEventoAgendamento e origemDescricao configurável"
```

---

### Task 4: `utils/phone.js` — `normalizarTelefoneComDDI`

Usado pelo formulário de "cadastrar paciente novo" dentro do fluxo de
agendamento manual, pra normalizar o telefone digitado pra recepção no mesmo
formato (dígitos + DDI) que `pacientes.telefone` já usa.

**Files:**
- Modify: `src/utils/phone.js`
- Test: `test/phone.test.js` (novo)

**Interfaces:**
- Produces: `normalizarTelefoneComDDI(bruto: string) => string | null`

- [ ] **Step 1: Escrever o teste**

```javascript
// test/phone.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizarTelefoneComDDI } from "../src/utils/phone.js";

test("normalizarTelefoneComDDI: 11 dígitos sem DDI ganha o 55 na frente", () => {
  assert.equal(normalizarTelefoneComDDI("11988887777"), "5511988887777");
});

test("normalizarTelefoneComDDI: 10 dígitos (fixo, sem 9) sem DDI ganha o 55 na frente", () => {
  assert.equal(normalizarTelefoneComDDI("1132224444"), "551132224444");
});

test("normalizarTelefoneComDDI: já com DDI 55 (13 dígitos) mantém como está", () => {
  assert.equal(normalizarTelefoneComDDI("5511988887777"), "5511988887777");
});

test("normalizarTelefoneComDDI: aceita pontuação/formatação e limpa antes de validar", () => {
  assert.equal(normalizarTelefoneComDDI("(11) 98888-7777"), "5511988887777");
});

test("normalizarTelefoneComDDI: quantidade de dígitos inválida retorna null", () => {
  assert.equal(normalizarTelefoneComDDI("123"), null);
  assert.equal(normalizarTelefoneComDDI(""), null);
  assert.equal(normalizarTelefoneComDDI(undefined), null);
});
```

- [ ] **Step 2: Rodar o teste pra confirmar que falha**

Run: `node --test test/phone.test.js`
Expected: FAIL — `normalizarTelefoneComDDI` não existe.

- [ ] **Step 3: Implementar**

Adicionar ao final de `src/utils/phone.js`:

```javascript
/**
 * Normaliza um telefone digitado à mão (recepção cadastrando paciente novo
 * pelo dashboard) pro mesmo formato (dígitos + DDI) que pacientes.telefone
 * já usa. Mesma regra de comprimento de buscarPacientePorTelefoneNormalizado
 * (pacienteModel.js): 10/11 dígitos sem DDI ganham "55" na frente; 12/13 já
 * com "55" ficam como estão; qualquer outro comprimento é inválido.
 */
export function normalizarTelefoneComDDI(bruto) {
  const digitos = String(bruto ?? "").replace(/\D/g, "");
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) return digitos;
  return null;
}
```

- [ ] **Step 4: Rodar o teste**

Run: `node --test test/phone.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/phone.js test/phone.test.js
git commit -m "feat: normalizarTelefoneComDDI para cadastro manual de paciente"
```

---

### Task 5: `pacienteModel.js` — busca de paciente por nome/telefone (autocomplete)

**Files:**
- Modify: `src/models/pacienteModel.js`
- Test: `test/pacienteModelBusca.test.js` (novo)

**Interfaces:**
- Produces: `buscarPacientesPorNomeOuTelefone(termo: string) => Promise<Array<{ id, nome, telefone, convenio, total_consultas, ultima_consulta }>>` — até 10 resultados.

- [ ] **Step 1: Escrever o teste**

```javascript
// test/pacienteModelBusca.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { buscarPacientesPorNomeOuTelefone } from "../src/models/pacienteModel.js";

test("buscarPacientesPorNomeOuTelefone: termo vazio não consulta o banco e retorna lista vazia", async (t) => {
  let consultou = false;
  t.mock.method(pool, "query", async () => ((consultou = true), { rows: [] }));

  const resultado = await buscarPacientesPorNomeOuTelefone("");
  assert.deepEqual(resultado, []);
  assert.equal(consultou, false);
});

test("buscarPacientesPorNomeOuTelefone: busca por nome (ILIKE) e telefone (dígitos) e limita a 10", async (t) => {
  let sqlCapturado = null;
  let paramsCapturados = null;
  t.mock.method(pool, "query", async (sql, params) => {
    sqlCapturado = sql;
    paramsCapturados = params;
    return { rows: [] };
  });

  await buscarPacientesPorNomeOuTelefone("Ana 11999");

  assert.match(sqlCapturado, /ILIKE/);
  assert.match(sqlCapturado, /LIMIT 10/);
  assert.equal(paramsCapturados[0], "%Ana 11999%");
  assert.equal(paramsCapturados[1], "11999");
});

test("buscarPacientesPorNomeOuTelefone: quando o termo não tem nenhum dígito, o parâmetro de telefone vai como null", async (t) => {
  let paramsCapturados = null;
  t.mock.method(pool, "query", async (sql, params) => {
    paramsCapturados = params;
    return { rows: [] };
  });

  await buscarPacientesPorNomeOuTelefone("Ana Paula");
  assert.equal(paramsCapturados[1], null);
});

test("buscarPacientesPorNomeOuTelefone: retorna total_consultas e ultima_consulta por paciente", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      { id: 1, nome: "Ana", telefone: "5511999990000", convenio: "Mar Azul Saúde", total_consultas: 3, ultima_consulta: "2026-08-20" },
    ],
  }));

  const resultado = await buscarPacientesPorNomeOuTelefone("Ana");
  assert.equal(resultado[0].total_consultas, 3);
  assert.equal(resultado[0].ultima_consulta, "2026-08-20");
});
```

- [ ] **Step 2: Rodar o teste pra confirmar que falha**

Run: `node --test test/pacienteModelBusca.test.js`
Expected: FAIL — função não existe.

- [ ] **Step 3: Implementar**

Adicionar ao final de `src/models/pacienteModel.js`:

```javascript
/**
 * Autocomplete de paciente no formulário de agendamento manual — busca por
 * nome (ILIKE) OU pelos dígitos do telefone, com um resumo curto da ficha
 * (total de consultas e a mais recente) pra recepção confirmar que achou o
 * paciente certo antes de escolher. Mesmo cuidado de listarAgendaUnificada
 * com o parâmetro de dígitos: se o termo não tem nenhum dígito, ele vai como
 * null (comparar contra string vazia casaria QUALQUER telefone via LIKE '%%').
 */
export async function buscarPacientesPorNomeOuTelefone(termo) {
  const termoLimpo = typeof termo === "string" ? termo.trim() : "";
  if (!termoLimpo) return [];

  const digitos = termoLimpo.replace(/\D/g, "") || null;

  const { rows } = await pool.query(
    `SELECT
       p.id, p.nome, p.telefone, p.convenio,
       COUNT(a.id)::int AS total_consultas,
       MAX(a.data)::text AS ultima_consulta
     FROM pacientes p
     LEFT JOIN agendamentos a ON a.paciente_id = p.id
     WHERE p.nome ILIKE '%' || $1 || '%'
        OR ($2::text IS NOT NULL AND regexp_replace(p.telefone, '\\D', '', 'g') LIKE '%' || $2 || '%')
     GROUP BY p.id
     ORDER BY p.nome ASC
     LIMIT 10`,
    [termoLimpo, digitos]
  );
  return rows;
}
```

- [ ] **Step 4: Rodar o teste**

Run: `node --test test/pacienteModelBusca.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/models/pacienteModel.js test/pacienteModelBusca.test.js
git commit -m "feat: busca de paciente por nome/telefone para autocomplete"
```

---

### Task 6: `agendamentoModel.js` — criar com rastreabilidade + editar (bot/manual e importado)

**Files:**
- Modify: `src/models/agendamentoModel.js`
- Test: `test/agendamentoModelEditar.test.js` (novo)

**Interfaces:**
- Consumes: `pool` de `../db/pool.js` (já importado).
- Produces:
  - `inserirAgendamento({ pacienteId, data, hora, tipoAtendimento, status, googleEventId, primeiraConsulta, queixaPrincipal, criadoPorUsuarioId })` — assinatura estendida (campo novo opcional, `null` quando ausente).
  - `editarAgendamento({ id, pacienteId, data, hora, tipoAtendimento, googleEventId, atualizadoPorUsuarioId })` — `UPDATE agendamentos ... RETURNING *`, sempre grava todos os campos informados.
  - `editarAgendamentoImportado({ id, nome, telefone, tipoAtendimento, data, hora, atualizadoPorUsuarioId })` — `UPDATE agendamentos_importados ... WHERE status = 'confirmado' RETURNING *`, retorna `null` se 0 linhas afetadas (mesmo padrão de `remarcarAgendamentoImportado`).

- [ ] **Step 1: Escrever os testes**

```javascript
// test/agendamentoModelEditar.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import {
  inserirAgendamento,
  editarAgendamento,
  editarAgendamentoImportado,
} from "../src/models/agendamentoModel.js";

test("inserirAgendamento: grava criado_por_usuario_id quando informado", async (t) => {
  let sqlCapturado = null;
  let paramsCapturados = null;
  t.mock.method(pool, "query", async (sql, params) => {
    sqlCapturado = sql;
    paramsCapturados = params;
    return { rows: [{ id: 1 }] };
  });

  await inserirAgendamento({
    pacienteId: 10,
    data: "2026-09-10",
    hora: "08:00",
    tipoAtendimento: "fisioterapia",
    googleEventId: "evt-1",
    criadoPorUsuarioId: 3,
  });

  assert.match(sqlCapturado, /criado_por_usuario_id/);
  assert.equal(paramsCapturados.at(-1), 3);
});

test("inserirAgendamento: sem criadoPorUsuarioId (chamada do bot), grava null — comportamento inalterado", async (t) => {
  let paramsCapturados = null;
  t.mock.method(pool, "query", async (sql, params) => {
    paramsCapturados = params;
    return { rows: [{ id: 1 }] };
  });

  await inserirAgendamento({
    pacienteId: 10,
    data: "2026-09-10",
    hora: "08:00",
    tipoAtendimento: "fisioterapia",
    googleEventId: "evt-1",
  });

  assert.equal(paramsCapturados.at(-1), null);
});

test("editarAgendamento: atualiza paciente/data/hora/tipo/evento/rastreabilidade e retorna a linha", async (t) => {
  let sqlCapturado = null;
  let paramsCapturados = null;
  t.mock.method(pool, "query", async (sql, params) => {
    sqlCapturado = sql;
    paramsCapturados = params;
    return { rows: [{ id: 5, paciente_id: 20 }] };
  });

  const resultado = await editarAgendamento({
    id: 5,
    pacienteId: 20,
    data: "2026-09-11",
    hora: "09:00",
    tipoAtendimento: "psicologia",
    googleEventId: "evt-novo",
    atualizadoPorUsuarioId: 2,
  });

  assert.match(sqlCapturado, /UPDATE agendamentos/);
  assert.deepEqual(paramsCapturados, [5, 20, "2026-09-11", "09:00", "psicologia", "evt-novo", 2]);
  assert.equal(resultado.id, 5);
});

test("editarAgendamentoImportado: atualiza nome/telefone/tipo/data/hora/rastreabilidade só se ainda confirmado", async (t) => {
  let sqlCapturado = null;
  t.mock.method(pool, "query", async (sql) => {
    sqlCapturado = sql;
    return { rows: [{ id: 9 }] };
  });

  const resultado = await editarAgendamentoImportado({
    id: 9,
    nome: "Novo Nome",
    telefone: "5511988887777",
    tipoAtendimento: "fisioterapia",
    data: "2026-09-12",
    hora: "10:00",
    atualizadoPorUsuarioId: 2,
  });

  assert.match(sqlCapturado, /UPDATE agendamentos_importados/);
  assert.match(sqlCapturado, /status = 'confirmado'/);
  assert.equal(resultado.id, 9);
});

test("editarAgendamentoImportado: 0 linhas afetadas (corrida) retorna null", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await editarAgendamentoImportado({
    id: 9,
    nome: "X",
    telefone: "5511988887777",
    tipoAtendimento: "fisioterapia",
    data: "2026-09-12",
    hora: "10:00",
    atualizadoPorUsuarioId: 2,
  });

  assert.equal(resultado, null);
});
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `node --test test/agendamentoModelEditar.test.js`
Expected: FAIL — `editarAgendamento`/`editarAgendamentoImportado` não existem; `inserirAgendamento` ainda não aceita `criadoPorUsuarioId`.

- [ ] **Step 3: Implementar**

Em `src/models/agendamentoModel.js`, substituir `inserirAgendamento` (linhas 6-33) por:

```javascript
export async function inserirAgendamento({
  pacienteId,
  data,
  hora,
  tipoAtendimento,
  status = "confirmado",
  googleEventId,
  primeiraConsulta,
  queixaPrincipal,
  criadoPorUsuarioId,
}) {
  const { rows } = await pool.query(
    `INSERT INTO agendamentos
       (paciente_id, data, hora, tipo_atendimento, status, google_event_id, primeira_consulta, queixa_principal, criado_por_usuario_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      pacienteId,
      data,
      hora,
      tipoAtendimento,
      status,
      googleEventId ?? null,
      primeiraConsulta ?? null,
      queixaPrincipal ?? null,
      criadoPorUsuarioId ?? null,
    ]
  );
  return rows[0];
}
```

E adicionar, perto de `remarcarAgendamento`/`remarcarAgendamentoImportado` (depois da linha 220):

```javascript
/**
 * Edição completa de um agendamento (bot ou manual — mesma tabela): troca
 * paciente, data, hora, tipo e o evento do Calendar vinculado, grava quem
 * editou. Diferente de remarcarAgendamento (só data/hora/evento), usado pela
 * ação "Editar" — ver editarConsulta em remarcacaoService.js, que decide se
 * o evento precisa ser recriado ou só ter o texto atualizado antes de
 * chamar esta função.
 */
export async function editarAgendamento({
  id,
  pacienteId,
  data,
  hora,
  tipoAtendimento,
  googleEventId,
  atualizadoPorUsuarioId,
}) {
  const { rows } = await pool.query(
    `UPDATE agendamentos
     SET paciente_id = $2, data = $3, hora = $4, tipo_atendimento = $5,
         google_event_id = $6, atualizado_por_usuario_id = $7
     WHERE id = $1
     RETURNING *`,
    [id, pacienteId, data, hora, tipoAtendimento, googleEventId, atualizadoPorUsuarioId]
  );
  return rows[0] ?? null;
}

/**
 * Edição completa de um agendamento importado: sem paciente_id (a tabela
 * nunca teve vínculo com pacientes) — "trocar o paciente" aqui edita
 * nome/telefone direto na própria linha. Mesma proteção de
 * remarcarAgendamentoImportado: só edita se ainda confirmado, 0 linhas
 * afetadas sinaliza corrida pro controller responder 409.
 */
export async function editarAgendamentoImportado({
  id,
  nome,
  telefone,
  tipoAtendimento,
  data,
  hora,
  atualizadoPorUsuarioId,
}) {
  const { rows } = await pool.query(
    `UPDATE agendamentos_importados
     SET nome = $2, telefone = $3, tipo_atendimento = $4, data = $5, hora = $6,
         atualizado_por_usuario_id = $7
     WHERE id = $1 AND status = 'confirmado'
     RETURNING *`,
    [id, nome, telefone, tipoAtendimento, data, hora, atualizadoPorUsuarioId]
  );
  return rows[0] ?? null;
}
```

- [ ] **Step 4: Rodar os testes**

Run: `node --test test/agendamentoModelEditar.test.js`
Expected: PASS.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS — `criarAgendamento.js` (bot) chama `inserirAgendamento` sem `criadoPorUsuarioId`, grava `null`, igual a hoje.

- [ ] **Step 6: Commit**

```bash
git add src/models/agendamentoModel.js test/agendamentoModelEditar.test.js
git commit -m "feat: agendamentoModel ganha editarAgendamento/editarAgendamentoImportado e rastreabilidade na criação"
```

---

### Task 7: `remarcacaoService.js` — `editarConsulta` e `editarConsultaImportada`

Espelha o padrão seguro de `remarcarConsulta` (cria evento novo → grava
banco → cancela evento antigo), mas cobre também troca de tipo/paciente. Caso
especial: se só o paciente mudou (data/hora/tipo iguais), não recria o
evento — só faz `patch` (`atualizarEventoAgendamento`, Task 3) com o
nome/telefone novos.

**Files:**
- Modify: `src/services/remarcacaoService.js`
- Test: `test/remarcacaoServiceEditar.test.js` (novo)

**Interfaces:**
- Consumes: `criarEventoAgendamento`, `cancelarEventoAgendamento`, `atualizarEventoAgendamento` (Task 3) de `./calendarService.js`; `editarAgendamento`, `editarAgendamentoImportado` (Task 6) de `../models/agendamentoModel.js`.
- Produces:
  - `editarConsulta({ agendamento, novoPacienteId, novoNomePaciente, novoTelefone, novoConvenio, novaData, novaHora, novoTipoAtendimento, usuarioId }, deps?)`
  - `editarConsultaImportada({ agendamento, novoNome, novoTelefone, novoTipoAtendimento, novaData, novaHora, usuarioId }, deps?)`

- [ ] **Step 1: Escrever os testes**

```javascript
// test/remarcacaoServiceEditar.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { editarConsulta, editarConsultaImportada } from "../src/services/remarcacaoService.js";

const AGENDAMENTO = {
  id: 5,
  paciente_id: 20,
  paciente_nome: "Ana",
  paciente_convenio: "Particular",
  paciente_telefone: "5511999990000",
  tipo_atendimento: "fisioterapia",
  data: "2026-09-10",
  hora: "08:00",
  primeira_consulta: true,
  queixa_principal: null,
  google_event_id: "evt-antigo",
};

test("editarConsulta: só troca o paciente (data/hora/tipo iguais) — faz patch no evento, não recria", async () => {
  const chamadas = [];
  const resultado = await editarConsulta(
    {
      agendamento: AGENDAMENTO,
      novoPacienteId: 30,
      novoNomePaciente: "Bruno",
      novoTelefone: "5511988880000",
      novoConvenio: "Mar Azul Saúde",
      novaData: AGENDAMENTO.data,
      novaHora: AGENDAMENTO.hora,
      novoTipoAtendimento: AGENDAMENTO.tipo_atendimento,
      usuarioId: 2,
    },
    {
      atualizarEvento: async (id, dados) => (chamadas.push(["atualizarEvento", id, dados]), { id }),
      criarEvento: async () => { throw new Error("não deveria recriar evento"); },
      cancelarEvento: async () => { throw new Error("não deveria cancelar evento"); },
      salvarNoBanco: async (args) => (chamadas.push(["salvarNoBanco", args]), { id: 5, ...args }),
    }
  );

  assert.deepEqual(chamadas.map((c) => c[0]), ["atualizarEvento", "salvarNoBanco"]);
  assert.equal(chamadas[0][1], "evt-antigo");
  assert.equal(chamadas[1][1].pacienteId, 30);
  assert.equal(chamadas[1][1].googleEventId, "evt-antigo", "evento não muda quando só troca paciente");
  assert.equal(resultado.pacienteId, 30);
});

test("editarConsulta: troca data/hora — recria o evento e cancela o antigo (mesma sequência segura da remarcação)", async () => {
  const chamadas = [];
  await editarConsulta(
    {
      agendamento: AGENDAMENTO,
      novoPacienteId: AGENDAMENTO.paciente_id,
      novoNomePaciente: AGENDAMENTO.paciente_nome,
      novoTelefone: AGENDAMENTO.paciente_telefone,
      novoConvenio: AGENDAMENTO.paciente_convenio,
      novaData: "2026-09-15",
      novaHora: "09:00",
      novoTipoAtendimento: AGENDAMENTO.tipo_atendimento,
      usuarioId: 2,
    },
    {
      atualizarEvento: async () => { throw new Error("não deveria fazer patch"); },
      criarEvento: async (args) => (chamadas.push(["criarEvento", args]), { id: "evt-novo" }),
      salvarNoBanco: async (args) => (chamadas.push(["salvarNoBanco", args]), { id: 5, ...args }),
      cancelarEvento: async (id) => chamadas.push(["cancelarEvento", id]),
    }
  );

  assert.deepEqual(chamadas.map((c) => c[0]), ["criarEvento", "salvarNoBanco", "cancelarEvento"]);
  assert.equal(chamadas[0][1].data, "2026-09-15");
  assert.equal(
    chamadas[0][1].origemDescricao,
    "Agendado manualmente pelo dashboard (Clínica Exemplo Bot).",
    "recriar evento numa edição sempre usa o texto manual, mesmo se o agendamento original era do bot"
  );
  assert.equal(chamadas[1][1].googleEventId, "evt-novo");
  assert.equal(chamadas[2][1], "evt-antigo");
});

test("editarConsulta: troca só o tipo (data/hora iguais) — também recria o evento (duração muda)", async () => {
  const chamadas = [];
  await editarConsulta(
    {
      agendamento: AGENDAMENTO,
      novoPacienteId: AGENDAMENTO.paciente_id,
      novoNomePaciente: AGENDAMENTO.paciente_nome,
      novoTelefone: AGENDAMENTO.paciente_telefone,
      novoConvenio: AGENDAMENTO.paciente_convenio,
      novaData: AGENDAMENTO.data,
      novaHora: AGENDAMENTO.hora,
      novoTipoAtendimento: "psicologia",
      usuarioId: 2,
    },
    {
      criarEvento: async (args) => (chamadas.push(["criarEvento", args]), { id: "evt-novo" }),
      salvarNoBanco: async (args) => ({ id: 5, ...args }),
      cancelarEvento: async () => {},
    }
  );

  assert.equal(chamadas[0][1].tipoAtendimento, "psicologia");
});

test("editarConsulta: falha ao gravar no banco reverte o evento novo", async () => {
  let eventoRevertido = null;
  await assert.rejects(
    () =>
      editarConsulta(
        {
          agendamento: AGENDAMENTO,
          novoPacienteId: AGENDAMENTO.paciente_id,
          novoNomePaciente: AGENDAMENTO.paciente_nome,
          novoTelefone: AGENDAMENTO.paciente_telefone,
          novoConvenio: AGENDAMENTO.paciente_convenio,
          novaData: "2026-09-15",
          novaHora: "09:00",
          novoTipoAtendimento: AGENDAMENTO.tipo_atendimento,
          usuarioId: 2,
        },
        {
          criarEvento: async () => ({ id: "evt-novo" }),
          salvarNoBanco: async () => { throw new Error("conexão caiu"); },
          cancelarEvento: async (id) => { eventoRevertido = id; },
        }
      ),
    (err) => err.codigo === "FALHA_AO_GRAVAR"
  );
  assert.equal(eventoRevertido, "evt-novo");
});

const AGENDAMENTO_IMPORTADO = {
  id: 9,
  nome: "Carla",
  telefone: "5511977770000",
  tipo_atendimento: "fisioterapia",
  data: "2026-09-10",
  hora: "08:00",
};

test("editarConsultaImportada: valida disponibilidade e grava nome/telefone/tipo/data/hora novos", async () => {
  const chamadas = [];
  const resultado = await editarConsultaImportada(
    {
      agendamento: AGENDAMENTO_IMPORTADO,
      novoNome: "Carla Souza",
      novoTelefone: "5511977771111",
      novoTipoAtendimento: "psicologia",
      novaData: "2026-09-16",
      novaHora: "10:00",
      usuarioId: 2,
    },
    {
      validarDisponibilidade: async (args) => chamadas.push(["validar", args]),
      salvarNoBanco: async (args) => (chamadas.push(["salvar", args]), { id: 9, ...args }),
    }
  );

  assert.deepEqual(chamadas[0][1], { data: "2026-09-16", hora: "10:00", tipoAtendimento: "psicologia" });
  assert.equal(resultado.nome, "Carla Souza");
});

test("editarConsultaImportada: 0 linhas afetadas (corrida) lança FALHA_AO_GRAVAR", async () => {
  await assert.rejects(
    () =>
      editarConsultaImportada(
        {
          agendamento: AGENDAMENTO_IMPORTADO,
          novoNome: "Carla",
          novoTelefone: AGENDAMENTO_IMPORTADO.telefone,
          novoTipoAtendimento: "fisioterapia",
          novaData: "2026-09-16",
          novaHora: "10:00",
          usuarioId: 2,
        },
        { validarDisponibilidade: async () => {}, salvarNoBanco: async () => null }
      ),
    (err) => err.codigo === "FALHA_AO_GRAVAR"
  );
});
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `node --test test/remarcacaoServiceEditar.test.js`
Expected: FAIL — `editarConsulta`/`editarConsultaImportada` não existem.

- [ ] **Step 3: Implementar**

Adicionar ao final de `src/services/remarcacaoService.js` (atualizar também os imports no topo do arquivo):

```javascript
import {
  criarEventoAgendamento,
  cancelarEventoAgendamento,
  atualizarEventoAgendamento,
} from "./calendarService.js";
import { validarDisponibilidadeAgendamento } from "./calendarService.js";
import {
  remarcarAgendamento as remarcarAgendamentoNoBanco,
  remarcarAgendamentoImportado as remarcarAgendamentoImportadoNoBanco,
  editarAgendamento as editarAgendamentoNoBanco,
  editarAgendamentoImportado as editarAgendamentoImportadoNoBanco,
} from "../models/agendamentoModel.js";
```

```javascript
/**
 * Edição completa (paciente, data, hora, tipo) de um agendamento na tabela
 * agendamentos (bot ou manual). Quando data/hora/tipo não mudam (só o
 * paciente foi trocado), não recria o evento no Calendar — só atualiza o
 * texto (atualizarEventoAgendamento). Caso contrário, mesma sequência segura
 * de remarcarConsulta: cria evento novo -> grava no banco -> cancela o
 * antigo.
 */
export async function editarConsulta(
  {
    agendamento,
    novoPacienteId,
    novoNomePaciente,
    novoTelefone,
    novoConvenio,
    novaData,
    novaHora,
    novoTipoAtendimento,
    usuarioId,
  },
  {
    atualizarEvento = atualizarEventoAgendamento,
    criarEvento = criarEventoAgendamento,
    cancelarEvento = cancelarEventoAgendamento,
    salvarNoBanco = editarAgendamentoNoBanco,
  } = {}
) {
  const soTrocouPaciente =
    novaData === agendamento.data &&
    novaHora === agendamento.hora &&
    novoTipoAtendimento === agendamento.tipo_atendimento;

  if (soTrocouPaciente) {
    if (agendamento.google_event_id) {
      await atualizarEvento(agendamento.google_event_id, {
        nomePaciente: novoNomePaciente,
        tipoAtendimento: novoTipoAtendimento,
        convenio: novoConvenio,
        telefone: novoTelefone,
        primeiraConsulta: agendamento.primeira_consulta,
        queixaPrincipal: agendamento.queixa_principal,
      });
    }
    return salvarNoBanco({
      id: agendamento.id,
      pacienteId: novoPacienteId,
      data: novaData,
      hora: novaHora,
      tipoAtendimento: novoTipoAtendimento,
      googleEventId: agendamento.google_event_id,
      atualizadoPorUsuarioId: usuarioId,
    });
  }

  const novoEvento = await criarEvento({
    nomePaciente: novoNomePaciente,
    data: novaData,
    hora: novaHora,
    tipoAtendimento: novoTipoAtendimento,
    convenio: novoConvenio,
    telefone: novoTelefone,
    primeiraConsulta: agendamento.primeira_consulta,
    queixaPrincipal: agendamento.queixa_principal,
    // Sempre o texto manual aqui, mesmo editando um agendamento que o bot
    // criou originalmente — o evento está sendo recriado por uma ação da
    // recepção no dashboard, não pelo bot.
    origemDescricao: "Agendado manualmente pelo dashboard (Clínica Exemplo Bot).",
  });

  let agendamentoAtualizado;
  try {
    agendamentoAtualizado = await salvarNoBanco({
      id: agendamento.id,
      pacienteId: novoPacienteId,
      data: novaData,
      hora: novaHora,
      tipoAtendimento: novoTipoAtendimento,
      googleEventId: novoEvento.id,
      atualizadoPorUsuarioId: usuarioId,
    });
  } catch (err) {
    capturarErro("[remarcacaoService] Falha ao gravar edição — revertendo evento novo:", err);
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
      capturarErro("[remarcacaoService] Falha ao remover evento antigo após edição bem-sucedida:", err);
    }
  }

  return agendamentoAtualizado;
}

/**
 * Edição completa de um agendamento importado — sem Calendar envolvido
 * (mesmo raciocínio de remarcarConsultaImportada). "Trocar o paciente" aqui
 * é editar nome/telefone direto na linha.
 */
export async function editarConsultaImportada(
  { agendamento, novoNome, novoTelefone, novoTipoAtendimento, novaData, novaHora, usuarioId },
  {
    validarDisponibilidade = validarDisponibilidadeAgendamento,
    salvarNoBanco = editarAgendamentoImportadoNoBanco,
  } = {}
) {
  await validarDisponibilidade({ data: novaData, hora: novaHora, tipoAtendimento: novoTipoAtendimento });

  let agendamentoAtualizado;
  try {
    agendamentoAtualizado = await salvarNoBanco({
      id: agendamento.id,
      nome: novoNome,
      telefone: novoTelefone,
      tipoAtendimento: novoTipoAtendimento,
      data: novaData,
      hora: novaHora,
      atualizadoPorUsuarioId: usuarioId,
    });
  } catch (err) {
    capturarErro("[remarcacaoService] Falha ao gravar edição de importado:", err);
    const erro = new Error("FALHA_AO_GRAVAR");
    erro.codigo = "FALHA_AO_GRAVAR";
    throw erro;
  }

  if (!agendamentoAtualizado) {
    capturarErro(
      "[remarcacaoService] Edição de importado não afetou nenhuma linha (corrida):",
      new Error(`agendamento importado ${agendamento.id} não estava mais confirmado`)
    );
    const erro = new Error("FALHA_AO_GRAVAR");
    erro.codigo = "FALHA_AO_GRAVAR";
    throw erro;
  }

  return agendamentoAtualizado;
}
```

- [ ] **Step 4: Rodar os testes**

Run: `node --test test/remarcacaoServiceEditar.test.js`
Expected: PASS.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/remarcacaoService.js test/remarcacaoServiceEditar.test.js
git commit -m "feat: remarcacaoService ganha editarConsulta e editarConsultaImportada"
```

---

### Task 8: `dashboardController.js` — criar agendamento manual

**Files:**
- Modify: `src/controllers/dashboardController.js`
- Test: `test/dashboardControllerNovoAgendamento.test.js` (novo)

**Interfaces:**
- Consumes: `validarData`, `validarHora` (já importados); `validarTipoAtendimento` de `../utils/validacao.js` (importar); `normalizarTelefoneComDDI` de `../utils/phone.js` (Task 4); `encontrarOuCriarPaciente` de `../models/pacienteModel.js` (importar); `criarEventoAgendamento`, `cancelarEventoAgendamento` de `../services/calendarService.js`; `inserirAgendamento` de `../models/agendamentoModel.js` (importar).
- Produces:
  - `telaNovoAgendamento(req, res)` — `GET /agendamentos/novo`.
  - `processarNovoAgendamento(req, res, deps?)` — `POST /agendamentos/novo`.

- [ ] **Step 1: Escrever os testes**

```javascript
// test/dashboardControllerNovoAgendamento.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { telaNovoAgendamento, processarNovoAgendamento } from "../src/controllers/dashboardController.js";

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

test("telaNovoAgendamento: renderiza o formulário", () => {
  const res = criarRespostaFalsa();
  telaNovoAgendamento({}, res);
  assert.equal(res.viewRenderizada, "agendamentos/novo");
});

const CORPO_VALIDO = {
  data: "2026-09-10",
  hora: "08:00",
  tipo_atendimento: "fisioterapia",
  paciente_id: "20",
};

test("processarNovoAgendamento: dados inválidos (data) respondem 400 sem consultar nada", async () => {
  let consultou = false;
  const res = criarRespostaFalsa();

  await processarNovoAgendamento(
    { body: { ...CORPO_VALIDO, data: "10-09-2026" }, usuarioAtual: { id: 2 } },
    res,
    { encontrarOuCriarPaciente: async () => ((consultou = true), {}) }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(consultou, false);
});

test("processarNovoAgendamento: tipo_atendimento inválido responde 400", async () => {
  const res = criarRespostaFalsa();
  await processarNovoAgendamento(
    { body: { ...CORPO_VALIDO, tipo_atendimento: "nutricao" }, usuarioAtual: { id: 2 } },
    res
  );
  assert.equal(res.statusCode, 400);
});

test("processarNovoAgendamento: sem paciente_id nem dados de paciente novo responde 400", async () => {
  const res = criarRespostaFalsa();
  await processarNovoAgendamento({ body: { ...CORPO_VALIDO, paciente_id: undefined }, usuarioAtual: { id: 2 } }, res);
  assert.equal(res.statusCode, 400);
});

test("processarNovoAgendamento: paciente existente (paciente_id) — cria evento e grava com criado_por_usuario_id", async () => {
  const res = criarRespostaFalsa();
  const chamadas = [];

  await processarNovoAgendamento(
    { body: CORPO_VALIDO, usuarioAtual: { id: 2 } },
    res,
    {
      buscarPacientePorId: async (id) => (chamadas.push(["buscarPaciente", id]), { id: 20, nome: "Ana", telefone: "5511999990000", convenio: "Mar Azul Saúde" }),
      criarEvento: async (args) => (chamadas.push(["criarEvento", args]), { id: "evt-1" }),
      inserirAgendamentoNoBanco: async (args) => (chamadas.push(["inserir", args]), { id: 99 }),
    }
  );

  assert.equal(res.redirectedTo, "/agendamentos");
  assert.deepEqual(chamadas.map((c) => c[0]), ["buscarPaciente", "criarEvento", "inserir"]);
  assert.equal(chamadas[2][1].criadoPorUsuarioId, 2);
  assert.equal(chamadas[2][1].pacienteId, 20);
});

test("processarNovoAgendamento: paciente_id inexistente responde 404", async () => {
  const res = criarRespostaFalsa();
  await processarNovoAgendamento(
    { body: CORPO_VALIDO, usuarioAtual: { id: 2 } },
    res,
    { buscarPacientePorId: async () => null }
  );
  assert.equal(res.statusCode, 404);
});

test("processarNovoAgendamento: paciente novo (sem paciente_id, com nome+telefone) — cadastra e agenda", async () => {
  const res = criarRespostaFalsa();
  const chamadas = [];

  await processarNovoAgendamento(
    {
      body: { ...CORPO_VALIDO, paciente_id: undefined, paciente_novo_nome: "Bruno", paciente_novo_telefone: "11988887777" },
      usuarioAtual: { id: 2 },
    },
    res,
    {
      encontrarOuCriarPaciente: async (args) => (chamadas.push(["encontrarOuCriarPaciente", args]), { id: 30, nome: "Bruno", telefone: "5511988887777" }),
      criarEvento: async () => ({ id: "evt-1" }),
      inserirAgendamentoNoBanco: async (args) => (chamadas.push(["inserir", args]), { id: 99 }),
    }
  );

  assert.equal(res.redirectedTo, "/agendamentos");
  assert.equal(chamadas[0][1].nome, "Bruno");
  assert.equal(chamadas[0][1].telefone, "5511988887777", "telefone normalizado com DDI antes de cadastrar");
});

test("processarNovoAgendamento: telefone de paciente novo inválido responde 400 sem cadastrar", async () => {
  const res = criarRespostaFalsa();
  let cadastrou = false;

  await processarNovoAgendamento(
    {
      body: { ...CORPO_VALIDO, paciente_id: undefined, paciente_novo_nome: "Bruno", paciente_novo_telefone: "123" },
      usuarioAtual: { id: 2 },
    },
    res,
    { encontrarOuCriarPaciente: async () => ((cadastrou = true), {}) }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(cadastrou, false);
});

test("processarNovoAgendamento: horário lotado (erro conhecido) vira mensagem 400", async () => {
  const res = criarRespostaFalsa();

  await processarNovoAgendamento(
    { body: CORPO_VALIDO, usuarioAtual: { id: 2 } },
    res,
    {
      buscarPacientePorId: async () => ({ id: 20, nome: "Ana", telefone: "5511999990000" }),
      criarEvento: async () => {
        const erro = new Error("HORARIO_LOTADO");
        erro.codigo = "HORARIO_LOTADO";
        throw erro;
      },
    }
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.corpo, /lotado/i);
});

test("processarNovoAgendamento: falha ao gravar no banco reverte o evento no Calendar", async () => {
  const res = criarRespostaFalsa();
  let eventoRevertido = null;

  await processarNovoAgendamento(
    { body: CORPO_VALIDO, usuarioAtual: { id: 2 } },
    res,
    {
      buscarPacientePorId: async () => ({ id: 20, nome: "Ana", telefone: "5511999990000" }),
      criarEvento: async () => ({ id: "evt-1" }),
      inserirAgendamentoNoBanco: async () => { throw new Error("conexão caiu"); },
      cancelarEvento: async (id) => { eventoRevertido = id; },
    }
  );

  assert.equal(res.statusCode, 500);
  assert.equal(eventoRevertido, "evt-1");
});
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `node --test test/dashboardControllerNovoAgendamento.test.js`
Expected: FAIL — funções não existem.

- [ ] **Step 3: Implementar**

No topo de `src/controllers/dashboardController.js`, estender os imports existentes:

```javascript
import {
  buscarAgendamentoComPacientePorId,
  buscarAgendamentoImportadoPorId,
  cancelarAgendamentoConfirmado,
  cancelarAgendamentoImportado,
  listarAgendaUnificada,
  inserirAgendamento as inserirAgendamentoNoBancoPadrao,
} from "../models/agendamentoModel.js";
import {
  buscarPacientePorId as buscarPacientePorIdPadrao,
  encontrarOuCriarPaciente as encontrarOuCriarPacientePadrao,
  listarHistoricoPaciente,
  listarPacientes,
  listarSessoesFisioterapiaPaciente,
  buscarPacientesPorNomeOuTelefone,
} from "../models/pacienteModel.js";
import { validarData, validarHora, validarTipoAtendimento } from "../utils/validacao.js";
import { normalizarTelefoneComDDI } from "../utils/phone.js";
import {
  cancelarEventoAgendamento,
  criarEventoAgendamento,
  listarHorariosDisponiveis,
} from "../services/calendarService.js";
```

(`buscarPacientePorId`/`encontrarOuCriarPaciente` já eram importados sem alias em outros pontos do arquivo — renomear os usos existentes de `buscarPacientePorId` em `telaFichaPaciente`/`telaControleSessoes` para `buscarPacientePorIdPadrao` como valor-padrão dos parâmetros dessas duas funções, mantendo o nome do parâmetro `buscarPaciente` como está.)

Adicionar, depois de `processarRemarcarAgendamento` (depois da linha 239):

```javascript
export function telaNovoAgendamento(req, res) {
  res.render("agendamentos/novo", { erro: null });
}

export async function processarNovoAgendamento(
  req,
  res,
  {
    buscarPacientePorId = buscarPacientePorIdPadrao,
    encontrarOuCriarPaciente = encontrarOuCriarPacientePadrao,
    criarEvento = criarEventoAgendamento,
    cancelarEvento = cancelarEventoAgendamento,
    inserirAgendamentoNoBanco = inserirAgendamentoNoBancoPadrao,
  } = {}
) {
  const { data, hora, tipo_atendimento: tipoAtendimento, paciente_id: pacienteIdBruto } = req.body ?? {};

  if (!validarData(data) || !validarHora(hora)) {
    return res.status(400).send("Data ou hora inválida.");
  }
  if (!validarTipoAtendimento(tipoAtendimento)) {
    return res.status(400).send("Tipo de atendimento inválido.");
  }

  let paciente;
  const pacienteId = idSeguro(pacienteIdBruto);
  if (pacienteId) {
    paciente = await buscarPacientePorId(pacienteId);
    if (!paciente) return res.status(404).send("Paciente não encontrado.");
  } else {
    const nomeNovo = req.body?.paciente_novo_nome?.trim();
    const telefoneNovo = normalizarTelefoneComDDI(req.body?.paciente_novo_telefone);
    if (!nomeNovo || !telefoneNovo) {
      return res.status(400).send("Selecione um paciente existente ou informe nome e telefone de um paciente novo.");
    }
    paciente = await encontrarOuCriarPaciente({ nome: nomeNovo, telefone: telefoneNovo, convenio: null });
  }

  let evento;
  try {
    evento = await criarEvento({
      nomePaciente: paciente.nome,
      data,
      hora,
      tipoAtendimento,
      convenio: paciente.convenio,
      telefone: paciente.telefone,
      primeiraConsulta: null,
      queixaPrincipal: null,
      origemDescricao: "Agendado manualmente pelo dashboard (Clínica Exemplo Bot).",
    });
  } catch (err) {
    const mensagem = MENSAGEM_ERRO_REMARCACAO[err.codigo];
    if (mensagem) return res.status(400).send(mensagem);
    throw err;
  }

  try {
    await inserirAgendamentoNoBanco({
      pacienteId: paciente.id,
      data,
      hora,
      tipoAtendimento,
      googleEventId: evento.id,
      criadoPorUsuarioId: req.usuarioAtual.id,
    });
  } catch (err) {
    capturarErro("[dashboardController] Falha ao gravar agendamento manual — revertendo evento:", err);
    try {
      await cancelarEvento(evento.id);
    } catch (errCancelamento) {
      capturarErro("[dashboardController] Falha ao reverter evento no Calendar:", errCancelamento);
    }
    return res.status(500).send("Não foi possível concluir o agendamento por um problema técnico. Tente novamente.");
  }

  res.redirect("/agendamentos");
}

export async function buscarPacientesJson(req, res, { buscarPacientes = buscarPacientesPorNomeOuTelefone } = {}) {
  const termo = typeof req.query.q === "string" ? req.query.q : "";
  const resultados = await buscarPacientes(termo);
  res.json(resultados);
}
```

Note: `MENSAGEM_ERRO_REMARCACAO` já existe no arquivo (linha 163) — reaproveitado como está, sem mudança.

- [ ] **Step 4: Rodar os testes**

Run: `node --test test/dashboardControllerNovoAgendamento.test.js`
Expected: PASS.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/controllers/dashboardController.js test/dashboardControllerNovoAgendamento.test.js
git commit -m "feat: controller de criar agendamento manual e busca de paciente (JSON)"
```

---

### Task 9: `dashboardController.js` — editar agendamento (bot/manual e importado)

**Files:**
- Modify: `src/controllers/dashboardController.js`
- Test: `test/dashboardControllerEditarAgendamento.test.js` (novo)

**Interfaces:**
- Consumes: `editarConsulta`, `editarConsultaImportada` (Task 7) de `../services/remarcacaoService.js`; `origemSegura` (função privada já existente no arquivo); `buscarPacientePorId` (já importado nesta task, alias `buscarPacientePorIdPadrao`).
- Produces:
  - `telaEditarAgendamento(req, res, deps?)` — `GET /agendamentos/:origem/:id/editar`.
  - `processarEditarAgendamento(req, res, deps?)` — `POST /agendamentos/:origem/:id/editar`.

- [ ] **Step 1: Escrever os testes**

```javascript
// test/dashboardControllerEditarAgendamento.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { telaEditarAgendamento, processarEditarAgendamento } from "../src/controllers/dashboardController.js";

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

const AGENDAMENTO = {
  id: 5, status: "confirmado", tipo_atendimento: "fisioterapia",
  data: "2026-09-10", hora: "08:00", paciente_id: 20, paciente_nome: "Ana",
};

test("telaEditarAgendamento: id não numérico responde 404", async () => {
  const res = criarRespostaFalsa();
  await telaEditarAgendamento({ params: { id: "abc" } }, res, { buscarAgendamentoBot: async () => AGENDAMENTO });
  assert.equal(res.statusCode, 404);
});

test("telaEditarAgendamento: origem não reconhecida responde 404 sem consultar nada", async () => {
  let consultou = false;
  const res = criarRespostaFalsa();
  await telaEditarAgendamento({ params: { origem: "Importado", id: "5" } }, res, {
    buscarAgendamentoBot: async () => ((consultou = true), AGENDAMENTO),
  });
  assert.equal(res.statusCode, 404);
  assert.equal(consultou, false);
});

test("telaEditarAgendamento: agendamento já passado responde 404", async () => {
  const res = criarRespostaFalsa();
  await telaEditarAgendamento({ params: { id: "5" } }, res, {
    buscarAgendamentoBot: async () => ({ ...AGENDAMENTO, ja_passou: true }),
  });
  assert.equal(res.statusCode, 404);
});

test("telaEditarAgendamento: caminho feliz renderiza o formulário", async () => {
  const res = criarRespostaFalsa();
  await telaEditarAgendamento({ params: { id: "5" } }, res, { buscarAgendamentoBot: async () => AGENDAMENTO });
  assert.equal(res.viewRenderizada, "agendamentos/editar");
  assert.equal(res.dadosDaView.agendamento.origem, "bot");
});

const CORPO_VALIDO = {
  data: "2026-09-12", hora: "09:00", tipo_atendimento: "fisioterapia", paciente_id: "20",
};

test("processarEditarAgendamento: dados inválidos respondem 400", async () => {
  const res = criarRespostaFalsa();
  await processarEditarAgendamento(
    { params: { id: "5" }, body: { ...CORPO_VALIDO, hora: "25:99" }, usuarioAtual: { id: 2 } },
    res
  );
  assert.equal(res.statusCode, 400);
});

test("processarEditarAgendamento: agendamento não encontrado/já passado responde 404", async () => {
  const res = criarRespostaFalsa();
  await processarEditarAgendamento(
    { params: { id: "5" }, body: CORPO_VALIDO, usuarioAtual: { id: 2 } },
    res,
    { buscarAgendamentoBot: async () => null }
  );
  assert.equal(res.statusCode, 404);
});

test("processarEditarAgendamento: origem bot, paciente existente — chama editarConsulta e redireciona", async () => {
  const res = criarRespostaFalsa();
  const chamadas = [];

  await processarEditarAgendamento(
    { params: { id: "5" }, body: CORPO_VALIDO, usuarioAtual: { id: 2 } },
    res,
    {
      buscarAgendamentoBot: async () => AGENDAMENTO,
      buscarPacientePorId: async (id) => (chamadas.push(["buscarPaciente", id]), { id: 20, nome: "Ana", telefone: "5511999990000", convenio: "Mar Azul Saúde" }),
      executarEdicaoBot: async (args) => (chamadas.push(["editarConsulta", args]), {}),
    }
  );

  assert.equal(res.redirectedTo, "/agendamentos");
  assert.equal(chamadas[1][1].usuarioId, 2);
  assert.equal(chamadas[1][1].novoPacienteId, 20);
});

test("processarEditarAgendamento: origem importado — chama editarConsultaImportada com nome/telefone do corpo", async () => {
  const res = criarRespostaFalsa();
  let chamouBot = false;
  const chamadas = [];

  await processarEditarAgendamento(
    {
      params: { origem: "importado", id: "9" },
      body: { ...CORPO_VALIDO, paciente_id: undefined, paciente_nome: "Carla", paciente_telefone: "11977776666" },
      usuarioAtual: { id: 2 },
    },
    res,
    {
      buscarAgendamentoImportado: async () => ({ ...AGENDAMENTO, id: 9 }),
      executarEdicaoBot: async () => (chamouBot = true),
      executarEdicaoImportado: async (args) => (chamadas.push(args), {}),
    }
  );

  assert.equal(chamouBot, false);
  assert.equal(res.redirectedTo, "/agendamentos");
  assert.equal(chamadas[0].novoNome, "Carla");
  assert.equal(chamadas[0].novoTelefone, "5511977776666");
});

test("processarEditarAgendamento: erro conhecido do serviço vira mensagem 400", async () => {
  const res = criarRespostaFalsa();
  await processarEditarAgendamento(
    { params: { id: "5" }, body: CORPO_VALIDO, usuarioAtual: { id: 2 } },
    res,
    {
      buscarAgendamentoBot: async () => AGENDAMENTO,
      buscarPacientePorId: async () => ({ id: 20, nome: "Ana", telefone: "5511999990000" }),
      executarEdicaoBot: async () => {
        const erro = new Error("HORARIO_LOTADO");
        erro.codigo = "HORARIO_LOTADO";
        throw erro;
      },
    }
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.corpo, /lotado/i);
});
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `node --test test/dashboardControllerEditarAgendamento.test.js`
Expected: FAIL — funções não existem.

- [ ] **Step 3: Implementar**

No topo do arquivo, adicionar ao import já existente de `remarcacaoService.js`:

```javascript
import {
  remarcarConsulta,
  remarcarConsultaImportada,
  editarConsulta,
  editarConsultaImportada,
} from "../services/remarcacaoService.js";
```

Adicionar, depois de `buscarPacientesJson` (Task 8):

```javascript
export async function telaEditarAgendamento(
  req,
  res,
  { buscarAgendamentoBot = buscarAgendamentoComPacientePorId, buscarAgendamentoImportado = buscarAgendamentoImportadoPorId } = {}
) {
  const origem = origemSegura(req.params.origem);
  if (!origem) return res.status(404).send("Agendamento não encontrado.");
  const agendamentoId = idSeguro(req.params.id);
  if (!agendamentoId) return res.status(404).send("Agendamento não encontrado.");

  const buscarAgendamento = origem === "importado" ? buscarAgendamentoImportado : buscarAgendamentoBot;
  const agendamento = await buscarAgendamento(agendamentoId);
  if (!agendamento || agendamento.status !== "confirmado" || agendamento.ja_passou) {
    return res.status(404).send("Agendamento não encontrado ou não pode mais ser editado.");
  }

  res.render("agendamentos/editar", { agendamento: { ...agendamento, origem }, erro: null });
}

export async function processarEditarAgendamento(
  req,
  res,
  {
    buscarAgendamentoBot = buscarAgendamentoComPacientePorId,
    buscarAgendamentoImportado = buscarAgendamentoImportadoPorId,
    buscarPacientePorId = buscarPacientePorIdPadrao,
    executarEdicaoBot = editarConsulta,
    executarEdicaoImportado = editarConsultaImportada,
  } = {}
) {
  const origem = origemSegura(req.params.origem);
  if (!origem) return res.status(404).send("Agendamento não encontrado.");
  const agendamentoId = idSeguro(req.params.id);
  if (!agendamentoId) return res.status(404).send("Agendamento não encontrado.");

  const { data: novaData, hora: novaHora, tipo_atendimento: novoTipoAtendimento } = req.body ?? {};
  if (!validarData(novaData) || !validarHora(novaHora) || !validarTipoAtendimento(novoTipoAtendimento)) {
    return res.status(400).send("Dados inválidos.");
  }

  const buscarAgendamento = origem === "importado" ? buscarAgendamentoImportado : buscarAgendamentoBot;
  const agendamento = await buscarAgendamento(agendamentoId);
  if (!agendamento || agendamento.status !== "confirmado" || agendamento.ja_passou) {
    return res.status(404).send("Agendamento não encontrado ou não pode mais ser editado.");
  }

  try {
    if (origem === "importado") {
      const novoNome = req.body?.paciente_nome?.trim();
      const novoTelefone = normalizarTelefoneComDDI(req.body?.paciente_telefone);
      if (!novoNome || !novoTelefone) {
        return res.status(400).send("Nome ou telefone do paciente inválido.");
      }
      await executarEdicaoImportado({
        agendamento,
        novoNome,
        novoTelefone,
        novoTipoAtendimento,
        novaData,
        novaHora,
        usuarioId: req.usuarioAtual.id,
      });
    } else {
      const pacienteId = idSeguro(req.body?.paciente_id);
      if (!pacienteId) return res.status(400).send("Selecione um paciente.");
      const paciente = await buscarPacientePorId(pacienteId);
      if (!paciente) return res.status(404).send("Paciente não encontrado.");

      await executarEdicaoBot({
        agendamento,
        novoPacienteId: paciente.id,
        novoNomePaciente: paciente.nome,
        novoTelefone: paciente.telefone,
        novoConvenio: paciente.convenio,
        novaData,
        novaHora,
        novoTipoAtendimento,
        usuarioId: req.usuarioAtual.id,
      });
    }
  } catch (err) {
    const mensagem = MENSAGEM_ERRO_REMARCACAO[err.codigo];
    if (mensagem) return res.status(400).send(mensagem);
    throw err;
  }

  res.redirect("/agendamentos");
}
```

- [ ] **Step 4: Rodar os testes**

Run: `node --test test/dashboardControllerEditarAgendamento.test.js`
Expected: PASS.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/controllers/dashboardController.js test/dashboardControllerEditarAgendamento.test.js
git commit -m "feat: controller de editar agendamento (bot/manual e importado)"
```

---

### Task 10: Rotas novas

**Files:**
- Modify: `src/routes/dashboardRoutes.js`

**Interfaces:**
- Consumes: `telaNovoAgendamento`, `processarNovoAgendamento`, `telaEditarAgendamento`, `processarEditarAgendamento`, `buscarPacientesJson` (Tasks 8-9) de `../controllers/dashboardController.js`.

- [ ] **Step 1: Atualizar o import de `dashboardController.js`**

Adicionar ao bloco de import existente (linhas 14-36):

```javascript
  telaNovoAgendamento,
  processarNovoAgendamento,
  telaEditarAgendamento,
  processarEditarAgendamento,
  buscarPacientesJson,
```

- [ ] **Step 2: Adicionar as rotas**

Logo depois do bloco de rotas de remarcar (depois da linha 91, antes de `router.get("/pacientes", ...)`):

```javascript
router.get("/agendamentos/novo", asyncHandler(exigirLogin), telaNovoAgendamento);
router.post(
  "/agendamentos/novo",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarNovoAgendamento)
);
router.get(
  "/agendamentos/:origem/:id/editar",
  asyncHandler(exigirLogin),
  asyncHandler(telaEditarAgendamento)
);
router.post(
  "/agendamentos/:origem/:id/editar",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarEditarAgendamento)
);
router.get("/api/pacientes/busca", asyncHandler(exigirLogin), asyncHandler(buscarPacientesJson));
```

Nota: `/agendamentos/novo` casaria com o padrão de rota `/agendamentos/:origem/:id/remarcar` se estivesse depois dele na ordem de registro do Express — mas como `/agendamentos/novo` tem só um segmento depois de `/agendamentos/`, não colide com `/agendamentos/:origem/:id/...` (três segmentos). Registrar antes por clareza de leitura, não por necessidade.

- [ ] **Step 3: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS (rotas não têm teste próprio — cobertas indiretamente pelos testes de controller).

- [ ] **Step 4: Commit**

```bash
git add src/routes/dashboardRoutes.js
git commit -m "feat: rotas de criar/editar agendamento manual e busca de paciente"
```

---

### Task 11: Views — `novo.ejs`, `editar.ejs`, atualizar `lista.ejs`

**Files:**
- Create: `src/views/agendamentos/novo.ejs`
- Create: `src/views/agendamentos/editar.ejs`
- Modify: `src/views/agendamentos/lista.ejs`

Sem teste automatizado de UI (mesmo padrão do resto do projeto) — verificação manual na Task 12.

- [ ] **Step 1: `lista.ejs` — link "Novo agendamento" e botão "Editar"**

No `page-header` (linhas 3-11), acrescentar o link:

```html
<header class="page-header">
  <div>
    <h1>Agenda</h1>
    <p class="agenda-summary">
      <%= filtros.data ? `Agenda de ${filtros.data}` : "Todos os agendamentos" %>
      · <%= itens.length %> agendamento(s)
    </p>
  </div>
  <a class="button" href="/agendamentos/novo">+ Novo agendamento</a>
</header>
```

No bloco de ações da linha `confirmado`/não passou (linhas 82-89), acrescentar o link de Editar ao lado de Remarcar:

```html
<% if (item.status === "confirmado" && !item.ja_passou) { %>
  <div class="row-actions">
    <a class="button button--quiet" href="/agendamentos/<%= item.origem %>/<%= item.id %>/remarcar">Remarcar</a>
    <a class="button button--quiet" href="/agendamentos/<%= item.origem %>/<%= item.id %>/editar">Editar</a>
    <form method="post" action="/agendamentos/<%= item.origem %>/<%= item.id %>/cancelar" onsubmit="return confirm('Cancelar este agendamento?')">
      <input type="hidden" name="_csrf" value="<%= csrfToken %>" />
      <button class="button is-danger" type="submit">Cancelar</button>
    </form>
  </div>
<% } else if (item.ja_passou && item.status !== "cancelado") { %>
```

- [ ] **Step 2: `novo.ejs`**

```html
<!-- src/views/agendamentos/novo.ejs -->
<%- include("../partials/header", { titulo: "Novo agendamento" }) %>
<header class="page-header">
  <div>
    <h1>Novo agendamento</h1>
    <p>Fisioterapia ou Psicologia — cria evento no Google Calendar, igual ao bot.</p>
  </div>
  <a class="button button--quiet" href="/agendamentos">Voltar</a>
</header>

<% if (typeof erro !== "undefined" && erro) { %>
  <p class="erro"><%= erro %></p>
<% } %>

<form class="panel form-grid" method="post" action="/agendamentos/novo">
  <input type="hidden" name="_csrf" value="<%= csrfToken %>" />

  <label>
    Tipo de atendimento
    <select name="tipo_atendimento" required>
      <option value="fisioterapia">Fisioterapia</option>
      <option value="psicologia">Psicologia</option>
    </select>
  </label>
  <label>
    Data
    <input type="date" name="data" required />
  </label>
  <label>
    Hora
    <input type="time" name="hora" required />
  </label>

  <fieldset class="panel">
    <legend>Paciente</legend>
    <label>
      Buscar paciente existente
      <input type="text" id="busca-paciente" placeholder="Nome ou telefone" autocomplete="off" />
    </label>
    <div id="sugestoes-paciente" class="autocomplete-sugestoes" hidden></div>
    <div id="ficha-paciente-selecionado" class="ficha-preview" hidden></div>
    <input type="hidden" name="paciente_id" id="paciente_id" />

    <p class="ou-divisor">— ou cadastre um paciente novo —</p>
    <label>
      Nome do paciente novo
      <input type="text" name="paciente_novo_nome" id="paciente_novo_nome" />
    </label>
    <label>
      Telefone do paciente novo
      <input type="text" name="paciente_novo_telefone" id="paciente_novo_telefone" placeholder="(11) 98888-7777" />
    </label>
  </fieldset>

  <div class="toolbar">
    <button type="submit">Criar agendamento</button>
  </div>
</form>

<script>
  (function () {
    const busca = document.getElementById("busca-paciente");
    const sugestoes = document.getElementById("sugestoes-paciente");
    const fichaPreview = document.getElementById("ficha-paciente-selecionado");
    const pacienteIdInput = document.getElementById("paciente_id");
    const nomeNovoInput = document.getElementById("paciente_novo_nome");
    const telefoneNovoInput = document.getElementById("paciente_novo_telefone");
    let temporizador = null;

    function limparSelecao() {
      pacienteIdInput.value = "";
      fichaPreview.hidden = true;
      fichaPreview.innerHTML = "";
    }

    busca.addEventListener("input", () => {
      limparSelecao();
      clearTimeout(temporizador);
      const termo = busca.value.trim();
      if (termo.length < 2) {
        sugestoes.hidden = true;
        sugestoes.innerHTML = "";
        return;
      }
      temporizador = setTimeout(async () => {
        const resposta = await fetch("/api/pacientes/busca?q=" + encodeURIComponent(termo));
        const resultados = await resposta.json();
        sugestoes.innerHTML = resultados
          .map(
            (p) =>
              '<button type="button" class="sugestao-item" data-id="' + p.id + '" data-nome="' + p.nome +
              '" data-telefone="' + p.telefone + '" data-convenio="' + (p.convenio || "") +
              '" data-total="' + p.total_consultas + '" data-ultima="' + (p.ultima_consulta || "") + '">' +
              p.nome + " — " + p.telefone + (p.convenio ? " (" + p.convenio + ")" : "") +
              "</button>"
          )
          .join("");
        sugestoes.hidden = resultados.length === 0;
      }, 250);
    });

    sugestoes.addEventListener("click", (evento) => {
      const item = evento.target.closest(".sugestao-item");
      if (!item) return;
      pacienteIdInput.value = item.dataset.id;
      busca.value = item.dataset.nome;
      sugestoes.hidden = true;
      nomeNovoInput.value = "";
      telefoneNovoInput.value = "";
      fichaPreview.hidden = false;
      fichaPreview.innerHTML =
        "<strong>" + item.dataset.nome + "</strong> — " + item.dataset.telefone +
        (item.dataset.convenio ? " · " + item.dataset.convenio : "") +
        "<br>" + item.dataset.total + " consulta(s)" +
        (item.dataset.ultima ? " · última em " + item.dataset.ultima : "");
    });
  })();
</script>

<%- include("../partials/footer") %>
```

- [ ] **Step 3: `editar.ejs`**

```html
<!-- src/views/agendamentos/editar.ejs -->
<%- include("../partials/header", { titulo: "Editar agendamento" }) %>
<header class="page-header">
  <div>
    <h1>Editar agendamento</h1>
    <p><%= agendamento.paciente_nome %> — <%= agendamento.data %> às <%= agendamento.hora %></p>
  </div>
  <a class="button button--quiet" href="/agendamentos">Voltar</a>
</header>

<% if (typeof erro !== "undefined" && erro) { %>
  <p class="erro"><%= erro %></p>
<% } %>

<form class="panel form-grid" method="post" action="/agendamentos/<%= agendamento.origem %>/<%= agendamento.id %>/editar">
  <input type="hidden" name="_csrf" value="<%= csrfToken %>" />

  <label>
    Tipo de atendimento
    <select name="tipo_atendimento" required>
      <option value="fisioterapia" <%= agendamento.tipo_atendimento === "fisioterapia" ? "selected" : "" %>>Fisioterapia</option>
      <option value="psicologia" <%= agendamento.tipo_atendimento === "psicologia" ? "selected" : "" %>>Psicologia</option>
    </select>
  </label>
  <label>
    Data
    <input type="date" name="data" value="<%= agendamento.data %>" required />
  </label>
  <label>
    Hora
    <input type="time" name="hora" value="<%= agendamento.hora %>" required />
  </label>

  <% if (agendamento.origem === "importado") { %>
    <fieldset class="panel">
      <legend>Paciente</legend>
      <label>
        Nome
        <input type="text" name="paciente_nome" value="<%= agendamento.paciente_nome %>" required />
      </label>
      <label>
        Telefone
        <input type="text" name="paciente_telefone" value="<%= agendamento.paciente_telefone %>" required />
      </label>
    </fieldset>
  <% } else { %>
    <fieldset class="panel">
      <legend>Paciente</legend>
      <label>
        Buscar paciente
        <input type="text" id="busca-paciente" value="<%= agendamento.paciente_nome %>" autocomplete="off" />
      </label>
      <div id="sugestoes-paciente" class="autocomplete-sugestoes" hidden></div>
      <input type="hidden" name="paciente_id" id="paciente_id" value="<%= agendamento.paciente_id %>" />
    </fieldset>
  <% } %>

  <div class="toolbar">
    <button type="submit">Salvar alterações</button>
  </div>
</form>

<% if (agendamento.origem !== "importado") { %>
<script>
  (function () {
    const busca = document.getElementById("busca-paciente");
    const sugestoes = document.getElementById("sugestoes-paciente");
    const pacienteIdInput = document.getElementById("paciente_id");
    let temporizador = null;

    busca.addEventListener("input", () => {
      pacienteIdInput.value = "";
      clearTimeout(temporizador);
      const termo = busca.value.trim();
      if (termo.length < 2) {
        sugestoes.hidden = true;
        sugestoes.innerHTML = "";
        return;
      }
      temporizador = setTimeout(async () => {
        const resposta = await fetch("/api/pacientes/busca?q=" + encodeURIComponent(termo));
        const resultados = await resposta.json();
        sugestoes.innerHTML = resultados
          .map(
            (p) =>
              '<button type="button" class="sugestao-item" data-id="' + p.id + '" data-nome="' + p.nome + '">' +
              p.nome + " — " + p.telefone +
              "</button>"
          )
          .join("");
        sugestoes.hidden = resultados.length === 0;
      }, 250);
    });

    sugestoes.addEventListener("click", (evento) => {
      const item = evento.target.closest(".sugestao-item");
      if (!item) return;
      pacienteIdInput.value = item.dataset.id;
      busca.value = item.dataset.nome;
      sugestoes.hidden = true;
    });
  })();
</script>
<% } %>

<%- include("../partials/footer") %>
```

- [ ] **Step 4: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS (views não têm teste automatizado — confirma só que nada de JS/model quebrou).

- [ ] **Step 5: Commit**

```bash
git add src/views/agendamentos/lista.ejs src/views/agendamentos/novo.ejs src/views/agendamentos/editar.ejs
git commit -m "feat: telas de criar/editar agendamento manual, com autocomplete de paciente"
```

---

### Task 12: Verificação manual (dev, não produção)

**Files:** nenhum (só verificação).

- [ ] **Step 1: Rodar a migration 021 no banco de dev**

Mesmo processo usado pra migration 020 nesta sessão: rodar o SQL de `021_agendamento_manual_rastreabilidade.sql` contra o banco de dev (confirmar antes que é dev, não produção).

- [ ] **Step 2: Subir o servidor local**

Run: `node server.js` (com `LEMBRETE_CONSULTA_ATIVADO=false` no `.env` local, como já está desde a sessão de hoje).

- [ ] **Step 3: Exercitar os fluxos pelo navegador**

- Criar agendamento de Fisioterapia com paciente existente (buscar, ver preview da ficha, escolher).
- Criar agendamento de Psicologia com paciente novo (nome + telefone).
- Tentar criar um segundo agendamento de Psicologia no mesmo horário do anterior — confirmar que é bloqueado (capacidade 1).
- Editar um agendamento (trocar só o paciente) — confirmar no log/console que não recria evento (ou verificar no Calendar que o evento manteve o mesmo horário/id, só o título mudou).
- Editar um agendamento trocando data/hora — confirmar que o evento antigo some do Calendar e um novo aparece.
- Editar um agendamento importado (nome/telefone/tipo/data/hora).

- [ ] **Step 4: Rodar a suíte inteira uma última vez**

Run: `npm test`
Expected: PASS — todos os testes (458 originais + os novos desta feature).

- [ ] **Step 5: Derrubar o servidor local**

```bash
# encontrar e encerrar o processo node server.js iniciado no Step 2
```

---

## Self-Review

**Cobertura da spec:** criação (Fisio+Psico, Calendar, busca+preview de paciente, cadastro inline) — Tasks 5, 8, 11. Edição universal (bot/manual e importado, paciente/tipo/data/hora) — Tasks 6, 7, 9, 11. Capacidade de Psicologia=1 — Task 2 (que também corrige o bug de horário de funcionamento descoberto durante o planejamento, não previsto na spec original mas necessário pra Psicologia funcionar corretamente). Rastreabilidade — Tasks 1, 6. Config — Task 2. Rotas — Task 10. Não mudar comportamento do bot — todo parâmetro novo em função existente (`inserirAgendamento`, `criarEventoAgendamento`) tem valor padrão que preserva o comportamento atual, verificado em cada task via `npm test` completo.

**Desvio da spec:** a spec descrevia "generaliza `remarcarConsulta`" — o plano optou por funções novas (`editarConsulta`/`editarConsultaImportada`) em vez de mudar a assinatura de `remarcarConsulta`, pra não arriscar os 8 testes existentes que dependem da assinatura atual. Mesmo resultado funcional, risco menor.
