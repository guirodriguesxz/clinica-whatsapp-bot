import { pool } from "../db/pool.js";
import { limiteSeguroListagem, offsetSeguroListagem } from "../utils/paginacao.js";
import { HOJE_SQL } from "../utils/sqlAgenda.js";

export async function buscarPacientePorTelefone(telefone) {
  const { rows } = await pool.query("SELECT * FROM pacientes WHERE telefone = $1", [telefone]);
  return rows[0] ?? null;
}

export async function buscarPacientePorId(id) {
  const { rows } = await pool.query("SELECT * FROM pacientes WHERE id = $1", [id]);
  return rows[0] ?? null;
}

// Usado pela ficha do paciente — até os 50 agendamentos mais recentes, não
// o histórico completo (impressão em papel não é lugar pra rolagem infinita).
export async function listarHistoricoPaciente(pacienteId) {
  const { rows } = await pool.query(
    `SELECT data, hora, tipo_atendimento, status
     FROM agendamentos
     WHERE paciente_id = $1
     ORDER BY data DESC, hora DESC
     LIMIT $2`,
    [pacienteId, 50]
  );
  return rows;
}

// Usado pelo cartão impresso de controle de sessões (só Fisioterapia; a
// Psicologia não tem controle de pacote nem sessão numerada). Não existe
// ainda o conceito de "pacote ativo" no schema (ver módulo 9 do roadmap),
// então usamos as 10 sessões MAIS RECENTES como aproximação — pegar as mais
// antigas (ORDER BY data ASC) faria um paciente com mais de 10 sessões na
// vida ver sempre o mesmo cartão preenchido, nunca as sessões atuais.
// Busca em ordem decrescente e inverte em memória pra devolver em ordem
// cronológica (mais antiga primeiro), como o cartão espera preencher.
export async function listarSessoesFisioterapiaPaciente(pacienteId) {
  const { rows } = await pool.query(
    `SELECT data, hora, status
     FROM agendamentos
     WHERE paciente_id = $1 AND tipo_atendimento = 'fisioterapia'
     ORDER BY data DESC, hora DESC
     LIMIT $2`,
    [pacienteId, 10]
  );
  return rows.reverse();
}

/**
 * Busca o paciente comparando só os dígitos do telefone, aceitando com ou
 * sem o DDI "55" dos dois lados. Usado quando o telefone de origem não tem
 * garantia de já estar no formato normalizado (dígitos + DDI) que o bot usa
 * ao gravar pacientes.telefone — ex: telefone importado do sistema de agenda anterior
 * (sistema anterior), que pode ter pontuação e/ou não ter o DDI (mesmo
 * problema, e mesma solução, de buscarProximoAgendamentoImportado em
 * agendamentoImportadoModel.js).
 */
export async function buscarPacientePorTelefoneNormalizado(telefoneBruto) {
  const digitos = String(telefoneBruto ?? "").replace(/\D/g, "");
  let candidatos;

  if (digitos.length === 10 || digitos.length === 11) {
    candidatos = [`55${digitos}`, digitos];
  } else if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) {
    candidatos = [digitos, digitos.slice(2)];
  } else {
    return { motivo: "telefone_invalido" };
  }

  const parametros = candidatos.map((_, indice) => `$${indice + 1}`).join(", ");
  const { rows } = await pool.query(
    `SELECT * FROM pacientes
     WHERE regexp_replace(telefone, '\\D', '', 'g') IN (${parametros})`,
    candidatos
  );

  if (rows.length === 0) return { motivo: "nao_encontrado" };

  const pacientesEncontrados = new Set(rows.map((paciente) => paciente.id));
  if (pacientesEncontrados.size !== 1) return { motivo: "telefone_ambiguo" };

  return { paciente: rows[0] };
}

/**
 * Busca o paciente pelo telefone; se não existir, cria um registro mínimo.
 * Usado tanto no início de cada conversa (para linkar o histórico) quanto
 * na hora de criar um agendamento.
 */
/**
 * convenioId (opcional, só usado pelo dashboard — ver
 * docs/superpowers/specs/2026-09-04-paciente-convenio-lista-design.md)
 * sincroniza o texto `convenio` com o nome cadastrado em `convenios`, pra
 * todo o resto do sistema (PDF de guia, relatório financeiro, ficha)
 * continuar lendo o texto sem precisar mudar. Quando convenioId não
 * é informado (fluxo do bot, inalterado), grava só o texto livre recebido.
 */
