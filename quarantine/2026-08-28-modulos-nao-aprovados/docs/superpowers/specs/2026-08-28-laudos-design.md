# Laudos/relatório de atendimento

Status: aprovado — pronto para virar plano de implementação.

Sub-projeto 5 de 9 da arquitetura macro (ver
[2026-08-27-sistema-clinica-arquitetura-macro-design.md](./2026-08-27-sistema-clinica-arquitetura-macro-design.md),
"Módulo 5 — Laudos/relatório de atendimento"). Depende do Presença/Prontuário
leve (sub-projeto 3) pela existência de `registros_atendimento` e
`observacao_sessao`.

## Objetivo

Gerar, sob demanda, um documento em PDF por atendimento a partir da
observação já registrada em `/presenca`, pra recepção entregar manualmente
ao paciente (impresso, WhatsApp, etc.).

## Escopo

**Entra:**

- PDF de modelo fixo (não varia por especialidade), gerado em memória e
  devolvido como download — nada fica salvo em disco/banco.
- Botão "Gerar laudo" na tela `/presenca`, visível só nas linhas com
  `observacao_sessao` preenchida.
- Novo campo opcional `profissional_responsavel` em `registros_atendimento`,
  preenchido junto com a observação no momento do atendimento.

**Não entra** (fora do escopo deste sub-projeto — decisão explícita, ver
brainstorming):

- **Envio por e-mail.** O projeto não tem serviço de e-mail configurado nem
  campo de e-mail em `pacientes` hoje. Implementar isso agora seria escopo
  bem maior (escolher/configurar provedor, coletar e-mail de cada paciente)
  pra um caso de uso que a entrega manual (PDF baixado + WhatsApp/impresso)
  já resolve. Fica como extensão futura se a clínica realmente sentir falta.
- Identidade visual (logo/cores da clínica no cabeçalho) — layout de texto
  simples por enquanto; pode virar um ajuste incremental depois, sem mexer
  na geração de dados.
- CPF/data de nascimento do paciente no documento — o conteúdo aprovado é
  nome da clínica, nome do paciente, data do atendimento, nome do
  profissional (quando houver) e o texto da observação.
- Qualquer histórico/versionamento de laudos gerados — é sempre gerado do
  zero a partir do estado atual de `registros_atendimento`, não existe
  "laudo salvo" como entidade própria.

## Modelo de dados

Nova migration `013_laudos.sql`, só adiciona uma coluna:

```sql
ALTER TABLE registros_atendimento
  ADD COLUMN IF NOT EXISTS profissional_responsavel TEXT;
```

Sem `NOT NULL` — retroativo (registros já existentes ficam com `NULL`) e
opcional daqui pra frente (não bloqueia o fluxo de marcar presença pra quem
não preencher). Sem tabela nova: o laudo é derivado de
`registros_atendimento` + `pacientes`/`agendamentos_importados` já
existentes, gerado sob demanda, nunca persistido.

## Regras de negócio

