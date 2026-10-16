import { validarDisponibilidadeAgendamento, nomeDiaSemana } from "../services/calendarService.js";
import { encontrarOuCriarPaciente, atualizarDadosPaciente } from "../models/pacienteModel.js";
import { inserirAgendamento, buscarAgendamentoConfirmadoDoPacienteNaData } from "../models/agendamentoModel.js";
import { buscarAgendamentoImportadoConfirmadoNaData } from "../models/agendamentoImportadoModel.js";
import { validarData, validarHora, validarTipoAtendimento } from "../utils/validacao.js";
import { capturarErro, capturarAviso } from "../config/sentry.js";
import { CLINICA } from "../config/clinica.js";
import dayjs from "../utils/dayjs.js";
import { buscarFotoPendente, apagarFotoPendente } from "../services/encaminhamentoMedicoService.js";
import { enviarImagem, enviarMensagem } from "../services/whatsappService.js";
import { formatarTelefoneExibicao } from "../utils/phone.js";

const TELEFONE_ATENDENTE = process.env.ATENDENTE_HUMANO_TELEFONE;

const MOTIVO_POR_CODIGO_ERRO = {
  FORA_DO_HORARIO_FUNCIONAMENTO:
    "Esse horário está fora do funcionamento da clínica (seg-sex, dentro do horário configurado) ou cai num fim de semana/feriado. Consulte checar_disponibilidade para ver horários válidos.",
  DATA_NO_PASSADO: "Essa data/hora já passou. Peça ao paciente uma data e hora futuras.",
  FORA_DO_LIMITE_DIAS:
    "Só é possível agendar dentro de 7 dias úteis a partir de hoje. Peça ao paciente uma data mais próxima.",
  HORARIO_LOTADO:
    "Esse horário já atingiu o número máximo de pacientes. Consulte checar_disponibilidade novamente e ofereça outras opções ao paciente.",
};

const NOME_PLACEHOLDER_PACIENTE_NOVO = "Paciente";

function montarTextoNotificacaoAgendamento({ nomePaciente, telefone, data, hora, tipoAtendimento, convenio }) {
  const tipoFormatado = tipoAtendimento === "psicologia" ? "Psicologia" : "Fisioterapia";
  const ehConvenio = Boolean(convenio) && convenio.trim().toLowerCase() !== "particular";
  const convenioFormatado = ehConvenio ? convenio : "Particular";
  return `📅 Novo agendamento\nPaciente: ${nomePaciente} (${formatarTelefoneExibicao(telefone)})\n${data} às ${hora} — ${tipoFormatado}\nConvênio: ${convenioFormatado}`;
}

/**
 * Notifica a recepção sobre o agendamento recém-criado — junto com a foto
 * de encaminhamento médico pendente do paciente, se ele mandou uma pouco
 * antes (ver encaminhamentoMedicoService.js). Nunca lança: uma falha aqui
 * não pode impedir a confirmação do agendamento pro paciente. Se havia
 * foto pendente e o envio falhar, a pendência NÃO é apagada — o job de
 * expiração (server.js) acaba enviando ela sozinha depois.
 */
export async function notificarRecepcaoDoAgendamento(
  { pacienteId, nomePaciente, telefone, data, hora, tipoAtendimento, convenio },
  {
    buscarFoto = buscarFotoPendente,
    apagarFoto = apagarFotoPendente,
    enviarComFoto = enviarImagem,
    enviarSoTexto = enviarMensagem,
  } = {}
) {
  if (!TELEFONE_ATENDENTE) {
    capturarAviso(
      "[criarAgendamento] ATENDENTE_HUMANO_TELEFONE não configurado — agendamento não notificado à recepção."
    );
    return;
  }

  let textoBase;
  try {
    textoBase = montarTextoNotificacaoAgendamento({ nomePaciente, telefone, data, hora, tipoAtendimento, convenio });
  } catch (err) {
    capturarErro("[criarAgendamento] Falha ao montar texto de notificação da recepção:", err);
    return;
  }

  let fotoPendente = null;
  try {
    fotoPendente = await buscarFoto(pacienteId);
  } catch (err) {
    capturarErro("[criarAgendamento] Falha ao buscar foto pendente para notificação da recepção:", err);
  }

  try {
    if (fotoPendente) {
      await enviarComFoto(TELEFONE_ATENDENTE, {
        base64: fotoPendente.base64,
        mimetype: fotoPendente.mimetype,
        caption: textoBase,
      });
      await apagarFoto(pacienteId);
    } else {
      await enviarSoTexto(TELEFONE_ATENDENTE, textoBase);
    }
  } catch (err) {
    capturarErro("[criarAgendamento] Falha ao notificar a recepção sobre o agendamento:", err);
  }
}

/**
 * Handler da function criar_agendamento. Recebe o telefone via contexto
 * (não via argumento do modelo) para garantir que o agendamento é sempre
 * vinculado ao paciente correto — o telefone de quem está escrevendo no
 * WhatsApp, nunca um valor que o modelo poderia errar ou inventar.
 */
