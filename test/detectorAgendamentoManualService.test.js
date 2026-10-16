import "./setupEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { openai } from "../src/config/openai.js";
import { detectarAgendamentoCombinado } from "../src/services/detectorAgendamentoManualService.js";

const CONTEXTO = { historico: [], dataAtual: "2026-09-10", diaSemanaAtual: "quinta-feira" };

function mockRespostaIA(t, args) {
  t.mock.method(openai.chat.completions, "create", async () => ({
    choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(args) } }] } }],
  }));
}

test("detectarAgendamentoCombinado: acao 'criar' com data/hora retorna os dados pra criação", async (t) => {
  mockRespostaIA(t, { acao: "criar", data: "2026-09-15", hora: "09:00", tipo_atendimento: "fisioterapia" });

  const resultado = await detectarAgendamentoCombinado(CONTEXTO);

  assert.deepEqual(resultado, {
    acao: "criar",
    data: "2026-09-15",
    hora: "09:00",
    tipoAtendimento: "fisioterapia",
  });
});

test("detectarAgendamentoCombinado: acao 'cancelar' não exige data/hora", async (t) => {
  mockRespostaIA(t, { acao: "cancelar" });

  const resultado = await detectarAgendamentoCombinado(CONTEXTO);

  assert.deepEqual(resultado, { acao: "cancelar" });
});

test("detectarAgendamentoCombinado: acao 'remarcar' retorna a nova data/hora", async (t) => {
  mockRespostaIA(t, { acao: "remarcar", data: "2026-09-22", hora: "14:00" });

  const resultado = await detectarAgendamentoCombinado(CONTEXTO);

  assert.deepEqual(resultado, {
    acao: "remarcar",
    data: "2026-09-22",
    hora: "14:00",
    tipoAtendimento: "fisioterapia",
  });
});

test("detectarAgendamentoCombinado: acao 'remarcar' sem data/hora degrada pra 'nenhuma' (conservador)", async (t) => {
  mockRespostaIA(t, { acao: "remarcar" });

  const resultado = await detectarAgendamentoCombinado(CONTEXTO);

  assert.deepEqual(resultado, { acao: "nenhuma" });
});

test("detectarAgendamentoCombinado: acao 'criar' com hora '00:00' degrada pra 'nenhuma' (regressão real: agendamento criado com hora zerada/sem sentido)", async (t) => {
  mockRespostaIA(t, { acao: "criar", data: "2026-09-22", hora: "00:00", tipo_atendimento: "fisioterapia" });

  const resultado = await detectarAgendamentoCombinado(CONTEXTO);

  assert.deepEqual(resultado, { acao: "nenhuma" });
});

test("detectarAgendamentoCombinado: acao 'remarcar' com hora '00:00' degrada pra 'nenhuma'", async (t) => {
  mockRespostaIA(t, { acao: "remarcar", data: "2026-09-22", hora: "00:00" });

  const resultado = await detectarAgendamentoCombinado(CONTEXTO);

  assert.deepEqual(resultado, { acao: "nenhuma" });
});

test("detectarAgendamentoCombinado: acao 'criar' com hora em formato inválido degrada pra 'nenhuma'", async (t) => {
  mockRespostaIA(t, { acao: "criar", data: "2026-09-22", hora: "9h", tipo_atendimento: "fisioterapia" });

  const resultado = await detectarAgendamentoCombinado(CONTEXTO);

  assert.deepEqual(resultado, { acao: "nenhuma" });
});

test("detectarAgendamentoCombinado: acao 'criar' com data em formato inválido degrada pra 'nenhuma'", async (t) => {
  mockRespostaIA(t, { acao: "criar", data: "22/09/2026", hora: "09:00", tipo_atendimento: "fisioterapia" });

  const resultado = await detectarAgendamentoCombinado(CONTEXTO);

  assert.deepEqual(resultado, { acao: "nenhuma" });
});

test("detectarAgendamentoCombinado: acao 'nenhuma' quando nada ficou confirmado", async (t) => {
  mockRespostaIA(t, { acao: "nenhuma" });

  const resultado = await detectarAgendamentoCombinado(CONTEXTO);

  assert.deepEqual(resultado, { acao: "nenhuma" });
});

test("detectarAgendamentoCombinado: falha na chamada da IA degrada pra 'nenhuma'", async (t) => {
  t.mock.method(openai.chat.completions, "create", async () => {
    throw new Error("timeout");
  });

  const resultado = await detectarAgendamentoCombinado(CONTEXTO);

  assert.deepEqual(resultado, { acao: "nenhuma" });
});

test("detectarAgendamentoCombinado: captura o nome do paciente quando a equipe o escreve na conversa", async (t) => {
  mockRespostaIA(t, {
    acao: "criar",
    data: "2026-09-22",
    hora: "15:00",
    nome_paciente: "  ANA PAULA EXEMPLO  ",
  });

  const resultado = await detectarAgendamentoCombinado(CONTEXTO);

  assert.equal(resultado.nomePaciente, "ANA PAULA EXEMPLO");
});

test("detectarAgendamentoCombinado: sem nome_paciente, não inventa a chave nomePaciente", async (t) => {
  mockRespostaIA(t, { acao: "criar", data: "2026-09-22", hora: "15:00" });

  const resultado = await detectarAgendamentoCombinado(CONTEXTO);

  assert.equal("nomePaciente" in resultado, false);
});

test("detectarAgendamentoCombinado: instrui o modelo a aceitar confirmação da equipe sobre agendamento feito fora do WhatsApp (regressão real: Dandara marcou por telefone, a equipe confirmou por escrito e a consulta nunca entrou na agenda)", async (t) => {
  let mensagens = null;
  t.mock.method(openai.chat.completions, "create", async (params) => {
    mensagens = params.messages;
    return { choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({ acao: "nenhuma" }) } }] } }] };
  });

  await detectarAgendamentoCombinado(CONTEXTO);

  const instrucoes = mensagens.find((m) => m.role === "system").content;
  assert.match(instrucoes, /EXCEÇÃO ao "tem que ter sido combinado nesta troca"/);
  assert.match(instrucoes, /quando a EQUIPE afirma que o paciente JÁ ESTÁ agendado/);
  assert.match(instrucoes, /Só não conte se a data já passou/);
});

test("detectarAgendamentoCombinado: descarta detecção com data no passado (o modelo ignora essa regra quando ela fica só nas instruções)", async (t) => {
  mockRespostaIA(t, { acao: "criar", data: "2026-09-05", hora: "14:00", tipo_atendimento: "fisioterapia" });

  const resultado = await detectarAgendamentoCombinado(CONTEXTO);

  assert.deepEqual(resultado, { acao: "nenhuma" });
});

test("detectarAgendamentoCombinado: aceita detecção para o próprio dia de hoje", async (t) => {
  mockRespostaIA(t, { acao: "criar", data: "2026-09-10", hora: "14:00", tipo_atendimento: "fisioterapia" });

  const resultado = await detectarAgendamentoCombinado(CONTEXTO);

  assert.equal(resultado.acao, "criar");
  assert.equal(resultado.data, "2026-09-10");
});
