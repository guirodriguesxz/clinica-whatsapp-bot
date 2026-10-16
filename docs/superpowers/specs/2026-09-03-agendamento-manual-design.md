# Agendamento manual (criar/editar) pelo dashboard

Status: aprovado em 2026-09-03.

Retoma um desenho antigo, nunca implementado —
[2026-08-29-permissoes-e-agendas-design.md](./2026-08-29-permissoes-e-agendas-design.md)
previa "criação e edição manual de agendamentos de Psicologia", mas ficou
parado ("aguardando os dados reais da clínica", sem autorização de
commit/push/deploy). Motivado por pedido direto do usuário: a recepção
precisa criar e editar agendamentos manualmente pelo dashboard — para
Fisioterapia **e** Psicologia (o desenho de 2026-08-29 cobria só Psicologia,
porque na época só a Psicologia dependia de agendamento manual; a Fisioterapia
já era agendada automaticamente pelo bot via WhatsApp).

## Objetivo

Administradora e recepção criam um agendamento novo (Fisioterapia ou
Psicologia) e editam um agendamento existente (data/hora, tipo, paciente)
pelo dashboard — reaproveitando a mesma validação de disponibilidade,
sincronização com o Google Calendar e checagem de capacidade que o bot já
usa, com rastreabilidade de qual usuário criou/alterou cada registro.

## Escopo

**Entra:**

- Criar agendamento novo, Fisioterapia ou Psicologia, sincronizando com o
  Google Calendar do mesmo jeito que o bot faz (`criarEventoAgendamento`) —
  não como os importados do Excel, que nunca tiveram evento lá.
- Busca de paciente por nome com autocomplete (nova rota `GET
  /api/pacientes/busca`), mostrando um preview curto da ficha (convênio,
  qtd. de consultas, última consulta) antes de confirmar. Se não encontrar,
  opção de cadastrar paciente novo inline (nome + telefone), reaproveitando
  `encontrarOuCriarPaciente` (já existe, usado hoje pelo bot).
- Editar agendamento existente — data/hora, tipo de atendimento e paciente
  vinculado — para **qualquer** agendamento visível na Agenda, não só os
  criados manualmente: inclui os criados pelo bot (`agendamentos`) e os
  importados do Excel (`agendamentos_importados`). Distinto de "Remarcar"
  (que já existe e só troca data/hora): "Editar" é um formulário completo.
- Nova config `capacidadeMaximaPorHorario.psicologia = 1` em
  `src/config/clinica.js` — hoje só Fisioterapia tem limite (7), porque o
  bot nunca agendou Psicologia sozinho.
- Migration 021: colunas `criado_por_usuario_id` e
  `atualizado_por_usuario_id` (nullable, `REFERENCES usuarios(id)`) em
  `agendamentos` e `agendamentos_importados`. `NULL` continua significando
  "criado pelo bot" (em `agendamentos`) ou "um dos 327 originais do Excel,
  nunca editado" (em `agendamentos_importados`).
- Mesma permissão de hoje: qualquer usuário logado (administradora ou
  recepção), sem exigir papel de administradora — igual a cancelar/remarcar.

**Não entra:**

- Criar/editar agendamento importado do zero fora do fluxo de edição acima
  — continua sendo só os 327 registros existentes (igual à spec de
  cancelar/remarcar de ontem).
- Mudar o comportamento do bot no WhatsApp (`chatService`, webhook,
  function-calling). `criarEventoAgendamento`, `encontrarOuCriarPaciente` e
  `validarDisponibilidadeAgendamento` continuam se comportando exatamente
  como hoje para quem chama do lado do bot — o dashboard só passa a chamar
  as mesmas funções.
