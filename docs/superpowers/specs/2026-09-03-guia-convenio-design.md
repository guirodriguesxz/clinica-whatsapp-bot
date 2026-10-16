# Guia de convênio — design

Data: 2026-09-03
Status: aprovado, pronto pra virar plano de implementação

## Contexto

Item em aberto no roadmap desde 2026-08-28: a Clínica Exemplo atende convênio e
precisa emitir "guias" (documentos de faturamento pro convênio), incluindo
estorno de guia. Um rascunho anterior (`quarantine/2026-08-28-modulos-nao-aprovados/`)
já explorou esse escopo mas ficou quarentenado — sem confirmação se a
clínica precisa do padrão eletrônico TISS/ANS completo (XML, código TUSS,
envio direto pro sistema do operador, homologação por convênio) ou de algo
mais simples.

Em 2026-09-03 o usuário confirmou (com incerteza reconhecida — "acho que"):
a recepção mesma lança os dados nos portais dos convênios; o software só
precisa gerar um documento de referência. O estorno de guia é o mesmo
estorno que já existe em `/financeiro` — a recepção que cuida da parte do
lado do convênio. Não há numeração própria de guia conhecida.

**Decisão de escopo**: um "Guia de convênio" simples em PDF, gerado sob
demanda, mesma arquitetura do módulo de Laudos (sub-projeto 5) — não uma
implementação do padrão TISS/ANS eletrônico. Se depois a clínica confirmar
que precisa do TISS eletrônico de verdade, isso vira uma extensão bem maior
por cima do que for construído aqui, não retrabalho — a guia em PDF continua
útil como documento de referência.

## Por que isso é mais simples do que o rascunho de 2026-08-28 previa

O rascunho original propunha migrations novas (`numero_carteirinha` em
`pacientes` e `agendamentos_importados`). Essas migrations não são mais
necessárias: a migration `023_dados_cadastrais_paciente.sql` (2026-09-03, já
em produção) adicionou `pacientes.matricula_convenio`, e `pacientes.convenio`
já existe desde a migration `001_init.sql`. Como `pagamentos.paciente_id` é
`NOT NULL` (migration `012_financeiro.sql`) — sempre preenchido, tanto pra
pagamento de agendamento do bot quanto de agendamento importado — todo
pagamento já tem um caminho direto e garantido até `convenio`/`matricula_convenio`
via `pacientes`, sem precisar resolver telefone/paciente separadamente (ao
contrário do fluxo de registrar pagamento importado, que faz esse
matching). A única mudança de schema que sobra é liberar `'convenio'` como
valor de `pagamentos.forma_pagamento`.

## Escopo

**Entra:**

- Novo valor `'convenio'` em `pagamentos.forma_pagamento` (hoje só aceita
  `'pix'`/`'cartao'`) — convênio é uma forma de cobrança distinta, não um
  meio de pagamento do paciente. Mesma regra já existente de
  `parcelas`/`valor_acrescimo` exclusivos de cartão continua valendo (convênio
  não usa nenhum dos dois). Isso exige duas mudanças em código, além da
  migration: `FORMA_PAGAMENTO_VALIDA` em `dashboardController.js` (hoje
  `["pix", "cartao"]`, usado por `validarCamposPagamento` pra aceitar o
  registro do pagamento) e o `<select name="forma_pagamento">` do formulário
  "Registrar pagamento" em `financeiro/lista.ejs` ganham a opção `convenio`
  — sem a primeira, o formulário rejeitaria o pagamento com 400 mesmo
  depois da migration.
- Botão "Gerar guia" em `/financeiro`, em cada entrada de pagamento com
  `forma_pagamento = 'convenio'` que não seja ela mesma um estorno (mesmo
  padrão condicional de "Gerar laudo" em `/agendamentos`).
- PDF com: nome da clínica, nome do paciente, convênio, matrícula (se
  existir), data do atendimento, tipo de atendimento, valor, profissional
  responsável (se existir), e um "número de guia" = o `id` do pagamento
  (simples, sem numeração oficial de protocolo).
- Estorno: reaproveita o fluxo de estorno que `/financeiro` já tem —
  nenhuma tabela ou rota nova. Gerar a guia de um pagamento que já tem um
  estorno vinculado continua funcionando, mas o PDF estampa **"GUIA
  CANCELADA"** com destaque.
- Rota gera a guia sempre a partir do estado atual do pagamento — sem
  histórico de guias como entidade própria (mesma decisão já usada nos
  Laudos).

**Não entra:**

- Geração de XML no padrão TISS/ANS, código TUSS, envio eletrônico pro
  operador de convênio, homologação — infraestrutura muito maior, sem os
  dados necessários hoje (carteirinha formal, registro ANS/CNES do
  prestador, versão do padrão). Fica registrado no TODO como pendência
  separada, caso a clínica confirme mais adiante que precisa disso.
- Conciliação automática de repasse do convênio (quanto foi efetivamente
  pago pelo operador vs. valor faturado) — o Financeiro já registra
  `pago`/`pendente`/`aguardando_reembolso`, cobre o acompanhamento manual.
