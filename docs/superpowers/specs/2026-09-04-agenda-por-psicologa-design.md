# Vincular psicóloga ao agendamento + coluna Convênio + impressão por psicóloga

Status: aprovado em 2026-09-04.

Motivado por: o usuário mandou um exemplo de impressão de agenda de outro
sistema (sistema de agenda anterior) — uma agenda impressa por profissional, com
telefone e convênio do paciente por linha — e pediu algo parecido pra
Psicologia (cada psicóloga tem agenda separada) e a mesma melhoria de coluna
pra Fisioterapia (agenda única, sem separação por profissional). Esta é a
Fase 2 do cadastro de psicólogos (`docs/superpowers/specs/2026-09-03-cadastro-psicologos-design.md`),
que deixou a ligação com agendamento propositalmente de fora até este
pedido concreto aparecer.

**Decisões do usuário que moldam o escopo:**

- Fisioterapia continua com agenda única, sem campo de profissional — não
  entra nada de vínculo por lá.
- Cada psicóloga tem agenda separada, mas **não existe regra automática**
  de qual psicóloga atende qual paciente/horário — quem decide é a
  recepção, na hora ou depois.
- O campo psicóloga no agendamento de Psicologia é **sempre opcional e
  nunca bloqueia** a criação/confirmação do agendamento — inclusive os que
  o próprio paciente marca pelo bot do WhatsApp, que nascem sem psicóloga e
  a recepção define depois, editando pelo dashboard.
- As colunas "Tipo" (DESM/AVAL), "F", "C", "E", "Chegou" do exemplo são
  jargão específico do sistema de agenda anterior — não entram, o usuário confirmou
  que não se aplicam aqui.

## Objetivo

1. Toda linha da agenda (tela e impressão, Fisioterapia e Psicologia) passa
   a mostrar o convênio do paciente.
2. Um agendamento de Psicologia pode ser vinculado a uma psicóloga
   específica, definida manualmente pela recepção ao criar ou editar.
3. A tela `/agendamentos` ganha um filtro por psicóloga (só relevante pra
   Psicologia). Ao imprimir com psicóloga + data filtradas, o cabeçalho da
   impressão mostra "Agenda: <nome da psicóloga>", igual ao exemplo
   mandado.

## Escopo

**Entra:**

- Migration 027: `agendamentos.psicologo_id` e
  `agendamentos_importados.psicologo_id` — ambas `INTEGER NULL REFERENCES
  psicologos(id)`, sem `ON DELETE CASCADE` (mesmo padrão de
  `criado_por_usuario_id`: nunca apaga agendamento por causa de uma
  psicóloga desativada/removida do cadastro).
- `agendamentoModel.js`:
  - `buscarAgendaBot`/`buscarAgendaImportada`/`listarAgendaUnificada`
    ganham parâmetro `psicologoId` — filtra `WHERE
    ($N::int IS NULL OR a.psicologo_id = $N)` — mesmo padrão dos filtros
    existentes (período, status etc). Ambas as consultas já retornam
    `paciente_convenio`, então a coluna Convênio não precisa de mudança
    nenhuma no model.
  - `buscarAgendaBot`/`buscarAgendaImportada` passam a retornar também
    `psicologo_id` e `psicologo_nome` (LEFT JOIN `psicologos`).
  - Nova função `atualizarPsicologoAgendamento(origem, id, psicologoId)` —
    `UPDATE agendamentos SET psicologo_id = $2 WHERE id = $1` (ou na tabela
    importados, conforme origem). Aceita `null` pra desvincular.
- `dashboardController.js`:
  - `telaNovoAgendamento`/`processarNovoAgendamento`: passam a aceitar
    `psicologo_id` no corpo (só usado quando `tipo_atendimento ===
    "psicologia"`; ignorado/nulo pra Fisioterapia). Busca a lista de
    psicólogos ativos (`listarPsicologos`) pra popular o select. Não há
    validação de obrigatoriedade — campo vazio grava `null`.
  - `telaEditarAgendamento`/`processarEditarAgendamento`: mesma lógica —
    permite definir/trocar/limpar a psicóloga a qualquer momento, inclusive
    pra reatribuir um agendamento que o bot criou sem psicóloga.
  - `telaAgendamentos`: aceita `psicologo_id` como filtro de query string,
    repassa pro model, busca `listarPsicologos` pra popular o `<select>` do
    filtro, e monta o texto do cabeçalho de impressão: quando `data` E
    `psicologo_id` estão presentes no filtro, usa `"Agenda: <nome>"` no
    lugar do resumo atual (`"Agenda de <data por extenso>"`).
