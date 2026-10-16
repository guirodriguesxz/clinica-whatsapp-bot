import dayjs from "./dayjs.js";

export const TIPOS_ATENDIMENTO_VALIDOS = ["fisioterapia", "psicologia"];

const REGEX_DATA = /^\d{4}-\d{2}-\d{2}$/;
const REGEX_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validarData(data) {
  if (typeof data !== "string" || !REGEX_DATA.test(data)) return false;
  // dayjs "arredonda" datas impossíveis (ex: 2026-02-30 vira 2026-03-02) em
  // vez de invalidar — comparar o round-trip pega esse caso sem precisar de
  // um plugin de parsing estrito.
  return dayjs(data, "YYYY-MM-DD").format("YYYY-MM-DD") === data;
}

export function validarHora(hora) {
  return typeof hora === "string" && REGEX_HORA.test(hora);
}

export function validarTipoAtendimento(tipo) {
  return TIPOS_ATENDIMENTO_VALIDOS.includes(tipo);
}
