# Acesso e permissões do dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o login do dashboard para nome de usuário e senha, com uma
administradora e contas de recepção protegidas por papéis no servidor.

**Architecture:** A tabela `usuarios` ganha o identificador de login
`nome_usuario` e o papel fixo `papel`. `usuarioModel` concentra normalização e
consultas; `dashboardAuth` continua carregando a conta ativa em toda requisição
e passa a expor `exigirPapel`. Um controlador próprio de usuários evita ampliar
o já extenso `dashboardController`, enquanto rotas administrativas recebem a
guarda de papel antes do controlador.

**Tech Stack:** Node.js 20+, Express 4, EJS, PostgreSQL/Neon, `pg`,
`express-session`, bcrypt, `node:test`, ESLint.

**Spec:** `docs/superpowers/specs/2026-08-31-acesso-e-permissoes-design.md`

**Status:** plano local autorizado para implementação futura; nenhuma etapa foi
executada e nenhuma migration, conta, commit, push ou deploy está autorizada.

## Global Constraints

- Não alterar `chatService`, webhook, IA, WhatsApp, Google Calendar ou o
  agendamento automático de Fisioterapia.
- Não aplicar migrations no Neon, não criar contas reais, não executar scripts
  contra o banco, não fazer push ou deploy.
- Não registrar senhas em código, SQL, `.env`, logs, documentação ou testes.
- A interface aceita somente `nome_usuario`; e-mail não é atalho de login.
- Papéis permitidos: `administradora` e `recepcao`.
- A conta `admin` será administradora; `bruno`, `victor` e `aline` serão
  recepção somente no procedimento futuro, após auditoria somente leitura e
  autorização explícita.
- Não fazer commit sem autorização explícita posterior do usuário.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `src/db/migrations/014_usuarios_permissoes.sql` | Schema incremental, sem semear contas ou senhas. |
| `src/models/usuarioModel.js` | Normalização, validação e persistência de contas. |
| `src/middleware/dashboardAuth.js` | Sessão ativa e autorização centralizada por papel. |
| `src/controllers/dashboardController.js` | Login por nome de usuário; remove o fluxo de criação por e-mail. |
| `src/controllers/usuarioController.js` | Gestão administrativa de contas e troca da própria senha. |
| `src/routes/dashboardRoutes.js` | Protege rotas de usuários e estorno com `exigirPapel`. |
| `src/views/login.ejs` | Formulário de login por nome de usuário. |
| `src/views/usuarios/*.ejs` | Lista, criação, reset e troca de senha. |
| `src/views/erros/acesso-negado.ejs` | Resposta HTML de 403 sem dados sensíveis. |
| `src/views/partials/header.ejs` | Navegação condicional por papel. |
| `test/usuarioModel.test.js` | Contrato SQL e validações do model. |
| `test/dashboardAuth.test.js` | Sessão, papel e bloqueio 403. |
| `test/dashboardController.test.js` | Login por nome de usuário, sem enumeração. |
| `test/usuarioController.test.js` | Fluxos de gestão e troca de senha. |
| `test/dashboardRoutesPermissoes.test.js` | Guardas aplicadas às rotas críticas. |

### Task 1: Schema incremental e contrato do modelo de usuários

**Files:**
- Create: `src/db/migrations/014_usuarios_permissoes.sql`
- Modify: `src/models/usuarioModel.js`
- Create: `test/usuarioModel.test.js`

**Interfaces:**
- Produces `normalizarNomeUsuario(valor)`, `buscarUsuarioPorNomeUsuario(nomeUsuario)`,
  `listarUsuarios()`, `criarUsuario({ nome, nomeUsuario, papel, senhaHash })`,
  `atualizarSenhaUsuario(id, senhaHash)` e `desativarUsuario(id)`.
- `buscarUsuarioPorId(id)` passa a retornar somente `id`, `nome`,
  `nome_usuario`, `papel`, `ativo` e `created_at`, nunca `senha_hash`.

- [ ] **Step 1: Escrever os testes que falham para o model**

Crie `test/usuarioModel.test.js` usando `pool.query` como ponto de mock, no
mesmo padrão de `test/dashboardAuth.test.js`. Cubra:

