// test/encaminharHumano.test.js
import "./setupEnv.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { evolutionApi } from "../src/config/evolutionApi.js";
import {
  encaminharHumano,
  limparEncaminhamentosRecentes,
} from "../src/functions/encaminharHumano.js";

const CONTEXT = { telefone: "5511988887777", nomeContato: "Paciente Teste" };
const SEM_FOTO_PENDENTE = { resolverPaciente: async () => ({ id: 1 }), buscarFoto: async () => null };

beforeEach(() => limparEncaminhamentosRecentes());

test("encaminharHumano retorna encaminhado:true quando a notificação por WhatsApp é enviada", async (t) => {
  t.mock.method(evolutionApi, "post", async () => ({ data: {} }));

  const resultado = await encaminharHumano({ motivo: "teste" }, CONTEXT, SEM_FOTO_PENDENTE);

  assert.deepEqual(resultado, { encaminhado: true });
});

test("encaminharHumano NÃO lança exceção quando o envio por WhatsApp falha (ex: Evolution API fora do ar) — degrada para encaminhado:false", async (t) => {
  t.mock.method(evolutionApi, "post", async () => {
    throw new Error("connect ECONNREFUSED 127.0.0.1:8080");
  });

  const resultado = await encaminharHumano({ motivo: "teste" }, CONTEXT, SEM_FOTO_PENDENTE);

  assert.equal(resultado.encaminhado, false);
  assert.match(resultado.instrucao, /ligar diretamente/i);
});

test("encaminharHumano prefixa a mensagem com a tag da categoria, para a recepção triar de relance", async (t) => {
  const post = t.mock.method(evolutionApi, "post", async () => ({ data: {} }));

  await encaminharHumano({ motivo: "teste", categoria: "psicologia" }, CONTEXT, SEM_FOTO_PENDENTE);

  // enviarMensagem checa o JID (índice 0) e manda a presence "composing" (índice 1) antes do texto.
  const texto = post.mock.calls[2].arguments[1].text;
  assert.match(texto, /^🧠 PSICOLOGIA/);
});

test("encaminharHumano cai na tag 'outro' quando a categoria não é reconhecida ou não vem preenchida", async (t) => {
  const post = t.mock.method(evolutionApi, "post", async () => ({ data: {} }));

  await encaminharHumano({ motivo: "teste" }, CONTEXT, SEM_FOTO_PENDENTE);

  const texto = post.mock.calls[2].arguments[1].text;
  assert.match(texto, /^❓ OUTRO/);
});

test("encaminharHumano: com foto pendente, repassa ela sozinha e apaga a pendência", async (t) => {
  t.mock.method(evolutionApi, "post", async () => ({ data: {} }));
  const chamadas = [];

  const resultado = await encaminharHumano({ motivo: "teste", categoria: "psicologia" }, CONTEXT, {
    resolverPaciente: async () => ({ id: 9 }),
    buscarFoto: async (pacienteId) => (
      chamadas.push(["buscarFoto", pacienteId]),
      { nome: "Ana", telefone: "5511988887777", base64: "abc", mimetype: "image/jpeg", legenda_paciente: null }
    ),
    apagarFoto: async (pacienteId) => chamadas.push(["apagarFoto", pacienteId]),
    enviarFotoAvulsa: async (args) => (chamadas.push(["enviarFotoAvulsa", args]), true),
  });

  assert.equal(resultado.encaminhado, true);
  assert.deepEqual(chamadas.map((c) => c[0]), ["buscarFoto", "enviarFotoAvulsa", "apagarFoto"]);
  assert.equal(chamadas[0][1], 9);
  assert.equal(chamadas[2][1], 9);
});

test("encaminharHumano: sem foto pendente, não tenta enviar nem apagar nada", async (t) => {
  t.mock.method(evolutionApi, "post", async () => ({ data: {} }));
  let tentouEnviarFoto = false;

  await encaminharHumano({ motivo: "teste" }, CONTEXT, {
    resolverPaciente: async () => ({ id: 9 }),
    buscarFoto: async () => null,
    enviarFotoAvulsa: async () => {
      tentouEnviarFoto = true;
      return true;
    },
  });

  assert.equal(tentouEnviarFoto, false);
});

test("encaminharHumano: falha ao repassar foto pendente não impede o retorno encaminhado:true (notificação principal já foi enviada)", async (t) => {
  t.mock.method(evolutionApi, "post", async () => ({ data: {} }));

  const resultado = await encaminharHumano({ motivo: "teste" }, CONTEXT, {
    resolverPaciente: async () => {
      throw new Error("banco caiu");
    },
  });

  assert.equal(resultado.encaminhado, true);
});

test("encaminharHumano: categoria 'outro' registra a pergunta como sugestão de conhecimento", async (t) => {
  t.mock.method(evolutionApi, "post", async () => ({ data: {} }));
  const chamadas = [];

  await encaminharHumano({ motivo: "Vocês atendem pelo plano Y?", categoria: "outro" }, CONTEXT, {
    ...SEM_FOTO_PENDENTE,
    criarSugestao: async (args) => chamadas.push(args),
  });

  assert.deepEqual(chamadas, [
    { pergunta: "Vocês atendem pelo plano Y?", telefone: CONTEXT.telefone, nome: CONTEXT.nomeContato },
  ]);
});

