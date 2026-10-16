import { test } from "node:test";
import assert from "node:assert/strict";
import { ehMensagemSoConfirmacao, ehSoSaudacao } from "../src/utils/confirmacao.js";

const CASOS_VERDADEIRO = [
  "👍",
  "Ok",
  "obrigado",
  "Confirmado",
  "Ok. Obrigada",
  "Bom dia ok confirmado",
  "Até lá!",
  "certo",
  "valeu",
  "blz",
  // Casos reais 2026-09-23: o bot respondia cada um desses com mais uma
  // mensagem ("De nada! Se precisar...", "😊"), emendando 3-4 respostas
  // seguidas numa conversa que já tinha terminado.
  "Agradeço",
  "Desculpa",
  "Igualmente",
  "Muitíssimo obrigada",
  "Grata! Ate mais tarde!",
  "Me perdoe",
  "Nossa desculpe",
  "Vc também",
];

const CASOS_FALSO = [
  "Bom dia",
  "Oi",
  "7h, certo?",
  "Pode reagendar para segunda feira então 🙏🏿🙏🏿",
  "Nao tenho dúvidas.",
  "Mantém a que ja esta agendada para amanhã",
  "Muito obrigado pela lembrança.",
  "Sim, como temos feito normalmente nas últimas sessões, certo?",
  "Entrarei de ferias em setembro.  Qdo voltar irei marcar mais consultas",
  "Ontem não consegui estar estava com muita dor no ombro preferi nao forçar",
  "Desculpa, posso remarcar para amanhã?",
  "Obrigada, tem horário amanhã?",
  "Agradeço, mas não vou conseguir ir hoje",
  "",
  null,
];

for (const mensagem of CASOS_VERDADEIRO) {
  test(`ehMensagemSoConfirmacao(${JSON.stringify(mensagem)}) é true`, () => {
    assert.equal(ehMensagemSoConfirmacao(mensagem), true);
  });
}

for (const mensagem of CASOS_FALSO) {
  test(`ehMensagemSoConfirmacao(${JSON.stringify(mensagem)}) é false`, () => {
    assert.equal(ehMensagemSoConfirmacao(mensagem), false);
  });
}

const SO_SAUDACAO = ["Boa tarde", "Olá, tudo bem?", "Oi 😊", "Oieeee", "Bom dia!", "Oi bom dia tudo bem?", "Tudo bem?"];
const COM_PERGUNTA_OU_PEDIDO = [
  "Vcs têm fisioterapeuta que atende em casa?",
  "Gostaria de agendar uma consulta com a fisio",
  "Boa Tarde! vc fazer fiseoterapia perineal?",
  "Bom dia eu esqueci o encaminhamento",
  "Olá, gostaria de informações",
  "👍",
  "",
];

for (const texto of SO_SAUDACAO) {
  test(`ehSoSaudacao(${JSON.stringify(texto)}) é true`, () => {
    assert.equal(ehSoSaudacao(texto), true);
  });
}

for (const texto of COM_PERGUNTA_OU_PEDIDO) {
  test(`ehSoSaudacao(${JSON.stringify(texto)}) é false`, () => {
    assert.equal(ehSoSaudacao(texto), false);
  });
}

test("'Tudo bem'/'tudo certo'/'perfeito' sem pergunta fecham a conversa; como pergunta ou junto de cumprimento, não", () => {
  for (const texto of ["Tudo bem", "tudo certo, obrigada", "Perfeito obrigada 🙏", "Fechado!"]) {
    assert.equal(ehMensagemSoConfirmacao(texto), true, texto);
  }
  for (const texto of ["Tudo bem?", "Oi, tudo bem", "Boa tarde tudo bem", "Tudo bem, posso ir às 10h?"]) {
    assert.equal(ehMensagemSoConfirmacao(texto), false, texto);
  }
});