```js
test("buscarUsuarioPorNomeUsuario normaliza caixa e espaços", async (t) => {
  const consultas = mockarQuery(t, [{ id: 7, nome_usuario: "bruno", senha_hash: "hash" }]);
  await buscarUsuarioPorNomeUsuario("  BrUnO  ");
  assert.deepEqual(consultas[0].params, ["bruno"]);
});

test("buscarUsuarioPorId não seleciona senha_hash", async (t) => {
  const consultas = mockarQuery(t, [{ id: 7, nome_usuario: "bruno", papel: "recepcao", ativo: true }]);
  await buscarUsuarioPorId(7);
  assert.doesNotMatch(consultas[0].sql, /senha_hash/i);
});

test("criarUsuario não aceita papel fora da lista", async () => {
  await assert.rejects(
    () => criarUsuario({ nome: "Teste", nomeUsuario: "teste", papel: "admin", senhaHash: "hash" }),
    /papel inválido/i
  );
});
```

Inclua casos para `nome_usuario` vazio, menos de 3 caracteres, caractere fora
de `[a-z0-9._-]`, lista ordenada por nome e `desativarUsuario` que atualiza
somente `ativo = false`.

- [ ] **Step 2: Rodar os testes para confirmar o estado RED**

Run: `node --test test/usuarioModel.test.js`

Expected: FAIL porque os exports e as colunas ainda não existem.

- [ ] **Step 3: Criar a migration local sem dados de produção**

Crie `src/db/migrations/014_usuarios_permissoes.sql` com campos inicialmente
anuláveis, para não inventar o mapeamento da conta já existente:

```sql
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS nome_usuario TEXT,
  ADD COLUMN IF NOT EXISTS papel TEXT;

ALTER TABLE usuarios
  ALTER COLUMN email DROP NOT NULL;

ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_nome_usuario_formato_chk
  CHECK (nome_usuario IS NULL OR nome_usuario ~ '^[a-z0-9][a-z0-9._-]{2,31}$');

ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_papel_chk
  CHECK (papel IS NULL OR papel IN ('administradora', 'recepcao'));

CREATE UNIQUE INDEX IF NOT EXISTS usuarios_nome_usuario_unico_idx
  ON usuarios (nome_usuario)
  WHERE nome_usuario IS NOT NULL;
```

Use uma migration separada para qualquer futura etapa de tornar campos `NOT
NULL`, somente depois de auditoria e provisionamento aprovados. Não adicione
`INSERT`, senha, e-mail real ou `UPDATE` para escolher uma conta.

- [ ] **Step 4: Implementar o model com limites explícitos**

Substitua a normalização de e-mail por uma normalização de nome de usuário:

```js
const PADRAO_NOME_USUARIO = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const PAPEIS_VALIDOS = new Set(["administradora", "recepcao"]);

export function normalizarNomeUsuario(valor) {
  const nomeUsuario = String(valor ?? "").trim().toLowerCase();
  return PADRAO_NOME_USUARIO.test(nomeUsuario) ? nomeUsuario : null;
}
```

`buscarUsuarioPorNomeUsuario` pode selecionar `senha_hash`, pois é usado
somente no caminho de autenticação. Todos os retornos que chegam a views usam
`buscarUsuarioPorId` ou `listarUsuarios` e nunca incluem hash. Faça
`criarUsuario` validar nome, nome de usuário, papel e hash antes do `INSERT`;
use `RETURNING id, nome, nome_usuario, papel, ativo, created_at`.

- [ ] **Step 5: Rodar os testes do model para confirmar GREEN**

Run: `node --test test/usuarioModel.test.js`

Expected: PASS.

- [ ] **Step 6: Revisar a migration sem executá-la**

Run: `git diff --check -- src/db/migrations/014_usuarios_permissoes.sql src/models/usuarioModel.js test/usuarioModel.test.js`

Expected: saída vazia. Não rodar a migration nem scripts de criação de usuário.

### Task 2: Login por nome de usuário e papel no objeto autenticado

**Files:**
- Modify: `src/controllers/dashboardController.js:1-65`
- Modify: `src/views/login.ejs`
- Modify: `test/dashboardController.test.js`
- Modify: `test/dashboardAuth.test.js`

**Interfaces:**
- Consumes `buscarUsuarioPorNomeUsuario(nomeUsuario)` da Task 1.
- Produces login com `req.session.usuarioId`, sem armazenar senha ou papel na
  sessão; o papel é sempre recarregado pelo middleware.

- [ ] **Step 1: Trocar os casos de teste de login para `nome_usuario`**

Atualize o helper de requisição e o usuário de teste:

```js
function criarRequisicao({ nome_usuario, senha, regenerateErr } = {}) {
  return { body: { nome_usuario, senha }, session: /* helper atual */ };
}

const USUARIO_ATIVO = {
  id: 42,
  nome: "Ana",
  nome_usuario: "bruno",
  papel: "recepcao",
  ativo: true,
  senha_hash: HASH_DA_SENHA_CERTA,
};
```

