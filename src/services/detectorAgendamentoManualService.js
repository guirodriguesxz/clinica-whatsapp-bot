import { openai, OPENAI_MODEL } from "../config/openai.js";
import { capturarErro, capturarAviso } from "../config/sentry.js";
import { validarData, validarHora } from "../utils/validacao.js";

// "00:00" nunca é um horário real de consulta (a clínica nem abre de
// madrugada) — visto na prática: o modelo às vezes preenche esse valor
// quando a hora não ficou clara na conversa, em vez de retornar acao:
// "nenhuma" como as instruções pedem. Sem essa checagem, o agendamento
// entrava no sistema com hora zerada, sem ninguém perceber até aparecer na
// agenda num horário sem sentido.
const HORA_PLACEHOLDER_INVALIDA = "00:00";

const FERRAMENTA_DETECCAO = {
  type: "function",
  function: {
    name: "resultado_deteccao",
    description:
      "Resultado da análise de uma conversa de WhatsApp pra saber se uma ação de agendamento (criar, cancelar ou remarcar) ficou combinada.",
    parameters: {
      type: "object",
      properties: {
        acao: {
          type: "string",
          enum: ["nenhuma", "criar", "cancelar", "remarcar"],
          description:
            "'criar' se uma consulta NOVA ficou combinada; 'cancelar' se uma consulta já marcada foi cancelada (equipe confirmou o cancelamento com o paciente); 'remarcar' se uma consulta já marcada foi movida pra outra data/hora; 'nenhuma' se nada disso ficou claramente confirmado nessa troca (padrão — erre para este lado na dúvida).",
        },
        data: {
          type: "string",
          description:
            "Data combinada, formato YYYY-MM-DD. Obrigatório se acao for 'criar' ou 'remarcar' (nesse caso, a NOVA data).",
        },
        hora: {
          type: "string",
          description: "Hora combinada, formato HH:mm (24h). Obrigatório se acao for 'criar' ou 'remarcar'.",
        },
        tipo_atendimento: {
          type: "string",
          enum: ["fisioterapia", "psicologia"],
          description: "Só se ficar claro pelo contexto; default fisioterapia se não mencionado.",
        },
        nome_paciente: {
          type: "string",
          description:
            "Nome de quem vai ser ATENDIDO, só se a equipe escrever explicitamente na conversa (ex: 'deixamos a paciente FULANA DE TAL agendada'). Deixe vazio se ninguém nomear o paciente — nunca chute, e nunca use o nome de quem está conversando quando ele não for o próprio paciente.",
        },
      },
      required: ["acao"],
    },
  },
};

/**
 * Analisa o histórico de uma conversa PAUSADA (atendimento manual da
 * equipe) pra detectar se uma ação de agendamento ficou combinada — usado
 * pra registrar automaticamente sem a equipe precisar fazer nada além de
 * conversar normalmente pelo WhatsApp. Erra pro lado de "nenhuma ação"
 * quando em dúvida: melhor perder uma detecção do que aplicar uma ação
 * errada de verdade (ver agendamentoManualService.js, que só executa
 * cancelamento/remarcação quando há exatamente UMA consulta confirmada
 * pro telefone — outra camada de segurança contra ambiguidade).
 */
