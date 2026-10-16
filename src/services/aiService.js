import { openai, OPENAI_MODEL } from "../config/openai.js";
import { toolSchemas, functionHandlers } from "../functions/index.js";
import { capturarErro, capturarAviso } from "../config/sentry.js";
import { ehErroDeCreditosEsgotados } from "../utils/openaiErrors.js";

const MAX_TOOL_ITERATIONS = 5;

const MOTIVO_CREDITOS_ESGOTADOS =
  "Sistema de IA temporariamente indisponível (créditos da OpenAI esgotados).";

const MENSAGEM_ENCAMINHADO =
  "No momento nosso atendimento automático está indisponível, mas já avisei a equipe da clínica — alguém vai continuar seu atendimento por aqui em instantes.";

// Caso real 2026-10-07 (paciente 461): o modelo escreveu a chamada de
// encaminhar_humano como TEXTO no meio da resposta — o paciente recebeu
// `{ "motivo": "...", "categoria": "urgente" },` e a equipe não foi avisada
// por essa via. Detecta o JSON vazado, executa o encaminhamento de verdade e
// troca o texto por uma mensagem fixa.
const CHAMADA_VAZADA = /\{[^{}]*"(?:motivo|categoria)"[^{}]*\}/;

const MENSAGEM_APOS_CHAMADA_VAZADA =
  "Anotado! Já avisei a equipe sobre a sua solicitação. Eles vão te responder por aqui.";

export function extrairChamadaVazada(texto) {
  const achado = CHAMADA_VAZADA.exec(texto || "");
  if (!achado) return null;
  let args = null;
  try {
    const candidato = JSON.parse(achado[0]);
    if (typeof candidato?.motivo === "string" && candidato.motivo.trim()) args = candidato;
  } catch {
    // JSON malformado: cai no motivo genérico abaixo.
  }
  return { args };
}

const MENSAGEM_ENCAMINHAMENTO_INDISPONIVEL =
  "No momento nosso atendimento automático está indisponível. Por favor, ligue diretamente para a clínica para continuar seu agendamento.";

// Erros de rede/timeout (a OpenAI não devolve status nesses casos), 5xx do
// lado da OpenAI, e rate limit comum (429, mas não insufficient_quota) costumam
// se resolver sozinhos em segundos — vale tentar de novo antes de desistir.
// 4xx "normais" (400/401/403/404/409/422) são erro de config/bug, não
// transitório: tentar de novo não muda o resultado.
const MAX_TENTATIVAS_TRANSITORIO = 2;
const BACKOFF_BASE_MS = 300;

