import { pool } from "../db/pool.js";
import { HOJE_SQL } from "../utils/sqlAgenda.js";

/**
 * Busca o próximo agendamento importado do sistema de agenda anterior (sistema anterior)
 * pra esse telefone, hoje ou no futuro — só pra dar contexto ao bot, não é
 * usado por cancelar_agendamento/remarcar_agendamento (fonte da verdade
 * desses agendamentos é o sistema de agenda anterior, não o bot). Ver migration 005.
 * `status = 'confirmado'` (migration 020) evita que o bot mencione ao
 * paciente um agendamento que a recepção já cancelou pelo dashboard.
 */
export async function buscarProximoAgendamentoImportado(telefone) {
  // telefone chega normalizado (só dígitos, com DDI) pelo bot, mas o telefone
  // importado do sistema de agenda anterior pode ter sido salvo com pontuação e/ou sem
  // o DDI — compara os dois lados só por dígitos, aceitando telefone com ou
  // sem o "55" na frente.
  const semDDI = telefone.startsWith("55") ? telefone.slice(2) : telefone;
  const { rows } = await pool.query(
    `SELECT nome, data, hora, tipo_atendimento, convenio, atendente
     FROM agendamentos_importados
     WHERE regexp_replace(telefone, '\\D', '', 'g') IN ($1, $2)
       AND data >= ${HOJE_SQL}
       AND status = 'confirmado'
     ORDER BY data, hora
     LIMIT 1`,
    [telefone, semDDI]
  );
  return rows[0] ?? null;
}

/**
 * Se esse telefone já teve QUALQUER consulta no sistema interno da clínica
 * (passada ou futura, qualquer status) — ou seja, se já é paciente da casa.
 * Usado pelo chatService pra não mandar a mensagem de boas-vindas de
 * paciente novo a quem já frequenta a clínica mas nunca tinha escrito pelo
 * WhatsApp (caso real 2026-09-22: um paciente, com 3 sessões na semana
 * anterior, recebeu "Seja muito bem-vindo(a) à Clínica Exemplo!" ao avisar que
 * faltaria). Mesma normalização de telefone de buscarProximoAgendamentoImportado.
 */
export async function telefoneJaTemConsultaNaClinica(telefone) {
  const semDDI = telefone.startsWith("55") ? telefone.slice(2) : telefone;
  const { rows } = await pool.query(
    `SELECT 1
     FROM agendamentos_importados
     WHERE regexp_replace(telefone, '\\D', '', 'g') IN ($1, $2)
     LIMIT 1`,
    [telefone, semDDI]
  );
  return rows.length > 0;
}

/**
 * Todos os agendamentos importados confirmados e futuros desse telefone, com
 * os mesmos campos de buscarProximoAgendamentoImportado (nome, convenio,
 * atendente) — usado pelo chatService pra dar contexto completo ao bot
 * quando o paciente tem mais de uma consulta marcada (ex: fisioterapia E
 * psicologia) e menciona mais de uma na mesma mensagem. Diferente de
 * buscarAgendamentosImportadosConfirmadosFuturos (usada pela detecção
 * automática de cancelamento/remarcação manual), que só traz id/data/hora.
 */
export async function buscarAgendamentosImportadosFuturosCompletos(telefone) {
  const semDDI = telefone.startsWith("55") ? telefone.slice(2) : telefone;
  const { rows } = await pool.query(
    `SELECT nome, data, hora, tipo_atendimento, convenio, atendente
     FROM agendamentos_importados
     WHERE regexp_replace(telefone, '\\D', '', 'g') IN ($1, $2)
       AND data >= ${HOJE_SQL}
       AND status = 'confirmado'
     ORDER BY data, hora`,
    [telefone, semDDI]
  );
  return rows;
}

/**
 * Agendamento importado (sistema antigo, fora do bot) confirmado que esse
 * telefone já tenha numa data específica — usado por criar_agendamento pra
 * avisar/confirmar antes de marcar uma segunda consulta no mesmo dia (ver
 * criarAgendamento.js). Mesma normalização de telefone de
 * buscarProximoAgendamentoImportado.
 */
