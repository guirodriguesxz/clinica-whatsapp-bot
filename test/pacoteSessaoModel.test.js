import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import {
  criarPacote,
  cancelarPacote,
  listarPacotesPaciente,
} from "../src/models/pacoteSessaoModel.js";

// Nota (review final, Finding 3): existia um `buscarPacoteAtivoPaciente`
// pool-based aqui, exportado só porque o plano original o previa como a
// função usada por criarPacote — mas criarPacote acabou precisando de uma
// variante que roda no client da transação (buscarPacoteAtivoPacienteComClient,
// não exportada) pra fechar a corrida TOCTOU (ver commit cbd8e92). A versão
// pool-based ficou sem nenhum call site em src/ (nem dashboardController,
// nem registroAtendimentoModel, que tem sua própria consulta) — dead code
// confirmado. Removida junto com estes dois testes; a SQL que ela rodava
// virou o predicado compartilhado PREDICADO_PACOTE_ATIVO, testado
// indiretamente pelos testes de criarPacote/registrarPresencaBot abaixo.

function mockarClientTransacional(t, { pacoteAtivo = null, pacoteCriado = {} } = {}) {
  const chamadas = [];
  const client = {
    query: async (sql, params) => {
      chamadas.push({ sql, params });
      if (sql.includes("SELECT ps.id, ps.quantidade_total")) {
        return { rows: pacoteAtivo ? [pacoteAtivo] : [] };
      }
      if (sql.includes("INSERT INTO pacotes_sessoes")) {
        return { rows: [pacoteCriado] };
      }
      return {};
    },
    release: () => {},
  };
  t.mock.method(pool, "connect", async () => client);
  return chamadas;
}

test("criarPacote: quantidade zero, negativa, abaixo do mínimo ou não numérica retorna motivo quantidade_invalida sem consultar o banco", async (t) => {
  const chamadasConnect = [];
  t.mock.method(pool, "connect", async () => {
    chamadasConnect.push(true);
    throw new Error("não deveria conectar ao banco com quantidade inválida");
  });

  const resultadoZero = await criarPacote({ pacienteId: 1, quantidadeTotal: 0, criadoPor: 5 });
  const resultadoNegativo = await criarPacote({ pacienteId: 1, quantidadeTotal: -3, criadoPor: 5 });
  const resultadoAbaixoDoMinimo = await criarPacote({ pacienteId: 1, quantidadeTotal: 9, criadoPor: 5 });
  const resultadoNaoNumerico = await criarPacote({ pacienteId: 1, quantidadeTotal: "dez", criadoPor: 5 });

  assert.deepEqual(resultadoZero, { motivo: "quantidade_invalida" });
  assert.deepEqual(resultadoNegativo, { motivo: "quantidade_invalida" });
  assert.deepEqual(resultadoAbaixoDoMinimo, { motivo: "quantidade_invalida" });
  assert.deepEqual(resultadoNaoNumerico, { motivo: "quantidade_invalida" });
  assert.equal(chamadasConnect.length, 0, "não deve conectar ao banco com quantidade inválida");
});

test("criarPacote: aceita exatamente a quantidade mínima (10)", async (t) => {
  const chamadas = mockarClientTransacional(t, { pacoteCriado: { id: 10, quantidade_total: 10 } });

  const resultado = await criarPacote({ pacienteId: 1, quantidadeTotal: 10, criadoPor: 5 });

  assert.deepEqual(resultado, { pacote: { id: 10, quantidade_total: 10 } });
  assert.ok(chamadas.some((c) => c.sql.includes("INSERT INTO pacotes_sessoes")));
});

test("criarPacote: adquire o advisory lock escopado no paciente antes de checar e inserir", async (t) => {
  const chamadas = mockarClientTransacional(t, { pacoteCriado: { id: 10 } });

  await criarPacote({ pacienteId: 1, quantidadeTotal: 20, criadoPor: 5 });

  const indiceLock = chamadas.findIndex((c) => /pg_advisory_xact_lock/.test(c.sql));
  const indiceCheck = chamadas.findIndex((c) => c.sql.includes("SELECT ps.id, ps.quantidade_total"));
  const indiceInsert = chamadas.findIndex((c) => c.sql.includes("INSERT INTO pacotes_sessoes"));

  assert.notEqual(indiceLock, -1, "deve chamar pg_advisory_xact_lock");
  assert.deepEqual(chamadas[indiceLock].params, [1]);
  assert.ok(indiceLock < indiceCheck, "lock deve ser adquirido antes da checagem de pacote ativo");
  assert.ok(indiceCheck < indiceInsert, "checagem de pacote ativo deve rodar antes do INSERT");
});

