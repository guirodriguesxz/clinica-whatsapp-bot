// src/models/convenioProcedimentoTussModel.js
import { pool } from "../db/pool.js";

export async function listarProcedimentosTuss(convenioId) {
  const { rows } = await pool.query(
    `SELECT tipo_atendimento, categoria, codigo_tuss, descricao_tuss
     FROM convenio_procedimentos_tuss WHERE convenio_id = $1`,
    [convenioId]
  );
  return rows;
}

/**
 * Substitui o mapeamento TUSS do convênio pelas linhas informadas. Linha
 * com código vazio remove o mapeamento existente daquela combinação
 * (tipo_atendimento, categoria) — nunca grava linha sem código, já que a
 * coluna é NOT NULL. Ver
 * docs/superpowers/specs/2026-09-04-tiss-eletronico-design.md.
 */
export async function salvarProcedimentosTuss(convenioId, linhas) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const linha of linhas) {
      if (linha.codigoTuss) {
        await client.query(
          `INSERT INTO convenio_procedimentos_tuss (convenio_id, tipo_atendimento, categoria, codigo_tuss, descricao_tuss)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (convenio_id, tipo_atendimento, categoria)
           DO UPDATE SET codigo_tuss = EXCLUDED.codigo_tuss, descricao_tuss = EXCLUDED.descricao_tuss`,
          [convenioId, linha.tipoAtendimento, linha.categoria, linha.codigoTuss, linha.descricaoTuss]
        );
      } else {
        await client.query(
          `DELETE FROM convenio_procedimentos_tuss WHERE convenio_id = $1 AND tipo_atendimento = $2 AND categoria = $3`,
          [convenioId, linha.tipoAtendimento, linha.categoria]
        );
      }
    }
    await client.query("COMMIT");
  } catch (erro) {
    await client.query("ROLLBACK");
    throw erro;
  } finally {
    client.release();
  }
}