- Numeração sequencial "oficial" de guia/protocolo — usa o `id` interno.
- Identidade visual, histórico/versionamento de guias.
- Validar `forma_pagamento` no backend da rota de geração — a rota gera a
  guia de qualquer pagamento existente que não seja ele mesmo um estorno; o
  botão "Gerar guia" só aparecer em linhas `convenio` no `/financeiro` é o
  único controle de quando isso é usado na prática (mesmo nível mínimo de
  validação que a rota de laudo já usa hoje).

## Modelo de dados

Nova migration `025_guia_convenio.sql`:

```sql
ALTER TABLE pagamentos DROP CONSTRAINT IF EXISTS pagamentos_forma_pagamento_check;
ALTER TABLE pagamentos ADD CONSTRAINT pagamentos_forma_pagamento_check
  CHECK (forma_pagamento IN ('pix', 'cartao', 'convenio'));
```

(nome real da constraint gerada automaticamente precisa ser confirmado com
`\d pagamentos` antes de aplicar em produção — mesma ressalva já usada nas
migrations 011 e 013.)

Nenhuma coluna nova. `pacientes.convenio` e `pacientes.matricula_convenio`
já existem.

## Consulta dos dados da guia

Um pagamento sempre tem `paciente_id` preenchido e exatamente um de
`agendamento_id`/`agendamento_importado_id` (CHECK já existente). A consulta
junta os três, sem precisar resolver telefone:

```sql
SELECT
  pg.id, pg.valor, pg.data AS data_pagamento, pg.tipo_lancamento,
  p.nome AS paciente_nome, p.convenio, p.matricula_convenio,
  COALESCE(a.tipo_atendimento, ai.tipo_atendimento) AS tipo_atendimento,
  COALESCE(a.data, ai.data) AS data_atendimento,
  ra.profissional_responsavel,
  estorno.id AS estornado_por
FROM pagamentos pg
JOIN pacientes p ON p.id = pg.paciente_id
LEFT JOIN agendamentos a ON a.id = pg.agendamento_id
LEFT JOIN agendamentos_importados ai ON ai.id = pg.agendamento_importado_id
LEFT JOIN registros_atendimento ra
  ON ra.agendamento_id = pg.agendamento_id OR ra.agendamento_importado_id = pg.agendamento_importado_id
LEFT JOIN pagamentos estorno ON estorno.pagamento_origem_id = pg.id
WHERE pg.id = $1
```

`estornado_por IS NOT NULL` é o sinal de "esse pagamento já foi estornado"
— o mesmo padrão que `CAMPOS_PAGAMENTO_JSON` em `pagamentoModel.js` já usa
pro badge "Pagamento estornado" em `/financeiro` (é uma linha nova
append-only ligada por `pagamento_origem_id`, não uma mudança de `status`
na linha original — `estornarPagamento` nunca altera `pg.status`).

## Regras de negócio

- Pedir a guia de um pagamento com `tipo_lancamento = 'estorno'` (a própria
  linha do estorno, não o original) retorna 404 — guia se gera a partir do
  pagamento original, nunca da linha de estorno.
- Pedir a guia de um `id` de pagamento inexistente retorna 404.
- `matricula_convenio`/`convenio`/`profissional_responsavel` ausentes:
  omite a linha no PDF (mesmo padrão já usado nos Laudos).
- PDF estampa "GUIA CANCELADA" com destaque quando `estornado_por` não é
  nulo — sem bloquear a geração.

## Fluxo

1. Recepção registra um pagamento com forma "Convênio" em `/financeiro`
   (novo `<option value="convenio">` no formulário "Registrar pagamento").
2. A entrada desse pagamento na lista mostra "Gerar guia".
3. Clique dispara `GET /financeiro/pagamento/:id/guia`.
4. Controller busca os dados (`buscarDadosGuiaConvenio`), 404 se não
   encontrado ou se for uma linha de estorno.
5. `gerarPdfGuiaConvenio(dados)` (novo `guiaConvenioPdfService.js`, mesmo
   padrão do `laudoPdfService.js`: função pura de linhas de cabeçalho +
   pdfkit) monta o PDF.
6. Controller responde com `Content-Type: application/pdf` +
   `Content-Disposition: attachment; filename="guia-<paciente>-<data>.pdf"`.

## Testes

Mesmo padrão do resto do projeto (`node --test`, `pool.query` mockado):
model (dados corretos, "Não informado"/omissão de campos ausentes,
`estornado_por` detectado corretamente), controller/rota (404 pra pagamento
inexistente e pra linha de estorno), PDF service (linhas de cabeçalho
condicionais — mesmo padrão de teste de `linhasCabecalhoLaudo`), view
(botão "Gerar guia" só aparece em linhas `convenio` não-estorno).

## Pendência explícita pro usuário confirmar depois

O usuário respondeu com incerteza ("acho que") se a recepção realmente só
usa o PDF como referência pros portais dos convênios, sem exigir arquivo
eletrônico TISS. Essa é a premissa deste spec. Baixo risco se estiver
errada — é só um documento gerado sob demanda, sem integração — mas vale
confirmar com quem cuida do faturamento assim que possível, e registrar no
TODO como pendência.
