# Redesign visual do dashboard Clínica Exemplo — Plano de implementação

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use
> `superpowers:subagent-driven-development` (recomendado) ou
> `superpowers:executing-plans` para executar este plano tarefa por tarefa. Os
> passos usam checkboxes (`- [ ]`) para acompanhamento.

**Objetivo:** Aplicar a direção visual híbrida operacional a todas as telas
existentes do dashboard, preservando integralmente dados, rotas, permissões e
regras de negócio.

**Arquitetura:** O trabalho será concentrado nos templates EJS existentes e em
um sistema visual coeso dentro de `public/dashboard.css`. Elementos expansíveis
usarão HTML nativo (`details`/`summary`) para não introduzir dependência de
JavaScript nem degradar o funcionamento básico. Cada conjunto de telas será
renderizado diretamente em testes antes de ser validado visualmente pelo
dashboard isolado.

**Tecnologias:** Node.js 20+, Express 4, EJS 6, CSS responsivo, `node:test` e
`node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-09-02-redesign-dashboard-design.md`

## Restrições globais

- Não alterar regras de negócio, rotas, consultas, permissões, banco de dados,
  bot de WhatsApp, function-calling ou integração com Google Calendar.
- Não alterar controllers, models ou services. Se uma view realmente exigir
  um dado que não recebe hoje, parar e pedir revisão de escopo.
- Não criar migration, não escrever manualmente no Postgres ou Calendar e não
  usar dados reais dos pacientes fotografados em fixtures, testes ou docs.
- Não executar `npm start`, `npm run dev` nem importar `server.js`; para inspeção
  local, usar somente `node _dev_dashboard_only.mjs`.
- Não executar ações manuais que criem, remarquem, cancelem, registrem presença,
  pagamento ou estorno sem autorização explícita e dado de teste definido pelo
  usuário.
- Não fazer commit, push ou deploy sem autorização explícita do usuário. Os
  checkpoints deste plano deixam as mudanças sem commit.
- Preservar Lora para títulos importantes e Manrope para todos os elementos
  operacionais.
- Preservar as cores-base `#174d32`, `#5f8f3e` e `#e7efe1`.
- Todo estado comunicado por cor também deve ter texto.
- Toda ação acessível por mouse deve permanecer acessível por teclado e toque.

---

## Estrutura de arquivos

- `public/dashboard.css`: tokens, shell autenticado, componentes, layouts de
  página, estados, responsividade e estilos de impressão.
- `src/views/partials/header.ejs`: abertura do shell, marca, navegação lateral,
  barra superior e menu do usuário.
- `src/views/partials/footer.ejs`: fechamento do shell e do documento.
- `src/views/agendamentos/*.ejs`: Agenda compacta e remarcação.
- `src/views/pacientes/*.ejs`: lista, visão geral da ficha e controle impresso.
- `src/views/financeiro/*.ejs`: lançamentos contextuais e relatório mensal.
- `src/views/usuarios/*.ejs`: lista e formulários administrativos.
- `src/views/login.ejs` e `src/views/erros/acesso-negado.ejs`: entrada e estado
  de acesso negado.
- `test/dashboardLayoutViews.test.js`: contrato visual/semântico do shell e das
  páginas simples.
- `test/agendamentosListaView.test.js`, `test/fichaPacienteView.test.js` e
  `test/financeiroViews.test.js`: preservação dos comportamentos já cobertos e
  novos contratos estruturais específicos.

---

### Task 1: Sistema visual e shell autenticado

**Arquivos:**

- Criar: `test/dashboardLayoutViews.test.js`
- Modificar: `src/views/partials/header.ejs`
- Modificar: `src/views/partials/footer.ejs`
- Modificar: `public/dashboard.css`

**Interfaces:**

- Consome: `titulo`, `usuarioAtual`, `caminhoAtual` e `csrfToken`, já fornecidos
  globalmente às views.
