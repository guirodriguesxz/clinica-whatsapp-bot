// src/models/estatisticaModel.js
import { pool } from "../db/pool.js";
import dayjs from "../utils/dayjs.js";
import { mesSeguro } from "../utils/mesSeguro.js";

/**
 * Estatísticas agregadas do mês pra tela /estatisticas (sub-projeto 8) —
 * consultas agregadas sobre dado que os módulos anteriores já geram
 * (agendamentos, presença, convênio). Sem gráfico/exportação Excel por
 * enquanto (escopo mínimo — ver spec macro: "só faz sentido depois de
 * existir volume real de dado pra relatar"); tabelas simples, mesmo padrão
 * de /financeiro/relatorio.
 *
 * porTipoAtendimento/porConvenio usam UNION ALL bot+importados antes do
 * GROUP BY (uma query só) em vez de duas + merge em JS, porque aqui não
 * precisa dos dados individuais de cada fonte — só a contagem agregada.
 */
export async function buscarEstatisticasMensais({ mes } = {}) {
  const mesResolvido = mesSeguro(mes);
  const inicio = `${mesResolvido}-01`;
  const fimExclusivo = dayjs(inicio, "YYYY-MM-DD").add(1, "month").format("YYYY-MM-DD");

  const [porTipo, porPresenca, porConvenio] = await Promise.all([
    pool.query(
      `SELECT tipo_atendimento, COUNT(*) AS quantidade FROM (
         SELECT tipo_atendimento FROM agendamentos WHERE data >= $1 AND data < $2
         UNION ALL
         SELECT tipo_atendimento FROM agendamentos_importados WHERE data >= $1 AND data < $2
       ) t
       GROUP BY tipo_atendimento
       ORDER BY quantidade DESC`,
      [inicio, fimExclusivo]
    ),
    pool.query(
      `SELECT ra.presenca, COUNT(*) AS quantidade
       FROM registros_atendimento ra
       LEFT JOIN agendamentos a ON a.id = ra.agendamento_id
       LEFT JOIN agendamentos_importados ai ON ai.id = ra.agendamento_importado_id
       WHERE COALESCE(a.data, ai.data) >= $1 AND COALESCE(a.data, ai.data) < $2
       GROUP BY ra.presenca`,
      [inicio, fimExclusivo]
    ),
    pool.query(
      `SELECT convenio, COUNT(*) AS quantidade FROM (
         SELECT COALESCE(p.convenio, 'Sem convênio') AS convenio
         FROM agendamentos a
         JOIN pacientes p ON p.id = a.paciente_id
         WHERE a.data >= $1 AND a.data < $2
         UNION ALL
         SELECT COALESCE(ai.convenio, 'Sem convênio') AS convenio
         FROM agendamentos_importados ai
         WHERE ai.data >= $1 AND ai.data < $2
       ) t
       GROUP BY convenio
       ORDER BY quantidade DESC`,
      [inicio, fimExclusivo]
    ),
  ]);

  return {
    mes: mesResolvido,
    porTipoAtendimento: porTipo.rows,
    porPresenca: porPresenca.rows,
    porConvenio: porConvenio.rows,
  };
}
