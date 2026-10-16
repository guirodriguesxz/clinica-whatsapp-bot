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
  registrarFotoPendente,
  processarFotoEncaminhamento,
} from "../src/services/encaminhamentoMedicoService.js";

// Checagem do fim do job (a tabela ficou vazia?). Os testes do job neste
// arquivo respondem que ainda há pendência, pra flag em memória continuar
// ligada entre eles — o comportamento da flag é coberto em
// encaminhamentoMedicoJobOcioso.test.js.
const SQL_AINDA_HA_PENDENCIA = /SELECT 1 FROM encaminhamentos_pendentes/;

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
  assert.match(requestBodyCapturado.caption, /Foto enviada pelo paciente para conferência/);
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
  assert.match(sqlCapturado, /LIMIT 50/);
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
    if (SQL_AINDA_HA_PENDENCIA.test(sql)) return { rows: [{}] };
    throw new Error("SQL inesperado: " + sql);
  });
  t.mock.method(evolutionApi, "post", async () => (chamadas.push("enviou"), { data: {} }));

  await enviarFotosPendentesExpiradas();

  // "enviou" duas vezes: enviarImagem checa o JID antes de mandar a mídia.
  assert.deepEqual(chamadas, ["enviou", "enviou", "apagou"]);
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
    if (SQL_AINDA_HA_PENDENCIA.test(sql)) return { rows: [{}] };
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
    if (SQL_AINDA_HA_PENDENCIA.test(sql)) return { rows: [{}] };
    throw new Error("SQL inesperado: " + sql);
  });
  t.mock.method(evolutionApi, "post", async (url) => {
    // Só a chamada de mídia de verdade importa pro teste — a checagem de JID
    // (resolverJid) engole os próprios erros e nunca deveria contar como
    // "falha no envio" aqui.
    if (!url.includes("/message/sendMedia/")) return { data: [] };
    chamadasEnvio++;
    if (chamadasEnvio === 1) throw new Error("falha na primeira");
    return { data: {} };
  });

  await enviarFotosPendentesExpiradas();

  assert.equal(chamadasEnvio, 2, "deve tentar enviar as duas pendências mesmo a primeira falhando");
});

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
  assert.match(sqlCapturado, /criado_em = now\(\)/);
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
  // getBase64FromMediaMessage + checagem de JID (resolverJid) + sendMedia.
  assert.equal(chamadasEvolution, 3, "deve baixar a foto e depois tentar o repasse imediato");
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

test("processarFotoEncaminhamento: já havia foto pendente do paciente — repassa a anterior sozinha antes de substituir pela nova", async (t) => {
  const enviosSendMedia = [];
  let inseriu = false;
  t.mock.method(evolutionApi, "post", async (url, body) => {
    if (url.includes("getBase64FromMediaMessage")) {
      return { data: { base64: "foto-nova" } };
    }
    if (url.includes("sendMedia")) {
      enviosSendMedia.push(body);
      return { data: { key: { id: "wamid-repasse" } } };
    }
    throw new Error("URL inesperada: " + url);
  });
  t.mock.method(pool, "query", async (sql) => {
    if (/SELECT ep.paciente_id/.test(sql)) {
      return {
        rows: [
          {
            paciente_id: 5,
            base64: "foto-antiga",
            mimetype: "image/jpeg",
            legenda_paciente: "página 1",
            nome: "Ana",
            telefone: "5511999990000",
          },
        ],
      };
    }
    if (/INSERT INTO encaminhamentos_pendentes/.test(sql)) {
      inseriu = true;
      return { rows: [] };
    }
    throw new Error("SQL inesperado: " + sql);
  });

  const resultado = await processarFotoEncaminhamento({
    messageKey: { id: "wamid-2" },
    imageMessage: { mimetype: "image/jpeg", caption: "página 2" },
    pacienteId: 5,
    nomePaciente: "Ana",
    telefone: "5511999990000",
  });

  assert.equal(resultado, "pendente");
  assert.equal(inseriu, true, "a foto nova deve ser registrada mesmo repassando a anterior");
  assert.equal(enviosSendMedia.length, 1, "a foto anterior deve ser repassada sozinha");
  assert.equal(enviosSendMedia[0].media, "foto-antiga");
});

test("sanitizarLegendaPaciente (via processarFotoEncaminhamento): legenda com quebras de linha, marcação e acima de 300 caracteres é limpa e truncada", async (t) => {
  t.mock.method(evolutionApi, "post", async () => ({ data: { base64: "foto-base64" } }));
  let paramsCapturados = null;
  t.mock.method(pool, "query", async (sql, params) => {
    if (/SELECT ep.paciente_id/.test(sql)) return { rows: [] };
    if (/INSERT INTO encaminhamentos_pendentes/.test(sql)) {
      paramsCapturados = params;
      return { rows: [] };
    }
    throw new Error("SQL inesperado: " + sql);
  });

  const legendaSuja = "*urgente*\n_encaminhar_ com `prioridade`\n~hoje~ " + "x".repeat(400);

  const resultado = await processarFotoEncaminhamento({
    messageKey: { id: "wamid-3" },
    imageMessage: { mimetype: "image/jpeg", caption: legendaSuja },
    pacienteId: 5,
    nomePaciente: "Ana",
    telefone: "5511999990000",
  });

  assert.equal(resultado, "pendente");
  const legendaGravada = paramsCapturados[3];
  assert.ok(legendaGravada.length <= 300, "legenda deve ser truncada em 300 caracteres");
  assert.doesNotMatch(legendaGravada, /[\r\n*_~`]/);
});
