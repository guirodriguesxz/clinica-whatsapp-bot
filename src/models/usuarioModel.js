import { pool } from "../db/pool.js";

const PADRAO_NOME_USUARIO = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const PAPEIS_VALIDOS = new Set(["administradora", "recepcao"]);

export function normalizarNomeUsuario(valor) {
  const nomeUsuario = String(valor ?? "").trim().toLowerCase();
  return PADRAO_NOME_USUARIO.test(nomeUsuario) ? nomeUsuario : null;
}

function validarNovoUsuario({ nome, nomeUsuario, papel, senhaHash }) {
  if (!String(nome ?? "").trim()) throw new Error("Nome inválido.");
  if (!normalizarNomeUsuario(nomeUsuario)) throw new Error("Nome de usuário inválido.");
  if (!PAPEIS_VALIDOS.has(papel)) throw new Error("Papel inválido.");
  if (!senhaHash) throw new Error("Senha inválida.");
}

export async function buscarUsuarioPorNomeUsuario(nomeUsuario) {
  const nomeNormalizado = normalizarNomeUsuario(nomeUsuario);
  if (!nomeNormalizado) return null;

  const { rows } = await pool.query("SELECT * FROM usuarios WHERE nome_usuario = $1", [
    nomeNormalizado,
  ]);
  return rows[0] ?? null;
}

// Só as colunas que o dashboard precisa expor: o retorno vai parar em
// req.usuarioAtual/res.locals.usuarioAtual e fica acessível em qualquer view
// EJS renderizada depois do login — um SELECT * levaria o senha_hash junto.
export async function buscarUsuarioPorId(id) {
  const { rows } = await pool.query(
    "SELECT id, nome, nome_usuario, papel, ativo, created_at, sessao_versao FROM usuarios WHERE id = $1",
    [id]
  );
  return rows[0] ?? null;
}

export async function buscarHashUsuarioPorId(id) {
  const { rows } = await pool.query("SELECT senha_hash FROM usuarios WHERE id = $1", [id]);
  return rows[0]?.senha_hash ?? null;
}

// Administradoras primeiro (Bruno, Ana), depois recepção — cada grupo
// em ordem alfabética.
export async function listarUsuarios() {
  const { rows } = await pool.query(
    "SELECT id, nome, nome_usuario, papel, ativo, created_at FROM usuarios ORDER BY (papel = 'administradora') DESC, nome ASC"
  );
  return rows;
}

export async function criarUsuario({ nome, nomeUsuario, papel, senhaHash }) {
  validarNovoUsuario({ nome, nomeUsuario, papel, senhaHash });
  const { rows } = await pool.query(
    `INSERT INTO usuarios (nome, nome_usuario, papel, senha_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id, nome, nome_usuario, papel, ativo, created_at`,
    [nome.trim(), normalizarNomeUsuario(nomeUsuario), papel, senhaHash]
  );
  return rows[0] ?? null;
}

export async function atualizarSenhaUsuario(id, senhaHash) {
  const { rows } = await pool.query(
    "UPDATE usuarios SET senha_hash = $2, sessao_versao = sessao_versao + 1 WHERE id = $1 RETURNING id, sessao_versao",
    [id, senhaHash]
  );
  return rows[0] ?? null;
}

export async function desativarUsuario(id) {
  const { rows } = await pool.query(
    "UPDATE usuarios SET ativo = false WHERE id = $1 RETURNING id, ativo",
    [id]
  );
  return rows[0] ?? null;
}
