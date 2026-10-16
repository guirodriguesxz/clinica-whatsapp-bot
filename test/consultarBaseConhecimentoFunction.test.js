import "./setupEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import {
  consultarBaseConhecimento,
  INSTRUCAO_RESPOSTAS_ENCONTRADAS,
} from "../src/functions/consultarBaseConhecimento.js";

function mockarBase(t, busca) {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("categoria = ANY")) {
      return {
        rows: [
          { categoria: "fisioterapia_tratamentos", resposta: "- Fisioterapia neurológica: SOMENTE pós-AVC" },
          { categoria: "sem_atendimento", resposta: "Não atende autismo (TEA)." },
        ],
      };
    }
    return { rows: busca };
  });
}

// Caso real 2026-10-05: sem a lista de casos atendidos no resultado, o
// modelo recusava AVC (que está na lista) e encaminhava autismo (que a
// clínica não atende).
test("consultar_base_conhecimento: as listas de casos atendidos e não atendidos vão sempre no resultado", async (t) => {
  mockarBase(t, [{ resposta: "Endereço: Av. Exemplo, 1000." }]);

  const resultado = await consultarBaseConhecimento({ pergunta: "meu pai teve derrame, atendem?" });

  assert.deepEqual(resultado.casosAtendidosFisioterapia, ["- Fisioterapia neurológica: SOMENTE pós-AVC"]);
  assert.deepEqual(resultado.naoAtendidos, ["Não atende autismo (TEA)."]);
  assert.equal(resultado.observacao, INSTRUCAO_RESPOSTAS_ENCONTRADAS);
});

test("consultar_base_conhecimento: busca vazia ainda traz as listas e a instrução", async (t) => {
  mockarBase(t, []);

  const resultado = await consultarBaseConhecimento({ pergunta: "vocês fazem acupuntura?" });

  assert.equal(resultado.encontrado, false);
  assert.equal(resultado.casosAtendidosFisioterapia.length, 1);
  assert.match(resultado.observacao, /não atende esse caso/);
  assert.match(resultado.observacao, /encaminhar_humano/);
});