- Produz: classes compartilhadas `.app-shell`, `.sidebar`, `.app-main`,
  `.topbar`, `.page-header`, `.toolbar`, `.panel`, `.data-table`, `.badge`,
  `.button`, `.form-grid`, `.filter-bar` e modificadores semânticos.

- [ ] **Passo 1: Criar o teste que renderiza o shell autenticado**

Criar um helper que renderiza `partials/header.ejs` e conclui o HTML aberto
apenas para inspeção:

```js
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function renderizarHeader(dados = {}) {
  return ejs.renderFile(path.join(ROOT, "src/views/partials/header.ejs"), {
    titulo: "Agenda",
    caminhoAtual: "/agendamentos",
    csrfToken: "token-teste",
    usuarioAtual: { nome: "Usuária de teste", papel: "administradora" },
    ...dados,
  });
}

test("shell autenticado expõe navegação lateral e barra contextual", async () => {
  const html = await renderizarHeader();
  assert.match(html, /class="app-shell"/);
  assert.match(html, /class="sidebar"/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /class="topbar"/);
  assert.match(html, /Usuária de teste/);
});

test("shell de recepção não exibe administração de usuários", async () => {
  const html = await renderizarHeader({
    usuarioAtual: { nome: "Recepção de teste", papel: "recepcao" },
  });
  assert.doesNotMatch(html, /href="\/usuarios"/);
});
```

- [ ] **Passo 2: Rodar o teste e confirmar a falha**

Executar: `node --test test/dashboardLayoutViews.test.js`

Esperado: falha por ausência de `.app-shell`, `.sidebar`, `.topbar` ou
`aria-current="page"`.

- [ ] **Passo 3: Reestruturar os partials sem alterar links ou formulários**

No header, manter todas as condições EJS atuais e transformar a navegação em
`aside.sidebar`, envolvendo o conteúdo autenticado em `.app-shell`. Usar
`aria-current="page"` somente no link ativo. Abrir `.app-main` e `.page-content`
para o footer fechar. Para páginas sem `usuarioAtual`, abrir apenas o main
simples usado pelo login.

No footer, fechar condicionalmente a estrutura aberta pelo header sem inserir
scripts ou dependências externas.

- [ ] **Passo 4: Construir os tokens e componentes compartilhados**

Reorganizar `dashboard.css` com:

```css
:root {
  --forest: #174d32;
  --forest-dark: #103a25;
  --leaf: #5f8f3e;
  --sage: #e7efe1;
  --surface: #fcfdfb;
  --canvas: #f4f6f1;
  --ink: #202722;
  --muted: #657069;
  --warning: #9a6700;
  --danger: #b42318;
  --border: rgba(23, 77, 50, 0.16);
  --sidebar-width: 15rem;
}
```

Adicionar os componentes produzidos nesta tarefa, estados `:hover`,
`:focus-visible`, `:disabled`, `.is-active`, `.is-danger`, `.is-warning` e
`.is-success`. Não usar seletores dependentes de texto nem estilos inline.

- [ ] **Passo 5: Rodar teste focal, lint e whitespace**

Executar:

```bash
node --test test/dashboardLayoutViews.test.js
npm run lint
git diff --check
```

Esperado: tudo passa. Não criar commit.

---

### Task 2: Agenda unificada e remarcação

**Arquivos:**

- Modificar: `src/views/agendamentos/lista.ejs`
- Modificar: `src/views/agendamentos/remarcar.ejs`
- Modificar: `test/agendamentosListaView.test.js`
- Modificar: `public/dashboard.css`

**Interfaces:**

- Consome: `filtros`, `itens`, `csrfToken`, `agendamento`, `dataEscolhida` e
  `horarios`, sem mudar sua forma.
- Produz: `.agenda-layout`, `.agenda-calendar`, `.agenda-summary`,
  `.appointment-row`, `.row-actions`, `.attendance-panel` e reutiliza os
  componentes da Tarefa 1.

