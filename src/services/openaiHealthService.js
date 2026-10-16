import { openai, OPENAI_MODEL } from "../config/openai.js";
import { enviarMensagem } from "./whatsappService.js";
import { capturarErro, capturarAviso } from "../config/sentry.js";
import { ehErroDeCreditosEsgotados } from "../utils/openaiErrors.js";

const TELEFONE_ATENDENTE = process.env.ATENDENTE_HUMANO_TELEFONE;

// Só alerta na TRANSIÇÃO com créditos -> sem créditos (e avisa de volta
// quando normaliza) — sem isso, mandaríamos o mesmo aviso a cada checagem
// enquanto a conta continuasse sem saldo, o que é ruído, não sinal.
let ultimoEstadoDisponivel = true;

// Chamada mínima (1 token de resposta) só pra confirmar que a conta tem
// crédito — não passa `tools`, não precisa: não estamos gerando resposta de
// verdade pra ninguém, só testando se a API aceita a requisição.
async function creditosDisponiveis() {
  try {
    await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
    });
    return true;
  } catch (err) {
    if (ehErroDeCreditosEsgotados(err)) return false;
    // Erro de outra natureza (rede, 5xx, etc.) não é um sinal confiável de
    // "sem créditos" — deixa subir pra quem chamou em vez de arriscar um
    // alarme falso por uma instabilidade pontual da OpenAI.
    throw err;
  }
}

/**
 * Roda periodicamente (ver server.js). aiService.gerarResposta já lida com o
 * caso de um paciente de verdade bater nesse erro em produção (encaminha pro
 * atendimento humano), mas isso só acontece quando alguém manda mensagem.
 * Essa checagem detecta a falta de créditos mesmo sem nenhum paciente
 * conversando no momento — importante fora do horário de pico, pra equipe
 * já ficar sabendo (e poder recarregar) antes que muita gente seja afetada.
 */
export async function verificarCreditosOpenAI() {
  let disponivel;
  try {
    disponivel = await creditosDisponiveis();
  } catch (err) {
    capturarAviso(
      "[openaiHealthService] Falha ao checar créditos da OpenAI (erro não relacionado a saldo):",
      err
    );
    return;
  }

  if (disponivel === ultimoEstadoDisponivel) return;
  ultimoEstadoDisponivel = disponivel;

  if (disponivel) {
    console.log("[openaiHealthService] Créditos da OpenAI normalizados.");
    return;
  }

  capturarErro("[openaiHealthService] Conta da OpenAI está SEM CRÉDITOS.");
  if (!TELEFONE_ATENDENTE) return;

  try {
    await enviarMensagem(
      TELEFONE_ATENDENTE,
      "⚠️ A conta da OpenAI do Clínica Exemplo Bot está sem créditos. Os pacientes já estão sendo encaminhados automaticamente pra vocês até o saldo ser recarregado — veja platform.openai.com/settings/organization/billing."
    );
  } catch (errAviso) {
    // Best-effort: se der pra avisar por WhatsApp, o bot em si ainda está de
    // pé (só a IA que está sem crédito) — mas não custa capturar caso falhe.
    capturarAviso(`[openaiHealthService] Não consegui avisar por WhatsApp: ${errAviso.message}`);
  }
}
