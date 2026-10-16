// src/controllers/baseConhecimentoController.js
import {
  listarBaseConhecimento,
  buscarEntradaBaseConhecimentoPorId,
  inserirEntradaBaseConhecimento,
  atualizarEntradaBaseConhecimento as atualizarEntradaModel,
  definirAtivoEntradaBaseConhecimento,
} from "../models/baseConhecimentoModel.js";
import { CATEGORIAS_BASE_CONHECIMENTO } from "../constants/categoriasBaseConhecimento.js";
import { definirStatusSugestaoConhecimento } from "../models/sugestaoConhecimentoModel.js";
import { idSeguro } from "../utils/paginacao.js";

/**
 * Preserva o filtro "mostrar inativos" no redirect pós-ação, senão
 * desativar/reativar/editar a partir da visão de inativos sempre bate de
 * volta na lista só-ativos. Mesmo padrão de convenioController.js.
 */
function sufixoTodos(req) {
  return req.body?.todos === "1" ? "&todos=1" : "";
}

function camposValidos({ pergunta, resposta }) {
  return Boolean(String(pergunta ?? "").trim()) && Boolean(String(resposta ?? "").trim());
}

export async function telaBaseConhecimento(req, res, { listar = listarBaseConhecimento } = {}) {
  const mostrarTodos = req.query.todos === "1";
  const entradas = await listar({ apenasAtivos: !mostrarTodos });
  res.render("baseConhecimento/lista", {
    entradas,
    mostrarTodos,
    sucesso: req.query.sucesso === "1",
  });
}

export function telaNovaEntradaBaseConhecimento(req, res) {
  const sugestaoId = idSeguro(req.query?.sugestaoId);
  res.render("baseConhecimento/novo", {
    erro: null,
    categorias: CATEGORIAS_BASE_CONHECIMENTO,
    perguntaSugerida: sugestaoId ? String(req.query?.pergunta ?? "") : "",
    sugestaoId,
  });
}

export async function processarNovaEntradaBaseConhecimento(
  req,
  res,
  {
    criar = inserirEntradaBaseConhecimento,
    marcarSugestaoAprovada = definirStatusSugestaoConhecimento,
  } = {}
) {
  const pergunta = String(req.body?.pergunta ?? "").trim();
  const resposta = String(req.body?.resposta ?? "").trim();
  const categoria = String(req.body?.categoria ?? "").trim() || null;
  const sugestaoId = idSeguro(req.body?.sugestaoId);

  if (!camposValidos({ pergunta, resposta })) {
    return res.status(400).send("Pergunta e resposta são obrigatórias.");
  }

  await criar({ pergunta, resposta, categoria });
  if (sugestaoId) {
    await marcarSugestaoAprovada(sugestaoId, "aprovada");
  }
  res.redirect("/base-conhecimento?sucesso=1");
}

export async function telaEditarEntradaBaseConhecimento(
  req,
  res,
  { buscar = buscarEntradaBaseConhecimentoPorId } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Entrada não encontrada.");

  const entrada = await buscar(id);
  if (!entrada) return res.status(404).send("Entrada não encontrada.");

  res.render("baseConhecimento/editar", {
    entrada,
    erro: null,
    mostrarTodos: req.query?.todos === "1",
    categorias: CATEGORIAS_BASE_CONHECIMENTO,
  });
}

export async function processarEditarEntradaBaseConhecimento(
  req,
  res,
  { buscar = buscarEntradaBaseConhecimentoPorId, atualizar = atualizarEntradaModel } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Entrada não encontrada.");

  const pergunta = String(req.body?.pergunta ?? "").trim();
  const resposta = String(req.body?.resposta ?? "").trim();
  const categoria = String(req.body?.categoria ?? "").trim() || null;

  if (!camposValidos({ pergunta, resposta })) {
    return res.status(400).send("Pergunta e resposta são obrigatórias.");
  }

  const entrada = await buscar(id);
  if (!entrada) return res.status(404).send("Entrada não encontrada.");

  await atualizar(id, { pergunta, resposta, categoria });
  res.redirect(`/base-conhecimento?sucesso=1${sufixoTodos(req)}`);
}

export async function processarDesativarEntradaBaseConhecimento(
  req,
  res,
  { buscar = buscarEntradaBaseConhecimentoPorId, definirAtivo = definirAtivoEntradaBaseConhecimento } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Entrada não encontrada.");

  const entrada = await buscar(id);
  if (!entrada) return res.status(404).send("Entrada não encontrada.");

  await definirAtivo(id, false);
  res.redirect(`/base-conhecimento?sucesso=1${sufixoTodos(req)}`);
}

export async function processarReativarEntradaBaseConhecimento(
  req,
  res,
  { buscar = buscarEntradaBaseConhecimentoPorId, definirAtivo = definirAtivoEntradaBaseConhecimento } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Entrada não encontrada.");

  const entrada = await buscar(id);
  if (!entrada) return res.status(404).send("Entrada não encontrada.");

  await definirAtivo(id, true);
  res.redirect(`/base-conhecimento?sucesso=1${sufixoTodos(req)}`);
}
