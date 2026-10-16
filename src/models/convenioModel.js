import { pool } from "../db/pool.js";

export async function listarConvenios({ apenasAtivos = true } = {}) {
  const filtro = apenasAtivos ? "WHERE ativo = true " : "";
  const { rows } = await pool.query(
    `SELECT id, nome, ativo, valor_repasse_avaliacao, valor_repasse_sessao, created_at
     FROM convenios ${filtro}ORDER BY nome ASC`
  );
  return rows;
}

export async function buscarConvenioPorId(id) {
  const { rows } = await pool.query(
    `SELECT id, nome, ativo, valor_repasse_avaliacao, valor_repasse_sessao,
            codigo_prestador_na_operadora, numero_contrato, created_at
     FROM convenios WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function criarConvenio({ nome, valorRepasseAvaliacao = null, valorRepasseSessao = null }) {
  const { rows } = await pool.query(
    `INSERT INTO convenios (nome, valor_repasse_avaliacao, valor_repasse_sessao)
     VALUES ($1, $2, $3)
     RETURNING id, nome, ativo, valor_repasse_avaliacao, valor_repasse_sessao, created_at`,
    [nome, valorRepasseAvaliacao, valorRepasseSessao]
  );
  return rows[0];
}

export async function atualizarConvenio(
  id,
  { nome, valorRepasseAvaliacao = null, valorRepasseSessao = null, codigoPrestadorNaOperadora = null, numeroContrato = null }
) {
  const { rows } = await pool.query(
    `UPDATE convenios
     SET nome = $2, valor_repasse_avaliacao = $3, valor_repasse_sessao = $4,
         codigo_prestador_na_operadora = $5, numero_contrato = $6
     WHERE id = $1
     RETURNING id, nome, ativo, valor_repasse_avaliacao, valor_repasse_sessao,
               codigo_prestador_na_operadora, numero_contrato, created_at`,
    [id, nome, valorRepasseAvaliacao, valorRepasseSessao, codigoPrestadorNaOperadora, numeroContrato]
  );
  return rows[0] ?? null;
}

export async function definirAtivoConvenio(id, ativo) {
  const { rows } = await pool.query(
    "UPDATE convenios SET ativo = $2 WHERE id = $1 RETURNING id, nome, ativo",
    [id, ativo]
  );
  return rows[0] ?? null;
}
