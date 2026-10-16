import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { comLock } from "../src/utils/mutex.js";

// comLock serializa via pg_advisory_xact_lock (mesmo padrão de
// inserirAgendamentoComTravaDeCapacidade em agendamentoModel.js) — funciona
// entre múltiplas instâncias do processo, não só dentro do atual. Esse fake
// client simula BEGIN/lock/COMMIT/ROLLBACK e captura a ordem/params das
// chamadas pros asserts abaixo; a serialização real entre conexões distintas
// só é verificável contra um Postgres de verdade (fora do escopo de um
// teste unitário, igual ao resto do projeto).
function criarClienteFalso() {
  const chamadas = [];
  const client = {
    query: async (sql, params) => {
      chamadas.push({ sql, params });
      return { rows: [] };
    },
    release: () => {
      chamadas.push({ sql: "RELEASE" });
    },
  };
  return { client, chamadas };
}

test("comLock: adquire client, trava por advisory lock com a chave, roda fn, comita e libera", async (t) => {
  const { client, chamadas } = criarClienteFalso();
  t.mock.method(pool, "connect", async () => client);

  const resultado = await comLock("5511999990001", async () => "ok");

  assert.equal(resultado, "ok");
  const sqls = chamadas.map((c) => c.sql);
  assert.deepEqual(sqls, ["BEGIN", "SELECT pg_advisory_xact_lock(hashtext($1))", "COMMIT", "RELEASE"]);
  assert.deepEqual(chamadas[1].params, ["5511999990001"]);
});

test("comLock: só chama fn depois que a trava foi adquirida", async (t) => {
  const { client, chamadas } = criarClienteFalso();
  t.mock.method(pool, "connect", async () => client);

  let ordemFnChamada = null;
  await comLock("chave-1", async () => {
    ordemFnChamada = chamadas.length;
  });

  // fn só pode ter rodado depois de BEGIN + o lock (2 chamadas já feitas).
  assert.equal(ordemFnChamada, 2);
});

test("comLock: erro em fn causa ROLLBACK (não COMMIT), propaga o erro, e ainda libera o client", async (t) => {
  const { client, chamadas } = criarClienteFalso();
  t.mock.method(pool, "connect", async () => client);

  await assert.rejects(
    () =>
      comLock("chave-erro", async () => {
        throw new Error("falhou");
      }),
    /falhou/
  );

  const sqls = chamadas.map((c) => c.sql);
  assert.deepEqual(sqls, ["BEGIN", "SELECT pg_advisory_xact_lock(hashtext($1))", "ROLLBACK", "RELEASE"]);
});

test("comLock: chaves diferentes travam com params diferentes", async (t) => {
  const { client: clienteX, chamadas: chamadasX } = criarClienteFalso();
  const { client: clienteY, chamadas: chamadasY } = criarClienteFalso();
  let vez = 0;
  t.mock.method(pool, "connect", async () => (vez++ === 0 ? clienteX : clienteY));

  await comLock("chave-x", async () => {});
  await comLock("chave-y", async () => {});

  assert.deepEqual(chamadasX[1].params, ["chave-x"]);
  assert.deepEqual(chamadasY[1].params, ["chave-y"]);
});

test("comLock: libera o client mesmo se ROLLBACK falhar", async (t) => {
  const chamadas = [];
  const client = {
    query: async (sql) => {
      chamadas.push(sql);
      if (sql === "ROLLBACK") throw new Error("conexão perdida");
      return { rows: [] };
    },
    release: () => chamadas.push("RELEASE"),
  };
  t.mock.method(pool, "connect", async () => client);

  await assert.rejects(
    () =>
      comLock("chave-erro", async () => {
        throw new Error("falhou");
      }),
    /falhou/
  );

  assert.ok(chamadas.includes("RELEASE"), "client precisa ser liberado mesmo com ROLLBACK falhando");
});
