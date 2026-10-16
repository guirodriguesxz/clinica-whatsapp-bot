# TISS eletrônico (lote de guias SP/SADT) — design

Data: 2026-09-04
Status: aprovado, pronto pra virar plano de implementação

## Contexto

Item registrado como pendência desde o design do [Guia de convênio](2026-09-03-guia-convenio-design.md)
(2026-09-03): a Clínica Exemplo atende convênio e emite hoje um PDF simples de
referência por atendimento, não o padrão eletrônico TISS/ANS. O usuário
respondeu com incerteza ("acho que") se a recepção realmente só usa esse PDF
como referência pros portais dos convênios, sem exigir arquivo TISS
eletrônico de verdade.

Em 2026-09-04 o usuário decidiu seguir com a implementação do TISS eletrônico
**mesmo sem confirmar essa necessidade com quem cuida do faturamento na
clínica**, e mesmo sem ter em mãos os dados cadastrais reais (CNES, registro
do prestador em cada operadora, códigos TUSS por procedimento). Essa decisão
foi tomada conscientemente: o risco é entregar algo que pode não ser
necessário, ou que fica incompleto até os dados reais serem levantados — ver
seção "Riscos e limitações conhecidas" abaixo.

## Escopo

**Entra:**

- Gerar um arquivo XML de **lote de guias SP/SADT** (padrão TISS, guia usada
  pra sessão/atendimento de fisioterapia ou psicologia — não guia de
  consulta nem de internação, confirmado com o usuário como o tipo correto
  pra esse tipo de serviço) pra um convênio e período escolhidos.
- Cadastro novo de dados do prestador (a clínica) e de dados por convênio
  (código do prestador na operadora, número de contrato) — sem esses dados
  preenchidos, o lote não é gerado pra aquele convênio.
- Cadastro novo de mapeamento de código TUSS por convênio, cruzando
  `tipo_atendimento` (`fisioterapia`/`psicologia`) × categoria
  (`avaliacao`/`sessao`, mesma distinção de `primeira_consulta` já usada no
  cálculo de repasse) — até 4 combinações por convênio.
- O XML é gerado **apenas pra upload manual** no portal de cada operadora —
  confirmado com o usuário que não há necessidade de integração direta
  (webservice/SOAP) com nenhuma operadora.
- Guias individuais sem dado suficiente (sem TUSS cadastrado pra aquela
  combinação, paciente sem `matricula_convenio`) são **excluídas do lote**
  com um motivo explícito na tela de confirmação — nunca bloqueiam as
  demais guias do mesmo lote, e nunca preenchem com valor inventado.

**Não entra:**

- Transmissão eletrônica direta (webservice/SOAP) a qualquer operadora.
- Validação do XML contra o XSD oficial da ANS — o gerador escreve a
  estrutura manualmente (sem dependência nova de XML no projeto), sem
  checagem formal de schema.
- Campos TISS obrigatórios que não existem em nenhuma tabela hoje: sexo e
  CNS do paciente, CBO/registro de conselho do profissional executante,
  caráter do atendimento. Ver "Riscos e limitações conhecidas".
- Histórico/versionamento de lotes gerados — mesma decisão já usada em
  Laudos e Guia de convênio: gera sempre a partir do estado atual, sem
  entidade própria de "lote".
- Outros tipos de guia TISS (consulta, resumo de internação, honorário
  individual).
- Numeração sequencial oficial de lote/protocolo — geração é sob demanda,
  sem registro de "lote N já enviado".

## Modelo de dados

Três migrations novas.

### `030_dados_prestador.sql`

Tabela de linha única (dados da própria clínica, não por convênio):

```sql
CREATE TABLE IF NOT EXISTS dados_prestador (
  id SERIAL PRIMARY KEY,
  cnes TEXT,
  razao_social TEXT,
  cnpj TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Todos os campos nullable — pode existir a linha sem nada preenchido ainda.
Sem seed: a tela de edição faz `INSERT` na primeira vez e `UPDATE` depois
(mesmo padrão de "upsert de configuração única" — se não houver precedente
no projeto, criar com `SELECT ... LIMIT 1` seguido de insert condicional no
controller).

### `031_convenios_dados_tiss.sql`

```sql
ALTER TABLE convenios
  ADD COLUMN IF NOT EXISTS codigo_prestador_na_operadora TEXT,
  ADD COLUMN IF NOT EXISTS numero_contrato TEXT;