test("criarPacote: paciente com pacote ativo existente é bloqueado e faz ROLLBACK", async (t) => {
  const chamadas = mockarClientTransacional(t, { pacoteAtivo: { id: 3, quantidade_total: 10 } });

  const resultado = await criarPacote({ pacienteId: 1, quantidadeTotal: 10, criadoPor: 5 });

  assert.deepEqual(resultado, { motivo: "pacote_ativo_existente" });
  assert.equal(chamadas.at(-1).sql, "ROLLBACK");
  assert.ok(
    !chamadas.some((c) => c.sql.includes("INSERT INTO pacotes_sessoes")),
    "não deve inserir quando já existe pacote ativo"
  );
});

test("criarPacote: caminho feliz insere e retorna o pacote criado", async (t) => {
  const pacoteCriado = {
    id: 10,
    paciente_id: 1,
    quantidade_total: 20,
    cancelado: false,
    criado_por: 5,
    created_at: "2026-09-01T12:00:00.000Z",
  };
  const chamadas = mockarClientTransacional(t, { pacoteCriado });

  const resultado = await criarPacote({ pacienteId: 1, quantidadeTotal: 20, criadoPor: 5 });

  assert.deepEqual(resultado, { pacote: pacoteCriado });
  const insertChamada = chamadas.find((c) => c.sql.includes("INSERT INTO pacotes_sessoes"));
  assert.deepEqual(insertChamada.params, [1, 20, 5]);
  assert.equal(chamadas.at(-1).sql, "COMMIT");
});

test("criarPacote: erro no meio da transação propaga, faz ROLLBACK e libera o client", async (t) => {
  const chamadas = [];
  let releaseChamado = false;
  const erroSimulado = new Error("falha simulada no INSERT");
  const client = {
    query: async (sql, params) => {
      chamadas.push({ sql, params });
      if (sql.includes("SELECT ps.id, ps.quantidade_total")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO pacotes_sessoes")) {
        throw erroSimulado;
      }
      return {};
    },
    release: () => {
      releaseChamado = true;
    },
  };
  t.mock.method(pool, "connect", async () => client);

  await assert.rejects(
    () => criarPacote({ pacienteId: 1, quantidadeTotal: 20, criadoPor: 5 }),
    erroSimulado
  );

  assert.equal(chamadas.at(-1).sql, "ROLLBACK");
  assert.equal(releaseChamado, true, "client.release() deve ser chamado mesmo em caso de erro");
});

test("cancelarPacote: marca cancelado e retorna a linha atualizada", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [{ id: 10, cancelado: true }] };
  });

  const resultado = await cancelarPacote(10, 7);

  assert.deepEqual(resultado, { id: 10, cancelado: true });
  assert.match(consultas[0].sql, /UPDATE pacotes_sessoes SET cancelado = true/);
  assert.match(consultas[0].sql, /WHERE id = \$1 AND paciente_id = \$2 AND cancelado = false/);
  assert.deepEqual(consultas[0].params, [10, 7]);
});

// Cobre tanto "pacote inexistente/já cancelado" quanto "pacote existe mas
// pertence a outro paciente" (Finding 5 do review final) — dos dois lados
// do mock, o resultado é idêntico: a query com `AND paciente_id = $2` não
// bate nenhuma linha e retorna [].
test("cancelarPacote: pacote inexistente, já cancelado ou de outro paciente retorna null", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });

  const resultado = await cancelarPacote(999, 7);

  assert.equal(resultado, null);
  assert.deepEqual(consultas[0].params, [999, 7]);
});

test("listarPacotesPaciente: retorna pacotes com quantidade_usada calculada, mais recente primeiro", async (t) => {
  const consultas = [];
  const linhas = [
    { id: 10, quantidade_total: 20, cancelado: false, created_at: "2026-09-01", quantidade_usada: 3 },
    { id: 3, quantidade_total: 10, cancelado: false, created_at: "2026-08-01", quantidade_usada: 10 },
  ];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: linhas };
  });

  const pacotes = await listarPacotesPaciente(1);

  assert.deepEqual(pacotes, linhas);
  assert.match(consultas[0].sql, /ORDER BY ps\.created_at DESC/);
  assert.match(consultas[0].sql, /quantidade_usada/);
  assert.deepEqual(consultas[0].params, [1]);
});
