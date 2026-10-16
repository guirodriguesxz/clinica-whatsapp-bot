# Pacotes de sessão (Fisioterapia)

Status: desenho aprovado pelo usuário em 2026-09-01, em conversa (sem uso do
companheiro visual). Não autoriza migration, commit de código, push ou
deploy — só esta especificação foi commitada.

Este documento resolve a pendência registrada no `TODO.md` sobre o Módulo 9
("Agendamento avançado"): a parte de Psicologia automatizada desse módulo já
foi descartada em 2026-09-01 (Psicologia permanece manual, o bot só
encaminha pra equipe). Restava decidir se "pacotes de sessão" — desconto
automático de sessão de um pacote pré-pago quando o paciente de Fisioterapia
é atendido — ainda faz sentido, e com que escopo.

## Contexto de negócio (confirmado com o usuário)

- A clínica vende pacotes de Fisioterapia: mínimo de 10 sessões, às vezes 20,
  dependendo do paciente/caso. A base de conhecimento do bot confirma o valor
  padrão ("Plano de tratamento: a partir de R$ 600,00 para 10 sessões").
- O pagamento do pacote é feito por fora do sistema (dinheiro/cartão na
  clínica) — este módulo não registra nem rastreia o valor pago, só a
  contagem de sessões.
- Hoje o controle é 100% manual/físico: uma anotação no sistema de agenda anterior e um
  papel impresso que a recepção risca a cada sessão. Não existe saldo digital
  de pacotes em andamento pra migrar — este módulo começa do zero, sem carga
  de dados legados.
- O desconto de sessão é por **comparecimento**, não por agendamento:
  cancelamento e remarcação não consomem sessão do pacote.