test("encaminharHumano prefixa a mensagem com a tag própria da categoria 'agendamento_fisioterapia' (não cai em ❓ OUTRO)", async (t) => {
  const post = t.mock.method(evolutionApi, "post", async () => ({ data: {} }));

  await encaminharHumano({ motivo: "teste", categoria: "agendamento_fisioterapia" }, CONTEXT, SEM_FOTO_PENDENTE);

  const texto = post.mock.calls[2].arguments[1].text;
  assert.match(texto, /^📅 AGENDAMENTO/);
});

test("encaminharHumano: categorias operacionais (psicologia/convenio/urgente/agendamento_fisioterapia) NÃO geram sugestão de conhecimento", async (t) => {
  t.mock.method(evolutionApi, "post", async () => ({ data: {} }));
  let chamou = false;

  for (const categoria of ["psicologia", "convenio", "urgente", "agendamento_fisioterapia"]) {
    await encaminharHumano({ motivo: "teste", categoria }, CONTEXT, {
      ...SEM_FOTO_PENDENTE,
      criarSugestao: async () => {
        chamou = true;
      },
    });
  }

  assert.equal(chamou, false);
});

test("encaminharHumano: falha ao registrar sugestão de conhecimento não impede o retorno encaminhado:true", async (t) => {
  t.mock.method(evolutionApi, "post", async () => ({ data: {} }));

  const resultado = await encaminharHumano({ motivo: "teste", categoria: "outro" }, CONTEXT, {
    ...SEM_FOTO_PENDENTE,
    criarSugestao: async () => {
      throw new Error("banco caiu");
    },
  });

  assert.equal(resultado.encaminhado, true);
});

test("encaminharHumano: envio da foto avulsa falhando não apaga a pendência", async (t) => {
  t.mock.method(evolutionApi, "post", async () => ({ data: {} }));
  let apagou = false;

  await encaminharHumano({ motivo: "teste" }, CONTEXT, {
    resolverPaciente: async () => ({ id: 9 }),
    buscarFoto: async () => ({
      nome: "Ana",
      telefone: "5511988887777",
      base64: "abc",
      mimetype: "image/jpeg",
      legenda_paciente: null,
    }),
    apagarFoto: async () => {
      apagou = true;
    },
    enviarFotoAvulsa: async () => false,
  });

  assert.equal(apagou, false);
});

test("encaminharHumano manda só um COMPLEMENTO, sem tag de categoria, quando o mesmo paciente já foi encaminhado há menos de 30 min", async (t) => {
  const post = t.mock.method(evolutionApi, "post", async () => ({ data: {} }));
  let agora = 1_000_000;
  const deps = { ...SEM_FOTO_PENDENTE, agora: () => agora };

  await encaminharHumano({ motivo: "não vem amanhã", categoria: "urgente" }, CONTEXT, deps);
  agora += 60 * 1000;
  await encaminharHumano({ motivo: "consulta com a Dra. Daine", categoria: "urgente" }, CONTEXT, deps);

  const textos = post.mock.calls.map((c) => c.arguments[1]?.text).filter(Boolean);
  assert.equal(textos.length, 2);
  assert.match(textos[0], /^⚠️ URGENTE/);
  assert.match(textos[1], /^➕ COMPLEMENTO/);
  assert.doesNotMatch(textos[1], /URGENTE/);
  assert.match(textos[1], /Dra\. Daine/);
});

test("encaminharHumano volta a mandar aviso completo depois de 30 min, e outro telefone nunca vira complemento", async (t) => {
  const post = t.mock.method(evolutionApi, "post", async () => ({ data: {} }));
  let agora = 1_000_000;
  const deps = { ...SEM_FOTO_PENDENTE, agora: () => agora };

  await encaminharHumano({ motivo: "a", categoria: "psicologia" }, CONTEXT, deps);
  await encaminharHumano({ motivo: "b", categoria: "psicologia" }, { telefone: "5511900000000", nomeContato: "Outro" }, deps);
  agora += 31 * 60 * 1000;
  await encaminharHumano({ motivo: "c", categoria: "psicologia" }, CONTEXT, deps);

  const textos = post.mock.calls.map((c) => c.arguments[1]?.text).filter(Boolean);
  assert.deepEqual(textos.map((x) => x.split("\n")[0]), ["🧠 PSICOLOGIA", "🧠 PSICOLOGIA", "🧠 PSICOLOGIA"]);
});

test("encaminharHumano não registra o complemento como sugestão de conhecimento", async (t) => {
  t.mock.method(evolutionApi, "post", async () => ({ data: {} }));
  const sugestoes = [];
  const deps = { ...SEM_FOTO_PENDENTE, criarSugestao: async (s) => sugestoes.push(s) };

  await encaminharHumano({ motivo: "dúvida", categoria: "outro" }, CONTEXT, deps);
  await encaminharHumano({ motivo: "mais detalhe", categoria: "outro" }, CONTEXT, deps);

  assert.equal(sugestoes.length, 1);
});
