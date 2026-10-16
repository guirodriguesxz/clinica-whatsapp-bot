import { toFile } from "openai";
import { evolutionApi, evolutionInstance } from "../config/evolutionApi.js";
import { openai } from "../config/openai.js";

const EXTENSAO_POR_MIMETYPE = {
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/webm": "webm",
};

export function extrairExtensao(mimetype) {
  const tipo = mimetype?.split(";")[0]?.trim();
  return EXTENSAO_POR_MIMETYPE[tipo] || "ogg";
}

/**
 * Baixa o áudio de uma mensagem do WhatsApp (a Evolution API descriptografa
 * e devolve em base64 — o webhook não recebe o arquivo diretamente) e
 * transcreve com o Whisper da OpenAI.
 * @param {object} messageKey - data.key da mensagem recebida no webhook
 * @param {object} audioMessage - data.message.audioMessage
 * @returns {Promise<string|null>} texto transcrito, ou null se vier vazio
 */
export async function transcreverAudio(messageKey, audioMessage) {
  const { data } = await evolutionApi.post(`/chat/getBase64FromMediaMessage/${evolutionInstance}`, {
    message: { key: messageKey },
  });

  const base64 = data?.base64;
  if (!base64) {
    throw new Error("Evolution API não retornou base64 do áudio.");
  }

  const buffer = Buffer.from(base64, "base64");
  const extensao = extrairExtensao(audioMessage?.mimetype);
  const arquivo = await toFile(buffer, `audio.${extensao}`);

  const transcricao = await openai.audio.transcriptions.create({
    file: arquivo,
    model: "whisper-1",
    language: "pt",
  });

  return transcricao.text?.trim() || null;
}
