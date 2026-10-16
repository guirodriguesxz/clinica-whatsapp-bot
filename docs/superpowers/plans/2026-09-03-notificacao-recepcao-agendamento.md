# Notificação de Agendamento para Recepção (com Foto de Encaminhamento) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando o bot cria um agendamento, notificar a recepção no WhatsApp interno — numa mensagem só, com a foto de encaminhamento médico anexada se o paciente mandou uma pouco antes — sem nunca perder a foto, mesmo se o paciente não chegar a agendar.

**Architecture:** Uma foto de encaminhamento recebida passa a ser gravada como "pendente" (banco) em vez de repassada na hora. Três consumidores dessa pendência: (1) criação de agendamento — junta foto+dados numa mensagem; (2) encaminhamento para atendimento humano — repassa a foto sozinha na hora; (3) job periódico (cron, 15 min) — repassa sozinha qualquer pendência esquecida, garantindo que nada se perde.

**Tech Stack:** Node.js, Express, Postgres (Neon) via `pg`, Evolution API (WhatsApp) via axios, `node-cron`, `node --test` para testes.

**Spec:** `docs/superpowers/specs/2026-09-03-notificacao-recepcao-agendamento-design.md`

## Global Constraints

- Falha ao gravar a foto como pendente (erro de banco) cai pro repasse imediato de hoje (best-effort) — nunca perde o documento.
- Falha ao enviar a notificação de agendamento (com ou sem foto) nunca bloqueia a confirmação ao paciente — a função de notificação nunca lança exceção.
- Se havia foto pendente e o envio falhar, a pendência **não é apagada** — só é apagada depois de um envio bem-sucedido.
- Escopo só na **criação** de agendamento — remarcar/cancelar não ganham essa notificação.
- Migration 022 é um arquivo local, aplicada manualmente pelo usuário (Neon SQL Editor) — nunca rodar contra produção sem autorização explícita.
- `ON CONFLICT (paciente_id) DO UPDATE` da tabela de pendências reseta `criado_em` para o momento da foto nova (senão herdaria o relógio da pendência antiga e expiraria cedo demais).
- Rodar `npm test` depois de cada tarefa antes de commitar — todos os testes existentes continuam passando.

---

## File Structure

```
src/
├── db/migrations/
│   └── 022_encaminhamentos_pendentes.sql        # nova
├── services/
│   └── encaminhamentoMedicoService.js           # +buscarFotoPendente,
│                                                 #   +apagarFotoPendente,
│                                                 #   +enviarFotoAvulsaParaRecepcao,
│                                                 #   +buscarFotosPendentesExpiradas,
│                                                 #   +enviarFotosPendentesExpiradas,
│                                                 #   +registrarFotoPendente,
│                                                 #   +processarFotoEncaminhamento;
│                                                 #   -encaminharFotoEncaminhamento (removida)
├── functions/
│   ├── criarAgendamento.js                      # +notificarRecepcaoDoAgendamento,
│                                                 #   handler chama após inserir
│   └── encaminharHumano.js                      # handler passa a repassar foto
│                                                 #   pendente, se houver
└── controllers/
    └── webhookController.js                     # bloco da foto passa a chamar
                                                   #   processarFotoEncaminhamento
server.js                                         # +cron de expiração (15 min)
test/
├── migrations.test.js                            # +migration 022
├── encaminhamentoMedicoService.test.js           # nova
├── criarAgendamentoNotificacaoRecepcao.test.js   # nova
└── encaminharHumano.test.js                      # +casos de foto pendente
```

---

### Task 1: Configurar worktree dedicado

Nenhum código ainda — só isolamento do ambiente de trabalho, seguindo a convenção do repo (branch dedicada + worktree, mesmo padrão da feature de agendamento manual que acabou de ir pra produção).

- [ ] **Step 1: Invocar a skill `superpowers:using-git-worktrees`**

Peça pra criar um worktree novo a partir de `main` (HEAD atual do repo), branch com nome relacionado a esta feature (ex: `notificacao-recepcao-agendamento`), em `.worktrees/<nome>` (ou via a ferramenta nativa de worktree disponível no ambiente, se houver — ver a skill).

- [ ] **Step 2: Instalar dependências no worktree novo**

Run: `npm install` (dentro do worktree)

- [ ] **Step 3: Confirmar baseline verde**

Run: `npm test`
Expected: todos os testes existentes passando (508 no momento em que este plano foi escrito), 0 falhas.

---

### Task 2: Migration 022 — tabela de fotos de encaminhamento pendentes

**Files:**
- Create: `src/db/migrations/022_encaminhamentos_pendentes.sql`
- Test: `test/migrations.test.js`

**Interfaces:**
- Produces: tabela `encaminhamentos_pendentes` (`paciente_id` INTEGER PRIMARY KEY REFERENCES pacientes(id), `base64` TEXT NOT NULL, `mimetype` TEXT, `legenda_paciente` TEXT, `criado_em` TIMESTAMPTZ NOT NULL DEFAULT now()).

- [ ] **Step 1: Escrever a migration**

```sql
-- src/db/migrations/022_encaminhamentos_pendentes.sql
-- Clínica Exemplo Bot — migration 022: fotos de encaminhamento médico pendentes
--
-- Guarda a foto de encaminhamento médico que o paciente manda pelo
-- WhatsApp, para juntar numa mensagem só com a notificação de agendamento
-- pra recepção (ver
-- docs/superpowers/specs/2026-09-03-notificacao-recepcao-agendamento-design.md).
-- No máximo uma foto pendente por paciente — uma foto nova substitui a
-- anterior. A linha é apagada assim que a foto é enviada (junto com um
-- agendamento, junto com um encaminhamento humano, ou sozinha pelo job de
-- expiração em server.js) — esta tabela nunca é histórico, só fila.

CREATE TABLE IF NOT EXISTS encaminhamentos_pendentes (
  paciente_id INTEGER PRIMARY KEY REFERENCES pacientes(id),
  base64 TEXT NOT NULL,
  mimetype TEXT,
  legenda_paciente TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Escrever o teste da migration (mesmo padrão das migrations 020/021 já existentes)**

Adicionar ao final de `test/migrations.test.js`:

```javascript
const MIGRATION_022 = path.join(ROOT, "src/db/migrations/022_encaminhamentos_pendentes.sql");

test("migration 022: cria encaminhamentos_pendentes com paciente_id como chave e referência a pacientes", async () => {
  const sql = await readFile(MIGRATION_022, "utf8");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS encaminhamentos_pendentes/);
  assert.match(sql, /paciente_id INTEGER PRIMARY KEY REFERENCES pacientes\(id\)/);
  assert.match(sql, /base64 TEXT NOT NULL/);
  assert.match(sql, /criado_em TIMESTAMPTZ NOT NULL DEFAULT now\(\)/);
});
```

- [ ] **Step 3: Rodar o teste**

Run: `node --test test/migrations.test.js`
Expected: PASS (4 testes: migrations 020, 021 já existentes + 022 nova).

- [ ] **Step 4: Commit**

```bash
git add src/db/migrations/022_encaminhamentos_pendentes.sql test/migrations.test.js
git commit -m "feat: migration 022 — fotos de encaminhamento médico pendentes"
```

---

### Task 3: `encaminhamentoMedicoService.js` — armazenamento de pendências e envio avulso

**Files:**
- Modify: `src/services/encaminhamentoMedicoService.js`
- Test: `test/encaminhamentoMedicoService.test.js` (novo)

**Interfaces:**
- Consumes: `pool` de `../db/pool.js` (importar); `evolutionApi`, `evolutionInstance` de `../config/evolutionApi.js` (já importados); `enviarImagem` de `./whatsappService.js` (já importado); `capturarErro`, `capturarAviso` de `../config/sentry.js` (já importados).
- Produces:
  - `buscarFotoPendente(pacienteId) => Promise<{paciente_id, base64, mimetype, legenda_paciente, criado_em, nome, telefone} | null>`
  - `apagarFotoPendente(pacienteId) => Promise<void>`
  - `enviarFotoAvulsaParaRecepcao({ nomePaciente, telefone, base64, mimetype, legendaPaciente }) => Promise<boolean>`
  - `buscarFotosPendentesExpiradas() => Promise<Array<{paciente_id, base64, mimetype, legenda_paciente, criado_em, nome, telefone}>>`
  - `enviarFotosPendentesExpiradas() => Promise<void>`

Este task **não remove** a função `encaminharFotoEncaminhamento` existente — ela fica temporariamente não usada por mais um task (removida no Task 5, quando `webhookController.js` para de chamá-la). Ignore a duplicação transitória entre ela e a nova `enviarFotoAvulsaParaRecepcao`.

- [ ] **Step 1: Escrever os testes**

```javascript
// test/encaminhamentoMedicoService.test.js
import "./setupEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { evolutionApi } from "../src/config/evolutionApi.js";
import {
  buscarFotoPendente,
  apagarFotoPendente,
  enviarFotoAvulsaParaRecepcao,
  buscarFotosPendentesExpiradas,
  enviarFotosPendentesExpiradas,
} from "../src/services/encaminhamentoMedicoService.js";

