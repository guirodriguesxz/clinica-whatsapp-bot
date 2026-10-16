import "./setupEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { openai } from "../src/config/openai.js";
import { evolutionApi } from "../src/config/evolutionApi.js";
import { processarMensagemRecebida } from "../src/services/chatService.js";

const PACIENTE = { id: 256, nome: "ANTONIO CARLOS DE CAMPOS", telefone: "5511999992384", etapa_atual: null };

// Primeira mensagem pelo WhatsApp (sem histórico em conversas) e sem
// consulta futura — só muda se o telefone já teve consulta na clínica.
function mockarBanco(t, { jaTemConsulta }) {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("FROM pacientes")) return { rows: [PACIENTE] };
    if (sql.includes("FROM conversas")) return { rows: [] };
    if (sql.includes("FROM agendamentos_importados")) {
      if (sql.includes("SELECT 1")) return { rows: jaTemConsulta ? [{ "?column?": 1 }] : [] };
      return { rows: [] };
    }
    return { rows: [] };
  });
}

function textosEnviados(postMock) {
  return postMock.mock.calls.map(({ arguments: [, corpo] }) => corpo?.text).filter(Boolean);
}

async function avancarAteEnvioDaIA(t) {
  await t.mock.timers.tick(60_000);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await t.mock.timers.tick(2_000);
}

test("processarMensagemRecebida: quem já é paciente da clínica não recebe boas-vindas de paciente novo na primeira mensagem pelo WhatsApp (caso real: paciente avisando falta)", async (t) => {
  mockarBanco(t, { jaTemConsulta: true });
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const createMock = t.mock.method(openai.chat.completions, "create", async () => ({
    choices: [{ message: { content: "Anotado, Paulo! Já avisei a equipe.", tool_calls: undefined } }],
  }));
  const postMock = t.mock.method(evolutionApi, "post", async () => ({ data: { key: { id: "msg-1" } } }));

  await processarMensagemRecebida({
    telefone: PACIENTE.telefone,
    texto: "Boa tarde",
    nomeContato: "Paulo",
  });

  assert.equal(createMock.mock.calls.length, 1, "a IA responde direto, sem a mensagem fixa");
  const { messages } = createMock.mock.calls[0].arguments[0];
  assert.match(messages[0].content, /JÁ É PACIENTE da clínica/);

  await avancarAteEnvioDaIA(t);
  for (const texto of textosEnviados(postMock)) {
    assert.doesNotMatch(texto, /Seja muito bem-vindo/);
  }
});

test("processarMensagemRecebida: contato novo que só cumprimentou não recebe boas-vindas do bot (a saudação do WhatsApp Business já cobre) nem resposta da IA", async (t) => {
  mockarBanco(t, { jaTemConsulta: false });

  const createMock = t.mock.method(openai.chat.completions, "create", async () => {
    throw new Error("não deveria chamar a IA na mensagem de boas-vindas");
  });
  const postMock = t.mock.method(evolutionApi, "post", async () => ({ data: { key: { id: "msg-1" } } }));
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const promessa = processarMensagemRecebida({
    telefone: PACIENTE.telefone,
    texto: "Boa tarde",
    nomeContato: "Contato Novo",
  });
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
    await t.mock.timers.tick(5_000);
  }
  await promessa;

  assert.equal(createMock.mock.calls.length, 0);
  assert.equal(textosEnviados(postMock).length, 0);
});

test("processarMensagemRecebida: contato novo que já chega com uma pergunta recebe resposta da IA, não o texto fixo de boas-vindas (caso real: 'vocês têm fisioterapeuta que atende em casa?')", async (t) => {
  mockarBanco(t, { jaTemConsulta: false });
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const createMock = t.mock.method(openai.chat.completions, "create", async () => ({
    choices: [{ message: { content: "Olá, seja bem-vinda à Clínica Exemplo! Sim, fazemos atendimento domiciliar.", tool_calls: undefined } }],
  }));
  const postMock = t.mock.method(evolutionApi, "post", async () => ({ data: { key: { id: "msg-1" } } }));

  await processarMensagemRecebida({
    telefone: PACIENTE.telefone,
    texto: "Boa tarde. Fiz cirurgia de prótese de joelho há 5 dias. Vcs têm fisioterapeuta que atende em casa?",
    nomeContato: "Luiza",
  });

  assert.equal(createMock.mock.calls.length, 1, "a IA responde a pergunta");
  const { messages } = createMock.mock.calls[0].arguments[0];
  assert.match(messages[0].content, /responda DIRETO o que ele perguntou/);

  await avancarAteEnvioDaIA(t);
  for (const texto of textosEnviados(postMock)) {
    assert.doesNotMatch(texto, /Seja muito bem-vindo/);
  }
});
