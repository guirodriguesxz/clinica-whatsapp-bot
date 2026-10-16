import { capturarErro } from "../config/sentry.js";
import { validarDisponibilidadeAgendamento } from "./calendarService.js";
import {
  remarcarAgendamento as remarcarAgendamentoNoBanco,
  remarcarAgendamentoImportado as remarcarAgendamentoImportadoNoBanco,
  editarAgendamento as editarAgendamentoNoBanco,
  editarAgendamentoImportado as editarAgendamentoImportadoNoBanco,
} from "../models/agendamentoModel.js";

/**
 * Sequência de remarcação, compartilhada entre o bot
 * (src/functions/remarcarAgendamento.js) e o dashboard
 * (dashboardController.processarRemarcarAgendamento): valida disponibilidade
 * e grava a nova data/hora direto — mesmo formato de
 * remarcarConsultaImportada (esses nunca precisaram de mais que isso, por
 * nunca terem passado pelo Calendar). Erros de validação de horário
 * propagam com `err.codigo`; cada chamador decide como traduzir isso pra
 * usuário final (mensagem de IA vs. mensagem de dashboard).
 */
export async function remarcarConsulta(
  { agendamento, novaData, novaHora },
  {
    validarDisponibilidade = validarDisponibilidadeAgendamento,
    salvarNoBanco = remarcarAgendamentoNoBanco,
  } = {}
) {
  await validarDisponibilidade({
    data: novaData,
    hora: novaHora,
    tipoAtendimento: agendamento.tipo_atendimento,
  });

  try {
    return await salvarNoBanco({
      id: agendamento.id,
      data: novaData,
      hora: novaHora,
    });
  } catch (err) {
    capturarErro("[remarcacaoService] Falha ao gravar remarcação:", err);
    const erro = new Error("FALHA_AO_GRAVAR");
    erro.codigo = "FALHA_AO_GRAVAR";
    throw erro;
  }
}

/**
 * Remarcação de agendamento importado: sem Calendar envolvido (esses
 * registros nunca tiveram evento lá), então não precisa da sequência
 * criar-depois-cancelar de remarcarConsulta — só valida disponibilidade e
 * grava a nova data/hora. Ainda assim, a gravação pode falhar (corrida:
 * status virou cancelado entre a checagem do controller e aqui — o WHERE
 * status = 'confirmado' de remarcarAgendamentoImportado retorna null nesse
 * caso; ou erro do Postgres, ex. colisão com o índice único
 * idx_agendamentos_importados_unico quando o próprio registro cancelado
 * ainda ocupa a chave telefone/data/hora/nome do novo horário) — trata os
 * dois casos como FALHA_AO_GRAVAR, mesmo padrão/código de remarcarConsulta.
 */
export async function remarcarConsultaImportada(
  { agendamento, novaData, novaHora },
  {
    validarDisponibilidade = validarDisponibilidadeAgendamento,
    salvarNoBanco = remarcarAgendamentoImportadoNoBanco,
  } = {}
) {
  await validarDisponibilidade({
    data: novaData,
    hora: novaHora,
    tipoAtendimento: agendamento.tipo_atendimento,
  });

  let agendamentoAtualizado;
  try {
    agendamentoAtualizado = await salvarNoBanco({
      id: agendamento.id,
      data: novaData,
      hora: novaHora,
    });
  } catch (err) {
    capturarErro("[remarcacaoService] Falha ao gravar remarcação de importado:", err);
    const erro = new Error("FALHA_AO_GRAVAR");
    erro.codigo = "FALHA_AO_GRAVAR";
    throw erro;
  }

  if (!agendamentoAtualizado) {
    capturarErro(
      "[remarcacaoService] Remarcação de importado não afetou nenhuma linha (corrida):",
      new Error(`agendamento importado ${agendamento.id} não estava mais confirmado`)
    );
    const erro = new Error("FALHA_AO_GRAVAR");
    erro.codigo = "FALHA_AO_GRAVAR";
    throw erro;
  }

  return agendamentoAtualizado;
}

/**
 * Edição completa (paciente, data, hora, tipo) de um agendamento na tabela
 * agendamentos (bot ou manual). Quando data/hora/tipo não mudam (só o
 * paciente foi trocado), pula validarDisponibilidade — mesmo raciocínio de
 * editarConsultaImportada: senão a validação se autobloqueia contra o
 * próprio slot que o agendamento (ainda confirmado) já ocupa.
 * `google_event_id` nunca é alterado aqui — a coluna é só histórico, não
 * escrevemos valor novo nela.
 */