export async function buscarAgendamentoImportadoConfirmadoNaData(telefone, data) {
  const semDDI = telefone.startsWith("55") ? telefone.slice(2) : telefone;
  const { rows } = await pool.query(
    `SELECT nome, data, hora, tipo_atendimento
     FROM agendamentos_importados
     WHERE regexp_replace(telefone, '\\D', '', 'g') IN ($1, $2)
       AND data = $3::date
       AND status = 'confirmado'
     LIMIT 1`,
    [telefone, semDDI, data]
  );
  return rows[0] ?? null;
}

/**
 * Todos os agendamentos importados confirmados e futuros desse telefone —
 * usado pela detecção automática de cancelamento/remarcação combinados
 * manualmente pela equipe (ver agendamentoManualService.js): só age quando
 * há exatamente UM resultado, pra nunca arriscar cancelar/remarcar o
 * agendamento errado por ambiguidade. Mesma normalização de telefone de
 * buscarProximoAgendamentoImportado.
 */
export async function buscarAgendamentosImportadosConfirmadosFuturos(telefone) {
  const semDDI = telefone.startsWith("55") ? telefone.slice(2) : telefone;
  const { rows } = await pool.query(
    `SELECT id, data, hora, tipo_atendimento
     FROM agendamentos_importados
     WHERE regexp_replace(telefone, '\\D', '', 'g') IN ($1, $2)
       AND data >= ${HOJE_SQL}
       AND status = 'confirmado'
     ORDER BY data, hora`,
    [telefone, semDDI]
  );
  return rows;
}

/**
 * Candidatos a lembrete de consulta entre os agendamentos importados do
 * sistema de agenda anterior (ver lembreteService.js) — mesmo esquema usado pros
 * agendamentos feitos pelo bot (migration 006). `status = 'confirmado'`
 * (migration 020) espelha buscarAgendamentosConfirmadosSemLembreteVespera
 * (agendamentoModel.js): evita mandar lembrete de consulta cancelada pela
 * recepção, e também exclui qualquer futuro compareceu/faltou/concluido.
 */
export async function buscarAgendamentosImportadosSemLembreteVespera() {
  const { rows } = await pool.query(
    `SELECT id, telefone, nome, data, hora, tipo_atendimento, lembrete_24h_enviado_em
     FROM agendamentos_importados
     WHERE status = 'confirmado'
       AND lembrete_24h_enviado_em IS NULL
       AND data >= ${HOJE_SQL}
       AND telefone <> ''`
  );
  return rows;
}

export async function marcarLembreteImportadoVesperaEnviado(id) {
  await pool.query(
    `UPDATE agendamentos_importados
     SET lembrete_24h_enviado_em = now()
     WHERE id = $1`,
    [id]
  );
}

/**
 * Mesmo contrato de buscarAgendamentosImportadosSemLembreteVespera, mas para
 * o lembrete "de tarde" (consultas de HOJE, hora >= 12:00 — ver
 * agendamentoModel.buscarAgendamentosConfirmadosTardeSemLembrete, mesma regra
 * pro lado do bot).
 */
export async function buscarAgendamentosImportadosTardeSemLembrete() {
  const { rows } = await pool.query(
    `SELECT id, telefone, nome, data, hora, tipo_atendimento, lembrete_tarde_enviado_em
     FROM agendamentos_importados
     WHERE status = 'confirmado'
       AND lembrete_tarde_enviado_em IS NULL
       AND data = ${HOJE_SQL}
       AND hora >= '12:00:00'
       AND telefone <> ''`
  );
  return rows;
}

export async function marcarLembreteImportadoTardeEnviado(id) {
  await pool.query(
    `UPDATE agendamentos_importados
     SET lembrete_tarde_enviado_em = now()
     WHERE id = $1`,
    [id]
  );
}