export async function encontrarOuCriarPaciente({ nome, telefone, convenio, convenioId }) {
  const existente = await buscarPacientePorTelefone(telefone);
  if (existente) return existente;

  // ON CONFLICT (upsert) em vez de INSERT puro: o webhook processa a
  // mensagem de imagem (fora do comLock por telefone) e a de texto (dentro
  // do comLock) em branches separadas — se o paciente mandar as duas quase
  // juntas, as duas podem passar pelo SELECT acima antes de qualquer INSERT
  // commitar, e a segunda violaria a constraint UNIQUE(telefone) num INSERT
  // puro. O DO UPDATE (no-op, só regrava telefone) garante RETURNING * com
  // a linha vencedora em vez de estourar exceção na perdedora da corrida.
  const { rows } = await pool.query(
    `INSERT INTO pacientes (nome, telefone, convenio, convenio_id)
     VALUES (
       $1, $2,
       COALESCE((SELECT nome FROM convenios WHERE id = $4), $3),
       $4
     )
     ON CONFLICT (telefone) DO UPDATE SET telefone = EXCLUDED.telefone
     RETURNING *`,
    [nome || "Paciente", telefone, convenio ?? null, convenioId ?? null]
  );
  return rows[0];
}

export async function atualizarEtapaPaciente(pacienteId, etapa) {
  await pool.query("UPDATE pacientes SET etapa_atual = $1 WHERE id = $2", [etapa, pacienteId]);
}

// "pausado_atendimento_humano" é o valor usado pelo webhookController quando
// alguém da equipe responde manualmente pelo número conectado (ver
// chatService.js, PAUSADO_ATENDIMENTO_HUMANO) — não importamos a constante
// de lá pra evitar import circular (chatService já importa esse model).
// Só reseta se o paciente estiver realmente pausado por esse motivo — não
// mexe em outras etapas (ex: "agendado", "encaminhado_humano").
export async function retomarAtendimentoAutomatico(pacienteId) {
  const { rows } = await pool.query(
    `UPDATE pacientes
     SET etapa_atual = NULL
     WHERE id = $1 AND etapa_atual = 'pausado_atendimento_humano'
     RETURNING *`,
    [pacienteId]
  );
  return rows[0] ?? null;
}

/**
 * Atualiza os dados cadastrais do paciente. Só sobrescreve os campos
 * informados (COALESCE) — undefined/null preserva o valor já gravado,
 * nunca apaga. Chamada tanto pelo bot (criarAgendamento.js, só
 * nome/convenio) quanto pela tela de edição do dashboard (todos os
 * campos, ver dashboardController.js).
 */
/**
 * convenioId (opcional, ver encontrarOuCriarPaciente acima) tem prioridade
 * sobre `convenio` (texto) quando os dois vierem informados — sincroniza
 * `convenio_id` e o texto `convenio` com o nome cadastrado em `convenios`.
 * Sem convenioId, mantém o comportamento anterior (só o texto livre, usado
 * pelo bot em criarAgendamento.js).
 */
export async function atualizarDadosPaciente(pacienteId, {
  nome,
  convenio,
  convenioId,
  cpf,
  dataNascimento,
  rg,
  endereco,
  numero,
  bairro,
  cidade,
  uf,
  cep,
  estadoCivil,
  sexo,
  profissao,
  email,
  matriculaConvenio,
  cns,
  observacao,
}) {
  await pool.query(
    `UPDATE pacientes SET
       nome = COALESCE($2, nome),
       convenio = COALESCE((SELECT nome FROM convenios WHERE id = $18), $3, convenio),
       convenio_id = COALESCE($18, convenio_id),
       cpf = COALESCE($4, cpf),
       data_nascimento = COALESCE($5, data_nascimento),
       rg = COALESCE($6, rg),
       endereco = COALESCE($7, endereco),
       numero = COALESCE($8, numero),
       bairro = COALESCE($9, bairro),
       cidade = COALESCE($10, cidade),
       uf = COALESCE($11, uf),
       cep = COALESCE($12, cep),
       estado_civil = COALESCE($13, estado_civil),
       sexo = COALESCE($14, sexo),
       profissao = COALESCE($15, profissao),
       email = COALESCE($16, email),
       matricula_convenio = COALESCE($17, matricula_convenio),
       cns = COALESCE($19, cns),
       observacao = COALESCE($20, observacao)
     WHERE id = $1`,
    [
      pacienteId,
      nome ?? null,
      convenio ?? null,
      cpf ?? null,
      dataNascimento ?? null,
      rg ?? null,
      endereco ?? null,
      numero ?? null,
      bairro ?? null,
      cidade ?? null,
      uf ?? null,
      cep ?? null,
      estadoCivil ?? null,
      sexo ?? null,
      profissao ?? null,
      email ?? null,
      matriculaConvenio ?? null,
      convenioId ?? null,
      cns ?? null,
      observacao ?? null,
    ]
  );
}

/**
 * Listagem para a rota GET /admin/pacientes — não exposta ao paciente,
 * usada só pela equipe da clínica.
 */
/**
 * busca casa nome (ILIKE) OU telefone (só dígitos) — mesmo cuidado de
 * buscarPacientesPorNomeOuTelefone: quando o termo não tem nenhum dígito, o
 * parâmetro de telefone vai como null (comparar contra string vazia
 * casaria QUALQUER telefone via LIKE '%%').
 */
