// Emoji (faixas comuns de WhatsApp) — removido antes de checar confirmação,
// já que "👍" sozinho já conta como confirmação pura.
const REGEX_EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu;

// Saudação sozinha ("oi", "bom dia") NÃO conta como confirmação — paciente
// novo pode só estar cumprimentando. Só conta quando vem junto de uma
// confirmação de verdade (ex: "bom dia ok confirmado").
const REGEX_SAUDACAO_INICIAL = /^(?:bom\s*dia|boa\s*tarde|boa\s*noite|oi+|ol[áa])(?:\s+|$)/i;

// Termos que, sozinhos ou em sequência, fecham uma conversa sem pedir nada
// novo. Agradecimento, desculpa e retribuição ("igualmente", "vc também")
// entraram depois de casos reais (2026-09-23) em que o bot respondia cada
// um deles com mais uma mensagem, numa conversa que já tinha terminado.
const TERMOS_CONFIRMACAO = [
  "ok",
  "okay",
  "okey",
  "blz",
  "beleza",
  "certo",
  "combinado",
  "confirmad[oa]",
  "obrigad[oa]",
  "obg",
  "valeu",
  "muit[oa]",
  "muit[íi]ssim[oa]",
  "agrade[çc]o",
  "grat[oa]",
  "igualmente",
  "nossa",
  "desculp[ae]s?",
  "perd[ãa]o",
  "me\\s+perdo[ae]",
  "(?:vc|voc[êe])\\s+tamb[ée]m",
  "at[ée]\\s*l[áa]",
  "at[ée]\\s*mais(?:\\s+tarde)?",
  "at[ée]\\s*amanh[ãa]",
  "t[áa]\\s*bom",
  "t[áa]",
].join("|");

const REGEX_CONFIRMACAO = new RegExp(`^(?:${TERMOS_CONFIRMACAO})(?:\\s+(?:${TERMOS_CONFIRMACAO}))*$`, "i");

// "Tudo bem" / "tudo certo" só fecham a conversa quando NÃO vêm como pergunta
// — "Tudo bem?" é cumprimento e merece resposta. Caso real 2026-10-02: a
// equipe confirmou o horário, a paciente respondeu "Tudo bem" e o bot mandou
// mais um "Recebido! Se precisar de mais alguma coisa, é só chamar."
const TERMOS_CONFIRMACAO_SEM_PERGUNTA = `${TERMOS_CONFIRMACAO}|tudo\\s+(?:bem|certo|ok)|perfeito|fechado`;
const REGEX_CONFIRMACAO_SEM_PERGUNTA = new RegExp(
  `^(?:${TERMOS_CONFIRMACAO_SEM_PERGUNTA})(?:\\s+(?:${TERMOS_CONFIRMACAO_SEM_PERGUNTA}))*$`,
  "i"
);

// Cumprimentos comuns de primeira mensagem — usados por ehSoSaudacao pra
// decidir se o contato novo só cumprimentou (recebe o texto fixo de
// boas-vindas) ou já chegou com uma pergunta/pedido (a IA responde).
const REGEX_TRECHO_SAUDACAO =
  /^(?:bom\s*dia|boa\s*tarde|boa\s*noite|oi+e*|ol[áa]+|al[ôo]|hello|e\s*a[ií]|tudo\s*(?:bem|bom|certo|joia|jóia)|td\s*(?:bem|bom)|como\s*vai|como\s*est[áa]|pessoal|gente|equipe|fisio\s*life|cl[íi]nica)(?:\s+|$)/i;

/**
 * Detecta mensagem que é só cumprimento (ex: "Boa tarde", "Olá, tudo bem?",
 * "Oi 😊"), sem nenhuma pergunta ou pedido. Mensagem vazia não conta.
 */
export function ehSoSaudacao(texto) {
  if (!texto?.trim()) return false;

  let resto = texto
    .replace(REGEX_EMOJI, " ")
    .replace(/[!.?,;:~*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!resto) return false; // só emoji — não é cumprimento

  let anterior;
  do {
    anterior = resto;
    resto = resto.replace(REGEX_TRECHO_SAUDACAO, "").trim();
  } while (resto && resto !== anterior);

  return !resto;
}

/**
 * Detecta mensagem que é só confirmação/agradecimento/despedida (ex: "ok",
 * "confirmado", "até lá", "bom dia ok confirmado", "👍") — sem pergunta nem
 * pedido novo. Determinístico (não depende do modelo), pra garantir que o
 * bot fica em silêncio nesses casos mesmo quando o modelo erraria a
 * interpretação (ex: tratar "até lá" como início de conversa nova).
 */
export function ehMensagemSoConfirmacao(texto) {
  if (!texto?.trim()) return false;

  const normalizado = texto
    .replace(REGEX_EMOJI, " ")
    .replace(/[!.?,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalizado) return true; // mensagem era só emoji

  const semSaudacao = normalizado.replace(REGEX_SAUDACAO_INICIAL, "").trim();
  if (!semSaudacao) return false; // era só saudação, sem confirmação nenhuma

  // "Oi, tudo bem" também é cumprimento, não fechamento.
  const veioComoCumprimento = texto.includes("?") || semSaudacao !== normalizado;
  const regex = veioComoCumprimento ? REGEX_CONFIRMACAO : REGEX_CONFIRMACAO_SEM_PERGUNTA;
  return regex.test(semSaudacao);
}
