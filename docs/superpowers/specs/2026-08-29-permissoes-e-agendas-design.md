# Permissões do dashboard e agendas por área

> **Atualização de 2026-08-31:** a parte de acesso e permissões foi separada
> em uma fase própria e passou a prever três contas de recepção, conforme
> `2026-08-31-acesso-e-permissoes-design.md`. Este documento continua sendo a
> referência das decisões futuras de agenda, mas sua contagem anterior de duas
> recepcionistas não é mais a fonte vigente para provisionamento de contas.

Status: desenho aprovado em 2026-08-29 e posteriormente dividido em duas
fases. A fase de acesso/permissões foi substituída pela spec de 2026-08-31 e
já possui plano local. A fase de agendas continua aguardando os dados reais da
clínica antes de revisão e planejamento. Não autoriza migration, commit, push
ou deploy.

O bot de WhatsApp está em produção na Railway e atende pacientes reais. O
dashboard divide o mesmo processo. O Neon de produção é o único banco
persistente. Este subprojeto não altera `chatService`, webhook,
function-calling, agendamento pelo WhatsApp ou integração com Google
Calendar.

## Objetivo

Dar à clínica dois controles que hoje faltam no dashboard:

1. contas individuais com papéis seguros para a administradora e a equipe de
   recepção, detalhadas na especificação separada de acesso e permissões;
2. agendas visivelmente separadas para Fisioterapia e Psicologia, sem mudar
   o funcionamento do bot.

O resultado deve ser simples de usar no computador da clínica e seguro o
suficiente para preservar histórico financeiro, presença e agendamentos.

## Escopo e limites

Entra:

- papel `administradora` para a tia do usuário e `recepcao` para as duas
  recepcionistas;
- login individual por nome de usuário e senha, logout e troca da própria
  senha;
- administração de contas somente pela administradora: criar, redefinir
  senha e desativar;
- acesso da recepção às agendas, pacientes, presença e consulta/registro do
  Financeiro, inclusive levantamento mensal;
- impedimento de estorno, alteração de histórico e gestão de usuários pela
  recepção;
- abas Todas, Fisioterapia e Psicologia na agenda;
- criação e edição manual de agendamentos de Psicologia pelo dashboard;
- rastreabilidade de quem criou ou alterou um agendamento manual;
- testes de autorização, agenda e casos de erro.

Não entra:

- mudança no comportamento de agendamento automático do bot;
- agendamento automático de Psicologia: o bot apenas encaminha esses
  contatos para a equipe;
- alteração da sincronização atual com Google Calendar;
- novas funções clínicas, prontuário, convênios/TISS, estoque ou relatórios
  extras;
- aplicação de SQL no Neon, commit, push ou deploy.

## Papéis e permissões

Os papéis serão fixos, sem uma tela de permissões por pessoa. Isso evita uma
configuração confusa para uma clínica pequena e deixa as regras fáceis de
auditar.

| Ação | Administradora | Recepção |
| --- | --- | --- |
| Ver agendas, pacientes e presença | Sim | Sim |
| Criar/editar agendamento manual de Psicologia | Sim | Sim |
| Ver Financeiro e fazer levantamento mensal | Sim | Sim |
| Registrar pagamento | Sim | Sim |
| Estornar pagamento | Sim | Não |
| Alterar/apagar histórico financeiro | Sim, apenas pelos fluxos já previstos | Não |
| Criar, redefinir senha ou desativar usuários | Sim | Não |

Esconder um botão não será a única proteção: as rotas e os controladores do
servidor validarão o papel antes de executar a ação. Uma recepcionista que
digitar uma URL restrita receberá acesso negado.

O usuário autenticado e seu papel ficarão disponíveis na sessão, obtidos a
partir da conta ativa. O cabeçalho mostrará quem está logado. Para trocar de
pessoa no mesmo computador, a pessoa usa **Sair** e entra com a outra conta.

## Gestão de contas

Cada pessoa usa um nome de usuário único e uma senha própria do app. A senha
do e-mail pessoal nunca será usada ou armazenada pelo dashboard. A tela de
usuários será exclusiva da administradora e permitirá:

- listar contas ativas e inativas, com nome, nome de usuário e papel;
- criar uma conta de recepção;
- redefinir a senha de outra pessoa;
- desativar uma conta, retirando seu acesso imediatamente.

Não haverá exclusão de contas. Registros já existentes continuarão apontando
para a pessoa que efetuou o pagamento, marcou presença ou criou o horário.
Também será bloqueada a desativação da própria administradora na sessão,
evitando perda acidental do único acesso administrativo.

Tanto administradora quanto recepção poderão trocar somente a própria senha.
O reset administrativo não enviará e-mail: a administradora define uma nova
senha temporária e a comunica à pessoa da equipe por um canal apropriado.

## Agendas por área

A tabela ativa de `agendamentos` já possui `tipo_atendimento` com os valores
`fisioterapia` e `psicologia`; as duas áreas continuarão usando o mesmo
histórico de pacientes e o mesmo calendário de dados. A separação é uma
visão do dashboard, não duas bases independentes.

