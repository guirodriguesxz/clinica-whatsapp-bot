import { pool } from "../db/pool.js";
import { validarData } from "../utils/validacao.js";
import { buscarPacientePorTelefoneNormalizado } from "./pacienteModel.js";
import { PREDICADO_PACOTE_ATIVO } from "./pacoteSessaoModel.js";
import dayjs from "../utils/dayjs.js";
import { mesSeguro } from "../utils/mesSeguro.js";
import { limiteSeguroListagem, offsetSeguroListagem } from "../utils/paginacao.js";

const CAMPOS_PAGAMENTO_JSON = `
  'id', pg.id,
  'valor', pg.valor,
  'forma_pagamento', pg.forma_pagamento,
  'parcelas', pg.parcelas,
  'valor_acrescimo', pg.valor_acrescimo,
  'status', pg.status,
  'data', pg.data,
  'observacao', pg.observacao,
  'registrado_em', pg.registrado_em,
  'registrado_por', pg.registrado_por,
  'registrado_por_nome', registrador.nome,
  'tipo_lancamento', pg.tipo_lancamento,
  'pagamento_origem_id', pg.pagamento_origem_id,
  'estornado_por', estorno.id
`;

async function buscarItensBot({ janela, filtroData, filtros }) {
  const { rows } = await pool.query(
    `SELECT
       a.id,
       'bot' AS origem,
       p.nome AS paciente_nome,
       a.tipo_atendimento,
       a.data,
       a.hora,
       COALESCE(
         json_agg(
           json_build_object(${CAMPOS_PAGAMENTO_JSON})
           ORDER BY pg.data DESC, pg.registrado_em DESC
         ) FILTER (WHERE pg.id IS NOT NULL),
         '[]'
       ) AS pagamentos
     FROM agendamentos a
     JOIN pacientes p ON p.id = a.paciente_id
     LEFT JOIN pagamentos pg ON pg.agendamento_id = a.id
     LEFT JOIN pagamentos estorno ON estorno.pagamento_origem_id = pg.id
     LEFT JOIN usuarios registrador ON registrador.id = pg.registrado_por
     WHERE ($2::date IS NULL OR a.data = $2)
       AND ($3::date IS NULL OR a.data >= $3)
       AND ($4::date IS NULL OR a.data <= $4)
       AND ($5::text IS NULL OR p.nome ILIKE '%' || $5 || '%')
       AND (($6::text IS NULL AND $7::text IS NULL) OR EXISTS (
         SELECT 1 FROM pagamentos filtro WHERE filtro.agendamento_id = a.id
         AND ($6::text IS NULL OR filtro.status = $6)
         AND ($7::text IS NULL OR filtro.forma_pagamento = $7)
       ))
     GROUP BY a.id, p.nome, a.tipo_atendimento, a.data, a.hora
     ORDER BY a.data DESC, a.hora ASC
     LIMIT $1`,
    [janela, filtroData, filtros.inicio, filtros.fim, filtros.busca, filtros.status, filtros.formaPagamento]
  );
  return rows;
}

async function buscarItensImportados({ janela, filtroData, filtros }) {
  const { rows } = await pool.query(
    `SELECT
       ai.id,
       'importado' AS origem,
       ai.nome AS paciente_nome,
       ai.tipo_atendimento,
       ai.data,
       ai.hora,
       COALESCE(
         json_agg(
           json_build_object(${CAMPOS_PAGAMENTO_JSON})
           ORDER BY pg.data DESC, pg.registrado_em DESC
         ) FILTER (WHERE pg.id IS NOT NULL),
         '[]'
       ) AS pagamentos
     FROM agendamentos_importados ai
     LEFT JOIN pagamentos pg ON pg.agendamento_importado_id = ai.id
     LEFT JOIN pagamentos estorno ON estorno.pagamento_origem_id = pg.id
     LEFT JOIN usuarios registrador ON registrador.id = pg.registrado_por
     WHERE ($2::date IS NULL OR ai.data = $2)
       AND ($3::date IS NULL OR ai.data >= $3)
       AND ($4::date IS NULL OR ai.data <= $4)
       AND ($5::text IS NULL OR ai.nome ILIKE '%' || $5 || '%')
       AND (($6::text IS NULL AND $7::text IS NULL) OR EXISTS (
         SELECT 1 FROM pagamentos filtro WHERE filtro.agendamento_importado_id = ai.id
         AND ($6::text IS NULL OR filtro.status = $6)
         AND ($7::text IS NULL OR filtro.forma_pagamento = $7)
       ))
     GROUP BY ai.id, ai.nome, ai.tipo_atendimento, ai.data, ai.hora
     ORDER BY ai.data DESC, ai.hora ASC
     LIMIT $1`,
    [janela, filtroData, filtros.inicio, filtros.fim, filtros.busca, filtros.status, filtros.formaPagamento]
  );
  return rows;
}

