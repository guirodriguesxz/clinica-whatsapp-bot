import { pool } from "../db/pool.js";

const LIMITE_HISTORICO_PADRAO = 20;

/**
 * Devolve o id da linha criada (ou null) — o chatService usa esse id pra
 * saber, no envio atrasado, se o paciente já mandou mensagem mais nova.
 */
export async function registrarMensagem({ pacienteId, mensagem, remetente }) {
  const resultado = await pool.query(
    `INSERT INTO conversas (paciente_id, mensagem, remetente) VALUES ($1, $2, $3) RETURNING id`,
    [pacienteId, mensagem, remetente]
  );
  return resultado?.rows?.[0]?.id ?? null;
}

/** O paciente mandou alguma mensagem depois da linha `idConversa`? */
export async function existeMensagemPacienteApos(pacienteId, idConversa) {
  const { rows } = await pool.query(
    `SELECT 1 FROM conversas WHERE paciente_id = $1 AND remetente = 'paciente' AND id > $2 LIMIT 1`,
    [pacienteId, idConversa]
  );
  return rows.length > 0;
}

/**
 * Retorna as últimas N mensagens do paciente em ordem cronológica
 * (mais antiga primeiro), pronto para virar histórico da OpenAI.
 */
export async function buscarHistoricoRecente(pacienteId, limite = LIMITE_HISTORICO_PADRAO) {
  const { rows } = await pool.query(
    `SELECT mensagem, remetente, timestamp
     FROM conversas
     WHERE paciente_id = $1
     ORDER BY timestamp DESC
     LIMIT $2`,
    [pacienteId, limite]
  );
  return rows.reverse();
}

/**
 * Timestamp da última mensagem manual da equipe (remetente "equipe") para
 * esse paciente, ou null se nunca houve nenhuma — usado pra saber se a
 * pausa automática (ver PAUSADO_ATENDIMENTO_HUMANO em chatService.js) já
 * "esfriou" o bastante pra IA retomar sozinha.
 */
export async function buscarTimestampUltimaMensagemEquipe(pacienteId) {
  const { rows } = await pool.query(
    `SELECT timestamp
     FROM conversas
     WHERE paciente_id = $1 AND remetente = 'equipe'
     ORDER BY timestamp DESC
     LIMIT 1`,
    [pacienteId]
  );
  return rows[0]?.timestamp ?? null;
}

/**
 * Última mensagem "humana" (paciente ou equipe — o bot não conta) de cada
 * paciente com atividade nos últimos `dias` dias. Usado pelo resumo de
 * pacientes sem resposta da equipe (semRespostaService.js).
 */
export async function buscarUltimaMensagemHumanaPorPaciente(dias) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (c.paciente_id)
            c.paciente_id, p.nome, p.telefone, c.remetente, c.mensagem, c.timestamp
     FROM conversas c
     JOIN pacientes p ON p.id = c.paciente_id
     WHERE c.remetente IN ('paciente', 'equipe')
       AND c.timestamp >= NOW() - ($1 * INTERVAL '1 day')
     ORDER BY c.paciente_id, c.timestamp DESC`,
    [dias]
  );
  return rows;
}