export async function editarConsulta(
  {
    agendamento,
    novoPacienteId,
    novaData,
    novaHora,
    novoTipoAtendimento,
    novoPsicologoId,
    novoFisioterapeutaId,
    usuarioId,
  },
  {
    validarDisponibilidade = validarDisponibilidadeAgendamento,
    salvarNoBanco = editarAgendamentoNoBanco,
  } = {}
) {
  // agendamento.hora vem do Postgres como "HH:mm:ss" (sem type parser
  // instalado pra TIME em src/db/pool.js — ver comentário equivalente em
  // calendarService.js ~linha 88), enquanto novaHora vem do <input
  // type="time"> do formulário como "HH:mm". Comparar os dois sem normalizar
  // faz mesmoSlot nunca dar true, derrubando toda edição pro caminho que
  // revalida disponibilidade contra o próprio slot que o agendamento (ainda
  // confirmado) já ocupa.
  const mesmoSlot =
    novaData === agendamento.data &&
    novaHora === String(agendamento.hora).slice(0, 5) &&
    novoTipoAtendimento === agendamento.tipo_atendimento;

  if (!mesmoSlot) {
    await validarDisponibilidade({ data: novaData, hora: novaHora, tipoAtendimento: novoTipoAtendimento });
  }

  try {
    return await salvarNoBanco({
      id: agendamento.id,
      pacienteId: novoPacienteId,
      data: novaData,
      hora: novaHora,
      tipoAtendimento: novoTipoAtendimento,
      googleEventId: agendamento.google_event_id,
      atualizadoPorUsuarioId: usuarioId,
      psicologoId: novoPsicologoId,
      fisioterapeutaId: novoFisioterapeutaId,
    });
  } catch (err) {
    capturarErro("[remarcacaoService] Falha ao gravar edição:", err);
    const erro = new Error("FALHA_AO_GRAVAR");
    erro.codigo = "FALHA_AO_GRAVAR";
    throw erro;
  }
}

/**
 * Edição completa de um agendamento importado — sem Calendar envolvido
 * (mesmo raciocínio de remarcarConsultaImportada). "Trocar o paciente" aqui
 * é editar nome/telefone direto na linha. Quando data/hora/tipo não mudam
 * (ex: recepção só corrige um typo no nome), pula validarDisponibilidade —
 * senão contarPacientesNoSlot conta o próprio registro sendo editado (ainda
 * confirmado) e a validação se autobloqueia no mesmo slot que ele já ocupa.
 * Mesma normalização de hora de editarConsulta (ver comentário lá).
 */
export async function editarConsultaImportada(
  {
    agendamento,
    novoNome,
    novoTelefone,
    novoTipoAtendimento,
    novaData,
    novaHora,
    novoPsicologoId,
    novoFisioterapeutaId,
    usuarioId,
  },
  {
    validarDisponibilidade = validarDisponibilidadeAgendamento,
    salvarNoBanco = editarAgendamentoImportadoNoBanco,
  } = {}
) {
  const mesmoSlot =
    novaData === agendamento.data &&
    novaHora === String(agendamento.hora).slice(0, 5) &&
    novoTipoAtendimento === agendamento.tipo_atendimento;

  if (!mesmoSlot) {
    await validarDisponibilidade({ data: novaData, hora: novaHora, tipoAtendimento: novoTipoAtendimento });
  }

  let agendamentoAtualizado;
  try {
    agendamentoAtualizado = await salvarNoBanco({
      id: agendamento.id,
      nome: novoNome,
      telefone: novoTelefone,
      tipoAtendimento: novoTipoAtendimento,
      data: novaData,
      hora: novaHora,
      atualizadoPorUsuarioId: usuarioId,
      psicologoId: novoPsicologoId,
      fisioterapeutaId: novoFisioterapeutaId,
    });
  } catch (err) {
    capturarErro("[remarcacaoService] Falha ao gravar edição de importado:", err);
    const erro = new Error("FALHA_AO_GRAVAR");
    erro.codigo = "FALHA_AO_GRAVAR";
    throw erro;
  }

  if (!agendamentoAtualizado) {
    capturarErro(
      "[remarcacaoService] Edição de importado não afetou nenhuma linha (corrida):",
      new Error(`agendamento importado ${agendamento.id} não estava mais confirmado`)
    );
    const erro = new Error("FALHA_AO_GRAVAR");
    erro.codigo = "FALHA_AO_GRAVAR";
    throw erro;
  }

  return agendamentoAtualizado;
}