/**
 * Lista combinada bot + importados pra tela /financeiro, cada item já com
 * seus pagamentos aninhados (json_agg, uma query por fonte — evita N+1).
 * Sem filtro de "já passou" (diferente de listarPresenca): pagamento pode
 * ser lançado em agendamento futuro (adiantamento). Mesmo padrão de janela
 * de paginação (offsetSeguro + limiteSeguro por fonte) corrigido no
 * sub-projeto 3, pra nenhuma linha antiga ficar inalcançável.
 */
export function normalizarFiltrosFinanceiro(valores = {}) {
  return {
    inicio: validarData(valores.inicio) ? valores.inicio : null,
    fim: validarData(valores.fim) ? valores.fim : null,
    busca: typeof valores.busca === "string" ? valores.busca.trim().slice(0, 150) || null : null,
    status: ["pago", "pendente", "aguardando_reembolso", "estornado"].includes(valores.status) ? valores.status : null,
    formaPagamento: ["pix", "cartao", "convenio"].includes(valores.formaPagamento) ? valores.formaPagamento : null,
    origem: ["bot", "importado"].includes(valores.origem) ? valores.origem : null,
  };
}

export async function listarFinanceiro({ data, limite, offset, ...valores } = {}) {
  const filtros = normalizarFiltrosFinanceiro(valores);
  const limiteSeguro = limiteSeguroListagem(limite);
  const offsetSeguro = offsetSeguroListagem(offset);
  const filtroData = validarData(data) ? data : null;
  const janela = offsetSeguro + limiteSeguro;

  const [itensBot, itensImportados] = await Promise.all([
    filtros.origem === "importado" ? [] : buscarItensBot({ janela, filtroData, filtros }),
    filtros.origem === "bot" ? [] : buscarItensImportados({ janela, filtroData, filtros }),
  ]);

  // Dia mais recente primeiro, mas dentro de cada dia a manhã vem primeiro
  // (hora ASC) — pedido explícito do usuário: abrir a lista e já ver o dia
  // "andando pra frente" a partir do primeiro atendimento, não do último.
  const combinados = [...itensBot, ...itensImportados].sort((x, y) => {
    if (x.data !== y.data) return y.data.localeCompare(x.data);
    return x.hora.localeCompare(y.hora);
  });

  return combinados.slice(offsetSeguro, offsetSeguro + limiteSeguro);
}

async function buscarAgendamentoBotParaPagamento(id) {
  const { rows } = await pool.query(`SELECT id, paciente_id FROM agendamentos WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

async function buscarImportadoParaPagamento(id) {
  const { rows } = await pool.query(
    `SELECT id, telefone FROM agendamentos_importados WHERE id = $1`,
    [id]
  );
  const importado = rows[0];
  if (!importado) return null;
  const resultadoPaciente = await buscarPacientePorTelefoneNormalizado(importado.telefone);
  const motivo =
    resultadoPaciente.motivo === "nao_encontrado"
      ? "paciente_nao_vinculado"
      : resultadoPaciente.motivo;
  return {
    id: importado.id,
    pacienteId: resultadoPaciente.paciente?.id ?? null,
    motivo,
  };
}

function paramsInsercao({
  pacienteId,
  valor,
  formaPagamento,
  parcelas,
  valorAcrescimo,
  status,
  data,
  observacao,
  registradoPor,
}) {
  return [
    pacienteId,
    valor,
    formaPagamento,
    parcelas,
    valorAcrescimo,
    status,
    data,
    observacao,
    registradoPor,
  ];
}

/**
 * Registra um pagamento (lançamento novo, extrato — nunca edita um
 * existente) pra um agendamento do bot. paciente_id vem direto de
 * agendamentos.paciente_id (FK já garantida). Sem transação: uma única
 * escrita, sem restrição de unicidade a proteger.
 */
export async function registrarPagamentoBot({
  agendamentoId,
  valor,
  formaPagamento,
  parcelas,
  valorAcrescimo,
  status,
  data,
  observacao,
  registradoPor,
}) {
  const agendamento = await buscarAgendamentoBotParaPagamento(agendamentoId);
  if (!agendamento) return { motivo: "nao_encontrado" };

  const { rows } = await pool.query(
    `INSERT INTO pagamentos
       (agendamento_id, paciente_id, valor, forma_pagamento, parcelas, valor_acrescimo, status, data, observacao, registrado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      agendamentoId,
      ...paramsInsercao({
        pacienteId: agendamento.paciente_id,
        valor,
        formaPagamento,
        parcelas,
        valorAcrescimo,
        status,
        data,
        observacao,
        registradoPor,
      }),
    ]
  );
  return { pagamento: rows[0] };
}

