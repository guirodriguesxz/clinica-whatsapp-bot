# Cancelar e remarcar agendamentos importados

Status: aguardando revisão do usuário.

Revisa uma exclusão explícita da spec
[2026-09-02-agenda-unificada-design.md](./2026-09-02-agenda-unificada-design.md):
"Cancelar ou remarcar um agendamento importado — essa tabela não tem
`status` nem vínculo com o Google Calendar; a linha aparece na tela e
participa dos filtros, mas só com a ação de marcar presença." Motivado por
pedido direto do usuário: a recepção precisa poder cancelar e remarcar
qualquer agendamento visível na Agenda, não só os criados pelo bot.

## Objetivo

A recepção cancela e remarca um agendamento **importado**
(`agendamentos_importados`) pelo dashboard, com a mesma validação de
disponibilidade (expediente, capacidade por horário, limite de 7 dias
úteis, não permitir data no passado) já usada para agendamentos do bot —
sem envolver o Google Calendar, já que esses registros nunca tiveram
evento lá.

## Escopo

**Entra:**

- Migration 020: `agendamentos_importados` ganha `status TEXT NOT NULL
  DEFAULT 'confirmado'`, com a mesma `CHECK (status IN ('confirmado',
  'cancelado', 'concluido', 'compareceu', 'faltou'))` já usada em
  `agendamentos` — mesmo `'concluido'` não sendo escrito por nenhum código
  hoje (é assim na tabela do bot também; manter as duas tabelas com o
  mesmo conjunto de valores evita divergência futura). Linhas existentes
  (327 registros da migração do Excel) recebem `'confirmado'` via
  `DEFAULT`, sem precisar de `UPDATE` manual.
- `listarAgendaUnificada`/`buscarAgendaImportada` passam a selecionar
  `ai.status` de verdade em vez do `NULL::text` hardcoded atual.
- Ação **Cancelar** para linhas `origem = "importado"` com `status =
  "confirmado"` e que ainda não passaram — mesmo comportamento visual do
  bot (botão vermelho com confirmação, badge "Cancelado" depois).
- Ação **Remarcar** para as mesmas linhas — reaproveita a mesma tela
  (`agendamentos/remarcar.ejs`) e grade de horários (manhã/tarde) já usada
  pelo bot, com a mesma validação de disponibilidade.
- `contarPacientesNoSlot` e `buscarOcupacaoDoDia`
  (`src/services/calendarService.js`) passam a excluir
  `agendamentos_importados` com `status = 'cancelado'` da contagem de
  capacidade — sem isso, cancelar um importado não libera a vaga de
  verdade para o bot nem para remarcações futuras.
- Extrair a validação de disponibilidade (expediente, data no passado,
  limite de 7 dias úteis, capacidade) de dentro de
  `criarEventoAgendamento` para uma função própria
  `validarDisponibilidadeAgendamento({ data, hora, tipoAtendimento })`,
  reaproveitada tanto por `criarEventoAgendamento` (comportamento do bot
  inalterado) quanto pela nova remarcação de importados (que não cria
  evento no Calendar).
- Rotas do bot passam a usar o prefixo de origem, no mesmo padrão que a
  presença já usa (`/agendamentos/bot/:id/presenca`) — ver "Rotas novas"
  abaixo. Como a Agenda unificada ainda não foi para produção (só existe
  localmente, sem push/deploy — ver `TODO.md`), essa renomeação não quebra
  nada em uso real.
- Mesma permissão de hoje: qualquer usuário logado (recepção ou
  administradora), sem exigir papel de administradora — igual ao
  cancelar/remarcar do bot.

**Não entra:**

- Sincronizar agendamentos importados com o Google Calendar (nem ao criar,
  nem ao remarcar). Continuam sendo registros só de banco.
- Criar um agendamento importado novo do zero pelo dashboard. Este
  sub-projeto só cancela/remarca os 327 registros já existentes da
  migração — criação manual de agendamento é o pré-requisito do próximo
  sub-projeto (tipo "avaliação"), tratado em spec separada.
- Histórico de remarcações (como a spec de Agenda unificada já excluiu
  para o bot).
- Mudar o comportamento do bot no WhatsApp. `criarEventoAgendamento`
  continua validando e criando evento exatamente como hoje — só passa a
  chamar a validação extraída em vez de repeti-la inline.

## Ações por linha (substitui a tabela da spec de Agenda unificada)

| Origem | Situação | Ações |
|---|---|---|
| bot ou importado | `confirmado`, ainda não passou | Cancelar, Remarcar |
| bot ou importado | já passou, sem registro em `registros_atendimento` | Marcar Atendido / Faltou |
| bot ou importado | já passou, com registro | Corrigir (mesmo formulário, pré-preenchido) |
| bot ou importado | `cancelado` | Nenhuma — mostra badge "Cancelado" |
| bot ou importado | `compareceu`/`faltou` | Mesma linha de "com registro" acima |

## Rotas novas

- `POST /agendamentos/bot/:id/cancelar` (renomeada de `POST
  /agendamentos/:id/cancelar`)
- `GET /agendamentos/bot/:id/remarcar` e `POST /agendamentos/bot/:id/remarcar`
  (renomeadas de `/agendamentos/:id/remarcar`)
