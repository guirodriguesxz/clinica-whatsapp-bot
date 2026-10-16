// O bot roda no PC da recepção e fica desligado fora do expediente. Quando o
// PC liga de manhã, o WhatsApp entrega de uma vez tudo o que chegou durante a
// noite — sem essa trava, o bot responderia em massa conversas velhas, muitas
// já resolvidas pela recepção pelo celular. Mensagem mais antiga que esse
// limite fica pra recepção responder.
const LIMITE_MENSAGEM_ANTIGA_MS = 10 * 60_000;

/**
 * `messageTimestamp` vem da Evolution API em segundos (número ou string).
 * Sem timestamp válido, não descarta — melhor responder do que ignorar.
 */
export function ehMensagemAntiga(messageTimestamp, agoraMs = Date.now()) {
  const segundos = Number(messageTimestamp);
  if (!messageTimestamp || !Number.isFinite(segundos)) return false;
  return agoraMs - segundos * 1000 > LIMITE_MENSAGEM_ANTIGA_MS;
}
