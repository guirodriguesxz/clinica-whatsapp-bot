# Fundação: usuários + esqueleto do dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar à equipe da Clínica Exemplo um painel web com login próprio (substituto do `/admin` protegido por API key única), rodando no mesmo serviço Express do `clinicaexemplo-bot`, com as telas de agendamentos e pacientes migradas de JSON para HTML.

**Architecture:** Extensão do backend Express existente — sem frontend separado. Dashboard server-rendered com EJS, sessão via cookie guardada no Postgres (`connect-pg-simple`, sem Redis), sem papéis de acesso (login serve só para saber quem fez o quê). CSRF via token de sessão comparado em tempo constante (sem dependência nova). Rotas do dashboard convivem, sem conflito, com `/admin/*` (API key, inalterado) e `/webhook/*`.

**Tech Stack:** Node.js 20+ (ESM), Express 4, EJS, `express-session` + `connect-pg-simple`, `bcrypt`, Postgres (já existente), `node --test` para os testes.

**Spec:** [docs/superpowers/specs/2026-08-27-fundacao-usuarios-dashboard-design.md](../specs/2026-08-27-fundacao-usuarios-dashboard-design.md) — ver também a arquitetura macro em [docs/superpowers/specs/2026-08-27-sistema-clinica-arquitetura-macro-design.md](../specs/2026-08-27-sistema-clinica-arquitetura-macro-design.md).

## Global Constraints

- ESM apenas (`"type": "module"` no `package.json`) — sempre `import`/`export`, nunca `require`.
- Testes com `node --test` (nenhum framework novo de teste).
- Sem frontend separado/SPA — tudo server-rendered no mesmo serviço Express.
- Sem biblioteca de CSRF — token de sessão comparado com `crypto.timingSafeEqual` (reaproveitar o padrão de `compararSeguro` já existente em `src/middleware/auth.js`).
- Sem fluxo de "esqueci minha senha" nesta etapa.
- Sem papéis/permissões — todo usuário logado vê e faz tudo.
- `bcrypt` com custo 12.
- Sessão guardada no Postgres via `connect-pg-simple` (sem Redis).
- As rotas `/admin/*` (API key) e `/webhook/*` continuam exatamente como estão — não remover, não migrar nesta etapa.
- Seguir os padrões já existentes no projeto: `asyncHandler` para handlers assíncronos, `capturarErro` (de `src/config/sentry.js`) para logar erros, comentários só quando o "porquê" não é óbvio (padrão observado em todo o código atual).

---

## Task 1: Migration `009_usuarios_dashboard.sql`

**Files:**
- Create: `src/db/migrations/009_usuarios_dashboard.sql`

**Interfaces:**
- Produces: tabela `usuarios(id, nome, email, senha_hash, ativo, created_at)`, consumida por `src/models/usuarioModel.js` (Task 5).

- [ ] **Step 1: Escrever a migration**

```sql
-- Clínica Exemplo Bot — migration 009: usuários do dashboard administrativo.
-- Rodar no SQL Editor do Neon (ou via psql) depois de 008_permite_agendamento_simultaneo.sql.

-- Login individual de cada pessoa da equipe — sem papéis/permissões
-- diferenciadas (todo mundo vê e faz tudo no dashboard). O login existe para
-- registrar quem fez cada ação, não para restringir acesso. Substitui a API
-- key única (ADMIN_API_KEY) usada pelas rotas /admin, que não serve para
-- múltiplas pessoas.
CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mesmo cuidado das migrations anteriores: RLS/REVOKE de "anon"/"authenticated"
-- são específicos do Supabase, guardados atrás de uma checagem pra não dar
-- erro em outro Postgres (ex: Neon) onde essas roles não existem.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON usuarios FROM anon, authenticated;
  END IF;
END $$;
```

- [ ] **Step 2: Aplicar a migration no banco de desenvolvimento**

Run: `psql "$DATABASE_URL" -f src/db/migrations/009_usuarios_dashboard.sql`

(Ou cole o conteúdo no SQL Editor do Neon, se preferir.)

Expected: nenhum erro; `psql "$DATABASE_URL" -c "\d usuarios"` mostra as 5 colunas.

- [ ] **Step 3: Commit**

```bash
git add src/db/migrations/009_usuarios_dashboard.sql
git commit -m "feat: adiciona tabela usuarios (migration 009)"
```

---

## Task 2: Instalar dependências novas

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Instalar**

```bash
npm install express-session connect-pg-simple bcrypt ejs
```

Expected: `package.json` ganha as 4 dependências em `dependencies`; `npm run lint` continua passando sem erros novos.

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: adiciona dependências do dashboard (express-session, connect-pg-simple, bcrypt, ejs)"
```

---

## Task 3: `senhaService.js` (hash e comparação de senha)

**Files:**
- Create: `src/services/senhaService.js`
- Test: `test/senhaService.test.js`

**Interfaces:**
- Produces: `hashSenha(senha: string): Promise<string>`, `compararSenha(senha: string, hash: string): Promise<boolean>` — consumidos por `dashboardController.js` (Tasks 9 e 11) e pelo script `criar-primeiro-usuario.js` (Task 6).

- [ ] **Step 1: Escrever o teste (vai falhar — o módulo ainda não existe)**

```js
// test/senhaService.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { hashSenha, compararSenha } from "../src/services/senhaService.js";

test("hashSenha nunca devolve a senha em texto puro", async () => {
  const hash = await hashSenha("minhaSenha123");
  assert.notEqual(hash, "minhaSenha123");
  assert.match(hash, /^\$2[aby]\$/);
});

