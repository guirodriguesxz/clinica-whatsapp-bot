// test/systemPrompt.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt, dentroDoHorarioDeFuncionamento } from "../src/prompts/systemPrompt.js";
import dayjs from "../src/utils/dayjs.js";
import { CLINICA } from "../src/config/clinica.js";
import { ehFeriado } from "../src/utils/feriados.js";

// Mesmo padrão de test/calendarService.test.js: acha um dia útil real em vez
// de mockar ehFeriado, evitando acoplar o teste a uma data de feriado fixa.
function proximoDiaUtil(base = dayjs().tz(CLINICA.timezone).add(1, "day")) {
  let d = base;
  while (CLINICA.diasFechados.includes(d.day()) || ehFeriado(d)) d = d.add(1, "day");
  return d;
}

function proximoFimDeSemana(base = dayjs().tz(CLINICA.timezone).add(1, "day")) {
  let d = base;
  while (!CLINICA.diasFechados.includes(d.day())) d = d.add(1, "day");
  return d;
}

test("dentroDoHorarioDeFuncionamento: 13:39 de um dia útil comum está dentro do período da tarde (regressão do caso real de 2026-09-17)", () => {
  const agora = proximoDiaUtil().hour(13).minute(39).second(0).millisecond(0);
  assert.equal(dentroDoHorarioDeFuncionamento(agora), true);
});

test("dentroDoHorarioDeFuncionamento: dentro do período da manhã", () => {
  const agora = proximoDiaUtil().hour(7).minute(30).second(0).millisecond(0);
  assert.equal(dentroDoHorarioDeFuncionamento(agora), true);
});

test("dentroDoHorarioDeFuncionamento: no intervalo de almoço (entre os dois períodos) está dentro — recepção responde o WhatsApp no almoço", () => {
  const agora = proximoDiaUtil().hour(11).minute(59).second(0).millisecond(0);
  assert.equal(dentroDoHorarioDeFuncionamento(agora), true);
});

test("dentroDoHorarioDeFuncionamento: antes de abrir está fora", () => {
  const agora = proximoDiaUtil().hour(6).minute(0).second(0).millisecond(0);
  assert.equal(dentroDoHorarioDeFuncionamento(agora), false);
});

test("dentroDoHorarioDeFuncionamento: depois de fechar está fora", () => {
  const agora = proximoDiaUtil().hour(19).minute(0).second(0).millisecond(0);
  assert.equal(dentroDoHorarioDeFuncionamento(agora), false);
});

test("dentroDoHorarioDeFuncionamento: fim de semana está fora mesmo em horário válido", () => {
  const agora = proximoFimDeSemana().hour(13).minute(39).second(0).millisecond(0);
  assert.equal(dentroDoHorarioDeFuncionamento(agora), false);
});