- Histórico de edições (quem mudou o quê e quando, além de "última pessoa
  que mexeu") — só o snapshot atual via `atualizado_por_usuario_id`.
- Tela de busca de pacientes fora do formulário de agendamento (ex.: uma
  busca geral na tela Pacientes) — a busca nova é específica do fluxo de
  criar/editar agendamento.
- Limite de dias/horário de funcionamento diferentes por tipo de
  atendimento — Psicologia usa os mesmos `CLINICA.horarios`/`limiteDeAgendamento`
  que já existem, só a capacidade por horário é nova.

## Ações por linha (estende a tabela da spec de cancelar/remarcar importados)

Só a linha `confirmado`/não passou muda (ganha **Editar**); as demais
linhas da tabela de ontem (já passou com/sem registro, `cancelado`,
`compareceu`/`faltou`) continuam exatamente iguais, sem ação de editar.

| Origem | Situação | Ações |
|---|---|---|
| bot, manual ou importado | `confirmado`, ainda não passou | Cancelar, Remarcar, **Editar** |

"Manual" aqui é só uma origem de dado (`criado_por_usuario_id IS NOT NULL`
em `agendamentos`), não uma tabela nova — na Agenda continua aparecendo como
`origem = "bot"` para fins de rota (mesmo prefixo `:origem` já usado por
cancelar/remarcar), já que vive na mesma tabela `agendamentos`.

## Rotas novas

- `GET /agendamentos/novo` e `POST /agendamentos/novo` — formulário de
  criação (tipo, data, hora, busca/cadastro de paciente).
- `GET /agendamentos/:origem/:id/editar` e `POST
  /agendamentos/:origem/:id/editar` — formulário de edição, `:origem` em
  `bot|importado` (mesmo padrão de `cancelar`/`remarcar`).
- `GET /api/pacientes/busca?q=` — JSON, autocomplete. Retorna até 10
  resultados por nome (`ILIKE`) ou telefone, cada um com `id, nome,
  telefone, convenio, total_consultas, ultima_consulta`.

## Fluxo de criação

1. Formulário: tipo de atendimento, data, hora.
2. Campo de paciente com autocomplete (`GET /api/pacientes/busca`) —
   escolhe um resultado (mostra preview da ficha) ou clica "Cadastrar
   paciente novo" (revela campos nome + telefone).
3. `POST /agendamentos/novo`:
   a. Se paciente novo: `encontrarOuCriarPaciente({ nome, telefone,
      convenio: null })`.
   b. `validarDisponibilidadeAgendamento({ data, hora, tipoAtendimento })` —
      mesmos 4 códigos de erro do bot.
   c. `criarEventoAgendamento({ nomePaciente, data, hora, tipoAtendimento,
      convenio, telefone, primeiraConsulta: null, queixaPrincipal: null })`.
   d. `inserirAgendamento({ ..., criadoPorUsuarioId: req.usuarioAtual.id })`
      — se falhar, reverte o evento do Calendar (mesmo padrão de
      `criarAgendamento.js` do bot).
4. Sucesso → redireciona para a Agenda com o novo agendamento visível.

## Fluxo de edição

**`agendamentos` (bot ou manual):**

- Trocar data/hora e/ou tipo → generaliza `remarcarConsulta` (hoje só
  recebe `novaData`/`novaHora`) para aceitar também `novoTipoAtendimento` e
  `novoPacienteId` opcionais — mesma sequência segura (cria evento novo →
  grava no banco com `atualizadoPorUsuarioId` → cancela evento antigo).
- Trocar **só** o paciente (data/hora/tipo iguais) → não recria evento no
  Calendar; `calendar.events.patch` atualiza `summary`/`description` com o
  nome/telefone do novo paciente, e `UPDATE agendamentos SET paciente_id =
  $1, atualizado_por_usuario_id = $2 WHERE id = $3`.

**`agendamentos_importados`:**

- Sem Calendar — `validarDisponibilidadeAgendamento` e depois `UPDATE
  agendamentos_importados SET nome = $1, telefone = $2, tipo_atendimento =
  $3, data = $4, hora = $5, atualizado_por_usuario_id = $6 WHERE id = $7 AND
  status = 'confirmado' RETURNING *` (mesmo padrão 0-linhas-vira-409 já
  usado em `remarcarAgendamentoImportado`). Sem `paciente_id` (a tabela
  nunca teve vínculo com `pacientes`) — "trocar o paciente" aqui edita
  `nome`/`telefone` direto na própria linha.

## Tratamento de erros

- Mesmos 4 códigos de `validarDisponibilidadeAgendamento`
  (`FORA_DO_HORARIO_FUNCIONAMENTO`, `DATA_NO_PASSADO`,
  `FORA_DO_LIMITE_DIAS`, `HORARIO_LOTADO`), mapeados para mensagem de tela
  (mesma tabela `MENSAGEM_ERRO_REMARCACAO` do controller, reaproveitada).
- Falha ao gravar no banco após criar evento no Calendar → reverte o
  evento (padrão já usado em `criarAgendamento`/`remarcarConsulta`).
- Editar agendamento já passado ou cancelado → bloqueado, mesma regra de
  cancelar/remarcar hoje.
- Corrida (dois usuários editando o mesmo horário) → índice único do banco
  pega, vira 409 com mensagem "horário não está mais disponível".
- Paciente não encontrado na busca e usuário não marcou "cadastrar novo" →
  validação no formulário, não deixa submeter sem paciente selecionado.

## Estrutura de arquivos

```
src/
├── db/migrations/
│   └── 021_agendamento_manual_rastreabilidade.sql   # nova
├── config/
│   └── clinica.js               # +capacidadeMaximaPorHorario.psicologia
├── services/
│   ├── calendarService.js       # sem mudança de comportamento; talvez
│   │                              #   +atualizarEventoAgendamento (patch)
│   │                              #   pro caso "só trocou o paciente"
│   └── remarcacaoService.js     # remarcarConsulta ganha
│                                  #   novoTipoAtendimento/novoPacienteId
│                                  #   opcionais; +editarAgendamentoImportado
├── models/
│   ├── agendamentoModel.js      # +inserirAgendamento aceita
│                                  #   criadoPorUsuarioId; +editarAgendamento;
│                                  #   remarcarAgendamentoImportado ganha
│                                  #   atualizadoPorUsuarioId
│   └── pacienteModel.js         # +buscarPacientesPorNomeOuTelefone
│                                  #   (autocomplete)
├── controllers/
│   └── dashboardController.js   # +telaNovoAgendamento,
│                                  #   processarNovoAgendamento,
│                                  #   telaEditarAgendamento,
│                                  #   processarEditarAgendamento,
│                                  #   buscarPacientesJson
├── routes/
│   └── dashboardRoutes.js       # rotas novas descritas acima
└── views/
    └── agendamentos/
        ├── lista.ejs             # botão "Editar" nas linhas elegíveis;
        │                          #   botão "+ Novo agendamento" no topo
        ├── novo.ejs               # nova
        └── editar.ejs             # nova (compartilha componente de
                                    #   autocomplete de paciente com novo.ejs)
```

## Testes

Mesmo padrão do projeto (`node --test`, `pool.query` mockado):

- Migration 021: colunas nullable, `REFERENCES usuarios(id)` rejeita id
  inexistente, linhas existentes ficam com `NULL`.
- `buscarPacientesPorNomeOuTelefone`: busca por nome parcial (case
  insensitive), por telefone, limite de 10 resultados, campo
  `total_consultas`/`ultima_consulta` corretos.
- Criação: fluxo feliz (paciente existente e paciente novo), cada
  `err.codigo` de disponibilidade virando mensagem certa, reversão do
  evento do Calendar quando a gravação falha.
- Edição em `agendamentos`: trocar só paciente (não recria evento, só
  `patch`); trocar data/hora/tipo (recria evento, cancela antigo); bloqueio
  em agendamento já passado/cancelado.
- Edição em `agendamentos_importados`: mesmo conjunto de casos, sem
  Calendar envolvido.
- Controller: permissão (qualquer usuário logado, sem exigir
  administradora), 404 em id inexistente, 409 em corrida.
- Capacidade de Psicologia = 1: `validarDisponibilidadeAgendamento` rejeita
  o segundo agendamento de Psicologia no mesmo horário.

Verificação manual antes de considerar pronto: criar e editar um
agendamento de teste (Fisioterapia e Psicologia) pelo dashboard local,
contra o banco de dev — nunca em produção sem autorização.
