import { pool } from "../db/pool.js";
import { limiteSeguroListagem, offsetSeguroListagem } from "../utils/paginacao.js";
import { PREDICADO_PACOTE_ATIVO } from "./pacoteSessaoModel.js";
async function buscarItensBot({ todos, janela }) {
  const filtroRegistro = todos ? "" : "AND ra.id IS NULL";
  const { rows } = await pool.query(
    `SELECT
       a.id,
       'bot' AS origem,
       p.nome AS paciente_nome,
       a.tipo_atendimento,
       a.data,
       a.hora,
       ra.presenca,
       ra.observacao_sessao,
       ra.profissional_responsavel,
       ra.registrado_em,
       u.nome AS registrado_por_nome
     FROM agendamentos a
     JOIN pacientes p ON p.id = a.paciente_id
     LEFT JOIN registros_atendimento ra ON ra.agendamento_id = a.id
     LEFT JOIN usuarios u ON u.id = ra.registrado_por
     WHERE a.status IN ('confirmado', 'compareceu', 'faltou')
       ${filtroRegistro}
     ORDER BY a.data DESC, a.hora DESC
     LIMIT $1`,
    [janela]
  );
  return rows;
}

async function buscarItensImportados({ todos, janela }) {
  const filtroRegistro = todos ? "" : "AND ra.id IS NULL";
  const { rows } = await pool.query(
    `SELECT
       ai.id,
       'importado' AS origem,
       ai.nome AS paciente_nome,
       ai.tipo_atendimento,
       ai.data,
       ai.hora,
       ra.presenca,
       ra.observacao_sessao,
       ra.profissional_responsavel,
       ra.registrado_em,
       u.nome AS registrado_por_nome
     FROM agendamentos_importados ai
     LEFT JOIN registros_atendimento ra ON ra.agendamento_importado_id = ai.id
     LEFT JOIN usuarios u ON u.id = ra.registrado_por
     WHERE ai.status IN ('confirmado', 'compareceu', 'faltou')
       ${filtroRegistro}
     ORDER BY ai.data DESC, ai.hora DESC
     LIMIT $1`,
    [janela]
  );
  return rows;
}

/**
 * Lista combinada bot + importados pra tela /presenca. Cada query busca
 * exatamente offsetSeguro + limiteSeguro linhas — a janela mínima que pode
 * conter a página pedida — porque limite/offset finais são aplicados em
 * memória sobre a lista já combinada e ordenada, não em cada query
 * separadamente (paginar duas fontes heterogêneas direto no SQL exigiria
 * UNION com casts pra alinhar as colunas — desnecessário nesta escala).
 * Um LIMIT fixo por fonte, menor que offset+limite, deixaria linhas antigas
 * inalcançáveis em qualquer página assim que uma fonte tivesse mais linhas
 * que o fixo.
 */
export async function listarPresenca({ todos, limite, offset } = {}) {
  const limiteSeguro = limiteSeguroListagem(limite);
  const offsetSeguro = offsetSeguroListagem(offset);
  const todosBooleano = Boolean(todos);
  const janela = offsetSeguro + limiteSeguro;

  const [itensBot, itensImportados] = await Promise.all([
    buscarItensBot({ todos: todosBooleano, janela }),
    buscarItensImportados({ todos: todosBooleano, janela }),
  ]);

  const combinados = [...itensBot, ...itensImportados].sort((x, y) =>
    `${y.data}T${y.hora}`.localeCompare(`${x.data}T${x.hora}`)
  );

  return combinados.slice(offsetSeguro, offsetSeguro + limiteSeguro);
}

/**
 * Presença atual (antes de uma nova marcação) — usado pelo controller pra
 * distinguir "primeira marcação de compareceu" de "correção de uma linha que
 * já estava compareceu" (ex: só ajustando observação), já que só a primeira
 * deve disparar a geração automática de pagamento (ver
 * pagamentoModel.tentarGerarPagamentoAutomatico). Passar só um dos dois ids;
 * o outro fica null e nunca casa (comparação com NULL nunca é verdadeira).
 */