- [ ] **Passo 1: Adicionar contratos estruturais à renderização da Agenda**

Acrescentar ao teste existente:

```js
test("agendamentos/lista: usa estrutura operacional compacta e mantém filtros", async () => {
  const html = await renderizar({
    itens: [],
    filtros: { data: "2026-09-02", status: "", tipo_atendimento: "", busca: "" },
  });
  assert.match(html, /class="[^"]*agenda-layout/);
  assert.match(html, /class="[^"]*filter-bar/);
  assert.match(html, /class="[^"]*agenda-calendar/);
  assert.match(html, /name="data" value="2026-09-02"/);
  assert.match(html, /class="[^"]*data-table/);
});
```

Nos testes de ações futuras e presença, acrescentar asserts para
`.row-actions` e `.attendance-panel`, sem relaxar os asserts existentes de
rotas, campos ou valores.

- [ ] **Passo 2: Rodar o teste e confirmar a falha estrutural**

Executar: `node --test test/agendamentosListaView.test.js`

Esperado: os testes comportamentais antigos passam e o novo teste falha pelas
classes ainda ausentes.

- [ ] **Passo 3: Reestruturar filtros, tabela e painel de data**

Manter exatamente os mesmos `name`, `value`, `method` e `action`. Organizar:

- título e resumo da data em `.page-header`;
- filtros GET em `.filter-bar`;
- conteúdo em `.agenda-layout` com tabela e `aside.agenda-calendar`;
- controle lateral de data usando o mesmo `input type="date"` e submissão GET,
  sem criar cálculo de calendário ou endpoint novo;
- linhas com badge textual por status e classes semânticas;
- ações futuras em `.row-actions`;
- formulário de presença em `details.attendance-panel`, com `summary` explícito
  “Registrar presença” ou “Corrigir presença”.

O formulário precisa continuar no HTML e acessível sem JavaScript. Cancelamento
mantém o POST e CSRF atuais e ganha confirmação via atributo `onsubmit` já
aceito no projeto.

- [ ] **Passo 4: Ajustar a tela de remarcação**

Aplicar `.page-header`, `.panel`, `.form-grid` e `.toolbar`. Manter os grupos
Manhã/Tarde e os radios nativos invisíveis apenas visualmente, preservando foco,
label e `required`. Exibir resumo do horário atual antes do seletor de data.

- [ ] **Passo 5: Estilizar densidade, ações e estados**

Adicionar regras específicas para largura das colunas, números tabulares,
badges, agrupamento visual por horário, painel lateral e `details`. Em telas
estreitas, o aside passa abaixo da tabela e a tabela recebe contêiner com
rolagem horizontal.

- [ ] **Passo 6: Verificar a tarefa**

Executar:

```bash
node --test test/agendamentosListaView.test.js test/dashboardControllerTelaAgendamentos.test.js test/dashboardControllerRemarcarAgendamento.test.js
npm run lint
git diff --check
```

Esperado: tudo passa. Não acionar formulários reais e não criar commit.

---

### Task 3: Lista e ficha do paciente

**Arquivos:**

- Modificar: `src/views/pacientes/lista.ejs`
- Modificar: `src/views/pacientes/ficha.ejs`
- Modificar: `test/fichaPacienteView.test.js`
- Modificar: `test/dashboardLayoutViews.test.js`
- Modificar: `public/dashboard.css`

**Interfaces:**

- Consome: `pacientes`, `paciente`, `historico`, `pacotes`, `usuarioAtual` e
  `csrfToken` existentes.
- Produz: `.patient-list`, `.patient-hero`, `.patient-facts`,
  `.session-package`, `.progress-meter` e `.patient-history`.

- [ ] **Passo 1: Testar a visão geral contínua**

Adicionar a `fichaPacienteView.test.js`:

```js
test("ficha apresenta resumo, pacote atual e histórico na mesma visão", async () => {
  const html = await renderizar({
    pacotes: [{ id: 3, quantidade_usada: 6, quantidade_total: 10, cancelado: false }],
  });
  assert.match(html, /class="[^"]*patient-hero/);
  assert.match(html, /class="[^"]*session-package/);
  assert.match(html, /class="[^"]*progress-meter/);
  assert.match(html, /class="[^"]*patient-history/);
  assert.doesNotMatch(html, /role="tab"/);
});
```

Em `dashboardLayoutViews.test.js`, renderizar `pacientes/lista.ejs` com lista
vazia e verificar `.patient-list` e `.data-table`.

- [ ] **Passo 2: Rodar os testes e confirmar a falha**

Executar:

`node --test test/fichaPacienteView.test.js test/dashboardLayoutViews.test.js`

Esperado: falha pelas novas classes.

- [ ] **Passo 3: Redesenhar a lista sem inventar busca inexistente**

Aplicar header, painel e tabela compacta aos campos atuais. A spec pede busca em
destaque, mas não existe filtro nem payload para isso: por restrição de escopo,
não implementar uma busca falsa nem alterar controller. Registrar a busca como
lacuna de produto a ser avaliada separadamente; o redesign desta tarefa mantém
a listagem e o link “Ver ficha”.

- [ ] **Passo 4: Construir a ficha em visão geral contínua**

Organizar os dados atuais em `.patient-hero` e `.patient-facts`. Exibir o pacote
atual em `.session-package` com barra de progresso cujo valor acessível use
`role="progressbar"`, `aria-valuemin="0"`, `aria-valuemax` e `aria-valuenow`.
Manter criação/cancelamento de pacote, histórico e permissões exatamente como
estão. Não exibir “próximo atendimento”, pois esse dado não existe no payload.

- [ ] **Passo 5: Estilizar ficha, progresso e tabelas**

Criar grid de resumo que vira uma coluna no mobile. A barra de progresso deve
ter informação textual “X de Y sessões usadas”; a largura visual pode ser
calculada no atributo `style` da barra interna a partir dos dois valores, após
limitar a porcentagem entre 0 e 100 no EJS.

- [ ] **Passo 6: Verificar a tarefa**

Executar:

```bash
node --test test/fichaPacienteView.test.js test/dashboardLayoutViews.test.js test/dashboardController.test.js
npm run lint
git diff --check
```

Esperado: tudo passa. Não criar pacote real e não criar commit.

---

### Task 4: Controle de sessões e impressão

**Arquivos:**

- Modificar: `src/views/pacientes/controle-sessoes.ejs`
- Modificar: `test/dashboardLayoutViews.test.js`
- Modificar: `public/dashboard.css`

**Interfaces:**

- Consome: `paciente` e `sessoes` atuais.
- Produz: `.session-control`, `.print-copy`, `.print-only` e `.screen-only`.

- [ ] **Passo 1: Testar as duas vias e a semântica de impressão**

Adicionar um caso que renderiza a view com dez sessões sintéticas e verifica:

```js
assert.equal((html.match(/class="[^"]*print-copy/g) || []).length, 2);
assert.match(html, /class="[^"]*screen-only/);
assert.match(html, /Controle de Fisioterapia/);
assert.match(html, /Paciente de teste/);
```

- [ ] **Passo 2: Confirmar a falha**

Executar: `node --test test/dashboardLayoutViews.test.js`

Esperado: falha por ausência de `.print-copy` e `.screen-only`.

- [ ] **Passo 3: Reorganizar a tela sem mudar conteúdo impresso**

Manter o loop de duas cópias e as seis colunas atuais. Marcar ações e cabeçalho
de página como `.screen-only`; marcar cada via como `.print-copy`. Não adicionar
novas informações clínicas.

- [ ] **Passo 4: Consolidar estilos de tela e `@media print`**

