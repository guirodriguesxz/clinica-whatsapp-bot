import {
  listarPsicologos,
  buscarPsicologoPorId,
  buscarFotoPsicologo,
  criarPsicologo,
  atualizarNomePsicologo,
  atualizarFotoPsicologo,
  definirAtivoPsicologo,
} from "../models/psicologoModel.js";
import { idSeguro } from "../utils/paginacao.js";
import { validarArquivoImagem } from "../utils/validarImagem.js";
import { gerarPdfTermoCienciaPsicologia } from "../services/termoCienciaPsicologiaPdfService.js";

/**
 * Preserva o filtro "mostrar inativos" no redirect pós-ação, senão
 * desativar/reativar/editar a partir da visão de inativos sempre bate de
 * volta na lista só-ativos.
 */
function sufixoTodos(req) {
  return req.body?.todos === "1" ? "&todos=1" : "";
}

export function validarArquivoFoto(file) {
  return validarArquivoImagem(file, "Foto");
}

export async function telaPsicologos(req, res, { listar = listarPsicologos } = {}) {
  const mostrarTodos = req.query.todos === "1";
  const psicologos = await listar({ apenasAtivos: !mostrarTodos });
  res.render("psicologos/lista", {
    psicologos,
    mostrarTodos,
    sucesso: req.query.sucesso === "1",
  });
}

export function telaNovoPsicologo(req, res) {
  res.render("psicologos/novo", { erro: null });
}

export async function processarNovoPsicologo(req, res, { criar = criarPsicologo } = {}) {
  const nome = String(req.body?.nome ?? "").trim();
  if (!nome) return res.status(400).send("Nome inválido.");

  const erroArquivo = validarArquivoFoto(req.file);
  if (erroArquivo) return res.status(400).send(erroArquivo);

  await criar({
    nome,
    fotoImagem: req.file?.buffer ?? null,
    fotoMime: req.file?.mimetype ?? null,
  });
  res.redirect("/psicologos?sucesso=1");
}

export async function telaEditarPsicologo(
  req,
  res,
  { buscar = buscarPsicologoPorId } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Psicólogo não encontrado.");

  const psicologo = await buscar(id);
  if (!psicologo) return res.status(404).send("Psicólogo não encontrado.");

  res.render("psicologos/editar", {
    psicologo,
    erro: null,
    mostrarTodos: req.query?.todos === "1",
  });
}

export async function processarEditarPsicologo(
  req,
  res,
  {
    buscar = buscarPsicologoPorId,
    atualizar = atualizarNomePsicologo,
    atualizarFoto = atualizarFotoPsicologo,
  } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Psicólogo não encontrado.");

  const nome = String(req.body?.nome ?? "").trim();
  if (!nome) return res.status(400).send("Nome inválido.");

  const erroArquivo = validarArquivoFoto(req.file);
  if (erroArquivo) return res.status(400).send(erroArquivo);

  const psicologo = await buscar(id);
  if (!psicologo) return res.status(404).send("Psicólogo não encontrado.");

  await atualizar(id, nome);
  if (req.file) {
    await atualizarFoto(id, { fotoImagem: req.file.buffer, fotoMime: req.file.mimetype });
  }
  res.redirect(`/psicologos?sucesso=1${sufixoTodos(req)}`);
}

export async function processarDesativarPsicologo(
  req,
  res,
  { buscar = buscarPsicologoPorId, definirAtivo = definirAtivoPsicologo } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Psicólogo não encontrado.");

  const psicologo = await buscar(id);
  if (!psicologo) return res.status(404).send("Psicólogo não encontrado.");

  await definirAtivo(id, false);
  res.redirect(`/psicologos?sucesso=1${sufixoTodos(req)}`);
}

export async function processarReativarPsicologo(
  req,
  res,
  { buscar = buscarPsicologoPorId, definirAtivo = definirAtivoPsicologo } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Psicólogo não encontrado.");

  const psicologo = await buscar(id);
  if (!psicologo) return res.status(404).send("Psicólogo não encontrado.");

  await definirAtivo(id, true);
  res.redirect(`/psicologos?sucesso=1${sufixoTodos(req)}`);
}

export async function servirFotoPsicologo(req, res, { buscarFoto = buscarFotoPsicologo } = {}) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Psicólogo não encontrado.");

  const foto = await buscarFoto(id);
  if (!foto) return res.status(404).send("Foto não encontrada.");

  res.setHeader("Content-Type", foto.fotoMime);
  res.send(foto.fotoImagem);
}

export async function gerarPdfTermoCienciaPsicologiaController(
  req,
  res,
  { gerarPdf = gerarPdfTermoCienciaPsicologia } = {}
) {
  const pdf = await gerarPdf();
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="termo-ciencia-psicologia.pdf"');
  res.send(pdf);
}
