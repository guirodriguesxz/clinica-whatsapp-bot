import "./setupEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import {
  enviarFotosPendentesExpiradas,
  registrarFotoPendente,
} from "../src/services/encaminhamentoMedicoService.js";

// O estado em memória do job (podeHaverFotoPendente/versaoFotoPendente) é
// do módulo, então os testes deste arquivo rodam em sequência e dependem da
// ordem — cada um parte do estado deixado pelo anterior.

function mockarBanco(t, { tabelaVazia = true, aoChecarVazia } = {}) {
  const consultas = [];
  t.mock.method(pool, "query", async (sql) => {
    consultas.push(sql);
    if (/SELECT ep.paciente_id/.test(sql)) return { rows: [] };
    if (/SELECT 1 FROM encaminhamentos_pendentes/.test(sql)) {
      await aoChecarVazia?.();
      return { rows: tabelaVazia ? [] : [{}] };
    }
    if (/INSERT INTO encaminhamentos_pendentes/.test(sql)) return { rows: [] };
    throw new Error("SQL inesperado: " + sql);
  });
  return consultas;
}

test("job: na primeira execução (depois de um restart) consulta o banco e, com a tabela vazia, desliga a flag", async (t) => {
  const consultas = mockarBanco(t, { tabelaVazia: true });

  await enviarFotosPendentesExpiradas();

  assert.equal(consultas.length, 2, "busca as expiradas e checa se sobrou alguma");
});

test("job: com a flag desligada não consulta o banco", async (t) => {
  const consultas = mockarBanco(t);

  await enviarFotosPendentesExpiradas();
  await enviarFotosPendentesExpiradas();

  assert.equal(consultas.length, 0);
});

test("job: depois de registrar uma foto volta a consultar, e mantém a flag enquanto ainda há pendência", async (t) => {
  const consultas = mockarBanco(t, { tabelaVazia: false });

  await registrarFotoPendente({ pacienteId: 1, base64: "a", mimetype: "image/jpeg" });
  await enviarFotosPendentesExpiradas();
  await enviarFotosPendentesExpiradas();

  // 1 INSERT + 2 execuções do job com 2 consultas cada: a foto ainda não
  // expirou (ou o envio falhou), então a flag continua ligada.
  assert.equal(consultas.length, 5);
});

test("job: foto gravada DURANTE a checagem de tabela vazia não desliga a flag (corrida da versão)", async (t) => {
  // Tabela "vazia" no SELECT 1, mas uma foto nova é gravada enquanto a
  // checagem está em andamento — sem a versão, a flag desligaria e essa
  // foto nunca seria repassada pelo job.
  mockarBanco(t, {
    tabelaVazia: true,
    aoChecarVazia: () => registrarFotoPendente({ pacienteId: 2, base64: "b", mimetype: "image/jpeg" }),
  });
  await enviarFotosPendentesExpiradas();

  t.mock.restoreAll();
  const consultas = mockarBanco(t, { tabelaVazia: true });
  await enviarFotosPendentesExpiradas();

  assert.equal(consultas.length, 2, "a execução seguinte ainda consulta o banco");

  // Agora a tabela está vazia sem corrida: a flag desliga.
  await enviarFotosPendentesExpiradas();
  assert.equal(consultas.length, 2);
});