Na tela, usar cards lado a lado quando houver espaço. Na impressão A4 paisagem,
garantir duas vias, ausência de sidebar/topbar/botões, fundo branco, bordas
legíveis e sem quebra interna de cada via.

- [ ] **Passo 5: Verificar a tarefa**

Executar:

```bash
node --test test/dashboardLayoutViews.test.js test/dashboardController.test.js
npm run lint
git diff --check
```

Esperado: tudo passa. A verificação visual de impressão fica para a Tarefa 8.

---

### Task 5: Financeiro operacional

**Arquivos:**

- Modificar: `src/views/financeiro/lista.ejs`
- Modificar: `test/financeiroViews.test.js`
- Modificar: `public/dashboard.css`

**Interfaces:**

- Consome: `itens`, `filtroData`, `formatarMoeda`, `csrfToken`, paginação e
  permissões já refletidas no HTML atual.
- Produz: `.finance-list`, `.payment-history`, `.payment-entry`,
  `.refund-entry` e `.financial-amount`.

- [ ] **Passo 1: Testar painéis nativos e preservar formulários**

Acrescentar um teste com um atendimento e pagamento elegível:

```js
assert.match(html, /<details[^>]*class="[^"]*payment-entry/);
assert.match(html, /<summary[^>]*>\s*Registrar pagamento\s*<\/summary>/);
assert.match(html, /<details[^>]*class="[^"]*refund-entry/);
assert.match(html, /action="\/financeiro\/pagamento\/31\/estornar"/);
assert.match(html, /action="\/financeiro\/agendamento\/1"/);
```

Não alterar os testes existentes que garantem append-only, formatação monetária
e elegibilidade de estorno.

- [ ] **Passo 2: Rodar o teste e confirmar a falha**

Executar: `node --test test/financeiroViews.test.js`

Esperado: falha pela ausência dos novos `details` e classes.

- [ ] **Passo 3: Reorganizar a listagem financeira**

Manter todas as iterações, condições e campos atuais. Transformar histórico,
novo pagamento e estorno em painéis `details` independentes, cada um com
`summary` textual. Usar `.financial-amount` nos valores e badges diferentes
para pago, pendente, aguardando reembolso e estornado.

Não mover formulários para fora do item ao qual pertencem e não mudar nomes,
valores, actions, methods ou tokens CSRF.

- [ ] **Passo 4: Estilizar tabela e formulários contextuais**

O atendimento permanece uma linha principal; a célula de pagamentos aceita uma
pilha compacta de lançamentos e painéis. Em telas menores, o formulário usa uma
coluna e a tabela preserva rolagem horizontal.

- [ ] **Passo 5: Verificar a tarefa**

Executar:

```bash
node --test test/financeiroViews.test.js test/dashboardControllerFinanceiro.test.js
npm run lint
git diff --check
```

Esperado: tudo passa. Não submeter pagamentos ou estornos reais e não criar
commit.

---

### Task 6: Relatório financeiro

**Arquivos:**

- Modificar: `src/views/financeiro/relatorio.ejs`
- Modificar: `test/financeiroViews.test.js`
- Modificar: `public/dashboard.css`

**Interfaces:**

- Consome: `relatorio`, `plano`, `especialidade` e `formatarMoeda` atuais.
- Produz: `.report-filters`, `.metric-grid`, `.metric-card` e
  `.report-section`.

- [ ] **Passo 1: Testar filtros, métricas e ausência de gráficos**

No teste de relatório existente, acrescentar:

```js
assert.match(html, /class="[^"]*report-filters/);
assert.match(html, /class="[^"]*metric-grid/);
assert.equal((html.match(/class="[^"]*metric-card/g) || []).length, 2);
assert.doesNotMatch(html, /<canvas|<svg[^>]*class="[^"]*chart/);
```

- [ ] **Passo 2: Confirmar a falha**

Executar: `node --test test/financeiroViews.test.js`

Esperado: falha pelas classes de relatório.

