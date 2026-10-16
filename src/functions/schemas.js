/**
 * Definições (JSON Schema) das functions expostas ao modelo via function
 * calling. Note que nenhuma function recebe "telefone" do paciente — o
 * número já é conhecido pelo sistema (veio do webhook) e é injetado na
 * execução da function, nunca confiado ao que o modelo disser.
 */
// checar_disponibilidade, criar_agendamento, cancelar_agendamento e
// remarcar_agendamento foram deliberadamente removidas daqui (não são mais
// oferecidas ao modelo): a clínica decidiu que agendamento, cancelamento e
// remarcação são sempre feitos diretamente pela equipe, nunca pelo bot (ver
// systemPrompt.js). Manter essas functions registradas, mesmo com o prompt
// dizendo "nunca use", era um guard fraco — a própria descrição de cada uma
// convidava o modelo a chamá-la ("use sempre antes de sugerir horários...",
// "só chame depois que o paciente confirmar..."), contradizendo a proibição
// em texto. Removê-las do tool schema torna essa regra impossível de violar,
// em vez de depender só do modelo seguir a instrução à risca. Os handlers
// (src/functions/checarDisponibilidade.js etc.) continuam existindo com seus
// próprios testes, mas não são mais chamados por nada em produção — o
// dashboard e a detecção de agendamento manual usam calendarService.js/os
// models diretamente, não esses wrappers de function-calling.
export const toolSchemas = [
  {
    type: "function",
    function: {
      name: "consultar_base_conhecimento",
      description:
        "Busca na base de conhecimento da clínica (horários, convênios aceitos, políticas, endereço, preços, etc). Use antes de responder qualquer pergunta geral sobre a clínica.",
      parameters: {
        type: "object",
        properties: {
          pergunta: { type: "string" },
        },
        required: ["pergunta"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "encaminhar_humano",
      description:
        "Encaminha a conversa para atendimento humano quando o pedido está fora do fluxo automatizado (reclamações, cancelamentos complexos, emergências, dúvidas não resolvidas pela base de conhecimento).",
      parameters: {
        type: "object",
        properties: {
          motivo: {
            type: "string",
            description:
              "O pedido COMPLETO do paciente, fiel ao que ele disse: TODOS os dias/horários citados (\"terça e quinta às 11h\" nunca vira só \"terça\") e TODAS as restrições (\"menos essa terça, tem exame\"). Se for correção de um pedido já encaminhado, use \"PEDIDO ATUALIZADO — antes: <pedido anterior inteiro> / correção do paciente: <mensagem dele entre aspas>\", sem tirar nada do pedido anterior. Na dúvida sobre o que ele quis dizer, cite as palavras dele entre aspas em vez de interpretar.",
          },
          categoria: {
            type: "string",
            enum: ["psicologia", "convenio", "urgente", "agendamento_fisioterapia", "outro"],
            description:
              "Tipo do encaminhamento, para a equipe priorizar: 'psicologia' (fim natural do fluxo de Psicologia, confirmar horário com o profissional — rotina, sem urgência), 'convenio' (pendência ligada a convênio/encaminhamento médico), 'urgente' (SÓ reclamação, emergência, ou atraso/falta numa consulta de HOJE — falta ou cancelamento de amanhã ou outro dia NÃO é urgente, vai como 'agendamento_fisioterapia' ou 'psicologia'), 'agendamento_fisioterapia' (agendar, cancelar, remarcar ou avisar falta com antecedência em consulta de Fisioterapia — sempre encaminhado pra equipe, rotina sem urgência), 'outro' (dúvida que a base de conhecimento não resolve, ou qualquer coisa que não se encaixe nas demais).",
          },
        },
        required: ["motivo", "categoria"],
      },
    },
  },
];