export async function criarAgendamento(
  {
    nome_paciente,
    data,
    hora,
    tipo_atendimento,
    convenio,
    primeira_consulta,
    queixa_principal,
    confirmou_consulta_duplicada,
  },
  { telefone },
  {
    encontrarPaciente = encontrarOuCriarPaciente,
    atualizarPaciente = atualizarDadosPaciente,
    buscarDuplicadoBot = buscarAgendamentoConfirmadoDoPacienteNaData,
    buscarDuplicadoImportado = buscarAgendamentoImportadoConfirmadoNaData,
    validarDisponibilidade = validarDisponibilidadeAgendamento,
    inserirNoBanco = inserirAgendamento,
    notificarRecepcao = notificarRecepcaoDoAgendamento,
  } = {}
) {
  if (!validarTipoAtendimento(tipo_atendimento)) {
    return {
      sucesso: false,
      motivo: `tipo_atendimento inválido: "${tipo_atendimento}". Use "fisioterapia" ou "psicologia".`,
    };
  }
  if (!validarData(data)) {
    return {
      sucesso: false,
      motivo: `Formato de data inválido: "${data}". Use o formato YYYY-MM-DD.`,
    };
  }
  if (!validarHora(hora)) {
    return {
      sucesso: false,
      motivo: `Formato de hora inválido: "${hora}". Use o formato HH:mm (24h).`,
    };
  }
  if (!nome_paciente?.trim()) {
    return { sucesso: false, motivo: "nome_paciente é obrigatório." };
  }

  const paciente = await encontrarPaciente({ nome: nome_paciente, telefone, convenio });
  // Só atualiza o nome se o paciente ainda não tinha um nome "de verdade" —
  // um paciente recorrente já tem o nome correto salvo, e sobrescrever a
  // cada novo agendamento com o que o modelo entendeu nessa conversa
  // (apelido, grafia diferente etc.) degradaria o cadastro com o tempo.
  const nomeParaAtualizar =
    !paciente.nome || paciente.nome === NOME_PLACEHOLDER_PACIENTE_NOVO ? nome_paciente : null;
  await atualizarPaciente(paciente.id, { nome: nomeParaAtualizar, convenio });

  // Não bloqueia — o paciente pode legitimamente querer duas consultas no
  // mesmo dia (ex: dois procedimentos). Só avisa e exige confirmação
  // explícita antes de duplicar (ver caso real: paciente pediu pra remarcar
  // e o bot criou uma consulta nova sem checar a existente). Cobre tanto
  // agendamento feito pelo bot quanto importado do sistema antigo.
  if (!confirmou_consulta_duplicada) {
    const [duplicadoBot, duplicadoImportado] = await Promise.all([
      buscarDuplicadoBot(paciente.id, data),
      buscarDuplicadoImportado(telefone, data),
    ]);
    const existente = duplicadoBot ?? duplicadoImportado;
    if (existente) {
      return {
        sucesso: false,
        motivo:
          `O paciente já tem uma consulta confirmada em ${data} às ${String(existente.hora).slice(0, 5)} ` +
          `(${existente.tipo_atendimento}). Avise o paciente e pergunte se ele quer marcar mais uma consulta ` +
          `nesse mesmo dia mesmo assim. Se ele confirmar que sim, chame criar_agendamento de novo com ` +
          `confirmou_consulta_duplicada=true.`,
      };
    }
  }

  try {
    await validarDisponibilidade({ data, hora, tipoAtendimento: tipo_atendimento });
  } catch (err) {
    const motivo = MOTIVO_POR_CODIGO_ERRO[err.codigo];
    if (motivo) {
      return { sucesso: false, motivo };
    }
    throw err;
  }

  let agendamento;
  try {
    agendamento = await inserirNoBanco({
      pacienteId: paciente.id,
      data,
      hora,
      tipoAtendimento: tipo_atendimento,
      status: "confirmado",
      primeiraConsulta: primeira_consulta ?? null,
      queixaPrincipal: queixa_principal ?? null,
    });
  } catch (err) {
    capturarErro("[criarAgendamento] Falha ao gravar agendamento:", err);

    // HORARIO_LOTADO acontece aqui quando outra reserva pro mesmo horário
    // venceu a corrida entre a checagem de disponibilidade (acima) e o
    // INSERT de verdade (que reconta a ocupação dentro de uma trava — ver
    // inserirAgendamento em agendamentoModel.js).
    return {
      sucesso: false,
      motivo:
        MOTIVO_POR_CODIGO_ERRO[err.codigo] ??
        "Não foi possível concluir o agendamento por um problema técnico. Peça para o paciente tentar novamente em instantes.",
    };
  }

  await notificarRecepcao({
    pacienteId: paciente.id,
    nomePaciente: nome_paciente,
    telefone,
    data,
    hora,
    tipoAtendimento: tipo_atendimento,
    convenio,
  });

  return {
    sucesso: true,
    agendamentoId: agendamento.id,
    data,
    diaSemana: nomeDiaSemana(dayjs.tz(data, CLINICA.timezone)),
    hora,
    tipo_atendimento,
  };
}