test("buildSystemPrompt: injeta STATUS DO EXPEDIENTE AGORA já calculado, sem pedir pro modelo calcular", () => {
  const prompt = buildSystemPrompt({ nomeContato: "Teste" });
  const agora = dayjs().tz(CLINICA.timezone);
  const statusEsperado = dentroDoHorarioDeFuncionamento(agora) ? "ABERTO" : "FECHADO";

  assert.match(prompt, new RegExp(`STATUS DO EXPEDIENTE AGORA: ${statusEsperado}`));
  assert.match(prompt, /STATUS DO EXPEDIENTE AGORA \(acima, já calculado — nunca calcule você mesmo/);
  assert.doesNotMatch(prompt, /confira a DATA E HORA ATUAL \(acima\): se estiver fora do horário/);
});

test("buildSystemPrompt: instrui a IA a não repetir a frase de 'equipe já avisada' a cada detalhe complementar (regressão do caso real de 2026-09-17)", () => {
  const prompt = buildSystemPrompt({ nomeContato: "Teste" });

  assert.match(prompt, /reconhecimento CURTO DE VERDADE/);
  assert.match(prompt, /NUNCA reformule ou reexplique o status do encaminhamento de novo/);
});

test("buildSystemPrompt: instrui a IA a não calcular/opinar sobre dia da semana na Remarcação (regressão real: bot disse que 'amanhã' seria fim de semana quando era terça)", () => {
  const prompt = buildSystemPrompt({ nomeContato: "Teste" });

  assert.match(prompt, /NUNCA calcule ou opine sozinho em que dia da semana cai a nova data pedida/);
});

test("buildSystemPrompt: instrui a IA a pular nome/idade pra paciente recorrente pedindo sessão nova (regressão real: Bruna, paciente recorrente, teve que repetir nome/idade)", () => {
  const prompt = buildSystemPrompt({ nomeContato: "Teste" });

  assert.match(prompt, /pule os passos 1 e 2 inteiros e vá direto pro encaminhamento/);
  assert.match(prompt, /esqueceu o encaminhamento médico\/pedido\/documento — não reabra o cadastro do zero/);
});

test("buildSystemPrompt: abre exceção pra contato conhecido agendando pra outra pessoa (regressão real: número do Marcos agendou avaliação do pai, Jorge, e entrou com nome errado)", () => {
  const prompt = buildSystemPrompt({ nomeContato: "Teste" });

  assert.match(prompt, /EXCEÇÃO IMPORTANTE a esse "pule os passos 1 e 2"/);
  assert.match(prompt, /pergunte o nome completo e a idade de quem vai ser atendido/);
  assert.match(prompt, /Nunca presuma que o paciente é o dono do número/);
});

test("buildSystemPrompt: resposta curta não pode descartar dado que o paciente oferece (regressão real: bot disse que não era necessário repetir o nome completo e a consulta entrou com o apelido do contato)", () => {
  const prompt = buildSystemPrompt({ nomeContato: "Teste" });

  assert.match(prompt, /"resposta curta" NUNCA quer dizer descartar o que o paciente mandou/);
  assert.match(prompt, /Jamais diga a ele que o dado não é necessário/);
  assert.match(prompt, /repita esse dado, com todas as letras, no motivo do encaminhamento/);
});

test("buildSystemPrompt: proíbe o bot de dizer que agendou quando só encaminhou pra equipe (regressão real: paciente ficou achando que tinha horário garantido na quarta às 14h, sem agendamento nenhum)", () => {
  const prompt = buildSystemPrompt({ nomeContato: "Teste" });

  assert.match(prompt, /ENCAMINHAR NÃO É AGENDAR/);
  assert.match(prompt, /Está PROIBIDO dizer "agendei"/);
  assert.match(prompt, /mesmo que você complemente com "a equipe vai confirmar"/);
});

test("buildSystemPrompt: nunca nega ao paciente uma consulta que não encontrou e encaminha direto, sem pedir data/horário (regressão real 2026-09-22: agenda importada incompleta e pacientes com sessão marcada ouviram 'não encontrei nenhum agendamento', uma delas 6 vezes seguidas)", () => {
  const prompt = buildSystemPrompt({ nomeContato: "Teste" });

  assert.match(prompt, /você não tem acesso à agenda, então NUNCA diga ao paciente/);
  assert.match(prompt, /NUNCA diga ao paciente que não encontrou a consulta/);
  assert.match(prompt, /NÃO pergunte data\/horário, nome completo, idade nem tipo de atendimento: use encaminhar_humano JÁ nessa mensagem/);
  assert.doesNotMatch(prompt, /pergunte só a data e\/ou horário da consulta/);
});

test("buildSystemPrompt: nunca diz que o encaminhamento médico pode ser trazido depois — encaminha pra equipe (regressão real 2026-09-22: bot disse 'não se preocupe, pode trazer depois' e a equipe precisou desdizer)", () => {
  const prompt = buildSystemPrompt({ nomeContato: "Teste" });

  assert.match(prompt, /ENCAMINHAMENTO MÉDICO \(pedido médico\): NUNCA diga ao paciente que "não tem problema"/);
  assert.match(prompt, /exige o pedido médico ANTES de agendar/);
  assert.match(prompt, /use encaminhar_humano \(categoria "convenio"\) com o que ele disse/);
  assert.doesNotMatch(prompt, /oriente a trazer depois/);
});

test("buildSystemPrompt: saudação solta só recebe cumprimento, sem inventar pedido nem encaminhamento (regressão real 2026-09-22: 'Olá' respondido com 'pedido de Fisioterapia e Psicologia encaminhado')", () => {
  const prompt = buildSystemPrompt({ nomeContato: "Teste" });

  assert.match(prompt, /Saudação solta: se a mensagem do paciente for só um cumprimento/);
  assert.match(prompt, /NUNCA chame encaminhar_humano nem diga que encaminhou, registrou ou anotou algum pedido/);
  assert.match(prompt, /Mensagens anteriores da equipe no histórico .* não são pedidos do paciente/);
});

test("buildSystemPrompt: 'não vou conseguir ir' é falta, não atraso, mesmo com chuva/trânsito como motivo (regressão real 2026-09-22)", () => {
  const prompt = buildSystemPrompt({ nomeContato: "Teste" });

  assert.match(prompt, /- Falta: se o paciente disser que NÃO vai conseguir ir/);
  assert.match(prompt, /isso é FALTA\/CANCELAMENTO, NÃO atraso — mesmo que o motivo seja chuva, trânsito/);
  assert.match(prompt, /Nunca diga que a equipe vai esperá-lo, que está "preparada para a sua chegada"/);
  assert.match(prompt, /mas VAI comparecer/);
});

test("buildSystemPrompt: pergunta 'vocês fazem X?' consulta a base antes de iniciar o agendamento (regressão real 2026-09-22: fisioterapia perineal)", () => {
  const prompt = buildSystemPrompt({ nomeContato: "Teste" });

  assert.match(prompt, /pergunta se a clínica faz\/atende um tratamento, técnica ou especialidade específica/);
  assert.match(prompt, /consulte a base ANTES de iniciar o fluxo de agendamento/);
  assert.match(prompt, /NÃO siga pro agendamento nem encaminhe como pedido de agendamento/);
});

test("buildSystemPrompt: convênio da lista é respondido direto, sem prometer autorização (regressões reais 2026-09-22: Zelo Plus e 'está tudo certo com o convênio')", () => {
  const prompt = buildSystemPrompt({ nomeContato: "Teste" });

  assert.match(prompt, /Em FISIOTERAPIA, quando o paciente disser qual é o convênio dele, confira você mesmo na lista de Fisioterapia/);
  assert.match(prompt, /em PSICOLOGIA, nunca diga se a clínica aceita ou não um convênio/);
  assert.match(prompt, /Nunca diga que "está tudo certo com o convênio"/);
});

test("buildSystemPrompt: não inventa atraso/falta e não diz que encaminhou dado ainda não recebido (regressões reais 2026-09-22)", () => {
  const prompt = buildSystemPrompt({ nomeContato: "Teste" });

  assert.match(prompt, /só trate como atraso, falta ou cancelamento quando o paciente disser isso/);
  assert.match(prompt, /NÃO diga que "encaminhou" nem chame encaminhar_humano antes de receber o dado de fato/);
});

test("prompt avisa que Fisioterapia não é atendida pelo Medservi", () => {
  const prompt = buildSystemPrompt({ nomeContato: "Teste" });
  assert.match(prompt, /Medservi: a clínica NÃO atende Fisioterapia/);
});

test("prompt manda endereço e avisa a equipe quando o paciente está perdido a caminho", () => {
  const prompt = buildSystemPrompt({ nomeContato: "Teste" });
  assert.match(prompt, /Paciente perdido:.*consultar_base_conhecimento.*encaminhar_humano/);
});

test("prompt manda acolher o paciente em falecimento ou situação difícil antes de avisar a equipe", () => {
  const prompt = buildSystemPrompt({ nomeContato: "Teste" });
  assert.match(prompt, /Acolhimento:.*falecimento.*UMA frase curta/);
});

test("prompt manda conferir o plano em convênios que variam (Vitaplena) e não dizer que o pedido médico é só no dia", () => {
  const prompt = buildSystemPrompt({ nomeContato: "Teste" });
  assert.match(prompt, /Convênio que depende do plano:.*NUNCA diga só "sim, aceitamos".*no dia da consulta/);
});

test("prompt exige perguntar a idade antes de encaminhar paciente novo e não manda endereço em aviso de atraso", () => {
  const prompt = buildSystemPrompt({ nomeContato: "Teste", recorrente: false });
  assert.match(prompt, /PRIMEIRA ação é perguntar a idade/);
  assert.match(prompt, /aviso de atraso.*NÃO mande o endereço/);
});
