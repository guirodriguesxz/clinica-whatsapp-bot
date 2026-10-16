import {
  listarSugestoesConhecimentoPendentes,
  buscarSugestaoConhecimentoPorId,
  definirStatusSugestaoConhecimento,
} from "../models/sugestaoConhecimentoModel.js";
import { idSeguro } from "../utils/paginacao.js";

export async function telaSugestoesConhecimento(
  req,
  res,
  { listar = listarSugestoesConhecimentoPendentes } = {}
) {
  const sugestoes = await listar();
  res.render("sugestoesConhecimento/lista", { sugestoes });
}

export async function processarDescartarSugestaoConhecimento(
  req,
  res,
  { buscar = buscarSugestaoConhecimentoPorId, definirStatus = definirStatusSugestaoConhecimento } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Sugestão não encontrada.");

  const sugestao = await buscar(id);
  if (!sugestao) return res.status(404).send("Sugestão não encontrada.");

  await definirStatus(id, "descartada");
  res.redirect("/sugestoes-conhecimento");
}
