import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import {
  buscarPacientePorId,
  listarHistoricoPaciente,
  listarSessoesFisioterapiaPaciente,
  excluirOuArquivarPaciente,
} from "../src/models/pacienteModel.js";

test("buscarPacientePorId consulta pelo identificador e retorna um paciente", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [{ id: 7, nome: "Ana" }] };
  });

  const paciente = await buscarPacientePorId(7);

  assert.deepEqual(paciente, { id: 7, nome: "Ana" });
  assert.match(consultas[0].sql, /FROM pacientes WHERE id = \$1/);
  assert.deepEqual(consultas[0].params, [7]);
});

test("listarHistoricoPaciente limita o histórico e ordena o mais recente primeiro", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });

  await listarHistoricoPaciente(7);

  assert.match(consultas[0].sql, /WHERE paciente_id = \$1/);
  assert.match(consultas[0].sql, /ORDER BY data DESC, hora DESC/);
  assert.match(consultas[0].sql, /LIMIT \$2/);
  assert.deepEqual(consultas[0].params, [7, 50]);
});

test("listarSessoesFisioterapiaPaciente busca as dez mais recentes e devolve em ordem cronológica", async (t) => {
  const consultas = [];
  const sessaoMaisRecente = { data: "2026-08-30", hora: "09:00", status: "compareceu" };
  const sessaoMaisAntiga = { data: "2026-08-23", hora: "09:00", status: "compareceu" };
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    // Devolvido na mesma ordem DESC que a query real traria (mais recente
    // primeiro) — array próprio por chamada, já que a implementação
    // reordena com .reverse() (que muta em vez de copiar).
    return { rows: [sessaoMaisRecente, sessaoMaisAntiga] };
  });

  const sessoes = await listarSessoesFisioterapiaPaciente(7);

  assert.match(consultas[0].sql, /tipo_atendimento = 'fisioterapia'/);
  // DESC (mais recentes primeiro) na consulta — pegar as dez mais antigas
  // faria um paciente com mais de dez sessões na vida nunca ver as atuais.
  assert.match(consultas[0].sql, /ORDER BY data DESC, hora DESC/);
  assert.match(consultas[0].sql, /LIMIT \$2/);
  assert.deepEqual(consultas[0].params, [7, 10]);
  // Resultado invertido pra ordem cronológica (mais antiga primeiro), como
  // o cartão impresso espera preencher.
  assert.deepEqual(sessoes, [sessaoMaisAntiga, sessaoMaisRecente]);
});

test("excluirOuArquivarPaciente: sem histórico, apaga de verdade (DELETE) e retorna 'excluido'", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rowCount: 1 };
  });

  const resultado = await excluirOuArquivarPaciente(7);

  assert.equal(resultado, "excluido");
  assert.equal(consultas.length, 1);
  assert.match(consultas[0].sql, /DELETE FROM pacientes WHERE id = \$1/);
  assert.deepEqual(consultas[0].params, [7]);
});

test("excluirOuArquivarPaciente: paciente inexistente (0 linhas afetadas) retorna null", async (t) => {
  t.mock.method(pool, "query", async () => ({ rowCount: 0 }));

  const resultado = await excluirOuArquivarPaciente(999);

  assert.equal(resultado, null);
});

test("excluirOuArquivarPaciente: com histórico (violação de chave estrangeira), arquiva (UPDATE ativo=false) e retorna 'arquivado'", async (t) => {
  const consultas = [];
  let primeiraChamada = true;
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    if (primeiraChamada) {
      primeiraChamada = false;
      const erro = new Error("update or delete on table \"pacientes\" violates foreign key constraint");
      erro.code = "23503";
      throw erro;
    }
    return { rowCount: 1 };
  });

  const resultado = await excluirOuArquivarPaciente(7);

  assert.equal(resultado, "arquivado");
  assert.equal(consultas.length, 2);
  assert.match(consultas[1].sql, /UPDATE pacientes SET ativo = false WHERE id = \$1/);
  assert.deepEqual(consultas[1].params, [7]);
});

test("excluirOuArquivarPaciente: violação de FK mas paciente já sumiu na hora de arquivar (corrida) retorna null", async (t) => {
  let primeiraChamada = true;
  t.mock.method(pool, "query", async () => {
    if (primeiraChamada) {
      primeiraChamada = false;
      const erro = new Error("violates foreign key constraint");
      erro.code = "23503";
      throw erro;
    }
    return { rowCount: 0 };
  });

  const resultado = await excluirOuArquivarPaciente(7);

  assert.equal(resultado, null);
});

test("excluirOuArquivarPaciente: outro erro do banco propaga sem virar arquivamento", async (t) => {
  t.mock.method(pool, "query", async () => {
    throw new Error("conexão perdida");
  });

  await assert.rejects(
    () => excluirOuArquivarPaciente(7),
    (err) => err.message === "conexão perdida"
  );
});