- `POST /agendamentos/importado/:id/cancelar` (nova)
- `GET /agendamentos/importado/:id/remarcar` e `POST
  /agendamentos/importado/:id/remarcar` (novas)

O segundo passo do formulário (escolher data → ver horários livres) não é
uma rota separada — é a mesma `GET /agendamentos/:origem/:id/remarcar` já
existente, chamada de novo com `?data=YYYY-MM-DD`; `telaRemarcarAgendamento`
já trata esse parâmetro opcional e busca os horários via
`listarHorariosDisponiveis` antes de renderizar a página inteira de novo
(correção sobre a spec de Agenda unificada, que descrevia uma rota
`/horarios-remarcacao` própria — a implementação real simplificou para o
padrão acima).

A view `agendamentos/lista.ejs` monta os links/actions dos botões usando
`item.origem` (já faz isso hoje para o link de presença e de laudo).

## Cancelamento de importado

Sem Calendar envolvido, é ainda mais direto que o cancelamento do bot: só
`UPDATE agendamentos_importados SET status = 'cancelado' WHERE id = $1 AND
status = 'confirmado'` — `0` linhas afetadas vira `409` (mesmo padrão já
usado em `cancelarAgendamentoConfirmado` e `registrarPresencaBot`).

## Remarcação de importado

Mesmo fluxo de duas etapas em tela da Agenda unificada (escolher data →
ver horários livres do dia → confirmar), mas o "salvar" final é só:

1. `validarDisponibilidadeAgendamento({ data: novaData, hora: novaHora,
   tipoAtendimento: agendamento.tipo_atendimento })` — lança os mesmos
   `err.codigo` de hoje (`FORA_DO_HORARIO_FUNCIONAMENTO`,
   `DATA_NO_PASSADO`, `FORA_DO_LIMITE_DIAS`, `HORARIO_LOTADO`), mapeados
   para a mesma tabela `MENSAGEM_ERRO_REMARCACAO` que o controller já tem.
2. `UPDATE agendamentos_importados SET data = $2, hora = $3 WHERE id = $1
   AND status = 'confirmado' RETURNING *` — sem passo de Calendar, sem
   necessidade da sequência criar-depois-cancelar do
   `remarcacaoService.js` (essa complexidade existe só por causa do
   Calendar).

## Estrutura de arquivos

```
src/
├── db/migrations/
│   └── 020_agendamentos_importados_status.sql   # nova
├── services/
│   └── calendarService.js       # +validarDisponibilidadeAgendamento
│                                  #   (extraída de criarEventoAgendamento);
│                                  #   contarPacientesNoSlot e
│                                  #   buscarOcupacaoDoDia passam a filtrar
│                                  #   status <> 'cancelado' no lado importado
├── models/
│   └── agendamentoModel.js      # +cancelarAgendamentoImportado,
│                                  #   +remarcarAgendamentoImportado;
│                                  #   buscarAgendaImportada seleciona
│                                  #   ai.status de verdade
├── controllers/
│   └── dashboardController.js   # processarCancelarAgendamento,
│                                  #   telaRemarcarAgendamento,
│                                  #   processarRemarcarAgendamento passam a
│                                  #   receber :origem e despachar pro
│                                  #   model/fluxo certo
├── routes/
│   └── dashboardRoutes.js       # rotas de cancelar/remarcar ganham
│                                  #   prefixo :origem
└── views/
    └── agendamentos/
        ├── lista.ejs             # botões Cancelar/Remarcar também para
        │                          #   origem="importado" não-passado
        └── remarcar.ejs          # sem mudança de estrutura, só passa a
                                   #   ser alcançada pelas duas origens
```

## Testes

Mesmo padrão do projeto (`node --test`, `pool.query` mockado):

- Migration: aplicar contra schema de teste, confirmar `DEFAULT`
  preenchendo linhas existentes e o `CHECK` rejeitando valor inválido.
- `validarDisponibilidadeAgendamento`: os 4 códigos de erro, extraídos sem
  mudar comportamento — reexecutar os testes existentes de
  `criarEventoAgendamento` contra a função extraída (mesmos casos, sem
  duplicar).
- `contarPacientesNoSlot`/`buscarOcupacaoDoDia`: importado cancelado não
  conta para capacidade; confirmado continua contando.
- Model: `cancelarAgendamentoImportado` (linha afetada vs. 0 linhas already
  cancelado); `remarcarAgendamentoImportado` (grava nova data/hora,
  preserva demais campos).
- Controller: cancelar/remarcar de importado espelhando os testes já
  existentes do bot (fluxo feliz, 409 em corrida, 404 id inexistente, cada
  `err.codigo` de disponibilidade virando mensagem/status HTTP certo) —
  sem repetir a lógica de reversão de Calendar, que não existe neste
  caminho.
- Sem teste de integração com Postgres/Calendar real.

Verificação manual antes de considerar pronto: com um agendamento
importado de teste futuro (criado manualmente no banco de teste, nunca em
produção sem autorização), exercitar cancelar e remarcar pelo dashboard
local e conferir o resultado no banco.
