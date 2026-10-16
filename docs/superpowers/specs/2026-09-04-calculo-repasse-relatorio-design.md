# Calcular repasse por convênio no relatório financeiro (Fase 3, final do roadmap de repasse)

Status: aprovado em 2026-09-04.

Motivado por: conclusão do roadmap de repasse por convênio — Fase 1
(`docs/superpowers/specs/2026-09-04-cadastro-convenios-design.md`) criou o
cadastro de convênios com valores de repasse; Fase 2
(`docs/superpowers/specs/2026-09-04-paciente-convenio-lista-design.md`)
ligou `pacientes.convenio_id` à lista. Esta fase usa essas duas peças pra
calcular automaticamente o repasse na tabela "Por plano de saúde" do
relatório financeiro (`/financeiro/relatorio`), substituindo a conta feita
à mão no caderno.

## Descoberta técnica que simplificou o desenho

`pagamentos.paciente_id` é **sempre preenchido**, inclusive para
pagamentos de agendamentos importados — resolvido pelo telefone no momento
do registro do pagamento (ver `registrarPagamentoImportado` em
`pagamentoModel.js`), mesmo `agendamentos_importados` nunca tendo tido
`paciente_id` próprio. Isso significa que o `convenio_id` estruturado do
paciente (Fase 2) já está disponível pra **qualquer** pagamento, bot ou
importado — não é preciso casar convênio por texto pra nada.

A única lacuna real: `primeira_consulta` (o que distingue avaliação de
sessão) só existe em `agendamentos` (bot) — `agendamentos_importados` não
tem essa coluna. Por decisão do usuário, todo pagamento de origem
importada entra como sessão no cálculo (avaliação é caso raro/pontual).

## Objetivo

Mostrar, na tabela "Por plano de saúde" já existente no relatório
financeiro, quanto repassar por convênio no mês filtrado — sem exigir
nenhuma tela nova.

## Escopo

**Entra:**

- `pagamentoModel.js` (`buscarRelatorioMensal`): a consulta de `porPlano`
  passa a:
  - Agrupar pelo convênio estruturado (`convenio_id` do paciente) quando
    disponível; pacientes ainda não migrados (Fase 2) continuam agrupados
    pelo texto livre atual (`COALESCE(ai.convenio, p.convenio, 'Não
    informado')`) — comportamento inalterado pra esses.
  - Contar `quantidade_avaliacao` e `quantidade_sessao` (líquido de
    estorno — um estorno cancela a contagem da mesma categoria em que o
    pagamento original caiu, mesma lógica já usada pro `total` em reais).
    Pagamento de origem importada sempre conta como sessão
    (`primeira_consulta IS NOT TRUE`, que cobre `false` e `null`).
  - Trazer `valor_repasse_avaliacao`/`valor_repasse_sessao` do convênio
    (quando identificado) pra cada grupo.
- Cálculo do valor de repasse (`quantidade_avaliacao × valor_repasse_avaliacao
  + quantidade_sessao × valor_repasse_sessao`) feito em JS no model, não em
  SQL — mais simples de deixar `null` explicitamente nos dois casos abaixo
  em vez de arriscar `0` silencioso:
  - Convênio não identificado (paciente sem `convenio_id`, ainda com texto
    livre) → `valorRepasse: null`, sinalizado como "não identificado".
  - Convênio identificado mas sem os dois valores de repasse cadastrados
    (Fase 1 permite cadastrar convênio sem valores) → `valorRepasse: null`,
    sinalizado como "não configurado".
- `financeiro/relatorio.ejs`: tabela "Por plano de saúde" ganha três
  colunas novas — **Avaliações**, **Sessões**, **Repasse** (mostrando o
  valor formatado, ou "—" com o motivo quando `valorRepasse` for `null`).
- Nenhuma rota nova, nenhum controller novo — `telaRelatorioFinanceiro`
  não muda de assinatura, só os dados que já passa pra view ganham mais
  campos.

**Não entra:**

- Nenhuma correção em massa dos convênios de pacientes antigos — cada um
  segue sendo corrigido manualmente (Fase 2, já no ar).
- Nenhuma tela ou exportação nova — só a tabela existente.
- Nenhuma mudança em como pagamentos/estornos são registrados.
- Repasse por profissional/atendente — fora de escopo aqui (a tabela
  "Psicologia por profissional" já existente não muda).

## Fluxo

1. Recepção abre `/financeiro/relatorio`, filtra o mês (e opcionalmente
   plano/especialidade, como já faz hoje).
2. A tabela "Por plano de saúde" mostra, por convênio: total faturado,
   quantidade, e agora também Avaliações, Sessões e Repasse calculado.
3. Convênios de pacientes ainda não migrados pra Fase 2 aparecem por texto
   livre, com Repasse "—" — a recepção sabe que precisa corrigir aquele
   paciente pra entrar na conta automática.

## Estrutura de arquivos

```
src/
├── models/
│   └── pagamentoModel.js         # buscarRelatorioMensal: query porPlano +
│                                   #   cálculo de repasse em JS
└── views/
    └── financeiro/
        └── relatorio.ejs         # 3 colunas novas na tabela "Por plano de saúde"
test/
└── pagamentoModelRelatorio.test.js (ou arquivo equivalente já existente)
    financeiroRelatorioView.test.js (ou equivalente já existente)
```

## Testes

Mesmo padrão do projeto (`node --test`, `pool.query` mockado, views
renderizadas com `ejs.renderFile`):

- Model: paciente com `convenio_id` e valores de repasse cadastrados →
  `valorRepasse` calculado certo, separando avaliação/sessão; paciente sem
  `convenio_id` → `valorRepasse: null`, motivo "não identificado";
  convênio identificado sem valores cadastrados → `valorRepasse: null`,
  motivo "não configurado"; estorno de uma avaliação reduz
  `quantidade_avaliacao`, não `quantidade_sessao`; pagamento de origem
  importada sempre soma em `quantidade_sessao`, nunca em
  `quantidade_avaliacao`.
- View: colunas novas aparecem com os valores certos; linha com
  `valorRepasse: null` mostra "—" e o motivo, sem quebrar a tabela.

Verificação manual antes de considerar pronto: registrar um pagamento de
teste pra um paciente de teste com convênio de teste (valores de repasse
preenchidos), conferir que a linha aparece calculada certo no relatório do
mês — contra produção (sem banco de dev separado), removendo os dados de
teste depois.
