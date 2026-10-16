# Estatísticas — design

Data: 2026-09-03
Status: aprovado, pronto pra virar plano de implementação

## Contexto

O clinicaexemplo-bot está evoluindo de bot de agendamento pra sistema de gestão
completo da clínica (ver
`docs/superpowers/specs/2026-08-27-sistema-clinica-arquitetura-macro-design.md`).
"Estatísticas" era um item de decisão em aberto no roadmap — a clínica quer
uma visão geral rápida (financeira + operacional) sem precisar entrar no
`/financeiro/relatorio` (que já existe, mas é um relatório de conferência
mês a mês, com filtro de plano de saúde e especialidade — feito pra outro
propósito).

## Objetivo

Uma tela nova, `/estatisticas`, com números de faturamento e atendimentos
realizados num período escolhido livremente (não só o mês corrente), pra
qualquer usuário logado consultar de relance.

## Fora de escopo (decidido nesta rodada)

- Taxa de falta/cancelamento — não pedida.
- Pacientes novos no período — não pedida.
- Ocupação de agenda (% de horários preenchidos) — não pedida.
- Gráficos — a v1 é só tabela/número; o projeto inteiro é server-rendered
  EJS sem biblioteca de chart hoje, e números em tabela já respondem à
  pergunta "quanto faturei/atendi nesse período". Pode evoluir depois.
- Qualquer mudança no `/financeiro/relatorio` existente — ele continua como
  está, servindo seu próprio propósito.

## Rota e dados

`GET /estatisticas?periodo=hoje|semana|mes|ano|custom&inicio=&fim=`

Comportamento do período:

- `periodo` ausente ou fora do enum → default `mes` (mesmo padrão de
  `STATUS_VALIDOS`/`validarTipoAtendimento` já usado em `agendamentoModel.js`).
- `hoje` / `semana` / `mes` / `ano`: intervalo calculado no servidor a partir
  da data atual (semana = segunda a domingo da semana corrente; mês = mês
  corrente; ano = ano corrente).
- `custom`: exige `inicio` e `fim` validados por `validarData` (já existe em
  `src/utils/validacao.js`) e `inicio <= fim`. Se qualquer uma dessas
  condições falhar, cai no default `mes` — sem tela de erro, mesmo espírito
  de `dataValida ? data : null` em `listarAgendaUnificada`.

Novo `src/models/estatisticaModel.js`, função `buscarEstatisticas({ dataInicio, dataFim })`
(intervalo já resolvido e validado pelo controller antes de chamar o model —
o model recebe só datas prontas, sem saber de presets). Roda as consultas
abaixo em paralelo via `Promise.all`, seguindo o mesmo padrão de
`buscarRelatorioMensal` em `pagamentoModel.js`:

1. **Faturamento total** — soma de `pagamentos.valor` no intervalo
   (`pg.data >= dataInicio AND pg.data <= dataFim`), com o mesmo tratamento
   de estorno que `buscarRelatorioMensal` já usa (`CASE WHEN tipo_lancamento
   = 'estorno' THEN -valor ELSE valor END`).
2. **Recebido** — mesma soma, filtrado a `status = 'pago'`.
3. **Pendente** — mesma soma, filtrado a `status IN ('pendente', 'aguardando_reembolso')`.
4. **Faturamento por especialidade** — total/recebido/pendente agrupados por
   `COALESCE(a.tipo_atendimento, ai.tipo_atendimento)`, mesmos joins com
   `agendamentos`/`agendamentos_importados` que `buscarRelatorioMensal` já
   usa pra chegar na especialidade a partir do pagamento.
5. **Atendimentos realizados (total)** — `COUNT(*)` de
   `registros_atendimento` com `presenca = 'compareceu'` e data do
   agendamento associado (bot ou importado) dentro do intervalo.
6. **Atendimentos por especialidade** — mesmo count, agrupado por
   especialidade do agendamento associado.
7. **Atendimentos por profissional** — mesmo count, agrupado por
   `COALESCE(ra.profissional_responsavel, 'Não informado')` — campo de texto
   livre já preenchido hoje ao registrar presença (`registroAtendimentoModel.js`),
   sem depender da tabela `psicologos` (que ainda não tem vínculo com
   atendimento — isso é a Fase 2 do cadastro de psicólogos, ainda não
   construída).

## UI

Nova view `src/views/estatisticas/lista.ejs`, reaproveitando as classes CSS
já usadas em `financeiro/relatorio.ejs` (`.metric-grid`, `.data-table`,
`.report-section`) — sem CSS novo.

- **Filtro de período**: botões de preset (Hoje / Semana / Mês / Ano) + campos
  "de/até" pra `custom`. GET simples, recarrega a página (mesmo padrão de
  `/agendamentos` e `/financeiro/relatorio`). Preset "Mês" marcado como ativo
  quando a tela abre sem query string.
- **Cards de topo** (`.metric-grid`): Faturamento total, Recebido, Pendente,
  Atendimentos realizados.
- **Tabela "Faturamento por especialidade"**: Fisioterapia / Psicologia ×
  total / recebido / pendente.
- **Tabela "Atendimentos por especialidade"**: Fisioterapia / Psicologia ×
  quantidade.
- **Tabela "Atendimentos por profissional"**: uma linha por
  `profissional_responsavel` (incluindo "Não informado").
- **Menu**: item "Estatísticas" na navegação do dashboard
  (`src/views/partials/header.ejs`, mesmo lugar de Agendamentos/Pacientes/
  Psicólogos), visível pra qualquer usuário logado — sem checagem de papel.
- **Período sem dados**: cards mostram R$ 0,00 / 0, tabelas ficam vazias
  (sem estado de erro especial).

## Autenticação

Mesmo padrão das demais telas do dashboard: `exigirLogin`, sem checagem de
papel (`PAPEIS_VALIDOS` não entra aqui — qualquer usuário autenticado acessa).

## Testes

Seguindo `node --test`, mesmo padrão do resto do projeto:

- **Model** (`estatisticaModel.js`): faturamento e atendimentos corretos
  dentro do intervalo (registros fora do intervalo não entram); estorno
  abatido do total; agrupamento por especialidade e por profissional
  correto, incluindo o caso "Não informado".
- **Controller/rota**: exige login (redireciona/401 sem sessão); período
  inválido (`periodo` fora do enum, `custom` sem datas válidas ou com
  `inicio > fim`) cai no default `mes` sem erro.
- **View**: teste de fumaça renderizando com dados vazios e com dados
  populados, sem lançar exceção.

## Fora de escopo pra depois (não bloqueia esta spec)

- Gráficos, se a clínica sentir falta depois de usar a versão em tabela.
- Vincular "atendimentos por profissional" à tabela `psicologos` quando a
  Fase 2 do cadastro de psicólogos (seleção de psicólogo no agendamento)
  estiver pronta — hoje o campo é texto livre.
