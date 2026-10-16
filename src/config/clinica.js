import { normalizarTelefoneComDDI } from "../utils/phone.js";

/**
 * Configuração de negócio da clínica. Centralizado aqui para poder ser
 * ajustado sem mexer em lógica de prompt/function calling.
 */
export const CLINICA = {
  nome: "Clínica Exemplo",
  timezone: "America/Sao_Paulo",
  // Usado de verdade pela lógica de checar_disponibilidade/criar_agendamento
  // do bot (só Fisioterapia — o bot ainda encaminha Psicologia pra equipe,
  // por instrução do system prompt, não por falta de suporte aqui).
  horarioFuncionamento: {
    periodos: [
      { inicio: "07:00", fim: "11:30" },
      { inicio: "13:00", fim: "18:30" },
    ],
  },
  // O bot não chama checar_disponibilidade/criar_agendamento pra Psicologia
  // (segue encaminhando pra equipe, via system prompt) — mas
  // validarDisponibilidadeAgendamento (calendarService.js) usa este horário
  // de verdade pra validar agendamentos de Psicologia criados/editados
  // manualmente pelo dashboard (remarcacaoService.js).
  horarioFuncionamentoPsicologia: {
    periodos: [{ inicio: "08:00", fim: "18:40" }],
  },
  intervaloSlotsMinutos: 30,
  // Janela em que o bot responde no WhatsApp (dias úteis, fora de feriado) —
  // fora dela fica calado (ver expediente em chatService.js). Separada dos
  // periodos acima de propósito: esses valem pra agenda e pro status de
  // expediente no prompt (decisão da clínica, 2026-10-02: bot até 20h30).
  horarioRespostaBot: { inicio: "07:00", fim: "20:30" },
  diasFechados: [0, 6], // 0 = domingo, 6 = sábado (dayjs .day())
  // Fisioterapia dura o mesmo que o intervalo da grade (30min) — evita
  // consultas sobrepostas no calendário quando duas seguidas são marcadas
  // (ex: 07:00 e 07:30 não se cruzavam mais depois dessa mudança). Ambas as
  // durações são usadas de verdade por calendarService.js (criação/validação
  // de evento) e agendamentoManualService.js.
  duracaoConsultaMinutos: {
    fisioterapia: 30,
    psicologia: 40,
  },
  // Máximo de pacientes diferentes no mesmo horário (capacidade de
  // profissionais/salas atendendo em paralelo). Conta agendamentos
  // confirmados feitos pelo bot + importados do sistema de agenda anterior (ver
  // contarPacientesNoSlot em calendarService.js). Tipo sem entrada aqui não
  // tem limite. Fisioterapia passa por essa checagem via bot (checar_disponibilidade)
  // e dashboard; Psicologia só via dashboard (criação/edição manual — o bot
  // encaminha esses casos pra equipe, não chama validarDisponibilidadeAgendamento).
  capacidadeMaximaPorHorario: {
    fisioterapia: 7,
    psicologia: 1,
  },
};

// Números que nunca devem receber resposta automática do bot, mesmo
// mandando mensagem "de fora" (fromMe:false) — não são pacientes, são
// contatos internos da equipe (ex: quem cuida do social media da clínica).
// Diferente da pausa por atendimento manual (que só é acionada quando a
// equipe manda mensagem PELO número conectado), esses números são sempre
// ignorados, não importa por onde mandem mensagem. Telefone normalizado
// (só dígitos, com DDI), igual ao formato salvo em pacientes.telefone.
//
// ATENDENTE_HUMANO_TELEFONE entra aqui sempre, dinamicamente: é pra esse
// número que o bot manda os avisos de encaminhamento/agendamento, então é
// esperado que alguém da equipe responda ali de vez em quando — sem essa
// exclusão, o bot tratava essa resposta como se fosse de um paciente novo e
// interagia normalmente (caso real: recepção mandou uma mensagem nesse
// número e o bot respondeu como se fosse atendimento).
//
// Passa tudo por normalizarTelefoneComDDI antes de comparar: o `telefone`
// que chega do webhook é sempre normalizado (só dígitos, com DDI 55), mas
// ATENDENTE_HUMANO_TELEFONE vem de uma env var configurada manualmente no
// Railway — se alguém digitar com espaço/traço/parênteses, ou sem o DDI
// (ex: "11 99999-0005" em vez de "5511999990005"), o .includes() abaixo
// nunca bate e essa proteção inteira silenciosamente deixa de funcionar
// (bug real que já se repetiu: o bot voltou a mandar a mensagem de
// boas-vindas pro próprio número de atendimento humano).
// normalizarTelefoneComDDI também completa o DDI ausente (número de 10/11
// dígitos), diferente de normalizarTelefone (só remove não-dígitos).
// Número do WhatsApp conectado ao bot — usado tanto pra nunca tratar
// resposta nesse número como paciente novo (lista abaixo) quanto pra
// bloquear, na hora do envio (ver whatsappService.js), qualquer mensagem que
// acabe resolvida pra esse mesmo número (bug real observado: aviso de
// agendamento indo pro próprio número do bot em vez do da recepção,
// provavelmente por resolução incorreta de JID/@lid na Evolution API/Baileys
// — nunca deve simplesmente sair calado quando isso acontece de novo).
export const NUMERO_CONECTADO_BOT = normalizarTelefoneComDDI("5511999990100");

