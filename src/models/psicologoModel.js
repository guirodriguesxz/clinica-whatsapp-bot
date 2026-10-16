import { pool } from "../db/pool.js";

const COLUNAS_LISTAGEM = "id, nome, ativo, created_at, (foto_imagem IS NOT NULL) AS tem_foto";

function mapearPsicologo(registro) {
  return {
    id: registro.id,
    nome: registro.nome,
    ativo: registro.ativo,
    created_at: registro.created_at,
    temFoto: registro.tem_foto,
  };
}

export async function listarPsicologos({ apenasAtivos = true } = {}) {
  const filtro = apenasAtivos ? "WHERE ativo = true " : "";
  const { rows } = await pool.query(
    `SELECT ${COLUNAS_LISTAGEM} FROM psicologos ${filtro}ORDER BY nome ASC`
  );
  return rows.map(mapearPsicologo);
}

export async function buscarPsicologoPorId(id) {
  const { rows } = await pool.query(
    `SELECT ${COLUNAS_LISTAGEM} FROM psicologos WHERE id = $1`,
    [id]
  );
  return rows[0] ? mapearPsicologo(rows[0]) : null;
}

/**
 * Separada de buscarPsicologoPorId pra não puxar o BYTEA da foto (pode ser
 * grande) em toda listagem/edição — só quando de fato vai servir a
 * imagem. Ao contrário da assinatura do fisioterapeuta, não filtra por
 * ativo=true: a foto é só identificação visual, sem uso em documento
 * nenhum, então continua aparecendo pra quem está com "mostrar inativos".
 */
export async function buscarFotoPsicologo(id) {
  const { rows } = await pool.query(
    "SELECT foto_imagem, foto_mime FROM psicologos WHERE id = $1",
    [id]
  );
  const registro = rows[0];
  if (!registro || !registro.foto_imagem) return null;
  return { fotoImagem: registro.foto_imagem, fotoMime: registro.foto_mime };
}

export async function criarPsicologo({ nome, fotoImagem = null, fotoMime = null }) {
  const { rows } = await pool.query(
    `INSERT INTO psicologos (nome, foto_imagem, foto_mime)
     VALUES ($1, $2, $3)
     RETURNING ${COLUNAS_LISTAGEM}`,
    [nome, fotoImagem, fotoMime]
  );
  return mapearPsicologo(rows[0]);
}

export async function atualizarNomePsicologo(id, nome) {
  const { rows } = await pool.query(
    `UPDATE psicologos SET nome = $2 WHERE id = $1 RETURNING ${COLUNAS_LISTAGEM}`,
    [id, nome]
  );
  return rows[0] ? mapearPsicologo(rows[0]) : null;
}

export async function atualizarFotoPsicologo(id, { fotoImagem, fotoMime }) {
  await pool.query(
    "UPDATE psicologos SET foto_imagem = $2, foto_mime = $3 WHERE id = $1",
    [id, fotoImagem, fotoMime]
  );
}

export async function definirAtivoPsicologo(id, ativo) {
  const { rows } = await pool.query(
    "UPDATE psicologos SET ativo = $2 WHERE id = $1 RETURNING id, nome, ativo",
    [id, ativo]
  );
  return rows[0] ?? null;
}