Exija a mensagem genérica `"Nome de usuário ou senha inválidos."` para conta
inexistente, inativa e senha errada. Teste que `"  BrUnO  "` consulta
`"bruno"` e que um corpo com apenas `email` recebe 400, sem login alternativo.

- [ ] **Step 2: Rodar o teste para confirmar RED**

Run: `node --test test/dashboardController.test.js`

Expected: FAIL enquanto o controlador ainda lê `email`.

- [ ] **Step 3: Implementar a troca mínima no controlador e na view**

No controlador, importe `buscarUsuarioPorNomeUsuario` em vez de
`buscarUsuarioPorEmail`, leia `nome_usuario` e mantenha o hash dummy e a
regeneração da sessão existentes:

```js
const { nome_usuario: nomeUsuario, senha } = req.body ?? {};
const mensagemErroGenerica = "Nome de usuário ou senha inválidos.";
const usuario = await buscarUsuarioPorNomeUsuario(nomeUsuario);
```

Em `src/views/login.ejs`, use:

```html
<label>Nome de usuário<input type="text" name="nome_usuario" required autofocus autocomplete="username" /></label>
<label>Senha<input type="password" name="senha" required autocomplete="current-password" /></label>
```

Não renderize o nome de usuário previamente enviado em mensagens de erro.

- [ ] **Step 4: Atualizar o teste de sessão autenticada**

Em `test/dashboardAuth.test.js`, ajuste o objeto ativo para conter
`nome_usuario` e `papel`; confirme que ambos chegam em `req.usuarioAtual` e
`res.locals.usuarioAtual`, sem `senha_hash`.

- [ ] **Step 5: Rodar os testes de autenticação para confirmar GREEN**

Run: `node --test test/dashboardController.test.js test/dashboardAuth.test.js`

Expected: PASS.

### Task 3: Middleware de autorização e proteção das rotas existentes

**Files:**
- Modify: `src/middleware/dashboardAuth.js`
- Modify: `src/routes/dashboardRoutes.js`
- Create: `src/views/erros/acesso-negado.ejs`
- Modify: `src/views/partials/header.ejs`
- Modify: `test/dashboardAuth.test.js`
- Create: `test/dashboardRoutesPermissoes.test.js`

**Interfaces:**
- Produces `exigirPapel(...papeisPermitidos)`, middleware usado depois de
  `exigirLogin`.
- Reception continua usando agenda, pacientes, presença, financeiro e registro
  de pagamento; somente administradora gerencia usuários e estorna pagamentos.

- [ ] **Step 1: Escrever testes RED para a guarda de papel**

Adicione testes unitários ao middleware:

```js
test("exigirPapel bloqueia recepção com 403", () => {
  const req = { usuarioAtual: { papel: "recepcao" } };
  const res = criarRespostaComRender();
  let chamouNext = false;
  exigirPapel("administradora")(req, res, () => { chamouNext = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(res.viewRenderizada, "erros/acesso-negado");
  assert.equal(chamouNext, false);
});
```

No teste de rotas, crie um app Express mínimo que registra exatamente a cadeia
`exigirLogin → exigirPapel("administradora") → controlador falso`, simulando
uma recepcionista; verifique que o controlador não executa. Cubra a rota de
estorno e uma rota administrativa.

- [ ] **Step 2: Rodar os testes RED**

Run: `node --test test/dashboardAuth.test.js test/dashboardRoutesPermissoes.test.js`

Expected: FAIL porque `exigirPapel` ainda não existe e as rotas não a usam.

- [ ] **Step 3: Implementar `exigirPapel` e a página de 403**

Adicione em `dashboardAuth.js`:

```js
export function exigirPapel(...papeisPermitidos) {
  return (req, res, next) => {
    if (!req.usuarioAtual || !papeisPermitidos.includes(req.usuarioAtual.papel)) {
      return res.status(403).render("erros/acesso-negado");
    }
    next();
  };
}
```

Crie a view com título `Acesso negado`, texto curto e link para
`/agendamentos`; não informe quais URLs ou permissões existem.

- [ ] **Step 4: Aplicar a guarda somente aos pontos aprovados**

Em `dashboardRoutes.js`, importe `exigirPapel` e coloque-a após
`exigirLogin` em:

```js
router.post(
  "/financeiro/pagamento/:id/estornar",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  exigirCsrf,
  asyncHandler(processarEstorno)
);
```

