import { pool } from "../db/pool.js";
import { limiteSeguroListagem, offsetSeguroListagem } from "../utils/paginacao.js";
import { validarData, validarTipoAtendimento } from "../utils/validacao.js";
import { jaPassouSql, aindaNaoPassouSql, HOJE_SQL } from "../utils/sqlAgenda.js";
import { CLINICA } from "../config/clinica.js";
import { slotsOcupadosPelaConsulta, horariosVizinhos } from "../utils/gradeConsulta.js";

const SQL_INSERIR_AGENDAMENTO = `
  INSERT INTO agendamentos
     (paciente_id, data, hora, tipo_atendimento, status, google_event_id, primeira_consulta, queixa_principal, criado_por_usuario_id, psicologo_id, fisioterapeuta_id)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
   RETURNING *`;

function parametrosInsercao({
  pacienteId,
  data,
  hora,
  tipoAtendimento,
  status,
  googleEventId,
  primeiraConsulta,
  queixaPrincipal,
  criadoPorUsuarioId,
  psicologoId,
  fisioterapeutaId,
}) {
  return [
    pacienteId,
    data,
    hora,
    tipoAtendimento,
    status,
    googleEventId ?? null,
    primeiraConsulta ?? null,
    queixaPrincipal ?? null,
    criadoPorUsuarioId ?? null,
    psicologoId ?? null,
    fisioterapeutaId ?? null,
  ];
}

/**
 * validarDisponibilidadeAgendamento (calendarService.js) checa a capacidade
 * antes de gravar, mas é um SELECT solto — duas
 * conversas do bot (ou bot + dashboard) mirando o mesmo horário quase ao
 * mesmo tempo podem passar por essa checagem juntas, ambas verem vaga, e as
 * duas inserirem, estourando CLINICA.capacidadeMaximaPorHorario. Esse é o
 * ponto onde a escrita de fato acontece, então é aqui que a checagem
 * precisa ser atômica: trava um advisory lock por (data, hora,
 * tipoAtendimento) — serializa só quem mira o MESMO horário, não afeta
 * outros — reconta a ocupação já dentro da trava, e só então insere.
 */
async function inserirAgendamentoComTravaDeCapacidade(dados, capacidadeMaxima) {
  const { data, hora, tipoAtendimento } = dados;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // pg_advisory_xact_lock libera sozinho no COMMIT/ROLLBACK — nada de
    // unlock manual, e outra transação esperando a mesma chave só segue
    // depois que esta aqui terminar (e enxerga o INSERT já commitado).
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `${data}|${hora}|${tipoAtendimento}`,
    ]);

    const vizinhos = horariosVizinhos(hora, slotsOcupadosPelaConsulta(tipoAtendimento));
    const { rows: ocupacao } = await client.query(
      `SELECT hora, COUNT(*)::int AS total FROM (
         SELECT hora FROM agendamentos
            WHERE status = 'confirmado' AND data = $1 AND hora = ANY($2::time[]) AND tipo_atendimento = $3
         UNION ALL
         SELECT hora FROM agendamentos_importados
            WHERE status <> 'cancelado' AND data = $1 AND hora = ANY($2::time[]) AND tipo_atendimento = $3
       ) t
       GROUP BY hora`,
      [data, vizinhos, tipoAtendimento]
    );
    const ocupacaoAtual = ocupacao.reduce((max, row) => Math.max(max, row.total), 0);
    if (ocupacaoAtual >= capacidadeMaxima) {
      const erro = new Error("HORARIO_LOTADO");
      erro.codigo = "HORARIO_LOTADO";
      throw erro;
    }

    const { rows } = await client.query(SQL_INSERIR_AGENDAMENTO, parametrosInsercao(dados));
    await client.query("COMMIT");
    return rows[0];
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function inserirAgendamento(dados) {
  const capacidadeMaxima = CLINICA.capacidadeMaximaPorHorario?.[dados.tipoAtendimento];
  if (!Number.isFinite(capacidadeMaxima)) {
    const { rows } = await pool.query(SQL_INSERIR_AGENDAMENTO, parametrosInsercao(dados));
    return rows[0];
  }
  return inserirAgendamentoComTravaDeCapacidade(dados, capacidadeMaxima);
}

