import { remarcarConsulta } from "../services/remarcacaoService.js";
import { nomeDiaSemana } from "../services/calendarService.js";
import { buscarAgendamentoConfirmadoPorId } from "../models/agendamentoModel.js";
import { buscarProximoAgendamentoImportado } from "../models/agendamentoImportadoModel.js";
import { validarData, validarHora } from "../utils/validacao.js";
import { CLINICA } from "../config/clinica.js";
import dayjs from "../utils/dayjs.js";
import { capturarErro, capturarAviso } from "../config/sentry.js";
import { enviarMensagem } from "../services/whatsappService.js";
import { formatarTelefoneExibicao } from "../utils/phone.js";

const TELEFONE_ATENDENTE = process.env.ATENDENTE_HUMANO_TELEFONE;

const MOTIVO_POR_CODIGO_ERRO = {
  FORA_DO_HORARIO_FUNCIONAMENTO:
    "Esse horário está fora do funcionamento da clínica (seg-sex, dentro do horário configurado) ou cai num fim de semana/feriado. Consulte checar_disponibilidade para ver horários válidos.",
  DATA_NO_PASSADO: "Essa nova data/hora já passou. Peça ao paciente uma data e hora futuras.",
  FORA_DO_LIMITE_DIAS:
    "Só é possível remarcar dentro de 7 dias úteis a partir de hoje. Peça ao paciente uma data mais próxima.",
  HORARIO_LOTADO:
    "Esse horário já atingiu o número máximo de pacientes. Consulte checar_disponibilidade novamente e ofereça outras opções ao paciente.",
  FALHA_AO_GRAVAR:
    "Não foi possível concluir a remarcação por um problema técnico. Peça para o paciente tentar novamente em instantes.",
};

const MOTIVO_SO_AGENDAMENTO_IMPORTADO =
  "Esse paciente não tem nenhum agendamento feito pelo bot para remarcar — a consulta dele foi marcada fora do bot (sistema interno da clínica). NÃO tente de novo por aqui: oriente o paciente a confirmar a remarcação diretamente com a recepção da clínica.";

function montarTextoNotificacaoRemarcacao({
  nomePaciente,
  telefone,
  dataAnterior,
  horaAnterior,
  novaData,
  novaHora,
  tipoAtendimento,
}) {
  const tipoFormatado = tipoAtendimento === "psicologia" ? "Psicologia" : "Fisioterapia";
  return (
    `🔄 Consulta remarcada\nPaciente: ${nomePaciente} (${formatarTelefoneExibicao(telefone)})\n` +
    `De: ${dataAnterior} às ${horaAnterior}\nPara: ${novaData} às ${novaHora} — ${tipoFormatado}`
  );
}

/**
 * Notifica a recepção sobre uma remarcação feita pelo bot — sem isso a
 * equipe só ficava sabendo da mudança se lesse a conversa inteira (caso
 * real: paciente remarcou pelo bot e a recepção não foi avisada). Mesmo
 * padrão de nunca lançar de notificarRecepcaoDoAgendamento
 * (criarAgendamento.js): uma falha aqui não pode impedir a confirmação da
 * remarcação pro paciente.
 */
export async function notificarRecepcaoDaRemarcacao(
  { nomePaciente, telefone, dataAnterior, horaAnterior, novaData, novaHora, tipoAtendimento },
  { enviarSoTexto = enviarMensagem } = {}
) {
  if (!TELEFONE_ATENDENTE) {
    capturarAviso(
      "[remarcarAgendamento] ATENDENTE_HUMANO_TELEFONE não configurado — remarcação não notificada à recepção."
    );
    return;
  }

  try {
    const texto = montarTextoNotificacaoRemarcacao({
      nomePaciente,
      telefone,
      dataAnterior,
      horaAnterior,
      novaData,
      novaHora,
      tipoAtendimento,
    });
    await enviarSoTexto(TELEFONE_ATENDENTE, texto);
  } catch (err) {
    capturarErro("[remarcarAgendamento] Falha ao notificar a recepção sobre a remarcação:", err);
  }
}

/**
 * Handler da function remarcar_agendamento. O agendamento_id normalmente
 * vem de uma listagem anterior (listar_agendamentos) e é sempre validado
 * contra o pacienteId do contexto antes de qualquer alteração. A sequência
 * segura (criar evento novo -> gravar no banco -> cancelar evento antigo)
 * vive em remarcacaoService.remarcarConsulta, compartilhada com o
 * dashboard.
 */
export async function remarcarAgendamento(
  { agendamento_id, nova_data, nova_hora },
  { pacienteId, telefone },
  {
    buscarAgendamento = buscarAgendamentoConfirmadoPorId,
    buscarAgendamentoImportado = buscarProximoAgendamentoImportado,
    executarRemarcacao = remarcarConsulta,
    notificarRecepcao = notificarRecepcaoDaRemarcacao,
  } = {}
) {
  if (!validarData(nova_data)) {
    return {
      sucesso: false,
      motivo: `Formato de data inválido: "${nova_data}". Use o formato YYYY-MM-DD.`,
    };
  }
  if (!validarHora(nova_hora)) {
    return {
      sucesso: false,
      motivo: `Formato de hora inválido: "${nova_hora}". Use o formato HH:mm (24h).`,
    };
  }

  const agendamento = await buscarAgendamento(agendamento_id, pacienteId);
  if (!agendamento) {
    const agendamentoImportado = await buscarAgendamentoImportado(telefone);
    return {
      sucesso: false,
      motivo: agendamentoImportado
        ? MOTIVO_SO_AGENDAMENTO_IMPORTADO
        : "Não encontrei esse agendamento confirmado para esse paciente. Use listar_agendamentos para ver os IDs corretos.",
    };
  }

  if (agendamento.data === nova_data && agendamento.hora.slice(0, 5) === nova_hora) {
    return { sucesso: false, motivo: "A nova data/hora é igual à consulta já marcada." };
  }

  let agendamentoAtualizado;
  try {
    agendamentoAtualizado = await executarRemarcacao({
      agendamento,
      novaData: nova_data,
      novaHora: nova_hora,
    });
  } catch (err) {
    const motivo = MOTIVO_POR_CODIGO_ERRO[err.codigo];
    if (motivo) {
      return { sucesso: false, motivo };
    }
    throw err;
  }

  await notificarRecepcao({
    nomePaciente: agendamento.paciente_nome,
    telefone: agendamento.paciente_telefone,
    dataAnterior: agendamento.data,
    horaAnterior: agendamento.hora.slice(0, 5),
    novaData: agendamentoAtualizado.data,
    novaHora: agendamentoAtualizado.hora.slice(0, 5),
    tipoAtendimento: agendamentoAtualizado.tipo_atendimento,
  });

  return {
    sucesso: true,
    data_anterior: agendamento.data,
    hora_anterior: agendamento.hora,
    data: agendamentoAtualizado.data,
    diaSemana: nomeDiaSemana(dayjs.tz(agendamentoAtualizado.data, CLINICA.timezone)),
    hora: agendamentoAtualizado.hora,
    tipo_atendimento: agendamentoAtualizado.tipo_atendimento,
  };
}
