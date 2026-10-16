import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import {
  inserirAgendamento,
  editarAgendamento,
  editarAgendamentoImportado,
  excluirOuCancelarAgendamento,
} from "../src/models/agendamentoModel.js";

// inserirAgendamento sempre checa capacidade (CLINICA.capacidadeMaximaPorHorario
// tem entrada finita pra fisioterapia e psicologia) dentro de uma transação
// travada por pg_advisory_xact_lock — ver agendamentoModel.js. Esse fake
// client simula BEGIN/lock/SELECT de ocupação (0 por padrão)/INSERT/COMMIT,
// e captura o SQL+params do INSERT de verdade pros asserts existentes.
function criarClienteFalso({ ocupacaoAtual = 0, linhaInserida = { id: 1 } } = {}) {
  let sqlInsert = null;
  let paramsInsert = null;
  const client = {
    query: async (sql, params) => {
      if (sql.includes("INSERT INTO agendamentos")) {
        sqlInsert = sql;
        paramsInsert = params;
        return { rows: [linhaInserida] };
      }
      if (sql.includes("GROUP BY hora")) {
        return { rows: ocupacaoAtual > 0 ? [{ hora: "08:00:00", total: ocupacaoAtual }] : [] };
      }
      return { rows: [] }; // BEGIN, pg_advisory_xact_lock, COMMIT, ROLLBACK
    },
    release: () => {},
  };
  return { client, sqlInsert: () => sqlInsert, paramsInsert: () => paramsInsert };
}

test("inserirAgendamento: grava criado_por_usuario_id quando informado", async (t) => {
  const { client, sqlInsert, paramsInsert } = criarClienteFalso();
  t.mock.method(pool, "connect", async () => client);

  await inserirAgendamento({
    pacienteId: 10,
    data: "2026-09-10",
    hora: "08:00",
    tipoAtendimento: "fisioterapia",
    googleEventId: "evt-1",
    criadoPorUsuarioId: 3,
  });

  assert.match(sqlInsert(), /criado_por_usuario_id/);
  assert.equal(paramsInsert().at(-3), 3);
});

test("inserirAgendamento: sem criadoPorUsuarioId (chamada do bot), grava null — comportamento inalterado", async (t) => {
  const { client, paramsInsert } = criarClienteFalso();
  t.mock.method(pool, "connect", async () => client);

  await inserirAgendamento({
    pacienteId: 10,
    data: "2026-09-10",
    hora: "08:00",
    tipoAtendimento: "fisioterapia",
    googleEventId: "evt-1",
  });

  assert.equal(paramsInsert().at(-3), null);
});

test("inserirAgendamento: grava psicologo_id quando informado", async (t) => {
  const { client, paramsInsert } = criarClienteFalso();
  t.mock.method(pool, "connect", async () => client);

  await inserirAgendamento({
    pacienteId: 10,
    data: "2026-09-10",
    hora: "08:00",
    tipoAtendimento: "psicologia",
    googleEventId: "evt-1",
    psicologoId: 6,
  });

  assert.equal(paramsInsert().at(-2), 6);
});

test("inserirAgendamento: grava fisioterapeuta_id quando informado", async (t) => {
  const { client, paramsInsert } = criarClienteFalso();
  t.mock.method(pool, "connect", async () => client);

  await inserirAgendamento({
    pacienteId: 10,
    data: "2026-09-10",
    hora: "08:00",
    tipoAtendimento: "fisioterapia",
    googleEventId: "evt-1",
    fisioterapeutaId: 9,
  });

  assert.equal(paramsInsert().at(-1), 9);
});

test("inserirAgendamento: recontagem dentro da trava rejeita com HORARIO_LOTADO quando a vaga já foi ocupada por outra corrida", async (t) => {
  // capacidadeMaximaPorHorario.fisioterapia é 7 (src/config/clinica.js) —
  // simula a corrida real: outra transação já inseriu e commitou entre a
  // checagem de validarDisponibilidadeAgendamento e este INSERT, então a
  // recontagem feita já dentro da trava vê a ocupação no limite.
  const { client } = criarClienteFalso({ ocupacaoAtual: 7 });
  t.mock.method(pool, "connect", async () => client);

  await assert.rejects(
    () =>
      inserirAgendamento({
        pacienteId: 10,
        data: "2026-09-10",
        hora: "08:00",
        tipoAtendimento: "fisioterapia",
        googleEventId: "evt-1",
      }),
    (err) => err.codigo === "HORARIO_LOTADO"
  );
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
    psicologoId: 7,
  });

  assert.match(sqlCapturado, /UPDATE agendamentos/);
  assert.match(sqlCapturado, /psicologo_id = \$8/);
  assert.deepEqual(paramsCapturados, [5, 20, "2026-09-11", "09:00", "psicologia", "evt-novo", 2, 7, null]);
  assert.equal(resultado.id, 5);
});