```

Nullable — convênio pode existir no cadastro de repasse sem esses dados.

### `032_convenio_procedimentos_tuss.sql`

```sql
CREATE TABLE IF NOT EXISTS convenio_procedimentos_tuss (
  id SERIAL PRIMARY KEY,
  convenio_id INTEGER NOT NULL REFERENCES convenios(id),
  tipo_atendimento TEXT NOT NULL CHECK (tipo_atendimento IN ('fisioterapia', 'psicologia')),
  categoria TEXT NOT NULL CHECK (categoria IN ('avaliacao', 'sessao')),
  codigo_tuss TEXT NOT NULL,
  descricao_tuss TEXT,
  UNIQUE (convenio_id, tipo_atendimento, categoria)
);
```

## Telas

### `/configuracoes/prestador` (nova, só administradora)

Formulário simples: CNES, razão social, CNPJ. Mesmo padrão de acesso restrito
já usado em `/usuarios` (`exigirPapel("administradora")`).

### `/convenios/:id/editar` (existente, ganha seção nova)

Abaixo dos campos de repasse já existentes: `codigo_prestador_na_operadora`,
`numero_contrato`, e uma tabela de até 4 linhas (fisioterapia/avaliação,
fisioterapia/sessão, psicologia/avaliação, psicologia/sessão) com campo de
código TUSS + descrição por linha. Linhas sem código TUSS ficam vazias, sem
obrigar preenchimento das 4.

### `/financeiro/tiss` (nova)

1. Formulário: select de convênio (mesma lista de `/convenios`) + data início
   + data fim.
2. Ao submeter, tela de confirmação mostra:
   - Se `dados_prestador` ou os dados TISS do convênio (código do prestador
     na operadora, número de contrato) estiverem incompletos: aviso
     bloqueando a geração, com link direto pra tela de cadastro faltante.
   - Lista de guias **prontas** (N) e **incompletas** (M) com motivo de
     cada incompleta (TUSS não cadastrado pra aquela combinação /
     paciente sem matrícula de convênio).
   - Botão "Gerar XML do lote" — habilitado só quando os dados de
     clínica/convênio (nível lote) estão completos; guias incompletas
     (nível guia) são excluídas do XML e não bloqueiam o botão.
3. Confirmação dispara `GET /financeiro/tiss/lote?convenioId=&inicio=&fim=`,
   resposta `Content-Type: application/xml` +
   `Content-Disposition: attachment; filename="tiss-lote-<convenio>-<inicio>-<fim>.xml"`.

## Fluxo de dados (geração do lote)

1. Model busca pagamentos com `forma_pagamento = 'convenio'` do convênio
   escolhido, com `data` dentro do período — reaproveita a mesma junção
   pagamento → paciente → agendamento/agendamento_importado já usada em
   `buscarDadosGuiaConvenio` (Guia de convênio), somando `primeira_consulta`
   do agendamento de origem pra resolver a categoria.
2. Exclui pagamentos já estornados (`estornado_por IS NOT NULL`), mesma
   lógica do Guia de convênio.
3. Pra cada pagamento restante, resolve `categoria` (`avaliacao` se
   `primeira_consulta`, senão `sessao`) e busca
   `convenio_procedimentos_tuss` por `(convenio_id, tipo_atendimento,
   categoria)`. Sem match → guia incompleta (motivo: "TUSS não cadastrado
   pra <tipo_atendimento>/<categoria>"). Paciente sem `matricula_convenio`
   → guia incompleta (motivo: "paciente sem matrícula de convênio"),
   verificado antes do match de TUSS.
4. `tissXmlService.js` (novo, função pura — mesmo padrão dos serviços de
   PDF: recebe dados já resolvidos, devolve string) monta:
   - `mensagemTISS` → `cabecalho` (identificação do prestador de origem via
     `dados_prestador`, identificação da operadora de destino via
     `convenio.nome`/`codigo_prestador_na_operadora`, versão do padrão como
     constante `"3.05.00"`, sequencial da transação).
   - `loteGuias` → `numeroLote` (usa timestamp de geração, sem numeração
     persistida) → uma `guiaSP-SADT` por guia pronta, com dados do
     paciente (nome, `matricula_convenio`), procedimento (`codigo_tuss`,
     `descricao_tuss`, valor do pagamento), data do atendimento.
5. Controller monta o XML e responde como attachment.

## Erros e casos de borda

- Convênio sem `dados_prestador` preenchido, ou sem
  `codigo_prestador_na_operadora`/`numero_contrato`: bloqueia geração do
  lote inteiro, com mensagem indicando o que falta e link pro cadastro.
- Período sem nenhum pagamento `convenio` daquele convênio: mensagem
  "nenhuma guia no período selecionado" — sem gerar XML vazio.
- Todas as guias do período incompletas (nenhuma pronta): mesmo tratamento
  do caso anterior — não gera XML de lote vazio, mesmo com dados de
  clínica/convênio completos.
- `convenioId` inexistente ou datas inválidas: 400, mesma validação já
  usada em outras telas com filtro de período.

## Riscos e limitações conhecidas (documentado por decisão explícita do usuário)

- **Não confirmado com a clínica que o TISS eletrônico é realmente
  necessário** — decisão consciente de implementar mesmo assim
  (2026-09-04). Se a resposta real for "não precisa", o Guia de convênio em
  PDF (já implementado) continua sendo a solução usada na prática.
- **Sem exemplo real de XML de nenhuma operadora** — o XML gerado segue a
  estrutura pública do padrão TISS 3.05.00 de memória/especificação, não
  foi validado contra um arquivo real aceito por alguma operadora da Fisio
  Life. Risco de campo obrigatório específico de alguma operadora não
  estar coberto.
- **Campos TISS tipicamente obrigatórios e ausentes do sistema hoje**: sexo
  e CNS do paciente, CBO/registro de conselho do profissional executante,
  caráter do atendimento (eletivo/urgência). Decisão do usuário
  (2026-09-04): omitir esses campos nesta primeira versão, mesmo sabendo
  que isso deixa o XML provavelmente **incompleto pra homologação real**
  de qualquer operadora. Expandir cadastro de paciente/profissional pra
  cobrir isso é trabalho de uma etapa futura, só depois de confirmar com a
  clínica quais desses campos as operadoras dela realmente exigem.
- Cadastro de CNES/registro/TUSS fica vazio até alguém preencher com dado
  real levantado na clínica — nenhum valor de exemplo é inserido por
  padrão.

**Como aplicar em sessões futuras**: antes de considerar esse módulo
"pronto pra uso real", os itens acima precisam ser resolvidos com a
clínica — exemplo real de XML aceito por operadora, confirmação dos campos
obrigatórios de fato exigidos, e os dados cadastrais reais (CNES, registro,
TUSS). Até lá, tratar como infraestrutura pronta mas não validada em
produção real de faturamento.

## Testes

Mesmo padrão do resto do projeto (`node --test`, `pool.query` mockado):

- Model: classificação pronta/incompleta por guia (TUSS ausente, paciente
  sem matrícula), exclusão de pagamento estornado, resolução de categoria
  avaliação/sessão a partir de `primeira_consulta`.
- `tissXmlService`: estrutura do XML gerado a partir de fixtures — checagem
  dos campos-chave presentes (sem lib de parsing XML nova; comparação de
  string ou regex simples nos elementos esperados).
- Controller/rota: bloqueio quando dados de clínica/convênio incompletos,
  mensagem de período vazio, filename correto no `Content-Disposition`.
- View: formulário de `/financeiro/tiss`, seção nova em
  `/convenios/:id/editar`, tela `/configuracoes/prestador`.
