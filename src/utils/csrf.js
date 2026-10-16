import crypto from "node:crypto";
import { compararSeguro } from "../middleware/auth.js";

export function gerarTokenCsrf() {
  return crypto.randomBytes(32).toString("hex");
}

export function tokenCsrfValido(tokenSessao, tokenRecebido) {
  if (!tokenSessao) return false;
  return compararSeguro(tokenSessao, tokenRecebido);
}