/**
 * Registra um pagamento pra um agendamento importado. agendamentos_importados
 * não tem FK pra pacientes — paciente_id é resolvido buscando pelo telefone
 * (buscarPacientePorTelefoneNormalizado — o telefone importado do sistema anterior
 * Office pode ter pontuação e/ou não ter o DDI, diferente do telefone
 * normalizado que o bot grava em pacientes.telefone, por isso a busca
 * compara só dígitos, com ou sem DDI, em vez de um match exato). Se não
 * achar, a escrita não acontece (motivo paciente_nao_vinculado) —
 * paciente_id é NOT NULL no banco.
 */
export async function registrarPagamentoImportado({
  agendamentoImportadoId,
  valor,
  formaPagamento,
  parcelas,
  valorAcrescimo,
  status,
  data,
  observacao,
  registradoPor,
}) {
  const importado = await buscarImportadoParaPagamento(agendamentoImportadoId);
  if (!importado) return { motivo: "nao_encontrado" };
  if (!importado.pacienteId) return { motivo: importado.motivo ?? "paciente_nao_vinculado" };

  const { rows } = await pool.query(
    `INSERT INTO pagamentos
       (agendamento_importado_id, paciente_id, valor, forma_pagamento, parcelas, valor_acrescimo, status, data, observacao, registrado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      agendamentoImportadoId,
      ...paramsInsercao({
        pacienteId: importado.pacienteId,
        valor,
        formaPagamento,
        parcelas,
        valorAcrescimo,
        status,
        data,
        observacao,
        registradoPor,
      }),
    ]
  );
  return { pagamento: rows[0] };
}

// R$70 avulsa / R$40 avaliação, Fisioterapia particular — mesmos valores do
// painel "Valores de referência" em /financeiro (decisão do usuário,
// 2026-09-16). Psicologia nunca entra aqui: "valores combinados diretamente
// com a equipe", sem preço fixo pra automatizar (mesma decisão).
const VALOR_PARTICULAR_AVALIACAO_FISIOTERAPIA = 40;
const VALOR_PARTICULAR_SESSAO_FISIOTERAPIA = 70;

async function buscarDadosAgendamentoParaAutoPagamento({ origem, agendamentoId, agendamentoImportadoId }) {
  if (origem === "bot") {
    const { rows } = await pool.query(
      `SELECT paciente_id, tipo_atendimento, primeira_consulta FROM agendamentos WHERE id = $1`,
      [agendamentoId]
    );
    return rows[0] ?? null;
  }
  const { rows } = await pool.query(
    `SELECT telefone, tipo_atendimento FROM agendamentos_importados WHERE id = $1`,
    [agendamentoImportadoId]
  );
  const importado = rows[0];
  if (!importado) return null;
  const resultadoPaciente = await buscarPacientePorTelefoneNormalizado(importado.telefone);
  return {
    paciente_id: resultadoPaciente.paciente?.id ?? null,
    tipo_atendimento: importado.tipo_atendimento,
    // Avaliação só existe em agendamentos do bot (primeira_consulta) — um
    // atendimento importado do sistema antigo sempre conta como sessão pro
    // repasse (mesma regra já usada em buscarRelatorioMensal/porPlano).
    primeira_consulta: false,
  };
}

/**
 * Decide valor/forma/status do pagamento automático pra uma sessão de
 * Fisioterapia. Retorna null (nunca inventa um valor) quando o convênio do
 * paciente está identificado (convenio_id) mas sem o valor de repasse
 * daquela categoria cadastrado em Convênios, ou quando o paciente só tem
 * convênio em texto livre (cadastro antigo, ainda sem convenio_id) — nesses
 * casos o lançamento continua manual, igual antes desta feature.
 */
async function calcularPagamentoAutomaticoFisioterapia({ pacienteId, primeiraConsulta }) {
  const { rows } = await pool.query(
    `SELECT p.convenio_id, p.convenio, c.valor_repasse_avaliacao, c.valor_repasse_sessao
     FROM pacientes p
     LEFT JOIN convenios c ON c.id = p.convenio_id
     WHERE p.id = $1`,
    [pacienteId]
  );
  const paciente = rows[0];
  if (!paciente) return null;

  if (paciente.convenio_id) {
    const valor = primeiraConsulta ? paciente.valor_repasse_avaliacao : paciente.valor_repasse_sessao;
    if (valor == null) return null;
    return { valor: Number(valor), formaPagamento: "convenio", status: "aguardando_reembolso" };
  }
  // "Particular" é o texto literal que o cadastro (dashboard e bot) grava em
  // pacientes.convenio pra quem NÃO tem convênio — não é um convênio em
  // texto livre ainda não migrado pra convenio_id. Só esse segundo caso
  // (algum outro texto) é ambíguo demais pra confiar no valor.
  if (paciente.convenio && paciente.convenio !== "Particular") return null;

  return {
    valor: primeiraConsulta ? VALOR_PARTICULAR_AVALIACAO_FISIOTERAPIA : VALOR_PARTICULAR_SESSAO_FISIOTERAPIA,
    formaPagamento: "pix",
    status: "pago",
  };
}

async function existePagamentoRegistrado({ agendamentoId, agendamentoImportadoId }) {
  const { rows } = await pool.query(
    `SELECT id FROM pagamentos
     WHERE tipo_lancamento = 'pagamento'
       AND (($1::int IS NOT NULL AND agendamento_id = $1) OR ($2::int IS NOT NULL AND agendamento_importado_id = $2))
     LIMIT 1`,
    [agendamentoId, agendamentoImportadoId]
  );
  return rows.length > 0;
}

async function pacienteTemPacoteAtivo(pacienteId) {
  const { rows } = await pool.query(
    `SELECT ps.id FROM pacotes_sessoes ps WHERE ps.paciente_id = $1 AND ${PREDICADO_PACOTE_ATIVO} LIMIT 1`,
    [pacienteId]
  );
  return rows.length > 0;
}

/**
 * Gera o pagamento sozinho quando a recepção marca "compareceu" numa sessão
 * de Fisioterapia (decisão do usuário, 2026-09-17) — evita ter que lançar
 * manualmente todo atendimento particular/convênio. Nunca lança exceção:
 * quando não dá pra gerar, devolve { motivo } e quem chamou decide (hoje,
 * dashboardController só loga e segue, sem quebrar a marcação de presença
 * que já aconteceu). Fica de fora, sem gerar nada:
 * - Psicologia (sem preço fixo — sempre manual).
 * - Paciente sem pacote de sessões ativo é o único caso que GERA; com pacote
 *   ativo a sessão já foi paga nele, então não cobra de novo.
 * - Convênio sem valor de repasse cadastrado, ou só com convênio em texto
 *   livre (sem convenio_id) — não dá pra confiar no valor.
 * - Já existe pagamento (tipo_lancamento='pagamento') pra este agendamento —
 *   evita duplicar (o chamador já filtra pra só chamar isto uma vez, na
 *   primeira transição pra compareceu, mas este guard protege mesmo assim).
 * Quem chama decide `origem`/o par de ids (mesmo padrão de
 * registrarPagamentoBot/Importado) e `registradoPor`. A data do pagamento é
 * sempre hoje (America/Sao_Paulo) — é quando o valor "entra" de fato (ou,
 * pra convênio, quando a cobrança é lançada), não a data do atendimento em
 * si, que pode ser dias antes.
 */
export async function tentarGerarPagamentoAutomatico({
  origem,
  agendamentoId = null,
  agendamentoImportadoId = null,
  registradoPor,
  // Só pro backfill pontual de presenças antigas já marcadas antes desta
  // feature existir: permite gravar o pagamento com a data da sessão
  // original em vez de hoje, senão um backfill em lote empilharia todo o
  // faturamento histórico no dia em que o backfill rodou.
  dataPagamento = null,
}) {
  const dadosAgendamento = await buscarDadosAgendamentoParaAutoPagamento({
    origem,
    agendamentoId,
    agendamentoImportadoId,
  });
  if (!dadosAgendamento || dadosAgendamento.tipo_atendimento !== "fisioterapia") {
    return { motivo: "nao_fisioterapia" };
  }
  if (!dadosAgendamento.paciente_id) return { motivo: "paciente_nao_identificado" };
  if (await existePagamentoRegistrado({ agendamentoId, agendamentoImportadoId })) {
    return { motivo: "pagamento_ja_existe" };
  }
  if (await pacienteTemPacoteAtivo(dadosAgendamento.paciente_id)) return { motivo: "coberto_por_pacote" };

  const parametros = await calcularPagamentoAutomaticoFisioterapia({
    pacienteId: dadosAgendamento.paciente_id,
    primeiraConsulta: dadosAgendamento.primeira_consulta === true,
  });
  if (!parametros) return { motivo: "sem_valor_configuravel" };

  const dados = {
    ...parametros,
    parcelas: null,
    valorAcrescimo: null,
    data: dataPagamento ?? dayjs().tz("America/Sao_Paulo").format("YYYY-MM-DD"),
    observacao: "Gerado automaticamente ao marcar presença.",
    registradoPor,
  };

  return origem === "bot"
    ? registrarPagamentoBot({ agendamentoId, ...dados })
    : registrarPagamentoImportado({ agendamentoImportadoId, ...dados });
}

/**
 * Estorna sem alterar o lançamento original: cria uma segunda linha
 * compensatória, ligada por pagamento_origem_id. O lock serializa pedidos
 * concorrentes para o mesmo original e o índice único da migration 013 é a
 * última proteção contra duplicidade.
 */
export async function estornarPagamento(pagamentoId, { registradoPor, data, observacao }) {
  const client = await pool.connect();
  let transacaoAberta = false;

  try {
    await client.query("BEGIN");
    transacaoAberta = true;

    const finalizarComRollback = async (motivo) => {
      await client.query("ROLLBACK");
      transacaoAberta = false;
      return { motivo };
    };

    const original = await client.query("SELECT * FROM pagamentos WHERE id = $1 FOR UPDATE", [
      pagamentoId,
    ]);
    const pagamentoOriginal = original.rows[0];

    if (!pagamentoOriginal) return await finalizarComRollback("nao_encontrado");
    if (pagamentoOriginal.tipo_lancamento === "estorno") {
      return await finalizarComRollback("nao_estornavel");
    }

    const existente = await client.query(
      "SELECT id FROM pagamentos WHERE pagamento_origem_id = $1",
      [pagamentoId]
    );
    if (existente.rows[0]) return await finalizarComRollback("ja_estornado");

    const { rows } = await client.query(
      `INSERT INTO pagamentos
         (agendamento_id, agendamento_importado_id, paciente_id, valor, forma_pagamento, parcelas, valor_acrescimo, status, data, observacao, registrado_por, tipo_lancamento, pagamento_origem_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        pagamentoOriginal.agendamento_id,
        pagamentoOriginal.agendamento_importado_id,
        pagamentoOriginal.paciente_id,
        pagamentoOriginal.valor,
        pagamentoOriginal.forma_pagamento,
        pagamentoOriginal.parcelas,
        pagamentoOriginal.valor_acrescimo,
        pagamentoOriginal.status,
        data,
        observacao,
        registradoPor,
        "estorno",
        pagamentoId,
      ]
    );

    await client.query("COMMIT");
    transacaoAberta = false;
    return { pagamento: rows[0] };
  } catch (erro) {
    if (transacaoAberta) {
      await client.query("ROLLBACK");
      transacaoAberta = false;
    }
    if (erro?.code === "23505") return { motivo: "ja_estornado" };
    throw erro;
  } finally {
    client.release();
  }
}

