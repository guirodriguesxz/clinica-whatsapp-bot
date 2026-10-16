# Guia de convênio (sub-projeto 6 — versão simplificada do "Faturamento TISS")

Status: rascunho — escopo definido a partir de uma resposta rápida do
usuário (dono do projeto), não de uma conversa com a contabilidade da
clínica. **Premissas abaixo marcadas explicitamente pra confirmação
posterior** — o usuário pediu pra seguir e ajustar depois se algo estiver
errado.

## O que o usuário confirmou

- A clínica fatura convênio: imprime guias.
- Emite estorno de guia também.
- Não confirmou (e provavelmente não sabe de cabeça) se esse faturamento é
  feito no formato eletrônico TISS padrão ANS (XML, códigos TUSS, envio pro
  sistema do operador de convênio) ou se é um processo mais simples — imprime
  um documento em papel/PDF com os dados do atendimento pra entregar/enviar
  ao convênio, sem integração eletrônica direta.

## Decisão de escopo (assumida, a confirmar)

**Vou implementar a segunda opção: um "Guia de convênio" simples, em PDF,
gerado sob demanda — mesma arquitetura do módulo de Laudos (sub-projeto 5),
não uma implementação do padrão TISS/ANS completo.**

Motivos pra essa escolha, não só preguiça de escopo:

1. **Faltam os dados que uma guia TISS real exige** — número de carteirinha
   do beneficiário, código do procedimento (tabela TUSS), registro ANS/CNES
   do prestador, versão do padrão TISS. Nada disso existe hoje no schema
   (`pacientes`/`agendamentos_importados` só têm `convenio` como texto livre).
   Implementar TISS de verdade seria um sub-projeto bem maior, com coleta de
   dados nova em vários pontos do sistema.
2. **"Imprime guias" bate mais com um documento pra entregar/anexar** do que
   com "meu sistema manda XML pro convênio automaticamente" — isso último
   normalmente envolve homologação com cada operadora, processo que uma
   clínica pequena raramente faz por conta própria (mesma ressalva que já
   estava no spec macro original).
3. Reaproveita quase toda a infraestrutura que **já existe e já foi
   testada**: `pagamentos` (Financeiro, sub-projeto 4) e a geração de PDF em
   memória (`laudoPdfService.js`, sub-projeto 5) — menor risco, menor tempo.

**Se depois de usar isso a clínica confirmar que precisa mesmo do TISS
eletrônico (XML pro operador), esse trabalho vira uma extensão bem maior por
cima do que for construído aqui — não um retrabalho, o "Guia de convênio"
em PDF continua útil como documento pra entregar em mãos.**

## Escopo

**Entra:**

- Novo valor `'convenio'` em `pagamentos.forma_pagamento` (hoje só aceita
  `'pix'`/`'cartao')`) — convênio é uma forma de cobrança distinta, não um
  meio de pagamento do paciente.
- Novo campo opcional `numero_carteirinha` em `pacientes` e
  `agendamentos_importados` — pra imprimir na guia quando existir. Sem
  `NOT NULL`, mesma lógica retroativa do `profissional_responsavel` dos
  Laudos.
- Botão "Gerar guia" em `/financeiro`, visível só nas linhas de pagamento com
  `forma_pagamento = 'convenio'` (mesmo padrão condicional do "Gerar laudo"
  em `/presenca`).
- PDF com: nome da clínica, nome do paciente, convênio, número da
  carteirinha (se existir), data do atendimento, tipo de atendimento, valor,
  profissional responsável (se existir, reaproveitando o mesmo campo dos
  Laudos), e **um número de guia = o `id` do pagamento** (simples, sem tabela
  de numeração própria — não é um número oficial de protocolo TISS).
- Estorno: **reaproveita o `status = 'estornado'` que o Financeiro já tem**
  — nenhuma tabela ou fluxo novo. Gerar a guia de um pagamento com
  `status = 'estornado'` continua funcionando, mas o PDF estampa
  "GUIA CANCELADA" com destaque (a mesma decisão de "sempre gerar do zero a
  partir do estado atual" já usada nos Laudos, sem histórico de guias como
  entidade própria).