test("buscarFotoPendente: retorna null quando não há pendência", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const resultado = await buscarFotoPendente(1);
  assert.equal(resultado, null);
});

test("buscarFotoPendente: retorna a foto com nome/telefone do paciente (JOIN)", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        paciente_id: 1,
        base64: "abc",
        mimetype: "image/jpeg",
        legenda_paciente: null,
        nome: "Ana",
        telefone: "5511999990000",
      },
    ],
  }));
  const resultado = await buscarFotoPendente(1);
  assert.equal(resultado.nome, "Ana");
  assert.equal(resultado.base64, "abc");
});

test("apagarFotoPendente: executa DELETE filtrando por paciente_id", async (t) => {
  let sqlCapturado = null;
  let paramsCapturados = null;
  t.mock.method(pool, "query", async (sql, params) => {
    sqlCapturado = sql;
    paramsCapturados = params;
    return { rows: [] };
  });

  await apagarFotoPendente(7);

  assert.match(sqlCapturado, /DELETE FROM encaminhamentos_pendentes/);
  assert.deepEqual(paramsCapturados, [7]);
});

test("enviarFotoAvulsaParaRecepcao: envia a imagem com a legenda esperada e retorna true", async (t) => {
  let requestBodyCapturado = null;
  t.mock.method(evolutionApi, "post", async (url, body) => {
    requestBodyCapturado = body;
    return { data: { key: { id: "wamid-1" } } };
  });

  const resultado = await enviarFotoAvulsaParaRecepcao({
    nomePaciente: "Ana",
    telefone: "5511999990000",
    base64: "base64-fake",
    mimetype: "image/jpeg",
    legendaPaciente: "encaminhamento fisio",
  });

  assert.equal(resultado, true);
  assert.match(requestBodyCapturado.caption, /Encaminhamento médico para validação/);
  assert.match(requestBodyCapturado.caption, /Ana/);
  assert.match(requestBodyCapturado.caption, /Legenda do paciente: "encaminhamento fisio"/);
});

test("enviarFotoAvulsaParaRecepcao: falha no envio retorna false sem lançar exceção", async (t) => {
  t.mock.method(evolutionApi, "post", async () => {
    throw new Error("connect ECONNREFUSED");
  });

  const resultado = await enviarFotoAvulsaParaRecepcao({
    nomePaciente: "Ana",
    telefone: "5511999990000",
    base64: "base64-fake",
    mimetype: "image/jpeg",
  });

  assert.equal(resultado, false);
});

test("buscarFotosPendentesExpiradas: consulta filtra por criado_em mais antigo que 15 minutos", async (t) => {
  let sqlCapturado = null;
  t.mock.method(pool, "query", async (sql) => {
    sqlCapturado = sql;
    return { rows: [] };
  });

  await buscarFotosPendentesExpiradas();

  assert.match(sqlCapturado, /criado_em < now\(\) - interval '15 minutes'/);
});

test("enviarFotosPendentesExpiradas: envia e apaga cada pendência expirada", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql) => {
    if (/SELECT ep.paciente_id/.test(sql)) {
      return {
        rows: [
          {
            paciente_id: 1,
            base64: "a",
            mimetype: "image/jpeg",
            legenda_paciente: null,
            nome: "Ana",
            telefone: "5511999990000",
          },
        ],
      };
    }
    if (/DELETE FROM encaminhamentos_pendentes/.test(sql)) {
      chamadas.push("apagou");
      return { rows: [] };
    }
    throw new Error("SQL inesperado: " + sql);
  });
  t.mock.method(evolutionApi, "post", async () => (chamadas.push("enviou"), { data: {} }));

  await enviarFotosPendentesExpiradas();

  assert.deepEqual(chamadas, ["enviou", "apagou"]);
});

test("enviarFotosPendentesExpiradas: não apaga a pendência se o envio falhar", async (t) => {
  let apagou = false;
  t.mock.method(pool, "query", async (sql) => {
    if (/SELECT ep.paciente_id/.test(sql)) {
      return {
        rows: [
          {
            paciente_id: 1,
            base64: "a",
            mimetype: "image/jpeg",
            legenda_paciente: null,
            nome: "Ana",
            telefone: "5511999990000",
          },
        ],
      };
    }
    if (/DELETE FROM encaminhamentos_pendentes/.test(sql)) {
      apagou = true;
      return { rows: [] };
    }
    throw new Error("SQL inesperado: " + sql);
  });
  t.mock.method(evolutionApi, "post", async () => {
    throw new Error("Evolution API fora do ar");
  });

  await enviarFotosPendentesExpiradas();

  assert.equal(apagou, false);
});

test("enviarFotosPendentesExpiradas: erro numa pendência não impede as demais de serem processadas", async (t) => {
  let chamadasEnvio = 0;
  t.mock.method(pool, "query", async (sql) => {
    if (/SELECT ep.paciente_id/.test(sql)) {
      return {
        rows: [
          {
            paciente_id: 1,
            base64: "a",
            mimetype: "image/jpeg",
            legenda_paciente: null,
            nome: "Ana",
            telefone: "5511999990000",
          },
          {
            paciente_id: 2,
            base64: "b",
            mimetype: "image/jpeg",
            legenda_paciente: null,
            nome: "Bruno",
            telefone: "5511988880000",
          },
        ],
      };
    }
    if (/DELETE FROM encaminhamentos_pendentes/.test(sql)) {
      return { rows: [] };
    }
    throw new Error("SQL inesperado: " + sql);
  });
  t.mock.method(evolutionApi, "post", async () => {
    chamadasEnvio++;
    if (chamadasEnvio === 1) throw new Error("falha na primeira");
    return { data: {} };
  });

  await enviarFotosPendentesExpiradas();

  assert.equal(chamadasEnvio, 2, "deve tentar enviar as duas pendências mesmo a primeira falhando");
});
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `node --test test/encaminhamentoMedicoService.test.js`
Expected: FAIL — nenhuma das funções novas existe ainda.

- [ ] **Step 3: Implementar**

Adicionar `import { pool } from "../db/pool.js";` ao topo de `src/services/encaminhamentoMedicoService.js` (junto aos imports existentes). Adicionar ao final do arquivo, mantendo `encaminharFotoEncaminhamento` intacta acima:

```javascript
/**
 * Busca a foto de encaminhamento pendente do paciente (se houver), já com
 * nome/telefone do cadastro — usado pela notificação de agendamento
 * (criarAgendamento.js) e pelo encaminhamento humano (encaminharHumano.js)
 * pra decidir se anexam a foto na notificação. Não apaga a pendência — só
 * quem consome com sucesso (enviou a mensagem) deve chamar
 * apagarFotoPendente.
 */
export async function buscarFotoPendente(pacienteId) {
  const { rows } = await pool.query(
    `SELECT ep.paciente_id, ep.base64, ep.mimetype, ep.legenda_paciente, ep.criado_em,
            p.nome, p.telefone
     FROM encaminhamentos_pendentes ep
     JOIN pacientes p ON p.id = ep.paciente_id
     WHERE ep.paciente_id = $1`,
    [pacienteId]
  );
  return rows[0] ?? null;
}

export async function apagarFotoPendente(pacienteId) {
  await pool.query(`DELETE FROM encaminhamentos_pendentes WHERE paciente_id = $1`, [pacienteId]);
}

/**
 * Envia uma foto de encaminhamento pendente sozinha para a recepção, no
 * mesmo formato usado hoje quando não há agendamento pra juntar — usado
 * tanto quando a gravação da pendência falha (fallback imediato) quanto
 * pelo job de expiração (enviarFotosPendentesExpiradas).
 */
export async function enviarFotoAvulsaParaRecepcao({ nomePaciente, telefone, base64, mimetype, legendaPaciente }) {
  if (!TELEFONE_ATENDENTE) {
    capturarAviso(
      "[encaminhamentoMedico] ATENDENTE_HUMANO_TELEFONE não configurado — foto não encaminhada."
    );
    return false;
  }

  const legenda = legendaPaciente ? `\nLegenda do paciente: "${legendaPaciente}"` : "";
  try {
    await enviarImagem(TELEFONE_ATENDENTE, {
      base64,
      mimetype,
      caption: `Encaminhamento médico para validação.\nPaciente: *${nomePaciente ?? "desconhecido"}* (${telefone})${legenda}`,
    });
    return true;
  } catch (err) {
    capturarErro("[encaminhamentoMedico] Falha ao encaminhar foto para a equipe:", err);
    return false;
  }
}

/**
 * Fotos pendentes há mais de 15 minutos sem terem sido consumidas por um
 * agendamento nem por um encaminhamento humano — candidatas ao envio
 * avulso do job de expiração.
 */
export async function buscarFotosPendentesExpiradas() {
  const { rows } = await pool.query(
    `SELECT ep.paciente_id, ep.base64, ep.mimetype, ep.legenda_paciente, ep.criado_em,
            p.nome, p.telefone
     FROM encaminhamentos_pendentes ep
     JOIN pacientes p ON p.id = ep.paciente_id
     WHERE ep.criado_em < now() - interval '15 minutes'`
  );
  return rows;
}

/**
 * Job periódico (chamado pelo cron em server.js a cada 15 min): garante
 * que nenhuma foto de encaminhamento se perde quando o paciente manda a
 * foto mas não chega a agendar nem é encaminhado para atendimento humano.
 * Uma falha isolada numa foto não impede as demais de serem processadas.
 */
export async function enviarFotosPendentesExpiradas() {
  const pendentes = await buscarFotosPendentesExpiradas();
  for (const pendente of pendentes) {
    try {
      const enviado = await enviarFotoAvulsaParaRecepcao({
        nomePaciente: pendente.nome,
        telefone: pendente.telefone,
        base64: pendente.base64,
        mimetype: pendente.mimetype,
        legendaPaciente: pendente.legenda_paciente,
      });
      if (enviado) {
        await apagarFotoPendente(pendente.paciente_id);
      }
    } catch (err) {
      capturarErro("[encaminhamentoMedico] Falha ao processar foto pendente expirada:", err);
    }
  }
}
```

- [ ] **Step 4: Rodar os testes**

Run: `node --test test/encaminhamentoMedicoService.test.js`
Expected: PASS em todos.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS — nada mais no projeto usa essas funções ainda.

- [ ] **Step 6: Commit**

```bash
git add src/services/encaminhamentoMedicoService.js test/encaminhamentoMedicoService.test.js
git commit -m "feat: encaminhamentoMedicoService ganha armazenamento de fotos pendentes e envio avulso"
```

---

### Task 4: `encaminhamentoMedicoService.js` — registrar pendência e orquestrar o recebimento

**Files:**
- Modify: `src/services/encaminhamentoMedicoService.js`
- Test: `test/encaminhamentoMedicoService.test.js`

**Interfaces:**
- Consumes: `enviarFotoAvulsaParaRecepcao` (Task 3, mesmo arquivo).
- Produces:
  - `registrarFotoPendente({ pacienteId, base64, mimetype, legendaPaciente }) => Promise<void>`
  - `processarFotoEncaminhamento({ messageKey, imageMessage, pacienteId, nomePaciente, telefone }) => Promise<"pendente"|"encaminhado"|"falhou">`

- [ ] **Step 1: Escrever os testes**

Adicionar ao import existente em `test/encaminhamentoMedicoService.test.js`:

```javascript
import {
  buscarFotoPendente,
  apagarFotoPendente,
  enviarFotoAvulsaParaRecepcao,
  buscarFotosPendentesExpiradas,
  enviarFotosPendentesExpiradas,
  registrarFotoPendente,
  processarFotoEncaminhamento,
} from "../src/services/encaminhamentoMedicoService.js";
```

Adicionar ao final do arquivo:

```javascript
test("registrarFotoPendente: grava a pendência com paciente_id, base64, mimetype e legenda (upsert)", async (t) => {
  let sqlCapturado = null;
  let paramsCapturados = null;
  t.mock.method(pool, "query", async (sql, params) => {
    sqlCapturado = sql;
    paramsCapturados = params;
    return { rows: [] };
  });

  await registrarFotoPendente({ pacienteId: 5, base64: "abc", mimetype: "image/jpeg", legendaPaciente: "urgente" });

  assert.match(sqlCapturado, /INSERT INTO encaminhamentos_pendentes/);
  assert.match(sqlCapturado, /ON CONFLICT \(paciente_id\) DO UPDATE/);
  assert.deepEqual(paramsCapturados, [5, "abc", "image/jpeg", "urgente"]);
});

test("processarFotoEncaminhamento: baixa e grava como pendente — retorna 'pendente'", async (t) => {
  t.mock.method(evolutionApi, "post", async () => ({ data: { base64: "foto-base64" } }));
  let inseriu = false;
  t.mock.method(pool, "query", async (sql) => {
    if (/INSERT INTO encaminhamentos_pendentes/.test(sql)) {
      inseriu = true;
      return { rows: [] };
    }
    throw new Error("SQL inesperado: " + sql);
  });

  const resultado = await processarFotoEncaminhamento({
    messageKey: { id: "wamid-1" },
    imageMessage: { mimetype: "image/jpeg", caption: null },
    pacienteId: 5,
    nomePaciente: "Ana",
    telefone: "5511999990000",
  });

  assert.equal(resultado, "pendente");
  assert.equal(inseriu, true);
});

test("processarFotoEncaminhamento: falha ao baixar a foto — retorna 'falhou' sem tentar gravar", async (t) => {
  let consultouBanco = false;
  t.mock.method(evolutionApi, "post", async () => {
    throw new Error("Evolution API fora do ar");
  });
  t.mock.method(pool, "query", async () => ((consultouBanco = true), { rows: [] }));

  const resultado = await processarFotoEncaminhamento({
    messageKey: { id: "wamid-1" },
    imageMessage: { mimetype: "image/jpeg" },
    pacienteId: 5,
    nomePaciente: "Ana",
    telefone: "5511999990000",
  });

  assert.equal(resultado, "falhou");
  assert.equal(consultouBanco, false);
});

test("processarFotoEncaminhamento: falha ao gravar pendência — cai para repasse imediato bem-sucedido, retorna 'encaminhado'", async (t) => {
  let chamadasEvolution = 0;
  t.mock.method(evolutionApi, "post", async (url) => {
    chamadasEvolution++;
    if (url.includes("getBase64FromMediaMessage")) {
      return { data: { base64: "foto-base64" } };
    }
    return { data: {} };
  });
  t.mock.method(pool, "query", async () => {
    throw new Error("conexão com o banco caiu");
  });

  const resultado = await processarFotoEncaminhamento({
    messageKey: { id: "wamid-1" },
    imageMessage: { mimetype: "image/jpeg" },
    pacienteId: 5,
    nomePaciente: "Ana",
    telefone: "5511999990000",
  });

  assert.equal(resultado, "encaminhado");
  assert.equal(chamadasEvolution, 2, "deve baixar a foto e depois tentar o repasse imediato");
});

test("processarFotoEncaminhamento: falha ao gravar pendência E falha o repasse imediato — retorna 'falhou'", async (t) => {
  t.mock.method(evolutionApi, "post", async (url) => {
    if (url.includes("getBase64FromMediaMessage")) {
      return { data: { base64: "foto-base64" } };
    }
    throw new Error("Evolution API fora do ar");
  });
  t.mock.method(pool, "query", async () => {
    throw new Error("conexão com o banco caiu");
  });

  const resultado = await processarFotoEncaminhamento({
    messageKey: { id: "wamid-1" },
    imageMessage: { mimetype: "image/jpeg" },
    pacienteId: 5,
    nomePaciente: "Ana",
    telefone: "5511999990000",
  });

  assert.equal(resultado, "falhou");
});
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `node --test test/encaminhamentoMedicoService.test.js`
Expected: FAIL nos 5 testes novos — `registrarFotoPendente`/`processarFotoEncaminhamento` não existem.

- [ ] **Step 3: Implementar**

Adicionar ao final de `src/services/encaminhamentoMedicoService.js` (depois de `enviarFotosPendentesExpiradas`):

```javascript
async function baixarFotoEncaminhamento({ messageKey, imageMessage }) {
  const { data } = await evolutionApi.post(`/chat/getBase64FromMediaMessage/${evolutionInstance}`, {
    message: { key: messageKey },
  });

  const base64 = data?.base64;
  if (!base64) {
    throw new Error("Evolution API não retornou base64 da imagem.");
  }

  return {
    base64,
    mimetype: imageMessage?.mimetype,
    legendaPaciente: imageMessage?.caption ?? null,
  };
}

