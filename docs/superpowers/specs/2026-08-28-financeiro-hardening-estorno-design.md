# Financeiro — hardening e estorno append-only

Status: aprovado conceitualmente pelo usuário em 2026-08-28; aguardando
revisão deste documento antes do plano de implementação.

Complementa e, onde houver conflito, substitui as decisões sobre estorno de
`2026-08-27-financeiro-design.md`. Não autoriza migration, commit, push ou
deploy. O bot e o dashboard dividem o mesmo processo na Railway, e o Neon de
produção é o único banco persistente do projeto.

## Objetivo

Concluir a revisão autorizada do Financeiro sem incorporar os módulos extras
criados fora de escopo, corrigindo quatro pontos:

1. matching de telefone importado, inclusive telefone local com DDD 55;
2. validação estrita de IDs, limite e offset;
3. estorno append-only, sem alterar o pagamento original;
4. isolamento do Financeiro em relação à Guia de Convênio ainda não aprovada.

## Limites de escopo

Entra:

- preservar as correções já autorizadas de arredondamento monetário,
  normalização de telefone e fonte única dos clamps de paginação;
- acrescentar os casos de borda descobertos na revisão;
- substituir o `UPDATE status = 'estornado'` por lançamento compensatório;
- atualizar listagem e relatório para interpretar os estornos;
- preparar uma migration incremental nova, sem executá-la.

Não entra:

- Guia/TISS, forma de pagamento `convenio`, carteirinha ou PDF de guia;
- Relatório de atendimento, Estoque ou Estatísticas;
- qualquer mudança em `chatService`, webhook, function-calling, agendamento
  via WhatsApp ou Google Calendar;
- aplicação de migration no Neon, commit, push ou deploy.

## Estado que deve ser preservado

As três correções autorizadas continuam válidas:

- `registrarPagamentoImportado` resolve o paciente por telefone normalizado;
- valores monetários são arredondados por representação decimal textual, sem
  depender de `double` binário;
- controller e model reutilizam a mesma normalização de limite/offset.

A inclusão de `convenio` em `FORMA_PAGAMENTO_VALIDA`, a geração de guia e as
dependências correspondentes não fazem parte deste subprojeto e devem ser
retiradas do caminho ativo sem apagar o trabalho recuperável.

## Telefone importado

### Regra canônica brasileira

Para matching de agendamentos importados:

- 10 ou 11 dígitos representam número nacional com DDD e recebem o DDI `55`;
- 12 ou 13 dígitos iniciados por `55` já estão em formato canônico;
- outros comprimentos não são adivinhados e resultam em paciente não
  vinculado para revisão manual.

Essa ordem é obrigatória: um celular nacional com DDD 55 possui 11 dígitos e
começa por `55`, mas ainda precisa receber o DDI, resultando em `5555...`.
Não se deve decidir que já existe DDI olhando apenas o prefixo.

O matching não cria nem altera paciente automaticamente. Ele apenas encontra
um paciente existente; ausência ou ambiguidade retorna motivo estruturado e
não grava pagamento.

## Validação estrita de números

### IDs

Um ID de rota é válido somente quando a string inteira corresponde a dígitos
decimais, o número é `Number.isSafeInteger` e é maior ou igual a 1.

Exemplos rejeitados: `1abc`, `1.9`, `1e2`, `Infinity`, vazio e números acima
de `Number.MAX_SAFE_INTEGER`.

### Paginação

- `limite`: inteiro finito entre 1 e 200; ausente/inválido usa 50;
- `offset`: inteiro finito entre 0 e 1.000.000; ausente/inválido usa 0;
- valores fracionários, infinitos, notação parcial e números negativos nunca
  chegam a `LIMIT`/`OFFSET` do PostgreSQL.

Controller e model continuam usando as mesmas funções exportadas.

## Estorno append-only

### Princípio

Um pagamento registrado nunca é atualizado nem excluído. Estornar cria um
segundo lançamento compensatório ligado ao original. Isso preserva valor,
status, data, observação, usuário e instante do lançamento inicial.

### Modelo de dados

A migration incremental `013_financeiro_estorno_append_only.sql`, colocada
antes das migrations dos módulos em quarentena, adicionará a `pagamentos`:

```sql
tipo_lancamento TEXT NOT NULL DEFAULT 'pagamento'
  CHECK (tipo_lancamento IN ('pagamento', 'estorno')),

pagamento_origem_id INTEGER REFERENCES pagamentos(id)
```

Também adicionará:

