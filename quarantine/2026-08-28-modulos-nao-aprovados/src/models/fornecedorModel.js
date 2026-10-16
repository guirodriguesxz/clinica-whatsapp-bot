import { pool } from "../db/pool.js";

export async function listarFornecedores() {
  const { rows } = await pool.query(`SELECT * FROM fornecedores WHERE ativo = true ORDER BY nome`);
  return rows;
}

export async function criarFornecedor({ nome, telefone, observacao }) {
  const { rows } = await pool.query(
    `INSERT INTO fornecedores (nome, telefone, observacao) VALUES ($1, $2, $3) RETURNING *`,
    [nome, telefone, observacao]
  );
  return rows[0];
}