**Não entra (mesmas razões do "Não entra" dos Laudos, adaptadas):**

- Geração de XML no padrão TISS/ANS, códigos TUSS, envio eletrônico pro
  operador de convênio, homologação — infraestrutura muito maior, sem os
  dados necessários hoje.
- Conciliação automática de repasse do convênio (quanto foi efetivamente
  pago pelo operador vs. valor faturado) — o Financeiro já registra
  `pago`/`pendente`/`aguardando_reembolso`, isso cobre o acompanhamento
  manual que já existe.
- Numeração sequencial "oficial" de guia (protocolo) — usa o `id` interno.
- Identidade visual, histórico/versionamento de guias — mesmas exclusões dos
  Laudos.

## Modelo de dados

Nova migration `014_guia_convenio.sql`:

```sql
ALTER TABLE pagamentos DROP CONSTRAINT IF EXISTS pagamentos_forma_pagamento_check;
ALTER TABLE pagamentos ADD CONSTRAINT pagamentos_forma_pagamento_check
  CHECK (forma_pagamento IN ('pix', 'cartao', 'convenio'));

ALTER TABLE pacientes
  ADD COLUMN IF NOT EXISTS numero_carteirinha TEXT;

ALTER TABLE agendamentos_importados
  ADD COLUMN IF NOT EXISTS numero_carteirinha TEXT;
```

(nome real da constraint gerada automaticamente precisa ser confirmado com
`\d pagamentos` antes de aplicar em produção — mesma ressalva já usada na
migration 011 pro CHECK de `agendamentos.status`.)

## Regras de negócio

- `forma_pagamento = 'convenio'` não usa `parcelas`/`valor_acrescimo` (só
  cartão usa, regra já existente) — o CHECK do banco já impede isso.
- Botão "Gerar guia" só aparece quando `forma_pagamento === 'convenio'`
  (diferente de Laudos, que depende de `observacao_sessao`; aqui depende do
  pagamento em si).
- Guia usa o **paciente e o atendimento do pagamento**, não do agendamento
  isolado — reaproveita o mesmo JOIN que `listarFinanceiro` já faz
  (`pagamentos` → `agendamentos`/`agendamentos_importados` → `pacientes`).
- `numero_carteirinha` ausente: omite a linha (mesmo padrão de
  `profissional_responsavel` nos Laudos).

## Fluxo

1. Recepção abre `/financeiro`, vê "Gerar guia" nos pagamentos com forma
   `convenio`.
2. Clique dispara `GET /financeiro/pagamento/:id/guia`.
3. Controller busca os dados do pagamento (paciente, convênio, carteirinha,
   atendimento, valor, profissional, status) — 404 se o pagamento não
   existir.
4. `gerarPdfGuiaConvenio(dados)` (novo, em `laudoPdfService.js` ou um
   `guiaConvenioPdfService.js` próprio — decidir no plano) monta o PDF.
5. Controller responde com `Content-Type: application/pdf` +
   `Content-Disposition: attachment; filename="guia-<paciente>-<data>.pdf"`.

## Testes

Mesmo padrão dos módulos anteriores (`node --test`, `pool.query` mockado).

## Pendências explícitas pro usuário confirmar

1. **O mais importante:** essa clínica realmente só imprime um documento
   simples, ou existe algum sistema/portal do convênio que exige o arquivo
   TISS eletrônico de verdade? Se for o segundo caso, este spec cobre só a
   metade "documento pra entregar", não a submissão eletrônica.
2. O "estorno de guia" que você mencionou é o mesmo estorno que já existe em
   `/financeiro` (mudar o status do pagamento pra `estornado`), ou é algo
   diferente — tipo uma "guia de estorno/cancelamento" separada que o
   convênio pede num formato próprio?
3. Faz sentido a guia usar o `id` do pagamento como "número da guia", ou a
   clínica já tem uma numeração própria (talvez sequencial, talvez por
   convênio) que precisa ser reproduzida?
