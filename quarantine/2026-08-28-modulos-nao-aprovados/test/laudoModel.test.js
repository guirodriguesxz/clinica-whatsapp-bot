// test/laudoModel.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { buscarDadosLaudoBot, buscarDadosLaudoImportado } from "../src/models/laudoModel.js";

test("buscarDadosLaudoBot: agendamento inexistente retorna motivo nao_encontrado", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await buscarDadosLaudoBot(999);

  assert.deepEqual(resultado, { motivo: "nao_encontrado" });
});

test("buscarDadosLaudoBot: sem observacao_sessao retorna motivo sem_observacao", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        paciente_nome: "Maria",
        data: "2026-08-20",
        observacao_sessao: null,
        profissional_responsavel: null,
      },
    ],
  }));

  const resultado = await buscarDadosLaudoBot(5);

  assert.deepEqual(resultado, { motivo: "sem_observacao" });
});

test("buscarDadosLaudoBot: observacao_sessao vazia (string em branco) também conta como sem_observacao", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        paciente_nome: "Maria",
        data: "2026-08-20",
        observacao_sessao: "",
        profissional_responsavel: null,
      },
    ],
  }));

  const resultado = await buscarDadosLaudoBot(5);

  assert.deepEqual(resultado, { motivo: "sem_observacao" });
});

test("buscarDadosLaudoBot: caminho feliz com profissional_responsavel presente", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        paciente_nome: "Maria",
        data: "2026-08-20",
        observacao_sessao: "Evoluiu bem",
        profissional_responsavel: "Dra. Ana",
      },
    ],
  }));

  const resultado = await buscarDadosLaudoBot(5);

  assert.deepEqual(resultado, {
    dados: {
      pacienteNome: "Maria",
      data: "2026-08-20",
      profissionalResponsavel: "Dra. Ana",
      observacaoSessao: "Evoluiu bem",
    },
  });
});

test("buscarDadosLaudoBot: sem profissional_responsavel, campo fica null (sem fallback pro bot)", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        paciente_nome: "Maria",
        data: "2026-08-20",
        observacao_sessao: "Evoluiu bem",
        profissional_responsavel: null,
      },
    ],
  }));

  const resultado = await buscarDadosLaudoBot(5);

  assert.equal(resultado.dados.profissionalResponsavel, null);
});

test("buscarDadosLaudoImportado: agendamento importado inexistente retorna motivo nao_encontrado", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await buscarDadosLaudoImportado(999);

  assert.deepEqual(resultado, { motivo: "nao_encontrado" });
});

test("buscarDadosLaudoImportado: sem observacao_sessao retorna motivo sem_observacao", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        paciente_nome: "João",
        data: "2026-08-20",
        atendente: "Carlos",
        observacao_sessao: null,
        profissional_responsavel: null,
      },
    ],
  }));

  const resultado = await buscarDadosLaudoImportado(8);

  assert.deepEqual(resultado, { motivo: "sem_observacao" });
});

test("buscarDadosLaudoImportado: profissional_responsavel presente tem prioridade sobre atendente", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        paciente_nome: "João",
        data: "2026-08-20",
        atendente: "Carlos (legado)",
        observacao_sessao: "Sessão concluída",
        profissional_responsavel: "Dra. Ana",
      },
    ],
  }));

  const resultado = await buscarDadosLaudoImportado(8);

  assert.equal(resultado.dados.profissionalResponsavel, "Dra. Ana");
});

test("buscarDadosLaudoImportado: sem profissional_responsavel, cai pro atendente (dado legado)", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        paciente_nome: "João",
        data: "2026-08-20",
        atendente: "Carlos (legado)",
        observacao_sessao: "Sessão concluída",
        profissional_responsavel: null,
      },
    ],
  }));

  const resultado = await buscarDadosLaudoImportado(8);

  assert.equal(resultado.dados.profissionalResponsavel, "Carlos (legado)");
});

test("buscarDadosLaudoImportado: nem profissional_responsavel nem atendente existem, campo fica null", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        paciente_nome: "João",
        data: "2026-08-20",
        atendente: null,
        observacao_sessao: "Sessão concluída",
        profissional_responsavel: null,
      },
    ],
  }));

  const resultado = await buscarDadosLaudoImportado(8);

  assert.equal(resultado.dados.profissionalResponsavel, null);
});
