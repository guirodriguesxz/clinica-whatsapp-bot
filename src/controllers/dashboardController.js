import { buscarUsuarioPorNomeUsuario, PAPEIS_VALIDOS } from "../models/usuarioModel.js";
import { slugArquivo } from "../utils/slugArquivo.js";
import { compararSenha, hashSenha } from "../services/senhaService.js";
import { capturarErro } from "../config/sentry.js";
import { enviarMensagem } from "../services/whatsappService.js";
import { montarMensagemConfirmacao } from "../services/confirmacaoAgendamentoService.js";
import { montarMensagemControleSessoes } from "../services/controleSessoesMensagemService.js";
import {
  buscarAgendamentoComPacientePorId,
  buscarAgendamentoImportadoPorId,
  cancelarAgendamentoConfirmado,
  cancelarAgendamentoImportado,
  excluirOuCancelarAgendamento as excluirOuCancelarAgendamentoPadrao,
  listarAgendaUnificada,
  inserirAgendamento as inserirAgendamentoNoBancoPadrao,
} from "../models/agendamentoModel.js";
import {
  buscarPacientePorId as buscarPacientePorIdPadrao,
  buscarPacientePorTelefone as buscarPacientePorTelefonePadrao,
  encontrarOuCriarPaciente as encontrarOuCriarPacientePadrao,
  atualizarDadosPaciente,
  listarHistoricoPaciente,
  listarPacientes as listarPacientesPadrao,
  listarSessoesFisioterapiaPaciente,
  buscarPacientesPorNomeOuTelefone,
  excluirOuArquivarPaciente as excluirOuArquivarPacientePadrao,
} from "../models/pacienteModel.js";
import {
  criarPacote,
  cancelarPacote,
  listarPacotesPaciente,
} from "../models/pacoteSessaoModel.js";
import {
  registrarPresencaBot,
  registrarPresencaImportado,
  buscarPresencaAtual,
} from "../models/registroAtendimentoModel.js";
import { buscarDadosLaudoBot, buscarDadosLaudoImportado } from "../models/laudoModel.js";
import { gerarPdfLaudo } from "../services/laudoPdfService.js";
import { buscarDadosGuiaConvenio } from "../models/guiaConvenioModel.js";
import { gerarPdfGuiaConvenio } from "../services/guiaConvenioPdfService.js";
import { listarAvaliacoesPaciente } from "../models/avaliacaoFisioterapeuticaModel.js";
import { listarRelatoriosPaciente } from "../models/relatorioFisioterapeuticoModel.js";
import {
  listarFinanceiro,
  normalizarFiltrosFinanceiro,
  registrarPagamentoBot,
  registrarPagamentoImportado,
  estornarPagamento,
  buscarRelatorioMensal,
  ESPECIALIDADES_VALIDAS,
  TURNOS_VALIDOS,
  tentarGerarPagamentoAutomatico,
} from "../models/pagamentoModel.js";
import { listarPsicologos as listarPsicologosPadrao } from "../models/psicologoModel.js";
import { listarFisioterapeutas as listarFisioterapeutasPadrao } from "../models/fisioterapeutaModel.js";
import { listarConvenios as listarConveniosPadrao } from "../models/convenioModel.js";
import { buscarEstatisticas } from "../models/estatisticaModel.js";
import { resolverPeriodo, PERIODOS_VALIDOS } from "../utils/periodoEstatisticas.js";
import { validarData, validarHora, validarTipoAtendimento } from "../utils/validacao.js";
import { formatarDataExtensa } from "../utils/data.js";
import dayjs from "../utils/dayjs.js";
import { CLINICA } from "../config/clinica.js";
import { idSeguro, limiteSeguroListagem, offsetSeguroListagem } from "../utils/paginacao.js";
import { normalizarTelefoneComDDI } from "../utils/phone.js";
import { validarDisponibilidadeAgendamento, listarHorariosDisponiveis } from "../services/calendarService.js";
import {
  remarcarConsulta,
  remarcarConsultaImportada,
  editarConsulta,
  editarConsultaImportada,
} from "../services/remarcacaoService.js";

// Hash "dummy" usado quando o usuário não existe (ou está inativo), pra que
// processarLogin sempre rode exatamente um bcrypt.compare por tentativa —
// sem isso, o curto-circuito do `||` deixa a resposta pra e-mail inexistente
// visivelmente mais rápida que a de senha errada (bcrypt custo 12 leva
// 150-300ms), o que permite enumerar e-mails cadastrados só pelo tempo de
// resposta, mesmo com a mensagem de erro sendo idêntica nos dois casos.
// Calculado uma única vez, quando o módulo carrega — não a cada requisição.
const HASH_DUMMY_PROMISE = hashSenha("dummy-para-igualar-tempo-de-resposta-do-login");

// Teto real de retenção de cookie que os navegadores aceitam (Chrome/Edge
// recusam um Max-Age maior que ~400 dias desde 2023) — usado como "sem
// limite" prático pro checkbox "Manter conectado" do login, já que um
// Max-Age literalmente infinito não é respeitado pelo navegador.
const MAX_AGE_MANTER_CONECTADO_MS = 1000 * 60 * 60 * 24 * 400;

export function telaLogin(req, res) {
  if (req.session?.usuarioId) {
    return res.redirect("/hoje");
  }
  res.render("login", { erro: null });
}

export async function processarLogin(req, res) {
  const { nome_usuario: nomeUsuario, senha, manter_conectado: manterConectado } = req.body ?? {};
  const mensagemErroGenerica = "Nome de usuário ou senha inválidos.";

  if (!nomeUsuario || !senha) {
    return res.status(400).render("login", { erro: mensagemErroGenerica });
  }

  const usuario = await buscarUsuarioPorNomeUsuario(nomeUsuario);
  const hashParaComparar = usuario?.senha_hash ?? (await HASH_DUMMY_PROMISE);
  const senhaValida = await compararSenha(senha, hashParaComparar);

  if (!usuario || !usuario.ativo || !senhaValida || !PAPEIS_VALIDOS.has(usuario.papel)) {
    return res.status(401).render("login", { erro: mensagemErroGenerica });
  }

  req.session.regenerate((err) => {
    if (err) {
      capturarErro("[dashboardController] Erro ao regenerar sessão no login:", err);
      return res.status(500).render("login", { erro: "Erro interno. Tente novamente." });
    }
    req.session.usuarioId = usuario.id;
    req.session.usuarioVersao = usuario.sessao_versao;
    if (manterConectado) {
      req.session.cookie.maxAge = MAX_AGE_MANTER_CONECTADO_MS;
    }
    res.redirect("/hoje");
  });
}

export function processarLogout(req, res) {
  req.session.destroy(() => {
    res.redirect("/login");
  });
}

export async function telaAgendamentos(
  req,
  res,
  {
    listarAgenda = listarAgendaUnificada,
    listarPsicologos = listarPsicologosPadrao,
    tipoAtendimentoFixo = null,
  } = {}
) {
  const {
    data,
    status,
    tipo_atendimento: tipoAtendimentoQuery,
    busca,
    periodo,
    psicologo_id: psicologoIdBruto,
    origem,
    avaliacao,
    limite,
    offset,
    whatsapp,
    presenca_msg: presencaMsg,
    agendamento_msg: agendamentoMsg,
  } = req.query;
  const tipoAtendimento = tipoAtendimentoFixo ?? tipoAtendimentoQuery;
  const limiteAtual = limiteSeguroListagem(limite);
  const offsetAtual = offsetSeguroListagem(offset);
  const psicologoId = idSeguro(psicologoIdBruto);
  const [itens, psicologos] = await Promise.all([
    listarAgenda({
      data,
      status,
      tipoAtendimento,
      busca,
      periodo,
      psicologoId,
      origem,
      avaliacao,
      limite: limiteAtual,
      offset: offsetAtual,
    }),
    listarPsicologos(),
  ]);

  const psicologoFiltrado = psicologoId ? psicologos.find((p) => p.id === psicologoId) : null;
  const tituloAgenda =
    data && psicologoFiltrado
      ? `Agenda: ${psicologoFiltrado.nome} — ${formatarDataExtensa(data)}`
      : data
      ? `Agenda de ${formatarDataExtensa(data)}`
      : "Todos os agendamentos";

  res.render("agendamentos/lista", {
    itens,
    psicologos,
    tituloAgenda,
    tipoFixo: tipoAtendimentoFixo,
    filtros: {
      data: data ?? "",
      status: status ?? "",
      tipo_atendimento: tipoAtendimento ?? "",
      busca: busca ?? "",
      periodo: periodo ?? "",
      psicologo_id: psicologoId ? String(psicologoId) : "",
      origem: origem ?? "",
      avaliacao: avaliacao ?? "",
    },
    limiteAtual,
    offsetAtual,
    temProximaPagina: itens.length === limiteAtual,
    mensagemWhatsapp: whatsapp === "enviado" ? "Confirmação enviada por WhatsApp." : null,
    mensagemPresenca: typeof presencaMsg === "string" ? presencaMsg.slice(0, 300) : null,
    mensagemAgendamento: typeof agendamentoMsg === "string" ? agendamentoMsg.slice(0, 300) : null,
  });
}

