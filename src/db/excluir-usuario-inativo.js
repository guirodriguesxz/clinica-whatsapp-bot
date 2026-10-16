// src/db/excluir-usuario-inativo.js
// Exclui definitivamente um usuário INATIVO do dashboard — não existe tela
// pra isso (só "Desativar"), porque excluir é irreversível e o usuário pode
// estar referenciado em registros antigos (agendamentos, pagamentos, etc).
// Recusa apagar usuário ativo ou referenciado em qualquer tabela — nesse
// caso, o FK do Postgres já barra a exclusão, este script só verifica antes
// pra dar uma mensagem clara em vez do erro cru do banco.
// Rodar com: node src/db/excluir-usuario-inativo.js nome_usuario

import "dotenv/config";
import { pool } from "./pool.js";

const TABELAS_COM_REFERENCIA = [
  { tabela: "agendamentos", coluna: "criado_por_usuario_id" },
  { tabela: "agendamentos", coluna: "atualizado_por_usuario_id" },
  { tabela: "presencas", coluna: "registrado_por" },
  { tabela: "pagamentos", coluna: "registrado_por" },
  { tabela: "pacotes_sessao", coluna: "criado_por" },
  { tabela: "avaliacoes_fisioterapeuticas", coluna: "registrado_por" },
];

async function main() {
  const nomeUsuario = process.argv[2];
  if (!nomeUsuario) {
    console.error("Uso: node src/db/excluir-usuario-inativo.js nome_usuario");
    process.exit(1);
  }

  const { rows } = await pool.query(
    "SELECT id, nome, nome_usuario, papel, ativo FROM usuarios WHERE nome_usuario = $1 OR LOWER(nome) = LOWER($1)",
    [nomeUsuario]
  );
  if (rows.length > 1) {
    console.error(
      `Mais de um usuário corresponde a "${nomeUsuario}": ${rows.map((u) => `id ${u.id} (${u.nome}/${u.nome_usuario})`).join(", ")}. Rode de novo usando o nome_usuario exato.`
    );
    process.exit(1);
  }
  const usuario = rows[0];
  if (!usuario) {
    console.error(`Usuário "${nomeUsuario}" não encontrado (buscado por nome_usuario e por nome).`);
    process.exit(1);
  }
  if (usuario.ativo) {
    console.error(`Usuário "${nomeUsuario}" está ATIVO — desative antes de excluir.`);
    process.exit(1);
  }

  for (const { tabela, coluna } of TABELAS_COM_REFERENCIA) {
    const { rows: existe } = await pool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
      [tabela, coluna]
    );
    if (existe.length === 0) continue;
    const { rows: referencias } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM ${tabela} WHERE ${coluna} = $1`,
      [usuario.id]
    );
    if (referencias[0].total > 0) {
      console.error(
        `Usuário "${nomeUsuario}" (id ${usuario.id}) está referenciado em ${referencias[0].total} registro(s) de ${tabela}.${coluna} — não é seguro excluir.`
      );
      process.exit(1);
    }
  }

  await pool.query("DELETE FROM usuarios WHERE id = $1", [usuario.id]);
  console.log(`Usuário "${nomeUsuario}" (id ${usuario.id}, ${usuario.nome}) excluído com sucesso.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
