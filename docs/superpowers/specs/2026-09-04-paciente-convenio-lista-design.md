# Trocar convênio do paciente de texto livre pra lista (Fase 2 de repasse por convênio)

Status: aprovado em 2026-09-04.

Motivado por: continuação do roadmap de repasse por convênio — Fase 1
(`docs/superpowers/specs/2026-09-04-cadastro-convenios-design.md`) criou o
cadastro de convênios com valores de repasse, mas o paciente ainda guarda o
convênio como texto livre digitado à mão (variações de maiúscula/minúscula,
abreviações), o que impede casar com precisão na Fase 3 (cálculo do
repasse). Esta fase liga `pacientes` à lista de convênios.

## Decisão de compatibilidade (o porquê do desenho)

`pacientes.convenio` (texto) é lido hoje em vários lugares que não fazem
parte desta fase: texto do evento no Google Calendar
(`remarcacaoService.js`), PDF da guia de convênio (`guiaConvenioModel.js`),
"Categoria" na ficha do paciente, agrupamento do relatório financeiro
(`pagamentoModel.js`). Trocar esse campo por uma FK pura quebraria todos
esses pontos de leitura de uma vez.

Em vez disso: `pacientes` ganha uma coluna nova `convenio_id` (nullable,
`REFERENCES convenios(id)`), e a coluna de texto `convenio` **continua
existindo e sendo a fonte de leitura de todo o resto do sistema, sem
nenhuma mudança nesses pontos**. Ao selecionar um convênio pela lista nova
(criar ou editar paciente), o sistema grava `convenio_id` **e**
sincroniza `convenio` (texto) = nome do convênio escolhido — assim os
consumidores existentes continuam funcionando sem tocar em nenhum deles.
Pacientes já cadastrados mantêm o texto solto e `convenio_id = NULL` até
alguém corrigir manualmente pela tela de edição.

## Objetivo

Dar à recepção um jeito de escolher o convênio de um paciente numa lista
fixa (em vez de digitar), tanto ao criar quanto ao editar, populando
`convenio_id` pra viabilizar o cálculo de repasse da Fase 3.

## Escopo

**Entra:**

- Migration 029: `pacientes.convenio_id INTEGER NULL REFERENCES
  convenios(id)`.
- `pacienteModel.js`:
  - `atualizarDadosPaciente` ganha `convenioId` (mesmo padrão COALESCE dos
    outros campos — não informado preserva o valor atual). Quando
    `convenioId` é informado, a função busca o nome do convênio e
    sincroniza `convenio` (texto) = nome, numa única transação/instrução.
  - `encontrarOuCriarPaciente` ganha `convenioId` opcional, com a mesma
    sincronização de texto na criação. O bot (`chatService.js` e
    afins) continua chamando essa função sem `convenioId` — comportamento
    inalterado pra esse fluxo.
- `dashboardController.js`:
  - `telaEditarPaciente`: passa a lista de convênios ativos pra view.
  - `processarEditarPaciente`: lê `convenio_id` do corpo (opcional — campo
    vazio não altera nada, mesmo padrão de `campoOuNull`) e repassa pro
    model.
  - `telaNovoAgendamento`/`processarNovoAgendamento`: o formulário de
    "cadastrar paciente novo" (dentro de Novo agendamento) ganha o mesmo
    campo; ao criar o paciente ali, `convenioId` é repassado pra
    `encontrarOuCriarPaciente`.
- Views:
  - `pacientes/editar.ejs`: novo `<select name="convenio_id">` com os
    convênios ativos + opção em branco "Manter como está" (não sobrescreve
    o texto livre existente se ninguém escolher nada) — colocado antes do
    campo "Matrícula do convênio" já existente.
  - `agendamentos/novo.ejs`: mesmo `<select>` dentro do fieldset
    "— ou cadastre um paciente novo —".
- Permissão/validação: mesma tela de hoje (qualquer usuário logado edita
  paciente); `convenio_id` recebido é validado com `idSeguro` — valor
  inválido é tratado como "não informado" (nunca erro 400, já que o campo é
  opcional).

**Não entra:**

- Nenhuma mudança no bot do WhatsApp (`chatService.js`) ou na importação de
  planilha (`planilhaRevisaoService.js`) — continuam gravando só o texto
  livre, sem `convenio_id`.
- Nenhuma migração em massa dos pacientes já cadastrados — ficam com
  `convenio_id` nulo até correção manual, um de cada vez.
- Nenhuma mudança nos pontos que hoje leem `pacientes.convenio` (Calendar,
  PDF de guia, relatório financeiro, ficha) — continuam lendo o texto,
  agora mantido em sincronia pela nova lista quando ela é usada.
- Cálculo de repasse (Fase 3, spec própria).
- Tornar o campo obrigatório — convênio continua opcional (paciente
  particular não tem convênio).

## Fluxo

1. Recepção edita um paciente existente → tela agora mostra "Convênio" com
   os convênios ativos + "Manter como está" → escolhe um → salva →
   `convenio_id` e o texto `convenio` ficam sincronizados com a lista.
2. Recepção cria um paciente novo pelo formulário de Novo agendamento →
   escolhe o convênio na mesma lista (opcional) → paciente já nasce com
   `convenio_id` certo.
3. Paciente chega pelo bot do WhatsApp → continua como hoje, convênio em
   texto livre, `convenio_id` nulo — corrigido depois pela recepção quando
   for editar esse paciente.

## Estrutura de arquivos

```
src/
├── db/migrations/
│   └── 029_paciente_convenio_id.sql   # nova
├── models/
│   └── pacienteModel.js               # atualizarDadosPaciente e
│                                       #   encontrarOuCriarPaciente ganham convenioId
├── controllers/
│   └── dashboardController.js         # telaEditarPaciente, processarEditarPaciente,
│                                       #   telaNovoAgendamento, processarNovoAgendamento
└── views/
    ├── pacientes/editar.ejs           # select Convênio
    └── agendamentos/novo.ejs          # select Convênio (paciente novo)
test/
├── migrations.test.js                 # +migration 029
├── pacienteModel.test.js (ou arquivo equivalente já existente)
├── dashboardControllerEditarPaciente.test.js (ou equivalente já existente)
├── dashboardControllerNovoAgendamento.test.js
└── pacienteEditarView.test.js / agendamentosSerieViews.test.js (view do formulário)
```

## Testes

Mesmo padrão do projeto (`node --test`, `pool.query` mockado, views
renderizadas com `ejs.renderFile`, controllers com dependency injection):

- Migration: coluna `convenio_id` nullable, FK válida pra `convenios(id)`.
- Model: `atualizarDadosPaciente` sem `convenioId` não altera nem
  `convenio_id` nem `convenio` (texto); com `convenioId`, grava o id **e**
  sincroniza o texto com o nome do convênio; `encontrarOuCriarPaciente`
  mesmo comportamento na criação.
- Controller: `processarEditarPaciente` com `convenio_id` inválido/ausente
  não quebra (trata como não informado); com id válido, repassa certo;
  `processarNovoAgendamento` grava `convenioId` no paciente novo quando
  informado.
- View: select aparece nas duas telas com os convênios ativos; opção
  "Manter como está" presente em editar; paciente sem convênio ainda
  cadastrado não quebra a view (nome/texto ausente tratado como vazio).

Verificação manual antes de considerar pronto: editar um paciente de teste
vinculando um convênio de teste, conferir que a ficha e o texto continuam
exibindo certo, e testar a criação de paciente novo com convênio pelo
formulário de agendamento — contra produção (sem banco de dev separado),
removendo os dados de teste depois.