/**
 * Tela /agendamentos/proximos — o que vem depois da semana corrente, pra
 * não repetir o que a tela /agendamentos já mostra dia a dia (pedido do
 * usuário). Usa listarAgendaUnificada (já traz só hoje pra frente quando não
 * há filtro de data), busca até LIMITE_JANELA de uma vez (sem paginação
 * nessa primeira versão) e descarta em código os primeiros ANTECEDENCIA_DIAS
 * dias — não dá pra filtrar isso no SQL de listarAgendaUnificada sem mudar a
 * assinatura usada também por /agendamentos e /hoje. A view agrupa por
 * dia/período.
 */
const LIMITE_JANELA_PROXIMOS = 200;
const ANTECEDENCIA_DIAS_PROXIMOS = 7;

export async function telaProximosAgendamentos(
  req,
  res,
  {
    listarAgenda = listarAgendaUnificada,
    listarPsicologos = listarPsicologosPadrao,
    agora = dayjs().tz("America/Sao_Paulo"),
    tipoAtendimentoFixo = null,
  } = {}
) {
  const {
    status,
    tipo_atendimento: tipoAtendimentoQuery,
    busca,
    periodo,
    psicologo_id: psicologoIdBruto,
    origem,
    avaliacao,
    whatsapp,
    presenca_msg: presencaMsg,
  } = req.query;
  const tipoAtendimento = tipoAtendimentoFixo ?? tipoAtendimentoQuery;
  const psicologoId = idSeguro(psicologoIdBruto);
  const dataMinima = agora.add(ANTECEDENCIA_DIAS_PROXIMOS, "day").format("YYYY-MM-DD");
  const [itensBrutos, psicologos] = await Promise.all([
    listarAgenda({
      status,
      tipoAtendimento,
      busca,
      periodo,
      psicologoId,
      origem,
      avaliacao,
      limite: LIMITE_JANELA_PROXIMOS,
      offset: 0,
    }),
    listarPsicologos(),
  ]);
  const itens = itensBrutos.filter((item) => item.data >= dataMinima);

  res.render("agendamentos/proximos", {
    itens,
    psicologos,
    tipoFixo: tipoAtendimentoFixo,
    filtros: {
      status: status ?? "",
      tipo_atendimento: tipoAtendimento ?? "",
      busca: busca ?? "",
      periodo: periodo ?? "",
      psicologo_id: psicologoId ? String(psicologoId) : "",
      origem: origem ?? "",
      avaliacao: avaliacao ?? "",
    },
    mensagemWhatsapp: whatsapp === "enviado" ? "Confirmação enviada por WhatsApp." : null,
    mensagemPresenca: typeof presencaMsg === "string" ? presencaMsg.slice(0, 300) : null,
  });
}

export async function telaHoje(
  req,
  res,
  { listarHoje = listarAgendaUnificada } = {}
) {
  const dataHoje = dayjs().tz("America/Sao_Paulo").format("YYYY-MM-DD");
  const itens = [];
  let pagina;
  do {
    pagina = await listarHoje({ data: dataHoje, limite: 200, offset: itens.length });
    itens.push(...pagina);
  } while (pagina.length === 200);
  const resumo = {
    total: itens.length,
    confirmados: itens.filter((item) => item.status === "confirmado").length,
    compareceram: itens.filter((item) => item.presenca === "compareceu").length,
    faltaram: itens.filter((item) => item.presenca === "faltou").length,
  };
  const presencaMsg = req.query?.presenca_msg;
  const mensagem = req.query?.sucesso
    ? "Alteração salva."
    : typeof presencaMsg === "string"
      ? presencaMsg.slice(0, 300)
      : null;
  res.render("hoje/lista", { itens, resumo, dataHoje, mensagem });
}

/**
 * Resolve a origem (bot/importado) de forma segura a partir de
 * req.params.origem. `undefined` (rota antiga sem o segmento :origem, ou
 * chamada direta do controller nos testes) sempre vira "bot", por
 * compatibilidade retroativa. Qualquer outra string que não seja
 * exatamente "bot" ou "importado" (typo, caixa errada, etc.) retorna null
 * — quem chamar deve responder 404 nesse caso, em vez de cair
 * silenciosamente no branch do bot e arriscar mexer na tabela errada.
 */
function origemSegura(paramsOrigem) {
  if (paramsOrigem === undefined) return "bot";
  if (paramsOrigem === "bot" || paramsOrigem === "importado") return paramsOrigem;
  return null;
}

export async function processarCancelarAgendamento(
  req,
  res,
  {
    buscarAgendamentoBot = buscarAgendamentoComPacientePorId,
    buscarAgendamentoImportado = buscarAgendamentoImportadoPorId,
    cancelarNoBancoBot = cancelarAgendamentoConfirmado,
    cancelarNoBancoImportado = cancelarAgendamentoImportado,
  } = {}
) {
  const origem = origemSegura(req.params.origem);
  if (!origem) return res.status(404).send("Agendamento não encontrado.");
  const agendamentoId = idSeguro(req.params.id);
  if (!agendamentoId) return res.status(404).send("Agendamento não encontrado.");

  const buscarAgendamento = origem === "importado" ? buscarAgendamentoImportado : buscarAgendamentoBot;
  const agendamento = await buscarAgendamento(agendamentoId);
  if (!agendamento || agendamento.ja_passou) return res.status(404).send("Agendamento não encontrado.");

  const cancelarNoBanco = origem === "importado" ? cancelarNoBancoImportado : cancelarNoBancoBot;
  const cancelado = await cancelarNoBanco(agendamentoId);
  if (!cancelado) {
    return res
      .status(409)
      .send("Esse agendamento já foi atualizado por outra pessoa — recarregue a página e tente de novo.");
  }

  res.redirect("/agendamentos");
}

const MENSAGEM_RESULTADO_EXCLUSAO_AGENDAMENTO = {
  excluido: "Agendamento excluído.",
  cancelado: "Esse agendamento tinha presença/pagamento registrado, então foi cancelado em vez de excluído (histórico preservado).",
};

/**
 * Restrita à administradora na rota (exigirPapel), mesmo padrão de
 * processarExcluirPaciente. excluirOuCancelarAgendamento já decide no banco
 * entre excluir de verdade (sem histórico vinculado) e só cancelar (quando
 * há presença/pagamento registrado) — aqui só traduz o resultado numa
 * mensagem. Diferente de Cancelar (só pra confirmado e futuro), Excluir
 * está disponível pra qualquer status — serve justamente pra tirar da
 * agenda um registro errado (ex: hora inválida, duplicata de import) que
 * Cancelar sozinho não teria motivo pra bloquear mas também não limpa de
 * verdade da lista.
 */
export async function processarExcluirAgendamento(
  req,
  res,
  { excluirOuCancelar = excluirOuCancelarAgendamentoPadrao } = {}
) {
  const origem = origemSegura(req.params.origem);
  if (!origem) return res.status(404).send("Agendamento não encontrado.");
  const agendamentoId = idSeguro(req.params.id);
  if (!agendamentoId) return res.status(404).send("Agendamento não encontrado.");

  const resultado = await excluirOuCancelar(origem, agendamentoId);
  if (!resultado) return res.status(404).send("Agendamento não encontrado.");

  res.redirect(`/agendamentos?agendamento_msg=${encodeURIComponent(MENSAGEM_RESULTADO_EXCLUSAO_AGENDAMENTO[resultado])}`);
}

/**
 * Envia a confirmação por WhatsApp pro paciente do agendamento — disparo
 * manual (a recepção clica), nunca automático: evita mensagem
 * duplicada/errada se o agendamento for corrigido logo em seguida (ver
 * decisão do usuário, 2026-09-04). Só permite pra agendamento confirmado e
 * futuro — mandar "confirmado para X" de algo cancelado ou que já passou
 * confundiria o paciente.
 */
export async function processarEnviarConfirmacao(
  req,
  res,
  {
    buscarAgendamentoBot = buscarAgendamentoComPacientePorId,
    buscarAgendamentoImportado = buscarAgendamentoImportadoPorId,
    enviarMensagemFn = enviarMensagem,
  } = {}
) {
  const origem = origemSegura(req.params.origem);
  if (!origem) return res.status(404).send("Agendamento não encontrado.");
  const agendamentoId = idSeguro(req.params.id);
  if (!agendamentoId) return res.status(404).send("Agendamento não encontrado.");

  const buscarAgendamento = origem === "importado" ? buscarAgendamentoImportado : buscarAgendamentoBot;
  const agendamento = await buscarAgendamento(agendamentoId);
  if (!agendamento) return res.status(404).send("Agendamento não encontrado.");

  if (agendamento.status !== "confirmado" || agendamento.ja_passou) {
    return res
      .status(400)
      .send("Só é possível enviar confirmação de agendamentos confirmados e futuros.");
  }

  try {
    await enviarMensagemFn(agendamento.paciente_telefone, montarMensagemConfirmacao(agendamento));
  } catch (err) {
    capturarErro("[dashboardController] Falha ao enviar confirmação por WhatsApp:", err);
    return res.status(500).send("Não foi possível enviar a confirmação por WhatsApp. Tente novamente.");
  }

  const destinos = {
    hoje: "/hoje?sucesso=1",
    proximos: "/agendamentos/proximos?whatsapp=enviado",
  };
  res.redirect(destinos[req.body?.retorno] ?? "/agendamentos?whatsapp=enviado");
}

