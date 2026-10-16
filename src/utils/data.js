// src/utils/data.js
import dayjs from "./dayjs.js";
import { CLINICA } from "../config/clinica.js";

/**
 * Formata um timestamp (Date do pg, string ISO, etc.) como DD/MM/AAAA às
 * HH:mm no fuso da clínica, em português.
 *
 * Por quê: colunas timestamptz (created_at, registrado_em) chegam do driver
 * pg como objeto Date do JS. Interpolar isso direto numa view EJS chama
 * Date.prototype.toString(), que produz texto em inglês no fuso do
 * servidor (ex: "Thu Aug 27 2026 18:48:07 GMT-0300 (Horário Padrão de
 * Brasília)") em vez de um formato legível pra recepção.
 */
export function formatarDataHora(valor) {
  if (!valor) return "";
  const data = dayjs(valor).tz(CLINICA.timezone);
  if (!data.isValid()) return "";
  return data.format("DD/MM/YYYY [às] HH:mm");
}

/**
 * Formata uma data (sem hora) como DD/MM/AAAA — usado pra colunas DATE
 * (ex: pacientes.data_nascimento), que o driver pg devolve como string
 * "YYYY-MM-DD" pura (ver types.setTypeParser em src/db/pool.js), nunca
 * como objeto Date. Diferente de formatarDataHora, não aplica fuso
 * horário — uma data sem componente de hora não tem o que converter, e
 * usar .tz() aqui arriscaria deslocar o dia. Strings são formatadas direto;
 * Date objects são interpretadas como UTC pra evitar shift por timezone local.
 */
export function formatarData(valor) {
  if (!valor) return "";
  const data = dayjs(valor).utc();
  if (!data.isValid()) return "";
  return data.format("DD/MM/YYYY");
}

/**
 * Mesma entrada de formatarData (coluna DATE, string "YYYY-MM-DD" pura ou
 * Date), mas por extenso em português — ex: "28 de maio de 2026". Usado na
 * tela /agendamentos a pedido do usuário, no lugar do DD/MM/AAAA compacto
 * usado no resto do dashboard.
 */
export function formatarDataExtensa(valor) {
  if (!valor) return "";
  const data = dayjs(valor).utc();
  if (!data.isValid()) return "";
  return data.format("D [de] MMMM [de] YYYY");
}

/**
 * Cabeçalho de dia usado pra agrupar visualmente a tela /agendamentos (ex:
 * "Quinta-feira, 10 de setembro") — sem ano, porque nesse contexto o dia já
 * está sempre próximo (é a lista de agendamentos futuros). Mesma entrada de
 * formatarData/formatarDataExtensa.
 */
export function formatarDataComDiaSemana(valor) {
  if (!valor) return "";
  const data = dayjs(valor).utc();
  if (!data.isValid()) return "";
  const texto = data.format("dddd, D [de] MMMM");
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