/**
 * Totais agregados do mês pra tela /financeiro/relatorio. 5 queries
 * separadas (totalFaturado, totalRecebido + 3 breakdowns) em vez de uma só
 * com GROUPING SETS — mais simples de ler e testar, sem precedente de SQL
 * avançado neste projeto. O breakdown por tipo_atendimento precisa de
 * COALESCE porque só uma das duas origens (agendamentos/agendamentos_importados)
 * está preenchida por linha.
 *
 * Cada lançamento usa sua própria data contábil. Pagamentos somam e estornos
 * subtraem pelo tipo_lancamento; o valor armazenado continua positivo.
 * Quantidades mantêm pagamentos originais e estornos em colunas separadas.
 * totalRecebido considera somente linhas cujo status financeiro copiado é
 * 'pago', preservando a compensação do estorno dentro do mesmo status.
 */
export const ESPECIALIDADES_VALIDAS = new Set(["fisioterapia", "psicologia"]);
export const TURNOS_VALIDOS = new Set(["manha", "tarde"]);

// Escapa os curingas do LIKE/ILIKE (% e _) que o texto do usuário possa
// conter, tratando-os como caracteres literais em vez de curinga — sem
// isso, um convênio digitado com "_" (comum em nomes com underline) casaria
// com qualquer caractere na posição, além de tratar % como curinga
// arbitrário embutido no meio do termo buscado.
function escaparCoringasLike(valor) {
  return valor.replace(/[\\%_]/g, (caractere) => `\\${caractere}`);
}