- [ ] **Passo 3: Reestruturar sem alterar cálculos ou filtros**

Manter o form GET e todos os valores selecionados. Colocar total faturado e
total recebido em dois `.metric-card`, preservando textos explicativos e
contagem de estornos. Envolver cada tabela atual em `.report-section` com título
e contêiner rolável.

- [ ] **Passo 4: Estilizar métricas e seções**

Usar cartões discretos, números tabulares e hierarquia compacta. Não adicionar
gráficos, exportação, percentuais ou comparações que o backend não fornece.

- [ ] **Passo 5: Verificar a tarefa**

Executar:

```bash
node --test test/financeiroViews.test.js test/dashboardControllerFinanceiro.test.js
npm run lint
git diff --check
```

Esperado: tudo passa. Não criar commit.

---

### Task 7: Usuários, formulários, login e acesso negado

**Arquivos:**

- Modificar: `src/views/usuarios/lista.ejs`
- Modificar: `src/views/usuarios/novo.ejs`
- Modificar: `src/views/usuarios/trocar-senha.ejs`
- Modificar: `src/views/login.ejs`
- Modificar: `src/views/erros/acesso-negado.ejs`
- Modificar: `test/dashboardLayoutViews.test.js`
- Modificar: `public/dashboard.css`

**Interfaces:**

- Consome: objetos e variáveis existentes de usuário, erro, sucesso e CSRF.
- Produz: `.user-list`, `.user-actions`, `.focused-form`, `.login-layout`,
  `.login-card` e `.empty-state`.

- [ ] **Passo 1: Testar painéis de usuário e login privado**

Adicionar casos que renderizam as views com dados sintéticos:

```js
assert.match(usuariosHtml, /class="[^"]*user-list/);
assert.match(usuariosHtml, /<details[^>]*class="[^"]*user-actions/);
assert.match(loginHtml, /class="[^"]*login-layout/);
assert.match(loginHtml, /autocomplete="username"/);
assert.match(loginHtml, /autocomplete="current-password"/);
assert.doesNotMatch(loginHtml, /Usuária de teste|Recepção de teste/);
assert.match(acessoNegadoHtml, /class="[^"]*empty-state/);
```

- [ ] **Passo 2: Rodar o teste e confirmar a falha**

Executar:

`node --test test/dashboardLayoutViews.test.js test/usuarioController.test.js`

Esperado: falha apenas nos novos contratos de marcação.

- [ ] **Passo 3: Reestruturar a lista de usuários**

Manter tabela, papéis, condições e actions. Colocar redefinição de senha em
`details.user-actions`. Manter desativação como ação destrutiva separada com
confirmação. Não oferecer ações para a própria conta nem para administradoras
quando o template atual não oferece.

- [ ] **Passo 4: Padronizar os formulários focados**

Aplicar `.focused-form`, `.form-grid`, mensagens próximas aos campos e toolbar
de retorno em Novo usuário e Trocar senha. Preservar `required`, `minlength` e
todos os atributos `autocomplete`.

- [ ] **Passo 5: Redesenhar login e acesso negado**

Manter logo, dois campos e ação única no login. Não listar usuários. Usar
`.login-layout` sobre superfície clara com `.login-card` de largura controlada.
Na página de acesso negado, usar `.empty-state` com mensagem e link para Agenda,
sem detalhe interno.

- [ ] **Passo 6: Verificar a tarefa**

Executar:

```bash
node --test test/dashboardLayoutViews.test.js test/usuarioController.test.js test/dashboardRoutesPermissoes.test.js test/dashboardAuth.test.js
npm run lint
git diff --check
```

Esperado: tudo passa. Não criar usuário real, não alterar senha real e não criar
commit.

---

### Task 8: Responsividade, acessibilidade, impressão e verificação final

**Arquivos:**

- Modificar: `public/dashboard.css`
- Modificar: testes de view somente se a verificação revelar uma lacuna de
  contrato reproduzível.