```sql
CREATE UNIQUE INDEX ...
  ON pagamentos (pagamento_origem_id)
  WHERE pagamento_origem_id IS NOT NULL;

CHECK (
  (tipo_lancamento = 'pagamento' AND pagamento_origem_id IS NULL)
  OR
  (tipo_lancamento = 'estorno' AND pagamento_origem_id IS NOT NULL)
)
```

O valor permanece positivo. Um estorno copia do original os vínculos,
`paciente_id`, valor, forma de pagamento e status financeiro; sua natureza
compensatória é representada por `tipo_lancamento`, não por valor negativo ou
mutação do status original.

A migration deve remover `estornado` do CHECK de `status` somente depois de
uma auditoria somente leitura confirmar que não há registros já alterados para
esse status. Se houver, a migration deve parar sem modificar dados: o status
anterior foi perdido e a conversão exige decisão humana por lançamento.

### Operação de estorno

A operação usa uma transação:

1. valida o ID estritamente;
2. busca o pagamento original com `FOR UPDATE`;
3. rejeita registro inexistente;
4. rejeita `tipo_lancamento = 'estorno'`;
5. verifica se já existe estorno ligado ao original;
6. insere o lançamento compensatório;
7. confirma a transação.

O índice único fecha a corrida entre dois pedidos simultâneos. A resposta
estruturada distingue `nao_encontrado`, `ja_estornado` e `nao_estornavel`.

### Listagem

A listagem mostra:

- pagamento original com indicador derivado “estornado” quando existir um
  lançamento compensatório associado;
- dados do estorno (data, usuário e observação) como histórico;
- botão “Estornar” apenas em pagamentos originais ainda não estornados.

O indicador não vem de alteração no registro original.

### Relatórios

Totais monetários usam sinal derivado:

```text
pagamento = +valor
estorno   = -valor
```

- total faturado: soma assinada de todos os lançamentos do período;
- total recebido: soma assinada apenas dos pares cujo status original é
  `pago`;
- breakdowns por tipo, forma e status seguem a mesma soma assinada;
- quantidade de pagamentos conta os lançamentos originais registrados no
  período, mesmo que sejam estornados posteriormente;
- quantidade de estornos é apresentada separadamente, sem contagem negativa.

A data contábil do estorno é a data em que ele foi realizado. Assim, um
pagamento de agosto estornado em setembro permanece no relatório histórico de
agosto e aparece como compensação em setembro.

## Isolamento dos módulos extras

Antes de considerar o Financeiro pronto:

- `forma_pagamento` volta a aceitar somente `pix` e `cartao`;
- opção `convenio`, rota/PDF de guia e queries que dependem das migrations
  013–015 não ficam no caminho ativo;
- migrations de Relatório de atendimento, Guia e Estoque permanecem não
  aplicadas e serão renumeradas somente quando seus módulos forem aprovados;
- nenhum arquivo é apagado sem autorização; o trabalho extra deve continuar
  recuperável fora do conjunto ativo do Financeiro.

## Testes automatizados

Adicionar regressões para:

- telefone nacional com DDD 55 encontra paciente canônico `5555...`;
- telefone com comprimento impossível não é adivinhado;
- IDs `1abc`, `1.9`, `1e2`, infinitos e acima do safe integer são rejeitados;
- limite/offset fracionário, infinito, negativo e acima do teto são
  normalizados sem chegar inválidos ao SQL;
- estorno insere nova linha e nunca executa `UPDATE`/`DELETE` no original;
- segundo estorno é rejeitado;
- tentativa de estornar um estorno é rejeitada;
- corrida resulta em um único estorno;
- listagem deriva corretamente o estado estornado;
- relatórios subtraem no mês do estorno e preservam o mês do pagamento;
- Financeiro não oferece nem aceita `convenio` enquanto TISS estiver em
  quarentena.

Os testes existentes do bot devem continuar passando sem alteração de fluxo.

## Verificação e implantação

Conclusão técnica desta etapa significa somente código e testes locais
prontos. Antes de qualquer implantação serão necessários, em outra etapa e
com autorização explícita:

1. verificar em modo somente leitura o schema e a existência de registros com
   `status = 'estornado'` no Neon;
2. revisar a migration incremental exata contra o schema encontrado;
3. definir janela e rollback;
4. aplicar a migration antes do código compatível;
5. fazer smoke test do dashboard;
6. confirmar que o bot voltou saudável após o reinício compartilhado.

Nenhum desses passos faz parte da implementação local autorizada por este
documento.