/**
 * Próximo agendamento confirmado e futuro do paciente — usado por
 * cancelar_agendamento para identificar QUAL agendamento cancelar sem
 * depender de um ID que o modelo poderia errar ou confundir com o de
 * outro paciente.
 */
export async function buscarProximoAgendamentoConfirmado(pacienteId) {
  const { rows } = await pool.query(
    `SELECT * FROM agendamentos
     WHERE paciente_id = $1
       AND status = 'confirmado'
       AND ${aindaNaoPassouSql()}
     ORDER BY data ASC, hora ASC
     LIMIT 1`,
    [pacienteId]
  );
  return rows[0] ?? null;
}

export async function cancelarAgendamento(id) {
  const { rows } = await pool.query(
    `UPDATE agendamentos SET status = 'cancelado' WHERE id = $1 RETURNING *`,
    [id]
  );
  return rows[0] ?? null;
}

/**
 * Todos os agendamentos confirmados e futuros do paciente — usado por
 * listar_agendamentos para ele escolher qual cancelar/remarcar quando não
 * é o próximo (ver buscarProximoAgendamentoConfirmado, usado no caso comum).
 */
export async function buscarAgendamentosConfirmadosFuturos(pacienteId) {
  const { rows } = await pool.query(
    `SELECT * FROM agendamentos
     WHERE paciente_id = $1
       AND status = 'confirmado'
       AND ${aindaNaoPassouSql()}
     ORDER BY data ASC, hora ASC`,
    [pacienteId]
  );
  return rows;
}

/**
 * Busca um agendamento confirmado por ID, mas só se pertencer ao
 * pacienteId informado. O ID normalmente vem de uma listagem anterior
 * (listar_agendamentos) que o modelo repete de volta — nunca confiamos nele
 * sem essa checagem de posse, senão o modelo poderia (por erro ou confusão
 * de conversa) cancelar/remarcar o agendamento de outro paciente.
 */
export async function buscarAgendamentoConfirmadoPorId(id, pacienteId) {
  const { rows } = await pool.query(
    `SELECT a.*, p.nome AS paciente_nome, p.convenio AS paciente_convenio, p.telefone AS paciente_telefone FROM agendamentos a
     JOIN pacientes p ON p.id = a.paciente_id
     WHERE a.id = $1 AND a.paciente_id = $2 AND a.status = 'confirmado'`,
    [id, pacienteId]
  );
  return rows[0] ?? null;
}

/**
 * Agendamento confirmado (feito pelo bot) que esse paciente já tenha
 * numa data — usado por criar_agendamento pra avisar/confirmar antes de
 * marcar uma segunda consulta no mesmo dia (ver criarAgendamento.js), em
 * vez de simplesmente duplicar sem avisar ninguém.
 */
export async function buscarAgendamentoConfirmadoDoPacienteNaData(pacienteId, data) {
  const { rows } = await pool.query(
    `SELECT id, data, hora, tipo_atendimento
     FROM agendamentos
     WHERE paciente_id = $1 AND data = $2::date AND status = 'confirmado'
     LIMIT 1`,
    [pacienteId, data]
  );
  return rows[0] ?? null;
}

/**
 * Atualiza data/hora/evento de um agendamento existente (remarcação).
 */
export async function remarcarAgendamento({ id, data, hora, googleEventId }) {
  const { rows } = await pool.query(
    `UPDATE agendamentos SET data = $2, hora = $3, google_event_id = $4 WHERE id = $1 RETURNING *`,
    [id, data, hora, googleEventId]
  );
  return rows[0] ?? null;
}

const STATUS_VALIDOS = ["confirmado", "cancelado", "concluido", "compareceu", "faltou"];

/**
 * Listagem para a rota GET /admin/agendamentos — não exposta ao paciente,
 * usada só pela equipe da clínica para inspecionar a agenda.
 */
