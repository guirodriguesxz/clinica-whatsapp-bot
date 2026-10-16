import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import webhookRoutes from "./routes/webhookRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import { pool } from "./db/pool.js";
import { capturarErro } from "./config/sentry.js";
import { formatarMoeda } from "./utils/dinheiro.js";
import {
  formatarDataHora,
  formatarData,
  formatarDataExtensa,
  formatarDataComDiaSemana,
} from "./utils/data.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET não configurado — obrigatório para a sessão do dashboard.");
}

const app = express();

// A Railway (e a maioria das plataformas de deploy) coloca exatamente um
// reverse proxy na frente do processo — "1" diz ao Express pra confiar só
// no X-Forwarded-For desse primeiro hop. Sem isso, o rate limiting
// (src/middleware/rateLimit.js) enxerga todas as requisições como vindas de
// um único IP (o do proxy); um valor solto demais (ex: "true") deixaria
// aberto a spoofing de X-Forwarded-For por quem chamar a rota direto.
app.set("trust proxy", 1);
// Headers de reforço que não têm nenhum efeito colateral sobre o app (não
// dependem de inline script/style, então não quebram nada nas views EJS) —
// CSP fica de fora de propósito: várias telas usam onsubmit inline
// (ex: usuarios/lista.ejs) e style inline, que uma CSP restritiva bloquearia
// sem uma revisão maior de todas as views.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});
// Limite de tamanho do corpo — os payloads de webhook da Evolution API são
// pequenos (texto + metadados); sem limite, um POST com corpo enorme fica
// livre para consumir memória do processo.
app.use(express.json({ limit: "1mb" }));
// Formulários HTML do dashboard chegam como x-www-form-urlencoded, não JSON.
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "..", "public")));
// app.locals fica disponível em toda view renderizada via res.render, sem
// precisar passar em cada controller — usado pelas views de /financeiro pra
// formatar valores monetários de forma consistente (ver src/utils/dinheiro.js)
// e por qualquer view que exiba timestamp (created_at, registrado_em) em
// português no fuso da clínica em vez do Date.toString() em inglês do JS
// (ver src/utils/data.js).
app.locals.formatarMoeda = formatarMoeda;
app.locals.formatarDataHora = formatarDataHora;
app.locals.formatarData = formatarData;
app.locals.formatarDataExtensa = formatarDataExtensa;
app.locals.formatarDataComDiaSemana = formatarDataComDiaSemana;

const PgSession = connectPgSimple(session);
app.use(
  session({
    store: new PgSession({
      pool,
      createTableIfMissing: true,
      // O default da lib é limpar a tabela de sessões a cada 15 minutos —
      // um DELETE periódico assim, pra sempre, mantém o Neon acordado quase
      // o tempo todo e consome a cota de horas de computação do plano
      // gratuito (~100h/mês) mesmo sem ninguém logado. As sessões já expiram
      // sozinhas pelo maxAge do cookie, então limpar uma vez por dia basta.
      pruneSessionInterval: 60 * 60 * 24,
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // Em produção (Railway, atrás de HTTPS) o cookie só trafega por HTTPS.
      // Em desenvolvimento local (http://localhost) isso bloquearia o login.
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 12, // 12h
    },
  })
);

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.use(webhookRoutes);
app.use(adminRoutes);
app.use(dashboardRoutes);

// Rede de segurança final: qualquer erro não tratado (síncrono, ou async
// encaminhado via next(err)) cai aqui em vez do handler padrão do Express,
// que em modo não-produção devolveria stack trace no corpo da resposta.
// Express só reconhece middleware de erro com exatamente 4 parâmetros —
// "next" precisa existir mesmo sem uso.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  capturarErro("[app] Erro não tratado:", err);
  res.status(500).json({ erro: "Erro interno do servidor." });
});

export default app;
