import { evolutionApi, evolutionInstance } from "../config/evolutionApi.js";
import { enviarMensagem } from "./whatsappService.js";
import { capturarErro, capturarAviso } from "../config/sentry.js";

const TELEFONE_ATENDENTE = process.env.ATENDENTE_HUMANO_TELEFONE;

// Só alerta na TRANSIÇÃO conectado -> desconectado (e avisa de volta quando
// reconecta) — sem isso, enquanto a conexão ficasse caída, mandaríamos o
// mesmo aviso a cada checagem (ver server.js), o que é ruído, não sinal.
let ultimoEstadoConectado = true;

async function instanciaConectada() {
  const { data } = await evolutionApi.get(`/instance/connectionState/${evolutionInstance}`);
  return data?.instance?.state === "open";
}

/**
 * Roda periodicamente (ver server.js). Diferente de o processo Node cair —
 * que já tem alerta próprio via uncaughtException/unhandledRejection —, a
 * instância da Evolution API pode perder a sessão do WhatsApp (celular sem
 * internet, sessão expirada, desconexão do lado do WhatsApp) sem gerar
 * nenhum erro no servidor. Sem essa checagem, isso passaria despercebido até
 * um paciente reclamar que o bot parou de responder.
 */
export async function verificarConexaoWhatsapp() {
  let conectado;
  try {
    conectado = await instanciaConectada();
  } catch (err) {
    capturarErro(
      "[whatsappHealthService] Falha ao checar status da conexão com o WhatsApp:",
      err
    );
    conectado = false;
  }

  if (conectado === ultimoEstadoConectado) return;
  ultimoEstadoConectado = conectado;

  if (conectado) {
    console.log("[whatsappHealthService] Conexão com o WhatsApp normalizada.");
    return;
  }

  capturarErro(
    "[whatsappHealthService] Instância da Evolution API está DESCONECTADA do WhatsApp."
  );
  if (!TELEFONE_ATENDENTE) return;

  try {
    // Best-effort: se a instância estiver mesmo desconectada, esse envio
    // provavelmente também falha — mas não custa tentar (a desconexão às
    // vezes é parcial/temporária, ou só desse canal específico).
    await enviarMensagem(
      TELEFONE_ATENDENTE,
      "⚠️ O bot da Clínica Exemplo perdeu a conexão com o WhatsApp. Pode ser necessário escanear o QR code de novo no painel da Evolution API."
    );
  } catch (errAviso) {
    // Esperado quando a conexão está mesmo caída (é o próprio canal que
    // falharia) — capturarAviso em vez de capturarErro pra não gerar alerta
    // de erro no Sentry para algo já coberto pelo alerta de desconexão acima.
    capturarAviso(
      `[whatsappHealthService] Não consegui avisar por WhatsApp: ${errAviso.message}`
    );
  }
}
