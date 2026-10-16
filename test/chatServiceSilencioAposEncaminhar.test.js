import "./setupEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import dayjs from "../src/utils/dayjs.js";
import { pool } from "../src/db/pool.js";
import { openai } from "../src/config/openai.js";
import { processarMensagemRecebida } from "../src/services/chatService.js";

const PACIENTE = { id: 42, nome: "Paciente Teste", telefone: "5511988887777", etapa_atual: "encaminhado_humano" };

function mockarBanco(t, horasDesdeBot) {
  const inserts = [];
  t.mock.method(pool, "query", async (sql, params) => {
    if (sql.includes("FROM pacientes")) return { rows: [PACIENTE] };
    if (sql.includes("FROM conversas")) {
      return {
        rows: [
          { mensagem: "Não vou poder ir amanhã", remetente: "paciente", timestamp: dayjs().subtract(horasDesdeBot, "hour").toISOString() },
          { mensagem: "Anotado! Já avisei a equipe.", remetente: "bot", timestamp: dayjs().subtract(horasDesdeBot, "hour").toISOString() },
        ],
      };
    }
    if (sql.includes("INSERT INTO conversas")) inserts.push(params);
    return { rows: [] };
  });
  return inserts;
}

test("logo depois de encaminhar, o bot entra no modo pós-encaminhamento e não manda nada quando o modelo devolve SEM_RESPOSTA", async (t) => {
  const inserts = mockarBanco(t, 0.5);
  const createMock = t.mock.method(openai.chat.completions, "create", async () => ({
    choices: [{ message: { content: "SEM_RESPOSTA_NECESSARIA", tool_calls: undefined } }],
  }));

  await processarMensagemRecebida({ telefone: "5511988887777", texto: "Tenho consulta com a doutora", nomeContato: "Paciente Teste" });

  const system = createMock.mock.calls[0].arguments[0].messages[0].content;
  assert.match(system, /MODO PÓS-ENCAMINHAMENTO/);
  assert.equal(inserts.length, 1, "só a mensagem do paciente é registrada");
});

test("passado o tempo de silêncio sem a equipe responder, a IA volta a responder", async (t) => {
  mockarBanco(t, 3);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const createMock = t.mock.method(openai.chat.completions, "create", async () => ({
    choices: [{ message: { content: "Oi! Como posso ajudar?", tool_calls: undefined } }],
  }));

  await processarMensagemRecebida({ telefone: "5511988887777", texto: "Alguém pode me responder?", nomeContato: "Paciente Teste" });

  assert.equal(createMock.mock.calls.length, 1);
  assert.doesNotMatch(createMock.mock.calls[0].arguments[0].messages[0].content, /MODO PÓS-ENCAMINHAMENTO/);
});

test("no modo pós-encaminhamento, o código descarta resposta que repete 'já avisei a equipe' mesmo se o modelo ignorar o prompt", async (t) => {
  const inserts = mockarBanco(t, 0.2);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(openai.chat.completions, "create", async () => ({
    choices: [{ message: { content: "Anotado, Pedro! Já avisei a equipe para remarcar sua consulta para hoje às 10:30.", tool_calls: undefined } }],
  }));

  await processarMensagemRecebida({ telefone: "5511988887777", texto: "Aí seria para 10:30 mesmo", nomeContato: "Paciente Teste" });

  assert.equal(inserts.length, 1, "resposta da IA não é registrada nem enviada");
});

test("no modo pós-encaminhamento, pergunta objetiva sobre a clínica ainda é respondida", async (t) => {
  const inserts = mockarBanco(t, 0.2);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(openai.chat.completions, "create", async () => ({
    choices: [{ message: { content: "Ficamos na Av. Exemplo, 1000 - Bairro Exemplo.", tool_calls: undefined } }],
  }));

  await processarMensagemRecebida({ telefone: "5511988887777", texto: "Qual o endereço?", nomeContato: "Paciente Teste" });

  assert.equal(inserts.length, 2);
  assert.match(inserts[1][1], /Bairro Exemplo/);
});

test("no modo pós-encaminhamento, conversa fiada sem pergunta não recebe resposta mesmo sem citar a equipe", async (t) => {
  const inserts = mockarBanco(t, 0.2);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(openai.chat.completions, "create", async () => ({
    choices: [{ message: { content: "Perfeito! Se precisar de algo mais, estou por aqui!", tool_calls: undefined } }],
  }));

  await processarMensagemRecebida({ telefone: "5511988887777", texto: "tudo bem também", nomeContato: "Paciente Teste" });

  assert.equal(inserts.length, 1);
});