/**
 * Grava (ou substitui) a foto de encaminhamento pendente do paciente — no
 * máximo uma por paciente; uma foto nova substitui qualquer pendência
 * anterior, inclusive resetando criado_em (senão a foto nova herdaria o
 * relógio da antiga e poderia expirar cedo demais no job periódico).
 */
export async function registrarFotoPendente({ pacienteId, base64, mimetype, legendaPaciente }) {
  await pool.query(
    `INSERT INTO encaminhamentos_pendentes (paciente_id, base64, mimetype, legenda_paciente, criado_em)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (paciente_id) DO UPDATE
     SET base64 = EXCLUDED.base64, mimetype = EXCLUDED.mimetype,
         legenda_paciente = EXCLUDED.legenda_paciente, criado_em = now()`,
    [pacienteId, base64, mimetype ?? null, legendaPaciente ?? null]
  );
}

/**
 * Handler do fluxo de recebimento da foto de encaminhamento (chamado por
 * webhookController.js): baixa a foto e tenta gravá-la como pendente, pra
 * juntar depois com a notificação de agendamento (criarAgendamento.js) ou
 * de encaminhamento humano (encaminharHumano.js). Se não conseguir gravar
 * (erro de banco), cai pro repasse imediato de hoje — nunca perde o
 * documento por causa de um problema técnico pontual. Retorna um status
 * pro controller decidir a mensagem certa pro paciente.
 * @returns {Promise<"pendente"|"encaminhado"|"falhou">}
 */
export async function processarFotoEncaminhamento({ messageKey, imageMessage, pacienteId, nomePaciente, telefone }) {
  let foto;
  try {
    foto = await baixarFotoEncaminhamento({ messageKey, imageMessage });
  } catch (err) {
    capturarErro("[encaminhamentoMedico] Falha ao baixar a foto de encaminhamento:", err);
    return "falhou";
  }

  try {
    await registrarFotoPendente({ pacienteId, ...foto });
    return "pendente";
  } catch (err) {
    capturarErro(
      "[encaminhamentoMedico] Falha ao gravar a foto como pendente — tentando repasse imediato:",
      err
    );
    const enviado = await enviarFotoAvulsaParaRecepcao({ nomePaciente, telefone, ...foto });
    return enviado ? "encaminhado" : "falhou";
  }
}
```

- [ ] **Step 4: Rodar os testes**

Run: `node --test test/encaminhamentoMedicoService.test.js`
Expected: PASS em todos (12 testes: 7 do Task 3 + 5 novos).

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/encaminhamentoMedicoService.js test/encaminhamentoMedicoService.test.js
git commit -m "feat: encaminhamentoMedicoService ganha registrarFotoPendente e processarFotoEncaminhamento"
```

---

### Task 5: `webhookController.js` — passa a gravar a foto como pendente

**Files:**
- Modify: `src/controllers/webhookController.js`
- Modify: `src/services/encaminhamentoMedicoService.js` (remove a função antiga, agora morta)

**Interfaces:**
- Consumes: `processarFotoEncaminhamento` (Task 4) de `../services/encaminhamentoMedicoService.js`; `encontrarOuCriarPaciente` (já importado) de `../models/pacienteModel.js`.

Sem teste dedicado — `webhookController.js` não tem arquivo de teste hoje (nenhum teste do projeto o importa, transitiva ou diretamente), e a lógica de decisão que mudou (o que fazer com a foto) já está totalmente coberta pelos testes de `processarFotoEncaminhamento` no Task 4. Este task é fiação fina — a suíte completa e a verificação manual (Task 9) cobrem o resto.

- [ ] **Step 1: Trocar o import**

Em `src/controllers/webhookController.js`, trocar:

```javascript
import { encaminharFotoEncaminhamento } from "../services/encaminhamentoMedicoService.js";
```

por:

```javascript
import { processarFotoEncaminhamento } from "../services/encaminhamentoMedicoService.js";
```

- [ ] **Step 2: Adicionar o mapa de textos**

Perto das outras constantes de mensagem (`MENSAGEM_FALLBACK_ERRO`, etc.), adicionar:

```javascript
const TEXTO_POR_RESULTADO_FOTO_ENCAMINHAMENTO = {
  pendente:
    "[Paciente enviou uma foto do encaminhamento médico. Ela será repassada à equipe junto com o agendamento.]",
  encaminhado:
    "[Paciente enviou uma foto do encaminhamento médico. A equipe da clínica já recebeu e vai validar o documento.]",
  falhou:
    "[Paciente tentou enviar uma foto do encaminhamento médico, mas não foi possível encaminhar para a equipe agora — avise que a validação será confirmada por outro meio.]",
};
```

- [ ] **Step 3: Trocar o bloco de tratamento da imagem**

Substituir (linhas ~139-152):

```javascript
  if (!texto && data.message?.imageMessage) {
    // O bot não tem como validar o documento sozinho — a foto é repassada
    // pro WhatsApp interno da equipe e a conversa segue normalmente, com
    // uma nota sintética no lugar do texto (não há legenda/texto real).
    const encaminhado = await encaminharFotoEncaminhamento({
      messageKey: data.key,
      imageMessage: data.message.imageMessage,
      telefone,
      nomeContato,
    });
    texto = encaminhado
      ? "[Paciente enviou uma foto do encaminhamento médico. A equipe da clínica já recebeu e vai validar o documento.]"
      : "[Paciente tentou enviar uma foto do encaminhamento médico, mas não foi possível encaminhar para a equipe agora — avise que a validação será confirmada por outro meio.]";
  }
```

por:

```javascript
  if (!texto && data.message?.imageMessage) {
    // O bot não tem como validar o documento sozinho — a foto é gravada
    // como pendente (pra juntar com a notificação de agendamento, se um for
    // criado logo em seguida) e a conversa segue normalmente, com uma nota
    // sintética no lugar do texto (não há legenda/texto real).
    const pacienteFoto = await encontrarOuCriarPaciente({ nome: nomeContato, telefone });
    const resultadoFoto = await processarFotoEncaminhamento({
      messageKey: data.key,
      imageMessage: data.message.imageMessage,
      pacienteId: pacienteFoto.id,
      nomePaciente: pacienteFoto.nome ?? nomeContato,
      telefone,
    });
    texto = TEXTO_POR_RESULTADO_FOTO_ENCAMINHAMENTO[resultadoFoto];
  }
```

- [ ] **Step 4: Remover a função morta de `encaminhamentoMedicoService.js`**

Nada mais no projeto chama `encaminharFotoEncaminhamento` depois deste task. Apagar a função inteira de `src/services/encaminhamentoMedicoService.js`:

```javascript
export async function encaminharFotoEncaminhamento({ messageKey, imageMessage, telefone, nomeContato }) {
  if (!TELEFONE_ATENDENTE) {
    capturarAviso(
      "[encaminhamentoMedico] ATENDENTE_HUMANO_TELEFONE não configurado — foto não encaminhada."
    );
    return false;
  }

  try {
    const { data } = await evolutionApi.post(`/chat/getBase64FromMediaMessage/${evolutionInstance}`, {
      message: { key: messageKey },
    });

    const base64 = data?.base64;
    if (!base64) {
      throw new Error("Evolution API não retornou base64 da imagem.");
    }

    const legenda = imageMessage?.caption ? `\nLegenda do paciente: "${imageMessage.caption}"` : "";
    await enviarImagem(TELEFONE_ATENDENTE, {
      base64,
      mimetype: imageMessage?.mimetype,
      caption: `Encaminhamento médico para validação.\nPaciente: *${nomeContato ?? "desconhecido"}* (${telefone})${legenda}`,
    });

    return true;
  } catch (err) {
    // Mesma filosofia de encaminharHumano.js: falha no canal de notificação
    // não pode travar o atendimento do paciente.
    capturarErro("[encaminhamentoMedico] Falha ao encaminhar foto para a equipe:", err);
    return false;
  }
}
```

(A lógica equivalente já existe, dividida entre `baixarFotoEncaminhamento`/`enviarFotoAvulsaParaRecepcao`/`processarFotoEncaminhamento`, dos Tasks 3-4.)

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS — sem regressão (a função removida não tinha nenhum teste próprio nem era usada em mais lugar nenhum).

- [ ] **Step 6: Commit**

```bash
git add src/controllers/webhookController.js src/services/encaminhamentoMedicoService.js
git commit -m "feat: webhookController grava foto de encaminhamento como pendente em vez de repassar na hora"
```

---

### Task 6: `criarAgendamento.js` — notifica a recepção ao criar agendamento

**Files:**
- Modify: `src/functions/criarAgendamento.js`
- Test: `test/criarAgendamentoNotificacaoRecepcao.test.js` (novo)

**Interfaces:**
- Consumes: `buscarFotoPendente`, `apagarFotoPendente` (Task 3) de `../services/encaminhamentoMedicoService.js`; `enviarImagem`, `enviarMensagem` de `../services/whatsappService.js`; `formatarTelefoneExibicao` de `../utils/phone.js`.
- Produces: `notificarRecepcaoDoAgendamento({ pacienteId, nomePaciente, telefone, data, hora, tipoAtendimento, convenio }, deps?) => Promise<void>` — nunca lança exceção.

Este task testa `notificarRecepcaoDoAgendamento` isoladamente (com dependências injetadas — nenhuma chamada real a Postgres/Calendar/Evolution API). A fiação de duas linhas dentro de `criarAgendamento` (chamar a função depois do insert) é verificada pela suíte completa (sem regressão no fluxo já existente, que não tem teste próprio hoje) e pela verificação manual do Task 9.

- [ ] **Step 1: Escrever os testes**

```javascript
// test/criarAgendamentoNotificacaoRecepcao.test.js
import "./setupEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { notificarRecepcaoDoAgendamento } from "../src/functions/criarAgendamento.js";

const DADOS = {
  pacienteId: 5,
  nomePaciente: "Ana",
  telefone: "5511999990000",
  data: "2026-09-10",
  hora: "08:00",
  tipoAtendimento: "fisioterapia",
  convenio: "Particular",
};

test("notificarRecepcaoDoAgendamento: sem foto pendente, manda só texto com nome/telefone/data/hora/tipo/convênio", async () => {
  let enviouTexto = null;
  await notificarRecepcaoDoAgendamento(DADOS, {
    buscarFoto: async () => null,
    enviarComFoto: async () => {
      throw new Error("não deveria enviar imagem");
    },
    enviarSoTexto: async (telefone, texto) => {
      enviouTexto = { telefone, texto };
    },
  });

  assert.equal(enviouTexto.telefone, "5511999990000");
  assert.match(enviouTexto.texto, /Ana/);
  assert.match(enviouTexto.texto, /2026-09-10 às 08:00/);
  assert.match(enviouTexto.texto, /Fisioterapia/);
  assert.match(enviouTexto.texto, /Particular/);
});

test("notificarRecepcaoDoAgendamento: com foto pendente, manda a foto com a legenda e apaga a pendência", async () => {
  const chamadas = [];
  await notificarRecepcaoDoAgendamento(DADOS, {
    buscarFoto: async (pacienteId) => (
      chamadas.push(["buscarFoto", pacienteId]), { base64: "abc", mimetype: "image/jpeg" }
    ),
    apagarFoto: async (pacienteId) => chamadas.push(["apagarFoto", pacienteId]),
    enviarComFoto: async (telefone, { base64, caption }) => chamadas.push(["enviarComFoto", telefone, base64, caption]),
    enviarSoTexto: async () => {
      throw new Error("não deveria enviar texto");
    },
  });

  assert.deepEqual(chamadas.map((c) => c[0]), ["buscarFoto", "enviarComFoto", "apagarFoto"]);
  assert.equal(chamadas[1][2], "abc");
  assert.match(chamadas[1][3], /Ana/);
});

test("notificarRecepcaoDoAgendamento: tipo psicologia aparece formatado como Psicologia", async () => {
  let texto = null;
  await notificarRecepcaoDoAgendamento(
    { ...DADOS, tipoAtendimento: "psicologia" },
    { buscarFoto: async () => null, enviarSoTexto: async (_t, t) => (texto = t) }
  );
  assert.match(texto, /Psicologia/);
});

test("notificarRecepcaoDoAgendamento: convênio real aparece no texto (não vira Particular)", async () => {
  let texto = null;
  await notificarRecepcaoDoAgendamento(
    { ...DADOS, convenio: "Mar Azul Saúde" },
    { buscarFoto: async () => null, enviarSoTexto: async (_t, t) => (texto = t) }
  );
  assert.match(texto, /Convênio: Mar Azul Saúde/);
});

test("notificarRecepcaoDoAgendamento: falha ao buscar foto pendente não impede a notificação (segue sem foto)", async () => {
  let enviouTexto = false;
  await notificarRecepcaoDoAgendamento(DADOS, {
    buscarFoto: async () => {
      throw new Error("banco caiu");
    },
    enviarSoTexto: async () => {
      enviouTexto = true;
    },
  });
  assert.equal(enviouTexto, true);
});

test("notificarRecepcaoDoAgendamento: falha ao enviar com foto não apaga a pendência", async () => {
  let apagou = false;
  await notificarRecepcaoDoAgendamento(DADOS, {
    buscarFoto: async () => ({ base64: "abc", mimetype: "image/jpeg" }),
    apagarFoto: async () => {
      apagou = true;
    },
    enviarComFoto: async () => {
      throw new Error("Evolution API fora do ar");
    },
  });
  assert.equal(apagou, false);
});

test("notificarRecepcaoDoAgendamento: falha ao enviar sem foto não lança exceção", async () => {
  await assert.doesNotReject(() =>
    notificarRecepcaoDoAgendamento(DADOS, {
      buscarFoto: async () => null,
      enviarSoTexto: async () => {
        throw new Error("Evolution API fora do ar");
      },
    })
  );
});
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `node --test test/criarAgendamentoNotificacaoRecepcao.test.js`
Expected: FAIL — `notificarRecepcaoDoAgendamento` não existe.

- [ ] **Step 3: Implementar**

No topo de `src/functions/criarAgendamento.js`, estender os imports existentes:

```javascript
import {
  criarEventoAgendamento,
  cancelarEventoAgendamento,
  nomeDiaSemana,
} from "../services/calendarService.js";
import { encontrarOuCriarPaciente, atualizarDadosPaciente } from "../models/pacienteModel.js";
import { inserirAgendamento } from "../models/agendamentoModel.js";
import { validarData, validarHora, validarTipoAtendimento } from "../utils/validacao.js";
import { capturarErro, capturarAviso } from "../config/sentry.js";
import { CLINICA } from "../config/clinica.js";
import dayjs from "../utils/dayjs.js";
import { buscarFotoPendente, apagarFotoPendente } from "../services/encaminhamentoMedicoService.js";
import { enviarImagem, enviarMensagem } from "../services/whatsappService.js";
import { formatarTelefoneExibicao } from "../utils/phone.js";