export async function detectarAgendamentoCombinado({ historico, dataAtual, diaSemanaAtual }) {
  const textoHistorico = historico
    .map((h) => `${h.remetente === "equipe" ? "Equipe" : h.remetente === "bot" ? "Bot" : "Paciente"}: ${h.mensagem}`)
    .join("\n");

  try {
    const resposta = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content: `Você analisa uma conversa de WhatsApp entre um paciente e a equipe de uma clínica de fisioterapia/psicologia (Clínica Exemplo) pra detectar SE, nessa troca, uma ação de agendamento ficou claramente combinada: uma consulta NOVA marcada, uma consulta já marcada CANCELADA, ou uma consulta já marcada REMARCADA para outra data/hora. Hoje é ${diaSemanaAtual}, ${dataAtual}.

Seja bem conservador — na dúvida, marque acao: "nenhuma":
- "Vou verificar", "tem horário sim", ou uma data mencionada sem confirmação final NÃO contam como nada disso.
- Horário RECORRENTE (ex: "toda segunda", "Seg. Qua. e Sex. às 07h", "toda semana") NÃO conta pra criar/remarcar — isso é um padrão de vários agendamentos, não uma data específica única; não dá pra saber qual ocorrência marcar. Só conta uma data pontual (ex: "dia 28/08", "amanhã", "sexta que vem às 14h", referindo-se claramente a UM dia específico).
- Cancelamento só conta se a equipe confirmar claramente que a consulta foi cancelada/desmarcada (não uma pergunta do paciente sobre cancelar, nem uma dúvida em aberto).
- Remarcação só conta se ficar claro que é uma consulta JÁ EXISTENTE sendo movida para uma nova data/hora (não uma consulta nova do zero) — nesse caso, retorne a NOVA data/hora em "data"/"hora".
- Ao calcular uma data relativa ("amanhã", "sexta que vem", "segunda"), calcule com cuidado a partir do dia de hoje informado acima — não adivinhe.

EXCEÇÃO ao "tem que ter sido combinado nesta troca": quando a EQUIPE afirma que o paciente JÁ ESTÁ agendado, com data e hora específicas, isso conta como acao "criar" — mesmo que a negociação não apareça nesta conversa. A clínica marca consulta por telefone e presencialmente também, e nesses casos a mensagem da equipe é o único registro que existe. Vale principalmente pro texto padrão da clínica ("Deixamos o paciente FULANO DE TAL agendado para Quinta-feira, dia 24/09/26 às 09h20 ..."), mas também pra qualquer afirmação equivalente da equipe ("lhe reagendei para dia 22/09 às 10h", "está agendada para quarta às 14h"). Só não conte se a data já passou em relação ao dia de hoje informado acima, ou se a equipe estiver apenas relembrando uma consulta que ela mesma já confirmou antes nesta conversa.`,
        },
        { role: "user", content: textoHistorico },
      ],
      tools: [FERRAMENTA_DETECCAO],
      tool_choice: { type: "function", function: { name: "resultado_deteccao" } },
    });

    const chamada = resposta.choices[0]?.message?.tool_calls?.[0];
    if (!chamada) return { acao: "nenhuma" };

    const args = JSON.parse(chamada.function.arguments);

    if (args.acao === "criar" || args.acao === "remarcar") {
      if (!args.data || !args.hora) return { acao: "nenhuma" };
      if (!validarData(args.data) || !validarHora(args.hora) || args.hora === HORA_PLACEHOLDER_INVALIDA) {
        capturarAviso(
          `[detectorAgendamentoManualService] Detecção descartada por data/hora implausível: data="${args.data}" hora="${args.hora}".`
        );
        return { acao: "nenhuma" };
      }
      // Data no passado nunca é agendamento novo — é a equipe se referindo a
      // uma consulta antiga. Isso é checado aqui, e não só nas instruções,
      // porque o modelo ignora a regra na prática: pedindo pra descartar
      // data passada, ele ainda devolvia "criar" pra uma confirmação de 11
      // dias antes, nas 3 tentativas.
      if (args.data < dataAtual) {
        capturarAviso(
          `[detectorAgendamentoManualService] Detecção descartada por data no passado: data="${args.data}" (hoje é ${dataAtual}).`
        );
        return { acao: "nenhuma" };
      }
      const nomeDetectado = args.nome_paciente?.trim();
      return {
        acao: args.acao,
        data: args.data,
        hora: args.hora,
        tipoAtendimento: args.tipo_atendimento ?? "fisioterapia",
        ...(nomeDetectado ? { nomePaciente: nomeDetectado } : {}),
      };
    }

    if (args.acao === "cancelar") {
      return { acao: "cancelar" };
    }

    return { acao: "nenhuma" };
  } catch (err) {
    capturarErro("[detectorAgendamentoManualService] Falha ao detectar agendamento combinado:", err);
    return { acao: "nenhuma" };
  }
}