As rotas de gestão de usuários que serão criadas na Task 4 também usarão essa
ordem. Não proteja agenda, pacientes, presença, leitura de financeiro ou
registro de pagamento com papel administrativo.

- [ ] **Step 5: Esconder a navegação administrativa para recepção**

No header, só renderize o link `Usuários` quando
`usuarioAtual.papel === "administradora"`; preserve o formulário de logout e
mostre `Logado como <nome> (<papel>)` com o papel humano `Administradora` ou
`Recepção`.

- [ ] **Step 6: Rodar os testes GREEN**

Run: `node --test test/dashboardAuth.test.js test/dashboardRoutesPermissoes.test.js`

Expected: PASS.

### Task 4: Gestão administrativa de contas

**Files:**
- Create: `src/controllers/usuarioController.js`
- Modify: `src/routes/dashboardRoutes.js`
- Create: `src/views/usuarios/lista.ejs`
- Modify: `src/views/usuarios/novo.ejs`
- Create: `test/usuarioController.test.js`

**Interfaces:**
- Consumes os métodos de `usuarioModel` da Task 1, `hashSenha` e
  `req.usuarioAtual` da Task 3.
- Produces `telaUsuarios`, `telaNovoUsuario`, `processarNovoUsuario`,
  `processarRedefinicaoSenha` e `processarDesativacaoUsuario`.

- [ ] **Step 1: Escrever testes RED de controle de conta**

Crie helpers de requisição/resposta e injete dependências nos controladores
quando necessário, como já ocorre em `processarEstorno`. Cubra:

```js
test("processarNovoUsuario cria somente recepção", async () => {
  // corpo { nome: "Amanda", nome_usuario: "aline", senha: "SenhaForte123" }
  // espera papel "recepcao" no model e redirect /usuarios?sucesso=1
});

test("processarDesativacaoUsuario bloqueia a própria administradora", async () => {
  // req.usuarioAtual.id === req.params.id; espera 400 e zero chamadas ao model
});

test("processarRedefinicaoSenha exige ao menos oito caracteres", async () => {
  // espera 400, sem hash e sem query
});
```

Inclua duplicidade de nome de usuário (`err.code === "23505"`) com mensagem
neutra, reset de senha de recepção e renderização da lista sem hash.

- [ ] **Step 2: Rodar o teste RED**

Run: `node --test test/usuarioController.test.js`

Expected: FAIL porque o controlador ainda não existe.

- [ ] **Step 3: Implementar o controlador isolado**

Implemente validações de entrada antes de hash/query. A criação não recebe
campo `papel` do formulário: sempre chama o model com `papel: "recepcao"`.
O reset recebe `senha` e `confirmacao_senha`, exige igualdade e mínimo de 8
caracteres. A desativação converte `req.params.id` por `idSeguro`; se for a
própria conta, responde 400; se não encontrar, 404. Nunca inclua senha em
resposta/renderização.

- [ ] **Step 4: Registrar as rotas administrativas**

Substitua as antigas rotas abertas de criação por estas cadeias:

```js
router.get("/usuarios", asyncHandler(exigirLogin), exigirPapel("administradora"), asyncHandler(telaUsuarios));
router.get("/usuarios/novo", asyncHandler(exigirLogin), exigirPapel("administradora"), telaNovoUsuario);
router.post("/usuarios", asyncHandler(exigirLogin), exigirPapel("administradora"), exigirCsrf, asyncHandler(processarNovoUsuario));
router.post("/usuarios/:id/redefinir-senha", asyncHandler(exigirLogin), exigirPapel("administradora"), exigirCsrf, asyncHandler(processarRedefinicaoSenha));
router.post("/usuarios/:id/desativar", asyncHandler(exigirLogin), exigirPapel("administradora"), exigirCsrf, asyncHandler(processarDesativacaoUsuario));
```

- [ ] **Step 5: Construir as views mínimas**

`usuarios/lista.ejs` mostra nome, nome de usuário, papel e status, com links
para criar conta e formulários CSRF de reset/desativação. `usuarios/novo.ejs`
remove e-mail e papel, usa `nome_usuario`, `senha` e `confirmacao_senha`.
Não ofereça botão de desativar na linha da própria administradora.

- [ ] **Step 6: Rodar os testes GREEN**

Run: `node --test test/usuarioController.test.js test/dashboardRoutesPermissoes.test.js`

Expected: PASS.

### Task 5: Troca da própria senha e encerramento de sessão

