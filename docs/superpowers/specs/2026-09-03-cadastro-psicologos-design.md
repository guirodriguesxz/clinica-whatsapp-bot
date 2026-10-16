# Cadastro de psicólogos (Fase 1 de agendas de Psicologia)

Status: aprovado em 2026-09-03.

Motivado por: a clínica atende com cerca de nove psicólogos, mas o usuário
ainda não tem a agenda/horários de cada um (só os nomes) — o material
completo do sistema de agenda anterior depende de uma visita à clínica ainda não
realizada. Em vez de esperar por esse material pra começar qualquer coisa,
este documento cobre só a primeira fase, que não depende dele: um cadastro
simples de psicólogos, administrável por qualquer pessoa da equipe. A
integração com o agendamento de Psicologia (selecionar psicólogo ao criar
consulta, checar conflito por profissional) fica pra uma fase 2 separada,
quando a agenda real estiver disponível — ver
`docs/superpowers/specs/2026-08-29-permissoes-e-agendas-design.md`, que
descreve esse fluxo futuro em mais detalhe.

## Objetivo

Dar à equipe uma tela simples pra manter a lista de psicólogos da clínica
(nome, ativo/inativo) — sem exigir papel de administradora, sem exclusão
definitiva, sem nenhuma ligação com agendamento ainda.

## Escopo

**Entra:**

- Migration 024: tabela nova `psicologos` (`id`, `nome` TEXT NOT NULL,
  `ativo` BOOLEAN NOT NULL DEFAULT true, `created_at` TIMESTAMPTZ NOT NULL
  DEFAULT now()).
- Tela `/psicologos`: lista todos (ativos e inativos, com badge de status),
  link "Novo psicólogo", e ações por linha (Editar, Desativar/Reativar
  conforme o estado atual).
- `GET/POST /psicologos/novo` — cadastra só o nome (`ativo = true` por
  padrão).
- `GET/POST /psicologos/:id/editar` — corrige o nome (ex: erro de
  digitação). Não mexe em `ativo` (isso é ação separada, ver abaixo).
- `POST /psicologos/:id/desativar` e `POST /psicologos/:id/reativar` —
  alternam `ativo`. Nunca exclusão definitiva (`DELETE`) — mesmo motivo do
  padrão já usado em `usuarios`: preserva o vínculo caso uma fase futura
  passe a referenciar `psicologos.id` a partir de agendamentos.
- Mesma permissão do resto do dashboard consultado no dia a dia (ficha do
  paciente, agenda): **qualquer usuário logado**, sem exigir papel de
  administradora — diferente de `/usuarios`, que é exclusiva da
  administradora, porque isso aqui não é uma conta de acesso ao sistema, é
  só um dado de cadastro.
- Item "Psicólogos" no menu lateral (`src/views/partials/header.ejs`),
  visível pra qualquer usuário logado (sem o `if (usuarioAtual.papel ===
  "administradora")` que envolve o item "Usuários").

**Não entra (fica pra Fase 2, quando a agenda de Psicologia for revisitada):**

- Selecionar psicólogo ao criar/editar um agendamento de Psicologia.
- Checagem de conflito de horário por psicólogo (hoje não existe nenhuma
  ligação entre `agendamentos` e `psicologos`).
- Qualquer campo além de nome e ativo/inativo (especialidade, CRP, contato,
  etc.) — pode entrar depois se a clínica precisar, não é assumido agora.
- Seed dos nomes reais dos ~9 psicólogos — o usuário cadastra manualmente
  pela própria tela depois que a feature estiver no ar; não faz parte desta
  migration/PR.
- Qualquer mudança em `chatService`, webhook, agendamento automático do bot
  ou Google Calendar.
- Tabela genérica de "profissionais" reaproveitável por Fisioterapia — fora
  de escopo: Fisioterapia continua sendo agendada só pelo bot, sem seleção
  de profissional em nenhum fluxo hoje.

## Fluxo

1. Qualquer usuário logado abre "Psicólogos" no menu → vê a lista (vazia no
   primeiro acesso) → clica em "Novo psicólogo" → digita o nome → salva →
   aparece na lista como Ativo.
2. Pra corrigir um nome digitado errado: clica em "Editar" na linha → altera
   o nome → salva → volta pra lista.
3. Pra parar de mostrar um psicólogo que não trabalha mais na clínica (numa
   fase futura, quando isso for selecionável na agenda): clica em
   "Desativar" → linha passa a mostrar badge "Inativo". Pode reativar a
   qualquer momento clicando em "Reativar".

## Estrutura de arquivos

```
src/
├── db/migrations/
│   └── 024_psicologos.sql         # nova
├── models/
│   └── psicologoModel.js          # nova: listarPsicologos, criarPsicologo,
│                                   #   buscarPsicologoPorId, atualizarNomePsicologo,
│                                   #   definirAtivoPsicologo
├── controllers/
│   └── psicologoController.js     # nova: telaPsicologos, telaNovoPsicologo,
│                                   #   processarNovoPsicologo, telaEditarPsicologo,
│                                   #   processarEditarPsicologo,
│                                   #   processarDesativarPsicologo, processarReativarPsicologo
├── routes/
│   └── dashboardRoutes.js         # rotas novas de /psicologos
└── views/
    ├── partials/
    │   └── header.ejs             # +item "Psicólogos" no menu
    └── psicologos/
        ├── lista.ejs              # nova
        ├── novo.ejs               # nova
        └── editar.ejs             # nova
test/
├── migrations.test.js             # +migration 024
├── psicologoModel.test.js         # nova
├── psicologoController.test.js    # nova
└── psicologosView.test.js         # nova
```

Controller e model ficam em arquivo próprio (`psicologoController.js`,
`psicologoModel.js`) em vez de crescer `dashboardController.js`/
`pacienteModel.js` ainda mais — mesmo raciocínio de manter cada arquivo
com uma responsabilidade clara, já grandes hoje.

## Testes

Mesmo padrão do projeto (`node --test`, `pool.query` mockado, views
renderizadas direto com `ejs.renderFile`, controllers com
`criarRespostaFalsa`):

- Migration: tabela `psicologos` com as colunas e defaults especificados
  (`ativo` não pode ser `NOT NULL` sem `DEFAULT`, senão a migration quebra
  se alguém inserir sem informar).
- Model: cada função grava/lê o esperado; `definirAtivoPsicologo` aceita
  `true`/`false` e não depende de qual era o valor anterior.
- Controller: criar com nome vazio rejeita (400); editar/desativar/reativar
  com id inexistente responde 404; caminho feliz de cada ação redireciona
  pra `/psicologos`.
- View: lista mostra badge Ativo/Inativo corretamente; botão mostra
  "Desativar" ou "Reativar" conforme o estado atual da linha; nome
  aparece corretamente escapado (sem quebrar com aspas/HTML no nome).

Verificação manual antes de considerar pronto: cadastrar, editar, desativar
e reativar um psicólogo de teste no dashboard local, contra o banco de
dev — nunca em produção sem autorização, e sem usar nome de psicólogo real
até o usuário decidir cadastrar de fato.