export async function buscarPresencaAtual({ agendamentoId = null, agendamentoImportadoId = null }) {
  const { rows } = await pool.query(
    `SELECT presenca FROM registros_atendimento
     WHERE ($1::int IS NOT NULL AND agendamento_id = $1) OR ($2::int IS NOT NULL AND agendamento_importado_id = $2)`,
    [agendamentoId, agendamentoImportadoId]
  );
  return rows[0]?.presenca ?? null;
}

async function buscarAgendamentoParaPresenca(id) {
  const { rows } = await pool.query(
    `SELECT id, status, paciente_id, tipo_atendimento
     FROM agendamentos
     WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

async function buscarImportadoParaPresenca(id) {
  const { rows } = await pool.query(
    `SELECT id, status
     FROM agendamentos_importados
     WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

/**
 * Marca presença de um agendamento do bot. Faz duas escritas numa
 * transação: atualiza agendamentos.status (compareceu/faltou) e faz upsert
 * em registros_atendimento — precisam ser atômicas, senão um erro no meio
 * deixaria o status dizendo uma coisa e o registro de presença outra (ou
 * nenhum registro). O UPDATE usa `WHERE status <> 'cancelado'` (não só
 * `= 'confirmado'`) de propósito: permite tanto marcar pela primeira vez
 * quanto corrigir um registro já feito (status já compareceu/faltou), só
 * bloqueando se o agendamento foi cancelado entre a pré-checagem e aqui
 * (corrida real, ainda que rara) — nesse caso retorna motivo 'conflito'.
 */
export async function registrarPresencaBot({
  agendamentoId,
  presenca,
  observacaoSessao,
  profissionalResponsavel,
  registradoPor,
}) {
  const agendamento = await buscarAgendamentoParaPresenca(agendamentoId);
  if (!agendamento) return { motivo: "nao_encontrado" };
  if (agendamento.status === "cancelado") return { motivo: "cancelado" };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const atualizado = await client.query(
      `UPDATE agendamentos SET status = $2 WHERE id = $1 AND status <> 'cancelado' RETURNING id`,
      [agendamentoId, presenca]
    );
    if (atualizado.rowCount === 0) {
      await client.query("ROLLBACK");
      return { motivo: "conflito" };
    }

    // Vínculo automático com o pacote de sessão ativo do paciente (pacotes
    // de sessão só existem pra Fisioterapia — ver spec). Duas situações bem
    // diferentes escondidas atrás do mesmo "presenca === compareceu":
    //
    // 1. Primeira marcação de compareceu pra este agendamento (ou uma que
    //    veio depois de um 'faltou', que já limpou o vínculo antigo) — aí
    //    sim busca o pacote ativo NESTE momento. A busca roda no mesmo
    //    client/transação do UPDATE acima (não via pacoteSessaoModel, que
    //    usa `pool` diretamente) pra ficar atômica com o INSERT/UPDATE de
    //    registros_atendimento logo abaixo. Um advisory lock escopado no
    //    paciente (mesmo padrão de criarPacote) protege contra duas
    //    marcações concorrentes pro mesmo paciente enxergarem a mesma vaga
    //    livre do pacote e vincularem as duas ao mesmo pacote quase cheio.
    //
    // 2. Correção de uma linha que JÁ está com compareceu (ex: ajustar só a
    //    observação, sem mudar a presença) — aqui o vínculo já existe e
    //    NUNCA deve ser reavaliado: se recomputássemos, um pacote que essa
    //    própria linha ajuda a preencher (ex: 10/10, sendo esta uma das 10)
    //    pareceria "não ativo" (10 < 10 é falso) e a correção desvincularia
    //    silenciosamente uma sessão corretamente contada — ou, pior, se um
    //    pacote novo já existir para o paciente, relincaria pro pacote
    //    novo, furando uma vaga dele e deixando os dois pacotes com
    //    aparência de "ativo" ao mesmo tempo (quebra o invariante de no
    //    máximo um pacote ativo). Por isso: nenhum lookup, nenhum lock —
    //    só reaproveita o pacote_id que a linha já tinha.
    //
    // Um 'faltou' sempre limpa o vínculo (pacoteId permanece null abaixo) —
    // comportamento já existente, preservado.
    let pacoteId = null;
    if (presenca === "compareceu" && agendamento.tipo_atendimento === "fisioterapia") {
      const { rows: registroExistenteRows } = await client.query(
        `SELECT pacote_id FROM registros_atendimento WHERE agendamento_id = $1`,
        [agendamentoId]
      );
      const pacoteJaVinculado = registroExistenteRows[0]?.pacote_id ?? null;

      if (pacoteJaVinculado) {
        pacoteId = pacoteJaVinculado;
      } else {
        await client.query("SELECT pg_advisory_xact_lock($1)", [agendamento.paciente_id]);
        const { rows: pacoteRows } = await client.query(
          `SELECT ps.id
           FROM pacotes_sessoes ps
           WHERE ps.paciente_id = $1
             AND ${PREDICADO_PACOTE_ATIVO}
           ORDER BY ps.created_at DESC
           LIMIT 1`,
          [agendamento.paciente_id]
        );
        pacoteId = pacoteRows[0]?.id ?? null;
      }
    }

    // pacote_id = EXCLUDED.pacote_id (sem CASE aqui) é seguro porque
    // `pacoteId` em JS já chegou totalmente resolvido pelo bloco acima:
    // vínculo existente preservado, lookup fresco só quando não havia
    // vínculo, ou null pra faltou/não-fisioterapia. Não há mais nenhum
    // cenário em que "o que está em EXCLUDED" e "o que deveria ficar
    // gravado" divirjam.
    const { rows } = await client.query(
      `INSERT INTO registros_atendimento (agendamento_id, presenca, observacao_sessao, profissional_responsavel, registrado_por, pacote_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (agendamento_id) WHERE agendamento_id IS NOT NULL DO UPDATE
         SET presenca = EXCLUDED.presenca,
             observacao_sessao = EXCLUDED.observacao_sessao,
             profissional_responsavel = EXCLUDED.profissional_responsavel,
             registrado_por = EXCLUDED.registrado_por,
             registrado_em = now(),
             pacote_id = EXCLUDED.pacote_id
       RETURNING *`,
      [agendamentoId, presenca, observacaoSessao, profissionalResponsavel, registradoPor, pacoteId]
    );
    await client.query("COMMIT");
    return { registro: rows[0] };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Marca presença de um agendamento importado. Mesma sequência de
 * registrarPresencaBot (ver comentário lá pro motivo de ser transação):
 * atualiza agendamentos_importados.status (compareceu/faltou) e faz upsert
 * em registros_atendimento numa única transação. agendamentos_importados
 * ganhou a coluna status na migration 020 — antes disso não havia o que
 * atualizar aqui, só o upsert.
 */
export async function registrarPresencaImportado({
  agendamentoImportadoId,
  presenca,
  observacaoSessao,
  profissionalResponsavel,
  registradoPor,
}) {
  const agendamento = await buscarImportadoParaPresenca(agendamentoImportadoId);
  if (!agendamento) return { motivo: "nao_encontrado" };
  if (agendamento.status === "cancelado") return { motivo: "cancelado" };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const atualizado = await client.query(
      `UPDATE agendamentos_importados SET status = $2 WHERE id = $1 AND status <> 'cancelado' RETURNING id`,
      [agendamentoImportadoId, presenca]
    );
    if (atualizado.rowCount === 0) {
      await client.query("ROLLBACK");
      return { motivo: "conflito" };
    }

    const { rows } = await client.query(
      `INSERT INTO registros_atendimento (agendamento_importado_id, presenca, observacao_sessao, profissional_responsavel, registrado_por)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (agendamento_importado_id) WHERE agendamento_importado_id IS NOT NULL DO UPDATE
         SET presenca = EXCLUDED.presenca,
             observacao_sessao = EXCLUDED.observacao_sessao,
             profissional_responsavel = EXCLUDED.profissional_responsavel,
             registrado_por = EXCLUDED.registrado_por,
             registrado_em = now()
       RETURNING *`,
      [agendamentoImportadoId, presenca, observacaoSessao, profissionalResponsavel, registradoPor]
    );
    await client.query("COMMIT");
    return { registro: rows[0] };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
