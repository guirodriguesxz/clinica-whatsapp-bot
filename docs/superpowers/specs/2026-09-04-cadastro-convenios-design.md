# Cadastro de convênios (Fase 1 de repasse por convênio)

Status: aprovado em 2026-09-04.

Motivado por: o usuário mandou fotos de uma tabela de repasse por convênio
(valor de avaliação e de sessão que a clínica repassa por convênio) e de um
caderno onde soma faturamento à mão por período/profissional. O objetivo
final é o sistema calcular o repasse automaticamente a partir dos
atendimentos já registrados, substituindo essa conta manual. Esse objetivo
final foi dividido em três etapas encadeadas (mesmo ritmo usado com
psicólogos):

1. **Cadastro de convênios com valores de repasse** — esta spec.
2. Trocar `paciente.convenio` de texto livre pra essa lista (dropdown) —
   fase futura, spec própria.
3. Calcular o repasse no relatório financeiro (`/financeiro/relatorio`),
   que já agrupa pagamentos por convênio e conta quantidade por mês — só
   falta multiplicar pela tabela de valores — fase futura, spec própria.

Esta spec cobre só a etapa 1: nenhuma ligação com paciente ou cálculo de
repasse ainda.

## Objetivo

Dar à equipe uma tela simples pra manter a lista de convênios da clínica
(nome, ativo/inativo, valor de repasse por avaliação, valor de repasse por
sessão) — mesmo padrão do cadastro de psicólogos
(`docs/superpowers/specs/2026-09-03-cadastro-psicologos-design.md`).

## Escopo

**Entra:**

- Migration 028: tabela nova `convenios` (`id`, `nome` TEXT NOT NULL,
  `ativo` BOOLEAN NOT NULL DEFAULT true, `valor_repasse_avaliacao`
  NUMERIC(10,2) NULL, `valor_repasse_sessao` NUMERIC(10,2) NULL,
  `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()). Os dois valores de
  repasse ficam nullable — dá pra cadastrar o convênio primeiro e preencher
  os valores depois, sem bloquear nada (mesmo raciocínio do psicólogo
  opcional no agendamento).
- Tela `/convenios`: lista todos (ativos e inativos, com badge de status),
  mostrando nome e os dois valores de repasse (ou "—" quando não
  preenchido), link "Novo convênio", e ações por linha (Editar,
  Desativar/Reativar conforme o estado atual).
- `GET/POST /convenios/novo` — cadastra nome (obrigatório) e os dois
  valores de repasse (opcionais, formato monetário). `ativo = true` por
  padrão.
- `GET/POST /convenios/:id/editar` — corrige nome e/ou valores de repasse.
  Não mexe em `ativo` (ação separada, ver abaixo).
- `POST /convenios/:id/desativar` e `POST /convenios/:id/reativar` —
  alternam `ativo`. Nunca exclusão definitiva (`DELETE`) — mesmo padrão de
  `psicologos`/`usuarios`: preserva o vínculo caso a fase 2/3 passe a
  referenciar `convenios.id`.
- Mesma permissão do resto do dashboard consultado no dia a dia: **qualquer
  usuário logado**, sem exigir papel de administradora — não é uma conta de
  acesso ao sistema, é dado de cadastro (mesmo critério de psicólogos).
- Item "Convênios" no menu lateral (`src/views/partials/header.ejs`),
  visível pra qualquer usuário logado.
- Validação: nome obrigatório (não vazio após trim); valores de repasse,
  quando informados, precisam ser números não-negativos — texto inválido
  ou negativo é rejeitado com 400, mas campo vazio é aceito (fica null).

**Não entra (fica pras próximas fases):**

- Qualquer ligação com `pacientes.convenio` (continua texto livre por
  enquanto) ou com agendamento/pagamento.
- Qualquer cálculo de repasse no relatório financeiro.
- Seed dos convênios reais da clínica (a tabela do usuário tem ~24
  convênios) — cadastro é manual pela própria tela depois que a feature
  estiver no ar, não faz parte desta migration/PR.
- Campos além de nome, ativo e os dois valores de repasse (ex: código do
  convênio, tabela TISS) — fora de escopo por ora.

## Fluxo

1. Qualquer usuário logado abre "Convênios" no menu → vê a lista (vazia no
   primeiro acesso) → clica em "Novo convênio" → digita o nome e,
   opcionalmente, os valores de repasse → salva → aparece na lista como
   Ativo.
2. Pra corrigir nome ou valores depois: clica em "Editar" na linha →
   altera → salva → volta pra lista.
3. Pra parar de mostrar um convênio que a clínica não atende mais: clica em
   "Desativar" → badge vira "Inativo". Pode reativar a qualquer momento.

## Estrutura de arquivos

```
src/
├── db/migrations/
│   └── 028_convenios.sql            # nova
├── models/
│   └── convenioModel.js             # nova: listarConvenios, criarConvenio,
│                                     #   buscarConvenioPorId, atualizarConvenio,
│                                     #   definirAtivoConvenio
├── controllers/
│   └── convenioController.js        # nova: telaConvenios, telaNovoConvenio,
│                                     #   processarNovoConvenio, telaEditarConvenio,
│                                     #   processarEditarConvenio,
│                                     #   processarDesativarConvenio, processarReativarConvenio
├── routes/
│   └── dashboardRoutes.js           # rotas novas de /convenios
└── views/
    ├── partials/
    │   └── header.ejs               # +item "Convênios" no menu
    └── convenios/
        ├── lista.ejs                # nova
        ├── novo.ejs                 # nova
        └── editar.ejs               # nova
test/
├── migrations.test.js               # +migration 028
├── convenioModel.test.js            # nova
├── convenioController.test.js       # nova
└── conveniosView.test.js            # nova
```

Controller e model em arquivo próprio, mesmo raciocínio de
`psicologoController.js`/`psicologoModel.js`.

## Testes

Mesmo padrão do projeto (`node --test`, `pool.query` mockado, views
renderizadas direto com `ejs.renderFile`, controllers com
`criarRespostaFalsa`):

- Migration: tabela `convenios` com as colunas e defaults especificados;
  os dois valores de repasse não podem ser `NOT NULL`.
- Model: cada função grava/lê o esperado; valores de repasse aceitam
  `null`; `definirAtivoConvenio` aceita `true`/`false`.
- Controller: criar com nome vazio rejeita (400); valor de repasse
  negativo ou não-numérico rejeita (400); campo de repasse vazio grava
  `null` (não rejeita); editar/desativar/reativar com id inexistente
  responde 404; caminho feliz de cada ação redireciona pra `/convenios`.
- View: lista mostra badge Ativo/Inativo corretamente e os valores de
  repasse (ou "—" quando ausentes); botão mostra "Desativar" ou
  "Reativar" conforme o estado da linha; nome aparece corretamente
  escapado.

Verificação manual antes de considerar pronto: cadastrar, editar,
desativar e reativar um convênio de teste no dashboard local, contra o
banco de produção (não há banco de dev separado) — nunca com nome de
convênio real até o usuário decidir cadastrar de fato.
