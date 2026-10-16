import { pool } from "../db/pool.js";

export async function listarAvaliacoesPaciente(pacienteId) {
  const { rows } = await pool.query(
    `SELECT id, data_avaliacao FROM avaliacoes_fisioterapeuticas
     WHERE paciente_id = $1
     ORDER BY data_avaliacao DESC, id DESC`,
    [pacienteId]
  );
  return rows.map((r) => ({ id: r.id, dataAvaliacao: r.data_avaliacao }));
}

/**
 * Escopado por paciente_id — nunca retorna uma avaliação de outro
 * paciente, mesmo que o id exista (evita adivinhar id e acessar/editar
 * avaliação de paciente errado via URL).
 */
export async function buscarAvaliacaoDoPaciente(avaliacaoId, pacienteId) {
  const { rows } = await pool.query(
    `SELECT id, paciente_id, data_avaliacao, esta_gravida, possui_marcapasso,
            possui_protese_metalica_implantes, possui_doencas_cardiacas,
            possui_hipertensao_arterial, possui_diabetes, possui_epilepsia,
            possui_historico_cancer, medicamentos_continuos_quais, cirurgia_qual,
            cirurgia_quando, tempo_ultima_cirurgia, dor_atual_local,
            dor_atual_intensidade, limitacoes_funcionais_quais,
            fisioterapia_anteriormente, objetivos_tratamento, condutas_propostas
     FROM avaliacoes_fisioterapeuticas
     WHERE id = $1 AND paciente_id = $2`,
    [avaliacaoId, pacienteId]
  );
  const registro = rows[0];
  if (!registro) return null;

  return {
    id: registro.id,
    pacienteId: registro.paciente_id,
    dataAvaliacao: registro.data_avaliacao,
    estaGravida: registro.esta_gravida,
    possuiMarcapasso: registro.possui_marcapasso,
    possuiProteseMetalicaImplantes: registro.possui_protese_metalica_implantes,
    possuiDoencasCardiacas: registro.possui_doencas_cardiacas,
    possuiHipertensaoArterial: registro.possui_hipertensao_arterial,
    possuiDiabetes: registro.possui_diabetes,
    possuiEpilepsia: registro.possui_epilepsia,
    possuiHistoricoCancer: registro.possui_historico_cancer,
    medicamentosContinuosQuais: registro.medicamentos_continuos_quais,
    cirurgiaQual: registro.cirurgia_qual,
    cirurgiaQuando: registro.cirurgia_quando,
    tempoUltimaCirurgia: registro.tempo_ultima_cirurgia,
    dorAtualLocal: registro.dor_atual_local,
    dorAtualIntensidade: registro.dor_atual_intensidade,
    limitacoesFuncionaisQuais: registro.limitacoes_funcionais_quais,
    fisioterapiaAnteriormente: registro.fisioterapia_anteriormente,
    objetivosTratamento: registro.objetivos_tratamento,
    condutasPropostas: registro.condutas_propostas,
  };
}

export async function criarAvaliacao({
  pacienteId, dataAvaliacao, estaGravida, possuiMarcapasso,
  possuiProteseMetalicaImplantes, possuiDoencasCardiacas, possuiHipertensaoArterial,
  possuiDiabetes, possuiEpilepsia, possuiHistoricoCancer, medicamentosContinuosQuais,
  cirurgiaQual, cirurgiaQuando, tempoUltimaCirurgia, dorAtualLocal, dorAtualIntensidade,
  limitacoesFuncionaisQuais, fisioterapiaAnteriormente, objetivosTratamento,
  condutasPropostas, registradoPor,
}) {
  const { rows } = await pool.query(
    `INSERT INTO avaliacoes_fisioterapeuticas (
       paciente_id, data_avaliacao, esta_gravida, possui_marcapasso,
       possui_protese_metalica_implantes, possui_doencas_cardiacas,
       possui_hipertensao_arterial, possui_diabetes, possui_epilepsia,
       possui_historico_cancer, medicamentos_continuos_quais, cirurgia_qual,
       cirurgia_quando, tempo_ultima_cirurgia, dor_atual_local,
       dor_atual_intensidade, limitacoes_funcionais_quais,
       fisioterapia_anteriormente, objetivos_tratamento, condutas_propostas,
       registrado_por
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     RETURNING id`,
    [
      pacienteId, dataAvaliacao, estaGravida, possuiMarcapasso,
      possuiProteseMetalicaImplantes, possuiDoencasCardiacas, possuiHipertensaoArterial,
      possuiDiabetes, possuiEpilepsia, possuiHistoricoCancer, medicamentosContinuosQuais,
      cirurgiaQual, cirurgiaQuando, tempoUltimaCirurgia, dorAtualLocal, dorAtualIntensidade,
      limitacoesFuncionaisQuais, fisioterapiaAnteriormente, objetivosTratamento,
      condutasPropostas, registradoPor,
    ]
  );
  return rows[0].id;
}

export async function atualizarAvaliacao(avaliacaoId, {
  dataAvaliacao, estaGravida, possuiMarcapasso, possuiProteseMetalicaImplantes,
  possuiDoencasCardiacas, possuiHipertensaoArterial, possuiDiabetes, possuiEpilepsia,
  possuiHistoricoCancer, medicamentosContinuosQuais, cirurgiaQual, cirurgiaQuando,
  tempoUltimaCirurgia, dorAtualLocal, dorAtualIntensidade, limitacoesFuncionaisQuais,
  fisioterapiaAnteriormente, objetivosTratamento, condutasPropostas,
}) {
  await pool.query(
    `UPDATE avaliacoes_fisioterapeuticas SET
       data_avaliacao = $2, esta_gravida = $3, possui_marcapasso = $4,
       possui_protese_metalica_implantes = $5, possui_doencas_cardiacas = $6,
       possui_hipertensao_arterial = $7, possui_diabetes = $8, possui_epilepsia = $9,
       possui_historico_cancer = $10, medicamentos_continuos_quais = $11,
       cirurgia_qual = $12, cirurgia_quando = $13, tempo_ultima_cirurgia = $14,
       dor_atual_local = $15, dor_atual_intensidade = $16,
       limitacoes_funcionais_quais = $17, fisioterapia_anteriormente = $18,
       objetivos_tratamento = $19, condutas_propostas = $20
     WHERE id = $1`,
    [
      avaliacaoId, dataAvaliacao, estaGravida, possuiMarcapasso,
      possuiProteseMetalicaImplantes, possuiDoencasCardiacas, possuiHipertensaoArterial,
      possuiDiabetes, possuiEpilepsia, possuiHistoricoCancer, medicamentosContinuosQuais,
      cirurgiaQual, cirurgiaQuando, tempoUltimaCirurgia, dorAtualLocal, dorAtualIntensidade,
      limitacoesFuncionaisQuais, fisioterapiaAnteriormente, objetivosTratamento,
      condutasPropostas,
    ]
  );
}