export async function listarAgendamentos({ status, limite, offset } = {}) {
  const limiteSeguro = limiteSeguroListagem(limite);
  const offsetSeguro = offsetSeguroListagem(offset);
  const statusValido = STATUS_VALIDOS.includes(status) ? status : null;

  const params = [limiteSeguro, offsetSeguro];
  let filtroStatus = "";
  if (statusValido) {
    params.push(statusValido);
    filtroStatus = `WHERE a.status = $3`;
  }

  const { rows } = await pool.query(
    `SELECT a.*, p.nome AS paciente_nome, p.telefone AS paciente_telefone
     FROM agendamentos a
     JOIN pacientes p ON p.id = a.paciente_id
     ${filtroStatus}
     ORDER BY a.data DESC, a.hora DESC
     LIMIT $1 OFFSET $2`,
    params
  );
  return rows;
}

/**
 * Candidatos a lembrete de consulta (recurso desligado por padrão — ver
 * LEMBRETE_CONSULTA_ATIVADO). Traz quem ainda não recebeu o lembrete da
 * véspera — o filtro fino de "consulta é amanhã e já passou da hora
 * configurada" é feito em JS (src/services/lembreteService.js), com dayjs no
 * fuso da clínica — aqui só pré-filtra pelo que é barato de checar no banco.
 */
export async function buscarAgendamentosConfirmadosSemLembreteVespera() {
  const { rows } = await pool.query(
    `SELECT a.*, p.nome AS paciente_nome, p.telefone AS paciente_telefone
     FROM agendamentos a
     JOIN pacientes p ON p.id = a.paciente_id
     WHERE a.status = 'confirmado'
       AND a.lembrete_24h_enviado_em IS NULL
       AND a.data >= ${HOJE_SQL}`
  );
  return rows;
}

export async function marcarLembreteVesperaEnviado(id) {
  await pool.query(
    `UPDATE agendamentos
     SET lembrete_24h_enviado_em = now()
     WHERE id = $1`,
    [id]
  );
}

/**
 * Candidatos a lembrete "de tarde" (recurso desligado por padrão — ver
 * LEMBRETE_TARDE_ATIVADO): consultas de HOJE, à tarde (hora >= 12:00), que
 * ainda não receberam esse lembrete — diferente do lembrete de véspera
 * (lembrete_24h_enviado_em), que nunca dispara pra consulta do mesmo dia. O
 * filtro fino de "já passou da hora configurada de disparo" é feito em JS
 * (lembreteService.js), mesmo padrão de buscarAgendamentosConfirmadosSemLembreteVespera.
 */
export async function buscarAgendamentosConfirmadosTardeSemLembrete() {
  const { rows } = await pool.query(
    `SELECT a.*, p.nome AS paciente_nome, p.telefone AS paciente_telefone
     FROM agendamentos a
     JOIN pacientes p ON p.id = a.paciente_id
     WHERE a.status = 'confirmado'
       AND a.lembrete_tarde_enviado_em IS NULL
       AND a.data = ${HOJE_SQL}
       AND a.hora >= '12:00:00'`
  );
  return rows;
}

export async function marcarLembreteTardeEnviado(id) {
  await pool.query(
    `UPDATE agendamentos
     SET lembrete_tarde_enviado_em = now()
     WHERE id = $1`,
    [id]
  );
}

