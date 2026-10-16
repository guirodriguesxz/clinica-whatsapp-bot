import { pool } from "../db/pool.js";

function mapearFisioterapeuta(registro) {
  return {
    id: registro.id,
    nome: registro.nome,
    crefito: registro.crefito,
    ativo: registro.ativo,
    createdAt: registro.created_at,
    temAssinatura: registro.tem_assinatura,
  };
}

const COLUNAS_LISTAGEM = `id, nome, crefito, ativo, created_at, (assinatura_imagem IS NOT NULL) AS tem_assinatura`;

export async function listarFisioterapeutas({ apenasAtivos = true } = {}) {
  const filtro = apenasAtivos ? "WHERE ativo = true " : "";
  const { rows } = await pool.query(
    `SELECT ${COLUNAS_LISTAGEM} FROM fisioterapeutas ${filtro}ORDER BY nome ASC`
  );
  return rows.map(mapearFisioterapeuta);
}

export async function buscarFisioterapeutaPorId(id) {
  const { rows } = await pool.query(
    `SELECT ${COLUNAS_LISTAGEM} FROM fisioterapeutas WHERE id = $1`,
    [id]
  );
  return rows[0] ? mapearFisioterapeuta(rows[0]) : null;
}

/**
 * Separada de buscarFisioterapeutaPorId pra não puxar o BYTEA da imagem
 * (pode ser grande) em toda listagem/edição — só quando de fato vai
 * embutir a assinatura num documento ou servir o preview.
 */
export async function buscarAssinaturaFisioterapeuta(id) {
  const { rows } = await pool.query(
    "SELECT assinatura_imagem, assinatura_mime FROM fisioterapeutas WHERE id = $1 AND ativo = true",
    [id]
  );
  const registro = rows[0];
  if (!registro || !registro.assinatura_imagem) return null;
  return { assinaturaImagem: registro.assinatura_imagem, assinaturaMime: registro.assinatura_mime };
}

export async function criarFisioterapeuta({ nome, crefito, assinaturaImagem = null, assinaturaMime = null }) {
  const { rows } = await pool.query(
    `INSERT INTO fisioterapeutas (nome, crefito, assinatura_imagem, assinatura_mime)
     VALUES ($1, $2, $3, $4)
     RETURNING ${COLUNAS_LISTAGEM}`,
    [nome, crefito, assinaturaImagem, assinaturaMime]
  );
  return mapearFisioterapeuta(rows[0]);
}

/**
 * Só nome/crefito — a assinatura tem sua própria função (abaixo), chamada
 * apenas quando um arquivo novo é enviado, pra edição de nome não exigir
 * reenviar a imagem.
 */
export async function atualizarFisioterapeuta(id, { nome, crefito }) {
  const { rows } = await pool.query(
    `UPDATE fisioterapeutas SET nome = $2, crefito = $3 WHERE id = $1
     RETURNING ${COLUNAS_LISTAGEM}`,
    [id, nome, crefito]
  );
  return rows[0] ? mapearFisioterapeuta(rows[0]) : null;
}

export async function atualizarAssinaturaFisioterapeuta(id, { assinaturaImagem, assinaturaMime }) {
  await pool.query(
    "UPDATE fisioterapeutas SET assinatura_imagem = $2, assinatura_mime = $3 WHERE id = $1",
    [id, assinaturaImagem, assinaturaMime]
  );
}

export async function definirAtivoFisioterapeuta(id, ativo) {
  const { rows } = await pool.query(
    "UPDATE fisioterapeutas SET ativo = $2 WHERE id = $1 RETURNING id, nome, crefito, ativo",
    [id, ativo]
  );
  return rows[0] ?? null;
}
