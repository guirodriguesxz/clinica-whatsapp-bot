import { pool } from "../db/pool.js";

export async function listarRelatoriosPaciente(pacienteId) {
  const { rows } = await pool.query(
    `SELECT id, data_relatorio FROM relatorios_fisioterapeuticos
     WHERE paciente_id = $1
     ORDER BY data_relatorio DESC, id DESC`,
    [pacienteId]
  );
  return rows.map((r) => ({ id: r.id, dataRelatorio: r.data_relatorio }));
}

/**
 * Escopado por paciente_id — nunca retorna um relatório de outro
 * paciente, mesmo que o id exista (evita adivinhar id e acessar/editar
 * relatório de paciente errado via URL).
 */
export async function buscarRelatorioDoPaciente(relatorioId, pacienteId) {
  const { rows } = await pool.query(
    `SELECT id, paciente_id, data_relatorio, diagnostico_motivo, conduta_evolucao,
            consideracoes_finais, profissional_responsavel, fisioterapeuta_id
     FROM relatorios_fisioterapeuticos
     WHERE id = $1 AND paciente_id = $2`,
    [relatorioId, pacienteId]
  );
  const registro = rows[0];
  if (!registro) return null;

  return {
    id: registro.id,
    pacienteId: registro.paciente_id,
    dataRelatorio: registro.data_relatorio,
    diagnosticoMotivo: registro.diagnostico_motivo,
    condutaEvolucao: registro.conduta_evolucao,
    consideracoesFinais: registro.consideracoes_finais,
    profissionalResponsavel: registro.profissional_responsavel,
    fisioterapeutaId: registro.fisioterapeuta_id,
  };
}

export async function criarRelatorio({
  pacienteId, dataRelatorio, diagnosticoMotivo, condutaEvolucao,
  consideracoesFinais, profissionalResponsavel, fisioterapeutaId, registradoPor,
}) {
  const { rows } = await pool.query(
    `INSERT INTO relatorios_fisioterapeuticos (
       paciente_id, data_relatorio, diagnostico_motivo, conduta_evolucao,
       consideracoes_finais, profissional_responsavel, fisioterapeuta_id, registrado_por
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [
      pacienteId, dataRelatorio, diagnosticoMotivo, condutaEvolucao,
      consideracoesFinais, profissionalResponsavel, fisioterapeutaId, registradoPor,
    ]
  );
  return rows[0].id;
}

/**
 * Escopado por paciente_id, mesmo motivo de buscarRelatorioDoPaciente —
 * nunca exclui relatório de outro paciente via URL adivinhada. Devolve
 * quantas linhas apagou (0 ou 1) pra o controller decidir 404 vs sucesso.
 */
export async function excluirRelatorio(relatorioId, pacienteId) {
  const { rowCount } = await pool.query(
    "DELETE FROM relatorios_fisioterapeuticos WHERE id = $1 AND paciente_id = $2",
    [relatorioId, pacienteId]
  );
  return rowCount > 0;
}

export async function atualizarRelatorio(relatorioId, {
  dataRelatorio, diagnosticoMotivo, condutaEvolucao,
  consideracoesFinais, profissionalResponsavel, fisioterapeutaId,
}) {
  await pool.query(
    `UPDATE relatorios_fisioterapeuticos SET
       data_relatorio = $2, diagnostico_motivo = $3, conduta_evolucao = $4,
       consideracoes_finais = $5, profissional_responsavel = $6, fisioterapeuta_id = $7
     WHERE id = $1`,
    [
      relatorioId, dataRelatorio, diagnosticoMotivo, condutaEvolucao,
      consideracoesFinais, profissionalResponsavel, fisioterapeutaId,
    ]
  );
}