export async function buscarAgendamentoComPacientePorId(id) {
  const { rows } = await pool.query(
    `SELECT a.*, p.nome AS paciente_nome, p.telefone AS paciente_telefone, p.convenio AS paciente_convenio,
       ${jaPassouSql("a")} AS ja_passou
     FROM agendamentos a
     JOIN pacientes p ON p.id = a.paciente_id
     WHERE a.id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

/**
 * Cancela só se o agendamento ainda estiver confirmado — protege contra
 * cancelar duas vezes (duas abas do dashboard) ou cancelar algo já
 * concluído/remarcado por outra pessoa entretanto. 0 linhas afetadas
 * sinaliza corrida pro controller responder 409 (mesmo padrão de
 * registrarPresencaBot).
 */
export async function cancelarAgendamentoConfirmado(id) {
  const { rows } = await pool.query(
    `UPDATE agendamentos SET status = 'cancelado' WHERE id = $1 AND status = 'confirmado' RETURNING *`,
    [id]
  );
  return rows[0] ?? null;
}

/**
 * Mesmo contrato de cancelarAgendamentoConfirmado, para
 * agendamentos_importados: só cancela se ainda confirmado, 0 linhas
 * afetadas sinaliza corrida pro controller responder 409.
 */
export async function cancelarAgendamentoImportado(id) {
  const { rows } = await pool.query(
    `UPDATE agendamentos_importados SET status = 'cancelado' WHERE id = $1 AND status = 'confirmado' RETURNING *`,
    [id]
  );
  return rows[0] ?? null;
}

/**
 * Exclui um agendamento de verdade (DELETE) quando não há nenhum
 * histórico ligado a ele (presença/pagamento — ver registros_atendimento e
 * pagamentos, ambas com FK sem CASCADE pra agendamentos/agendamentos_importados),
 * ou cancela (status = 'cancelado') quando há — mesmo espírito de
 * excluirOuArquivarPaciente (pacienteModel.js): nunca apaga dado com valor
 * financeiro/clínico junto, só tira da agenda ativa. Usado pra limpar
 * entrada claramente errada (ex: hora inválida vinda de uma detecção
 * automática ruim) sem deixar rastro de lixo na agenda, mas sem arriscar
 * apagar histórico de verdade.
 *
 * Retorna "excluido" | "cancelado" | null (agendamento não existe/já sumiu).
 */
export async function excluirOuCancelarAgendamento(origem, id) {
  const tabela = origem === "importado" ? "agendamentos_importados" : "agendamentos";
  try {
    const { rowCount } = await pool.query(`DELETE FROM ${tabela} WHERE id = $1`, [id]);
    return rowCount > 0 ? "excluido" : null;
  } catch (err) {
    if (err.code !== "23503") throw err;

    const { rowCount } = await pool.query(`UPDATE ${tabela} SET status = 'cancelado' WHERE id = $1`, [id]);
    return rowCount > 0 ? "cancelado" : null;
  }
}

/**
 * Atualiza data/hora de um agendamento importado (remarcação). Diferente
 * de remarcarAgendamento (bot), não tem google_event_id pra gravar — esses
 * registros nunca tiveram evento no Calendar — e protege contra remarcar
 * um já cancelado (o bot não tem essa proteção nesta query porque o
 * controller já garante status === "confirmado" antes de chamar; aqui
 * mantemos a proteção também no banco por segurança extra, já que esta é
 * uma função nova).
 */
export async function remarcarAgendamentoImportado({ id, data, hora }) {
  const { rows } = await pool.query(
    `UPDATE agendamentos_importados SET data = $2, hora = $3 WHERE id = $1 AND status = 'confirmado' RETURNING *`,
    [id, data, hora]
  );
  return rows[0] ?? null;
}

/**
 * Edição completa de um agendamento (bot ou manual — mesma tabela): troca
 * paciente, data, hora, tipo, grava quem editou. Diferente de
 * remarcarAgendamento (só data/hora), usado pela ação "Editar" — ver
 * editarConsulta em remarcacaoService.js, que decide se precisa validar
 * disponibilidade antes de chamar esta função.
 */
export async function editarAgendamento({
  id,
  pacienteId,
  data,
  hora,
  tipoAtendimento,
  googleEventId,
  atualizadoPorUsuarioId,
  psicologoId,
  fisioterapeutaId,
}) {
  const { rows } = await pool.query(
    `UPDATE agendamentos
     SET paciente_id = $2, data = $3, hora = $4, tipo_atendimento = $5,
         google_event_id = $6, atualizado_por_usuario_id = $7, psicologo_id = $8, fisioterapeuta_id = $9
     WHERE id = $1
     RETURNING *`,
    [
      id,
      pacienteId,
      data,
      hora,
      tipoAtendimento,
      googleEventId,
      atualizadoPorUsuarioId,
      psicologoId ?? null,
      fisioterapeutaId ?? null,
    ]
  );
  return rows[0] ?? null;
}

/**
 * Edição completa de um agendamento importado: sem paciente_id (a tabela
 * nunca teve vínculo com pacientes) — "trocar o paciente" aqui edita
 * nome/telefone direto na própria linha. Mesma proteção de
 * remarcarAgendamentoImportado: só edita se ainda confirmado, 0 linhas
 * afetadas sinaliza corrida pro controller responder 409.
 */
export async function editarAgendamentoImportado({
  id,
  nome,
  telefone,
  tipoAtendimento,
  data,
  hora,
  atualizadoPorUsuarioId,
  psicologoId,
  fisioterapeutaId,
}) {
  const { rows } = await pool.query(
    `UPDATE agendamentos_importados
     SET nome = $2, telefone = $3, tipo_atendimento = $4, data = $5, hora = $6,
         atualizado_por_usuario_id = $7, psicologo_id = $8, fisioterapeuta_id = $9
     WHERE id = $1 AND status = 'confirmado'
     RETURNING *`,
    [
      id,
      nome,
      telefone,
      tipoAtendimento,
      data,
      hora,
      atualizadoPorUsuarioId,
      psicologoId ?? null,
      fisioterapeutaId ?? null,
    ]
  );
  return rows[0] ?? null;
}

/**
 * Busca um agendamento importado por id, no mesmo formato de campo que
 * buscarAgendamentoComPacientePorId usa pro bot (paciente_nome,
 * paciente_telefone, ja_passou) — permite ao controller/view tratar as
 * duas origens sem checar o nome do campo.
 */
export async function buscarAgendamentoImportadoPorId(id) {
  const { rows } = await pool.query(
    `SELECT ai.*, ${jaPassouSql("ai")} AS ja_passou
     FROM agendamentos_importados ai
     WHERE ai.id = $1`,
    [id]
  );
  const linha = rows[0];
  return linha ? { ...linha, paciente_nome: linha.nome, paciente_telefone: linha.telefone } : null;
}

async function buscarAgendaBot({
  dataValida,
  statusValido,
  tipoValido,
  buscaValida,
  buscaDigitos,
  periodoValido,
  psicologoIdValido,
  origemCriacaoValida,
  avaliacaoValida,
  janela,
}) {
  const { rows } = await pool.query(
    `SELECT
       a.id, a.paciente_id, 'bot' AS origem, a.criado_por_usuario_id, p.nome AS paciente_nome, p.telefone AS paciente_telefone,
       p.convenio AS paciente_convenio,
       a.tipo_atendimento, a.data, a.hora, a.status, a.google_event_id, a.primeira_consulta,
       a.psicologo_id, ps.nome AS psicologo_nome,
       a.fisioterapeuta_id, ft.nome AS fisioterapeuta_nome,
       ${jaPassouSql("a")} AS ja_passou,
       ra.presenca, ra.observacao_sessao, ra.profissional_responsavel, ra.registrado_por, ra.registrado_em, u.nome AS registrado_por_nome
     FROM agendamentos a
     JOIN pacientes p ON p.id = a.paciente_id
     LEFT JOIN registros_atendimento ra ON ra.agendamento_id = a.id
     LEFT JOIN usuarios u ON u.id = ra.registrado_por
     LEFT JOIN psicologos ps ON ps.id = a.psicologo_id
     LEFT JOIN fisioterapeutas ft ON ft.id = a.fisioterapeuta_id
     WHERE ($2::date IS NULL OR a.data = $2::date)
       AND ($2::date IS NOT NULL OR a.data >= ${HOJE_SQL})
       AND (($3::text IS NULL AND a.status <> 'cancelado') OR ($3::text IS NOT NULL AND a.status = $3))
       AND ($4::text IS NULL OR a.tipo_atendimento = $4)
       AND ($5::text IS NULL OR p.nome ILIKE '%' || $5 || '%'
            OR ($6::text IS NOT NULL AND regexp_replace(p.telefone, '\\D', '', 'g') LIKE '%' || $6 || '%'))
       AND ($7::text IS NULL OR ($7 = 'manha' AND a.hora < '12:00:00') OR ($7 = 'tarde' AND a.hora >= '12:00:00'))
       AND ($8::int IS NULL OR a.psicologo_id = $8)
       AND ($9::text IS NULL
            OR ($9 = 'bot' AND a.criado_por_usuario_id IS NULL)
            OR ($9 = 'manual' AND a.criado_por_usuario_id IS NOT NULL))
       AND ($10::boolean IS NULL OR a.primeira_consulta = $10)
     ORDER BY a.data ASC, a.hora ASC
     LIMIT $1`,
    [
      janela,
      dataValida,
      statusValido,
      tipoValido,
      buscaValida,
      buscaDigitos,
      periodoValido,
      psicologoIdValido,
      origemCriacaoValida,
      avaliacaoValida,
    ]
  );
  return rows;
}

// agendamentos_importados não tem paciente_id (nunca teve cadastro de
// paciente vinculado, só nome/telefone soltos do sistema de agenda anterior) — o JOIN
// por telefone abaixo resolve isso quando o paciente já tem cadastro
// (criado pelo bot ou manualmente), pra habilitar o botão "🖨️ Ficha" nas
// telas de agenda também pra agendamentos importados. Sem match, paciente_id
// vem NULL e o botão simplesmente não aparece (comportamento de sempre).
// paciente_convenio usa COALESCE(ai.convenio, p.convenio) — achado real
// (2026-09-17): a coluna vinha sempre NULL::text aqui, então a Agenda (tela
// e impressão) nunca mostrava convênio nenhum pra agendamento importado,
// mesmo quando ai.convenio (texto gravado no import, ver
// importacaoLegadoService.js) ou o convênio do paciente já vinculado
// tinham o dado certinho.
async function buscarAgendaImportada({
  dataValida,
  statusValido,
  tipoValido,
  buscaValida,
  buscaDigitos,
  periodoValido,
  psicologoIdValido,
  avaliacaoValida,
  janela,
}) {
  const { rows } = await pool.query(
    `SELECT
       ai.id, 'importado' AS origem, ai.nome AS paciente_nome, ai.telefone AS paciente_telefone,
       COALESCE(ai.convenio, p.convenio) AS paciente_convenio,
       p.id AS paciente_id,
       ai.tipo_atendimento, ai.data, ai.hora, ai.status, NULL::text AS google_event_id, ai.primeira_consulta,
       ai.psicologo_id, ps.nome AS psicologo_nome, ai.atendente,
       ai.fisioterapeuta_id, ft.nome AS fisioterapeuta_nome,
       ${jaPassouSql("ai")} AS ja_passou,
       ra.presenca, ra.observacao_sessao, ra.profissional_responsavel, ra.registrado_por, ra.registrado_em, u.nome AS registrado_por_nome
     FROM agendamentos_importados ai
     LEFT JOIN registros_atendimento ra ON ra.agendamento_importado_id = ai.id
     LEFT JOIN usuarios u ON u.id = ra.registrado_por
     LEFT JOIN psicologos ps ON ps.id = ai.psicologo_id
     LEFT JOIN fisioterapeutas ft ON ft.id = ai.fisioterapeuta_id
     LEFT JOIN pacientes p ON
       regexp_replace(p.telefone, '\\D', '', 'g') = regexp_replace(ai.telefone, '\\D', '', 'g')
       OR regexp_replace(p.telefone, '\\D', '', 'g') = '55' || regexp_replace(ai.telefone, '\\D', '', 'g')
       OR '55' || regexp_replace(p.telefone, '\\D', '', 'g') = regexp_replace(ai.telefone, '\\D', '', 'g')
     WHERE ($2::date IS NULL OR ai.data = $2::date)
       AND ($2::date IS NOT NULL OR ai.data >= ${HOJE_SQL})
       AND (($3::text IS NULL AND ai.status <> 'cancelado') OR ($3::text IS NOT NULL AND ai.status = $3))
       AND ($4::text IS NULL OR ai.tipo_atendimento = $4)
       AND ($5::text IS NULL OR ai.nome ILIKE '%' || $5 || '%'
            OR ($6::text IS NOT NULL AND regexp_replace(ai.telefone, '\\D', '', 'g') LIKE '%' || $6 || '%'))
       AND ($7::text IS NULL OR ($7 = 'manha' AND ai.hora < '12:00:00') OR ($7 = 'tarde' AND ai.hora >= '12:00:00'))
       AND ($8::int IS NULL OR ai.psicologo_id = $8)
       AND ($9::boolean IS NULL OR ai.primeira_consulta = $9)
     ORDER BY ai.data ASC, ai.hora ASC
     LIMIT $1`,
    [janela, dataValida, statusValido, tipoValido, buscaValida, buscaDigitos, periodoValido, psicologoIdValido, avaliacaoValida]
  );
  return rows;
}

/**
 * Listagem unificada pra tela /agendamentos: junta bot + importados,
 * filtra e pagina em memória — mesma técnica de listarPresenca (busca até
 * offset+limite linhas de CADA origem, combina, ordena e só então corta a
 * página final; um LIMIT fixo por origem deixaria linhas antigas
 * inalcançáveis assim que uma origem crescesse além do fixo).
 *
 * status agora existe nas duas origens (migration 020) — sempre consulta
 * bot e importados, independente do filtro de status estar definido.
 *
 * busca casa nome (ILIKE) OU telefone (dígitos). Importante: quando a busca
 * não tem nenhum dígito, o parâmetro de telefone vai como null — comparar
 * contra uma string vazia faria `LIKE '%%'` casar QUALQUER telefone.
 *
 * origem filtra por quem criou o agendamento: 'bot' (feito pelo próprio bot
 * de WhatsApp), 'manual' (criado pela recepção no dashboard — mesma tabela
 * `agendamentos`, diferenciado por criado_por_usuario_id) ou 'importado'
 * (migrado do sistema de agenda anterior, tabela `agendamentos_importados`). Com
 * 'bot'/'manual' nem chega a consultar agendamentos_importados, e com
 * 'importado' nem chega a consultar agendamentos — evita rodar uma query
 * cujo resultado a gente já sabe que vai descartar inteiro.
 *
 * avaliacao ('avaliacao'/'retorno') filtra por primeira_consulta, derivada
 * do prefixo do campo `Tipo` do sistema de agenda anterior (AVAL/RETORNO — ver
 * `derivarPrimeiraConsulta` em importacaoLegadoService.js) para os
 * agendamentos importados, migration 037. Registros importados antes dessa
 * migration ou sem `Tipo` reconhecível ficam com a coluna NULL e não
 * aparecem em nenhum dos dois lados do filtro.
 */
const ORIGENS_VALIDAS = new Set(["bot", "manual", "importado"]);
const AVALIACAO_PARA_BOOLEAN = { avaliacao: true, retorno: false };

export async function listarAgendaUnificada({
  data,
  status,
  tipoAtendimento,
  busca,
  periodo,
  psicologoId,
  origem,
  avaliacao,
  limite,
  offset,
} = {}) {
  const limiteSeguro = limiteSeguroListagem(limite);
  const offsetSeguro = offsetSeguroListagem(offset);
  const janela = offsetSeguro + limiteSeguro;

  const dataValida = validarData(data) ? data : null;
  const statusValido = STATUS_VALIDOS.includes(status) ? status : null;
  const tipoValido = validarTipoAtendimento(tipoAtendimento) ? tipoAtendimento : null;
  const buscaValida = typeof busca === "string" && busca.trim() ? busca.trim() : null;
  const buscaDigitos = buscaValida ? buscaValida.replace(/\D/g, "") || null : null;
  const periodoValido = periodo === "manha" || periodo === "tarde" ? periodo : null;
  const psicologoIdValido = Number.isInteger(Number(psicologoId)) && Number(psicologoId) > 0 ? Number(psicologoId) : null;
  const origemValida = ORIGENS_VALIDAS.has(origem) ? origem : null;
  const origemCriacaoValida = origemValida === "bot" || origemValida === "manual" ? origemValida : null;
  const avaliacaoValida = AVALIACAO_PARA_BOOLEAN[avaliacao] ?? null;

  const [itensBot, itensImportados] = await Promise.all([
    origemValida === "importado"
      ? []
      : buscarAgendaBot({
          dataValida,
          statusValido,
          tipoValido,
          buscaValida,
          buscaDigitos,
          periodoValido,
          psicologoIdValido,
          origemCriacaoValida,
          avaliacaoValida,
          janela,
        }),
    origemValida === "bot" || origemValida === "manual"
      ? []
      : buscarAgendaImportada({
          dataValida,
          statusValido,
          tipoValido,
          buscaValida,
          buscaDigitos,
          periodoValido,
          psicologoIdValido,
          avaliacaoValida,
          janela,
        }),
  ]);

  const combinados = [...itensBot, ...itensImportados].sort((x, y) =>
    `${x.data}T${x.hora}`.localeCompare(`${y.data}T${y.hora}`)
  );

  return combinados.slice(offsetSeguro, offsetSeguro + limiteSeguro);
}
