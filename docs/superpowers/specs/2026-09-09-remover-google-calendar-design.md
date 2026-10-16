# Remover integração com Google Calendar

## Contexto

O bot e o dashboard usam o Google Calendar como espelho visual dos agendamentos
de Fisioterapia (Psicologia nunca usou — sempre encaminhada para a equipe).
Decisão do usuário: a clínica não precisa mais dessa cópia externa — o
dashboard (com as telas de Agendamentos/Próximos agendamentos, agrupadas por
dia e período) já cobre essa visão. Objetivo: tirar o Google Calendar do
caminho, deixando só o bot e o dashboard como fonte de verdade da agenda.

## O que já era verdade antes dessa mudança (confirmado lendo o código)

A lógica real de disponibilidade/capacidade (`validarDisponibilidadeAgendamento`,
`listarHorariosDisponiveis`, `contarPacientesComSobreposicao`,
`buscarOcupacaoDoDia`, em `calendarService.js`) **nunca dependeu do Google** —
é inteiramente baseada em consultas ao Postgres (`agendamentos` +
`agendamentos_importados`). O Google Calendar só entrava depois dessa
validação, como uma cópia visual: `criarEventoAgendamento` chama
`validarDisponibilidadeAgendamento` e, se passar, cria um evento via
`calendar.events.insert` — só isso que sai.

Prova adicional: os fluxos de agendamento **importado** (`remarcarConsultaImportada`,
`editarConsultaImportada` em `remarcacaoService.js`) já nunca tocaram o
Calendar — só chamam `validarDisponibilidadeAgendamento` e gravam direto. É
esse o padrão que os fluxos do bot/dashboard passam a seguir.

## Decisões (confirmadas com o usuário)

1. **Coluna `google_event_id`** (em `agendamentos` e `agendamentos_importados`):
   fica no schema, só para de ser escrita. Sem migration nova — sem risco em
   produção, histórico antigo intacto.
2. **Simplificar o fluxo de escrita**: a sequência "cria evento → grava banco
   → cancela evento antigo" existia só para manter o Calendar consistente com
   o banco caso uma etapa falhasse no meio. Sem Calendar, vira "valida
   disponibilidade → grava direto".

## Escopo

### Remover

- `src/config/googleCalendar.js` (client do Google Calendar) — arquivo inteiro.
- De `src/services/calendarService.js`: `criarEventoAgendamento`,
  `atualizarEventoAgendamento`, `cancelarEventoAgendamento`,
  `montarDetalhesEvento` (só usada por elas) — as únicas funções que tocam a
  API do Google nesse arquivo.
- Dependência `googleapis` do `package.json`.
- Variáveis `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`,
  `GOOGLE_CALENDAR_ID` de `.env.example`, `README.md`, `DEPLOY_RAILWAY.md`.

### Manter intacto

- Tudo que já é validação/consulta pura em `calendarService.js`:
  `validarDisponibilidadeAgendamento`, `listarHorariosDisponiveis`,
  `nomeDiaSemana`, `contarPacientesComSobreposicao`, `buscarOcupacaoDoDia`,
  `slotsLivresDoDia`, etc. — nenhuma delas fala com o Google.
- A coluna `google_event_id` (só para de receber valor novo).

### Simplificar (mesmo padrão de `remarcarConsultaImportada`/`editarConsultaImportada`)

- **`src/functions/criarAgendamento.js`**: chama
  `validarDisponibilidadeAgendamento` direto (em vez de `criarEventoAgendamento`),
  insere no banco sem `googleEventId` (fica `null`), remove o bloco de
  reversão de evento no `catch` do insert.
- **`src/functions/cancelarAgendamento.js`**: remove a chamada a
  `cancelarEventoAgendamento` (e o `if (agendamento.google_event_id)` em volta
  dela) — cancela só no banco.
- **`src/services/remarcacaoService.js`**:
  - `remarcarConsulta` passa a ter a mesma forma de `remarcarConsultaImportada`
    (valida disponibilidade, grava, trata falha como `FALHA_AO_GRAVAR`) — sem
    criar/cancelar evento.
  - `editarConsulta` passa a ter a mesma forma de `editarConsultaImportada`
    (pula validação só quando nada além do paciente mudou, senão valida e
    grava) — sem `atualizarEvento`/criar/cancelar evento.
- **`src/services/agendamentoManualService.js`** (`criarAgendamentoManual`,
  usada quando a equipe combina um horário numa conversa pausada): insere
  direto em `agendamentos_importados`, sem criar evento no Calendar antes.
- **`src/controllers/dashboardController.js`**:
  - `processarCancelarAgendamento`: remove o bloco que cancela evento no
    Calendar antes de cancelar no banco (hoje, se o Calendar estiver fora do
    ar, o cancelamento falha inteiro sem motivo de negócio — efeito colateral
    positivo de remover isso).
  - `processarNovoAgendamento` (caminho único e o loop da série recorrente):
    troca `criarEventoAgendamento`/`cancelarEventoAgendamento` por
    `validarDisponibilidadeAgendamento` + insert direto, mesma lógica de
    erro (`MENSAGEM_ERRO_REMARCACAO`) já mapeada por `err.codigo`.

### Conferir sem necessariamente mudar

- `src/db/importarExcelHistorico.js`, `src/db/migrarSistemaAnterior.js`: scripts
  de importação histórica — checar se já gravam `google_event_id` como
  `NULL`/omitido (esperado que sim, nunca tocaram Calendar).

## Testes

- Remover/adaptar testes que hoje mockam `criarEvento`/`cancelarEvento`/
  `atualizarEvento` nesses arquivos (`criarAgendamentoDuplicado.test.js` já
  criado nesta sessão injeta `criarEvento`/`inserirNoBanco` — ajustar pra
  injetar `validarDisponibilidade` em vez de `criarEvento`).
- Adicionar cobertura pro novo formato simplificado de `remarcarConsulta` e
  `editarConsulta`, espelhando os testes que já existem para as versões
  "importada".
- Rodar a suíte inteira e lint ao final.

## Fora de escopo

- Migration para remover a coluna `google_event_id` (decisão: não fazer agora).
- Qualquer mudança na estrutura de `agendamentos`/`agendamentos_importados`
  além de simplesmente não escrever mais nessa coluna.
- Renomear `calendarService.js` (mesmo não falando mais com o Google, o nome
  fica — renomear é cosmético e não foi pedido).
