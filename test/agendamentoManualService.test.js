import "./setupEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { openai } from "../src/config/openai.js";
import {
  cancelarAgendamentoManual,
  remarcarAgendamentoManual,
  processarMensagemManualEquipe,
} from "../src/services/agendamentoManualService.js";

// O detector descarta detecção com data no passado, então os testes que
// passam por ele precisam de uma data sempre futura — data fixa envelhece e
// quebra o teste sozinha quando o dia vira.
const DATA_FUTURA = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

function mockPersistenciaDaConversa(t) {
  // registrarMensagem (INSERT) e buscarHistoricoRecente (SELECT) passam
  // pela mesma pool.query — devolve histórico vazio pra qualquer SELECT.
  t.mock.method(pool, "query", async (sql) => (String(sql).includes("SELECT") ? { rows: [] } : { rows: [] }));
}

function mockDeteccaoIA(t, acao) {
  t.mock.method(openai.chat.completions, "create", async () => ({
    choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(acao) } }] } }],
  }));
}

test("cancelarAgendamentoManual: cancela quando há exatamente uma consulta confirmada futura", async () => {
  let idCancelado = null;
  await cancelarAgendamentoManual(
    { telefone: "5511999990000" },
    {
      buscarConfirmados: async () => [{ id: 42, data: "2026-09-15", hora: "09:00:00" }],
      cancelar: async (id) => {
        idCancelado = id;
      },
    }
  );

  assert.equal(idCancelado, 42);
});

test("cancelarAgendamentoManual: NÃO cancela nada quando há mais de uma consulta confirmada (ambíguo)", async () => {
  let chamou = false;
  await cancelarAgendamentoManual(
    { telefone: "5511999990000" },
    {
      buscarConfirmados: async () => [
        { id: 1, data: "2026-09-15", hora: "09:00:00" },
        { id: 2, data: "2026-09-22", hora: "09:00:00" },
      ],
      cancelar: async () => {
        chamou = true;
      },
    }
  );

  assert.equal(chamou, false);
});

test("cancelarAgendamentoManual: NÃO cancela nada quando não há consulta confirmada futura", async () => {
  let chamou = false;
  await cancelarAgendamentoManual(
    { telefone: "5511999990000" },
    {
      buscarConfirmados: async () => [],
      cancelar: async () => {
        chamou = true;
      },
    }
  );

  assert.equal(chamou, false);
});

test("remarcarAgendamentoManual: remarca quando há exatamente uma consulta confirmada futura", async () => {
  let argsRecebidos = null;
  await remarcarAgendamentoManual(
    { telefone: "5511999990000", data: "2026-09-22", hora: "14:00" },
    {
      buscarConfirmados: async () => [{ id: 42, data: "2026-09-15", hora: "09:00:00" }],
      remarcar: async (args) => {
        argsRecebidos = args;
      },
    }
  );

  assert.deepEqual(argsRecebidos, { id: 42, data: "2026-09-22", hora: "14:00" });
});

test("remarcarAgendamentoManual: NÃO remarca nada quando há mais de uma consulta confirmada (ambíguo)", async () => {
  let chamou = false;
  await remarcarAgendamentoManual(
    { telefone: "5511999990000", data: "2026-09-22", hora: "14:00" },
    {
      buscarConfirmados: async () => [
        { id: 1, data: "2026-09-15", hora: "09:00:00" },
        { id: 2, data: "2026-09-22", hora: "09:00:00" },
      ],
      remarcar: async () => {
        chamou = true;
      },
    }
  );

  assert.equal(chamou, false);
});

test("processarMensagemManualEquipe: acao 'cancelar' aciona cancelarAgendamento com o telefone", async (t) => {
  mockPersistenciaDaConversa(t);
  mockDeteccaoIA(t, { acao: "cancelar" });
  let argsRecebidos = null;
  await processarMensagemManualEquipe(
    { pacienteId: 1, telefone: "5511999990000", texto: "cancelei a consulta dela", nomePaciente: "Ana" },
    {
      deteccaoAtiva: true,
      criarAgendamento: async () => {
        throw new Error("não deveria chamar criarAgendamento");
      },
      cancelarAgendamento: async (args) => {
        argsRecebidos = args;
      },
      remarcarAgendamento: async () => {
        throw new Error("não deveria chamar remarcarAgendamento");
      },
    }
  );

  assert.deepEqual(argsRecebidos, { telefone: "5511999990000" });
});