test("compararSenha retorna true para a senha correta", async () => {
  const hash = await hashSenha("minhaSenha123");
  assert.equal(await compararSenha("minhaSenha123", hash), true);
});

test("compararSenha retorna false para senha errada", async () => {
  const hash = await hashSenha("minhaSenha123");
  assert.equal(await compararSenha("outraSenha", hash), false);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/senhaService.test.js`
Expected: FAIL — `Cannot find module '../src/services/senhaService.js'`

- [ ] **Step 3: Implementar**

```js
// src/services/senhaService.js
import bcrypt from "bcrypt";

const CUSTO_HASH = 12;

export async function hashSenha(senha) {
  return bcrypt.hash(senha, CUSTO_HASH);
}

export async function compararSenha(senha, hash) {
  return bcrypt.compare(senha, hash);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/senhaService.test.js`
Expected: PASS (3 testes)

- [ ] **Step 5: Commit**

```bash
git add src/services/senhaService.js test/senhaService.test.js
git commit -m "feat: adiciona serviço de hash de senha (bcrypt)"
```

---

## Task 4: Token CSRF (`utils/csrf.js`) + exportar `compararSeguro`

**Files:**
- Modify: `src/middleware/auth.js` (exportar `compararSeguro`)
- Create: `src/utils/csrf.js`
- Test: `test/csrf.test.js`

**Interfaces:**
- Consumes: `compararSeguro(a: string, b: string): boolean` de `src/middleware/auth.js`.
- Produces: `gerarTokenCsrf(): string`, `tokenCsrfValido(tokenSessao: string|undefined, tokenRecebido: string|undefined): boolean` — consumidos por `dashboardAuth.js` (Task 7).

- [ ] **Step 1: Exportar `compararSeguro`**

Em `src/middleware/auth.js`, trocar:

```js
function compararSeguro(a, b) {
```

por:

```js
export function compararSeguro(a, b) {
```

(Nenhuma outra mudança no arquivo — as duas funções que já usam `compararSeguro` continuam iguais.)

- [ ] **Step 2: Escrever o teste do CSRF (vai falhar — o módulo ainda não existe)**

```js
// test/csrf.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { gerarTokenCsrf, tokenCsrfValido } from "../src/utils/csrf.js";

test("gerarTokenCsrf gera tokens diferentes a cada chamada", () => {
  const a = gerarTokenCsrf();
  const b = gerarTokenCsrf();
  assert.notEqual(a, b);
  assert.equal(a.length, 64);
});

test("tokenCsrfValido aceita quando os tokens são iguais", () => {
  const token = gerarTokenCsrf();
  assert.equal(tokenCsrfValido(token, token), true);
});

test("tokenCsrfValido rejeita quando os tokens são diferentes", () => {
  assert.equal(tokenCsrfValido(gerarTokenCsrf(), gerarTokenCsrf()), false);
});

test("tokenCsrfValido rejeita quando não há token na sessão", () => {
  assert.equal(tokenCsrfValido(undefined, "qualquer"), false);
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `node --test test/csrf.test.js`
Expected: FAIL — `Cannot find module '../src/utils/csrf.js'`

- [ ] **Step 4: Implementar**

```js
// src/utils/csrf.js
import crypto from "node:crypto";
import { compararSeguro } from "../middleware/auth.js";

export function gerarTokenCsrf() {
  return crypto.randomBytes(32).toString("hex");
}

export function tokenCsrfValido(tokenSessao, tokenRecebido) {
  if (!tokenSessao) return false;
  return compararSeguro(tokenSessao, tokenRecebido);
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `node --test test/csrf.test.js`
Expected: PASS (4 testes)

- [ ] **Step 6: Rodar a suíte inteira, pra garantir que exportar `compararSeguro` não quebrou nada**

Run: `npm test`
Expected: PASS (todos os testes, incluindo os já existentes)

- [ ] **Step 7: Commit**

```bash
git add src/middleware/auth.js src/utils/csrf.js test/csrf.test.js
git commit -m "feat: adiciona geração/validação de token CSRF para o dashboard"
```

---

## Task 5: `usuarioModel.js`

**Files:**
- Create: `src/models/usuarioModel.js`

**Interfaces:**
- Produces: `buscarUsuarioPorEmail(email: string): Promise<Usuario|null>`, `buscarUsuarioPorId(id: number): Promise<Usuario|null>`, `criarUsuario({nome, email, senhaHash}): Promise<Usuario>` — consumidos por `dashboardAuth.js` (Task 7), `dashboardController.js` (Tasks 9 e 11) e `criar-primeiro-usuario.js` (Task 6). `Usuario` tem as colunas de `usuarios` (Task 1): `id, nome, email, senha_hash, ativo, created_at`.

Sem teste automatizado nesta task — mesmo padrão já usado em `agendamentoModel.js`/`pacienteModel.js`/`baseConhecimentoModel.js`: funções que só fazem `pool.query` não têm teste unitário no projeto (não há banco de teste em CI). Verificação é manual (Step 3).

- [ ] **Step 1: Implementar**

```js
// src/models/usuarioModel.js
import { pool } from "../db/pool.js";

export async function buscarUsuarioPorEmail(email) {
  const { rows } = await pool.query("SELECT * FROM usuarios WHERE email = $1", [email]);
  return rows[0] ?? null;
}

export async function buscarUsuarioPorId(id) {
  const { rows } = await pool.query("SELECT * FROM usuarios WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function criarUsuario({ nome, email, senhaHash }) {
  const { rows } = await pool.query(
    `INSERT INTO usuarios (nome, email, senha_hash) VALUES ($1, $2, $3) RETURNING *`,
    [nome, email, senhaHash]
  );
  return rows[0];
}
```

- [ ] **Step 2: Rodar lint**

Run: `npm run lint`
Expected: sem erros novos.

- [ ] **Step 3: Verificação manual (smoke test contra o Postgres de desenvolvimento)**

```bash
node --input-type=module -e "
import { criarUsuario, buscarUsuarioPorEmail } from './src/models/usuarioModel.js';
import { pool } from './src/db/pool.js';
const criado = await criarUsuario({ nome: 'Smoke Test', email: 'smoke-test@example.com', senhaHash: 'hash-fake' });
console.log('criado:', criado);
const encontrado = await buscarUsuarioPorEmail('smoke-test@example.com');
console.log('encontrado por email:', encontrado);
await pool.end();
"
```

Expected: os dois `console.log` mostram o mesmo registro (id, nome, email, ativo `true`).

Depois, apague a linha de teste:

```bash
psql "$DATABASE_URL" -c "DELETE FROM usuarios WHERE email = 'smoke-test@example.com';"
```

- [ ] **Step 4: Commit**

```bash
git add src/models/usuarioModel.js
git commit -m "feat: adiciona usuarioModel (buscar por e-mail/id, criar usuário)"
```

---

## Task 6: Script de bootstrap do primeiro usuário

**Files:**
- Create: `src/db/criar-primeiro-usuario.js`

**Interfaces:**
- Consumes: `hashSenha` (Task 3), `criarUsuario` (Task 5), `pool` (`src/db/pool.js`).

Sem essa etapa não existe forma de criar o primeiro login: a tela `/usuarios/novo` (Task 11) fica atrás de `exigirLogin`, então ela serve para criar o *segundo* usuário em diante, nunca o primeiro.

- [ ] **Step 1: Implementar**

```js
// src/db/criar-primeiro-usuario.js
// Cria um usuário do dashboard direto no banco — necessário para o
// primeiro login, já que a tela /usuarios/novo exige estar logado (não
// existe autocadastro público). Depois do primeiro usuário, use a própria
// tela /usuarios/novo.
// Rodar com: node src/db/criar-primeiro-usuario.js "Nome Completo" email@exemplo.com "SenhaForte123"

import "dotenv/config";
import { criarUsuario } from "../models/usuarioModel.js";
import { hashSenha } from "../services/senhaService.js";
import { pool } from "./pool.js";

const [, , nome, email, senha] = process.argv;

if (!nome || !email || !senha) {
  console.error(
    'Uso: node src/db/criar-primeiro-usuario.js "Nome Completo" email@exemplo.com "SenhaForte123"'
  );
  process.exit(1);
}

if (senha.length < 8) {
  console.error("A senha precisa ter pelo menos 8 caracteres.");
  process.exit(1);
}

const senhaHash = await hashSenha(senha);
const usuario = await criarUsuario({ nome, email, senhaHash });
console.log("Usuário criado:", { id: usuario.id, nome: usuario.nome, email: usuario.email });

await pool.end();
```

- [ ] **Step 2: Rodar de verdade contra o banco de desenvolvimento, criando o usuário que será usado para testar o login nas próximas tasks**

Run: `node src/db/criar-primeiro-usuario.js "Seu Nome" seu-email@exemplo.com "SenhaDeTeste123"`
Expected: imprime `Usuário criado: { id: 1, nome: 'Seu Nome', email: 'seu-email@exemplo.com' }` e o processo termina sozinho (sem ficar pendurado).

- [ ] **Step 3: Commit**

```bash
git add src/db/criar-primeiro-usuario.js
git commit -m "feat: adiciona script de bootstrap do primeiro usuário do dashboard"
```

---

## Task 7: Middleware `dashboardAuth.js` (`exigirLogin` + `exigirCsrf`)

**Files:**
- Create: `src/middleware/dashboardAuth.js`
- Test: `test/dashboardAuth.test.js`

**Interfaces:**
- Consumes: `buscarUsuarioPorId` (Task 5), `gerarTokenCsrf`/`tokenCsrfValido` (Task 4).
- Produces: `exigirLogin(req, res, next): Promise<void>` (redireciona para `/login` sem sessão válida; caso contrário define `req.usuarioAtual`, `res.locals.usuarioAtual` e `res.locals.csrfToken`, e chama `next()`), `exigirCsrf(req, res, next): void` (responde 403 se `req.body._csrf` não bater com `req.session.csrfToken`) — consumidos por `dashboardRoutes.js` (Task 9).

- [ ] **Step 1: Escrever os testes (vão falhar — o módulo ainda não existe)**

```js
// test/dashboardAuth.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { exigirLogin, exigirCsrf } from "../src/middleware/dashboardAuth.js";

function criarRespostaFalsa() {
  return {
    redirectedTo: null,
    statusCode: null,
    body: null,
    redirect(url) {
      this.redirectedTo = url;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
    },
  };
}

test("exigirLogin redireciona para /login quando não há sessão", async () => {
  const req = { session: {} };
  const res = criarRespostaFalsa();
  let chamouNext = false;
  await exigirLogin(req, res, () => {
    chamouNext = true;
  });
  assert.equal(res.redirectedTo, "/login");
  assert.equal(chamouNext, false);
});

test("exigirCsrf chama next quando o token bate", () => {
  const req = { session: { csrfToken: "abc123" }, body: { _csrf: "abc123" } };
  const res = criarRespostaFalsa();
  let chamouNext = false;
  exigirCsrf(req, res, () => {
    chamouNext = true;
  });
  assert.equal(chamouNext, true);
});

test("exigirCsrf responde 403 quando o token não bate", () => {
  const req = { session: { csrfToken: "abc123" }, body: { _csrf: "errado" } };
  const res = criarRespostaFalsa();
  let chamouNext = false;
  exigirCsrf(req, res, () => {
    chamouNext = true;
  });
  assert.equal(chamouNext, false);
  assert.equal(res.statusCode, 403);
});

test("exigirCsrf responde 403 quando não há token no corpo", () => {
  const req = { session: { csrfToken: "abc123" }, body: {} };
  const res = criarRespostaFalsa();
  let chamouNext = false;
  exigirCsrf(req, res, () => {
    chamouNext = true;
  });
  assert.equal(chamouNext, false);
  assert.equal(res.statusCode, 403);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/dashboardAuth.test.js`
Expected: FAIL — `Cannot find module '../src/middleware/dashboardAuth.js'`

- [ ] **Step 3: Implementar**

```js
// src/middleware/dashboardAuth.js
import { buscarUsuarioPorId } from "../models/usuarioModel.js";
import { gerarTokenCsrf, tokenCsrfValido } from "../utils/csrf.js";

/**
 * Protege as rotas do dashboard. Recarrega o usuário a cada requisição (em
 * vez de confiar só no id gravado na sessão) para respeitar `ativo = false`
 * imediatamente, sem esperar a sessão expirar.
 */
export async function exigirLogin(req, res, next) {
  const usuarioId = req.session?.usuarioId;
  if (!usuarioId) {
    return res.redirect("/login");
  }

  const usuario = await buscarUsuarioPorId(usuarioId);
  if (!usuario || !usuario.ativo) {
    return req.session.destroy(() => res.redirect("/login"));
  }

  if (!req.session.csrfToken) {
    req.session.csrfToken = gerarTokenCsrf();
  }

  req.usuarioAtual = usuario;
  res.locals.usuarioAtual = usuario;
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

export function exigirCsrf(req, res, next) {
  const tokenRecebido = req.body?._csrf;
  if (!tokenCsrfValido(req.session?.csrfToken, tokenRecebido)) {
    return res
      .status(403)
      .send("Sessão expirada ou inválida — recarregue a página e tente de novo.");
  }
  next();
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/dashboardAuth.test.js`
Expected: PASS (4 testes)

- [ ] **Step 5: Commit**

```bash
git add src/middleware/dashboardAuth.js test/dashboardAuth.test.js
git commit -m "feat: adiciona middleware de autenticação e CSRF do dashboard"
```

---

## Task 8: Sessão + view engine + layout base + CSS

**Files:**
- Modify: `src/app.js`
- Modify: `.env.example`
- Create: `src/views/partials/header.ejs`
- Create: `src/views/partials/footer.ejs`
- Create: `public/dashboard.css`

**Interfaces:**
- Produces: `app.set("view engine", "ejs")` configurado com `views` em `src/views`; middleware de sessão (`req.session`) disponível em toda a app; `/dashboard.css` servido como estático — usados por todas as views das próximas tasks.

- [ ] **Step 1: Adicionar `SESSION_SECRET` ao `.env.example`**

Adicionar, ao final do arquivo:

```
# Segredo da sessão do dashboard (gere com: openssl rand -hex 32).
SESSION_SECRET=
```

- [ ] **Step 2: Criar o CSS**

```css
/* public/dashboard.css */
:root {
  color-scheme: light;
  --cor-texto: #1f2933;
  --cor-fundo: #f7fafc;
  --cor-borda: #d2d6dc;
  --cor-primaria: #2563eb;
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--cor-texto);
  background: var(--cor-fundo);
}
header.topo {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1.5rem;
  background: #fff;
  border-bottom: 1px solid var(--cor-borda);
}
header.topo nav a {
  margin-right: 1rem;
  color: var(--cor-primaria);
  text-decoration: none;
}
.form-logout {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
main {
  max-width: 960px;
  margin: 2rem auto;
  padding: 0 1.5rem;
}
table {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
}
th,
td {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--cor-borda);
  text-align: left;
}
form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-width: 320px;
}
label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.9rem;
}
input {
  padding: 0.5rem;
  border: 1px solid var(--cor-borda);
  border-radius: 4px;
}
button {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  background: var(--cor-primaria);
  color: #fff;
  cursor: pointer;
}
.erro {
  color: #b91c1c;
}
.sucesso {
  color: #15803d;
}
```

- [ ] **Step 3: Criar os partials**

```ejs
<!-- src/views/partials/header.ejs -->
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title><%= titulo %> — Clínica Exemplo</title>
    <link rel="stylesheet" href="/dashboard.css" />
  </head>
  <body>
    <% if (typeof usuarioAtual !== "undefined" && usuarioAtual) { %>
    <header class="topo">
      <nav>
        <a href="/agendamentos">Agendamentos</a>
        <a href="/pacientes">Pacientes</a>
        <a href="/usuarios/novo">Novo usuário</a>
      </nav>
      <form method="post" action="/logout" class="form-logout">
        <input type="hidden" name="_csrf" value="<%= csrfToken %>" />
        <span>Logado como <%= usuarioAtual.nome %></span>
        <button type="submit">Sair</button>
      </form>
    </header>
    <% } %>
    <main>
```

```ejs
<!-- src/views/partials/footer.ejs -->
    </main>
  </body>
</html>
```

- [ ] **Step 4: Editar `src/app.js`**

```js
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import webhookRoutes from "./routes/webhookRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import { pool } from "./db/pool.js";
import { capturarErro } from "./config/sentry.js";

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
// Limite de tamanho do corpo — os payloads de webhook da Evolution API são
// pequenos (texto + metadados); sem limite, um POST com corpo enorme fica
// livre para consumir memória do processo.
app.use(express.json({ limit: "1mb" }));
// Formulários HTML do dashboard chegam como x-www-form-urlencoded, não JSON.
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "..", "public")));

const PgSession = connectPgSimple(session);
app.use(
  session({
    store: new PgSession({ pool, createTableIfMissing: true }),
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
```

(`dashboardRoutes` ainda não existe — entra no `app.use` na Task 9, junto com a primeira rota real.)

- [ ] **Step 5: Definir `SESSION_SECRET` no `.env` local e subir o servidor**

```bash
echo "SESSION_SECRET=$(openssl rand -hex 32)" >> .env
npm run dev
```

Expected: servidor sobe sem lançar o erro de `SESSION_SECRET`; `curl http://localhost:3000/health` continua respondendo `{"status":"ok"}`.

- [ ] **Step 6: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS (nenhum teste importa `app.js` diretamente, então nada quebra por causa do `throw` de `SESSION_SECRET`).

- [ ] **Step 7: Commit**

```bash
git add src/app.js .env.example src/views/partials public/dashboard.css
git commit -m "feat: configura sessão, view engine e layout base do dashboard"
```

---

## Task 9: Tela de login

**Files:**
- Modify: `src/middleware/rateLimit.js` (adicionar `dashboardLoginLimiter`)
- Create: `src/views/login.ejs`
- Create: `src/controllers/dashboardController.js` (funções `telaLogin`, `processarLogin` — mais funções nas próximas tasks)
- Create: `src/routes/dashboardRoutes.js` (rotas `/login` — mais rotas nas próximas tasks)
- Modify: `src/app.js` (montar `dashboardRoutes`)

**Interfaces:**
- Consumes: `buscarUsuarioPorEmail` (Task 5), `compararSenha` (Task 3).
- Produces: `telaLogin(req, res): void`, `processarLogin(req, res): Promise<void>` — a rota `POST /login` autentica e grava `req.session.usuarioId`.

- [ ] **Step 1: Adicionar o rate limiter em `src/middleware/rateLimit.js`**

Adicionar ao final do arquivo:

```js
// Limite mais apertado que o adminLimiter — dificulta força bruta de senha
// sem incomodar um usuário real que errou a senha uma ou duas vezes.
export const dashboardLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});
```

- [ ] **Step 2: Criar a view**

```ejs
<!-- src/views/login.ejs -->
<%- include("partials/header", { titulo: "Login" }) %>
<h1>Entrar</h1>
<% if (erro) { %>
<p class="erro"><%= erro %></p>
<% } %>
<form method="post" action="/login">
  <label>E-mail<input type="email" name="email" required autofocus /></label>
  <label>Senha<input type="password" name="senha" required /></label>
  <button type="submit">Entrar</button>
</form>
<%- include("partials/footer") %>
```

- [ ] **Step 3: Criar o controller**

```js
// src/controllers/dashboardController.js
import { buscarUsuarioPorEmail } from "../models/usuarioModel.js";
import { compararSenha } from "../services/senhaService.js";
import { capturarErro } from "../config/sentry.js";

export function telaLogin(req, res) {
  if (req.session?.usuarioId) {
    return res.redirect("/agendamentos");
  }
  res.render("login", { erro: null });
}

export async function processarLogin(req, res) {
  const { email, senha } = req.body ?? {};
  const mensagemErroGenerica = "E-mail ou senha inválidos.";

  if (!email || !senha) {
    return res.status(400).render("login", { erro: mensagemErroGenerica });
  }

  const usuario = await buscarUsuarioPorEmail(email);
  if (!usuario || !usuario.ativo || !(await compararSenha(senha, usuario.senha_hash))) {
    return res.status(401).render("login", { erro: mensagemErroGenerica });
  }

  req.session.regenerate((err) => {
    if (err) {
      capturarErro("[dashboardController] Erro ao regenerar sessão no login:", err);
      return res.status(500).render("login", { erro: "Erro interno. Tente novamente." });
    }
    req.session.usuarioId = usuario.id;
    res.redirect("/agendamentos");
  });
}
```

- [ ] **Step 4: Criar as rotas**

```js
// src/routes/dashboardRoutes.js
import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { dashboardLoginLimiter } from "../middleware/rateLimit.js";
import { telaLogin, processarLogin } from "../controllers/dashboardController.js";

const router = Router();

router.get("/login", telaLogin);
router.post("/login", dashboardLoginLimiter, asyncHandler(processarLogin));

export default router;
```

- [ ] **Step 5: Montar as rotas em `src/app.js`**

Adicionar o import:

```js
import dashboardRoutes from "./routes/dashboardRoutes.js";
```

E, logo depois de `app.use(adminRoutes);`:

```js
app.use(dashboardRoutes);
```

- [ ] **Step 6: Verificação manual no navegador**

```bash
npm run dev
```

Abra `http://localhost:3000/login`, entre com o e-mail/senha criados na Task 6 (`node src/db/criar-primeiro-usuario.js ...`).

Expected: login correto redireciona para `/agendamentos` (ainda sem rota — vai dar 404 até a Task 12, o que é esperado agora); e-mail ou senha errados mostram "E-mail ou senha inválidos." na própria tela de login.

- [ ] **Step 7: Commit**

```bash
git add src/middleware/rateLimit.js src/views/login.ejs src/controllers/dashboardController.js src/routes/dashboardRoutes.js src/app.js
git commit -m "feat: adiciona tela de login do dashboard"
```

---

## Task 10: Logout

**Files:**
- Modify: `src/controllers/dashboardController.js` (adicionar `processarLogout`)
- Modify: `src/routes/dashboardRoutes.js` (adicionar rota `POST /logout`)

**Interfaces:**
- Consumes: `exigirLogin`, `exigirCsrf` (Task 7).
- Produces: `processarLogout(req, res): void`.

- [ ] **Step 1: Adicionar `processarLogout` ao controller**

```js
export function processarLogout(req, res) {
  req.session.destroy(() => {
    res.redirect("/login");
  });
}
```

- [ ] **Step 2: Atualizar as rotas**

```js
// src/routes/dashboardRoutes.js
import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { dashboardLoginLimiter } from "../middleware/rateLimit.js";
import { exigirLogin, exigirCsrf } from "../middleware/dashboardAuth.js";
import { telaLogin, processarLogin, processarLogout } from "../controllers/dashboardController.js";

const router = Router();

router.get("/login", telaLogin);
router.post("/login", dashboardLoginLimiter, asyncHandler(processarLogin));
router.post("/logout", asyncHandler(exigirLogin), exigirCsrf, processarLogout);

export default router;
```

- [ ] **Step 3: Verificação manual**

Com o servidor rodando (`npm run dev`), logue em `/login` e clique em "Sair" no cabeçalho (o header já renderiza esse formulário desde a Task 8, mas só aparece em página que passa `usuarioAtual`/`csrfToken` — como nenhuma tela protegida existe ainda além do próprio `/logout`, confirme via curl):

```bash
curl -i -c cookies.txt -d "email=seu-email@exemplo.com" -d "senha=SenhaDeTeste123" http://localhost:3000/login
# pegue o valor de csrfToken: não dá pra ver via curl puro (é gerado só quando uma rota com exigirLogin roda) —
# confirme o logout de verdade pelo navegador depois da Task 12, quando /agendamentos existir.
```

Expected (confirmação definitiva fica pra Task 12, quando há uma tela protegida de verdade pra logar, ver o botão "Sair" e clicar): por ora, confirme que `POST /logout` sem sessão redireciona para `/login` (o `exigirLogin` cuida disso):

```bash
curl -i -X POST http://localhost:3000/logout
```

Expected: `HTTP/1.1 302 Found` com `Location: /login`.

- [ ] **Step 4: Commit**

```bash
git add src/controllers/dashboardController.js src/routes/dashboardRoutes.js
git commit -m "feat: adiciona logout do dashboard"
```

---

## Task 11: Tela de criar usuário

**Files:**
- Create: `src/views/usuarios/novo.ejs`
- Modify: `src/controllers/dashboardController.js` (adicionar `telaNovoUsuario`, `processarNovoUsuario`)
- Modify: `src/routes/dashboardRoutes.js` (adicionar rotas `GET/POST /usuarios`)

**Interfaces:**
- Consumes: `hashSenha` (Task 3), `criarUsuario` (Task 5), `exigirLogin`/`exigirCsrf` (Task 7).
- Produces: `telaNovoUsuario(req, res): void`, `processarNovoUsuario(req, res): Promise<void>`.

- [ ] **Step 1: Criar a view**

```ejs
<!-- src/views/usuarios/novo.ejs -->
<%- include("../partials/header", { titulo: "Novo usuário" }) %>
<h1>Novo usuário</h1>
<% if (sucesso) { %>
<p class="sucesso">Usuário criado com sucesso.</p>
<% } %>
<% if (erro) { %>
<p class="erro"><%= erro %></p>
<% } %>
<form method="post" action="/usuarios">
  <input type="hidden" name="_csrf" value="<%= csrfToken %>" />
  <label>Nome<input type="text" name="nome" required /></label>
  <label>E-mail<input type="email" name="email" required /></label>
  <label>Senha<input type="password" name="senha" required minlength="8" /></label>
  <button type="submit">Criar</button>
</form>
<%- include("../partials/footer") %>
```

- [ ] **Step 2: Adicionar os controllers**

```js
import { buscarUsuarioPorEmail, criarUsuario } from "../models/usuarioModel.js";
import { hashSenha, compararSenha } from "../services/senhaService.js";

export function telaNovoUsuario(req, res) {
  res.render("usuarios/novo", { sucesso: req.query.sucesso === "1", erro: null });
}

export async function processarNovoUsuario(req, res) {
  const { nome, email, senha } = req.body ?? {};

  if (!nome || !email || !senha || senha.length < 8) {
    return res.status(400).render("usuarios/novo", {
      sucesso: false,
      erro: "Preencha nome, e-mail e uma senha com pelo menos 8 caracteres.",
    });
  }

  try {
    const senhaHash = await hashSenha(senha);
    await criarUsuario({ nome, email, senhaHash });
    res.redirect("/usuarios/novo?sucesso=1");
  } catch (err) {
    if (err.code === "23505") {
      return res.status(400).render("usuarios/novo", {
        sucesso: false,
        erro: "Já existe um usuário com esse e-mail.",
      });
    }
    throw err;
  }
}
```

(Ajustar o import já existente de `buscarUsuarioPorEmail`/`compararSenha` no topo do arquivo — eles já estão importados pela Task 9; não duplicar a linha de import.)

- [ ] **Step 3: Atualizar as rotas**

```js
// src/routes/dashboardRoutes.js
import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { dashboardLoginLimiter } from "../middleware/rateLimit.js";
import { exigirLogin, exigirCsrf } from "../middleware/dashboardAuth.js";
import {
  telaLogin,
  processarLogin,
  processarLogout,
  telaNovoUsuario,
  processarNovoUsuario,
} from "../controllers/dashboardController.js";

const router = Router();

router.get("/login", telaLogin);
router.post("/login", dashboardLoginLimiter, asyncHandler(processarLogin));
router.post("/logout", asyncHandler(exigirLogin), exigirCsrf, processarLogout);

router.get("/usuarios/novo", asyncHandler(exigirLogin), telaNovoUsuario);
router.post(
  "/usuarios",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarNovoUsuario)
);

export default router;
```

- [ ] **Step 4: Verificação manual**

Com `npm run dev` rodando: logue em `/login`, acesse `/usuarios/novo`, crie um segundo usuário. Confirme: (a) o header mostra "Logado como [seu nome]" e o botão "Sair"; (b) o novo usuário consegue logar em `/login` depois de deslogar; (c) tentar criar de novo com o mesmo e-mail mostra "Já existe um usuário com esse e-mail."; (d) clicar em "Sair" de fato encerra a sessão (tentar acessar `/usuarios/novo` de novo redireciona pra `/login`).

- [ ] **Step 5: Commit**

```bash
git add src/views/usuarios/novo.ejs src/controllers/dashboardController.js src/routes/dashboardRoutes.js
git commit -m "feat: adiciona tela de criação de usuário do dashboard"
```

---

## Task 12: Migrar tela de agendamentos

**Files:**
- Create: `src/views/agendamentos/lista.ejs`
- Modify: `src/controllers/dashboardController.js` (adicionar `telaAgendamentos`)
- Modify: `src/routes/dashboardRoutes.js` (adicionar rota `GET /agendamentos`)

**Interfaces:**
- Consumes: `listarAgendamentos({status, limite, offset})` (já existe em `src/models/agendamentoModel.js`), `exigirLogin` (Task 7).
- Produces: `telaAgendamentos(req, res): Promise<void>`.

- [ ] **Step 1: Criar a view**

```ejs
<!-- src/views/agendamentos/lista.ejs -->
<%- include("../partials/header", { titulo: "Agendamentos" }) %>
<h1>Agendamentos</h1>
<table>
  <thead>
    <tr>
      <th>Data</th>
      <th>Hora</th>
      <th>Paciente</th>
      <th>Telefone</th>
      <th>Tipo</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>
    <% agendamentos.forEach((a) => { %>
    <tr>
      <td><%= a.data %></td>
      <td><%= a.hora %></td>
      <td><%= a.paciente_nome %></td>
      <td><%= a.paciente_telefone %></td>
      <td><%= a.tipo_atendimento %></td>
      <td><%= a.status %></td>
    </tr>
    <% }) %>
  </tbody>
</table>
<%- include("../partials/footer") %>
```

- [ ] **Step 2: Adicionar o controller**

Adicionar ao topo de `src/controllers/dashboardController.js`:

```js
import { listarAgendamentos } from "../models/agendamentoModel.js";
```

E a função:

```js
export async function telaAgendamentos(req, res) {
  const { status, limite, offset } = req.query;
  const agendamentos = await listarAgendamentos({ status, limite, offset });
  res.render("agendamentos/lista", { agendamentos });
}
```

- [ ] **Step 3: Atualizar as rotas**

Adicionar ao import de `dashboardController.js` em `dashboardRoutes.js` a função `telaAgendamentos`, e adicionar a rota:

```js
router.get("/agendamentos", asyncHandler(exigirLogin), asyncHandler(telaAgendamentos));
```

- [ ] **Step 4: Verificação manual**

Logue no dashboard e acesse `/agendamentos`. Expected: tabela com os mesmos dados que `GET /admin/agendamentos?chave=$ADMIN_API_KEY` já devolve hoje (compare os dois lado a lado). O link "Agendamentos" do header (já existe desde a Task 8) agora leva a uma página de verdade em vez de 404.

- [ ] **Step 5: Commit**

```bash
git add src/views/agendamentos/lista.ejs src/controllers/dashboardController.js src/routes/dashboardRoutes.js
git commit -m "feat: migra listagem de agendamentos para o dashboard"
```

---

## Task 13: Migrar tela de pacientes

**Files:**
- Create: `src/views/pacientes/lista.ejs`
- Modify: `src/controllers/dashboardController.js` (adicionar `telaPacientes`)
- Modify: `src/routes/dashboardRoutes.js` (adicionar rota `GET /pacientes`)

**Interfaces:**
- Consumes: `listarPacientes({limite, offset})` (já existe em `src/models/pacienteModel.js`), `exigirLogin` (Task 7).
- Produces: `telaPacientes(req, res): Promise<void>`.

- [ ] **Step 1: Criar a view**

```ejs
<!-- src/views/pacientes/lista.ejs -->
<%- include("../partials/header", { titulo: "Pacientes" }) %>
<h1>Pacientes</h1>
<table>
  <thead>
    <tr>
      <th>Nome</th>
      <th>Telefone</th>
      <th>Convênio</th>
      <th>Cadastrado em</th>
    </tr>
  </thead>
  <tbody>
    <% pacientes.forEach((p) => { %>
    <tr>
      <td><%= p.nome %></td>
      <td><%= p.telefone %></td>
      <td><%= p.convenio ?? "—" %></td>
      <td><%= p.created_at %></td>
    </tr>
    <% }) %>
  </tbody>
</table>
<%- include("../partials/footer") %>
```

- [ ] **Step 2: Adicionar o controller**

Adicionar ao topo de `src/controllers/dashboardController.js`:

```js
import { listarPacientes } from "../models/pacienteModel.js";
```

E a função:

```js
export async function telaPacientes(req, res) {
  const { limite, offset } = req.query;
  const pacientes = await listarPacientes({ limite, offset });
  res.render("pacientes/lista", { pacientes });
}
```

- [ ] **Step 3: Atualizar as rotas**

Adicionar ao import de `dashboardController.js` em `dashboardRoutes.js` a função `telaPacientes`, e adicionar a rota:

```js
router.get("/pacientes", asyncHandler(exigirLogin), asyncHandler(telaPacientes));
```

- [ ] **Step 4: Verificação manual**

Logue no dashboard e acesse `/pacientes`. Expected: tabela com os mesmos dados que `GET /admin/pacientes?chave=$ADMIN_API_KEY` já devolve hoje.

- [ ] **Step 5: Commit**

```bash
git add src/views/pacientes/lista.ejs src/controllers/dashboardController.js src/routes/dashboardRoutes.js
git commit -m "feat: migra listagem de pacientes para o dashboard"
```

---

## Task 14: Redirecionamento raiz, README e verificação final end-to-end

**Files:**
- Modify: `src/routes/dashboardRoutes.js` (adicionar rota `GET /`)
- Modify: `README.md` (nova seção sobre o dashboard)

**Interfaces:**
- Produces: `GET /` redireciona para `/agendamentos` (logado) ou `/login` (não logado).

- [ ] **Step 1: Adicionar o redirecionamento raiz**

No topo de `dashboardRoutes.js`, antes das outras rotas:

```js
router.get("/", (req, res) => {
  res.redirect(req.session?.usuarioId ? "/agendamentos" : "/login");
});
```

- [ ] **Step 2: Documentar no `README.md`**

Adicionar uma seção nova (posicionar depois da seção "7. Consultar agendamentos e pacientes" existente):

```markdown
## 7.1. Painel administrativo (dashboard)

Além das rotas `/admin/*` (JSON, por API key), existe um painel web em
`/login` para a equipe usar no dia a dia, com login individual por pessoa
(sem papéis — todo usuário logado vê e faz tudo).

**Criar o primeiro usuário** (só necessário uma vez — depois disso, use a
própria tela "Novo usuário" dentro do dashboard):

\`\`\`bash
node src/db/criar-primeiro-usuario.js "Nome Completo" email@exemplo.com "SenhaForte123"
\`\`\`

Rode as migrations até `009_usuarios_dashboard.sql` antes de criar o
primeiro usuário. Configure `SESSION_SECRET` no `.env` (gere com
`openssl rand -hex 32`) — o servidor recusa subir sem essa variável.

Acesse `http://localhost:3000/login` (ou o domínio de produção) com o
e-mail/senha criados. Sem "esqueci minha senha" nesta versão — se alguém
esquecer, redefina direto no banco:

\`\`\`sql
UPDATE usuarios SET senha_hash = '<novo hash bcrypt>' WHERE email = 'pessoa@exemplo.com';
\`\`\`
```

- [ ] **Step 3: Verificação manual end-to-end completa**

Com `npm run dev` rodando:
1. `curl -i http://localhost:3000/` sem cookie de sessão → `302` para `/login`.
2. Login com e-mail/senha corretos → redireciona para `/agendamentos`, tabela carrega.
3. Acessar `/pacientes` pelo link do header → tabela carrega.
4. Criar um segundo usuário em `/usuarios/novo` → mensagem de sucesso aparece.
5. Deslogar (botão "Sair") → volta para `/login`; tentar acessar `/agendamentos` direto → redireciona para `/login` (sessão realmente encerrada).
6. Logar com o segundo usuário criado no passo 4 → funciona.
7. `npm test` e `npm run lint` → ambos passam sem erro.

- [ ] **Step 4: Commit**

```bash
git add src/routes/dashboardRoutes.js README.md
git commit -m "docs: documenta o dashboard administrativo e adiciona redirecionamento raiz"
```

---

## Self-Review

**Cobertura da spec:**
- Modelo de dados (`usuarios`) — Task 1. ✅
- Dependências novas — Task 2. ✅
- Fluxo de autenticação (login, logout, `exigirLogin`, cookie, CSRF, sem autocadastro) — Tasks 4, 7, 9, 10. ✅
- Rate limiting do login — Task 9. ✅
- Esqueleto do dashboard (layout, telas migradas) — Tasks 8, 12, 13. ✅
- Tela de criar usuário — Task 11. ✅
- Convivência com `/admin/*` — nunca tocado em nenhuma task. ✅
- Testes (model de senha, CSRF, middleware) — Tasks 3, 4, 7; verificação manual documentada para o que a spec já previa não ter teste automatizado (`usuarioModel`, telas). ✅
- Gap identificado durante o planejamento e coberto: bootstrap do primeiro usuário (a spec não previa explicitamente, mas é pré-requisito lógico — sem ele não há como logar pela primeira vez) — Task 6. ✅

**Placeholders:** nenhum "TBD"/"implementar depois" — toda task tem código completo.

**Consistência de tipos/nomes:** `criarUsuario({nome, email, senhaHash})` (Task 5) usado exatamente assim em `criar-primeiro-usuario.js` (Task 6) e em `processarNovoUsuario` (Task 11); `exigirLogin`/`exigirCsrf` (Task 7) usados com a mesma assinatura em todas as rotas que os importam (Tasks 9–13); `res.locals.csrfToken`/`res.locals.usuarioAtual` definidos uma única vez em `exigirLogin` (Task 7) e consumidos pelos partials (Task 8) e pela view de novo usuário (Task 11) sem redefinição divergente.
