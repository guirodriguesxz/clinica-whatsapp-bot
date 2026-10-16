import axios from "axios";
import { capturarAviso } from "./sentry.js";

const { EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE_NAME } = process.env;

if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY || !EVOLUTION_INSTANCE_NAME) {
  capturarAviso(
    "[evolutionApi] Variáveis EVOLUTION_API_URL / EVOLUTION_API_KEY / EVOLUTION_INSTANCE_NAME não configuradas."
  );
}

export const evolutionApi = axios.create({
  baseURL: EVOLUTION_API_URL,
  headers: {
    apikey: EVOLUTION_API_KEY,
    "Content-Type": "application/json",
  },
  timeout: 15000,
});

// Timeout e erro 5xx contra a Evolution API costumam ser instabilidade
// pontual do gateway self-hosted (ou do arquivo de mídia sendo processado) —
// vale tentar de novo antes de propagar o erro. 4xx é erro de config/payload,
// não se resolve tentando de novo.
const MAX_TENTATIVAS_TRANSITORIO = 2;
const BACKOFF_BASE_MS = 300;

function ehErroTransitorio(err) {
  if (!err.response) return true; // timeout ou falha de rede: sem status
  return err.response.status >= 500;
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

evolutionApi.interceptors.response.use(undefined, async (err) => {
  const config = err.config;
  const tentativa = (config?._tentativaRetry ?? 0) + 1;

  // Endpoints que efetivamente mandam algo pro WhatsApp (sendText/sendMedia)
  // marcam semRetryEmFalhaTransitoria: um timeout não prova que a Evolution
  // API não processou o envio — pode só ter demorado a responder. Repetir a
  // mesma call nesse caso arrisca mandar a MESMA mensagem duas vezes pro
  // paciente (caso real: paciente recebeu a saudação duplicada). Pra esses
  // endpoints, uma falha (mesmo transitória) propaga pro chamador em vez de
  // tentar de novo — melhor exigir reenvio manual do que duplicar.
  if (config?.semRetryEmFalhaTransitoria) {
    throw err;
  }

  if (!config || !ehErroTransitorio(err) || tentativa > MAX_TENTATIVAS_TRANSITORIO) {
    throw err;
  }

  config._tentativaRetry = tentativa;
  capturarAviso(
    `[evolutionApi] Erro transitório em ${config.method?.toUpperCase()} ${config.url} (tentativa ${tentativa}/${MAX_TENTATIVAS_TRANSITORIO}), tentando de novo: ${err.message}`
  );
  await esperar(BACKOFF_BASE_MS * 2 ** (tentativa - 1));
  return evolutionApi(config);
});

export const evolutionInstance = EVOLUTION_INSTANCE_NAME;