- Quando o pacote esgota, a decisão de continuar o tratamento é conversada
  pessoalmente entre a recepção e o paciente na clínica — nunca pelo
  WhatsApp. **O bot não precisa saber nada sobre pacotes.** Isso elimina o
  maior risco do desenho original do Módulo 9 ("mexe no fluxo de IA que já
  atende pacientes reais"): esta funcionalidade fica inteiramente no
  dashboard, sem tocar em `chatService`, webhook, function-calling ou
  Google Calendar.
- Cancelar um pacote (ex: venda por engano) é uma correção de contagem, não
  um estorno financeiro — o dinheiro em si é tratado fora do app, então não
  há integração com o módulo Financeiro/estorno append-only.

## Objetivo

Dar à recepção uma contagem confiável de quantas sessões de um pacote de
Fisioterapia já foram usadas e quantas restam, atualizada automaticamente
conforme a presença é marcada — substituindo o controle manual em papel sem
mudar como o bot agenda.

## Escopo e limites

Entra:

- Cadastro de pacotes de sessão por paciente (só Fisioterapia), com
  quantidade total definida na criação (mínimo 10, sem teto fixo).
- Vínculo automático entre uma sessão marcada como "compareceu" e o pacote
  ativo do paciente, sem escolha manual de qual pacote vincular.
- Contagem de sessões usadas e "esgotado" sempre calculada a partir do
  histórico real, nunca armazenada como contador mutável.
- Seção nova na ficha do paciente (`/pacientes/:id/ficha`) mostrando o
  pacote atual e o histórico de pacotes anteriores.
- Criação de pacote pela recepção; cancelamento de pacote restrito à
  administradora.
- Bloqueio de criação de um segundo pacote ativo para o mesmo paciente.

Não entra:

- Qualquer mudança no bot, webhook, function-calling, agendamento automático
  ou Google Calendar.
- Registro do valor pago pelo pacote ou qualquer integração com o Financeiro.
- Pacotes de Psicologia (a área não tem agendamento automático nem contagem
  de sessão prevista).
- Vínculo de pacote a sessões de `agendamentos_importados` (dados do
  sistema de agenda anterior, anteriores a esta funcionalidade) — pacotes só se aplicam
  a agendamentos criados pelo bot a partir de agora.
- Notificação automática ao paciente quando o pacote esgota (isso é
  conversa presencial da recepção, fora do sistema).
- Migração de saldo de pacotes legados (não existe dado digital pra migrar).

## Modelo de dados

Nova tabela `pacotes_sessoes`:

| Coluna | Tipo | Observação |
| --- | --- | --- |
| `id` | SERIAL PK | |
| `paciente_id` | INTEGER, FK `pacientes(id)` | |
| `quantidade_total` | INTEGER, `CHECK > 0` | Definida pela recepção na criação |
| `cancelado` | BOOLEAN, default false | Só a administradora pode setar |
| `criado_por` | INTEGER, FK `usuarios(id)` | Auditoria, mesmo padrão de `registrado_por` |
| `created_at` | TIMESTAMPTZ, default now() | |

Sem coluna de "sessões usadas" ou "status" armazenada — ambas são
calculadas.

`registros_atendimento` ganha uma coluna nova:

| Coluna | Tipo | Observação |
| --- | --- | --- |
| `pacote_id` | INTEGER, FK `pacotes_sessoes(id)`, nullable | Setada automaticamente, nunca escolhida pelo usuário |

Um pacote é considerado **ativo** quando `cancelado = false` E a contagem de
`registros_atendimento` vinculados a ele (via `pacote_id`) é menor que
`quantidade_total`. Um paciente tem no máximo um pacote ativo por vez — a
criação de um novo pacote é bloqueada enquanto existir um ativo.

## Fluxo de débito automático

Ao marcar (ou corrigir) a presença de um `registros_atendimento` cujo
`agendamento_id` aponta pra um agendamento com `tipo_atendimento =
'fisioterapia'`:

- Se a presença está sendo definida como `compareceu` e o paciente tem um
  pacote ativo no momento: grava esse `pacote_id` no registro.
- Se a presença está sendo alterada de `compareceu` para `faltou` (correção):
  limpa `pacote_id` (volta a `null`).
- Em qualquer outro caso (paciente sem pacote ativo, ou é Psicologia): nada
  muda, `pacote_id` fica `null` — comportamento idêntico ao de hoje.

Como a contagem é sempre derivada, corrigir uma presença que esgotava o
pacote automaticamente "reabre" o pacote, sem nenhuma lógica de reversão
manual.

## Interface

Nova seção na ficha do paciente:

- Se houver pacote ativo: "Pacote atual: X de Y sessões usadas" (ou
  "esgotado" quando X = Y).
- Lista dos pacotes anteriores do paciente (total, usadas, cancelado ou não,
  data de criação).
- Botão **Criar pacote** (recepção e administradora): pede só a quantidade
  total; bloqueado com mensagem clara se já existir um pacote ativo.
- Ação **Cancelar pacote** (só administradora): marca `cancelado = true`;
  não afeta nenhuma sessão já registrada, só libera o paciente pra um pacote
  novo.

## Casos de erro e comportamento seguro

- Criar pacote com quantidade inválida (não numérica, zero ou negativa) não
  grava e retorna mensagem clara.
- Criar pacote para paciente com pacote ativo existente é bloqueado (a
  administradora cancela o anterior primeiro, se for engano).
- Cancelar pacote por uma conta de recepção retorna 403, inclusive por
  chamada direta de rota.
- Corrigir presença nunca deixa contagem inconsistente, por ser sempre
  derivada (ver "Fluxo de débito automático").
- Nenhuma mudança neste módulo pode alterar o comportamento de agendamento,
  cancelamento ou remarcação do bot — os testes existentes desses fluxos
  devem continuar passando sem alteração.

## Testes e verificação local

Antes de qualquer entrega de código, os testes devem cobrir ao menos:

- criação de pacote com sucesso e com quantidade inválida;
- bloqueio de criação de um segundo pacote ativo para o mesmo paciente;
- marcar presença como "compareceu" vincula a sessão ao pacote ativo
  automaticamente;
- corrigir presença de "compareceu" para "faltou" desvincula a sessão;
- contagem de sessões usadas/restantes e "esgotado" corretos a partir do
  histórico real, inclusive após correção de presença;
- cancelamento de pacote funciona para administradora e retorna 403 para
  recepção;
- ficha do paciente mostra pacote ativo e histórico corretamente;
- todos os testes existentes do bot, agendamento e presença continuam
  passando sem alteração de comportamento.

A implementação só estará pronta localmente após `npm test`, lint e revisão
do diff. Aplicação de migration no Neon, commit, push e deploy continuam
sendo etapas separadas, cada uma com autorização explícita.
