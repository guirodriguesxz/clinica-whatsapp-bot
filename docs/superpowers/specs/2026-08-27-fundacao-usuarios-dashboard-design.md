# Fundação: usuários + esqueleto do dashboard

Status: aprovado — pronto para virar plano de implementação.

Sub-projeto 1 de 5 da arquitetura macro (ver
[2026-08-27-sistema-clinica-arquitetura-macro-design.md](./2026-08-27-sistema-clinica-arquitetura-macro-design.md)).
Pré-requisito para todos os módulos seguintes (migração de dados, presença,
financeiro, agendamento avançado), que vão adicionar suas próprias telas
dentro deste esqueleto.

## Objetivo

Dar à equipe da clínica um painel web (substituto do sistema de agenda anterior) com
login próprio, rodando dentro do mesmo serviço Express do `clinicaexemplo-bot` —
sem frontend separado, sem papéis de acesso (todo mundo vê e faz tudo; o
login serve para saber quem fez cada ação, não para restringir).

## Escopo

**Entra:**
- Tabela `usuarios` e autenticação por sessão (login/senha).
- Layout base do dashboard (header + navegação) em EJS.
- Duas telas migradas do `/admin` atual (JSON) para HTML dentro do dashboard:
  listagem de agendamentos e listagem de pacientes, reaproveitando
  `agendamentoModel.js`/`pacienteModel.js` sem alterar sua lógica.
- Tela de criação de usuário (acessível a qualquer usuário já logado).

**Não entra** (fica para os sub-projetos seguintes):
- Qualquer coisa de presença, financeiro, pacotes de sessão ou migração de
  dados legados.
- "Esqueci minha senha" — reset é feito direto no banco por enquanto.
- As rotas `/admin/*` protegidas por `ADMIN_API_KEY` continuam existindo como
  estão hoje (ex: `POST /admin/base-conhecimento`); não são desativadas nem
  migradas nesta etapa.

## Modelo de dados

Nova migration `009_usuarios_dashboard.sql`:

```sql
CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

A tabela de sessão (`session`) é criada automaticamente pelo
`connect-pg-simple` na primeira execução (comportamento padrão da lib) — não
precisa de migration própria.

Segue o mesmo padrão de proteção Supabase-only (RLS/REVOKE atrás de
`IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')`) usado nas
migrations anteriores, para continuar rodando sem erro tanto em Neon quanto
em Supabase.

## Dependências novas

- `express-session` — sessão via cookie.
- `connect-pg-simple` — store de sessão no Postgres já existente (sem Redis).
- `bcrypt` — hash de senha.
- `ejs` — templates server-rendered.

## Fluxo de autenticação

- `GET /login` — formulário (e-mail + senha).
- `POST /login` — busca `usuarios` por e-mail, exige `ativo = true`, compara
  senha com `bcrypt.compare`, grava `req.session.usuarioId`. Erro genérico
  ("e-mail ou senha inválidos") tanto para e-mail inexistente quanto senha
  errada, para não revelar quais e-mails existem.
- `POST /logout` — `req.session.destroy`.
- Middleware `exigirLogin` (`src/middleware/dashboardAuth.js`) — redireciona
  para `/login` se `req.session.usuarioId` ausente; carrega o usuário atual
  em `req.usuarioAtual` para as views mostrarem "logado como fulano".
- Cookie: `httpOnly: true`, `secure: true` em produção (`NODE_ENV=production`),
  `sameSite: "lax"`.
- **CSRF**: como agora existem formulários HTML autenticados por cookie (ao
  contrário do `/admin` atual, que usa API key em header/query e não é
  vulnerável a CSRF), cada formulário de mutação (`POST /login` fica de fora
  por não ter sessão ainda; `POST /logout`, criação de usuário, e tudo que os
  sub-projetos seguintes adicionarem) inclui um token CSRF gerado por sessão
  (`req.session.csrfToken`, criado no primeiro acesso) como campo oculto,
  validado num middleware simples antes de qualquer `POST` do dashboard — sem
  adicionar dependência nova para isso, é comparação direta com
  `crypto.timingSafeEqual` (reaproveita o padrão já usado em
  `middleware/auth.js`).
- Sem rota de autocadastro público: `POST /usuarios` (criar novo usuário) só
  existe atrás de `exigirLogin`.

## Estrutura de arquivos

```
src/
├── views/                    # novo — templates EJS
│   ├── layout.ejs            # header + navegação
│   ├── login.ejs
│   ├── usuarios/novo.ejs
│   ├── agendamentos/lista.ejs
│   └── pacientes/lista.ejs
├── middleware/
│   └── dashboardAuth.js      # novo — exigirLogin + csrf
├── controllers/
│   └── dashboardController.js # novo — login/logout/usuarios/telas migradas
├── models/
│   └── usuarioModel.js        # novo — CRUD de usuarios
├── routes/
│   └── dashboardRoutes.js     # novo
└── db/migrations/
    └── 009_usuarios_dashboard.sql  # novo
```

`app.js` ganha `app.use(dashboardRoutes)` ao lado das rotas existentes —
`/admin/*` e `/webhook/*` não mudam.

## Segurança

- Rate limiting no `POST /login` (reaproveitar `express-rate-limit`, limite
  mais apertado que o `adminLimiter` atual — ex: 10 tentativas/15min/IP) para
  dificultar força bruta de senha.
- `bcrypt` com custo 12 (padrão atual da lib, adequado em 2026).
- Erros de autenticação nunca aparecem em log com a senha em texto puro
  (óbvio, mas vale o teste automatizado cobrindo isso — ver abaixo).

## Testes

Seguindo o padrão já existente (`node --test`, `test/setupEnv.js`):
- `usuarioModel`: criação com senha já hasheada (nunca grava texto puro),
  busca por e-mail, respeito ao `ativo = false`.
- `dashboardAuth` (middleware): redireciona sem sessão, deixa passar com
  sessão válida, rejeita token CSRF ausente/incorreto num POST.
- Login: e-mail inexistente e senha errada devolvem a mesma mensagem
  genérica (evita enumeração de e-mail).

Verificação manual antes de considerar pronto: login real no navegador,
logout, criar um segundo usuário, conferir que as telas de agendamentos e
pacientes migradas mostram os mesmos dados que hoje aparecem via
`GET /admin/agendamentos`/`GET /admin/pacientes`.
