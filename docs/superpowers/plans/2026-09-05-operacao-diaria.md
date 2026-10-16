# Operação diária Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o Painel Hoje como página inicial e melhorar financeiro, usuários e tema do dashboard.

**Architecture:** O Painel Hoje consulta as duas fontes de agenda e reaproveita os POSTs já protegidos de presença e WhatsApp. O financeiro filtra cada fonte antes de paginar. Tema escuro é uma preferência local do navegador.

**Tech Stack:** Node.js, Express, EJS, PostgreSQL, CSS, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-05-operacao-diaria-design.md`

## Global Constraints

- Não criar novos caminhos para alterar presença, pagamentos ou WhatsApp.
- Usar login e CSRF existentes em toda ação.
- Salvar o tema em `localStorage`, sem migration.
- Preservar filtros financeiros na paginação.

---

### Task 1: Dados e rota do Painel Hoje

**Files:**
- Modify: `src/models/agendamentoModel.js`
- Modify: `src/controllers/dashboardController.js`
- Modify: `src/routes/dashboardRoutes.js`
- Test: `test/agendamentoModelUnificada.test.js`
- Test: `test/dashboardControllerHoje.test.js`

**Interfaces:** Produz `listarAgendaHoje()` e `telaHoje(req, res)`; a rota autenticada `GET /hoje` renderiza `hoje/lista`.

- [ ] Escrever teste que verifica SELECTs para bot e importados filtrando a data atual e `status = 'confirmado'`.
- [ ] Executar `node --test test/agendamentoModelUnificada.test.js` e confirmar falha.
- [ ] Implementar `listarAgendaHoje`, retornando itens unificados ordenados por hora e com os campos usados nas ações existentes.
- [ ] Escrever teste de controller que verifica `res.render("hoje/lista", { itens, resumo })`.
- [ ] Implementar `telaHoje`; mudar o redirecionamento autenticado de `/` para `/hoje`.
- [ ] Executar `node --test test/agendamentoModelUnificada.test.js test/dashboardControllerHoje.test.js`.
- [ ] Commit: `git commit -m "feat: adiciona painel operacional do dia"`.

### Task 2: Tela Hoje e navegação

**Files:**
- Create: `src/views/hoje/lista.ejs`
- Modify: `src/views/partials/header.ejs`
- Modify: `public/dashboard.css`
- Test: `test/hojeView.test.js`

**Interfaces:** A view recebe `itens`, `resumo`, `csrfToken` e usa endpoints existentes de presença, confirmação, ficha e financeiro.

- [ ] Escrever teste que verifica cards de resumo e ações de presença, pagamento e WhatsApp.
- [ ] Executar `node --test test/hojeView.test.js` e confirmar falha.
- [ ] Criar lista compacta por horário, vazio explícito e links/forms para as ações existentes.
- [ ] Adicionar Hoje como primeiro item do menu e atualizar a marca para `/hoje`.
- [ ] Adicionar estilos responsivos para resumo e linhas da operação diária.
- [ ] Executar `node --test test/hojeView.test.js`.
- [ ] Commit: `git commit -m "feat: adiciona interface do painel hoje"`.

### Task 3: Busca e filtros financeiros

**Files:**
- Modify: `src/models/pagamentoModel.js`
- Modify: `src/controllers/dashboardController.js`
- Modify: `src/views/financeiro/lista.ejs`
- Test: `test/pagamentoModel.test.js`
- Test: `test/financeiroViews.test.js`

**Interfaces:** `listarFinanceiro` aceita `inicio`, `fim`, `busca`, `status`, `formaPagamento`, `origem`, `limite` e `offset`.

- [ ] Escrever teste para busca, período, status, forma e origem antes da paginação.
- [ ] Executar `node --test test/pagamentoModel.test.js` e confirmar falha.
- [ ] Implementar builder de filtros validados e parâmetros SQL para as duas origens; origem omitida consulta ambas.
- [ ] Passar `filtros` normalizados pelo controller e renderizar controles na view.
- [ ] Preservar todos os filtros nos links anterior/próxima.
- [ ] Executar `node --test test/pagamentoModel.test.js test/financeiroViews.test.js`.
- [ ] Commit: `git commit -m "feat: adiciona busca e filtros ao financeiro"`.

### Task 4: Usuários e tema escuro

**Files:**
- Modify: `src/views/usuarios/lista.ejs`
- Modify: `src/views/partials/header.ejs`
- Modify: `public/dashboard.css`
- Test: `test/usuariosView.test.js`

**Interfaces:** O botão `data-theme-toggle` alterna `document.documentElement.dataset.theme` e salva `clinicaexemploTheme` no navegador.

- [ ] Escrever teste que verifica ações de usuário e o alternador de tema.
- [ ] Executar `node --test test/usuariosView.test.js` e confirmar falha.
- [ ] Manter as regras atuais de papel e agrupar visualmente status e ações por conta.
- [ ] Adicionar script no header que lê/grava `localStorage` e atualiza `aria-pressed`.
- [ ] Criar variáveis CSS em `[data-theme="dark"]` para fundos, textos, bordas, tabelas, campos e badges.
- [ ] Executar `node --test test/usuariosView.test.js && npm run lint`.
- [ ] Commit: `git commit -m "feat: melhora usuários e adiciona tema escuro"`.

### Task 5: Verificação integrada

**Files:** Corrigir apenas arquivos que falharem na verificação.

- [ ] Executar `npm test`.
- [ ] Executar `npm run lint && git diff --check`.
- [ ] Revisar `git status --short` e `git diff --stat` antes de informar conclusão.
