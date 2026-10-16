import { processarMensagemRecebida, PAUSADO_ATENDIMENTO_HUMANO } from "../services/chatService.js";
import { enviarMensagem } from "../services/whatsappService.js";
import { transcreverAudio } from "../services/transcricaoService.js";
import { processarFotoEncaminhamento } from "../services/encaminhamentoMedicoService.js";
import { processarMensagemManualEquipe } from "../services/agendamentoManualService.js";
import { normalizarTelefone } from "../utils/phone.js";
import { TELEFONES_SEM_ATENDIMENTO_AUTOMATICO } from "../config/clinica.js";
import { foiEnviadaPeloBot } from "../utils/mensagensDoBot.js";
import { comLock } from "../utils/mutex.js";
import { ehMensagemAntiga } from "../utils/mensagemAntiga.js";
import { marcarMensagemComoProcessada } from "../models/webhookModel.js";
import { encontrarOuCriarPaciente, atualizarEtapaPaciente } from "../models/pacienteModel.js";
import { capturarErro } from "../config/sentry.js";

const MENSAGEM_FALLBACK_ERRO =
  "Desculpe, tivemos um problema técnico ao processar sua mensagem. Tente novamente em alguns instantes.";

const MENSAGEM_MIDIA_NAO_SUPORTADA =
  "Por enquanto só consigo entender mensagens de texto. Pode escrever sua dúvida ou pedido?";

const MENSAGEM_AUDIO_FALHOU =
  "Não consegui entender seu áudio agora. Pode tentar de novo ou escrever sua mensagem?";

const TIPOS_MIDIA_NAO_SUPORTADA = ["videoMessage", "documentMessage", "stickerMessage"];

// A foto pode ser pedido médico, comprovante de pagamento, carteirinha... —
// o bot não sabe qual é, então descreve de forma genérica e repassa a
// legenda (se houver) pra IA responder de acordo.
const TEXTO_POR_RESULTADO_FOTO = {
  pendente: "Ela será repassada à equipe.",
  encaminhado: "A equipe da clínica já recebeu e vai conferir.",
  falhou:
    "Não foi possível repassar para a equipe agora — avise que a equipe vai conferir por outro meio.",
};

function textoDaFotoParaIA(resultado, legenda) {
  const situacao = TEXTO_POR_RESULTADO_FOTO[resultado] ?? TEXTO_POR_RESULTADO_FOTO.falhou;
  const comLegenda = legenda?.trim() ? ` Legenda do paciente: "${legenda.trim()}".` : "";
  return `[Paciente enviou uma foto (pode ser pedido médico, comprovante de pagamento, carteirinha ou outro documento — não presuma qual).${comLegenda} ${situacao}]`;
}

function extrairTexto(message) {
  if (!message) return null;
  return (
    message.conversation ??
    message.extendedTextMessage?.text ??
    message.buttonsResponseMessage?.selectedDisplayText ??
    message.listResponseMessage?.title ??
    null
  );
}

// Saudação e mensagem de ausência automáticas do WhatsApp Business saem do
// número conectado como fromMe, iguais a uma mensagem manual — mas ninguém da
// equipe está atendendo. Sem esse filtro, a saudação pausava o bot logo na
// primeira mensagem do paciente (caso real 2026-10-01: uma paciente recebeu a pergunta
// de idade do bot e depois silêncio, e o histórico ficava com boas-vindas em
// dobro).
const MARCADORES_MENSAGEM_AUTOMATICA_WHATSAPP_BUSINESS = [
  /^seja muito bem-vindo\(a\) à clínica exemplo![\s\S]*como podemos ajudar\?\s*$/i,
  /no momento estamos fora do nosso horário de atendimento/i,
];

export function ehMensagemAutomaticaWhatsappBusiness(texto) {
  const t = texto?.trim();
  return !!t && MARCADORES_MENSAGEM_AUTOMATICA_WHATSAPP_BUSINESS.some((re) => re.test(t));
}

