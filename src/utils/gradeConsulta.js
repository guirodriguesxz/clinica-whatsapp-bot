// Lógica pura de grade de horários — extraída de calendarService.js pra
// poder ser reusada também por agendamentoModel.js (trava de capacidade no
// INSERT, ver inserirAgendamento) sem esse importar o service inteiro.
import { CLINICA } from "../config/clinica.js";
import dayjs from "./dayjs.js";

// Quantos slots consecutivos da grade uma consulta desse tipo ocupa —
// Fisioterapia dura o mesmo que o intervalo (1 slot, comportamento
// inalterado); Psicologia dura 40min numa grade de 30min, então ocupa o
// slot escolhido + o seguinte (2 slots, decisão do usuário em 2026-09-03:
// bloquear 2 slots cobre os 40min reais com folga, em vez de calcular a
// sobreposição pela duração exata).
export function slotsOcupadosPelaConsulta(tipoAtendimento) {
  const duracao = CLINICA.duracaoConsultaMinutos[tipoAtendimento] ?? 30;
  return Math.ceil(duracao / CLINICA.intervaloSlotsMinutos);
}

// Horários vizinhos de `hora` que precisam ser checados pra saber se um
// novo agendamento em `hora` colide com um já existente — inclui `hora`
// em si. Pra nSlots=1 (Fisioterapia) é só [hora]; pra nSlots=2 (Psicologia)
// é [hora - intervalo, hora, hora + intervalo], porque tanto um
// agendamento existente que começou um slot antes (e ainda estaria em
// andamento) quanto um que começa um slot depois (e nosso novo agendamento
// invadiria) bloqueiam `hora`.
export function horariosVizinhos(hora, nSlots) {
  const intervalo = CLINICA.intervaloSlotsMinutos;
  const base = dayjs().hour(Number(hora.slice(0, 2))).minute(Number(hora.slice(3, 5)));
  const horarios = [];
  for (let k = -(nSlots - 1); k <= nSlots - 1; k++) {
    horarios.push(base.add(k * intervalo, "minute").format("HH:mm"));
  }
  return horarios;
}
