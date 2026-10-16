// src/db/criar-primeiro-usuario.js
// Cria um usuário do dashboard direto no banco — necessário para o
// primeiro login, já que a tela /usuarios/novo exige estar logado (não
// existe autocadastro público). Depois do primeiro usuário, use a própria
// tela /usuarios/novo.
// Rodar com: node src/db/criar-primeiro-usuario.js "Nome Completo" identificador
// Papel e senha são pedidos interativamente (stdin), nunca por argv — argv fica
// visível em `ps` e no histórico do shell para qualquer outro usuário da máquina.

import readline from "node:readline";
import "dotenv/config";
import { criarUsuario } from "../models/usuarioModel.js";
import { hashSenha } from "../services/senhaService.js";
import { lerSegredo } from "../utils/lerSegredo.js";
import { pool } from "./pool.js";

// Em modo TTY, "papel" não é secreto e usa o eco normal do terminal — só a
// senha (lerSegredo) mascara. Em modo não-TTY (pipe, ex: automação), não há
// diferença de mascaramento nenhuma, então reaproveitamos lerSegredo direto
// (ela já lê o stream inteiro de uma vez nesse modo — ver lerSegredo.js).
function perguntar(prompt) {
  if (!process.stdin.isTTY) {
    return lerSegredo({ prompt });
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (resposta) => {
      rl.close();
      resolve(resposta);
    });
  });
}

const [, , nome, nomeUsuario, ...argumentosExtras] = process.argv;

if (!nome || !nomeUsuario || argumentosExtras.length > 0) {
  console.error(
    'Uso: node src/db/criar-primeiro-usuario.js "Nome Completo" identificador\n' +
      "Papel e senha são solicitados interativamente, sem passar por argumento."
  );
  process.exit(1);
}

const papel = await perguntar("Papel (administradora ou recepcao): ");
const senha = await lerSegredo({ prompt: "Senha: " });

if (senha.length < 8) {
  console.error("A senha precisa ter pelo menos 8 caracteres.");
  process.exit(1);
}

const senhaHash = await hashSenha(senha);
const usuario = await criarUsuario({ nome, nomeUsuario, papel, senhaHash });
console.log("Usuário criado:", {
  id: usuario.id,
  nome: usuario.nome,
  nome_usuario: usuario.nome_usuario,
  papel: usuario.papel,
});

await pool.end();
