import {
  listarFisioterapeutas,
  buscarFisioterapeutaPorId,
  buscarAssinaturaFisioterapeuta,
  criarFisioterapeuta,
  atualizarFisioterapeuta,
  atualizarAssinaturaFisioterapeuta,
  definirAtivoFisioterapeuta,
} from "../models/fisioterapeutaModel.js";
import { idSeguro } from "../utils/paginacao.js";
import { validarArquivoImagem } from "../utils/validarImagem.js";

/**
 * Preserva o filtro "mostrar inativos" no redirect pós-ação, senão
 * desativar/reativar/editar a partir da visão de inativos sempre bate de
 * volta na lista só-ativos.
 */
function sufixoTodos(req) {
  return req.body?.todos === "1" ? "&todos=1" : "";
}

function campoOuNulo(valor) {
  const texto = String(valor ?? "").trim();
  return texto || null;
}

export function validarArquivoAssinatura(file) {
  return validarArquivoImagem(file, "Imagem da assinatura");
}

export async function telaFisioterapeutas(req, res, { listar = listarFisioterapeutas } = {}) {
  const mostrarTodos = req.query.todos === "1";
  const fisioterapeutas = await listar({ apenasAtivos: !mostrarTodos });
  res.render("fisioterapeutas/lista", {
    fisioterapeutas,
    mostrarTodos,
    sucesso: req.query.sucesso === "1",
  });
}

export function telaNovoFisioterapeuta(req, res) {
  res.render("fisioterapeutas/novo", { erro: null });
}

export async function processarNovoFisioterapeuta(req, res, { criar = criarFisioterapeuta } = {}) {
  const nome = String(req.body?.nome ?? "").trim();
  if (!nome) return res.status(400).send("Nome inválido.");

  const erroArquivo = validarArquivoAssinatura(req.file);
  if (erroArquivo) return res.status(400).send(erroArquivo);

  await criar({
    nome,
    crefito: campoOuNulo(req.body?.crefito),
    assinaturaImagem: req.file?.buffer ?? null,
    assinaturaMime: req.file?.mimetype ?? null,
  });
  res.redirect("/fisioterapeutas?sucesso=1");
}

export async function telaEditarFisioterapeuta(req, res, { buscar = buscarFisioterapeutaPorId } = {}) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Fisioterapeuta não encontrado.");

  const fisioterapeuta = await buscar(id);
  if (!fisioterapeuta) return res.status(404).send("Fisioterapeuta não encontrado.");

  res.render("fisioterapeutas/editar", {
    fisioterapeuta,
    erro: null,
    mostrarTodos: req.query?.todos === "1",
  });
}

export async function processarEditarFisioterapeuta(
  req, res,
  {
    buscar = buscarFisioterapeutaPorId,
    atualizar = atualizarFisioterapeuta,
    atualizarAssinatura = atualizarAssinaturaFisioterapeuta,
  } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Fisioterapeuta não encontrado.");

  const nome = String(req.body?.nome ?? "").trim();
  if (!nome) return res.status(400).send("Nome inválido.");

  const erroArquivo = validarArquivoAssinatura(req.file);
  if (erroArquivo) return res.status(400).send(erroArquivo);

  const fisioterapeuta = await buscar(id);
  if (!fisioterapeuta) return res.status(404).send("Fisioterapeuta não encontrado.");

  await atualizar(id, { nome, crefito: campoOuNulo(req.body?.crefito) });
  if (req.file) {
    await atualizarAssinatura(id, { assinaturaImagem: req.file.buffer, assinaturaMime: req.file.mimetype });
  }
  res.redirect(`/fisioterapeutas?sucesso=1${sufixoTodos(req)}`);
}

export async function processarDesativarFisioterapeuta(
  req, res, { buscar = buscarFisioterapeutaPorId, definirAtivo = definirAtivoFisioterapeuta } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Fisioterapeuta não encontrado.");

  const fisioterapeuta = await buscar(id);
  if (!fisioterapeuta) return res.status(404).send("Fisioterapeuta não encontrado.");

  await definirAtivo(id, false);
  res.redirect(`/fisioterapeutas?sucesso=1${sufixoTodos(req)}`);
}

export async function processarReativarFisioterapeuta(
  req, res, { buscar = buscarFisioterapeutaPorId, definirAtivo = definirAtivoFisioterapeuta } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Fisioterapeuta não encontrado.");

  const fisioterapeuta = await buscar(id);
  if (!fisioterapeuta) return res.status(404).send("Fisioterapeuta não encontrado.");

  await definirAtivo(id, true);
  res.redirect(`/fisioterapeutas?sucesso=1${sufixoTodos(req)}`);
}

export async function servirAssinaturaFisioterapeuta(
  req, res, { buscarAssinatura = buscarAssinaturaFisioterapeuta } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Fisioterapeuta não encontrado.");

  const assinatura = await buscarAssinatura(id);
  if (!assinatura) return res.status(404).send("Assinatura não encontrada.");

  res.setHeader("Content-Type", assinatura.assinaturaMime);
  res.send(assinatura.assinaturaImagem);
}