const MENSAGEM_ERRO_REMARCACAO = {
  FORA_DO_HORARIO_FUNCIONAMENTO:
    "Esse horário está fora do funcionamento da clínica ou cai num fim de semana/feriado.",
  DATA_NO_PASSADO: "Essa data/hora já passou.",
  FORA_DO_LIMITE_DIAS: "Só é possível remarcar dentro de 7 dias úteis a partir de hoje.",
  HORARIO_LOTADO: "Esse horário já está lotado — escolha outro.",
  FALHA_AO_GRAVAR: "Não foi possível concluir a remarcação por um problema técnico. Tente novamente.",
};

export async function telaRemarcarAgendamento(
  req,
  res,
  {
    buscarAgendamentoBot = buscarAgendamentoComPacientePorId,
    buscarAgendamentoImportado = buscarAgendamentoImportadoPorId,
    buscarHorarios = listarHorariosDisponiveis,
  } = {}
) {
  const origem = origemSegura(req.params.origem);
  if (!origem) return res.status(404).send("Agendamento não encontrado.");
  const agendamentoId = idSeguro(req.params.id);
  if (!agendamentoId) return res.status(404).send("Agendamento não encontrado.");

  const buscarAgendamento = origem === "importado" ? buscarAgendamentoImportado : buscarAgendamentoBot;
  const agendamento = await buscarAgendamento(agendamentoId);
  if (!agendamento || agendamento.status !== "confirmado" || agendamento.ja_passou) {
    return res.status(404).send("Agendamento não encontrado ou não pode mais ser remarcado.");
  }

  const dataEscolhida = validarData(req.query.data) ? req.query.data : null;
  const horarios = dataEscolhida
    ? await buscarHorarios({
        data: dataEscolhida,
        tipoAtendimento: agendamento.tipo_atendimento,
        amostrar: false,
      })
    : [];

  res.render("agendamentos/remarcar", { agendamento: { ...agendamento, origem }, dataEscolhida, horarios });
}

export async function processarRemarcarAgendamento(
  req,
  res,
  {
    buscarAgendamentoBot = buscarAgendamentoComPacientePorId,
    buscarAgendamentoImportado = buscarAgendamentoImportadoPorId,
    executarRemarcacaoBot = remarcarConsulta,
    executarRemarcacaoImportado = remarcarConsultaImportada,
  } = {}
) {
  const origem = origemSegura(req.params.origem);
  if (!origem) return res.status(404).send("Agendamento não encontrado.");
  const agendamentoId = idSeguro(req.params.id);
  if (!agendamentoId) return res.status(404).send("Agendamento não encontrado.");

  const { data: novaData, hora: novaHora } = req.body ?? {};
  if (!validarData(novaData) || !validarHora(novaHora)) {
    return res.status(400).send("Data ou hora inválida.");
  }

  const buscarAgendamento = origem === "importado" ? buscarAgendamentoImportado : buscarAgendamentoBot;
  const agendamento = await buscarAgendamento(agendamentoId);
  if (!agendamento || agendamento.status !== "confirmado" || agendamento.ja_passou) {
    return res.status(404).send("Agendamento não encontrado ou não pode mais ser remarcado.");
  }

  const executarRemarcacao = origem === "importado" ? executarRemarcacaoImportado : executarRemarcacaoBot;
  try {
    await executarRemarcacao({ agendamento, novaData, novaHora });
  } catch (err) {
    const mensagem = MENSAGEM_ERRO_REMARCACAO[err.codigo];
    if (mensagem) return res.status(400).send(mensagem);
    throw err;
  }

  res.redirect("/agendamentos");
}

export async function telaNovoAgendamento(
  req,
  res,
  {
    listarPsicologos = listarPsicologosPadrao,
    listarFisioterapeutas = listarFisioterapeutasPadrao,
    listarConvenios = listarConveniosPadrao,
  } = {}
) {
  const [psicologos, fisioterapeutas, convenios] = await Promise.all([
    listarPsicologos(),
    listarFisioterapeutas(),
    listarConvenios(),
  ]);
  const tipoAtendimentoQuery = req.query?.tipo_atendimento;
  const tipoAtendimentoInicial = validarTipoAtendimento(tipoAtendimentoQuery) ? tipoAtendimentoQuery : null;
  const voltarPara = tipoAtendimentoInicial === "psicologia" ? "/psicologia" : "/agendamentos";
  res.render("agendamentos/novo", {
    erro: null,
    psicologos,
    fisioterapeutas,
    convenios,
    tipoAtendimentoInicial,
    voltarPara,
  });
}

// Teto de sessões numa série recorrente — mesmo espírito das outras
// constantes de segurança do projeto (LIMITE_MAXIMO em paginacao.js):
// 52 semanas cobre um ano inteiro de sessões semanais, bem além de
// qualquer tratamento real, sem abrir espaço pra um valor absurdo criar
// centenas de agendamentos de uma vez.
const MAX_SESSOES_SERIE = 52;

export async function processarNovoAgendamento(
  req,
  res,
  {
    buscarPacientePorId = buscarPacientePorIdPadrao,
    encontrarOuCriarPaciente = encontrarOuCriarPacientePadrao,
    validarDisponibilidade = validarDisponibilidadeAgendamento,
    inserirAgendamentoNoBanco = inserirAgendamentoNoBancoPadrao,
  } = {}
) {
  const {
    data,
    hora,
    tipo_atendimento: tipoAtendimento,
    paciente_id: pacienteIdBruto,
    repetir_semanalmente: repetirBruto,
    quantidade_sessoes: quantidadeBruta,
    psicologo_id: psicologoIdBruto,
    fisioterapeuta_id: fisioterapeutaIdBruto,
    datas_extras_data: datasExtrasDataBruto,
    datas_extras_hora: datasExtrasHoraBruto,
  } = req.body ?? {};

  if (!validarData(data) || !validarHora(hora)) {
    return res.status(400).send("Data ou hora inválida.");
  }
  if (!validarTipoAtendimento(tipoAtendimento)) {
    return res.status(400).send("Tipo de atendimento inválido.");
  }
  // Psicóloga é um dado só de Psicologia, fisioterapeuta só de Fisioterapia
  // — mesmo se vier no corpo (ex: formulário manipulado), cada tipo só
  // grava o profissional que faz sentido pra ele.
  const psicologoId = tipoAtendimento === "psicologia" ? idSeguro(psicologoIdBruto) : null;
  const fisioterapeutaId = tipoAtendimento === "fisioterapia" ? idSeguro(fisioterapeutaIdBruto) : null;

  let paciente;
  const pacienteId = idSeguro(pacienteIdBruto);
  if (pacienteId) {
    paciente = await buscarPacientePorId(pacienteId);
    if (!paciente) return res.status(404).send("Paciente não encontrado.");
  } else {
    const nomeNovo = req.body?.paciente_novo_nome?.trim();
    const telefoneNovo = normalizarTelefoneComDDI(req.body?.paciente_novo_telefone);
    if (!nomeNovo || !telefoneNovo) {
      return res.status(400).send("Selecione um paciente existente ou informe nome e telefone de um paciente novo.");
    }
    const convenioIdNovo = idSeguro(req.body?.paciente_novo_convenio_id);
    paciente = await encontrarOuCriarPaciente({
      nome: nomeNovo,
      telefone: telefoneNovo,
      convenio: null,
      convenioId: convenioIdNovo,
    });
  }

  const repetirSemanalmente = repetirBruto === "on" || repetirBruto === "true" || repetirBruto === true;
  if (repetirSemanalmente) {
    const quantidadeSessoes = Math.min(
      Math.max(parseInt(quantidadeBruta, 10) || 0, 2),
      MAX_SESSOES_SERIE
    );

    const resultados = [];
    for (let indice = 0; indice < quantidadeSessoes; indice++) {
      const dataSessao = dayjs(data).add(indice * 7, "day").format("YYYY-MM-DD");

      try {
        await validarDisponibilidade({ data: dataSessao, hora, tipoAtendimento, ignorarLimiteDias: true });
      } catch (err) {
        const mensagem = MENSAGEM_ERRO_REMARCACAO[err.codigo];
        if (!mensagem) throw err;
        resultados.push({ data: dataSessao, hora, criado: false, motivo: mensagem });
        continue;
      }

      try {
        const agendamentoGravado = await inserirAgendamentoNoBanco({
          pacienteId: paciente.id,
          data: dataSessao,
          hora,
          tipoAtendimento,
          status: "confirmado",
          criadoPorUsuarioId: req.usuarioAtual.id,
          psicologoId,
          fisioterapeutaId,
        });
        resultados.push({ data: dataSessao, hora, criado: true, id: agendamentoGravado.id });
      } catch (err) {
        capturarErro("[dashboardController] Falha ao gravar sessão da série:", err);
        resultados.push({
          data: dataSessao,
          hora,
          criado: false,
          motivo: MENSAGEM_ERRO_REMARCACAO[err.codigo] ?? "Não foi possível concluir por um problema técnico.",
        });
      }
    }

    return res.render("agendamentos/serie-resultado", {
      paciente,
      tipoAtendimento,
      resultados,
    });
  }

  // Alternativa à repetição semanal: sessões avulsas do mesmo paciente, cada
  // uma com sua própria data e horário (ex: uma consulta terça 09h e outra
  // quinta 15h) — em vez de uma série automática no mesmo dia da semana e
  // horário. req.body chega com extended:false (querystring puro), então um
  // campo repetido vira array só a partir da 2ª ocorrência; normaliza pra
  // array sempre. Linhas em branco (usuário clicou "adicionar" mas não
  // preencheu) são ignoradas silenciosamente.
  const datasExtras = [].concat(datasExtrasDataBruto ?? []);
  const horasExtras = [].concat(datasExtrasHoraBruto ?? []);
  const sessoesAvulsas = datasExtras
    .map((dataExtra, indice) => ({ data: dataExtra?.trim(), hora: horasExtras[indice]?.trim() }))
    .filter((sessao) => sessao.data && sessao.hora);

  if (sessoesAvulsas.length > 0) {
    const sessoes = [{ data, hora }, ...sessoesAvulsas];
    const resultados = [];

    for (const sessao of sessoes) {
      if (!validarData(sessao.data) || !validarHora(sessao.hora)) {
        resultados.push({ data: sessao.data, hora: sessao.hora, criado: false, motivo: "Data ou hora inválida." });
        continue;
      }

      try {
        await validarDisponibilidade({ data: sessao.data, hora: sessao.hora, tipoAtendimento, ignorarLimiteDias: true });
      } catch (err) {
        const mensagem = MENSAGEM_ERRO_REMARCACAO[err.codigo];
        if (!mensagem) throw err;
        resultados.push({ data: sessao.data, hora: sessao.hora, criado: false, motivo: mensagem });
        continue;
      }

      try {
        const agendamentoGravado = await inserirAgendamentoNoBanco({
          pacienteId: paciente.id,
          data: sessao.data,
          hora: sessao.hora,
          tipoAtendimento,
          status: "confirmado",
          criadoPorUsuarioId: req.usuarioAtual.id,
          psicologoId,
          fisioterapeutaId,
        });
        resultados.push({ data: sessao.data, hora: sessao.hora, criado: true, id: agendamentoGravado.id });
      } catch (err) {
        capturarErro("[dashboardController] Falha ao gravar sessão avulsa:", err);
        resultados.push({
          data: sessao.data,
          hora: sessao.hora,
          criado: false,
          motivo: MENSAGEM_ERRO_REMARCACAO[err.codigo] ?? "Não foi possível concluir por um problema técnico.",
        });
      }
    }

    return res.render("agendamentos/serie-resultado", {
      paciente,
      tipoAtendimento,
      resultados,
    });
  }

  try {
    await validarDisponibilidade({ data, hora, tipoAtendimento });
  } catch (err) {
    const mensagem = MENSAGEM_ERRO_REMARCACAO[err.codigo];
    if (mensagem) return res.status(400).send(mensagem);
    throw err;
  }

  try {
    await inserirAgendamentoNoBanco({
      pacienteId: paciente.id,
      data,
      hora,
      tipoAtendimento,
      status: "confirmado",
      criadoPorUsuarioId: req.usuarioAtual.id,
      psicologoId,
      fisioterapeutaId,
    });
  } catch (err) {
    capturarErro("[dashboardController] Falha ao gravar agendamento manual:", err);
    const mensagem = MENSAGEM_ERRO_REMARCACAO[err.codigo];
    return res
      .status(mensagem ? 400 : 500)
      .send(mensagem ?? "Não foi possível concluir o agendamento por um problema técnico. Tente novamente.");
  }

  res.redirect("/agendamentos");
}