export async function buscarRelatorioMensal({
  mes,
  plano = null,
  especialidade = null,
  dia = null,
  turno = null,
} = {}) {
  const mesResolvido = mesSeguro(mes);
  const inicio = `${mesResolvido}-01`;
  const fimExclusivo = dayjs(inicio, "YYYY-MM-DD").add(1, "month").format("YYYY-MM-DD");
  const planoFiltro = String(plano ?? "").trim() || null;
  const especialidadeFiltro = ESPECIALIDADES_VALIDAS.has(especialidade) ? especialidade : null;
  const diaFiltro = validarData(dia) ? dia : null;
  const turnoFiltro = TURNOS_VALIDOS.has(turno) ? turno : null;

  // Os filtros de plano/especialidade dependem do agendamento (bot ou
  // importado) e/ou do cadastro do paciente — por isso os joins entram em
  // toda consulta agregada, não só nas que exibem essas colunas.
  const joinsAtendimento = `
    LEFT JOIN agendamentos a ON a.id = pg.agendamento_id
    LEFT JOIN agendamentos_importados ai ON ai.id = pg.agendamento_importado_id
    LEFT JOIN pacientes p ON p.id = pg.paciente_id`;
  // $3 a $6 sempre aparecem na query (guardados por IS NULL) mesmo sem
  // filtro selecionado: os 6 parâmetros são sempre passados a todas as
  // consultas abaixo, e o Postgres rejeita o bind se o texto da query não
  // referenciar exatamente os placeholders enviados.
  const filtroPlano = "AND ($3::text IS NULL OR COALESCE(ai.convenio, p.convenio) ILIKE $3)";
  const filtroEspecialidade =
    "AND ($4::text IS NULL OR COALESCE(a.tipo_atendimento, ai.tipo_atendimento) = $4)";
  // dia isola um único dia dentro do mês filtrado; turno usa o horário do
  // agendamento (bot ou importado) pro mesmo corte já usado na agenda da
  // clínica (manhã 07h-11h30, tarde 13h-18h30).
  const filtroDia = "AND ($5::date IS NULL OR pg.data = $5)";
  const filtroTurno =
    "AND ($6::text IS NULL OR " +
    "($6 = 'manha' AND COALESCE(a.hora, ai.hora) < TIME '13:00') OR " +
    "($6 = 'tarde' AND COALESCE(a.hora, ai.hora) >= TIME '13:00'))";
  const where = `WHERE pg.data >= $1 AND pg.data < $2 ${filtroPlano} ${filtroEspecialidade} ${filtroDia} ${filtroTurno}`;
  // Busca por substring (ex.: "Vale Saúde" deve casar com "Vale Saúde Nacional"),
  // não igualdade exata — daí o % em volta do termo já escapado.
  const planoParaConsulta = planoFiltro ? `%${escaparCoringasLike(planoFiltro)}%` : null;
  const parametros = [inicio, fimExclusivo, planoParaConsulta, especialidadeFiltro, diaFiltro, turnoFiltro];

  const [
    totalFaturado,
    totalRecebido,
    porTipo,
    porForma,
    porStatus,
    porPlano,
    porProfissionalPsicologia,
    detalhamento,
  ] = await Promise.all([
    pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN pg.tipo_lancamento = 'estorno' THEN -pg.valor ELSE pg.valor END), 0) AS total,
         COUNT(*) FILTER (WHERE pg.tipo_lancamento = 'pagamento') AS quantidade,
         COUNT(*) FILTER (WHERE pg.tipo_lancamento = 'estorno') AS quantidade_estornos
       FROM pagamentos pg ${joinsAtendimento} ${where}`,
      parametros
    ),
    pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN pg.tipo_lancamento = 'estorno' THEN -pg.valor ELSE pg.valor END), 0) AS total,
         COUNT(*) FILTER (WHERE pg.tipo_lancamento = 'pagamento') AS quantidade,
         COUNT(*) FILTER (WHERE pg.tipo_lancamento = 'estorno') AS quantidade_estornos
       FROM pagamentos pg ${joinsAtendimento} ${where} AND pg.status = 'pago'`,
      parametros
    ),
    pool.query(
      `SELECT COALESCE(a.tipo_atendimento, ai.tipo_atendimento) AS tipo_atendimento,
              COALESCE(SUM(CASE WHEN pg.tipo_lancamento = 'estorno' THEN -pg.valor ELSE pg.valor END), 0) AS total,
              COUNT(*) FILTER (WHERE pg.tipo_lancamento = 'pagamento') AS quantidade,
              COUNT(*) FILTER (WHERE pg.tipo_lancamento = 'estorno') AS quantidade_estornos
       FROM pagamentos pg ${joinsAtendimento} ${where}
       GROUP BY COALESCE(a.tipo_atendimento, ai.tipo_atendimento)`,
      parametros
    ),
    pool.query(
      `SELECT pg.forma_pagamento,
              COALESCE(SUM(CASE WHEN pg.tipo_lancamento = 'estorno' THEN -pg.valor ELSE pg.valor END), 0) AS total,
              COUNT(*) FILTER (WHERE pg.tipo_lancamento = 'pagamento') AS quantidade,
              COUNT(*) FILTER (WHERE pg.tipo_lancamento = 'estorno') AS quantidade_estornos
       FROM pagamentos pg ${joinsAtendimento} ${where}
       GROUP BY pg.forma_pagamento`,
      parametros
    ),
    pool.query(
      `SELECT pg.status,
              COALESCE(SUM(CASE WHEN pg.tipo_lancamento = 'estorno' THEN -pg.valor ELSE pg.valor END), 0) AS total,
              COUNT(*) FILTER (WHERE pg.tipo_lancamento = 'pagamento') AS quantidade,
              COUNT(*) FILTER (WHERE pg.tipo_lancamento = 'estorno') AS quantidade_estornos
       FROM pagamentos pg ${joinsAtendimento} ${where}
       GROUP BY pg.status`,
      parametros
    ),
    // Agrupa pelo convênio estruturado do paciente (convenio_id, Fase 2 do
    // roadmap de repasse) quando disponível — pagamentos.paciente_id
    // sempre existe, inclusive pra importados (resolvido pelo telefone em
    // registrarPagamentoImportado), então convenio_id cobre qualquer
    // origem. Pacientes ainda não corrigidos (convenio_id nulo) continuam
    // agrupados pelo texto livre, comportamento inalterado. primeira_consulta
    // só existe em agendamentos (bot) — importado sempre conta como sessão.
    pool.query(
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
         FROM pagamentos pg ${joinsAtendimento}
         LEFT JOIN convenios c ON c.id = p.convenio_id
         ${where}
       ) linhas
       GROUP BY chave_grupo`,
      parametros
    ),
    // Psicologia não tem calendário próprio por profissional (ver módulo 1
    // do roadmap) — "atendente" só existe em dados importados do sistema
    // legado, por isso esta quebra só cobre agendamentos_importados.
    pool.query(
      `SELECT ai.atendente AS profissional,
              COALESCE(SUM(CASE WHEN pg.tipo_lancamento = 'estorno' THEN -pg.valor ELSE pg.valor END), 0) AS total,
              COUNT(*) FILTER (WHERE pg.tipo_lancamento = 'pagamento') AS quantidade,
              COUNT(*) FILTER (WHERE pg.tipo_lancamento = 'estorno') AS quantidade_estornos
       FROM pagamentos pg ${joinsAtendimento} ${where}
       AND COALESCE(a.tipo_atendimento, ai.tipo_atendimento) = 'psicologia'
       AND ai.atendente IS NOT NULL AND ai.atendente <> ''
       GROUP BY ai.atendente`,
      parametros
    ),
    // Detalhamento linha a linha pra tela mostrar cada lançamento do mês,
    // não só os totais agregados acima. Ordenado por pg.data (a mesma data
    // contábil usada no filtro do período, ver `where`) e, dentro do
    // mesmo dia, pela hora do atendimento — manhã primeiro — mesmo
    // critério já usado na lista de /financeiro (ver listarFinanceiro).
    pool.query(
      `SELECT
         pg.id,
         pg.tipo_lancamento,
         pg.valor,
         pg.forma_pagamento,
         pg.status,
         pg.data AS data_pagamento,
         p.nome AS paciente_nome,
         COALESCE(a.tipo_atendimento, ai.tipo_atendimento) AS tipo_atendimento,
         COALESCE(a.hora, ai.hora) AS hora_atendimento
       FROM pagamentos pg ${joinsAtendimento}
       ${where}
       ORDER BY pg.data ASC, COALESCE(a.hora, ai.hora) ASC`,
      parametros
    ),
  ]);

  return {
    mes: mesResolvido,
    totalFaturado: totalFaturado.rows[0] ?? {
      total: 0,
      quantidade: 0,
      quantidade_estornos: 0,
    },
    totalRecebido: totalRecebido.rows[0] ?? {
      total: 0,
      quantidade: 0,
      quantidade_estornos: 0,
    },
    porTipoAtendimento: porTipo.rows,
    porFormaPagamento: porForma.rows,
    porStatus: porStatus.rows,
    porPlano: porPlano.rows.map(calcularRepasseLinha),
    porProfissionalPsicologia: porProfissionalPsicologia.rows,
    detalhamento: detalhamento.rows,
  };
}

/**
 * Calcula o valor de repasse de uma linha de porPlano — feito em JS, não em
 * SQL, pra deixar `valorRepasse` explicitamente `null` (em vez de um `0`
 * silencioso) quando não dá pra calcular: convênio não identificado
 * (paciente sem convenio_id, Fase 2 do roadmap de repasse ainda não
 * corrigida pra ele) ou faltando o valor de repasse justamente da
 * categoria (avaliação/sessão) que teve atendimento — um convênio que só
 * tem o valor de sessão cadastrado (avaliação nunca preenchida) continua
 * calculando normalmente num mês sem nenhuma avaliação, já que a
 * quantidade daquela categoria é zero.
 */
export function calcularRepasseLinha(linha) {
  if (!linha.convenio_identificado) {
    return { ...linha, valorRepasse: null, motivoRepasseIndisponivel: "nao_identificado" };
  }
  const quantidadeAvaliacao = Number(linha.quantidade_avaliacao);
  const quantidadeSessao = Number(linha.quantidade_sessao);
  const faltaValorAvaliacao = quantidadeAvaliacao > 0 && linha.valor_repasse_avaliacao == null;
  const faltaValorSessao = quantidadeSessao > 0 && linha.valor_repasse_sessao == null;
  if (faltaValorAvaliacao || faltaValorSessao) {
    return { ...linha, valorRepasse: null, motivoRepasseIndisponivel: "nao_configurado" };
  }
  const valorRepasse =
    quantidadeAvaliacao * Number(linha.valor_repasse_avaliacao ?? 0) +
    quantidadeSessao * Number(linha.valor_repasse_sessao ?? 0);
  return { ...linha, valorRepasse, motivoRepasseIndisponivel: null };
}
