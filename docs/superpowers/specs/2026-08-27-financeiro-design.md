# Financeiro

Status: aprovado — pronto para virar plano de implementação.

Sub-projeto 4 de 9 da arquitetura macro (ver
[2026-08-27-sistema-clinica-arquitetura-macro-design.md](./2026-08-27-sistema-clinica-arquitetura-macro-design.md),
"Módulo 3 — Financeiro"). Depende da Fundação (sub-projeto 1) pelo
login/dashboard e da Migração de dados legados (sub-projeto 2) pelo volume
real de `agendamentos_importados`/`pacientes` já populado. Independente do
sub-projeto 3 (Presença) — reaproveita o mesmo padrão de duas origens
unificadas (bot + importados), mas é uma tela própria, sem acoplamento de
código entre as duas.

## Objetivo

Dar pra recepção uma tela onde registrar os pagamentos recebidos (ou a
receber) de cada atendimento, cobrindo tanto os agendamentos feitos pelo bot
quanto os já migrados do sistema de agenda anterior, mais um relatório mensal agregado.

## Escopo

**Entra:**

- Tabela nova `pagamentos`, modelo de **extrato** (múltiplos lançamentos por
  agendamento são permitidos — parcial, correção, estorno viram um novo
  lançamento, nunca uma edição do anterior).
- Tela `/financeiro`: lista de agendamentos (bot + importados, unificado,
  **sem restringir a passado** — futuro entra também, por causa de
  adiantamento/sinal pago antes da consulta acontecer), cada linha mostrando
  os lançamentos já feitos + formulário pra adicionar um novo.
- Duas rotas de escrita (`POST /financeiro/agendamento/:id` e
  `POST /financeiro/importado/:id`), sempre `INSERT`, nunca `UPDATE`.
- `GET /financeiro/relatorio?mes=YYYY-MM`: totais agregados do mês (geral,
  por tipo de atendimento, por forma de pagamento, por status). Sem `mes`,
  usa o mês atual.

**Não entra** (fora do escopo deste sub-projeto):

- `pacote_id` — `pacotes_sessoes` só existe no sub-projeto 9. Decisão
  explícita: **não** criar a coluna agora (nem nullable sem FK) — evita uma
  coluna morta por 5+ sub-projetos; uma migration futura adiciona quando
  pacotes existirem de verdade.
- Faturamento TISS de convênio (geração de guia, envio pro plano) — isso é o
  sub-projeto 6. Aqui só existe o status `aguardando_reembolso` pra marcar
  que aquele atendimento de convênio ainda não foi reembolsado — nenhuma
  automação/integração em cima disso.
- Qualquer validação cruzando `convenio` do paciente com `status` do
  pagamento (ex: travar "convênio só pode ser aguardando_reembolso") — a
  recepção escolhe livremente, a clínica pode ter casos legítimos fora do
  padrão (ex: coparticipação em dinheiro na hora, mesmo sendo convênio).
- Edição/exclusão de um lançamento já feito — o modelo é de extrato
  append-only; uma correção é um novo lançamento.

## Modelo de dados

Nova migration `012_financeiro.sql`:

```sql
CREATE TABLE IF NOT EXISTS pagamentos (
  id SERIAL PRIMARY KEY,
  agendamento_id INTEGER REFERENCES agendamentos(id),
  agendamento_importado_id INTEGER REFERENCES agendamentos_importados(id),
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id),
  valor NUMERIC(10,2) NOT NULL,
  forma_pagamento TEXT NOT NULL CHECK (forma_pagamento IN ('pix', 'cartao')),
  parcelas INTEGER,
  valor_acrescimo NUMERIC(10,2),
  status TEXT NOT NULL CHECK (status IN ('pago', 'pendente', 'aguardando_reembolso')),
  data DATE NOT NULL,
  observacao TEXT,
  registrado_por INTEGER NOT NULL REFERENCES usuarios(id),
  registrado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(agendamento_id, agendamento_importado_id) = 1),
  CHECK (parcelas IS NULL OR forma_pagamento = 'cartao'),
  CHECK (valor_acrescimo IS NULL OR forma_pagamento = 'cartao'),
  CHECK (valor > 0),
  CHECK (valor_acrescimo IS NULL OR valor_acrescimo >= 0),
  CHECK (parcelas IS NULL OR parcelas > 0)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER TABLE pagamentos ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON pagamentos FROM anon, authenticated;
  END IF;
END $$;
```

Diferenças deliberadas em relação a `registros_atendimento` (sub-projeto 3):
sem índice único (múltiplos lançamentos por agendamento são o ponto), e
`paciente_id` fica direto na tabela em vez de derivado via join — necessário
porque `agendamentos_importados` **não tem** FK pra `pacientes` (só guarda
`telefone`/`nome` brutos). Resolvido na escrita: pra um pagamento de
agendamento do bot, `paciente_id = agendamentos.paciente_id` (join direto);
pra um importado, busca-se `pacientes` por `telefone = agendamentos_importados.telefone`
— sem re-normalizar, já que os dois campos já guardam o telefone
normalizado (mesma convenção usada em toda a migração do sub-projeto 2).

