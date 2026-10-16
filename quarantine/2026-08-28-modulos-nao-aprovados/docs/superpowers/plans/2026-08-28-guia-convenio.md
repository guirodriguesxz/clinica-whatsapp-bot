# Guia de convênio — Implementation Plan

Baseado em
[2026-08-28-guia-convenio-design.md](../specs/2026-08-28-guia-convenio-design.md).
**Escopo assumido pelo usuário pra confirmar depois** (ver "Pendências
explícitas" no spec) — versão simplificada em PDF, não o padrão TISS/ANS
eletrônico completo. Mesmo padrão de execução dos módulos anteriores: TDD
(`node --test`, `pool.query` mockado), migration nova não aplicada
automaticamente.

## Global Constraints

- Sem banco de dev separado do de produção — `014_guia_convenio.sql` fica
  pronta mas **não é aplicada** por este plano.
- PDF em memória, mesmo padrão de `laudoPdfService.js` (sub-projeto 5).
- `pagamentos.paciente_id` já existe e já é preenchido pras duas origens
  (bot e importado) — a guia usa esse campo direto pra achar o paciente, sem
  precisar resolver telefone de novo (isso já foi feito na hora de registrar
  o pagamento).
- `agendamentos` (bot) não tem coluna `convenio` própria — só
  `agendamentos_importados` tem (histórico por visita) e `pacientes` (geral
  do paciente). A guia usa `COALESCE(ai.convenio, p.convenio)`.

## Task 1 — Migration `014_guia_convenio.sql`

```sql
ALTER TABLE pagamentos DROP CONSTRAINT IF EXISTS pagamentos_forma_pagamento_check;
ALTER TABLE pagamentos ADD CONSTRAINT pagamentos_forma_pagamento_check
  CHECK (forma_pagamento IN ('pix', 'cartao', 'convenio'));

ALTER TABLE pacientes
  ADD COLUMN IF NOT EXISTS numero_carteirinha TEXT;

ALTER TABLE agendamentos_importados
  ADD COLUMN IF NOT EXISTS numero_carteirinha TEXT;
```

Nome real da constraint gerada automaticamente precisa ser confirmado com
`\d pagamentos` antes de aplicar (mesma ressalva da migration 011).

## Task 2 — `dashboardController.js`: aceitar `'convenio'` como forma de pagamento

- `FORMA_PAGAMENTO_VALIDA` ganha `'convenio'`.
- `ehCartao` continua controlando parcelas/valor_acrescimo (só cartão usa) —
  convênio se comporta como pix nesse aspecto (sem parcelas/acréscimo).
- Testes: pagamento com `forma_pagamento: 'convenio'` é aceito e grava
  `parcelas`/`valor_acrescimo` como `null` (mesmo caminho do pix hoje).

## Task 3 — `pacienteModel.js`/formulário: `numero_carteirinha` (opcional)

- Sem tela de edição de paciente existente no dashboard hoje (fora de
  escopo criar uma) — `numero_carteirinha` fica só disponível via banco por
  enquanto (a própria migration já deixa a coluna pronta pra um formulário
  futuro). **Não bloqueia a guia**: quando ausente, a linha "Carteirinha"
  simplesmente não aparece no PDF (mesmo padrão de `profissional_responsavel`
  ausente nos Laudos).

## Task 4 — `pagamentoModel.js`: `buscarDadosGuiaConvenio(pagamentoId)`

```sql
SELECT
  pg.id, pg.valor, pg.status, pg.data,
  p.nome AS paciente_nome,
  COALESCE(ai.convenio, p.convenio) AS convenio,
  COALESCE(ai.numero_carteirinha, p.numero_carteirinha) AS numero_carteirinha,
  COALESCE(a.tipo_atendimento, ai.tipo_atendimento) AS tipo_atendimento,
  COALESCE(ra_bot.profissional_responsavel, ra_imp.profissional_responsavel) AS profissional_responsavel
FROM pagamentos pg
JOIN pacientes p ON p.id = pg.paciente_id
LEFT JOIN agendamentos a ON a.id = pg.agendamento_id
LEFT JOIN agendamentos_importados ai ON ai.id = pg.agendamento_importado_id
LEFT JOIN registros_atendimento ra_bot ON ra_bot.agendamento_id = pg.agendamento_id
LEFT JOIN registros_atendimento ra_imp ON ra_imp.agendamento_importado_id = pg.agendamento_importado_id
WHERE pg.id = $1
```

- Motivo estruturado: `nao_encontrado` (pagamento não existe → 404 no
  controller). Sem motivo `sem_observacao` aqui (guia não depende de
  observação de sessão) — mas convém validar `forma_pagamento === 'convenio'`
  no controller antes de gerar (senão alguém poderia forjar a URL pra um
  pagamento pix/cartão) → motivo novo `nao_e_convenio` (400).
- Caminho feliz: `{ dados: { numeroGuia: pg.id, pacienteNome, convenio,
  numeroCarteirinha, tipoAtendimento, data, valor, profissionalResponsavel,
  status } }` — `status` vai junto pra decidir o carimbo "GUIA CANCELADA".
- Testes: `nao_encontrado`, caminho feliz com/sem carteirinha/profissional,
  fallback de convênio (`ai.convenio` teve prioridade sobre `p.convenio`
  quando os dois existem), pagamento de origem bot (sem `agendamentos.convenio`
  — usa só `p.convenio`).

## Task 5 — `laudoPdfService.js`: `gerarPdfGuiaConvenio(dados)`

Mesmo arquivo dos Laudos (mesma clínica, mesmo cabeçalho, mesma técnica de
função pura + pdfkit) — evita um segundo arquivo de serviço quase idêntico.
Renomear o conceito de "cabeçalho" pra reaproveitar `linhasCabecalhoLaudo`
seria forçado (campos diferentes: convênio/carteirinha em vez de
observação) — usar uma função pura irmã, `linhasCorpoGuiaConvenio(dados)`,
e uma segunda função exportada `gerarPdfGuiaConvenio(dados)`.

- `linhasCorpoGuiaConvenio`: monta `Convênio`, `Nº da carteirinha` (se
  existir), `Tipo de atendimento`, `Profissional responsável` (se existir),
  `Valor: R$ <formatarMoeda(valor)>` — reaproveita `formatarMoeda` de
  `src/utils/dinheiro.js` (já existe, já testado).
- `gerarPdfGuiaConvenio`: cabeçalho igual ao dos Laudos + número da guia
  (`Guia nº <id>`) + `linhasCorpoGuiaConvenio`. Quando `status === 'estornado'`,
  desenha "GUIA CANCELADA" em destaque (fonte maior/negrito) antes do corpo.
- Testes: `linhasCorpoGuiaConvenio` cobre presença/ausência de carteirinha e
  profissional; smoke test de `gerarPdfGuiaConvenio` (com e sem status
  estornado) confirmando `%PDF` + tamanho > 0.

## Task 6 — Controller (`gerarGuiaConvenio`)

```js
export async function gerarGuiaConvenio(req, res) {
  const id = idValido(req.params.id);
  if (!id) return res.status(404).send("Pagamento não encontrado.");

  const resultado = await buscarDadosGuiaConvenio(id);
  if (resultado.motivo === "nao_encontrado") {
    return res.status(404).send("Pagamento não encontrado.");
  }
  if (resultado.dados.formaPagamento !== "convenio") {
    return res.status(400).send("Este pagamento não é de convênio.");
  }
  const pdfBuffer = await gerarPdfGuiaConvenio(resultado.dados);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="guia-${slugArquivo(resultado.dados.pacienteNome)}-${resultado.dados.data}.pdf"`
  );
  res.send(pdfBuffer);
}
```

- Reaproveita `idValido` e `slugArquivo` já existentes no arquivo (mesmos
  usados por Financeiro/Laudos).
- `buscarDadosGuiaConvenio` também devolve `formaPagamento` (adicionar ao
  SELECT da Task 4) pra essa checagem — mais simples que criar um motivo
  `nao_e_convenio` no model, mantém a regra de negócio ("só gera guia pra
  pagamento de convênio") no controller junto com as outras validações de
  entrada.
- Testes: 404 pra id inválido/pagamento inexistente, 400 pra pagamento
  pix/cartão, caminho feliz com headers corretos.

## Task 7 — Rota

```js
router.get(
  "/financeiro/pagamento/:id/guia",
  asyncHandler(exigirLogin),
  asyncHandler(gerarGuiaConvenio)
);
```

GET puro, sem CSRF — mesmo padrão dos Laudos.

## Task 8 — Views

- `financeiro/lista.ejs`: formulário de novo pagamento ganha
  `<option value="convenio">Convênio</option>`; cada pagamento listado ganha
  um link "Gerar guia" condicional (`p.forma_pagamento === 'convenio'`),
  igual ao "Gerar laudo" de `/presenca`.

## Verificação manual (fora das tasks — requer aprovação explícita antes de aplicar a migration)

Mesmo método dos módulos anteriores: `src/app.js` direto, gerar uma guia de
verdade a partir de um pagamento de teste com `forma_pagamento = 'convenio'`
e abrir o PDF (inclusive um pagamento com `status = 'estornado'`, pra
conferir o carimbo "GUIA CANCELADA").
