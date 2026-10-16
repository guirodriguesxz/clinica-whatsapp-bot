import dayjs from "../utils/dayjs.js";
import { CLINICA, TELEFONES_SEM_ATENDIMENTO_AUTOMATICO } from "../config/clinica.js";
import { ehFeriado } from "../utils/feriados.js";
import { formatarTelefoneExibicao } from "../utils/phone.js";
import { capitalizarNome } from "../utils/nome.js";
import { enviarMensagem } from "./whatsappService.js";
import { buscarUltimaMensagemHumanaPorPaciente } from "../models/conversaModel.js";
import { capturarAviso } from "../config/sentry.js";

// Caso real 2026-10-05/07: paciente (Plena Saúde, Psicologia) mandou mensagem
// fora do expediente — o bot fica calado de propósito — e a recepção só
// respondeu mais de um dia depois. Resumo (em vez de alerta por mensagem) em
// horários fixos: não precisa guardar estado pra não repetir aviso, e uma
// pergunta respondida logo depois do resumo some do próximo sozinho.
const HORAS_MINIMAS_SEM_RESPOSTA = 2;
const DIAS_MAXIMOS = 3;
const MAXIMO_NA_LISTA = 15;
const TRECHO_MAXIMO = 80;

// Mensagens que encerram a conversa (agradecimento, "ok", "vc também", saudação,
// só emoji) não esperam resposta — sem esse filtro o resumo viria cheio de
// "obrigada" (visto no teste com dados reais, 2026-10-07: 12 de 12 eram isso).
// Regra geral em vez de lista fechada: curta, sem "?", com uma palavra de
// encerramento e sem nenhuma palavra de pedido/dúvida.
const MAXIMO_PALAVRAS_ENCERRAMENTO = 8;
const PALAVRA_DE_ENCERRAMENTO =
  /^(obrigad|grat|valeu|ok$|okay|combinado|certo|blz|beleza|perfeito|otimo|excelente|igualmente|disponha|tbm|tambem|ate$|amem|tchau|ola$|oi+$|bom$|boa$|abraco|beijo|show|top)/;
const PALAVRA_DE_PEDIDO =
  /^(preciso|gostaria|queria|quero|pode|podem|consegu|vaga|horario|agend|remarc|cancel|desmarc|falt|vou$|nao$|tem$|posso|valor|preco|quanto|onde|qual|quando|como|convenio|endereco|duvida|pergunt|problema|ajuda)/;

export function ehMensagemDeEncerramento(texto) {
  if (String(texto || "").includes("?")) return false;
  const tokens = String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/([a-z])\1{2,}/g, "$1")
    .split(/\s+/)
    .filter(Boolean);
  // Só emoji/pontuação (sem nenhuma letra) também não pede resposta.
  if (tokens.length === 0) return true;
  if (tokens.length > MAXIMO_PALAVRAS_ENCERRAMENTO) return false;
  if (tokens.some((t) => PALAVRA_DE_PEDIDO.test(t))) return false;
  return tokens.some((t) => PALAVRA_DE_ENCERRAMENTO.test(t));
}

function textoDeFoto(texto) {
  return /^\[Paciente enviou (uma foto|um arquivo|um áudio)/i.test(texto || "");
}

function trecho(texto) {
  if (textoDeFoto(texto)) return "📎 enviou foto/documento";
  const limpo = String(texto || "").replace(/\s+/g, " ").trim();
  return limpo.length > TRECHO_MAXIMO ? `${limpo.slice(0, TRECHO_MAXIMO - 1)}…` : limpo;
}

function haQuanto(minutos) {
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `${horas}h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? "1 dia" : `${dias} dias`;
}

/**
 * Pacientes cuja última mensagem "humana" (paciente ou equipe — o bot não
 * conta) é do paciente, com pelo menos HORAS_MINIMAS_SEM_RESPOSTA horas.
 */
export function filtrarSemResposta(linhas, agora = dayjs()) {
  const ignorados = TELEFONES_SEM_ATENDIMENTO_AUTOMATICO.filter(Boolean);
  return linhas
    .filter((l) => l.remetente === "paciente")
    .filter((l) => !ignorados.includes(l.telefone))
    .filter((l) => !ehMensagemDeEncerramento(l.mensagem) || textoDeFoto(l.mensagem))
    .map((l) => ({ ...l, minutos: agora.diff(dayjs(l.timestamp), "minute") }))
    .filter((l) => l.minutos >= HORAS_MINIMAS_SEM_RESPOSTA * 60)
    .sort((a, b) => b.minutos - a.minutos);
}

export function montarResumoSemResposta(itens) {
  if (itens.length === 0) return null;
  const linhas = itens.slice(0, MAXIMO_NA_LISTA).map((i) => {
    const nome = capitalizarNome(i.nome || "Paciente");
    return `• ${nome} (${formatarTelefoneExibicao(i.telefone)}) — há ${haQuanto(i.minutos)}: "${trecho(i.mensagem)}"`;
  });
  const resto = itens.length - MAXIMO_NA_LISTA;
  const cabecalho = `📭 *${itens.length} ${itens.length === 1 ? "paciente aguardando" : "pacientes aguardando"} resposta da equipe*`;
  return [cabecalho, "", ...linhas, ...(resto > 0 ? [`… e mais ${resto}.`] : [])].join("\n");
}

/**
 * Roda em horários fixos (ver server.js). Só em dia útil e só se houver
 * alguém esperando; manda o resumo pro mesmo telefone dos demais alertas.
 */
export async function enviarResumoSemResposta(agora = dayjs().tz(CLINICA.timezone)) {
  if (CLINICA.diasFechados.includes(agora.day()) || ehFeriado(agora)) return;
  const telefone = process.env.ATENDENTE_HUMANO_TELEFONE;
  if (!telefone) return;

  const linhas = await buscarUltimaMensagemHumanaPorPaciente(DIAS_MAXIMOS);
  const resumo = montarResumoSemResposta(filtrarSemResposta(linhas, agora));
  if (!resumo) return;

  try {
    await enviarMensagem(telefone, resumo);
  } catch (err) {
    capturarAviso(`[semRespostaService] Não consegui enviar o resumo por WhatsApp: ${err.message}`);
  }
}