test("editarAgendamento: sem psicologoId (Fisioterapia), grava null", async (t) => {
  let paramsCapturados = null;
  t.mock.method(pool, "query", async (sql, params) => {
    paramsCapturados = params;
    return { rows: [{ id: 5 }] };
  });

  await editarAgendamento({
    id: 5,
    pacienteId: 20,
    data: "2026-09-11",
    hora: "09:00",
    tipoAtendimento: "fisioterapia",
    googleEventId: "evt-novo",
    atualizadoPorUsuarioId: 2,
  });

  assert.equal(paramsCapturados.at(-2), null);
  assert.equal(paramsCapturados.at(-1), null);
});

test("editarAgendamento: grava fisioterapeuta_id quando informado", async (t) => {
  let paramsCapturados = null;
  t.mock.method(pool, "query", async (sql, params) => {
    paramsCapturados = params;
    return { rows: [{ id: 5 }] };
  });

  await editarAgendamento({
    id: 5,
    pacienteId: 20,
    data: "2026-09-11",
    hora: "09:00",
    tipoAtendimento: "fisioterapia",
    googleEventId: "evt-novo",
    atualizadoPorUsuarioId: 2,
    fisioterapeutaId: 9,
  });

  assert.equal(paramsCapturados.at(-1), 9);
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

test("editarAgendamentoImportado: grava psicologo_id quando informado", async (t) => {
  let sqlCapturado = null;
  let paramsCapturados = null;
  t.mock.method(pool, "query", async (sql, params) => {
    sqlCapturado = sql;
    paramsCapturados = params;
    return { rows: [{ id: 9 }] };
  });

  await editarAgendamentoImportado({
    id: 9,
    nome: "Novo Nome",
    telefone: "5511988887777",
    tipoAtendimento: "psicologia",
    data: "2026-09-12",
    hora: "10:00",
    atualizadoPorUsuarioId: 2,
    psicologoId: 4,
  });

  assert.match(sqlCapturado, /psicologo_id = \$8/);
  assert.equal(paramsCapturados.at(-2), 4);
});

test("editarAgendamentoImportado: grava fisioterapeuta_id quando informado", async (t) => {
  let paramsCapturados = null;
  t.mock.method(pool, "query", async (sql, params) => {
    paramsCapturados = params;
    return { rows: [{ id: 9 }] };
  });

  await editarAgendamentoImportado({
    id: 9,
    nome: "Novo Nome",
    telefone: "5511988887777",
    tipoAtendimento: "fisioterapia",
    data: "2026-09-12",
    hora: "10:00",
    atualizadoPorUsuarioId: 2,
    fisioterapeutaId: 6,
  });

  assert.equal(paramsCapturados.at(-1), 6);
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

test("excluirOuCancelarAgendamento: apaga de verdade quando não há histórico vinculado (bot)", async (t) => {
  let sqlCapturado = null;
  t.mock.method(pool, "query", async (sql) => {
    sqlCapturado = sql;
    return { rowCount: 1 };
  });

  const resultado = await excluirOuCancelarAgendamento("bot", 5);

  assert.match(sqlCapturado, /DELETE FROM agendamentos WHERE/);
  assert.equal(resultado, "excluido");
});

test("excluirOuCancelarAgendamento: apaga de verdade na tabela importados", async (t) => {
  let sqlCapturado = null;
  t.mock.method(pool, "query", async (sql) => {
    sqlCapturado = sql;
    return { rowCount: 1 };
  });

  const resultado = await excluirOuCancelarAgendamento("importado", 9);

  assert.match(sqlCapturado, /DELETE FROM agendamentos_importados WHERE/);
  assert.equal(resultado, "excluido");
});

test("excluirOuCancelarAgendamento: cancela em vez de excluir quando há violação de FK (23503)", async (t) => {
  let chamadas = 0;
  t.mock.method(pool, "query", async (sql) => {
    chamadas++;
    if (sql.startsWith("DELETE")) {
      const erro = new Error("violates foreign key constraint");
      erro.code = "23503";
      throw erro;
    }
    return { rowCount: 1 };
  });

  const resultado = await excluirOuCancelarAgendamento("bot", 5);

  assert.equal(chamadas, 2);
  assert.equal(resultado, "cancelado");
});

test("excluirOuCancelarAgendamento: agendamento inexistente retorna null", async (t) => {
  t.mock.method(pool, "query", async () => ({ rowCount: 0 }));

  const resultado = await excluirOuCancelarAgendamento("bot", 999);

  assert.equal(resultado, null);
});

test("excluirOuCancelarAgendamento: erro que não é violação de FK propaga", async (t) => {
  t.mock.method(pool, "query", async () => {
    throw new Error("conexão caiu");
  });

  await assert.rejects(() => excluirOuCancelarAgendamento("bot", 5), /conexão caiu/);
});