export async function buscarPacientesJson(req, res, { buscarPacientes = buscarPacientesPorNomeOuTelefone } = {}) {
  const termo = typeof req.query.q === "string" ? req.query.q : "";
  const resultados = await buscarPacientes(termo);
  res.json(resultados);
}

/**
 * Resumo do histórico de agendamentos do paciente pro painel lateral da tela
 * de Novo agendamento — inspirado no painel "Últimos atendimentos" /
 * "Agendamentos futuros" do sistema de agenda anterior, que a equipe já usava pra
 * decidir o agendamento sem precisar abrir outra tela. listarHistoricoPaciente
 * já devolve até 50 linhas (bot/manual, não importado) ordenadas por data
 * DESC; aqui só separa em futuros (data >= hoje) e recentes (passados),
 * limitando cada lado a 5 pra caber num painel pequeno.
 */
export async function buscarHistoricoResumoPacienteJson(
  req,
  res,
  { buscarHistorico = listarHistoricoPaciente } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  if (!pacienteId) return res.status(404).json({ erro: "Paciente não encontrado." });

  const historico = await buscarHistorico(pacienteId);
  const hoje = dayjs().tz(CLINICA.timezone).format("YYYY-MM-DD");
  const futuros = historico.filter((h) => h.data >= hoje).slice(-5).reverse();
  const recentes = historico.filter((h) => h.data < hoje).slice(0, 5);

  res.json({ futuros, recentes });
}

export async function telaEditarAgendamento(
  req,
  res,
  {
    buscarAgendamentoBot = buscarAgendamentoComPacientePorId,
    buscarAgendamentoImportado = buscarAgendamentoImportadoPorId,
    listarPsicologos = listarPsicologosPadrao,
    listarFisioterapeutas = listarFisioterapeutasPadrao,
  } = {}
) {
  const origem = origemSegura(req.params.origem);
  if (!origem) return res.status(404).send("Agendamento não encontrado.");
  const agendamentoId = idSeguro(req.params.id);
  if (!agendamentoId) return res.status(404).send("Agendamento não encontrado.");

  const buscarAgendamento = origem === "importado" ? buscarAgendamentoImportado : buscarAgendamentoBot;
  const [agendamento, psicologos, fisioterapeutas] = await Promise.all([
    buscarAgendamento(agendamentoId),
    listarPsicologos(),
    listarFisioterapeutas(),
  ]);
  // Diferente de Remarcar (que só faz sentido pra consulta futura ainda
  // aguardando), Editar corrige dados cadastrais do agendamento (paciente,
  // tipo, data/hora digitada errada) — inclusive de consultas que já
  // passaram ou já têm presença marcada, já que erro de digitação não
  // escolhe status (pedido real da recepção: corrigir agendamentos
  // importados do sistema de agenda anterior com data/paciente errados mesmo depois
  // de já terem acontecido).
  if (!agendamento) {
    return res.status(404).send("Agendamento não encontrado.");
  }

  res.render("agendamentos/editar", {
    agendamento: { ...agendamento, hora: String(agendamento.hora).slice(0, 5), origem },
    psicologos,
    fisioterapeutas,
    erro: null,
  });
}

export async function processarEditarAgendamento(
  req,
  res,
  {
    buscarAgendamentoBot = buscarAgendamentoComPacientePorId,
    buscarAgendamentoImportado = buscarAgendamentoImportadoPorId,
    buscarPacientePorId = buscarPacientePorIdPadrao,
    executarEdicaoBot = editarConsulta,
    executarEdicaoImportado = editarConsultaImportada,
  } = {}
) {
  const origem = origemSegura(req.params.origem);
  if (!origem) return res.status(404).send("Agendamento não encontrado.");
  const agendamentoId = idSeguro(req.params.id);
  if (!agendamentoId) return res.status(404).send("Agendamento não encontrado.");

  const {
    data: novaData,
    hora: novaHora,
    tipo_atendimento: novoTipoAtendimento,
    psicologo_id: psicologoIdBruto,
    fisioterapeuta_id: fisioterapeutaIdBruto,
  } = req.body ?? {};
  if (!validarData(novaData) || !validarHora(novaHora) || !validarTipoAtendimento(novoTipoAtendimento)) {
    return res.status(400).send("Dados inválidos.");
  }
  const novoPsicologoId = novoTipoAtendimento === "psicologia" ? idSeguro(psicologoIdBruto) : null;
  const novoFisioterapeutaId = novoTipoAtendimento === "fisioterapia" ? idSeguro(fisioterapeutaIdBruto) : null;

  const buscarAgendamento = origem === "importado" ? buscarAgendamentoImportado : buscarAgendamentoBot;
  const agendamento = await buscarAgendamento(agendamentoId);
  if (!agendamento) {
    return res.status(404).send("Agendamento não encontrado.");
  }

  try {
    if (origem === "importado") {
      const novoNome = req.body?.paciente_nome?.trim();
      const novoTelefone = normalizarTelefoneComDDI(req.body?.paciente_telefone);
      if (!novoNome || !novoTelefone) {
        return res.status(400).send("Nome ou telefone do paciente inválido.");
      }
      await executarEdicaoImportado({
        agendamento,
        novoNome,
        novoTelefone,
        novoTipoAtendimento,
        novaData,
        novaHora,
        novoPsicologoId,
        novoFisioterapeutaId,
        usuarioId: req.usuarioAtual.id,
      });
    } else {
      const pacienteId = idSeguro(req.body?.paciente_id);
      if (!pacienteId) return res.status(400).send("Selecione um paciente.");
      const paciente = await buscarPacientePorId(pacienteId);
      if (!paciente) return res.status(404).send("Paciente não encontrado.");

      await executarEdicaoBot({
        agendamento,
        novoPacienteId: paciente.id,
        novaData,
        novaHora,
        novoTipoAtendimento,
        novoPsicologoId,
        novoFisioterapeutaId,
        usuarioId: req.usuarioAtual.id,
      });
    }
  } catch (err) {
    const mensagem = MENSAGEM_ERRO_REMARCACAO[err.codigo];
    if (mensagem) return res.status(400).send(mensagem);
    throw err;
  }

  res.redirect("/agendamentos");
}

const MENSAGEM_RESULTADO_EXCLUSAO_PACIENTE = {
  excluido: "Paciente excluído.",
  arquivado: "Paciente tinha histórico registrado (consulta, pagamento ou pacote) e foi arquivado em vez de excluído — o histórico continua intacto, só saiu das listas e da busca.",
};

