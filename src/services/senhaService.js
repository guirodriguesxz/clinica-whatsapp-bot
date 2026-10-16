import bcrypt from "bcrypt";

const CUSTO_HASH = 12;

export async function hashSenha(senha) {
  return bcrypt.hash(senha, CUSTO_HASH);
}

export async function compararSenha(senha, hash) {
  return bcrypt.compare(senha, hash);
}
