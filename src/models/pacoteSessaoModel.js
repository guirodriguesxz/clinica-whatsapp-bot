import { pool } from "../db/pool.js";

/**
 * Subquery "quantas sessões já foram usadas de um pacote" — conta só
 * registros com presença efetivamente 'compareceu'. Em teoria um 'faltou'
 * nunca deveria carregar pacote_id (a escrita já garante isso), mas filtrar
 * por presença aqui também torna a contagem correta por si mesma, sem
 * depender apenas da disciplina do caminho de escrita. Espera o pacote,
 * na query externa, aliasado como `ps`.
 */
export const CONTAGEM_SESSOES_USADAS_PACOTE = `(SELECT COUNT(*) FROM registros_atendimento ra WHERE ra.pacote_id = ps.id AND ra.presenca = 'compareceu')`;

/**
 * Predicado "pacote está ativo": não foi cancelado e ainda tem sessão
 * sobrando — a contagem de sessões usadas nunca fica guardada, é sempre
 * derivada de registros_atendimento (ver spec, seção "Modelo de dados").
 * Isso evita qualquer descompasso quando uma presença é corrigida depois de
 * já ter esgotado o pacote. Não inclui o filtro de paciente_id — cada site
 * de uso já tem o seu; espera o pacote aliasado como `ps`.
 */
export const PREDICADO_PACOTE_ATIVO = `ps.cancelado = false AND ${CONTAGEM_SESSOES_USADAS_PACOTE} < ps.quantidade_total`;

/**
 * Verifica pacote ativo e insere dentro da mesma transação (ver criarPacote)
 * — precisa rodar no client da transação, não em pool.query diretamente,
 * senão o lock advisory abaixo não protege nada.
 */
async function buscarPacoteAtivoPacienteComClient(client, pacienteId) {
  const { rows } = await client.query(
    `SELECT ps.id, ps.quantidade_total
     FROM pacotes_sessoes ps
     WHERE ps.paciente_id = $1
       AND ${PREDICADO_PACOTE_ATIVO}
     ORDER BY ps.created_at DESC
     LIMIT 1`,
    [pacienteId]
  );
  return rows[0] ?? null;
}

/**
 * "No máximo um pacote ativo por paciente" não dá pra expressar como
 * constraint de schema — "ativo" depende de uma contagem derivada
 * (registros_atendimento), não de uma coluna estática. Por isso o
 * check-then-insert roda numa transação com um advisory lock escopado no
 * pacienteId (pg_advisory_xact_lock): duas chamadas concorrentes de
 * criarPacote pro MESMO paciente serializam entre si — a segunda só
 * prossegue depois que a transação da primeira der COMMIT/ROLLBACK, e aí a
 * checagem de pacote ativo já enxerga o pacote recém-criado. Chamadas pra
 * pacientes diferentes não se bloqueiam (a chave do lock é o pacienteId).
 * pacienteId é sempre um inteiro simples aqui, então serve direto como
 * chave bigint do advisory lock, sem hash/cast.
 */
// Mínimo de 10 sessões por pacote — decisão de negócio da clínica (ver
// spec, "Contexto de negócio": pacotes vendidos são de 10 sessões, às vezes
// mais, nunca menos). Sem teto máximo.
const QUANTIDADE_MINIMA_PACOTE = 10;

export async function criarPacote({ pacienteId, quantidadeTotal, criadoPor }) {
  const quantidade = Number(quantidadeTotal);
  if (!Number.isInteger(quantidade) || quantidade < QUANTIDADE_MINIMA_PACOTE) {
    return { motivo: "quantidade_invalida" };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [pacienteId]);

    const ativo = await buscarPacoteAtivoPacienteComClient(client, pacienteId);
    if (ativo) {
      await client.query("ROLLBACK");
      return { motivo: "pacote_ativo_existente" };
    }

    const { rows } = await client.query(
      `INSERT INTO pacotes_sessoes (paciente_id, quantidade_total, criado_por)
       VALUES ($1, $2, $3)
       RETURNING id, paciente_id, quantidade_total, cancelado, criado_por, created_at`,
      [pacienteId, quantidade, criadoPor]
    );
    await client.query("COMMIT");
    return { pacote: rows[0] };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// pacienteId é exigido (além do pacoteId) pra evitar cancelar um pacote de
// outro paciente por engano — ex: POST /pacientes/7/pacotes/99/cancelar
// onde o pacote 99 na verdade pertence ao paciente 3. A rota já é restrita
// a administradora, então isso não é uma escalada de privilégio, mas sem
// esse filtro o cancelamento "funcionaria" silenciosamente no pacote errado
// e a ficha do paciente 7 recarregaria sem nenhuma mudança visível.
export async function cancelarPacote(pacoteId, pacienteId) {
  const { rows } = await pool.query(
    `UPDATE pacotes_sessoes SET cancelado = true
     WHERE id = $1 AND paciente_id = $2 AND cancelado = false
     RETURNING id, cancelado`,
    [pacoteId, pacienteId]
  );
  return rows[0] ?? null;
}

export async function listarPacotesPaciente(pacienteId) {
  const { rows } = await pool.query(
    `SELECT ps.id, ps.quantidade_total, ps.cancelado, ps.created_at,
       ${CONTAGEM_SESSOES_USADAS_PACOTE}::int AS quantidade_usada
     FROM pacotes_sessoes ps
     WHERE ps.paciente_id = $1
     ORDER BY ps.created_at DESC`,
    [pacienteId]
  );
  return rows;
}
