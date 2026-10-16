import * as usuarioModel from "../models/usuarioModel.js";
import { PAPEIS_VALIDOS } from "../models/usuarioModel.js";
import { gerarTokenCsrf, tokenCsrfValido } from "../utils/csrf.js";
import { capturarErro } from "../config/sentry.js";

/**
 * Protege as rotas do dashboard. Recarrega o usuário a cada requisição (em
 * vez de confiar só no id gravado na sessão) para respeitar `ativo = false`
 * imediatamente, sem esperar a sessão expirar.
 *
 * Encapsula seu próprio tratamento de erro: any database/session error é
 * passado para o próximo middleware via `next(err)`, sem depender de
 * asyncHandler na rota.
 */
export async function exigirLogin(req, res, next) {
  try {
    const usuarioId = req.session?.usuarioId;
    if (!usuarioId) {
      return res.redirect("/login");
    }

    const usuario = await usuarioModel.buscarUsuarioPorId(usuarioId);
    const sessaoInvalida =
      !usuario ||
      !usuario.ativo ||
      !PAPEIS_VALIDOS.has(usuario.papel) ||
      usuario.sessao_versao !== req.session.usuarioVersao;
    if (sessaoInvalida) {
      return req.session.destroy((err) => {
        if (err) {
          capturarErro("[dashboardAuth] Erro ao destruir sessão:", err);
        }
        res.redirect("/login");
      });
    }

    if (!req.session.csrfToken) {
      req.session.csrfToken = gerarTokenCsrf();
    }

    req.usuarioAtual = usuario;
    res.locals.usuarioAtual = usuario;
    res.locals.csrfToken = req.session.csrfToken;
    res.locals.caminhoAtual = req.path;
    next();
  } catch (err) {
    next(err);
  }
}

export function exigirCsrf(req, res, next) {
  const tokenRecebido = req.body?._csrf;
  if (!tokenCsrfValido(req.session?.csrfToken, tokenRecebido)) {
    return res
      .status(403)
      .send("Sessão expirada ou inválida — recarregue a página e tente de novo.");
  }
  next();
}

export function exigirPapel(...papeisPermitidos) {
  return (req, res, next) => {
    if (!req.usuarioAtual || !papeisPermitidos.includes(req.usuarioAtual.papel)) {
      return res.status(403).render("erros/acesso-negado");
    }
    next();
  };
}
