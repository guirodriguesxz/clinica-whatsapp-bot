import { pool } from "../db/pool.js";

/**
 * Lista materiais com nome do fornecedor/centro de custo já resolvidos
 * (evita a view ter que cruzar listas separadas). fornecedor_id/centro_custo_id
 * são opcionais, por isso LEFT JOIN.
 */
export async function listarMateriais() {
  const { rows } = await pool.query(
    `SELECT m.*, f.nome AS fornecedor_nome, c.nome AS centro_custo_nome
     FROM materiais m
     LEFT JOIN fornecedores f ON f.id = m.fornecedor_id
     LEFT JOIN centros_custo c ON c.id = m.centro_custo_id
     WHERE m.ativo = true
     ORDER BY m.nome`
  );
  return rows;
}

export async function criarMaterial({
  nome,
  categoria,
  unidadeMedida,
  quantidadeEmEstoque,
  estoqueMinimo,
  fornecedorId,
  centroCustoId,
}) {
  const { rows } = await pool.query(
    `INSERT INTO materiais
       (nome, categoria, unidade_medida, quantidade_em_estoque, estoque_minimo, fornecedor_id, centro_custo_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      nome,
      categoria,
      unidadeMedida,
      quantidadeEmEstoque,
      estoqueMinimo,
      fornecedorId,
      centroCustoId,
    ]
  );
  return rows[0];
}