export const TELEFONES_SEM_ATENDIMENTO_AUTOMATICO = [
  "5511999990007", // Fulana de Tal — social media da clínica, não é paciente
  "5511999990008", // contato interno da equipe/clínica
  "5511999990009", // contato interno da equipe/clínica
  "5511999990014", // contato interno da equipe/clínica
  "5511999990013", // contato interno da equipe/clínica
  "5511999990010", // contato interno da equipe/clínica
  "5511999990011", // Amanda — funcionária da clínica (contato interno)
  "5511999990012", // Marta — da equipe da clínica (contato interno)
  NUMERO_CONECTADO_BOT,
  process.env.ATENDENTE_HUMANO_TELEFONE,
]
  .filter(Boolean)
  .map((telefone) => normalizarTelefoneComDDI(telefone))
  .filter(Boolean);

// Listas oficiais (posts @clinica.exemplo) — Fisioterapia e Psicologia têm
// convênios credenciados quase iguais, mas não idênticos: Bússola Saúde e
// Medservi só valem para Psicologia.
export const CONVENIOS_FISIOTERAPIA = [
  "Aurora Saúde",
  "Gaia Saúde",
  "Lumen",
  "Santa Luz Saúde",
  "Amparo Plan",
  "Vitaplena",
  "Norte Intermed",
  "Seleta",
  "Mar Azul Saúde",
  "Intermed",
  "Horizonte Saúde",
  // Só o plano dos funcionários do Banco Exemplo — caso real 2026-10-02: o
  // bot disse "sim, aceitamos Sulvida" e a equipe teve que desdizer.
  "Sulvida Saúde (SOMENTE o plano dos funcionários do Banco Exemplo — outro plano Sulvida não é atendido pelo convênio, só particular com reembolso; sempre avise essa restrição)",
  "Biovera",
  "IPRAX",
  "Ômega Saúde",
  "Total Cuidar",
  "Livre Vida Saúde",
  "Cuidado Saúde",
  "Plena Saúde",
  "Zelo Plus",
  "Medcor Health",
  "Proviva Saúde",
  "Unisol",
  "Doce Saúde",
  "Sagra Saúde",
  "Vidaplus Saúde",
  "Vivere",
  "Bom Porto Saúde",
  "Nordimed",
  "Afepex",
  "Cabex",
];

export const CONVENIOS_PSICOLOGIA = [
  "Aurora Saúde",
  "Gaia Saúde",
  "Lumen",
  "Santa Luz Saúde",
  "Amparo Plan",
  "Vitaplena",
  "Norte Intermed",
  "Seleta",
  "Mar Azul Saúde",
  "Intermed",
  "Horizonte Saúde",
  "Sulvida Saúde",
  "Biovera",
  "IPRAX",
  "Ômega Saúde",
  "Total Cuidar",
  "Bússola Saúde",
  "Livre Vida Saúde",
  "Cuidado Saúde",
  "Plena Saúde",
  "Zelo Plus",
  "Medcor Health",
  "Proviva Saúde",
  "Unisol",
  "Doce Saúde",
  "Medservi",
  "Sagra Saúde",
  "Vidaplus Saúde",
  "Vivere",
  "Bom Porto Saúde",
];
