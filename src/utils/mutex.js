import { pool } from "../db/pool.js";

/**
 * Serializa execuções concorrentes que compartilham a mesma chave (ex: o
 * telefone do paciente) via pg_advisory_xact_lock — mesmo padrão de
 * inserirAgendamentoComTravaDeCapacidade (agendamentoModel.js). Diferente de
 * um lock em memória de processo único, funciona também entre múltiplas
 * instâncias do processo (ex: Railway escalado horizontalmente).
 */
export async function comLock(chave, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // pg_advisory_xact_lock libera sozinho no COMMIT/ROLLBACK — nada de
    // unlock manual, e outra transação esperando a mesma chave só segue
    // depois que esta aqui terminar.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [chave]);
    const resultado = await fn();
    await client.query("COMMIT");
    return resultado;
  } catch (erro) {
    await client.query("ROLLBACK").catch(() => {});
    throw erro;
  } finally {
    client.release();
  }
}
