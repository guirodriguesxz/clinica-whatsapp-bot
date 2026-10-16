import "./setupEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { openai } from "../src/config/openai.js";
import { evolutionApi } from "../src/config/evolutionApi.js";
import { gerarResposta, extrairChamadaVazada } from "../src/services/aiService.js";
import { functionHandlers } from "../src/functions/index.js";

const CONTEXT = { telefone: "5511988887777", nomeContato: "Paciente Teste" };

function erroOpenAI(status, code) {
  return Object.assign(new Error(`erro simulado ${status}/${code}`), { status, code });
}

test("gerarResposta encaminha para atendimento humano quando a OpenAI está sem créditos (429 insufficient_quota), sem tentar de novo", async (t) => {
  const createMock = t.mock.method(openai.chat.completions, "create", async () => {
    throw erroOpenAI(429, "insufficient_quota");
  });
  const postMock = t.mock.method(evolutionApi, "post", async () => ({ data: {} }));

  const { textoResposta, functionsChamadas } = await gerarResposta({
    systemPrompt: "system",
    historico: [],
    mensagemUsuario: "quero marcar uma consulta",
    context: CONTEXT,
  });

  assert.deepEqual(functionsChamadas, ["encaminhar_humano"]);
  assert.match(textoResposta, /equipe/i);
  // Falta de crédito não é transitória — não faz sentido gastar tentativas de retry.
  assert.equal(createMock.mock.calls.length, 1);
  // Confirma que a equipe foi de fato notificada via WhatsApp (não só um texto genérico de erro).
  // enviarMensagem checa o JID, manda a presence "composing" e só então o texto: 3 chamadas.
  assert.equal(postMock.mock.calls.length, 3);
  assert.match(postMock.mock.calls[2].arguments[1].text, /créditos da OpenAI esgotados/);
});

test("gerarResposta encaminha para atendimento humano em 429 credit_balance_exhausted (código real observado em produção, diferente de insufficient_quota)", async (t) => {
  const createMock = t.mock.method(openai.chat.completions, "create", async () => {
    throw erroOpenAI(429, "credit_balance_exhausted");
  });
  const postMock = t.mock.method(evolutionApi, "post", async () => ({ data: {} }));

  const { functionsChamadas } = await gerarResposta({
    systemPrompt: "system",
    historico: [],
    mensagemUsuario: "quero marcar uma consulta",
    context: CONTEXT,
  });

  assert.deepEqual(functionsChamadas, ["encaminhar_humano"]);
  assert.equal(createMock.mock.calls.length, 1);
  // enviarMensagem checa o JID, manda a presence "composing" e só então o texto: 3 chamadas.
  assert.equal(postMock.mock.calls.length, 3);
});

test("gerarResposta tenta de novo em erro transitório (ex: rate limit comum) e usa a resposta se uma das tentativas seguintes funcionar", async (t) => {
  let chamadas = 0;
  t.mock.method(openai.chat.completions, "create", async () => {
    chamadas++;
    if (chamadas === 1) throw erroOpenAI(429, "rate_limit_exceeded");
    return { choices: [{ message: { content: "Consulta marcada!", tool_calls: undefined } }] };
  });
  const postMock = t.mock.method(evolutionApi, "post", async () => ({ data: {} }));

  const { textoResposta, functionsChamadas } = await gerarResposta({
    systemPrompt: "system",
    historico: [],
    mensagemUsuario: "quero marcar uma consulta",
    context: CONTEXT,
  });

  assert.equal(chamadas, 2);
  assert.equal(textoResposta, "Consulta marcada!");
  assert.deepEqual(functionsChamadas, []);
  assert.equal(postMock.mock.calls.length, 0);
});

