// Popula a base_conhecimento com exemplos de FAQ de clínica.
// Rodar com: node src/db/seed-example-kb.js
// Entradas marcadas com [EXEMPLO] têm valor fictício — troque pelo dado real
// da clínica antes de ir pra produção (pode editar direto no painel do
// banco, ou reenviar pra POST /admin/base-conhecimento com o texto correto).

import "dotenv/config";
import { inserirEntradaBaseConhecimento } from "./../models/baseConhecimentoModel.js";
import { pool } from "./pool.js";

const EXEMPLOS = [
  {
    pergunta: "Qual o horário de funcionamento da clínica?",
    resposta:
      "Atendemos de segunda a sexta-feira. Fisioterapia: das 7h às 11h30 e das 13h às 18h30 (com intervalo de almoço). Psicologia: das 8h às 18h40. Aos sábados e domingos ficamos fechados.",
    categoria: "horarios",
  },
  {
    pergunta: "Quais convênios vocês aceitam?",
    resposta:
      "Aceitamos Aurora Saúde, Gaia Saúde, Sulvida e Horizonte Saúde, além de atendimento particular. [EXEMPLO — confirmar lista real com a clínica]",
    categoria: "convenios",
  },
  {
    pergunta: "Qual o endereço da clínica?",
    resposta: "[EXEMPLO — preencher com o endereço real da Clínica Exemplo]",
    categoria: "localizacao",
  },
  {
    pergunta: "Como faço para cancelar ou remarcar uma consulta?",
    resposta:
      "Pedimos que o cancelamento ou remarcação seja avisado com pelo menos 24 horas de antecedência, direto por aqui pelo WhatsApp.",
    categoria: "politicas",
  },
  {
    pergunta: "Quanto custa a consulta particular?",
    resposta: "[EXEMPLO — preencher com os valores reais de fisioterapia e psicologia]",
    categoria: "precos",
  },
  {
    pergunta: "O que devo levar na primeira consulta de fisioterapia?",
    resposta:
      "Traga um documento com foto, a carteirinha do convênio (se for o caso) e, se tiver, exames ou laudos médicos relacionados à queixa.",
    categoria: "fisioterapia",
  },
  {
    pergunta: "Como funciona a primeira sessão de psicoterapia?",
    resposta:
      "A primeira sessão é um momento de acolhimento, onde o psicólogo entende sua história e o que te trouxe até aqui, para juntos definirem o melhor caminho de acompanhamento.",
    categoria: "psicologia",
  },
  {
    pergunta: "A clínica tem estacionamento?",
    resposta: "[EXEMPLO — preencher com informação real sobre estacionamento]",
    categoria: "localizacao",
  },
  {
    pergunta: "Vocês atendem crianças?",
    resposta:
      "[EXEMPLO — confirmar com a clínica se há atendimento infantil em fisioterapia e/ou psicologia]",
    categoria: "geral",
  },
];

for (const exemplo of EXEMPLOS) {
  const entrada = await inserirEntradaBaseConhecimento(exemplo);
  console.log("Inserido:", entrada.pergunta);
}

await pool.end();
