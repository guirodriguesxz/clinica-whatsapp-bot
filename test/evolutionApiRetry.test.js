import "./setupEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { evolutionApi } from "../src/config/evolutionApi.js";

// Regressão real (2026-09-22): um timeout contra a Evolution API não prova
// que a mensagem não foi entregue — pode só ter demorado a responder. O
// retry automático (src/config/evolutionApi.js) reenviava a MESMA call
// nesse caso, o que já causou uma paciente real receber a
// mesma mensagem duas vezes. Endpoints que efetivamente mandam algo pro
// WhatsApp (sendText/sendMedia, ver src/services/whatsappService.js) agora
// passam `semRetryEmFalhaTransitoria: true` pra desligar esse retry.

function instalarAdapterFake(t, comportamentos) {
  let chamadas = 0;
  const original = evolutionApi.defaults.adapter;
  evolutionApi.defaults.adapter = async (config) => {
    const comportamento = comportamentos[chamadas];
    chamadas++;
    if (comportamento === "timeout") {
      // O adapter HTTP real da axios anexa `.config` no erro antes de
      // rejeitar (é isso que o interceptor de retry usa) — replicamos aqui,
      // já que dispatchRequest.js não faz isso por conta própria.
      const err = new Error("timeout of 15000ms exceeded");
      err.code = "ECONNABORTED";
      err.config = config;
      throw err;
    }
    return { data: comportamento, status: 200, statusText: "OK", headers: {}, config };
  };
  t.after(() => {
    evolutionApi.defaults.adapter = original;
  });
  return () => chamadas;
}

test("evolutionApi: retenta automaticamente em timeout quando semRetryEmFalhaTransitoria não é passado", async (t) => {
  const contarChamadas = instalarAdapterFake(t, ["timeout", { ok: true }]);

  const { data } = await evolutionApi.post("/instance/connectionState/clinicaexemplo", {});

  assert.deepEqual(data, { ok: true });
  assert.equal(contarChamadas(), 2, "deveria ter tentado de novo após o timeout");
});

test("evolutionApi: NÃO retenta em timeout quando semRetryEmFalhaTransitoria é passado (sendText/sendMedia)", async (t) => {
  const contarChamadas = instalarAdapterFake(t, ["timeout", { ok: true }]);

  await assert.rejects(
    () =>
      evolutionApi.post(
        "/message/sendText/clinicaexemplo",
        { number: "5511988887777@s.whatsapp.net", text: "oi" },
        { semRetryEmFalhaTransitoria: true }
      ),
    /timeout/
  );

  assert.equal(contarChamadas(), 1, "não deveria ter tentado de novo — reenviar arrisca duplicar a mensagem real");
});
