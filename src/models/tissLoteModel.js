// src/models/tissLoteModel.js
import { pool } from "../db/pool.js";

/**
 * Guias candidatas a um lote TISS: pagamentos com forma "convenio" do
 * convênio escolhido, dentro do período, já com a categoria
 * (avaliacao/sessao) e o código TUSS correspondente resolvidos via join —
 * mesma lógica de primeira_consulta usada no cálculo de repasse
 * (pagamentoModel.js): só agendamentos do bot têm essa coluna, importados
 * sempre contam como sessão. Pagamentos já estornados são excluídos (mesmo
 * padrão de estornado_por em guiaConvenioModel.js).
 */
export async function buscarGuiasConvenioPeriodo({ convenioId, inicio, fim }) {
  const { rows } = await pool.query(
    `SELECT
       pg.id AS pagamento_id, pg.valor,
       p.nome AS paciente_nome, p.matricula_convenio, p.sexo, p.cns,
       COALESCE(a.tipo_atendimento, ai.tipo_atendimento) AS tipo_atendimento,
       COALESCE(a.data, ai.data) AS data_atendimento,
       CASE WHEN a.primeira_consulta IS TRUE THEN 'avaliacao' ELSE 'sessao' END AS categoria,
       tuss.codigo_tuss, tuss.descricao_tuss
     FROM pagamentos pg
     JOIN pacientes p ON p.id = pg.paciente_id
     LEFT JOIN agendamentos a ON a.id = pg.agendamento_id
     LEFT JOIN agendamentos_importados ai ON ai.id = pg.agendamento_importado_id
     LEFT JOIN pagamentos estorno ON estorno.pagamento_origem_id = pg.id
     LEFT JOIN convenio_procedimentos_tuss tuss
       ON tuss.convenio_id = p.convenio_id
       AND tuss.tipo_atendimento = COALESCE(a.tipo_atendimento, ai.tipo_atendimento)
       AND tuss.categoria = CASE WHEN a.primeira_consulta IS TRUE THEN 'avaliacao' ELSE 'sessao' END
     WHERE pg.forma_pagamento = 'convenio'
       AND pg.tipo_lancamento = 'pagamento'
       AND p.convenio_id = $1
       AND COALESCE(a.data, ai.data) BETWEEN $2 AND $3
       AND estorno.id IS NULL
     ORDER BY COALESCE(a.data, ai.data) ASC, pg.id ASC`,
    [convenioId, inicio, fim]
  );
  return rows;
}

/**
 * Nunca inventa dado: guia sem matrícula de convênio ou sem código TUSS
 * pra sua combinação (tipo_atendimento, categoria) fica de fora do lote,
 * com o motivo explícito — ver
 * docs/superpowers/specs/2026-09-04-tiss-eletronico-design.md.
 */
export function classificarGuias(linhas) {
  const prontas = [];
  const incompletas = [];
  for (const linha of linhas) {
    if (!linha.matricula_convenio) {
      incompletas.push({ ...linha, motivo: "paciente_sem_matricula" });
      continue;
    }
    if (!linha.codigo_tuss) {
      incompletas.push({ ...linha, motivo: "tuss_nao_cadastrado" });
      continue;
    }
    prontas.push(linha);
  }
  return { prontas, incompletas };
}

/**
 * Pré-requisitos de nível clínica/convênio (não por guia individual) —
 * ausência de qualquer um bloqueia a geração do lote inteiro.
 */
export function motivosBloqueioLote({ dadosPrestador, convenio }) {
  const motivos = [];
  if (!dadosPrestador?.cnes && !dadosPrestador?.cnpj) motivos.push("dados_prestador_incompletos");
  if (!convenio?.codigo_prestador_na_operadora) motivos.push("codigo_prestador_na_operadora_ausente");
  if (!convenio?.numero_contrato) motivos.push("numero_contrato_ausente");
  return motivos;
}
