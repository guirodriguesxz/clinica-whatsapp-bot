import { NOMES_TIPO_ATENDIMENTO } from "../utils/tipoAtendimento.js";
import { CLINICA } from "../config/clinica.js";

// ATENÇÃO: revise esse texto com a clínica antes de usar em produção — é a
// mensagem que o paciente de verdade recebe (mesmo cuidado do lembrete de
// consulta, ver lembreteService.js).
export function montarMensagemConfirmacao({ paciente_nome: nome, tipo_atendimento: tipoAtendimento, data, hora }) {
  const tipo = NOMES_TIPO_ATENDIMENTO[tipoAtendimento] ?? tipoAtendimento;
  const [ano, mes, dia] = data.split("-");
  const dataFormatada = `${dia}/${mes}/${ano}`;
  const horaFormatada = String(hora).slice(0, 5);

  return (
    `Olá, ${nome}! Sua consulta de ${tipo} na ${CLINICA.nome} foi confirmada para ${dataFormatada} às ${horaFormatada}. ` +
    `Até lá!`
  );
}
