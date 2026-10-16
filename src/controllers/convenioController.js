import {
  listarConvenios,
  buscarConvenioPorId,
  criarConvenio,
  atualizarConvenio,
  definirAtivoConvenio,
} from "../models/convenioModel.js";
import {
  listarProcedimentosTuss,
  salvarProcedimentosTuss,
} from "../models/convenioProcedimentoTussModel.js";
import { idSeguro } from "../utils/paginacao.js";

const COMBINACOES_TUSS = [
  { tipoAtendimento: "fisioterapia", categoria: "avaliacao" },
  { tipoAtendimento: "fisioterapia", categoria: "sessao" },
  { tipoAtendimento: "psicologia", categoria: "avaliacao" },
  { tipoAtendimento: "psicologia", categoria: "sessao" },
];

function linhasTussDoBody(body) {
  return COMBINACOES_TUSS.map(({ tipoAtendimento, categoria }) => ({
    tipoAtendimento,
    categoria,
    codigoTuss: String(body?.[`tuss_${tipoAtendimento}_${categoria}_codigo`] ?? "").trim() || null,
    descricaoTuss: String(body?.[`tuss_${tipoAtendimento}_${categoria}_descricao`] ?? "").trim() || null,
  }));
}

/**
 * Preserva o filtro "mostrar inativos" no redirect pós-ação, senão
 * desativar/reativar/editar a partir da visão de inativos sempre bate de
 * volta na lista só-ativos. Mesmo padrão de psicologoController.js.
 */
function sufixoTodos(req) {
  return req.body?.todos === "1" ? "&todos=1" : "";
}

/**
 * Valor de repasse é opcional: campo vazio vira null (sem bloquear o
 * cadastro). Quando informado, precisa ser um número não-negativo — texto
 * inválido ou negativo retorna undefined pro controller responder 400.
 */
function valorRepasseSeguro(bruto) {
  const texto = String(bruto ?? "").trim();
  if (!texto) return null;
  const numero = Number(texto.replace(",", "."));
  if (!Number.isFinite(numero) || numero < 0) return undefined;
  return numero;
}

export async function telaConvenios(req, res, { listar = listarConvenios } = {}) {
  const mostrarTodos = req.query.todos === "1";
  const convenios = await listar({ apenasAtivos: !mostrarTodos });
  res.render("convenios/lista", {
    convenios,
    mostrarTodos,
    sucesso: req.query.sucesso === "1",
  });
}

export function telaNovoConvenio(req, res) {
  res.render("convenios/novo", { erro: null });
}

export async function processarNovoConvenio(req, res, { criar = criarConvenio } = {}) {
  const nome = String(req.body?.nome ?? "").trim();
  if (!nome) return res.status(400).send("Nome inválido.");

  const valorRepasseAvaliacao = valorRepasseSeguro(req.body?.valor_repasse_avaliacao);
  const valorRepasseSessao = valorRepasseSeguro(req.body?.valor_repasse_sessao);
  if (valorRepasseAvaliacao === undefined || valorRepasseSessao === undefined) {
    return res.status(400).send("Valor de repasse inválido.");
  }

  await criar({ nome, valorRepasseAvaliacao, valorRepasseSessao });
  res.redirect("/convenios?sucesso=1");
}

export async function telaEditarConvenio(
  req,
  res,
  { buscar = buscarConvenioPorId, listarTuss = listarProcedimentosTuss } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Convênio não encontrado.");

  const convenio = await buscar(id);
  if (!convenio) return res.status(404).send("Convênio não encontrado.");

  const linhasTuss = await listarTuss(id);
  const procedimentosTussPorChave = Object.fromEntries(
    linhasTuss.map((l) => [`${l.tipo_atendimento}_${l.categoria}`, { codigo_tuss: l.codigo_tuss, descricao_tuss: l.descricao_tuss }])
  );

  res.render("convenios/editar", {
    convenio,
    erro: null,
    mostrarTodos: req.query?.todos === "1",
    procedimentosTussPorChave,
  });
}

export async function processarEditarConvenio(
  req,
  res,
  { buscar = buscarConvenioPorId, atualizar = atualizarConvenio, salvarTuss = salvarProcedimentosTuss } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Convênio não encontrado.");

  const nome = String(req.body?.nome ?? "").trim();
  if (!nome) return res.status(400).send("Nome inválido.");

  const valorRepasseAvaliacao = valorRepasseSeguro(req.body?.valor_repasse_avaliacao);
  const valorRepasseSessao = valorRepasseSeguro(req.body?.valor_repasse_sessao);
  if (valorRepasseAvaliacao === undefined || valorRepasseSessao === undefined) {
    return res.status(400).send("Valor de repasse inválido.");
  }

  const convenio = await buscar(id);
  if (!convenio) return res.status(404).send("Convênio não encontrado.");

  const codigoPrestadorNaOperadora = String(req.body?.codigo_prestador_na_operadora ?? "").trim() || null;
  const numeroContrato = String(req.body?.numero_contrato ?? "").trim() || null;

  await atualizar(id, {
    nome, valorRepasseAvaliacao, valorRepasseSessao, codigoPrestadorNaOperadora, numeroContrato,
  });
  await salvarTuss(id, linhasTussDoBody(req.body ?? {}));

  res.redirect(`/convenios?sucesso=1${sufixoTodos(req)}`);
}

export async function processarDesativarConvenio(
  req,
  res,
  { buscar = buscarConvenioPorId, definirAtivo = definirAtivoConvenio } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Convênio não encontrado.");

  const convenio = await buscar(id);
  if (!convenio) return res.status(404).send("Convênio não encontrado.");

  await definirAtivo(id, false);
  res.redirect(`/convenios?sucesso=1${sufixoTodos(req)}`);
}

export async function processarReativarConvenio(
  req,
  res,
  { buscar = buscarConvenioPorId, definirAtivo = definirAtivoConvenio } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Convênio não encontrado.");

  const convenio = await buscar(id);
  if (!convenio) return res.status(404).send("Convênio não encontrado.");

  await definirAtivo(id, true);
  res.redirect(`/convenios?sucesso=1${sufixoTodos(req)}`);
}
