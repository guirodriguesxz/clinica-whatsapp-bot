import "./setupEnv.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import dayjs from "../src/utils/dayjs.js";
import { pool } from "../src/db/pool.js";
import { evolutionApi } from "../src/config/evolutionApi.js";
import {
  ehMensagemDeEncerramento,
  filtrarSemResposta,
  montarResumoSemResposta,
  enviarResumoSemResposta,
} from "../src/services/semRespostaService.js";

const AGORA = dayjs.tz("2026-10-07T09:00:00", "America/Sao_Paulo");

const linha = (extra) => ({
  paciente_id: 1,
  nome: "roberta silva",
  telefone: "5511999990016",
  remetente: "paciente",
  mensagem: "Gostaria de saber se atendem convênio Plena Saúde",
  timestamp: AGORA.subtract(12, "hour").toISOString(),
  ...extra,
});

test("ehMensagemDeEncerramento: agradecimento, ok, saudação e emoji não pedem resposta; pergunta sim", () => {
  for (const t of ["Obrigada", "ok", "Muito obrigado!!", "Igualmente 🙏", "🙏🏻🙏🏻", "Bom dia", "Valeu, até amanhã", "Obrigadaaa 🙏🏽", "Gratidão", "Vocês também.", "Combinado! Grata !", "Até daqui a pouco Obrigada", "Obrigada pelo carinho!"]) {
    assert.equal(ehMensagemDeEncerramento(t), true, t);
  }
  for (const t of ["Qual o endereço?", "Vocês atendem Plena Saúde?", "Não", "Hoje não vou conseguir ir", "Obrigada, mas não vou conseguir ir", "Bom dia, tenho uma dúvida", "Tá certo, e o horário?"]) {
    assert.equal(ehMensagemDeEncerramento(t), false, t);
  }
});

test("filtrarSemResposta: só última mensagem do paciente, com 2h+, que não seja encerramento", () => {
  const itens = filtrarSemResposta(
    [
      linha({ paciente_id: 1 }),
      linha({ paciente_id: 2, remetente: "equipe" }),
      linha({ paciente_id: 3, timestamp: AGORA.subtract(30, "minute").toISOString() }),
      linha({ paciente_id: 4, mensagem: "Obrigada!" }),
      linha({ paciente_id: 5, mensagem: "[Paciente enviou uma foto (pode ser pedido médico)]" }),
    ],
    AGORA
  );
  assert.deepEqual(itens.map((i) => i.paciente_id).sort(), [1, 5]);
});

test("montarResumoSemResposta: lista nome, telefone, tempo e trecho; vazio devolve null", () => {
  assert.equal(montarResumoSemResposta([]), null);
  const [item] = filtrarSemResposta([linha({})], AGORA);
  const texto = montarResumoSemResposta([item]);
  assert.match(texto, /1 paciente aguardando resposta da equipe/);
  assert.match(texto, /Roberta Silva/);
  assert.match(texto, /há 12h/);
  assert.match(texto, /Plena Saúde/);
});

test("enviarResumoSemResposta: em dia útil com paciente esperando, manda o resumo pro telefone da recepção", async (t) => {
  process.env.ATENDENTE_HUMANO_TELEFONE = "5511999999999";
  t.mock.method(pool, "query", async () => ({ rows: [linha({})] }));
  const postMock = t.mock.method(evolutionApi, "post", async () => ({ data: {} }));

  await enviarResumoSemResposta(AGORA);

  assert.ok(postMock.mock.calls.some((c) => /aguardando resposta da equipe/.test(c.arguments[1]?.text || "")));
});

test("enviarResumoSemResposta: no fim de semana não manda nada", async (t) => {
  process.env.ATENDENTE_HUMANO_TELEFONE = "5511999999999";
  const queryMock = t.mock.method(pool, "query", async () => ({ rows: [linha({})] }));
  const postMock = t.mock.method(evolutionApi, "post", async () => ({ data: {} }));

  await enviarResumoSemResposta(dayjs.tz("2026-10-10T09:00:00", "America/Sao_Paulo")); // sábado

  assert.equal(queryMock.mock.calls.length, 0);
  assert.equal(postMock.mock.calls.length, 0);
});