- Views:
  - `agendamentos/lista.ejs`: nova coluna "Convênio" na tabela (screen +
    impressão); novo campo "Psicóloga" na `filter-bar` (só visível/aplicável
    quando o filtro Tipo = Psicologia, mas sempre presente no formulário —
    mesmo padrão dos outros selects da barra); cabeçalho da página usa o
    texto vindo do controller (`tituloAgenda`) no lugar do texto fixo atual.
  - `agendamentos/novo.ejs`: novo `<select name="psicologo_id">` dentro do
    fieldset, escondido por JS quando `tipo_atendimento !== "psicologia"`
    (mesmo padrão já usado pro campo "Quantas sessões" da série) — populado
    com os psicólogos ativos recebidos do controller. Opção em branco
    "Não definida" sempre disponível.
  - `agendamentos/editar.ejs`: mesmo `<select>`, pré-selecionado com o
    `psicologo_id` atual do agendamento (ou "Não definida"); visível sempre
    que o agendamento já é de Psicologia (tipo não muda na edição).
  - `agendamentos/serie-resultado.ejs`: sem mudança — série recorrente é
    recurso hoje só usado a partir do formulário "Novo agendamento", que já
    carrega o `psicologo_id` escolhido pra todas as sessões da série.

**Não entra:**

- Nenhuma regra automática de distribuição entre psicólogas (confirmado
  pelo usuário).
- Checagem de conflito de horário por psicóloga (duas consultas da mesma
  psicóloga no mesmo horário não são bloqueadas — fora de escopo, viraria
  feature própria se a clínica pedir).
- Trocar a psicóloga por WhatsApp ou qualquer fluxo do bot — sempre pelo
  dashboard.
- Nenhuma coluna do exemplo do sistema de agenda anterior além de Convênio
  (Tipo/F/C/E/Chegou ficam de fora, confirmado pelo usuário).
- Especialidade/CRP/contato da psicóloga — fora de escopo desta fase
  também (já estava fora da Fase 1).

## Fluxo

1. Recepção cria um agendamento de Psicologia pelo dashboard → formulário
   mostra o select "Psicóloga" (pode deixar em branco) → agendamento é
   criado com ou sem `psicologo_id`.
2. Paciente marca Psicologia pelo bot do WhatsApp → agendamento nasce sem
   psicóloga → aparece normalmente em `/agendamentos` (com "—" na coluna,
   se essa coluna for exibida) → recepção entra em "Editar" e escolhe a
   psicóloga quando for conveniente.
3. Recepção quer imprimir a agenda do dia só da psicóloga X → em
   `/agendamentos`, filtra Tipo = Psicologia, Psicóloga = X, Data = dia
   desejado → tabela mostra só os agendamentos dela, com Convênio →
   imprime (manhã/tarde ou tudo) → cabeçalho impresso mostra "Agenda:
   <nome da psicóloga> — <data por extenso>".
4. Fisioterapia: sem mudança de fluxo, agenda continua única — só ganha a
   coluna Convênio, na tela e na impressão.

## Estrutura de arquivos

```
src/
├── db/migrations/
│   └── 027_agendamento_psicologo.sql   # nova
├── models/
│   ├── agendamentoModel.js             # +psicologoId nos filtros/queries,
│                                        #   +atualizarPsicologoAgendamento
│   └── psicologoModel.js               # sem mudança (listarPsicologos já existe)
├── controllers/
│   └── dashboardController.js          # telaNovoAgendamento, processarNovoAgendamento,
│                                        #   telaEditarAgendamento, processarEditarAgendamento,
│                                        #   telaAgendamentos
└── views/agendamentos/
    ├── lista.ejs                       # coluna Convênio, filtro Psicóloga, título dinâmico
    ├── novo.ejs                        # select Psicóloga (condicional)
    └── editar.ejs                      # select Psicóloga (condicional)
test/
├── migrations.test.js                  # +migration 027
├── agendamentoModel.test.js            # filtro por psicólogo, atualizarPsicologoAgendamento
├── dashboardControllerNovoAgendamento.test.js    # grava psicologo_id quando enviado
├── dashboardControllerEditarAgendamento.test.js  # troca/limpa psicologo_id
├── dashboardControllerTelaAgendamentos.test.js   # filtro + título dinâmico de impressão
└── agendamentosListaView.test.js       # coluna Convênio, select Psicóloga renderiza
```

## Testes

Mesmo padrão do projeto (`node --test`, `pool.query` mockado, views
renderizadas com `ejs.renderFile`, controllers com dependency injection via
parâmetros default):

- Migration: coluna `psicologo_id` existe nas duas tabelas, nullable, FK
  válida pra `psicologos(id)`.
- Model: filtro por `psicologoId` restringe corretamente; passar `null`
  não filtra nada (mesmo padrão dos outros filtros); `atualizarPsicologoAgendamento`
  grava e também aceita `null` pra desvincular.
- Controller: criar/editar agendamento de Psicologia com `psicologo_id`
  grava certo; Fisioterapia ignora o campo mesmo se vier no corpo (nunca
  grava psicólogo numa consulta de Fisioterapia); `telaAgendamentos` monta
  o título "Agenda: <nome>" só quando data + psicólogo estão os dois
  presentes no filtro, senão mantém o título atual.
- View: coluna Convênio aparece com o valor do paciente (ou "—" se não
  tiver); select de Psicóloga em novo/editar lista só psicólogos ativos e
  aparece escondido quando o tipo não é Psicologia.

Verificação manual antes de considerar pronto: criar um agendamento de
Psicologia de teste vinculando uma psicóloga de teste (nunca nome real),
filtrar por ela em `/agendamentos`, conferir o título de impressão e a
coluna Convênio — contra o banco de produção (não há banco de dev
separado), removendo os dados de teste depois.