test("processarMensagemManualEquipe: acao 'remarcar' aciona remarcarAgendamento com telefone/data/hora", async (t) => {
  mockPersistenciaDaConversa(t);
  mockDeteccaoIA(t, { acao: "remarcar", data: DATA_FUTURA, hora: "09:00" });
  let argsRecebidos = null;
  await processarMensagemManualEquipe(
    { pacienteId: 1, telefone: "5511999990000", texto: "ok, mudei pra sexta 14h", nomePaciente: "Ana" },
    {
      deteccaoAtiva: true,
      criarAgendamento: async () => {
        throw new Error("não deveria chamar criarAgendamento");
      },
      cancelarAgendamento: async () => {
        throw new Error("não deveria chamar cancelarAgendamento");
      },
      remarcarAgendamento: async (args) => {
        argsRecebidos = args;
      },
    }
  );

  assert.deepEqual(argsRecebidos, { telefone: "5511999990000", data: DATA_FUTURA, hora: "09:00" });
});

test("processarMensagemManualEquipe: acao 'nenhuma' não aciona criar/cancelar/remarcar", async (t) => {
  mockPersistenciaDaConversa(t);
  mockDeteccaoIA(t, { acao: "nenhuma" });
  let alguemChamado = false;
  await processarMensagemManualEquipe(
    { pacienteId: 1, telefone: "5511999990000", texto: "oi, tudo bem?", nomePaciente: "Ana" },
    {
      deteccaoAtiva: true,
      criarAgendamento: async () => {
        alguemChamado = true;
      },
      cancelarAgendamento: async () => {
        alguemChamado = true;
      },
      remarcarAgendamento: async () => {
        alguemChamado = true;
      },
    }
  );

  assert.equal(alguemChamado, false);
});

test("processarMensagemManualEquipe: usa o nome do paciente detectado na conversa em vez do nome do contato do WhatsApp (regressão real: contato 'Sr Luiz' agendando a sessão da paciente Ana, que entrou como 'Paciente')", async (t) => {
  mockPersistenciaDaConversa(t);
  mockDeteccaoIA(t, {
    acao: "criar",
    data: DATA_FUTURA,
    hora: "15:00",
    nome_paciente: "ANA PAULA EXEMPLO",
  });
  let argsRecebidos = null;

  await processarMensagemManualEquipe(
    { pacienteId: 1, telefone: "5511999990006", texto: "Deixamos a paciente ANA agendada", nomePaciente: "Paciente" },
    {
      deteccaoAtiva: true,
      criarAgendamento: async (args) => {
        argsRecebidos = args;
      },
      cancelarAgendamento: async () => {
        throw new Error("não deveria chamar cancelarAgendamento");
      },
      remarcarAgendamento: async () => {
        throw new Error("não deveria chamar remarcarAgendamento");
      },
    }
  );

  assert.equal(argsRecebidos.nomePaciente, "ANA PAULA EXEMPLO");
});

test("processarMensagemManualEquipe: sem nome detectado na conversa, mantém o nome do contato do WhatsApp", async (t) => {
  mockPersistenciaDaConversa(t);
  mockDeteccaoIA(t, { acao: "criar", data: DATA_FUTURA, hora: "15:00" });
  let argsRecebidos = null;

  await processarMensagemManualEquipe(
    { pacienteId: 1, telefone: "5511999990000", texto: "marcado pra terça às 15h", nomePaciente: "Ana" },
    {
      deteccaoAtiva: true,
      criarAgendamento: async (args) => {
        argsRecebidos = args;
      },
      cancelarAgendamento: async () => {},
      remarcarAgendamento: async () => {},
    }
  );

  assert.equal(argsRecebidos.nomePaciente, "Ana");
});

test("processarMensagemManualEquipe: detecção de agenda desligada por padrão — só registra a mensagem", async (t) => {
  mockPersistenciaDaConversa(t);
  mockDeteccaoIA(t, { acao: "criar", data: DATA_FUTURA, hora: "09:00" });
  await processarMensagemManualEquipe(
    { pacienteId: 1, telefone: "5511999990000", texto: "agendada amanhã às 9h", nomePaciente: "Ana" },
    {
      criarAgendamento: async () => {
        throw new Error("não deveria criar agendamento com a detecção desligada");
      },
    }
  );
});
