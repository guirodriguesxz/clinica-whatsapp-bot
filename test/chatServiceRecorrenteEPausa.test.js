import "./setupEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import dayjs from "../src/utils/dayjs.js";
import { pool } from "../src/db/pool.js";
import { openai } from "../src/config/openai.js";
import { existeMensagemPacienteApos } from "../src/models/conversaModel.js";
import { functionHandlers } from "../src/functions/index.js";
import {
  processarMensagemRecebida,
  precisaRefazerRespostaRecorrente,
  AVISO_PACIENTE_RECORRENTE,
  respostaVazaValores,
  ehSaudacaoSimples,
  AVISO_SEM_VALORES,
  PAUSADO_ATENDIMENTO_HUMANO,
} from "../src/services/chatService.js";

function mockarBanco(t, { paciente, conversas }) {
  const inserts = [];
  t.mock.method(pool, "query", async (sql, params) => {
    if (sql.includes("FROM pacientes")) return { rows: [paciente] };
    if (sql.includes("INSERT INTO conversas")) {
      inserts.push(params);
      return { rows: [] };
    }
    if (sql.includes("remetente = 'equipe'")) {
      const daEquipe = conversas.filter((c) => c.remetente === "equipe");
      return { rows: daEquipe.slice(-1) };
    }
    if (sql.includes("FROM conversas")) {
      // buscarHistoricoRecente: DESC + LIMIT, depois reverse.
      const limite = params[1] ?? conversas.length;
      return { rows: conversas.slice(-limite).reverse() };
    }
    return { rows: [] };
  });
  return inserts;
}

const mensagem = (remetente, texto, horasAtras) => ({
  remetente,
  mensagem: texto,
  timestamp: dayjs().subtract(horasAtras, "hour").toISOString(),
});

test("precisaRefazerRespostaRecorrente: paciente da casa perguntado do tipo ou da idade", () => {
  const base = { recorrente: true, functionsChamadas: [] };
  assert.equal(precisaRefazerRespostaRecorrente({ ...base, textoResposta: "Você gostaria de agendar Fisioterapia ou Psicologia?" }), true);
  assert.equal(precisaRefazerRespostaRecorrente({ ...base, textoResposta: "Qual a sua idade, por favor?" }), true);
  // Pedido pra outra pessoa: perguntar nome e idade dela é o certo.
  assert.equal(precisaRefazerRespostaRecorrente({ ...base, textoResposta: "Qual o nome completo e a idade dele?" }), false);
  // "disponibilidade" não é "idade".
  assert.equal(precisaRefazerRespostaRecorrente({ ...base, textoResposta: "A equipe confirma a disponibilidade." }), false);
  assert.equal(precisaRefazerRespostaRecorrente({ ...base, recorrente: false, textoResposta: "Fisioterapia ou Psicologia?" }), false);
  assert.equal(
    precisaRefazerRespostaRecorrente({ ...base, functionsChamadas: ["encaminhar_humano"], textoResposta: "Encaminhei. Fisioterapia ou Psicologia?" }),
    false
  );
});

