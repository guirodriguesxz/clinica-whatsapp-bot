import crypto from "node:crypto";
import { capturarErro } from "../config/sentry.js";

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

/**
 * Comparação em tempo constante — evita que um atacante meça a latência da
 * resposta para descobrir o segredo caractere a caractere.
 */
export function compararSeguro(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Confere um segredo na própria URL do webhook (/webhook/:secret). Só quem
 * configurou esse valor na Evolution API consegue chamar a rota — sem isso,
 * qualquer um que descobrisse a URL poderia forjar mensagens de paciente.
 */
export function verificarSegredoWebhook(req, res, next) {
  if (!WEBHOOK_SECRET) {
    capturarErro(
      "[auth] WEBHOOK_SECRET não configurado — recusando todas as chamadas ao webhook."
    );
    return res.sendStatus(404);
  }
  if (!compararSeguro(req.params.secret, WEBHOOK_SECRET)) {
    return res.sendStatus(404);
  }
  next();
}

/**
 * As rotas administrativas existem para automações técnicas. A chave só é
 * aceita no cabeçalho, para não vazar em histórico do navegador, logs ou
 * encaminhamentos de links. A equipe usa o dashboard autenticado no dia a
 * dia.
 */
export function verificarApiKeyAdmin(req, res, next) {
  const chave = req.header("x-admin-api-key");
  if (!ADMIN_API_KEY) {
    capturarErro("[auth] ADMIN_API_KEY não configurado — recusando todas as chamadas admin.");
    return res.status(401).json({ erro: "Não autorizado." });
  }
  if (!compararSeguro(chave, ADMIN_API_KEY)) {
    return res.status(401).json({ erro: "Não autorizado." });
  }
  next();
}
