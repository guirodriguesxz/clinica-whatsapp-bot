import pg from "pg";
import { capturarErro } from "../config/sentry.js";

const { Pool, types } = pg;

// Por padrão o driver converte a coluna DATE do Postgres num JS Date à meia-
// noite UTC — mas o resto do app trata "data" como string pura "YYYY-MM-DD"
// (validarData, checarDisponibilidade, etc.), nunca como objeto Date. Sem
// isso, qualquer SELECT * que volte uma coluna DATE devolveria um Date que,
// formatado/serializado num fuso diferente de UTC, pode aparentar ser o dia
// anterior ou seguinte.
types.setTypeParser(types.builtins.DATE, (val) => val);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Testado contra o Neon (provedor em uso): o certificado valida
  // normalmente com rejectUnauthorized: true, então a validação completa
  // fica ligada por padrão — sem isso, a conexão continua criptografada,
  // mas fica vulnerável a um MITM que apresente qualquer certificado.
  // Defina DATABASE_SSL=false apenas para Postgres local sem SSL. Se um dia
  // trocar para um provedor cujo certificado o store de CAs do Node não
  // reconheça (ex: alguns poolers do Supabase), defina
  // DATABASE_SSL_REJECT_UNAUTHORIZED=false — nunca desligue por padrão.
  ssl:
    process.env.DATABASE_SSL === "false"
      ? false
      : { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" },
  // O default da lib (10s) fecha a conexão ociosa bem antes do intervalo
  // normal entre cliques de alguém navegando no dashboard — na prática,
  // quase toda página paga de novo o handshake TCP+TLS+Neon (~200ms-1s,
  // medido direto contra produção) mesmo em uso ativo, não só depois de
  // um tempo parado. 5 min cobre o intervalo típico de navegação; o Neon
  // ainda hiberna por conta própria depois de ocioso de verdade (ver
  // README, seção "Banco de dados (Neon)") — esse ~1s ocasional continua
  // existindo e é esperado.
  idleTimeoutMillis: 5 * 60 * 1000,
});

// Provedores como o Neon encerram conexões ociosas do pool (parte normal de
// como eles hibernam para economizar recursos) — sem esse listener, o erro
// emitido pelo Pool nessa hora vira uma exceção não tratada e derruba o
// processo inteiro (via uncaughtException em server.js), mesmo a próxima
// query indo abrir uma conexão nova sem problema nenhum.
pool.on("error", (err) => {
  capturarErro("[pool] Conexão ociosa com o Postgres encerrada pelo provedor:", err);
});