export async function telaPacientes(req, res, { listarPacientes = listarPacientesPadrao } = {}) {
  const { limite, offset, resultado, busca, avaliacao } = req.query;
  const limiteAtual = limiteSeguroListagem(limite);
  const offsetAtual = offsetSeguroListagem(offset);
  const pacientes = await listarPacientes({ limite: limiteAtual, offset: offsetAtual, busca, avaliacao });
  res.render("pacientes/lista", {
    pacientes,
    limiteAtual,
    offsetAtual,
    busca: busca ?? "",
    avaliacao: avaliacao ?? "",
    temProximaPagina: pacientes.length === limiteAtual,
    mensagemExclusao: MENSAGEM_RESULTADO_EXCLUSAO_PACIENTE[resultado] ?? null,
  });
}

export async function telaFichaPaciente(
  req,
  res,
  {
    buscarPaciente = buscarPacientePorIdPadrao,
    buscarHistorico = listarHistoricoPaciente,
    buscarPacotes = listarPacotesPaciente,
    buscarAvaliacoes = listarAvaliacoesPaciente,
    buscarRelatorios = listarRelatoriosPaciente,
  } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  if (!pacienteId) return res.status(404).send("Paciente não encontrado.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  const [historico, pacotes, avaliacoes, relatorios] = await Promise.all([
    buscarHistorico(pacienteId),
    buscarPacotes(pacienteId),
    buscarAvaliacoes(pacienteId),
    buscarRelatorios(pacienteId),
  ]);

  const idade = paciente.data_nascimento
    ? dayjs().diff(dayjs(paciente.data_nascimento), "year")
    : null;

  res.render("pacientes/ficha", {
    paciente,
    historico,
    pacotes,
    avaliacoes,
    relatorios,
    idade,
    autoImprimir: req.query?.imprimir === "1",
  });
}

/**
 * Restrita à administradora na rota (exigirPapel), mesma regra de estornar
 * pagamento e gerenciar usuários. excluirOuArquivarPaciente já decide no
 * banco entre excluir de verdade (sem histórico) e arquivar (ativo = false,
 * preserva tudo — ver comentário lá) — aqui só traduz o resultado pra uma
 * resposta HTTP, com a mensagem certa pra cada caso.
 */
export async function processarExcluirPaciente(
  req,
  res,
  { excluirOuArquivarPacienteFn = excluirOuArquivarPacientePadrao } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  if (!pacienteId) return res.status(404).send("Paciente não encontrado.");

  const resultado = await excluirOuArquivarPacienteFn(pacienteId);
  if (!resultado) return res.status(404).send("Paciente não encontrado.");

  res.redirect(`/pacientes?resultado=${resultado}`);
}

export function telaNovoPaciente(req, res) {
  res.render("pacientes/novo", {
    erro: null,
    pacienteExistente: null,
    nome: "",
    telefone: "",
    tipoConvenio: "particular",
    convenioTexto: "",
  });
}

/**
 * Ao contrário do fluxo do bot (encontrarOuCriarPaciente reaproveita
 * silenciosamente um paciente já existente com o mesmo telefone), aqui a
 * recepção está cadastrando alguém de propósito — reaproveitar sem avisar
 * arriscaria vincular por engano ao paciente errado. Por isso a checagem
 * explícita antes de criar, com erro + link pra ficha do já existente.
 *
 * Convênio é texto livre (não o convenio_id estruturado da tela de editar)
 * — decisão do usuário: cadastro rápido não deve travar em o convênio já
 * estar credenciado/cadastrado na tabela convenios (ver casos Nipomed/Cabesp
 * tratados na mesma sessão).
 */
export async function processarNovoPaciente(
  req,
  res,
  {
    buscarPacientePorTelefoneFn = buscarPacientePorTelefonePadrao,
    criarPaciente = encontrarOuCriarPacientePadrao,
  } = {}
) {
  const nome = String(req.body?.nome ?? "").trim();
  const telefone = normalizarTelefoneComDDI(req.body?.telefone);
  const tipoConvenio = req.body?.tipo_convenio === "convenio" ? "convenio" : "particular";
  const convenioTexto = String(req.body?.convenio_texto ?? "").trim();

  function reexibirComErro({ erro, pacienteExistente = null }) {
    res.status(400).render("pacientes/novo", {
      erro,
      pacienteExistente,
      nome,
      telefone: req.body?.telefone ?? "",
      tipoConvenio,
      convenioTexto,
    });
  }

  if (!nome) return reexibirComErro({ erro: "Informe o nome do paciente." });
  if (!telefone) {
    return reexibirComErro({
      erro: "Telefone inválido — informe DDD + número (com ou sem o 55 na frente).",
    });
  }
  if (tipoConvenio === "convenio" && !convenioTexto) {
    return reexibirComErro({ erro: "Informe o nome do convênio, ou selecione Particular." });
  }

  const existente = await buscarPacientePorTelefoneFn(telefone);
  if (existente) {
    return reexibirComErro({
      erro: "Já existe um paciente cadastrado com esse telefone.",
      pacienteExistente: existente,
    });
  }

  const convenio = tipoConvenio === "convenio" ? convenioTexto : "Particular";
  const paciente = await criarPaciente({ nome, telefone, convenio, convenioId: null });
  res.redirect(`/pacientes/${paciente.id}/ficha`);
}

export async function telaEditarPaciente(
  req,
  res,
  { buscarPaciente = buscarPacientePorIdPadrao, listarConvenios = listarConveniosPadrao } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  if (!pacienteId) return res.status(404).send("Paciente não encontrado.");

  const [paciente, convenios] = await Promise.all([buscarPaciente(pacienteId), listarConvenios()]);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  res.render("pacientes/editar", { paciente, convenios });
}