- Só é possível gerar laudo pra um registro com `observacao_sessao` não
  vazia — reflete a definição do módulo no macro-design ("a partir do que
  já estiver em `observacao_sessao`"). Sem observação, não tem o que
  documentar.
- `profissional_responsavel`, quando ausente:
  - Agendamento do bot: campo simplesmente não aparece no PDF (sem
    "profissional: —" ou similar, omite a linha inteira).
  - Agendamento importado: usa `agendamentos_importados.atendente` como
    fallback, se existir (dado real do sistema de agenda anterior). Só omite a linha
    se nem `profissional_responsavel` nem `atendente` existirem.
- Nome do paciente: `pacientes.nome` (bot) ou `agendamentos_importados.nome`
  (importado) — mesma fonte já usada em `/presenca` e `/financeiro`.
- Data do atendimento: `agendamentos.data`/`agendamentos_importados.data`
  (a data da consulta em si, não `registrado_em`).

## Fluxo

1. Recepção abre `/presenca`, vê o botão "Gerar laudo" nas linhas com
   observação preenchida (mesma lista já existente, sem mudança de
   listagem — só o botão condicional na view).
2. Clique dispara `GET /presenca/agendamento/:id/laudo` ou
   `GET /presenca/importado/:id/laudo` (mesma convenção de rotas
   origem-específica já usada em `/presenca` e `/financeiro`).
3. Controller busca o registro (reaproveita o padrão de
   `buscarAgendamentoParaPresenca`/`buscarImportadoParaPresenca` do
   sub-projeto 3, com join adicional pra observação/profissional). O model
   retorna um motivo estruturado — mesmo padrão de
   `registrarPresencaBot`/`registrarPresencaImportado` (`nao_encontrado`,
   `cancelado`, `conflito`): aqui, `nao_encontrado` (agendamento/importado
   não existe → 404) ou `sem_observacao` (existe mas `observacao_sessao` é
   nula/vazia → 400) — só quando nenhum dos dois motivos se aplica é que o
   controller monta os dados e chama o gerador de PDF.
4. `gerarPdfLaudo(dados)` usa `pdfkit`: cabeçalho "Clínica Exemplo — Fisioterapia
   & Psicologia", nome do paciente, data do atendimento, profissional (se
   houver), corpo com o texto de `observacao_sessao`. Devolve um `Buffer`.
5. Controller responde com
   `Content-Type: application/pdf` +
   `Content-Disposition: attachment; filename="laudo-<paciente>-<data>.pdf"`.

## Estrutura de arquivos

```
src/
├── db/
│   └── migrations/
│       └── 013_laudos.sql                 # novo
├── models/
│   ├── registroAtendimentoModel.js        # +profissionalResponsavel nos INSERTs/updates existentes
│   └── laudoModel.js                      # novo — busca dados pra montar o laudo
├── services/
│   └── laudoPdfService.js                 # novo — gerarPdfLaudo(dados) com pdfkit
├── controllers/
│   └── dashboardController.js             # +gerarLaudoBot, +gerarLaudoImportado
├── routes/
│   └── dashboardRoutes.js                 # +GET /presenca/:origem/:id/laudo
└── views/
    └── presenca/
        └── lista.ejs                      # +campo profissional_responsavel no form, +botão "Gerar laudo" condicional
```

## Dependência nova

`pdfkit` — gera PDF em Node puro, sem headless browser. Escolhida em vez de
`puppeteer`+HTML (mais fiel visualmente, mas ~300MB de Chromium e mais
memória em runtime) porque o layout aprovado é simples/sem identidade
visual — right-sized pro escopo.

## Testes

Mesmo padrão dos sub-projetos anteriores (`node --test`, `pool.query`
mockado, sem Postgres real):

- Model: busca dos dados do laudo nas duas origens, incluindo o fallback
  `profissional_responsavel` → `atendente` → omitido; motivo
  `nao_encontrado` pra registro inexistente; motivo `sem_observacao` pra
  `observacao_sessao` nula/vazia.
- Service (`laudoPdfService`): teste de "smoke" gerando um PDF de verdade
  (sem mock — é geração pura em memória, não tem I/O externo) e checando
  que o `Buffer` começa com o header `%PDF` e tem tamanho > 0; um teste
  confirmando que o nome do profissional aparece no texto extraído quando
  presente, e não aparece quando ausente (via alguma lib de extração de
  texto de PDF, ou checando os comandos de texto do `pdfkit` antes de
  finalizar o documento — decidir no plano de implementação, o que for mais
  simples de asserir).
- Controller: fluxo feliz nas duas origens, headers de resposta corretos
  (`Content-Type`, `Content-Disposition`), 404 pra registro inexistente,
  400 pra observação vazia.

Verificação manual antes de considerar pronto: mesmo método dos
sub-projetos anteriores (importar `src/app.js` direto, nunca `server.js`),
gerando um laudo de verdade a partir de um registro de teste e abrindo o
PDF resultante pra conferir visualmente que o layout está legível.