test("gerarResposta esgota as tentativas em erro transitório persistente e propaga (sem encaminhar para humano)", async (t) => {
  const createMock = t.mock.method(openai.chat.completions, "create", async () => {
    throw erroOpenAI(429, "rate_limit_exceeded");
  });
  const postMock = t.mock.method(evolutionApi, "post", async () => ({ data: {} }));

  await assert.rejects(
    () =>
      gerarResposta({
        systemPrompt: "system",
        historico: [],
        mensagemUsuario: "quero marcar uma consulta",
        context: CONTEXT,
      }),
    /rate_limit_exceeded/
  );
  // 1 tentativa inicial + 2 retries = 3 chamadas.
  assert.equal(createMock.mock.calls.length, 3);
  assert.equal(postMock.mock.calls.length, 0);
});

test("gerarResposta avisa a equipe uma vez só mesmo se o modelo chamar encaminhar_humano duas vezes no mesmo turno (visto em teste real 2026-10-01)", async (t) => {
  let chamadas = 0;
  const encaminhar = (id) => ({
    id,
    type: "function",
    function: { name: "encaminhar_humano", arguments: JSON.stringify({ motivo: "remarcar", categoria: "outro" }) },
  });
  t.mock.method(openai.chat.completions, "create", async () => {
    chamadas++;
    if (chamadas === 1) return { choices: [{ message: { role: "assistant", content: null, tool_calls: [encaminhar("a")] } }] };
    if (chamadas === 2) return { choices: [{ message: { role: "assistant", content: null, tool_calls: [encaminhar("b")] } }] };
    return { choices: [{ message: { role: "assistant", content: "Anotado!" } }] };
  });
  const postMock = t.mock.method(evolutionApi, "post", async () => ({ data: {} }));

  const { textoResposta } = await gerarResposta({
    systemPrompt: "system",
    historico: [],
    mensagemUsuario: "preciso remarcar",
    context: CONTEXT,
  });

  assert.equal(textoResposta, "Anotado!");
  // enviarMensagem: checa o JID, presence "composing" e o texto — 3 chamadas por aviso.
  assert.equal(postMock.mock.calls.length, 3);
});

test("extrairChamadaVazada: acha o JSON de encaminhar_humano escrito como texto (caso paciente 461, 2026-10-07)", () => {
  const texto = 'Vou encaminhar sua solicitação. Um momento! \n{ "motivo": "Alterar as sessões para as 18h.", "categoria": "urgente" },';
  assert.deepEqual(extrairChamadaVazada(texto), {
    args: { motivo: "Alterar as sessões para as 18h.", categoria: "urgente" },
  });
  assert.deepEqual(extrairChamadaVazada('Oi { "motivo": quebrado }'), { args: null });
  assert.equal(extrairChamadaVazada("Anotado! Já avisei a equipe."), null);
  assert.equal(extrairChamadaVazada(""), null);
});

test("gerarResposta: chamada de encaminhar_humano vazada como texto é executada e o paciente não vê o JSON", async (t) => {
  t.mock.method(openai.chat.completions, "create", async () => ({
    choices: [
      {
        message: {
          content: 'Vou encaminhar sua solicitação. Um momento!\n{ "motivo": "Alterar as sessões para as 18h.", "categoria": "urgente" },',
        },
      },
    ],
  }));
  const encaminhar = t.mock.method(functionHandlers, "encaminhar_humano", async () => ({ encaminhado: true }));

  const { textoResposta, functionsChamadas } = await gerarResposta({
    systemPrompt: "x",
    historico: [],
    mensagemUsuario: "vc consegue alterar minhas próximas sessões pras 18h?",
    context: { telefone: "5511900000001", nomeContato: "Paciente", pacienteId: 1 },
  });

  assert.equal(encaminhar.mock.calls.length, 1);
  assert.equal(encaminhar.mock.calls[0].arguments[0].motivo, "Alterar as sessões para as 18h.");
  assert.deepEqual(functionsChamadas, ["encaminhar_humano"]);
  assert.ok(!textoResposta.includes("{") && !textoResposta.includes("motivo"));
  assert.match(textoResposta, /avisei a equipe/);
});
