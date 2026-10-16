import { pool } from "../db/pool.js";

/**
 * Registra o ID da mensagem do WhatsApp como processado. Retorna false se
 * esse ID já tinha sido registrado antes — sinal de que a Evolution API
 * reentregou o mesmo evento (retry de rede) e o chamador deve pular o
 * processamento em vez de responder/agendar de novo.
 */
export async function marcarMensagemComoProcessada(waMessageId) {
  const { rows } = await pool.query(
    `INSERT INTO webhook_mensagens_processadas (wa_message_id)
     VALUES ($1)
     ON CONFLICT (wa_message_id) DO NOTHING
     RETURNING wa_message_id`,
    [waMessageId]
  );
  return rows.length > 0;
}
