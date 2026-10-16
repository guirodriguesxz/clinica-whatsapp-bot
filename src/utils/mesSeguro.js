// src/utils/mesSeguro.js
import dayjs from "./dayjs.js";

// Restrito a anos plausíveis (1900-2099): um ano fora disso (ex: "0000-01")
// passava no formato \d{4} e no dayjs().isValid(), mas o dayjs subsequente
// trata datas de início/fim de forma inconsistente pra esses anos, gerando
// datas divergentes que o Postgres acaba rejeitando (500 cru em vez do
// fallback pro mês atual, que já existe pra mês fora de 01-12).
const REGEX_MES = /^(19|20)\d{2}-(0[1-9]|1[0-2])$/;

/**
 * Resolve um "mes" de query string (formato YYYY-MM) pra um valor seguro de
 * usar num filtro `data >= inicio AND data < fimExclusivo` — cai pro mês
 * atual (fuso America/Sao_Paulo) quando o valor recebido é ausente, mal
 * formatado, ou tem mês/ano fora do intervalo plausível. Extraído pra cá
 * (em vez de duplicado por módulo) porque já teve 2 bugs reais corrigidos
 * nessa lógica (mês fora de 01-12, ano implausível) — duplicar arrisca
 * reintroduzir um dos dois em outro lugar.
 */
export function mesSeguro(mes) {
  if (
    typeof mes === "string" &&
    REGEX_MES.test(mes) &&
    dayjs(`${mes}-01`, "YYYY-MM-DD").isValid()
  ) {
    return mes;
  }
  return dayjs().tz("America/Sao_Paulo").format("YYYY-MM");
}
