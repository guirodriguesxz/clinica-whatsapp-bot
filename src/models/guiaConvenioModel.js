// src/models/guiaConvenioModel.js
import { pool } from "../db/pool.js";

/**
 * Dados de uma guia de convênio pra um pagamento — sempre a partir do
 * estado atual, sem histórico de guias como entidade própria (mesma
 * decisão já usada nos Laudos, ver laudoModel.js).
 *
 * pagamentos.paciente_id é sempre preenchido (bot ou importado) e
 * pacientes.convenio/matricula_convenio já existem desde antes deste
 * módulo — por isso essa consulta não precisa resolver telefone/paciente
 * como o fluxo de registrar pagamento importado faz.
 *
 * "cancelada" detecta o estorno pela EXISTÊNCIA de uma linha própria
 * ligada por pagamento_origem_id (append-only, migration 013) — nunca
 * pelo status da linha original, que estornarPagamento nunca altera.
 */
export async function buscarDadosGuiaConvenio(pagamentoId) {
  const { rows } = await pool.query(
    `SELECT
       pg.id, pg.valor, pg.tipo_lancamento,
       p.nome AS paciente_nome, p.convenio, p.matricula_convenio,
       COALESCE(a.tipo_atendimento, ai.tipo_atendimento) AS tipo_atendimento,
       COALESCE(a.data, ai.data) AS data_atendimento,
       ra.profissional_responsavel,
       estorno.id AS estornado_por
     FROM pagamentos pg
     JOIN pacientes p ON p.id = pg.paciente_id
     LEFT JOIN agendamentos a ON a.id = pg.agendamento_id
     LEFT JOIN agendamentos_importados ai ON ai.id = pg.agendamento_importado_id
     LEFT JOIN registros_atendimento ra
       ON ra.agendamento_id = pg.agendamento_id OR ra.agendamento_importado_id = pg.agendamento_importado_id
     LEFT JOIN pagamentos estorno ON estorno.pagamento_origem_id = pg.id
     WHERE pg.id = $1`,
    [pagamentoId]
  );
  const registro = rows[0];
  if (!registro) return { motivo: "nao_encontrado" };
  if (registro.tipo_lancamento === "estorno") return { motivo: "eh_estorno" };

  return {
    dados: {
      pacienteNome: registro.paciente_nome,
      convenio: registro.convenio ?? null,
      matriculaConvenio: registro.matricula_convenio ?? null,
      tipoAtendimento: registro.tipo_atendimento,
      dataAtendimento: registro.data_atendimento,
      valor: registro.valor,
      profissionalResponsavel: registro.profissional_responsavel ?? null,
      numeroGuia: registro.id,
      cancelada: registro.estornado_por != null,
    },
  };
}