const TELEFONE_ATENDENTE = process.env.ATENDENTE_HUMANO_TELEFONE;
```

Adicionar, depois das constantes existentes (`MOTIVO_POR_CODIGO_ERRO`, `NOME_PLACEHOLDER_PACIENTE_NOVO`) e antes do handler `criarAgendamento`:

```javascript
function montarTextoNotificacaoAgendamento({ nomePaciente, telefone, data, hora, tipoAtendimento, convenio }) {
  const tipoFormatado = tipoAtendimento === "psicologia" ? "Psicologia" : "Fisioterapia";
  const ehConvenio = Boolean(convenio) && convenio.trim().toLowerCase() !== "particular";
  const convenioFormatado = ehConvenio ? convenio : "Particular";
  return `📅 Novo agendamento\nPaciente: ${nomePaciente} (${formatarTelefoneExibicao(telefone)})\n${data} às ${hora} — ${tipoFormatado}\nConvênio: ${convenioFormatado}`;
}

/**
 * Notifica a recepção sobre o agendamento recém-criado — junto com a foto
 * de encaminhamento médico pendente do paciente, se ele mandou uma pouco
 * antes (ver encaminhamentoMedicoService.js). Nunca lança: uma falha aqui
 * não pode impedir a confirmação do agendamento pro paciente. Se havia
 * foto pendente e o envio falhar, a pendência NÃO é apagada — o job de
 * expiração (server.js) acaba enviando ela sozinha depois.
 */
