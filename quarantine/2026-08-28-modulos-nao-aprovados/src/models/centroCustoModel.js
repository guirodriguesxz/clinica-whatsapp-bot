import { pool } from "../db/pool.js";

export async function listarCentrosCusto() {
  const { rows } = await pool.query(`SELECT * FROM centros_custo WHERE ativo = true ORDER BY nome`);
  return rows;
}

export async function criarCentroCusto({ nome, descricao }) {
  const { rows } = await pool.query(
    `INSERT INTO centros_custo (nome, descricao) VALUES ($1, $2) RETURNING *`,
    [nome, descricao]
  );
  return rows[0];
}
