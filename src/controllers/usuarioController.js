import {
  atualizarSenhaUsuario,
  buscarHashUsuarioPorId,
  buscarUsuarioPorId,
  criarUsuario,
  desativarUsuario,
  listarUsuarios,
  normalizarNomeUsuario,
} from "../models/usuarioModel.js";
import { compararSenha, hashSenha } from "../services/senhaService.js";
import { idSeguro } from "../utils/paginacao.js";
import { capturarErro } from "../config/sentry.js";

const SENHA_MINIMA = 8;

function senhaNovaValida(senha, confirmacaoSenha) {
  return typeof senha === "string" && senha.length >= SENHA_MINIMA && senha === confirmacaoSenha;
}

export async function telaUsuarios(req, res) {
  const usuarios = await listarUsuarios();
  res.render("usuarios/lista", { usuarios, sucesso: req.query.sucesso === "1" });
}

export function telaNovoUsuario(req, res) {
  res.render("usuarios/novo", { erro: null });
}

export async function processarNovoUsuario(
  req,
  res,
  { hash = hashSenha, criar = criarUsuario } = {}
) {
  const { nome, nome_usuario: nomeUsuario, senha, confirmacao_senha: confirmacaoSenha } = req.body ?? {};
  if (
    !String(nome ?? "").trim() ||
    !normalizarNomeUsuario(nomeUsuario) ||
    !senhaNovaValida(senha, confirmacaoSenha)
  ) {
    return res.status(400).send("Dados do usuário inválidos.");
  }

  try {
    const senhaHash = await hash(senha);
    await criar({ nome, nomeUsuario, papel: "recepcao", senhaHash });
    res.redirect("/usuarios?sucesso=1");
  } catch (err) {
    if (err.code === "23505") {
      return res.status(400).send("Já existe um usuário com esse nome de usuário.");
    }
    throw err;
  }
}

export async function processarRedefinicaoSenha(
  req,
  res,
  {
    buscarUsuario = buscarUsuarioPorId,
    hash = hashSenha,
    atualizar = atualizarSenhaUsuario,
  } = {}
) {
  const id = idSeguro(req.params.id);
  const { senha, confirmacao_senha: confirmacaoSenha } = req.body ?? {};
  if (!id) return res.status(404).send("Usuário não encontrado.");
  if (id === req.usuarioAtual.id) {
    return res.status(400).send("Use a opção Trocar senha para alterar a própria senha.");
  }
  if (!senhaNovaValida(senha, confirmacaoSenha)) {
    return res.status(400).send("Dados da senha inválidos.");
  }
  const usuario = await buscarUsuario(id);
  if (!usuario) return res.status(404).send("Usuário não encontrado.");
  if (usuario.papel !== "recepcao") {
    return res.status(403).send("A senha de outra administradora não pode ser alterada.");
  }

  const atualizado = await atualizar(id, await hash(senha));
  if (!atualizado) return res.status(404).send("Usuário não encontrado.");
  res.redirect("/usuarios?sucesso=1");
}

export async function processarDesativacaoUsuario(
  req,
  res,
  { buscarUsuario = buscarUsuarioPorId, desativar = desativarUsuario } = {}
) {
  const id = idSeguro(req.params.id);
  if (!id) return res.status(404).send("Usuário não encontrado.");
  if (id === req.usuarioAtual.id) {
    return res.status(400).send("Você não pode desativar a própria conta.");
  }
  const alvo = await buscarUsuario(id);
  if (!alvo) return res.status(404).send("Usuário não encontrado.");
  if (alvo.papel !== "recepcao") {
    return res.status(403).send("Outra administradora não pode ser desativada.");
  }

  const usuario = await desativar(id);
  if (!usuario) return res.status(404).send("Usuário não encontrado.");
  res.redirect("/usuarios?sucesso=1");
}

export function telaTrocarSenha(req, res) {
  res.render("usuarios/trocar-senha", { erro: null });
}

export async function processarTrocaPropriaSenha(
  req,
  res,
  {
    buscarHash = buscarHashUsuarioPorId,
    comparar = compararSenha,
    hash = hashSenha,
    atualizar = atualizarSenhaUsuario,
    capturar = capturarErro,
  } = {}
) {
  const { senha_atual: senhaAtual, senha, confirmacao_senha: confirmacaoSenha } = req.body ?? {};
  if (!senhaAtual || !senhaNovaValida(senha, confirmacaoSenha)) {
    return res.status(400).send("Dados da senha inválidos.");
  }

  const hashAtual = await buscarHash(req.usuarioAtual.id);
  if (!hashAtual || !(await comparar(senhaAtual, hashAtual))) {
    return res.status(400).send("Dados da senha inválidos.");
  }

  const atualizado = await atualizar(req.usuarioAtual.id, await hash(senha));
  if (!atualizado) return res.status(404).send("Usuário não encontrado.");

  req.session.destroy((err) => {
    if (err) {
      capturar("[usuarios] Erro ao encerrar sessão após troca de senha:", err);
      return res.status(500).send("Senha alterada, mas não foi possível encerrar a sessão. Tente sair novamente.");
    }
    res.redirect("/login?senhaAlterada=1");
  });
}
