import { evolutionApi, evolutionInstance } from "../config/evolutionApi.js";
import { normalizarTelefone } from "../utils/phone.js";
import { registrarEnvioIminente, registrarMensagemEnviada } from "../utils/mensagensDoBot.js";
import { capturarAviso } from "../config/sentry.js";
import { NUMERO_CONECTADO_BOT } from "../config/clinica.js";

// Mostra "digitando..." por um instante antes de mandar o texto — resposta
// que aparece pro paciente instantaneamente, sem nenhum indício de digitação,
// é um sinal de comportamento automatizado que preferimos evitar.
const DELAY_DIGITANDO_MS = 2000;

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve o JID real de um número antes de mandar qualquer mensagem.
 *
 * Por quê: o WhatsApp vem migrando parte dos contatos pro endereçamento por
 * @lid (Linked ID) em vez do JID clássico "5511988887777@s.whatsapp.net", e
 * o Baileys/Evolution API ainda não traduz isso em todos os fluxos — quando
 * a instância manda "number: <dígitos>" sem resolver o @lid primeiro, a
 * mensagem pode não ser entregue ao contato certo e acabar só na própria
 * sessão conectada (caso real: aviso de agendamento "voltando" pro número
 * do próprio bot em vez de ir pro número da recepção). Consultar
 * /chat/whatsappNumbers antes do envio e usar o `jid` que ele devolve (que
 * já vem no formato — @lid ou @s.whatsapp.net — que a instância realmente
 * resolve) evita isso. Nunca lança: se a checagem falhar ou vier num
 * formato inesperado, cai de volta pro número normalizado (comportamento
 * anterior), pra uma instabilidade nessa consulta não travar o envio.
 * @param {string} numero - já normalizado (só dígitos, com DDI)
 * @returns {Promise<string>} JID a usar no campo "number" do envio
 */
async function resolverJid(numero) {
  try {
    const { data } = await evolutionApi.post(`/chat/whatsappNumbers/${evolutionInstance}`, {
      numbers: [numero],
    });
    const resultado = Array.isArray(data) ? data[0] : null;
    if (!resultado) return { jid: numero, numeroResolvido: numero };
    if (resultado.exists === false) {
      capturarAviso(`[whatsappService] Número ${numero} não existe no WhatsApp segundo a Evolution API.`);
      return { jid: numero, numeroResolvido: numero };
    }
    return { jid: resultado.jid || numero, numeroResolvido: resultado.number || numero };
  } catch (err) {
    capturarAviso(`[whatsappService] Falha ao resolver JID de ${numero} antes do envio: ${err.message}`);
    return { jid: numero, numeroResolvido: numero };
  }
}

/**
 * Trava de segurança: nunca manda mensagem pro próprio número conectado ao
 * bot, nem que a resolução de JID (função acima) tenha apontado pra ele por
 * engano — foi exatamente isso que causou o aviso de agendamento/
 * encaminhamento "voltando" pro número do bot em vez de ir pro da recepção.
 * Checa tanto o número original quanto o que a Evolution API resolveu,
 * porque um mismatch entre os dois é justamente o sintoma do bug.
 */
function recusarSeForOProprioBot(numeroOriginal, numeroResolvido) {
  const destino = normalizarTelefone(numeroResolvido || numeroOriginal);
  if (NUMERO_CONECTADO_BOT && destino === NUMERO_CONECTADO_BOT) {
    throw new Error(
      `[whatsappService] Envio bloqueado: destino (${numeroOriginal} → resolvido ${numeroResolvido}) é o próprio número conectado ao bot.`
    );
  }
}

/**
 * Envia uma mensagem de texto simples para um número via Evolution API.
 * @param {string} telefone - número com DDI, ex: "5511988887777"
 * @param {string} texto
 */
export async function enviarMensagem(telefone, texto) {
  const numero = normalizarTelefone(telefone);
  const { jid, numeroResolvido } = await resolverJid(numero);
  recusarSeForOProprioBot(numero, numeroResolvido);
  registrarEnvioIminente(numero);

  await evolutionApi.post(`/chat/sendPresence/${evolutionInstance}`, {
    number: jid,
    presence: "composing",
    delay: DELAY_DIGITANDO_MS,
  });
  await esperar(DELAY_DIGITANDO_MS);

  const { data } = await evolutionApi.post(
    `/message/sendText/${evolutionInstance}`,
    { number: jid, text: texto },
    { semRetryEmFalhaTransitoria: true }
  );

  registrarMensagemEnviada(data?.key?.id);
}

/**
 * Envia uma imagem (base64) para um número via Evolution API — usado para
 * encaminhar a foto do encaminhamento médico à equipe da clínica.
 * @param {string} telefone - número com DDI, ex: "5511988887777"
 * @param {{ base64: string, mimetype?: string, caption?: string, fileName?: string }} imagem
 */
export async function enviarImagem(telefone, { base64, mimetype, caption, fileName }) {
  const numero = normalizarTelefone(telefone);
  const { jid, numeroResolvido } = await resolverJid(numero);
  recusarSeForOProprioBot(numero, numeroResolvido);
  registrarEnvioIminente(numero);

  const { data } = await evolutionApi.post(
    `/message/sendMedia/${evolutionInstance}`,
    {
      number: jid,
      mediatype: "image",
      mimetype: mimetype || "image/jpeg",
      caption,
      media: base64,
      fileName: fileName || "encaminhamento.jpg",
    },
    { semRetryEmFalhaTransitoria: true }
  );

  registrarMensagemEnviada(data?.key?.id);
}

/**
 * Envia um documento (base64) para um número via Evolution API — mesmo
 * endpoint sendMedia de enviarImagem, só troca mediatype pra "document".
 * Usado pra mandar PDF (ex: controle de sessões) direto pro WhatsApp do
 * paciente, pra recepção que não quiser imprimir.
 * @param {string} telefone - número com DDI, ex: "5511988887777"
 * @param {{ base64: string, mimetype?: string, caption?: string, fileName: string }} documento
 */
export async function enviarDocumento(telefone, { base64, mimetype, caption, fileName }) {
  const numero = normalizarTelefone(telefone);
  const { jid, numeroResolvido } = await resolverJid(numero);
  recusarSeForOProprioBot(numero, numeroResolvido);
  registrarEnvioIminente(numero);

  const { data } = await evolutionApi.post(
    `/message/sendMedia/${evolutionInstance}`,
    {
      number: jid,
      mediatype: "document",
      mimetype: mimetype || "application/pdf",
      caption,
      media: base64,
      fileName,
    },
    { semRetryEmFalhaTransitoria: true }
  );

  registrarMensagemEnviada(data?.key?.id);
}