A tela terá três abas:

- **Todas:** compromissos das duas áreas do período selecionado;
- **Fisioterapia:** somente `tipo_atendimento = fisioterapia`;
- **Psicologia:** somente `tipo_atendimento = psicologia`.

### Fisioterapia

O bot continua sendo a única origem de agendamento automático. Seus registros
já informam `tipo_atendimento = fisioterapia` e devem aparecer na aba correta
sem mudança no fluxo do bot. Não será acrescentada classificação manual da
recepção nesses agendamentos.

### Psicologia

O bot não agenda Psicologia. Depois de encaminhar o contato para a equipe, a
recepção registra o horário no dashboard, selecionando paciente, data, hora,
profissional e observação opcional. O registro recebe
`tipo_atendimento = psicologia` e origem manual. A clínica possui cerca de
nove psicólogos; por isso, atendimentos de Psicologia podem ocorrer no mesmo
horário quando os profissionais forem diferentes. Salas não serão cadastradas
nem controladas pelo dashboard.

O formulário permite editar ou cancelar somente os agendamentos manuais de
Psicologia. Nunca deve editar um agendamento automático de Fisioterapia pelo
dashboard, pois isso poderia divergir do bot e do Google Calendar. A criação
manual deve rejeitar paciente inexistente, data/hora inválida e conflito do
mesmo profissional no mesmo horário. Profissionais diferentes podem ter
atendimentos simultâneos.

A lista real de psicólogos será levantada na visita à clínica. Até ela estar
disponível, nenhuma lista será inventada e não será implementado cadastro de
profissionais. A decisão entre uma lista fixa administrada pela
administradora e uma integração futura com dados do sistema de agenda anterior será
tomada a partir desse material real.

## Dados e auditoria

Uma migration incremental futura, ainda local e não aplicada, acrescentará
apenas os campos necessários aos novos registros manuais, como origem e
usuário responsável. Registros atuais não serão reescritos: agendamentos
existentes continuarão legíveis, e campos novos poderão ficar nulos para
histórico anterior e para agendamentos criados pelo bot.

A escolha exata de como representar profissional e conflito de horário será
baseada no schema real e em uma auditoria somente leitura antes de qualquer
aplicação no Neon. Nenhuma migration deve assumir que os arquivos históricos
descrevem perfeitamente o banco de produção.

Antes de uma futura aplicação em produção, será necessário confirmar qual
conta existente deve receber o papel `administradora`. A migration não deve
promover silenciosamente todos os usuários existentes. O procedimento seguro
será: auditar contas existentes somente em leitura, aplicar a migration após
autorização e promover explicitamente a conta indicada pelo usuário.

## Falhas e comportamento seguro

- Dados incompletos ou inválidos retornam à tela com mensagem clara e sem
  gravar um agendamento parcial.
- Conflito de horário, paciente inexistente, registro cancelado e tentativa
  de alteração concorrente retornam erro específico e preservam os dados.
- Ações restritas retornam 403/uma página de acesso negado, mesmo que alguém
  tente chamar a rota diretamente.
- Desativar uma conta invalida o uso futuro dela; toda requisição autenticada
  continua validando se o usuário está ativo.
- Financeiro conserva as regras append-only de estorno já aprovadas: a
  recepção pode registrar e consultar, mas não estornar.

## Componentes previstos

- `usuarioModel` e migration incremental: papel, nome de usuário único,
  consulta segura da conta e operações administrativas.
- Middleware de autorização centralizado: recebe a permissão exigida e evita
  regras duplicadas nos controladores.
- Rotas/controladores/views de usuários: lista, criação, reset, desativação
  e troca da própria senha.
- `agendamentoModel` e controlador do dashboard: filtro por área e operações
  exclusivamente manuais para Psicologia.
- Views da agenda: abas, origem e formulário de Psicologia; navegação mostra
  opções conforme o papel, sem depender disso como proteção.
- Testes de modelos, middleware, rotas e telas.

## Testes e verificação local

Antes de qualquer entrega de código, os testes devem cobrir ao menos:

- uma recepcionista acessa agenda, pacientes e levantamento financeiro;
- uma recepcionista recebe acesso negado para estorno e administração de
  contas, inclusive por chamada direta de rota;
- administradora cria, desativa e redefine senha de recepcionista sem apagar
  o histórico;
- usuário inativo não consegue continuar usando o dashboard;
- usuário troca a própria senha, mas não a de outra pessoa;
- filtro Todas/Fisioterapia/Psicologia retorna somente os registros corretos;
- agenda de Psicologia cria, edita e cancela somente registros manuais;
- tentativas de editar no dashboard um agendamento automático do bot são
  bloqueadas;
- erro de validação ou conflito não grava dados parciais;
- todos os testes existentes do bot continuam passando sem mudança no fluxo.

A implementação só estará pronta localmente após `npm test`, lint e revisão
do diff. A ida a produção continua sendo uma etapa separada, com autorização
explícita para cada ação: auditoria somente leitura, aplicação de migration,
deploy Railway e smoke test do bot e dashboard.