test("paciente recorrente perguntado do tipo: o código pede a resposta de novo com o aviso de correção (caso Bia, 2026-10-05)", async (t) => {
  mockarBanco(t, {
    paciente: { id: 298, nome: "Paciente Exemplo", telefone: "5511900007537", etapa_atual: null },
    conversas: [mensagem("paciente", "Obrigada", 50), mensagem("equipe", "Até amanhã!", 50)],
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const respostas = [
    "Só um momento, você gostaria de agendar Fisioterapia ou Psicologia?",
    "Encaminhei seu pedido de amanhã às 9h pra equipe; eles confirmam com você.",
  ];
  const createMock = t.mock.method(openai.chat.completions, "create", async () => ({
    choices: [{ message: { content: respostas.shift(), tool_calls: undefined } }],
  }));

  await processarMensagemRecebida({ telefone: "5511900007537", texto: "Podemos agendar amanhã às 9h?", nomeContato: "Paciente Exemplo" });

  assert.equal(createMock.mock.calls.length, 2);
  const segundoPrompt = createMock.mock.calls[1].arguments[0].messages[0].content;
  assert.ok(segundoPrompt.endsWith(AVISO_PACIENTE_RECORRENTE));
});

test("paciente respondendo a uma pergunta da equipe continua com a equipe, mesmo depois de 2h (caso real, 2026-10-05)", async (t) => {
  const inserts = mockarBanco(t, {
    paciente: { id: 453, nome: "Helena", telefone: "5511900006767", etapa_atual: PAUSADO_ATENDIMENTO_HUMANO },
    conversas: [mensagem("equipe", "Olá bom dia, tudo bem?", 3), mensagem("equipe", "Será pelo convenio ou particular?", 3)],
  });
  const createMock = t.mock.method(openai.chat.completions, "create", async () => ({
    choices: [{ message: { content: "não deveria ser chamado", tool_calls: undefined } }],
  }));

  await processarMensagemRecebida({ telefone: "5511900006767", texto: "Bom dia, seria convênio Aurora Saúde", nomeContato: "Helena" });

  assert.equal(createMock.mock.calls.length, 0, "o bot não pode responder no lugar da equipe");
  assert.equal(inserts.length, 1, "só a mensagem da paciente é registrada");
});

test("pausa de 2h sem pergunta pendente da equipe expira e a IA retoma", async (t) => {
  mockarBanco(t, {
    paciente: { id: 34, nome: "Pedro", telefone: "5511900000360", etapa_atual: PAUSADO_ATENDIMENTO_HUMANO },
    conversas: [mensagem("equipe", "Bom dia!", 3)],
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const createMock = t.mock.method(openai.chat.completions, "create", async () => ({
    choices: [{ message: { content: "Oi! Como posso ajudar?", tool_calls: undefined } }],
  }));

  await processarMensagemRecebida({ telefone: "5511900000360", texto: "Tem horário amanhã?", nomeContato: "Pedro" });

  assert.equal(createMock.mock.calls.length, 1);
});


test("respostaVazaValores: pega valor em R$ e ignora texto sem valor", () => {
  assert.equal(respostaVazaValores("Sessão avulsa: a partir de R$ 70,00"), true);
  assert.equal(respostaVazaValores("pacote por R$600"), true);
  assert.equal(respostaVazaValores("A equipe te passa os valores."), false);
});

test("resposta com valor em R$ é refeita uma vez com o aviso e a segunda, sem valor, é a enviada (caso Everton, 2026-10-06)", async (t) => {
  mockarBanco(t, {
    paciente: { id: 7, telefone: "5511900007538", nome: "Everton", etapa_atendimento: "inicio" },
    conversas: [mensagem("paciente", "Obrigado", 50), mensagem("equipe", "Até amanhã!", 50)],
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const respostas = [
    "Sessão avulsa a partir de R$ 70,00 e pacote de R$ 600,00.",
    "Anotado! A equipe te passa os detalhes por aqui.",
  ];
  const createMock = t.mock.method(openai.chat.completions, "create", async () => ({
    choices: [{ message: { content: respostas.shift(), tool_calls: undefined } }],
  }));

  await processarMensagemRecebida({ telefone: "5511900007538", texto: "Quanto custa?", nomeContato: "Everton" });

  assert.equal(createMock.mock.calls.length, 2);
  const segundoPrompt = createMock.mock.calls[1].arguments[0].messages[0].content;
  assert.ok(segundoPrompt.endsWith(AVISO_SEM_VALORES));
});

test("se o valor em R$ vazar de novo, o código encaminha pra equipe e envia texto fixo", async (t) => {
  const inserts = mockarBanco(t, {
    paciente: { id: 8, telefone: "5511900007539", nome: "Everton", etapa_atendimento: "inicio" },
    conversas: [mensagem("paciente", "Obrigado", 50), mensagem("equipe", "Até amanhã!", 50)],
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(openai.chat.completions, "create", async () => ({
    choices: [{ message: { content: "Fica R$ 70,00 a sessão.", tool_calls: undefined } }],
  }));
  const encaminhar = t.mock.method(functionHandlers, "encaminhar_humano", async () => ({ encaminhado: true }));

  await processarMensagemRecebida({ telefone: "5511900007539", texto: "Quanto custa?", nomeContato: "Everton" });

  assert.equal(encaminhar.mock.calls.length, 1);
  const textos = inserts.map((p) => String(p[1] ?? p));
  assert.ok(textos.some((x) => x.includes("Já avisei a equipe")));
  assert.ok(!textos.some((x) => x.includes("R$")));
});

test("ehSaudacaoSimples: saudação solta sim, pedido de verdade não", () => {
  for (const t of ["Oiee", "boa tarde", "td bem?", "Bom dia, tudo bem?", "Olá!", "Tudo na paz de Deus???"]) {
    assert.equal(ehSaudacaoSimples(t), true, t);
  }
  for (const t of ["Bom dia, queria agendar", "hoje tive um imprevisto, não vou conseguir ir", "Qual o endereço?", "", "ok"]) {
    assert.equal(ehSaudacaoSimples(t), false, t);
  }
});

test("existeMensagemPacienteApos: consulta mensagens do paciente com id maior", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [{ "?column?": 1 }] };
  });
  assert.equal(await existeMensagemPacienteApos(5, 100), true);
  assert.deepEqual(chamadas[0].params, [5, 100]);
  assert.match(chamadas[0].sql, /remetente = 'paciente' AND id > \$2/);
});
