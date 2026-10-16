# Acesso e permissões do dashboard

Status: desenho revisado e aprovado pelo usuário em 2026-08-31, com plano de
implementação local já escrito. Não autoriza aplicação de migration no Neon,
criação de contas reais, commit, push ou deploy.

Esta especificação separa acesso/permissões da futura evolução das agendas e
substitui, somente para contas e papéis, a decisão anterior de duas
recepcionistas registrada na especificação de 2026-08-29. A fase atual prevê
três contas de recepção: `bruno`, `victor` e `aline`. As decisões de agenda e
profissionais permanecem adiadas até a coleta dos dados reais da clínica.

## Objetivo

Substituir o login do dashboard baseado em e-mail por nome de usuário e senha
própria do aplicativo, com papéis fixos para a administradora e a recepção.

O sistema de agenda anterior permanece separado: suas contas e senhas não serão lidas,
copiadas ou reutilizadas.

## Contas e papéis iniciais

| Nome de usuário | Papel |
| --- | --- |
| `admin` | `administradora` |
| `bruno` | `recepcao` |
| `victor` | `recepcao` |
| `aline` | `recepcao` |

As senhas serão definidas no momento controlado de disponibilização e só serão
armazenadas como hash. Não registrar senhas em código, migration, arquivos de
configuração, logs ou documentação.

## Regras de acesso

| Ação | Administradora | Recepção |
| --- | --- | --- |
| Ver agenda, pacientes e presença | Sim | Sim |
| Ver financeiro e registrar pagamento | Sim | Sim |
| Estornar pagamento | Sim | Não |
| Ver usuários | Sim | Não |
| Criar, redefinir senha ou desativar usuários | Sim | Não |
| Trocar a própria senha | Sim | Sim |

O servidor deve validar o papel em cada rota protegida. Esconder botões não é
proteção suficiente: uma recepcionista que abrir uma URL administrativa deve
receber acesso negado. Uma conta inativa deve perder acesso na próxima
requisição autenticada.

## Fluxos de interface

- Login com os campos **Nome de usuário** e **Senha**.
- Cabeçalho com a pessoa logada e botão **Sair**.
- Página **Usuários**, visível somente para a administradora, para criar
  recepcionistas, redefinir suas senhas e desativá-las.
- Não excluir contas: registros de presença e financeiro continuam apontando
  para quem os criou.
- Bloquear a administradora de desativar a própria conta, evitando perder o
  único acesso administrativo.

## Dados e transição

Uma migration incremental local acrescentará à tabela `usuarios` apenas:

- `nome_usuario`, único e normalizado;
- `papel`, limitado a `administradora` ou `recepcao`.

O e-mail passa a ser opcional: registros existentes o preservam, mas contas
novas do dashboard não precisam tê-lo e não o utilizam para login.

Nenhum dado de agenda, paciente, presença ou financeiro será reescrito. Antes
de uma futura aplicação no Neon, fazer auditoria somente leitura das contas
atuais e confirmar explicitamente a associação com a conta `admin`. A aplicação
da migration, a configuração de senhas e o deploy são etapas separadas e
exigem autorização explícita do usuário.

## Limites

Não faz parte desta etapa:

- alterar o bot, WhatsApp, webhook, IA, Google Calendar ou agendamento
  automático de Fisioterapia;
- importar dados do sistema de agenda anterior;
- criar agendas de Psicologia, salas ou cadastro de profissionais;
- aplicar SQL no Neon, fazer commit, push ou deploy.

## Verificação local prevista

- login aceita nome de usuário e não aceita e-mail como atalho;
- senha nunca aparece em consultas usadas por views/sessão;
- recepção recebe 403 ao tentar estornar ou gerenciar usuários, inclusive por
  chamada direta de rota;
- administradora cria, desativa e redefine senha de recepção sem apagar
  histórico;
- pessoa inativa não mantém sessão ativa;
- cada pessoa só troca a própria senha;
- testes existentes do bot continuam passando sem mudanças no fluxo.
