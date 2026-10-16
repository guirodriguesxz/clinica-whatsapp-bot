import { pool } from "../db/pool.js";

const STOPWORDS = new Set([
  "que",
  "para",
  "com",
  "uma",
  "um",
  "dos",
  "das",
  "the",
  "voces",
  "qual",
  "quais",
  "como",
  "onde",
  "quando",
  "tem",
  "por",
  "isso",
  "essa",
  "esse",
  "aqui",
  "sobre",
]);

const DIACRITICOS = new RegExp("[̀-ͯ]", "g");

// Exportado só para teste (test/baseConhecimento.test.js) — a normalização
// (minúsculas, sem acento, sem pontuação) roda ANTES da checagem de
// stopwords, então entradas como "tem?" ou "vocês" nunca dariam match: a
// palavra já chega como "tem" ou "voces" nesse ponto.
export function extrairPalavrasChave(pergunta) {
  const palavras = pergunta
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITICOS, "")
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  return palavras.length ? palavras : [pergunta];
}

// "_" e "%" são curingas do LIKE/ILIKE ("qualquer caractere" e "qualquer
// sequência"), e "\" é o caractere de escape padrão — sem escapar os três
// antes de montar o padrão, uma palavra com underscore (que sobrevive à
// extração de palavras-chave, já que "_" faz parte de \w) ou o fallback de
// extrairPalavrasChave (que devolve a pergunta crua, sem essa filtragem,
// quando nenhuma palavra sobra depois das stopwords) deixam a busca mais
// larga do que o pretendido.
function escaparCuringasLike(texto) {
  return texto.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

// Acentos que o texto salvo na base pode ter — removidos no SQL (translate)
// pra comparar com as palavras-chave, que já chegam sem acento (ver
// extrairPalavrasChave). Sem isso, "fonoaudióloga" na pergunta nunca achava
// "fonoaudióloga" na base. translate() em vez da extensão unaccent, que não
// vem instalada por padrão no Postgres.
const COM_ACENTO = "áàâãäéèêëíìîïóòôõöúùûüç";
const SEM_ACENTO = "aaaaaeeeeiiiiooooouuuuc";
const TEXTO_NORMALIZADO_SQL = `translate(lower(pergunta || ' ' || resposta || ' ' || coalesce(categoria, '')), '${COM_ACENTO}', '${SEM_ACENTO}')`;

/**
 * Busca simples por palavras-chave na base de conhecimento — sem
 * embeddings/busca semântica, para não gerar custo extra de API. Suficiente
 * para uma base pequena de FAQs de clínica.
 *
 * Ordena pela quantidade de palavras-chave que cada entrada contém: sem essa
 * ordem, o LIMIT pegava 3 entradas quaisquer que tivessem uma palavra comum
 * ("fazem", "fisioterapia") e deixava de fora justamente a entrada específica
 * (caso real 2026-09-22: "vocês fazem kinesio taping?" voltava RPG,
 * domiciliar e fonoaudiologia, e não a entrada que fala de kinesio taping).
 */
export async function buscarNaBaseConhecimento(pergunta, limite = 3) {
  const palavras = extrairPalavrasChave(pergunta);
  const patterns = palavras.map((p) => `%${escaparCuringasLike(p.toLowerCase())}%`);

  const { rows } = await pool.query(
    `SELECT id, pergunta, resposta, categoria
     FROM (
       SELECT id, pergunta, resposta, categoria, ${TEXTO_NORMALIZADO_SQL} AS texto
       FROM base_conhecimento
       WHERE ativo = true
     ) b
     WHERE (texto LIKE ANY($1))
     ORDER BY (SELECT count(*) FROM unnest($1::text[]) AS padrao WHERE b.texto LIKE padrao) DESC, id
     LIMIT $2`,
    [patterns, limite]
  );
  return rows;
}

export async function inserirEntradaBaseConhecimento({ pergunta, resposta, categoria }) {
  const { rows } = await pool.query(
    `INSERT INTO base_conhecimento (pergunta, resposta, categoria)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [pergunta, resposta, categoria ?? null]
  );
  return rows[0];
}

export async function listarBaseConhecimento({ apenasAtivos = true } = {}) {
  const filtro = apenasAtivos ? "WHERE ativo = true " : "";
  const { rows } = await pool.query(
    `SELECT id, pergunta, resposta, categoria, ativo, created_at, updated_at
     FROM base_conhecimento ${filtro}ORDER BY created_at DESC`
  );
  return rows;
}

export async function listarEntradasPorCategoria(categorias) {
  const { rows } = await pool.query(
    `SELECT categoria, resposta FROM base_conhecimento
     WHERE ativo = true AND categoria = ANY($1) ORDER BY id`,
    [categorias]
  );
  return rows;
}

export async function buscarEntradaBaseConhecimentoPorId(id) {
  const { rows } = await pool.query(
    `SELECT id, pergunta, resposta, categoria, ativo, created_at, updated_at
     FROM base_conhecimento WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function atualizarEntradaBaseConhecimento(id, { pergunta, resposta, categoria }) {
  const { rows } = await pool.query(
    `UPDATE base_conhecimento
     SET pergunta = $2, resposta = $3, categoria = $4, updated_at = now()
     WHERE id = $1
     RETURNING id, pergunta, resposta, categoria, ativo, created_at, updated_at`,
    [id, pergunta, resposta, categoria ?? null]
  );
  return rows[0] ?? null;
}

export async function definirAtivoEntradaBaseConhecimento(id, ativo) {
  const { rows } = await pool.query(
    "UPDATE base_conhecimento SET ativo = $2 WHERE id = $1 RETURNING id, ativo",
    [id, ativo]
  );
  return rows[0] ?? null;
}