function ehErroTransitorio(err) {
  if (err?.status === undefined) return true;
  if (err.status >= 500) return true;
  if (err.status === 429) return true;
  return false;
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function criarChatCompletionComRetry(params) {
  for (let tentativa = 0; ; tentativa++) {
    try {
      return await openai.chat.completions.create(params);
    } catch (err) {
      const esgotarTentativas = tentativa >= MAX_TENTATIVAS_TRANSITORIO;
      if (ehErroDeCreditosEsgotados(err) || !ehErroTransitorio(err) || esgotarTentativas) {
        throw err;
      }
      capturarAviso(
        `[aiService] Erro transitório da OpenAI (tentativa ${tentativa + 1}/${MAX_TENTATIVAS_TRANSITORIO + 1}), tentando de novo: ${err.message}`
      );
      await esperar(BACKOFF_BASE_MS * 2 ** tentativa);
    }
  }
}

/**
 * Quando a OpenAI está indisponível por falta de créditos, o modelo não pode
 * decidir chamar encaminhar_humano sozinho — então chamamos a function
 * diretamente, reaproveitando a mesma notificação por WhatsApp que a equipe
 * já recebe em encaminhamentos normais.
 */
async function encaminharPorFaltaDeCreditos(context) {
  const resultado = await functionHandlers.encaminhar_humano(
    { motivo: MOTIVO_CREDITOS_ESGOTADOS, categoria: "erro_tecnico" },
    context
  );
  return {
    textoResposta: resultado.encaminhado
      ? MENSAGEM_ENCAMINHADO
      : MENSAGEM_ENCAMINHAMENTO_INDISPONIVEL,
    functionsChamadas: ["encaminhar_humano"],
  };
}

/**
 * Roda o loop de function calling: manda as mensagens pra OpenAI, e enquanto
 * o modelo pedir para executar functions, despacha para functionHandlers e
 * devolve o resultado como mensagem "tool", até o modelo devolver texto
 * final para o paciente.
 *
 * @param {object} params
 * @param {string} params.systemPrompt
 * @param {Array<{role: string, content: string}>} params.historico - turnos anteriores já no formato OpenAI
 * @param {string} params.mensagemUsuario
 * @param {object} params.context - { telefone, nomeContato } injetado nos handlers das functions
 * @returns {Promise<{ textoResposta: string, functionsChamadas: string[] }>}
 */
export async function gerarResposta({ systemPrompt, historico = [], mensagemUsuario, context }) {
  const messages = [
    { role: "system", content: systemPrompt },
    ...historico,
    { role: "user", content: mensagemUsuario },
  ];

  const functionsChamadas = [];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    let response;
    try {
      response = await criarChatCompletionComRetry({
        model: OPENAI_MODEL,
        messages,
        tools: toolSchemas,
        tool_choice: "auto",
      });
    } catch (err) {
      if (ehErroDeCreditosEsgotados(err)) {
        capturarErro(
          "[aiService] OpenAI sem créditos — encaminhando para atendimento humano.",
          err
        );
        return await encaminharPorFaltaDeCreditos(context);
      }
      throw err;
    }

    const choice = response.choices[0].message;

    if (!choice.tool_calls?.length) {
      const vazada = extrairChamadaVazada(choice.content);
      if (vazada) {
        capturarAviso("[aiService] Modelo escreveu a chamada de encaminhar_humano como texto; executando de verdade.");
        let encaminhado = functionsChamadas.includes("encaminhar_humano");
        if (!encaminhado) {
          try {
            const resultado = await functionHandlers.encaminhar_humano(
              vazada.args ?? {
                motivo: "Resposta do assistente saiu malformada; confira a conversa do paciente.",
                categoria: "outro",
              },
              context
            );
            encaminhado = Boolean(resultado?.encaminhado);
            if (encaminhado) functionsChamadas.push("encaminhar_humano");
          } catch (err) {
            capturarErro("[aiService] Erro encaminhando a chamada vazada:", err);
          }
        }
        return {
          textoResposta: encaminhado ? MENSAGEM_APOS_CHAMADA_VAZADA : MENSAGEM_ENCAMINHAMENTO_INDISPONIVEL,
          functionsChamadas,
        };
      }
      return { textoResposta: choice.content?.trim() || "", functionsChamadas };
    }

    messages.push(choice);

    for (const toolCall of choice.tool_calls) {
      const nome = toolCall.function.name;
      const handler = functionHandlers[nome];
      let resultado;

      try {
        const args = JSON.parse(toolCall.function.arguments || "{}");
        // O modelo às vezes chama encaminhar_humano de novo no mesmo turno
        // (visto em teste real 2026-10-01) — cada chamada mandaria outro
        // aviso pra recepção. A equipe já foi avisada; não repete.
        if (nome === "encaminhar_humano" && functionsChamadas.includes("encaminhar_humano")) {
          resultado = { encaminhado: true, observacao: "A equipe já foi avisada nesta resposta." };
        } else {
          resultado = handler
            ? await handler(args, context)
            : { erro: `Function desconhecida: ${nome}` };
        }
      } catch (err) {
        capturarErro(`[aiService] Erro executando function ${nome}:`, err);
        resultado = { erro: "Falha ao executar a operação, tente novamente." };
      }

      // Só conta a function como "efetivamente chamada" para fins de etapa
      // (ver PROXIMA_ETAPA_POR_FUNCTION em chatService.js) se ela não tiver
      // retornado uma falha explícita — senão um criar_agendamento/
      // cancelar_agendamento/remarcar_agendamento que falhou (horário
      // disputado, data inválida etc.) empurraria o paciente para uma etapa
      // que não reflete o que realmente aconteceu.
      if (resultado?.sucesso !== false) {
        functionsChamadas.push(nome);
      }
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(resultado),
      });
    }
  }

  capturarErro("[aiService] Limite de iterações de function calling atingido.");
  const resultado = await functionHandlers.encaminhar_humano(
    {
      motivo: "Conversa não concluída após várias tentativas do assistente (limite de iterações).",
      categoria: "erro_tecnico",
    },
    context
  );
  functionsChamadas.push("encaminhar_humano");
  return {
    textoResposta: resultado.encaminhado
      ? "Desculpe, tive um problema para concluir sua solicitação. Já avisei a equipe da clínica, alguém vai te ajudar por aqui."
      : MENSAGEM_ENCAMINHAMENTO_INDISPONIVEL,
    functionsChamadas,
  };
}