function campoOuNull(valor) {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

export async function processarEditarPaciente(
  req,
  res,
  { buscarPaciente = buscarPacientePorIdPadrao, atualizarPaciente = atualizarDadosPaciente } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  if (!pacienteId) return res.status(404).send("Paciente não encontrado.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  const body = req.body ?? {};
  const dataNascimento = campoOuNull(body.data_nascimento);
  if (dataNascimento && !validarData(dataNascimento)) {
    return res.status(400).send("Data de nascimento inválida.");
  }

  await atualizarPaciente(pacienteId, {
    convenioId: idSeguro(body.convenio_id),
    cpf: campoOuNull(body.cpf),
    dataNascimento,
    rg: campoOuNull(body.rg),
    endereco: campoOuNull(body.endereco),
    numero: campoOuNull(body.numero),
    bairro: campoOuNull(body.bairro),
    cidade: campoOuNull(body.cidade),
    uf: campoOuNull(body.uf),
    cep: campoOuNull(body.cep),
    estadoCivil: campoOuNull(body.estado_civil),
    sexo: campoOuNull(body.sexo),
    profissao: campoOuNull(body.profissao),
    email: campoOuNull(body.email),
    matriculaConvenio: campoOuNull(body.matricula_convenio),
    cns: campoOuNull(body.cns),
    observacao: campoOuNull(body.observacao),
  });

  res.redirect(`/pacientes/${pacienteId}/ficha`);
}

// Compartilhado entre telaControleSessoes (cartão pra imprimir) e
// processarEnviarControleSessoes (PDF pro WhatsApp) — o número de linhas
// acompanha a quantidade_total do pacote ativo do paciente (pacotes podem
// ter mais de 10 sessões, sem teto — ver QUANTIDADE_MINIMA_PACOTE em
// pacoteSessaoModel.js), caindo pro mínimo de dez quando não há pacote ativo
// (paciente ainda sem pacote formal). Linhas sem sessão real ficam em branco
// (paciente ainda no início do pacote, por exemplo).
const LINHAS_MINIMAS_CONTROLE_SESSOES = 10;
// Teto puramente prático (imprimir/exibir) — não tem relação com o teto de
// sessões de uma série recorrente (MAX_SESSOES_SERIE) nem com pacote de
// sessões, que não tem teto (ver pacoteSessaoModel.js).
const LINHAS_MAXIMAS_CONTROLE_SESSOES = 60;

function totalLinhasControleSessoes(pacotes, sessoesExistentes) {
  const pacoteAtivo = pacotes.find((p) => !p.cancelado && p.quantidade_usada < p.quantidade_total);
  return Math.max(LINHAS_MINIMAS_CONTROLE_SESSOES, pacoteAtivo?.quantidade_total ?? 0, sessoesExistentes.length);
}

// Recepção pode sobrepor o número calculado automaticamente (?linhas=N),
// por exemplo pra imprimir um controle maior antes de vender oficialmente
// o próximo pacote. Fora da faixa 1..60 ou não numérico: ignorado, cai no
// cálculo automático (nunca 404/500 por causa de um query param ruim).
function linhasPersonalizadasSeguras(valorBruto) {
  if (valorBruto === undefined || valorBruto === null || valorBruto === "") return null;
  const texto = String(valorBruto);
  if (!/^\d+$/.test(texto)) return null;
  const numero = Number(texto);
  if (!Number.isSafeInteger(numero) || numero < 1 || numero > LINHAS_MAXIMAS_CONTROLE_SESSOES) return null;
  return numero;
}

function montarLinhasControleSessoes(sessoesExistentes, totalLinhas = LINHAS_MINIMAS_CONTROLE_SESSOES) {
  return Array.from({ length: totalLinhas }, (_, indice) => ({
    numero: indice + 1,
    data: sessoesExistentes[indice]?.data ?? null,
    hora: sessoesExistentes[indice]?.hora ?? null,
    status: sessoesExistentes[indice]?.status ?? null,
  }));
}

export async function telaControleSessoes(
  req,
  res,
  {
    buscarPaciente = buscarPacientePorIdPadrao,
    buscarSessoes = listarSessoesFisioterapiaPaciente,
    buscarAvaliacoes = listarAvaliacoesPaciente,
    buscarPacotes = listarPacotesPaciente,
  } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  if (!pacienteId) return res.status(404).send("Paciente não encontrado.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  const sessoesExistentes = await buscarSessoes(pacienteId);
  const avaliacoes = await buscarAvaliacoes(pacienteId);
  const pacotes = await buscarPacotes(pacienteId);
  const totalAutomatico = totalLinhasControleSessoes(pacotes, sessoesExistentes);
  const totalLinhas = linhasPersonalizadasSeguras(req.query?.linhas) ?? totalAutomatico;
  res.render("pacientes/controle-sessoes", {
    paciente,
    sessoes: montarLinhasControleSessoes(sessoesExistentes, totalLinhas),
    totalLinhas,
    totalAutomatico,
    dataAvaliacao: avaliacoes[0]?.dataAvaliacao ?? null,
    mensagemWhatsapp: req.query?.whatsapp === "enviado" ? "Controle de sessões enviado por WhatsApp." : null,
  });
}

/**
 * Alternativa ao cartão impresso — manda o mesmo controle como mensagem de
 * texto pro WhatsApp do paciente, pra quando a recepção não quiser imprimir
 * (decisão do usuário, 2026-09-04; texto em vez de PDF/documento anexado,
 * decisão do usuário, 2026-09-14).
 */
export async function processarEnviarControleSessoes(
  req,
  res,
  {
    buscarPaciente = buscarPacientePorIdPadrao,
    buscarSessoes = listarSessoesFisioterapiaPaciente,
    buscarAvaliacoes = listarAvaliacoesPaciente,
    enviarMensagemFn = enviarMensagem,
  } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  if (!pacienteId) return res.status(404).send("Paciente não encontrado.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  const sessoesExistentes = await buscarSessoes(pacienteId);
  const avaliacoes = await buscarAvaliacoes(pacienteId);
  const mensagem = montarMensagemControleSessoes({
    paciente,
    sessoes: montarLinhasControleSessoes(sessoesExistentes),
    dataAvaliacao: avaliacoes[0]?.dataAvaliacao ?? null,
  });

  try {
    await enviarMensagemFn(paciente.telefone, mensagem);
  } catch (err) {
    capturarErro("[dashboardController] Falha ao enviar controle de sessões por WhatsApp:", err);
    return res
      .status(500)
      .send("Não foi possível enviar o controle de sessões por WhatsApp. Tente novamente.");
  }

  res.redirect(`/pacientes/${pacienteId}/controle-sessoes?whatsapp=enviado`);
}

export async function processarCriarPacote(req, res) {
  const pacienteId = idSeguro(req.params.id);
  if (!pacienteId) return res.status(404).send("Paciente não encontrado.");

  const resultado = await criarPacote({
    pacienteId,
    quantidadeTotal: req.body?.quantidade_total,
    criadoPor: req.usuarioAtual.id,
  });

  if (resultado.motivo === "quantidade_invalida") {
    return res
      .status(400)
      .send("Quantidade de sessões inválida — informe um número inteiro de pelo menos 10.");
  }
  if (resultado.motivo === "pacote_ativo_existente") {
    return res
      .status(409)
      .send("Este paciente já tem um pacote ativo — cancele o atual antes de criar outro.");
  }
  res.redirect(`/pacientes/${pacienteId}/ficha`);
}

export async function processarCancelarPacote(req, res) {
  const pacienteId = idSeguro(req.params.id);
  if (!pacienteId) return res.status(404).send("Paciente não encontrado.");

  const pacoteId = idSeguro(req.params.pacoteId);
  if (!pacoteId) return res.status(404).send("Pacote não encontrado.");

  const cancelado = await cancelarPacote(pacoteId, pacienteId);
  if (!cancelado) return res.status(404).send("Pacote não encontrado ou já cancelado.");

  res.redirect(`/pacientes/${pacienteId}/ficha`);
}

const PRESENCA_VALIDA = ["compareceu", "faltou"];

function mensagemErroPresenca(motivo) {
  switch (motivo) {
    case "cancelado":
      return "Esse agendamento foi cancelado, não é possível registrar presença.";
    case "conflito":
      return "Esse agendamento já foi atualizado por outra pessoa — recarregue a página e tente de novo.";
    default:
      return "Não foi possível registrar a presença.";
  }
}

// Pra onde voltar depois de registrar presença (individual ou em lote) sem
// perder o filtro/página em que a recepção estava. `retorno_url` vem de um
// campo hidden montado pela própria view (agendamentos/lista.ejs) com a URL
// atual — só aceita caminho relativo começando com /agendamentos e sem "//"
// no início (protocolo-relativo), pra nunca virar um redirect pra fora do
// próprio site a partir de um valor de formulário.
function urlRetornoPresenca(req) {
  const bruto = req.body?.retorno_url;
  const prefixoPermitido = typeof bruto === "string" && (bruto.startsWith("/agendamentos") || bruto === "/hoje" || bruto.startsWith("/hoje?"));
  if (prefixoPermitido && !bruto.startsWith("//")) {
    return bruto;
  }
  return "/agendamentos";
}

function comMensagemPresenca(url, mensagem) {
  const separador = url.includes("?") ? "&" : "?";
  return `${url}${separador}presenca_msg=${encodeURIComponent(mensagem)}`;
}

// Só dispara na primeira transição pra "compareceu" (nunca numa correção que
// já estava compareceu, nem em "faltou") — ver tentarGerarPagamentoAutomatico
// em pagamentoModel.js pra quando ele de fato gera algo. Nunca deixa uma
// falha aqui quebrar a resposta: a presença já foi registrada com sucesso
// antes desta chamada; o pagamento automático é conveniência, não pode virar
// 500 pro usuário que só queria marcar presença.
async function tentarGerarPagamentoAutomaticoSeElegivel({
  origem,
  agendamentoId = null,
  agendamentoImportadoId = null,
  presenca,
  jaEstavaCompareceu,
  registradoPor,
}) {
  if (presenca !== "compareceu" || jaEstavaCompareceu) return;
  try {
    await tentarGerarPagamentoAutomatico({ origem, agendamentoId, agendamentoImportadoId, registradoPor });
  } catch (err) {
    capturarErro("[dashboardController] Falha ao gerar pagamento automático ao marcar presença:", err);
  }
}

export async function processarPresencaAgendamento(req, res) {
  const { presenca, observacao_sessao, profissional_responsavel } = req.body ?? {};
  if (!PRESENCA_VALIDA.includes(presenca)) {
    return res.status(400).send("Presença inválida — use compareceu ou faltou.");
  }

  const agendamentoId = idSeguro(req.params.id);
  if (!agendamentoId) {
    return res.status(404).send("Agendamento não encontrado.");
  }

  const jaEstavaCompareceu = (await buscarPresencaAtual({ agendamentoId })) === "compareceu";

  const resultado = await registrarPresencaBot({
    agendamentoId,
    presenca,
    observacaoSessao: observacao_sessao?.trim() || null,
    profissionalResponsavel: profissional_responsavel?.trim() || null,
    registradoPor: req.usuarioAtual.id,
  });

  if (resultado.motivo === "nao_encontrado") {
    return res.status(404).send("Agendamento não encontrado.");
  }
  if (resultado.motivo) {
    const status = resultado.motivo === "conflito" ? 409 : 400;
    return res.status(status).send(mensagemErroPresenca(resultado.motivo));
  }
  await tentarGerarPagamentoAutomaticoSeElegivel({ origem: "bot", agendamentoId, presenca, jaEstavaCompareceu, registradoPor: req.usuarioAtual.id });
  if (req.body?.retorno === "hoje") return res.redirect("/hoje?sucesso=1");
  res.redirect(comMensagemPresenca(urlRetornoPresenca(req), "Presença registrada."));
}

export async function processarPresencaImportado(req, res) {
  const { presenca, observacao_sessao, profissional_responsavel } = req.body ?? {};
  if (!PRESENCA_VALIDA.includes(presenca)) {
    return res.status(400).send("Presença inválida — use compareceu ou faltou.");
  }

  const agendamentoImportadoId = idSeguro(req.params.id);
  if (!agendamentoImportadoId) {
    return res.status(404).send("Agendamento não encontrado.");
  }

  const jaEstavaCompareceu = (await buscarPresencaAtual({ agendamentoImportadoId })) === "compareceu";

  const resultado = await registrarPresencaImportado({
    agendamentoImportadoId,
    presenca,
    observacaoSessao: observacao_sessao?.trim() || null,
    profissionalResponsavel: profissional_responsavel?.trim() || null,
    registradoPor: req.usuarioAtual.id,
  });

  if (resultado.motivo === "nao_encontrado") {
    return res.status(404).send("Agendamento não encontrado.");
  }
  if (resultado.motivo) {
    return res.status(400).send(mensagemErroPresenca(resultado.motivo));
  }
  await tentarGerarPagamentoAutomaticoSeElegivel({ origem: "importado", agendamentoImportadoId, presenca, jaEstavaCompareceu, registradoPor: req.usuarioAtual.id });
  if (req.body?.retorno === "hoje") return res.redirect("/hoje?sucesso=1");
  res.redirect(comMensagemPresenca(urlRetornoPresenca(req), "Presença registrada."));
}

function motivoErroPresencaCurto(motivo) {
  switch (motivo) {
    case "cancelado":
      return "cancelado";
    case "conflito":
      return "atualizado por outra pessoa";
    case "nao_encontrado":
      return "não encontrado";
    default:
      return "erro";
  }
}

/**
 * Marca presença de vários agendamentos de uma vez (checkbox por linha em
 * agendamentos/lista.ejs, ver `itens`). Reaproveita os mesmos models de
 * presença individual — cada item continua sendo sua própria transação
 * (mesmo padrão de registrarPresencaBot/Importado), só chamados em série
 * aqui; não é uma transação única pro lote inteiro, então um item que falhe
 * (ex: cancelado nesse meio-tempo) não desfaz os outros já registrados.
 * Formato de cada entrada de `itens`: "bot:42" ou "importado:17" (origem e
 * id separados por dois-pontos) — entradas mal-formadas são ignoradas em
 * vez de derrubar o lote inteiro.
 */
export async function processarPresencaLote(req, res) {
  const { presenca, itens } = req.body ?? {};
  if (!PRESENCA_VALIDA.includes(presenca)) {
    return res.status(400).send("Presença inválida — use compareceu ou faltou.");
  }

  const brutos = Array.isArray(itens) ? itens : itens ? [itens] : [];
  const parseados = brutos
    .map((bruto) => {
      const [origem, idBruto] = String(bruto).split(":");
      const id = idSeguro(idBruto);
      if ((origem !== "bot" && origem !== "importado") || !id) return null;
      return { origem, id };
    })
    .filter((item) => item !== null);

  if (parseados.length === 0) {
    // Engano comum (clicar em "Compareceu"/"Faltou" sem marcar nenhuma
    // linha) — volta pra mesma página com aviso em vez de uma página de
    // erro crua, pra não atrapalhar quem tá na recepção no meio do fluxo.
    return res.redirect(comMensagemPresenca(urlRetornoPresenca(req), "Selecione ao menos um agendamento antes de marcar presença."));
  }

  let sucesso = 0;
  const falhas = [];
  for (const { origem, id } of parseados) {
    const jaEstavaCompareceu =
      (await buscarPresencaAtual(
        origem === "bot" ? { agendamentoId: id } : { agendamentoImportadoId: id }
      )) === "compareceu";
    const resultado =
      origem === "bot"
        ? await registrarPresencaBot({
            agendamentoId: id,
            presenca,
            observacaoSessao: null,
            profissionalResponsavel: null,
            registradoPor: req.usuarioAtual.id,
          })
        : await registrarPresencaImportado({
            agendamentoImportadoId: id,
            presenca,
            observacaoSessao: null,
            profissionalResponsavel: null,
            registradoPor: req.usuarioAtual.id,
          });

    if (resultado.motivo) {
      falhas.push(resultado.motivo);
    } else {
      sucesso += 1;
      await tentarGerarPagamentoAutomaticoSeElegivel({
        origem,
        agendamentoId: origem === "bot" ? id : null,
        agendamentoImportadoId: origem === "importado" ? id : null,
        presenca,
        jaEstavaCompareceu,
        registradoPor: req.usuarioAtual.id,
      });
    }
  }

  const partes = [];
  if (sucesso > 0) {
    partes.push(`${sucesso} presença${sucesso === 1 ? "" : "s"} registrada${sucesso === 1 ? "" : "s"}`);
  }
  if (falhas.length > 0) {
    const motivos = [...new Set(falhas.map(motivoErroPresencaCurto))];
    partes.push(`${falhas.length} falhou${falhas.length === 1 ? "" : "ram"} (${motivos.join(", ")})`);
  }
  res.redirect(comMensagemPresenca(urlRetornoPresenca(req), `${partes.join(", ")}.`));
}

function respostaLaudo(resultado) {
  if (resultado.motivo === "nao_encontrado") return { status: 404, mensagem: "Agendamento não encontrado." };
  if (resultado.motivo === "sem_observacao")
    return { status: 400, mensagem: "Esse atendimento ainda não tem observação registrada — não há o que documentar." };
  return null;
}

async function responderPdfLaudo(res, dados) {
  const pdf = await gerarPdfLaudo(dados);
  const nomeArquivo = `laudo-${slugArquivo(dados.pacienteNome)}-${dados.data}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo}"`);
  res.send(pdf);
}

export async function gerarLaudoBot(req, res) {
  const agendamentoId = idSeguro(req.params.id);
  if (!agendamentoId) {
    return res.status(404).send("Agendamento não encontrado.");
  }

  const resultado = await buscarDadosLaudoBot(agendamentoId);
  const erro = respostaLaudo(resultado);
  if (erro) return res.status(erro.status).send(erro.mensagem);

  await responderPdfLaudo(res, resultado.dados);
}

export async function gerarLaudoImportado(req, res) {
  const agendamentoImportadoId = idSeguro(req.params.id);
  if (!agendamentoImportadoId) {
    return res.status(404).send("Agendamento não encontrado.");
  }

  const resultado = await buscarDadosLaudoImportado(agendamentoImportadoId);
  const erro = respostaLaudo(resultado);
  if (erro) return res.status(erro.status).send(erro.mensagem);

  await responderPdfLaudo(res, resultado.dados);
}

export async function gerarGuiaConvenio(req, res) {
  const pagamentoId = idSeguro(req.params.id);
  if (!pagamentoId) {
    return res.status(404).send("Pagamento não encontrado.");
  }

  const resultado = await buscarDadosGuiaConvenio(pagamentoId);
  if (resultado.motivo === "nao_encontrado") {
    return res.status(404).send("Pagamento não encontrado.");
  }
  if (resultado.motivo === "eh_estorno") {
    return res.status(404).send("Pagamento não encontrado.");
  }

  const pdf = await gerarPdfGuiaConvenio(resultado.dados);
  const nomeArquivo = `guia-${slugArquivo(resultado.dados.pacienteNome)}-${resultado.dados.dataAtendimento}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo}"`);
  res.send(pdf);
}

const FORMA_PAGAMENTO_VALIDA = ["pix", "cartao", "convenio"];
const STATUS_PAGAMENTO_VALIDO = ["pago", "pendente", "aguardando_reembolso"];

function mensagemErroPagamento(motivo) {
  if (motivo === "paciente_nao_vinculado") {
    return "Não foi possível encontrar o paciente vinculado a este agendamento importado (telefone não bate com nenhum cadastro).";
  }
  if (motivo === "telefone_invalido") {
    return "O telefone deste agendamento importado está incompleto ou em formato inválido. Revise o cadastro antes de registrar o pagamento.";
  }
  if (motivo === "telefone_ambiguo") {
    return "O telefone deste agendamento importado corresponde a mais de um paciente. Revise os cadastros antes de registrar o pagamento.";
  }
  return "Não foi possível registrar o pagamento.";
}

// undefined/null/"" contam como "campo não enviado" — não como valor
// inválido. Distinção necessária porque parcelas/valor_acrescimo são
// opcionais em cartao (ausente = null, sem erro) mas, quando enviados,
// precisam ser válidos (presente e inválido = 400, mesma regra do valor).
function campoAusente(valorBruto) {
  return valorBruto === undefined || valorBruto === null || valorBruto === "";
}

// pagamentos.valor e pagamentos.valor_acrescimo são NUMERIC(10,2) — no
// máximo 8 dígitos inteiros + 2 casas decimais (ver
// src/db/migrations/012_financeiro.sql). Qualquer coisa acima disso bate no
// "numeric field overflow" do Postgres, um 500 cru em vez de um 400 limpo.
const VALOR_MAXIMO = 99999999.99;

// pagamentos.parcelas é INTEGER no Postgres — sem teto de negócio, um valor
// absurdo (ex: 999999999999) estoura a coluna e vira "numeric field
// overflow" (500 cru) em vez de um 400 limpo, do mesmo jeito que VALOR_MAXIMO
// evita isso pra valor/valor_acrescimo. 12x é o teto comum de parcelamento
// de cartão no Brasil.
const PARCELAS_MAXIMO = 12;

// Arredonda pra centavos antes de validar/usar. Isso resolve dois problemas
// de uma vez: (1) ruído de sub-centavo (ex: 0.004) some antes da checagem de
// "valor > 0", em vez de passar na validação e só estourar o CHECK
// (valor > 0) do Postgres depois que o NUMERIC(10,2) arredonda pra 0.00 na
// inserção; (2) valores como 150.555 já chegam no banco exatamente como o
// valor validado/usado no resto do fluxo, sem arredondamento silencioso
// acontecer só no INSERT.
//
// Arredonda sobre o TEXTO do número (via String(numero), que o JS sempre
// converte de volta pra forma decimal "óbvia" — `String(1.005) === "1.005"`),
// não sobre o double em si — multiplicar por 100 e usar Math.round direto
// no double (`Math.round(numero * 100) / 100`) falha pra valores como 1.005:
// o double mais próximo de 1.005 já é 1.00499999999999989..., então
// `1.005 * 100` dá 100.49999999999999 e arredonda pra 1.00 em vez de 1.01.
// Um `+ Number.EPSILON` de compensação só resolve isso pra números pequenos
// (perto de 1) — pra valores maiores (ex: 35.855 → 35.85 em vez de 35.86) a
// granularidade do double já é maior que o EPSILON, o erro volta. Trabalhar
// em cima do texto (dígito a dígito, com BigInt pra não reintroduzir ponto
// flutuante) arredonda corretamente em qualquer magnitude dentro do
// NUMERIC(10,2) do banco.
function arredondarCentavos(numero) {
  if (!Number.isFinite(numero)) return numero;
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(numero));
  if (!match) return Math.round(numero * 100) / 100; // formato exótico (ex: notação científica) — fallback

  const [, sinal, parteInteira, parteDecimalBruta = ""] = match;
  const parteDecimal = parteDecimalBruta.padEnd(3, "0");
  const centavos = parteDecimal.slice(0, 2);
  const arredondaPraCima = parteDecimal[2] >= "5";

  const valorEmCentavos = BigInt(parteInteira + centavos) + (arredondaPraCima ? 1n : 0n);
  const inteiroFinal = valorEmCentavos / 100n;
  const centavosFinal = (valorEmCentavos % 100n).toString().padStart(2, "0");
  return Number(`${sinal}${inteiroFinal}.${centavosFinal}`);
}

/**
 * Valida e normaliza o corpo do formulário de pagamento. Retorna null se
 * algo obrigatório for inválido — parcelas/valor_acrescimo são sempre
 * normalizados pra null quando forma_pagamento não é 'cartao' (normalização
 * silenciosa, não erro, mesmo padrão do observacao_sessao do sub-projeto 3).
 * Já em 'cartao', os dois são opcionais (ausente = null), mas se enviados
 * precisam ser válidos — presente e inválido invalida o formulário inteiro
 * (mesma regra do spec pra valor: "quando presente" implica validação).
 */
function validarCamposPagamento(body) {
  const valor = arredondarCentavos(Number(body.valor));
  const formaPagamento = body.forma_pagamento;
  const status = body.status;
  const data = body.data;

  if (!Number.isFinite(valor) || valor <= 0 || valor > VALOR_MAXIMO) return null;
  if (!FORMA_PAGAMENTO_VALIDA.includes(formaPagamento)) return null;
  if (!STATUS_PAGAMENTO_VALIDO.includes(status)) return null;
  if (!validarData(data)) return null;

  const ehCartao = formaPagamento === "cartao";

  let parcelas = null;
  let valorAcrescimo = null;

  if (ehCartao) {
    if (!campoAusente(body.parcelas)) {
      const parcelasBrutas = Number(body.parcelas);
      if (
        !Number.isInteger(parcelasBrutas) ||
        parcelasBrutas <= 0 ||
        parcelasBrutas > PARCELAS_MAXIMO
      )
        return null;
      parcelas = parcelasBrutas;
    }

    if (!campoAusente(body.valor_acrescimo)) {
      const valorAcrescimoBruto = arredondarCentavos(Number(body.valor_acrescimo));
      if (
        !Number.isFinite(valorAcrescimoBruto) ||
        valorAcrescimoBruto < 0 ||
        valorAcrescimoBruto > VALOR_MAXIMO
      )
        return null;
      valorAcrescimo = valorAcrescimoBruto;
    }
  }

  return {
    valor,
    formaPagamento,
    status,
    data,
    parcelas,
    valorAcrescimo,
    observacao: body.observacao?.trim() || null,
  };
}

export async function telaFinanceiro(req, res) {
  const { data, limite, offset } = req.query;
  const filtros = normalizarFiltrosFinanceiro(req.query);
  // limiteSeguroListagem/offsetSeguroListagem vêm do utilitário compartilhado — a
  // view precisa dos valores efetivos (já clampados) pra montar os links
  // Anterior/Próxima com os mesmos números que geraram a página atual, então
  // reusa exatamente o clamp que listarFinanceiro aplica internamente, em
  // vez de manter uma segunda cópia das constantes que poderia divergir.
  const limiteAtual = limiteSeguroListagem(limite);
  const offsetAtual = offsetSeguroListagem(offset);
  const itens = await listarFinanceiro({ data, ...filtros, limite: limiteAtual, offset: offsetAtual });
  res.render("financeiro/lista", {
    filtros,
    itens,
    filtroData: validarData(data) ? data : null,
    limiteAtual,
    offsetAtual,
    // Sem COUNT(*) total (evitado de propósito — ver comentário do model):
    // se a página veio cheia, pode haver mais itens depois. Heurística
    // padrão de paginação "anterior/próxima" sem contagem total.
    temProximaPagina: itens.length === limiteAtual,
  });
}

export async function telaRelatorioFinanceiro(req, res) {
  const plano = String(req.query.plano ?? "").trim() || null;
  const especialidade = ESPECIALIDADES_VALIDAS.has(req.query.especialidade)
    ? req.query.especialidade
    : null;
  const dia = validarData(req.query.dia) ? req.query.dia : null;
  const turno = TURNOS_VALIDOS.has(req.query.turno) ? req.query.turno : null;
  // Não há hoje um cadastro confiável de "quantos fisioterapeutas atenderam
  // nesse período específico" (o cadastro de fisioterapeutas, migration 040,
  // é só pra assinatura de relatório) — por isso é a recepção quem informa
  // esse número na hora, em vez do sistema tentar deduzir sozinho.
  const porFisioterapeutasBruto = Number(req.query.porFisioterapeutas);
  const porFisioterapeutas =
    Number.isInteger(porFisioterapeutasBruto) && porFisioterapeutasBruto > 0
      ? porFisioterapeutasBruto
      : null;
  const relatorio = await buscarRelatorioMensal({ mes: req.query.mes, plano, especialidade, dia, turno });
  const valorPorFisioterapeuta =
    porFisioterapeutas != null ? Number(relatorio.totalFaturado.total) / porFisioterapeutas : null;
  res.render("financeiro/relatorio", {
    relatorio,
    plano,
    especialidade,
    dia,
    turno,
    porFisioterapeutas,
    valorPorFisioterapeuta,
  });
}

export async function telaEstatisticas(
  req,
  res,
  { buscarPeriodo = resolverPeriodo, buscarDados = buscarEstatisticas } = {}
) {
  const periodoResolvido = buscarPeriodo({
    periodo: req.query.periodo,
    inicio: req.query.inicio,
    fim: req.query.fim,
  });
  const estatisticas = await buscarDados({
    dataInicio: periodoResolvido.dataInicio,
    dataFim: periodoResolvido.dataFim,
  });
  res.render("estatisticas/lista", {
    periodoResolvido,
    estatisticas,
    inicioQuery: req.query.inicio ?? "",
    fimQuery: req.query.fim ?? "",
    presets: PERIODOS_VALIDOS.filter((p) => p !== "custom"),
  });
}

export async function processarPagamentoAgendamento(req, res) {
  const id = idSeguro(req.params.id);
  if (!id) {
    return res.status(404).send("Agendamento não encontrado.");
  }

  const campos = validarCamposPagamento(req.body ?? {});
  if (!campos) {
    return res.status(400).send("Dados de pagamento inválidos.");
  }

  const resultado = await registrarPagamentoBot({
    agendamentoId: id,
    ...campos,
    registradoPor: req.usuarioAtual.id,
  });

  if (resultado.motivo === "nao_encontrado") {
    return res.status(404).send("Agendamento não encontrado.");
  }
  if (resultado.motivo) {
    return res.status(400).send(mensagemErroPagamento(resultado.motivo));
  }
  res.redirect(req.body?.retorno === "hoje" ? "/hoje?sucesso=1" : "/financeiro");
}

export async function processarPagamentoImportado(req, res) {
  const id = idSeguro(req.params.id);
  if (!id) {
    return res.status(404).send("Agendamento não encontrado.");
  }

  const campos = validarCamposPagamento(req.body ?? {});
  if (!campos) {
    return res.status(400).send("Dados de pagamento inválidos.");
  }

  const resultado = await registrarPagamentoImportado({
    agendamentoImportadoId: id,
    ...campos,
    registradoPor: req.usuarioAtual.id,
  });

  if (resultado.motivo === "nao_encontrado") {
    return res.status(404).send("Agendamento não encontrado.");
  }
  if (resultado.motivo) {
    return res.status(400).send(mensagemErroPagamento(resultado.motivo));
  }
  res.redirect(req.body?.retorno === "hoje" ? "/hoje?sucesso=1" : "/financeiro");
}

export function criarProcessarEstorno(estornar = estornarPagamento) {
  return async function processarEstornoComDependencia(req, res) {
    const id = idSeguro(req.params.id);
    if (!id) {
      return res.status(404).send("Pagamento não encontrado.");
    }

    const { data, observacao } = req.body ?? {};
    if (!validarData(data)) {
      return res.status(400).send("Dados de estorno inválidos.");
    }

    const resultado = await estornar(id, {
      registradoPor: req.usuarioAtual.id,
      data,
      observacao: observacao?.trim() || null,
    });

    if (resultado.motivo === "nao_encontrado") {
      return res.status(404).send("Pagamento não encontrado.");
    }
    if (["ja_estornado", "nao_estornavel", "status_invalido"].includes(resultado.motivo)) {
      return res.status(400).send("Este pagamento já está estornado.");
    }
    res.redirect(req.body?.retorno === "hoje" ? "/hoje?sucesso=1" : "/financeiro");
  };
}

export const processarEstorno = criarProcessarEstorno();
