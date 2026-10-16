// Registro em memória do que o próprio bot mandou pela Evolution API.
// Necessário porque a Evolution API reenvia pro webhook, também como
// key.fromMe: true, toda mensagem enviada via API — indistinguível no
// payload de uma mensagem digitada manualmente no celular conectado.
// Sem isso, webhookController não conseguiria diferenciar "o bot acabou de
// mandar uma resposta" de "um humano da equipe respondeu na mão", e pausaria
// o atendimento automático (pra sempre, até um admin retomar manualmente)
// por engano assim que o bot mandasse a primeira mensagem de qualquer
// conversa.
//
// Dois mecanismos, por robustez:
// - `registrarEnvioIminente(telefone)` marca a intenção de envio ANTES de
//   chamar a Evolution API (não depois da resposta) — fecha a corrida onde o
//   eco do webhook chega no servidor antes da resposta do POST de envio.
// - `registrarMensagemEnviada(id)` guarda o ID exato da mensagem, pra
//   confirmar com precisão quando ele está disponível.
// Nenhum dos dois é removido no match: reentregas do mesmo webhook (retry da
// Evolution API) continuam batendo certo, não só a primeira tentativa.
const TTL_ID_MS = 5 * 60 * 1000;
// Só precisa cobrir o round-trip até a Evolution API responder com o ID real
// (registrarMensagemEnviada) — um valor bem maior que isso (era 20s) amplia
// à toa a janela em que uma mensagem manual de verdade da equipe, mandada
// logo depois do bot responder, seria confundida com o eco do próprio bot e
// deixaria de pausar o atendimento automático.
const JANELA_ENVIO_IMINENTE_MS = 8 * 1000;

const idsEnviados = new Map();
const ultimoEnvioPorTelefone = new Map();

function limparExpirados(mapa, ttlMs) {
  const agora = Date.now();
  for (const [chave, registradoEm] of mapa) {
    if (agora - registradoEm > ttlMs) mapa.delete(chave);
  }
}

export function registrarEnvioIminente(telefone) {
  if (!telefone) return;
  limparExpirados(ultimoEnvioPorTelefone, JANELA_ENVIO_IMINENTE_MS);
  ultimoEnvioPorTelefone.set(telefone, Date.now());
}

export function registrarMensagemEnviada(waMessageId) {
  if (!waMessageId) return;
  limparExpirados(idsEnviados, TTL_ID_MS);
  idsEnviados.set(waMessageId, Date.now());
}

export function foiEnviadaPeloBot(waMessageId, telefone) {
  const registradoPorId = waMessageId && idsEnviados.has(waMessageId);
  if (registradoPorId && Date.now() - idsEnviados.get(waMessageId) <= TTL_ID_MS) return true;

  const registradoPorTelefone = telefone && ultimoEnvioPorTelefone.has(telefone);
  if (registradoPorTelefone && Date.now() - ultimoEnvioPorTelefone.get(telefone) <= JANELA_ENVIO_IMINENTE_MS) {
    return true;
  }

  return false;
}
