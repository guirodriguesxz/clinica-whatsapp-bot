// src/models/laudoModel.js
import { pool } from "../db/pool.js";

/**
 * Dados de um laudo pra um agendamento do bot. Motivo estruturado, mesmo
 * padrão de registrarPresenca()/registrarPagamento(): 'nao_encontrado' quando
 * o agendamento não existe, 'sem_observacao' quando existe mas
 * observacao_sessao ainda não foi preenchida (nada pra documentar).
 * profissional_responsavel não tem fallback pro bot — spec: "campo
 * simplesmente não aparece no PDF" quando ausente.
 */
export async function buscarDadosLaudoBot(agendamentoId) {
  const { rows } = await pool.query(
    `SELECT p.nome AS paciente_nome,
            a.data,
            ra.observacao_sessao,
            ra.profissional_responsavel
     FROM agendamentos a
     JOIN pacientes p ON p.id = a.paciente_id
     LEFT JOIN registros_atendimento ra ON ra.agendamento_id = a.id
     WHERE a.id = $1`,
    [agendamentoId]
  );
  const registro = rows[0];
  if (!registro) return { motivo: "nao_encontrado" };
  if (!registro.observacao_sessao) return { motivo: "sem_observacao" };

  return {
    dados: {
      pacienteNome: registro.paciente_nome,
      data: registro.data,
      profissionalResponsavel: registro.profissional_responsavel ?? null,
      observacaoSessao: registro.observacao_sessao,
    },
  };
}

/**
 * Dados de um laudo pra um agendamento importado. Diferente do bot,
 * profissional_responsavel cai pro dado legado agendamentos_importados.atendente
 * quando ausente (spec: "usa atendente como fallback, se existir — só omite
 * a linha se nem um nem outro existirem").
 */
export async function buscarDadosLaudoImportado(agendamentoImportadoId) {
  const { rows } = await pool.query(
    `SELECT ai.nome AS paciente_nome,
            ai.data,
            ai.atendente,
            ra.observacao_sessao,
            ra.profissional_responsavel
     FROM agendamentos_importados ai
     LEFT JOIN registros_atendimento ra ON ra.agendamento_importado_id = ai.id
     WHERE ai.id = $1`,
    [agendamentoImportadoId]
  );
  const registro = rows[0];
  if (!registro) return { motivo: "nao_encontrado" };
  if (!registro.observacao_sessao) return { motivo: "sem_observacao" };

  return {
    dados: {
      pacienteNome: registro.paciente_nome,
      data: registro.data,
      profissionalResponsavel: registro.profissional_responsavel ?? registro.atendente ?? null,
      observacaoSessao: registro.observacao_sessao,
    },
  };
}
