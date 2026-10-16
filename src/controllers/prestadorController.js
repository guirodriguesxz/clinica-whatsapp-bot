import { buscarDadosPrestador, salvarDadosPrestador } from "../models/dadosPrestadorModel.js";

function textoOuNulo(bruto) {
  const texto = String(bruto ?? "").trim();
  return texto || null;
}

export async function telaPrestador(req, res, { buscar = buscarDadosPrestador } = {}) {
  const dados = (await buscar()) ?? {
    cnes: null,
    razao_social: null,
    cnpj: null,
    cbo_fisioterapia: null,
    cbo_psicologia: null,
  };
  res.render("prestador/editar", { dados, sucesso: req.query.sucesso === "1" });
}

export async function processarPrestador(req, res, { salvar = salvarDadosPrestador } = {}) {
  await salvar({
    cnes: textoOuNulo(req.body?.cnes),
    razaoSocial: textoOuNulo(req.body?.razao_social),
    cnpj: textoOuNulo(req.body?.cnpj),
    cboFisioterapia: textoOuNulo(req.body?.cbo_fisioterapia),
    cboPsicologia: textoOuNulo(req.body?.cbo_psicologia),
  });
  res.redirect("/configuracoes/prestador?sucesso=1");
}
