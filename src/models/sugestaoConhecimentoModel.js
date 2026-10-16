import { pool } from "../db/pool.js";

export async function criarSugestaoConhecimento({ pergunta, telefone, nome }) {
  const { rows } = await pool.query(
    `INSERT INTO sugestoes_conhecimento (pergunta, paciente_telefone, paciente_nome)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [pergunta, telefone ?? null, nome ?? null]
  );
  return rows[0];
}

export async function listarSugestoesConhecimentoPendentes() {
  const { rows } = await pool.query(
    `SELECT id, pergunta, paciente_telefone, paciente_nome, created_at
     FROM sugestoes_conhecimento
     WHERE status = 'pendente'
     ORDER BY created_at DESC`
  );
  return rows;
}

export async function buscarSugestaoConhecimentoPorId(id) {
  const { rows } = await pool.query(
    `SELECT id, pergunta, paciente_telefone, paciente_nome, status, created_at
     FROM sugestoes_conhecimento WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function definirStatusSugestaoConhecimento(id, status) {
  const { rows } = await pool.query(
    `UPDATE sugestoes_conhecimento SET status = $2 WHERE id = $1 RETURNING id, status`,
    [id, status]
  );
  return rows[0] ?? null;
}
