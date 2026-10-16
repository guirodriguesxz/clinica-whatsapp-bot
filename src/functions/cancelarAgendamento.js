import {
  buscarProximoAgendamentoConfirmado,
  buscarAgendamentoConfirmadoPorId,
  cancelarAgendamento as cancelarAgendamentoNoBanco,
} from "../models/agendamentoModel.js";
import { buscarProximoAgendamentoImportado } from "../models/agendamentoImportadoModel.js";

const MOTIVO_SO_AGENDAMENTO_IMPORTADO =
  "Esse paciente não tem nenhum agendamento feito pelo bot para cancelar — a consulta dele foi marcada fora do bot (sistema interno da clínica). NÃO tente de novo por aqui: oriente o paciente a confirmar o cancelamento diretamente com a recepção da clínica.";

/**
 * Handler da function cancelar_agendamento. Sem agendamento_id, cancela o
 * próximo agendamento CONFIRMADO do paciente (caso comum: só uma consulta
 * marcada). Com agendamento_id — obtido de uma listagem anterior via
 * listar_agendamentos, para o caso de o paciente ter mais de uma consulta
 * marcada e querer cancelar uma que não seja a próxima —, o ID é sempre
 * validado contra o pacienteId do contexto antes de cancelar, nunca aceito
 * "cru" do que o modelo disser.
 */
export async function cancelarAgendamento({ agendamento_id } = {}, { pacienteId, telefone }) {
  const agendamento = agendamento_id
    ? await buscarAgendamentoConfirmadoPorId(agendamento_id, pacienteId)
    : await buscarProximoAgendamentoConfirmado(pacienteId);

  if (!agendamento) {
    // A instrução no prompt já pede pra não chamar essa function em cima de
    // consulta importada (ver systemPrompt.js), mas o modelo às vezes chama
    // mesmo assim — essa checagem é a rede de segurança em código: se não
    // achou nada do bot mas existe um agendamento importado pra esse
    // telefone, devolve um motivo específico em vez do genérico "não achei
    // nada", pra não gerar uma resposta confusa pro paciente.
    const agendamentoImportado = await buscarProximoAgendamentoImportado(telefone);
    return {
      sucesso: false,
      motivo: agendamentoImportado
        ? MOTIVO_SO_AGENDAMENTO_IMPORTADO
        : agendamento_id
          ? "Não encontrei esse agendamento confirmado para esse paciente. Use listar_agendamentos para ver os IDs corretos."
          : "Não encontrei nenhum agendamento confirmado para esse paciente.",
    };
  }

  await cancelarAgendamentoNoBanco(agendamento.id);

  return {
    sucesso: true,
    data: agendamento.data,
    hora: agendamento.hora,
    tipo_atendimento: agendamento.tipo_atendimento,
  };
}