`valor` é o total efetivamente cobrado do paciente (já incluindo o
acréscimo do parcelamento, se houve — não é somado depois). `valor_acrescimo`
é só informativo, pra relatório futuro sobre quanto foi pago em taxa de
cartão. `parcelas`/`valor_acrescimo` só fazem sentido com
`forma_pagamento = 'cartao'`, reforçado pelos dois `CHECK` — `pix` nunca os
usa.

## Regras de negócio

- Um pagamento pode ser lançado em **qualquer** agendamento, passado ou
  futuro (adiantamento) — diferente da regra "já passou" do sub-projeto 3.
- Não existe fila de pendentes no sentido de Presença — a tela lista
  agendamentos (mais recentes primeiro, mesmo padrão de paginação
  `offsetSeguro + limiteSeguro` validado no sub-projeto 3) com os
  lançamentos já feitos visíveis, e um formulário pra adicionar mais um.
- `status` (`pago`/`pendente`/`aguardando_reembolso`) é escolhido livremente
  pela recepção em cada lançamento — sem transição automática, sem
  validação cruzada com `convenio` (ver Escopo).
- `data` é a data do pagamento em si, não necessariamente igual à data da
  consulta (ex: paciente pagou dias depois).
- `valor` precisa ser positivo (`CHECK (valor > 0)`) — um estorno é
  representado por um novo lançamento com `status`/observação indicando
  isso (ver Escopo — não há edição/exclusão), não por um valor negativo.
  `valor_acrescimo` (quando presente) é `>= 0`, `parcelas` (quando
  presente) é `> 0`.
- Agendamento inexistente → 404. Não existe caso de "agendamento
  cancelado/ainda não ocorreu" bloqueando o lançamento (diferente de
  Presença) — pagamento pode ser registrado independente do status do
  agendamento ou de já ter acontecido.

## Fluxo de marcação

1. Recepção abre `/financeiro` (ou `/financeiro?data=YYYY-MM-DD` pra um dia
   específico) — vê a lista combinada (bot + importados), cada linha com
   paciente, data/hora, tipo, origem, os lançamentos já feitos (valor,
   forma, parcelas se houver, status, data, observação se houver) e um
   formulário pra adicionar um novo lançamento.
2. `POST` na rota correspondente à origem faz um `INSERT` simples em
   `pagamentos` (resolvendo `paciente_id` como descrito acima) — sem
   transação, sem upsert, já que não há restrição de unicidade a proteger.
3. `GET /financeiro/relatorio?mes=YYYY-MM` roda uma agregação (`SUM`/`COUNT`
   agrupado) sobre `pagamentos.data` dentro do mês pedido — total geral,
   breakdown por `tipo_atendimento` (via join com a origem — `agendamentos`
   ou `agendamentos_importados`, conforme qual FK está preenchida),
   breakdown por `forma_pagamento`, breakdown por `status`.

## Estrutura de arquivos

```
src/
├── db/
│   └── migrations/
│       └── 012_financeiro.sql            # novo
├── models/
│   └── pagamentoModel.js                 # novo — listagem, inserção, relatório
├── controllers/
│   └── dashboardController.js            # +telaFinanceiro, +processarPagamento*, +telaRelatorioFinanceiro
├── routes/
│   └── dashboardRoutes.js                # +GET/POST /financeiro...
└── views/
    └── financeiro/
        ├── lista.ejs                     # novo
        └── relatorio.ejs                 # novo
```

## Testes

Mesmo padrão dos sub-projetos anteriores (`node --test`, `pool.query`
mockado via `t.mock.method`, sem Postgres real):

- Model: listagem combinada com/sem filtro de `data`; inserção de pagamento
  resolvendo `paciente_id` corretamente nas duas origens; agregação do
  relatório mensal (totais gerais e os três breakdowns).
- Controller: fluxo feliz nas duas origens; validação de
  `forma_pagamento`/`status`/`valor` (numérico, positivo); regra
  `parcelas`/`valor_acrescimo` só aceitos com `forma_pagamento = 'cartao'`;
  404 pra agendamento inexistente. Sem transação nem caso de corrida — mais
  simples que o sub-projeto 3, já que todo `POST` aqui é um `INSERT` puro.

Verificação manual antes de considerar pronto: mesmo método do sub-projeto 3
(importar `src/app.js` direto, nunca `server.js`, pra não armar os crons de
lembrete/WhatsApp/OpenAI), com dados de teste claramente marcados, cobrindo
lançamento em agendamento do bot e importado, lançamento em agendamento
futuro (adiantamento), múltiplos lançamentos no mesmo agendamento, e o
relatório mensal batendo com os valores esperados.