const AVALIACAO_PARA_BOOLEAN = { avaliacao: true, retorno: false };

/**
 * avaliacao ('avaliacao'/'retorno') filtra pacientes que tenham um
 * agendamento confirmado e futuro marcado como primeira consulta/retorno —
 * coluna que só existe em `agendamentos` (feitos pelo bot ou manualmente),
 * agendamentos importados do sistema antigo não têm esse dado e nunca
 * entram nesse filtro.
 */
export async function listarPacientes({ limite, offset, busca, avaliacao } = {}) {
  const limiteSeguro = limiteSeguroListagem(limite);
  const offsetSeguro = offsetSeguroListagem(offset);
  const termoLimpo = typeof busca === "string" ? busca.trim() : "";
  const buscaValida = termoLimpo ? `%${termoLimpo}%` : null;
  const digitos = termoLimpo ? termoLimpo.replace(/\D/g, "") || null : null;
  const avaliacaoValida = AVALIACAO_PARA_BOOLEAN[avaliacao] ?? null;

  const { rows } = await pool.query(
    `SELECT * FROM pacientes
     WHERE ativo
       AND ($3::text IS NULL OR nome ILIKE $3
            OR ($4::text IS NOT NULL AND regexp_replace(telefone, '\\D', '', 'g') LIKE '%' || $4 || '%'))
       AND ($5::boolean IS NULL OR EXISTS (
             SELECT 1 FROM agendamentos a
             WHERE a.paciente_id = pacientes.id
               AND a.status = 'confirmado'
               AND a.data >= ${HOJE_SQL}
               AND a.primeira_consulta = $5
           ))
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [limiteSeguro, offsetSeguro, buscaValida, digitos, avaliacaoValida]
  );
  return rows;
}

/**
 * Autocomplete de paciente no formulário de agendamento manual — busca por
 * nome (ILIKE) OU pelos dígitos do telefone, com um resumo curto da ficha
 * (total de consultas e a mais recente) pra recepção confirmar que achou o
 * paciente certo antes de escolher. Mesmo cuidado de listarAgendaUnificada
 * com o parâmetro de dígitos: se o termo não tem nenhum dígito, ele vai como
 * null (comparar contra string vazia casaria QUALQUER telefone via LIKE '%%').
 */
export async function buscarPacientesPorNomeOuTelefone(termo) {
  const termoLimpo = typeof termo === "string" ? termo.trim() : "";
  if (!termoLimpo) return [];

  const digitos = termoLimpo.replace(/\D/g, "") || null;

  const { rows } = await pool.query(
    `SELECT
       p.id, p.nome, p.telefone, p.convenio,
       COUNT(a.id)::int AS total_consultas,
       MAX(a.data)::text AS ultima_consulta
     FROM pacientes p
     LEFT JOIN agendamentos a ON a.paciente_id = p.id
     WHERE p.ativo
       AND (p.nome ILIKE $1
        OR ($2::text IS NOT NULL AND regexp_replace(p.telefone, '\\D', '', 'g') LIKE '%' || $2 || '%')
        OR ($2::text IS NOT NULL AND p.cpf IS NOT NULL AND regexp_replace(p.cpf, '\\D', '', 'g') LIKE '%' || $2 || '%'))
     GROUP BY p.id
     ORDER BY p.nome ASC
     LIMIT 10`,
    [`%${termoLimpo}%`, digitos]
  );
  return rows;
}

/**
 * Exclui um paciente — de verdade (DELETE) quando não há nenhum histórico
 * ligado a ele, ou arquivado (ativo = false, mesmo padrão de
 * usuarios.ativo) quando há. Nunca apaga pagamento, presença/laudo ou
 * pacote de sessão junto — esse dado tem valor financeiro/clínico e
 * potencial obrigação de guarda, então arquivar preserva tudo intacto e só
 * tira o paciente das listas/busca do dashboard.
 *
 * Em vez de checar cada tabela que referencia pacientes manualmente (e
 * arriscar esquecer uma se uma nova referenciar pacientes no futuro),
 * deixa o próprio banco decidir: todas têm FK NOT NULL pra pacientes(id)
 * sem CASCADE, então a violação de chave estrangeira (23503) é o sinal
 * confiável de "tem histórico" — o mesmo padrão de deixar a constraint do
 * banco ser a fonte da verdade que usuarioController.js já usa pra nome de
 * usuário duplicado (23505).
 *
 * Retorna "excluido" | "arquivado" | null (paciente não existe/já sumiu).
 */
export async function excluirOuArquivarPaciente(id) {
  try {
    const { rowCount } = await pool.query("DELETE FROM pacientes WHERE id = $1", [id]);
    return rowCount > 0 ? "excluido" : null;
  } catch (err) {
    if (err.code !== "23503") throw err;

    const { rowCount } = await pool.query("UPDATE pacientes SET ativo = false WHERE id = $1", [id]);
    return rowCount > 0 ? "arquivado" : null;
  }
}