- Criar: `.superpowers/sdd/2026-09-02-redesign-dashboard/final-report.md`
  durante a execução, como relatório local não versionado.

**Interfaces:**

- Consome: todas as classes e páginas produzidas nas Tarefas 1–7.
- Produz: media queries finais, estilos de impressão e evidência de verificação.

- [ ] **Passo 1: Completar breakpoints e preferências de movimento**

Adicionar breakpoints orientados pelo conteúdo, cobrindo pelo menos:

```css
@media (max-width: 960px) { /* sidebar recolhida, grids em uma coluna */ }
@media (max-width: 640px) { /* toolbar e formulários compactos */ }
@media (prefers-reduced-motion: reduce) { /* remover transições não essenciais */ }
@media print { /* esconder toda a interface e preservar os impressos */ }
```

Confirmar que nenhuma ação depende exclusivamente de `hover`.

- [ ] **Passo 2: Rodar a suíte automatizada completa**

Executar:

```bash
npm test
npm run lint
git diff --check
```

Esperado: toda a suíte passa, lint sem erros ou warnings e whitespace limpo.

- [ ] **Passo 3: Subir somente o dashboard isolado**

Executar `node _dev_dashboard_only.mjs` somente se não houver processo isolado
já saudável em `http://localhost:3000/health`. Nunca iniciar `server.js`.

- [ ] **Passo 4: Fazer inspeção somente leitura em desktop**

Usar uma sessão autenticada fornecida pelo usuário e visitar, sem enviar
formulários mutáveis:

- `/agendamentos`;
- `/pacientes` e uma ficha autorizada pelo usuário;
- controle de sessões;
- `/financeiro` e `/financeiro/relatorio`;
- `/usuarios` para administradora;
- `/minha-senha`;
- uma rota que resulte em acesso negado para o papel adequado.

Verificar 1440×900 e 1280×720: sidebar, foco, overflow, tabelas, `details`,
badges, mensagens e ausência de conteúdo cortado.

- [ ] **Passo 5: Fazer inspeção responsiva e de teclado**

Verificar 768×1024 e 390×844. Percorrer com Tab/Shift+Tab e confirmar foco
visível, ordem coerente, abertura de `details`, leitura dos labels e alcance das
ações sem mouse.

- [ ] **Passo 6: Validar impressão sem gravar dados**

Abrir a prévia de impressão da ficha e do controle de sessões. Confirmar A4,
ausência de sidebar/topbar/botões, duas vias do controle, tabelas legíveis e
sem cortes. Cancelar a impressão; não gerar documento com dados reais como
artefato persistente.

- [ ] **Passo 7: Registrar evidências e limites**

No relatório final local, registrar comandos, resultados, páginas e larguras
verificadas, problemas corrigidos e qualquer item que dependa de autorização.
Não incluir nomes, telefones, CPF, convênios ou outros dados de pacientes.

- [ ] **Passo 8: Revisar o diff final**

Executar:

```bash
git status --short
git diff --stat
git diff --check
git diff -- public/dashboard.css src/views test
```

Confirmar que não há alteração em `server.js`, `src/controllers`, `src/models`,
`src/services`, `src/functions`, `src/db` ou arquivos de integração. Parar com
as mudanças locais, sem commit, push ou deploy.

---

## Ordem de revisão

Cada tarefa precisa de revisão de conformidade com a spec e qualidade do código
antes da seguinte. A revisão final deve confirmar especialmente:

1. nenhum formulário, rota, campo ou condição de permissão foi perdido;
2. nenhum dado dos prints entrou no repositório;
3. o Financeiro continua append-only e estorno só aparece quando elegível;
4. Agenda e presença preservam exatamente os actions e campos existentes;
5. impressão não expõe a interface;
6. o diff permanece estritamente em CSS, views, testes e docs locais;
7. nada foi commitado, enviado ou implantado.