export async function notificarRecepcaoDoAgendamento(
  { pacienteId, nomePaciente, telefone, data, hora, tipoAtendimento, convenio },
  {
    buscarFoto = buscarFotoPendente,
    apagarFoto = apagarFotoPendente,
    enviarComFoto = enviarImagem,
    enviarSoTexto = enviarMensagem,
  } = {}
) {
  if (!TELEFONE_ATENDENTE) {
    capturarAviso(
      "[criarAgendamento] ATENDENTE_HUMANO_TELEFONE não configurado — agendamento não notificado à recepção."
    );
    return;
  }

  const textoBase = montarTextoNotificacaoAgendamento({ nomePaciente, telefone, data, hora, tipoAtendimento, convenio });

  let fotoPendente = null;
  try {
    fotoPendente = await buscarFoto(pacienteId);
  } catch (err) {
    capturarErro("[criarAgendamento] Falha ao buscar foto pendente para notificação da recepção:", err);
  }

  try {
    if (fotoPendente) {
      await enviarComFoto(TELEFONE_ATENDENTE, {
        base64: fotoPendente.base64,
        mimetype: fotoPendente.mimetype,
        caption: textoBase,
      });
      await apagarFoto(pacienteId);
    } else {
      await enviarSoTexto(TELEFONE_ATENDENTE, textoBase);
    }
  } catch (err) {
    capturarErro("[criarAgendamento] Falha ao notificar a recepção sobre o agendamento:", err);
  }
}
```

No handler `criarAgendamento`, dentro do bloco `try` que insere no banco, adicionar a chamada logo depois de `inserirAgendamento` e antes do `return`:

```javascript
  try {
    const agendamento = await inserirAgendamento({
      pacienteId: paciente.id,
      data,
      hora,
      tipoAtendimento: tipo_atendimento,
      status: "confirmado",
      googleEventId: evento.id,
      primeiraConsulta: primeira_consulta ?? null,
      queixaPrincipal: queixa_principal ?? null,
    });

    await notificarRecepcaoDoAgendamento({
      pacienteId: paciente.id,
      nomePaciente: nome_paciente,
      telefone,
      data,
      hora,
      tipoAtendimento: tipo_atendimento,
      convenio,
    });

    return {
      sucesso: true,
      agendamentoId: agendamento.id,
      data,
      diaSemana: nomeDiaSemana(dayjs.tz(data, CLINICA.timezone)),
      hora,
      tipo_atendimento,
    };
  } catch (err) {
    ...
```

(O resto do `catch` fica exatamente como está — `notificarRecepcaoDoAgendamento` nunca lança, então não interfere no `catch` de reversão do evento do Calendar, que continua tratando só falhas de `inserirAgendamento`.)

- [ ] **Step 4: Rodar os testes**

Run: `node --test test/criarAgendamentoNotificacaoRecepcao.test.js`
Expected: PASS em todos.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS — sem regressão no fluxo existente de `criarAgendamento` (a única mudança nesse fluxo é uma chamada a mais, que nunca lança).

- [ ] **Step 6: Commit**

```bash
git add src/functions/criarAgendamento.js test/criarAgendamentoNotificacaoRecepcao.test.js
git commit -m "feat: criarAgendamento notifica a recepção, com foto de encaminhamento quando houver"
```

---

### Task 7: `encaminharHumano.js` — repassa foto pendente na hora

**Files:**
- Modify: `src/functions/encaminharHumano.js`
- Test: `test/encaminharHumano.test.js`

**Interfaces:**
- Consumes: `encontrarOuCriarPaciente` de `../models/pacienteModel.js` (importar); `buscarFotoPendente`, `apagarFotoPendente`, `enviarFotoAvulsaParaRecepcao` (Task 3) de `../services/encaminhamentoMedicoService.js`.
- Produces: `encaminharHumano(args, context, deps?)` — assinatura estendida (3º parâmetro opcional, aiService.js continua chamando só com 2 argumentos).

**Importante:** os 4 testes já existentes neste arquivo precisam continuar passando sem tentar uma conexão real de banco — como `encaminharHumano` agora chama `resolverPaciente`/`buscarFoto` por padrão (que tocam `pool.query` de verdade), os 4 testes existentes passam a receber um 3º argumento `SEM_FOTO_PENDENTE` que stuba essas duas dependências. Isso não muda o que eles verificam.

- [ ] **Step 1: Escrever os testes (arquivo completo, substituindo o atual)**

```javascript
// test/encaminharHumano.test.js
import "./setupEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { evolutionApi } from "../src/config/evolutionApi.js";
import { encaminharHumano } from "../src/functions/encaminharHumano.js";

const CONTEXT = { telefone: "5511988887777", nomeContato: "Paciente Teste" };
const SEM_FOTO_PENDENTE = { resolverPaciente: async () => ({ id: 1 }), buscarFoto: async () => null };

test("encaminharHumano retorna encaminhado:true quando a notificação por WhatsApp é enviada", async (t) => {
  t.mock.method(evolutionApi, "post", async () => ({ data: {} }));

  const resultado = await encaminharHumano({ motivo: "teste" }, CONTEXT, SEM_FOTO_PENDENTE);

  assert.deepEqual(resultado, { encaminhado: true });
});

test("encaminharHumano NÃO lança exceção quando o envio por WhatsApp falha (ex: Evolution API fora do ar) — degrada para encaminhado:false", async (t) => {
  t.mock.method(evolutionApi, "post", async () => {
    throw new Error("connect ECONNREFUSED 127.0.0.1:8080");
  });

  const resultado = await encaminharHumano({ motivo: "teste" }, CONTEXT, SEM_FOTO_PENDENTE);

  assert.equal(resultado.encaminhado, false);
  assert.match(resultado.instrucao, /ligar diretamente/i);
});

test("encaminharHumano prefixa a mensagem com a tag da categoria, para a recepção triar de relance", async (t) => {
  const post = t.mock.method(evolutionApi, "post", async () => ({ data: {} }));

  await encaminharHumano({ motivo: "teste", categoria: "psicologia" }, CONTEXT, SEM_FOTO_PENDENTE);

  const texto = post.mock.calls[0].arguments[1].text;
  assert.match(texto, /^🧠 PSICOLOGIA/);
});

test("encaminharHumano cai na tag 'outro' quando a categoria não é reconhecida ou não vem preenchida", async (t) => {
  const post = t.mock.method(evolutionApi, "post", async () => ({ data: {} }));

  await encaminharHumano({ motivo: "teste" }, CONTEXT, SEM_FOTO_PENDENTE);

  const texto = post.mock.calls[0].arguments[1].text;
  assert.match(texto, /^❓ OUTRO/);
});

test("encaminharHumano: com foto pendente, repassa ela sozinha e apaga a pendência", async (t) => {
  t.mock.method(evolutionApi, "post", async () => ({ data: {} }));
  const chamadas = [];

  const resultado = await encaminharHumano({ motivo: "teste", categoria: "psicologia" }, CONTEXT, {
    resolverPaciente: async () => ({ id: 9 }),
    buscarFoto: async (pacienteId) => (
      chamadas.push(["buscarFoto", pacienteId]),
      { nome: "Ana", telefone: "5511988887777", base64: "abc", mimetype: "image/jpeg", legenda_paciente: null }
    ),
    apagarFoto: async (pacienteId) => chamadas.push(["apagarFoto", pacienteId]),
    enviarFotoAvulsa: async (args) => (chamadas.push(["enviarFotoAvulsa", args]), true),
  });

  assert.equal(resultado.encaminhado, true);
  assert.deepEqual(chamadas.map((c) => c[0]), ["buscarFoto", "enviarFotoAvulsa", "apagarFoto"]);
  assert.equal(chamadas[0][1], 9);
  assert.equal(chamadas[2][1], 9);
});

test("encaminharHumano: sem foto pendente, não tenta enviar nem apagar nada", async (t) => {
  t.mock.method(evolutionApi, "post", async () => ({ data: {} }));
  let tentouEnviarFoto = false;

  await encaminharHumano({ motivo: "teste" }, CONTEXT, {
    resolverPaciente: async () => ({ id: 9 }),
    buscarFoto: async () => null,
    enviarFotoAvulsa: async () => {
      tentouEnviarFoto = true;
      return true;
    },
  });

  assert.equal(tentouEnviarFoto, false);
});

test("encaminharHumano: falha ao repassar foto pendente não impede o retorno encaminhado:true (notificação principal já foi enviada)", async (t) => {
  t.mock.method(evolutionApi, "post", async () => ({ data: {} }));

  const resultado = await encaminharHumano({ motivo: "teste" }, CONTEXT, {
    resolverPaciente: async () => {
      throw new Error("banco caiu");
    },
  });

  assert.equal(resultado.encaminhado, true);
});

test("encaminharHumano: envio da foto avulsa falhando não apaga a pendência", async (t) => {
  t.mock.method(evolutionApi, "post", async () => ({ data: {} }));
  let apagou = false;

  await encaminharHumano({ motivo: "teste" }, CONTEXT, {
    resolverPaciente: async () => ({ id: 9 }),
    buscarFoto: async () => ({
      nome: "Ana",
      telefone: "5511988887777",
      base64: "abc",
      mimetype: "image/jpeg",
      legenda_paciente: null,
    }),
    apagarFoto: async () => {
      apagou = true;
    },
    enviarFotoAvulsa: async () => false,
  });

  assert.equal(apagou, false);
});
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham**

Run: `node --test test/encaminharHumano.test.js`
Expected: FAIL — `encaminharHumano` ainda não aceita o 3º parâmetro nem repassa foto pendente.

- [ ] **Step 3: Implementar**

Substituir `src/functions/encaminharHumano.js` inteiro por:

```javascript
import { enviarMensagem } from "../services/whatsappService.js";
import { encontrarOuCriarPaciente } from "../models/pacienteModel.js";
import {
  buscarFotoPendente,
  apagarFotoPendente,
  enviarFotoAvulsaParaRecepcao,
} from "../services/encaminhamentoMedicoService.js";
import { capturarErro, capturarAviso } from "../config/sentry.js";

const TELEFONE_ATENDENTE = process.env.ATENDENTE_HUMANO_TELEFONE;

const INSTRUCAO_FALLBACK =
  "Notificação automática à equipe está indisponível no momento. Peça ao paciente para ligar diretamente para a clínica.";

// Prefixo visual por categoria, pra recepção triar de relance sem precisar
// ler o motivo inteiro de cada encaminhamento (rotina vs. algo mais urgente).
const TAG_POR_CATEGORIA = {
  psicologia: "🧠 PSICOLOGIA",
  convenio: "📄 CONVÊNIO",
  urgente: "⚠️ URGENTE",
  erro_tecnico: "🔧 ERRO TÉCNICO",
  outro: "❓ OUTRO",
};

/**
 * Handler da function encaminhar_humano. Notifica a equipe da clínica no
 * WhatsApp interno com o motivo e o contato do paciente. Não depende de
 * banco/Calendar pra essa notificação principal, por isso ela já sai pronta
 * na etapa 4. Também repassa, se houver, a foto de encaminhamento médico
 * que o paciente tenha mandado antes de ser encaminhado — não faz sentido
 * esperar o timeout do job de expiração já que esse caminho não vai gerar
 * agendamento pelo bot.
 */
export async function encaminharHumano(
  { motivo, categoria },
  { telefone, nomeContato },
  {
    resolverPaciente = encontrarOuCriarPaciente,
    buscarFoto = buscarFotoPendente,
    apagarFoto = apagarFotoPendente,
    enviarFotoAvulsa = enviarFotoAvulsaParaRecepcao,
  } = {}
) {
  if (!TELEFONE_ATENDENTE) {
    capturarAviso(
      "[encaminharHumano] ATENDENTE_HUMANO_TELEFONE não configurado — encaminhamento não notificado."
    );
    return { encaminhado: false, instrucao: INSTRUCAO_FALLBACK };
  }

  const tag = TAG_POR_CATEGORIA[categoria] ?? TAG_POR_CATEGORIA.outro;

  try {
    await enviarMensagem(
      TELEFONE_ATENDENTE,
      `${tag}\nPaciente: *${nomeContato ?? "desconhecido"}* (${telefone})\nMotivo: ${motivo}`
    );
  } catch (err) {
    // Não deixa a falha do canal de notificação (Evolution API fora do ar,
    // instabilidade de rede etc.) derrubar quem chamou essa function — isso
    // inclui o fallback de "OpenAI sem créditos" do aiService, que já está
    // lidando com uma indisponibilidade e não pode quebrar em cascata.
    capturarErro("[encaminharHumano] Falha ao notificar a equipe por WhatsApp:", err);
    return { encaminhado: false, instrucao: INSTRUCAO_FALLBACK };
  }

  try {
    const paciente = await resolverPaciente({ nome: nomeContato, telefone });
    const fotoPendente = await buscarFoto(paciente.id);
    if (fotoPendente) {
      const enviado = await enviarFotoAvulsa({
        nomePaciente: fotoPendente.nome,
        telefone: fotoPendente.telefone,
        base64: fotoPendente.base64,
        mimetype: fotoPendente.mimetype,
        legendaPaciente: fotoPendente.legenda_paciente,
      });
      if (enviado) {
        await apagarFoto(paciente.id);
      }
    }
  } catch (err) {
    capturarErro(
      "[encaminharHumano] Falha ao repassar foto de encaminhamento pendente junto com o encaminhamento humano:",
      err
    );
    // Não bloqueia o retorno — a notificação principal já foi enviada; se a
    // foto continuar pendente, o job de expiração (server.js) acaba
    // enviando ela sozinha depois.
  }

  return { encaminhado: true };
}
```

- [ ] **Step 4: Rodar os testes**

Run: `node --test test/encaminharHumano.test.js`
Expected: PASS em todos (8 testes: 4 já existentes, ajustados, + 4 novos).

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/functions/encaminharHumano.js test/encaminharHumano.test.js
git commit -m "feat: encaminharHumano repassa foto de encaminhamento pendente, se houver"
```

---

### Task 8: `server.js` — job periódico de expiração

**Files:**
- Modify: `server.js`

**Interfaces:**
- Consumes: `enviarFotosPendentesExpiradas` (Task 3) de `./src/services/encaminhamentoMedicoService.js`.

Sem teste dedicado — nenhum dos crons já existentes em `server.js` (lembrete, checagem de WhatsApp, checagem de créditos OpenAI) tem teste próprio hoje; este segue o mesmo padrão. Verificado por `npm test` (sem regressão) e `node --check` (sintaxe).

- [ ] **Step 1: Adicionar o import**

No topo de `server.js`, junto aos outros imports de serviço:

```javascript
import { enviarLembretesPendentes } from "./src/services/lembreteService.js";
import { verificarConexaoWhatsapp } from "./src/services/whatsappHealthService.js";
import { verificarCreditosOpenAI } from "./src/services/openaiHealthService.js";
import { enviarFotosPendentesExpiradas } from "./src/services/encaminhamentoMedicoService.js";
```

- [ ] **Step 2: Adicionar o cron**

Depois do bloco `tarefaChecagemWhatsapp` (mesma condição `EVOLUTION_CONFIGURADA`, já que este job também manda mensagem via Evolution API):

```javascript
// Garante que nenhuma foto de encaminhamento médico se perde quando o
// paciente manda a foto mas não chega a agendar nem é encaminhado para
// atendimento humano (ver notificarRecepcaoDoAgendamento em
// criarAgendamento.js e encaminharHumano.js, que consomem a pendência
// antes desse timeout). A cada 15 min, mesma cadência do lembrete.
let tarefaFotosPendentesExpiradas = null;
if (EVOLUTION_CONFIGURADA) {
  tarefaFotosPendentesExpiradas = cron.schedule("*/15 * * * *", () => {
    enviarFotosPendentesExpiradas().catch((err) => {
      capturarErro("[server] Falha ao rodar o job de fotos de encaminhamento pendentes:", err);
    });
  });
}
```

- [ ] **Step 3: Parar o cron no desligamento**

Em `desligar()`, adicionar a chamada de stop junto às outras:

```javascript
function desligar(sinal) {
  console.log(`[server] ${sinal} recebido, desligando...`);
  tarefaLembrete?.stop();
  tarefaChecagemWhatsapp?.stop();
  tarefaChecagemOpenAI?.stop();
  tarefaFotosPendentesExpiradas?.stop();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
```

- [ ] **Step 4: Checar sintaxe**

Run: `node --check server.js`
Expected: sem saída (sintaxe válida).

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat: job periódico envia fotos de encaminhamento pendentes esquecidas"
```

---

### Task 9: Verificação manual (dev, não produção)

**Files:** nenhum (só verificação).

- [ ] **Step 1: Rodar a migration 022 no banco de dev**

Mesmo processo usado pras migrations 020/021 nesta sessão: aplicar o SQL de `022_encaminhamentos_pendentes.sql` contra o banco de dev (confirmar antes que é dev, não produção).

- [ ] **Step 2: Subir o servidor local**

Run: `node server.js` (com `LEMBRETE_CONSULTA_ATIVADO=false` no `.env` local).

- [ ] **Step 3: Exercitar o fluxo pelo WhatsApp de teste (se houver instância de dev conectada à Evolution API)**

- Mandar uma foto qualquer (como se fosse o encaminhamento) pro número do bot — confirmar que a resposta do bot indica que a foto "será repassada junto com o agendamento" (não "a equipe já recebeu", que era o texto de antes).
- Confirmar no banco de dev que a linha apareceu em `encaminhamentos_pendentes` (`SELECT * FROM encaminhamentos_pendentes;`).
- Completar um agendamento pela conversa — confirmar que a recepção (número em `ATENDENTE_HUMANO_TELEFONE`) recebe uma ÚNICA mensagem de imagem com a legenda contendo nome, telefone, data/hora, tipo e convênio.
- Confirmar que a linha em `encaminhamentos_pendentes` foi apagada depois do envio.
- Repetir mandando a foto e, em vez de agendar, disparando um encaminhamento humano (ex: perguntar sobre psicologia) — confirmar que a foto chega sozinha pra recepção nessa hora, sem esperar.
- Se não houver uma instância de WhatsApp/Evolution API de teste disponível, pular este step e confirmar via chamada direta das funções contra o banco de dev (próximo step).

- [ ] **Step 4: Verificar o job de expiração diretamente (sem esperar 15 min)**

Escrever um script temporário (fora do controle de versão, ex: `_verificar_expiracao.mjs` na raiz do worktree) que importa `enviarFotosPendentesExpiradas` de `src/services/encaminhamentoMedicoService.js` e chama ela diretamente contra o banco de dev, com uma linha de teste inserida manualmente em `encaminhamentos_pendentes` com `criado_em` no passado (`now() - interval '20 minutes'`). Confirmar que a foto chega pra recepção e a linha é apagada. Apagar o script depois.

- [ ] **Step 5: Rodar a suíte inteira uma última vez**

Run: `npm test`
Expected: PASS — todos os testes (508 originais + os novos desta feature).

- [ ] **Step 6: Derrubar o servidor local**

Encerrar o processo `node server.js` iniciado no Step 2.

---

## Self-Review

**Cobertura da spec:** gravar foto como pendente em vez de repassar na hora — Tasks 4-5. Notificação de agendamento com/sem foto — Task 6. Flush imediato no encaminhamento humano — Task 7. Job periódico de expiração (15 min) — Tasks 3, 8. Fallback quando a gravação da pendência falha (repasse imediato) — Task 4. Falha ao notificar não apaga a pendência — Task 6 (só apaga após envio bem-sucedido) e Task 3 (mesma regra no job de expiração). Conteúdo da notificação (nome, telefone, data/hora, tipo, convênio) — Task 6. Migration 022 — Task 2. Fora de escopo (remarcação/cancelamento, agendamento manual do dashboard) — nenhuma tarefa toca esses fluxos.

**Consistência de tipos/nomes:** `buscarFotoPendente`/`apagarFotoPendente`/`enviarFotoAvulsaParaRecepcao` (Task 3) são consumidas com os mesmos nomes de campo em Task 4 (fallback), Task 6 (notificação de agendamento) e Task 7 (encaminhamento humano) — `legenda_paciente` (campo do banco/retorno) sempre mapeado pra `legendaPaciente` (parâmetro) nos três lugares que chamam `enviarFotoAvulsaParaRecepcao`. `processarFotoEncaminhamento` retorna exatamente os 3 valores (`"pendente"|"encaminhado"|"falhou"`) que `webhookController.js` (Task 5) espera no mapa `TEXTO_POR_RESULTADO_FOTO_ENCAMINHAMENTO`.

**Desvio da spec:** a spec descreve a função de notificação como parte do fluxo de `criarAgendamento.js` sem nomear explicitamente — o plano nomeia `notificarRecepcaoDoAgendamento`, exportada e testável isoladamente, decisão de design mantida dentro do arquivo indicado pela spec.
