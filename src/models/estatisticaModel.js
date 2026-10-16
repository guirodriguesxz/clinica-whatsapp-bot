// src/models/estatisticaModel.js
import { pool } from "../db/pool.js";
import { calcularRepasseLinha } from "./pagamentoModel.js";

// Mesma técnica de reversão de estorno que buscarRelatorioMensal já usa em
// pagamentoModel.js: um estorno é uma linha própria (append-only, migration
// 013), então soma-la direto dobraria o valor — precisa abater.
const VALOR_LIQUIDO = `CASE WHEN pg.tipo_lancamento = 'estorno' THEN -pg.valor ELSE pg.valor END`;

const JOINS_PAGAMENTO = `
  LEFT JOIN agendamentos a ON a.id = pg.agendamento_id
  LEFT JOIN agendamentos_importados ai ON ai.id = pg.agendamento_importado_id`;

async function buscarFaturamento({ dataInicio, dataFim }) {
  const parametros = [dataInicio, dataFim];
  const where = `WHERE pg.data >= $1 AND pg.data <= $2`;

  const [total, recebido, pendente, porEspecialidade] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(${VALOR_LIQUIDO}), 0) AS total FROM pagamentos pg ${where}`, parametros),
    pool.query(
      `SELECT COALESCE(SUM(${VALOR_LIQUIDO}), 0) AS total FROM pagamentos pg ${where} AND pg.status = 'pago'`,
      parametros
    ),
    pool.query(
      `SELECT COALESCE(SUM(${VALOR_LIQUIDO}), 0) AS total FROM pagamentos pg ${where} AND pg.status IN ('pendente', 'aguardando_reembolso')`,
      parametros
    ),
    pool.query(
      `SELECT COALESCE(a.tipo_atendimento, ai.tipo_atendimento) AS tipo_atendimento,
              COALESCE(SUM(${VALOR_LIQUIDO}), 0) AS total,
              COALESCE(SUM(${VALOR_LIQUIDO}) FILTER (WHERE pg.status = 'pago'), 0) AS recebido,
              COALESCE(SUM(${VALOR_LIQUIDO}) FILTER (WHERE pg.status IN ('pendente', 'aguardando_reembolso')), 0) AS pendente
       FROM pagamentos pg ${JOINS_PAGAMENTO} ${where}
       GROUP BY COALESCE(a.tipo_atendimento, ai.tipo_atendimento)`,
      parametros
    ),
  ]);

  return {
    total: total.rows[0]?.total ?? 0,
    recebido: recebido.rows[0]?.total ?? 0,
    pendente: pendente.rows[0]?.total ?? 0,
    porEspecialidade: porEspecialidade.rows,
  };
}

async function buscarAtendimentos({ dataInicio, dataFim }) {
  const parametros = [dataInicio, dataFim];
  const joins = `
    LEFT JOIN agendamentos a ON a.id = ra.agendamento_id
    LEFT JOIN agendamentos_importados ai ON ai.id = ra.agendamento_importado_id`;
  const where = `WHERE ra.presenca = 'compareceu' AND COALESCE(a.data, ai.data) >= $1 AND COALESCE(a.data, ai.data) <= $2`;

  const [total, porEspecialidade, porProfissional] = await Promise.all([
    pool.query(`SELECT COUNT(*) AS quantidade FROM registros_atendimento ra ${joins} ${where}`, parametros),
    pool.query(
      `SELECT COALESCE(a.tipo_atendimento, ai.tipo_atendimento) AS tipo_atendimento, COUNT(*) AS quantidade
       FROM registros_atendimento ra ${joins} ${where}
       GROUP BY COALESCE(a.tipo_atendimento, ai.tipo_atendimento)`,
      parametros
    ),
    pool.query(
      `SELECT COALESCE(NULLIF(ra.profissional_responsavel, ''), 'Não informado') AS profissional, COUNT(*) AS quantidade
       FROM registros_atendimento ra ${joins} ${where}
       GROUP BY COALESCE(NULLIF(ra.profissional_responsavel, ''), 'Não informado')
       ORDER BY quantidade DESC`,
      parametros
    ),
  ]);

  return {
    total: Number(total.rows[0]?.quantidade ?? 0),
    porEspecialidade: porEspecialidade.rows,
    porProfissional: porProfissional.rows,
  };
}

// Mesmo agrupamento por convênio de buscarRelatorioMensal (pagamentoModel.js,
// query porPlano) — reaproveita calcularRepasseLinha de lá pra não duplicar a
// regra de quando o repasse fica null (convênio não identificado no paciente
// vs. convênio identificado mas sem valor de repasse cadastrado). Diferença
// daqui pro relatório mensal: período livre (dataInicio/dataFim, como o resto
// desta tela), sem filtro de plano/especialidade.
async function buscarRepassePorConvenio({ dataInicio, dataFim }) {
  const parametros = [dataInicio, dataFim];
  const where = `WHERE pg.data >= $1 AND pg.data <= $2`;
  const joins = `${JOINS_PAGAMENTO}
    LEFT JOIN pacientes p ON p.id = pg.paciente_id`;

  const { rows } = await pool.query(
    `SELECT
       chave_grupo,
       MAX(nome_exibicao) AS plano,
       COALESCE(SUM(CASE WHEN tipo_lancamento = 'estorno' THEN -valor ELSE valor END), 0) AS total,
       COUNT(*) FILTER (WHERE tipo_lancamento = 'pagamento') AS quantidade,
       COUNT(*) FILTER (WHERE tipo_lancamento = 'estorno') AS quantidade_estornos,
       COUNT(*) FILTER (WHERE tipo_lancamento = 'pagamento' AND primeira_consulta IS TRUE)
         - COUNT(*) FILTER (WHERE tipo_lancamento = 'estorno' AND primeira_consulta IS TRUE) AS quantidade_avaliacao,
       COUNT(*) FILTER (WHERE tipo_lancamento = 'pagamento' AND primeira_consulta IS NOT TRUE)
         - COUNT(*) FILTER (WHERE tipo_lancamento = 'estorno' AND primeira_consulta IS NOT TRUE) AS quantidade_sessao,
       bool_or(convenio_identificado) AS convenio_identificado,
       MAX(valor_repasse_avaliacao) AS valor_repasse_avaliacao,
       MAX(valor_repasse_sessao) AS valor_repasse_sessao
     FROM (
       SELECT
         pg.tipo_lancamento, pg.valor, a.primeira_consulta,
         c.valor_repasse_avaliacao, c.valor_repasse_sessao,
         (c.id IS NOT NULL) AS convenio_identificado,
         COALESCE(c.id::text, 'txt:' || COALESCE(ai.convenio, p.convenio, 'Não informado')) AS chave_grupo,
         COALESCE(c.nome, ai.convenio, p.convenio, 'Não informado') AS nome_exibicao
       FROM pagamentos pg ${joins}
       LEFT JOIN convenios c ON c.id = p.convenio_id
       ${where}
     ) linhas
     GROUP BY chave_grupo`,
    parametros
  );
  return rows.map(calcularRepasseLinha);
}

/**
 * Estatísticas agregadas (faturamento + atendimentos realizados) pra tela
 * /estatisticas, num intervalo de datas livre — não só o mês corrente como
 * /financeiro/relatorio. dataInicio/dataFim já chegam validados por
 * resolverPeriodo (src/utils/periodoEstatisticas.js); este model não
 * valida nada, só consulta.
 */
export async function buscarEstatisticas({ dataInicio, dataFim }) {
  const [faturamento, atendimentos, repassePorConvenio] = await Promise.all([
    buscarFaturamento({ dataInicio, dataFim }),
    buscarAtendimentos({ dataInicio, dataFim }),
    buscarRepassePorConvenio({ dataInicio, dataFim }),
  ]);
  return { faturamento, atendimentos, repassePorConvenio };
}