**Files:**
- Modify: `src/controllers/usuarioController.js`
- Modify: `src/routes/dashboardRoutes.js`
- Create: `src/views/usuarios/trocar-senha.ejs`
- Modify: `src/views/partials/header.ejs`
- Modify: `test/usuarioController.test.js`

**Interfaces:**
- Produces `telaTrocarSenha` e `processarTrocaPropriaSenha`.
- O fluxo usa `req.usuarioAtual.id`; o corpo nunca contém nem escolhe outro id.

- [ ] **Step 1: Escrever testes RED**

Cubra senha atual incorreta, nova senha/confirmacão divergentes, senha curta e
caminho válido. Para o caminho válido, espere a ordem: buscar hash da própria
conta → `compararSenha` → `hashSenha` → `atualizarSenhaUsuario` → redirect.
Para falhas, espere que a atualização não seja chamada.

- [ ] **Step 2: Rodar o teste RED**

Run: `node --test test/usuarioController.test.js`

Expected: FAIL porque as funções e rota ainda não existem.

- [ ] **Step 3: Implementar fluxo próprio**

Adicione `buscarHashUsuarioPorId(id)` ao model, que seleciona somente
`senha_hash` no caminho de autenticação. O controlador deve exigir senha atual,
senha nova de pelo menos 8 caracteres e confirmação idêntica. Depois da troca,
destrua a sessão e redirecione para `/login?senhaAlterada=1`, evitando manter
uma sessão emitida antes da troca de credencial.

- [ ] **Step 4: Adicionar rota e link**

```js
router.get("/minha-senha", asyncHandler(exigirLogin), telaTrocarSenha);
router.post("/minha-senha", asyncHandler(exigirLogin), exigirCsrf, asyncHandler(processarTrocaPropriaSenha));
```

No header, inclua `Trocar senha` para ambos os papéis. A tela não recebe id de
usuário por URL ou formulário.

- [ ] **Step 5: Rodar o teste GREEN**

Run: `node --test test/usuarioController.test.js`

Expected: PASS.

### Task 6: Verificação integrada local e preparação de entrega

**Files:**
- Modify: `CONTEXT.md`
- Modify: `TODO.md`

**Interfaces:**
- Consomes as Tasks 1–5.
- Produz evidência local e checklist explícito do que ainda depende de
  autorização de produção.

- [ ] **Step 1: Executar a suíte completa**

Run: `npm test`

Expected: 0 falhas, incluindo o fluxo do bot que não foi modificado.

- [ ] **Step 2: Executar análise estática e inspeção de diff**

Run: `npm run lint && git diff --check && git diff --stat`

Expected: lint sem erros; qualquer warning antigo deve ser informado sem ser
silenciosamente corrigido; `git diff --check` sem saída.

- [ ] **Step 3: Revisar requisitos de segurança manualmente**

Confirme no diff:

```text
[ ] Nenhuma senha literal foi adicionada.
[ ] Nenhum SELECT enviado a view inclui senha_hash.
[ ] Nenhuma rota de estorno permite recepcao.
[ ] Nenhuma rota de usuarios permite recepcao.
[ ] Agenda, pacientes, presença e pagamentos continuam disponíveis à recepcao.
[ ] Não há mudança em chatService, webhook, Google Calendar ou deploy.
[ ] Migration 014 existe somente como arquivo local; não foi executada.
```

- [ ] **Step 4: Atualizar o handoff sem declarar produção concluída**

Em `CONTEXT.md` e `TODO.md`, registrar testes executados, arquivos locais
pendentes de commit e o gate de produção: auditoria somente leitura das contas
atuais → autorização explícita → migration → provisionar senhas por canal
seguro → deploy → smoke test de bot e dashboard.

- [ ] **Step 5: Pedir decisão de commit local separadamente**

Não executar `git commit`. Mostrar o diff e pedir autorização explícita do
usuário antes de criar um novo commit local.

## Cobertura da spec

- Login por nome de usuário, hash e sessão: Tasks 1–2.
- Papéis e bloqueio de URL direta: Task 3.
- Administração de contas, reset e desativação: Task 4.
- Troca da própria senha e encerramento de sessão: Task 5.
- Sem reescrever histórico, sem sistema anterior/bot/Neon/deploy: Constraints, Task 1 e
  Task 6.

## Portão de produção posterior

Este plano termina no ambiente local. Não aplicar `014_usuarios_permissoes.sql`
nem criar as contas `admin`, `bruno`, `victor` e `aline` até haver autorização
expressa para: auditar as contas existentes em somente leitura, definir a
associação da administradora, aplicar a migration, criar senhas por canal
seguro e fazer deploy separado com smoke test.
