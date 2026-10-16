import "./setupEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { openai } from "../src/config/openai.js";
import { evolutionApi } from "../src/config/evolutionApi.js";
import { processarMensagemRecebida, PAUSADO_ATENDIMENTO_HUMANO } from "../src/services/chatService.js";

const PACIENTE = { id: 42, nome: "Paciente Teste", telefone: "5511988887777", etapa_atual: null };

function mockarBancoPadrao(t) {
  const insercoesConversa = [];
  t.mock.method(pool, "query", async (sql, params) => {
    if (sql.includes("FROM pacientes")) return { rows: [PACIENTE] };
    if (sql.includes("INSERT INTO conversas")) {
      insercoesConversa.push(params);
      return { rows: [] };
    }
    if (sql.includes("FROM conversas")) {
      return {
        rows: [{ mensagem: "Oi", remetente: "paciente", timestamp: new Date().toISOString() }],
      };
    }
    if (sql.includes("FROM agendamentos_importados")) return { rows: [] };
    return { rows: [] };
  });
  return insercoesConversa;
}

test("processarMensagemRecebida registra a resposta da IA no histórico na hora, mas só manda pelo WhatsApp depois de 60s", async (t) => {
  const insercoesConversa = mockarBancoPadrao(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });

  t.mock.method(openai.chat.completions, "create", async () => ({
    choices: [{ message: { content: "Pode sim! Temos vaga na quinta às 09h.", tool_calls: undefined } }],
  }));
  const postMock = t.mock.method(evolutionApi, "post", async () => ({ data: { key: { id: "msg-1" } } }));

  await processarMensagemRecebida({
    telefone: "5511988887777",
    texto: "tem vaga na quinta de manhã?",
    nomeContato: "Paciente Teste",
  });

  // A resposta já entra no histórico imediatamente (pro contexto de
  // mensagens seguintes do paciente continuar coerente) mesmo sem ter sido
  // enviada ainda de verdade pelo WhatsApp.
  assert.equal(insercoesConversa.length, 2, "deveria ter registrado a mensagem do paciente + a resposta do bot");
  assert.equal(insercoesConversa[1][1], "Pode sim! Temos vaga na quinta às 09h.");

  assert.equal(postMock.mock.calls.length, 0, "não pode ter mandado a mensagem ainda, antes dos 60s");

  await t.mock.timers.tick(59_000);
  assert.equal(postMock.mock.calls.length, 0, "ainda não completou 60s");

  await t.mock.timers.tick(1_000);
  // O disparo do timer de 60s encadeia dois awaits (resolverJid, depois a
  // presence) antes de qualquer novo timer — dá espaço pras microtasks
  // andarem antes de checar quantas chamadas já saíram.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  // Antes de chamar enviarMensagem, o setTimeout agora reconfere o
  // etapa_atual do paciente (buscarPacientePorId) — mais uma volta de
  // microtask antes da cadeia de resolverJid/presence começar.
  await Promise.resolve();
  // Aos 60s, enviarMensagem checa o JID e manda a presence "composing" — o
  // texto de verdade só sai depois de mais um instante (DELAY_DIGITANDO_MS).
  assert.equal(postMock.mock.calls.length, 2, "aos 60s, só a checagem de JID + a presence 'composing' deveriam ter saído ainda");

  await t.mock.timers.tick(2_000);
  assert.equal(postMock.mock.calls.length, 3, "depois de 60s + o instante de 'digitando', a mensagem precisa ter sido enviada");
  assert.equal(postMock.mock.calls[2].arguments[1].text, "Pode sim! Temos vaga na quinta às 09h.");
});

test("processarMensagemRecebida não manda a resposta atrasada se a equipe pausou o atendimento manualmente nesse meio-tempo", async (t) => {
  const pacienteMutavel = { ...PACIENTE };
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("FROM pacientes")) return { rows: [pacienteMutavel] };
    if (sql.includes("INSERT INTO conversas")) return { rows: [] };
    if (sql.includes("FROM conversas")) {
      return {
        rows: [{ mensagem: "Oi", remetente: "paciente", timestamp: new Date().toISOString() }],
      };
    }
    if (sql.includes("FROM agendamentos_importados")) return { rows: [] };
    return { rows: [] };
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });

  t.mock.method(openai.chat.completions, "create", async () => ({
    choices: [{ message: { content: "Pode sim! Temos vaga na quinta às 09h.", tool_calls: undefined } }],
  }));
  const postMock = t.mock.method(evolutionApi, "post", async () => ({ data: { key: { id: "msg-1" } } }));

  await processarMensagemRecebida({
    telefone: "5511988887777",
    texto: "tem vaga na quinta de manhã?",
    nomeContato: "Paciente Teste",
  });

  // Simula a equipe respondendo manualmente pelo WhatsApp enquanto a
  // resposta da IA ainda está nos 60s de espera antes do envio real (caso
  // real: um paciente, 23/09/2026 — a IA atropelou a equipe que já tinha
  // respondido). webhookController.js marcaria isso via atualizarEtapaPaciente.
  pacienteMutavel.etapa_atual = PAUSADO_ATENDIMENTO_HUMANO;

  await t.mock.timers.tick(60_000);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await t.mock.timers.tick(2_000);

  assert.equal(
    postMock.mock.calls.length,
    0,
    "a resposta atrasada da IA não pode ser enviada depois que a equipe assumiu manualmente"
  );
});

test("resposta que acompanha um encaminhamento sai sem os 60s de atraso, pra não chegar por cima da recepção", async (t) => {
  mockarBancoPadrao(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let chamada = 0;
  t.mock.method(openai.chat.completions, "create", async () => {
    chamada++;
    if (chamada === 1) {
      return { choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "encaminhar_humano", arguments: JSON.stringify({ motivo: "remarcar", categoria: "agendamento_fisioterapia" }) } }] } }] };
    }
    return { choices: [{ message: { content: "Anotado! Já avisei a equipe.", tool_calls: undefined } }] };
  });
  const postMock = t.mock.method(evolutionApi, "post", async () => ({ data: { key: { id: "msg-1" } } }));

  const processando = processarMensagemRecebida({ telefone: "5511988887777", texto: "Queria mudar meu horário de amanhã", nomeContato: "Paciente Teste" });
  // Bem menos que os 60s: só o tempo dos timers internos do envio (presence).
  for (let ms = 0; ms < 10_000; ms += 500) {
    await t.mock.timers.tick(500);
    for (let i = 0; i < 20; i++) await Promise.resolve();
  }
  await processando;

  const enviosAoPaciente = postMock.mock.calls.filter((c) => JSON.stringify(c.arguments).includes("Anotado! Já avisei a equipe."));
  assert.equal(enviosAoPaciente.length, 1);
});
