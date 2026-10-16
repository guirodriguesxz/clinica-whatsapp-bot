import { pool } from "../db/pool.js";

/**
 * Linha única com os dados cadastrais da clínica (não por convênio) — ver
 * docs/superpowers/specs/2026-09-04-tiss-eletronico-design.md.
 */
export async function buscarDadosPrestador() {
  const { rows } = await pool.query(
    "SELECT id, cnes, razao_social, cnpj, cbo_fisioterapia, cbo_psicologia FROM dados_prestador ORDER BY id LIMIT 1"
  );
  return rows[0] ?? null;
}

export async function salvarDadosPrestador({ cnes, razaoSocial, cnpj, cboFisioterapia, cboPsicologia }) {
  const existente = await buscarDadosPrestador();

  if (existente) {
    const { rows } = await pool.query(
      `UPDATE dados_prestador
       SET cnes = $2, razao_social = $3, cnpj = $4, cbo_fisioterapia = $5, cbo_psicologia = $6, atualizado_em = now()
       WHERE id = $1
       RETURNING id, cnes, razao_social, cnpj, cbo_fisioterapia, cbo_psicologia`,
      [existente.id, cnes, razaoSocial, cnpj, cboFisioterapia, cboPsicologia]
    );
    return rows[0];
  }

  const { rows } = await pool.query(
    `INSERT INTO dados_prestador (cnes, razao_social, cnpj, cbo_fisioterapia, cbo_psicologia)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, cnes, razao_social, cnpj, cbo_fisioterapia, cbo_psicologia`,
    [cnes, razaoSocial, cnpj, cboFisioterapia, cboPsicologia]
  );
  return rows[0];
}