function ehMidiaNaoSuportada(message) {
  return !!message && TIPOS_MIDIA_NAO_SUPORTADA.some((tipo) => message[tipo]);
}

export async function receberWebhook(req, res) {
  // Responde de imediato: a Evolution API reenvia o webhook (retry) se não
  // receber 2xx rápido, o que duplicaria o processamento da mensagem.
  res.sendStatus(200);

  const { event, data } = req.body ?? {};

  if (event !== "messages.upsert" || !data) return;

  const remoteJid = data.key?.remoteJid;
  const fromMe = data.key?.fromMe;
  const isGroup = remoteJid?.endsWith("@g.us");

  if (!remoteJid || isGroup) return;

  const telefone = normalizarTelefone(remoteJid);

  if (fromMe) {
    // A Evolution API ecoa de volta, também como fromMe:true, toda mensagem
    // que o próprio bot manda (enviarMensagem/enviarImagem) — indistinguível
    // de uma mensagem manual no payload. Sem checar o registro de mensagens
    // do bot aqui, o bot se pausaria sozinho assim que respondesse a
    // primeira mensagem de qualquer conversa.
    if (foiEnviadaPeloBot(data.key?.id, telefone)) return;
    if (ehMensagemAutomaticaWhatsappBusiness(extrairTexto(data.message))) return;

    // Mesma idempotência do bloco de mensagem do paciente mais abaixo — a
    // Evolution API pode reentregar o mesmo evento, e agora esse bloco tem
    // efeito colateral real (grava mensagem, pode criar agendamento).
    const waMessageIdEquipe = data.key?.id;
    if (waMessageIdEquipe) {
      try {
        const inedita = await marcarMensagemComoProcessada(waMessageIdEquipe);
        if (!inedita) return;
      } catch (err) {
        capturarErro("[webhook] Falha ao checar idempotência da mensagem manual da equipe:", err);
      }
    }

    // Mensagem enviada manualmente do número conectado (não pelo bot) — a
    // equipe está atendendo essa conversa direto pelo WhatsApp. Pausa o
    // atendimento automático pra sempre nessa conversa, pra não atropelar
    // quem já está respondendo. Se der pra extrair texto, também registra a
    // mensagem e roda a detecção de agendamento combinado manualmente (ver
    // agendamentoManualService.js) — sobe sozinho pro Google Agenda sem
    // precisar avisar o paciente, já que a equipe já está falando com ele.
    // A pausa roda dentro do mesmo lock por telefone do processamento da
    // mensagem do paciente: sem isso, equipe e paciente escrevendo no mesmo
    // segundo (caso real 2026-10-07, paciente 310, 16:28:18) faziam o chatService
    // ler a pausa antiga, achar que ela tinha expirado, responder por cima da
    // equipe E zerar a etapa — a pausa nova se perdia.
    try {
      await comLock(telefone, async () => {
        const pacientePausado = await encontrarOuCriarPaciente({ nome: null, telefone });
        if (pacientePausado.etapa_atual !== PAUSADO_ATENDIMENTO_HUMANO) {
          await atualizarEtapaPaciente(pacientePausado.id, PAUSADO_ATENDIMENTO_HUMANO);
        }
        const textoEquipe = extrairTexto(data.message);
        if (textoEquipe) {
          await processarMensagemManualEquipe({
            pacienteId: pacientePausado.id,
            telefone,
            texto: textoEquipe,
            nomePaciente: pacientePausado.nome,
          });
        }
      });
    } catch (err) {
      capturarErro("[webhook] Falha ao pausar atendimento automático após mensagem manual:", err);
    }
    return;
  }

  // Mesmo respondendo 200 rápido, a Evolution API pode reentregar o mesmo
  // evento por instabilidade de rede — sem checar o ID da mensagem,
  // reprocessaríamos (e poderíamos até reagendar) a mesma mensagem do
  // paciente duas vezes.
  const waMessageId = data.key?.id;
  if (waMessageId) {
    try {
      const inedita = await marcarMensagemComoProcessada(waMessageId);
      if (!inedita) return;
    } catch (err) {
      capturarErro("[webhook] Falha ao checar idempotência da mensagem:", err);
      // Segue o processamento — melhor arriscar duplicar do que travar o
      // atendimento por um problema pontual no banco.
    }
  }

  // Contato interno da equipe mandando pelo próprio número (não pelo número
  // conectado do bot, senão cairia no bloco fromMe acima): não é paciente,
  // então nem imagem (encaminhamento médico) nem texto devem virar
  // atendimento automático ou repasse pra recepção.
  if (TELEFONES_SEM_ATENDIMENTO_AUTOMATICO.includes(telefone)) return;

  // Mensagem que chegou com o PC desligado (entregue em lote quando ele liga)
  // — fica pra recepção, ver mensagemAntiga.js.
  if (ehMensagemAntiga(data.messageTimestamp)) return;

  const nomeContato = data.pushName ?? null;
  let texto = extrairTexto(data.message);

  if (!texto && data.message?.audioMessage) {
    try {
      texto = await transcreverAudio(data.key, data.message.audioMessage);
    } catch (err) {
      capturarErro("[webhook] Falha ao transcrever áudio:", err);
    }
    if (!texto) {
      try {
        await enviarMensagem(telefone, MENSAGEM_AUDIO_FALHOU);
      } catch (err) {
        capturarErro("[webhook] Falha ao avisar sobre falha na transcrição:", err);
      }
      return;
    }
  }

  if (!texto && data.message?.imageMessage) {
    // O bot não tem como validar o documento sozinho — a foto é gravada
    // como pendente (pra juntar com a notificação de agendamento, se um for
    // criado logo em seguida) e a conversa segue normalmente, com uma nota
    // sintética no lugar do texto (não há legenda/texto real).
    let pacienteIdFoto = null;
    let nomePacienteFoto = nomeContato;
    try {
      const pacienteFoto = await encontrarOuCriarPaciente({ nome: nomeContato, telefone });
      pacienteIdFoto = pacienteFoto.id;
      nomePacienteFoto = pacienteFoto.nome ?? nomeContato;
    } catch (err) {
      capturarErro(
        "[webhook] Falha ao resolver paciente para a foto de encaminhamento — tentando repasse imediato:",
        err
      );
      // pacienteIdFoto continua null: registrarFotoPendente falha (paciente_id
      // é obrigatório) e processarFotoEncaminhamento cai pro repasse imediato.
    }
    const resultadoFoto = await processarFotoEncaminhamento({
      messageKey: data.key,
      imageMessage: data.message.imageMessage,
      pacienteId: pacienteIdFoto,
      nomePaciente: nomePacienteFoto,
      telefone,
    });
    texto = textoDaFotoParaIA(resultadoFoto, data.message.imageMessage.caption);
  }

  if (!texto) {
    if (ehMidiaNaoSuportada(data.message)) {
      try {
        await enviarMensagem(telefone, MENSAGEM_MIDIA_NAO_SUPORTADA);
      } catch (err) {
        capturarErro("[webhook] Falha ao avisar sobre mídia não suportada:", err);
      }
    }
    return;
  }

  try {
    // Serializa mensagens do mesmo paciente: se ele mandar duas mensagens em
    // sequência rápida, a segunda só começa a ser processada depois que a
    // primeira já registrou sua resposta — evita respostas fora de ordem e
    // reduz a corrida em cima do mesmo horário de agendamento.
    await comLock(telefone, () => processarMensagemRecebida({ telefone, texto, nomeContato }));
  } catch (err) {
    capturarErro("[webhook] Erro ao processar mensagem:", err);
    try {
      await enviarMensagem(telefone, MENSAGEM_FALLBACK_ERRO);
    } catch (errEnvio) {
      capturarErro("[webhook] Falha ao enviar mensagem de fallback:", errEnvio);
    }
  }
}
