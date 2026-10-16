# Operação diária e produtividade do dashboard

## Objetivo

Transformar a página inicial do dashboard em um painel de trabalho da recepção para o dia atual, sem substituir a agenda completa. Tornar as telas de usuários e financeiro mais fáceis de operar e oferecer tema escuro opcional.

## Escopo

### Painel Hoje

- A rota `/` de usuário autenticado abre `/hoje`; usuários não autenticados continuam indo para `/login`.
- A navegação inclui **Hoje** como primeiro item e mantém **Agendamentos** como a tela completa para outros dias.
- A página mostra agendamentos não cancelados do dia atual, de origem bot e importada, em ordem de horário.
- Cada atendimento expõe as ações já autorizadas no dashboard: registrar chegou/faltou, abrir ficha do paciente, abrir o lançamento financeiro e enviar confirmação de WhatsApp quando a origem suportar a ação.
- Ações usam os controladores existentes e retornam para `/hoje` com uma mensagem de resultado.
- Um resumo mostra total do dia, confirmados, comparecimentos e faltas.

### Financeiro

- A listagem ganha busca por paciente e filtros combináveis de período (data inicial/final), status do pagamento, forma de pagamento e origem (bot/importado).
- A busca e os filtros são aplicados nas duas fontes antes da paginação; links de paginação preservam todos os filtros.
- Registros de teste removidos do banco não voltam a aparecer na tela.

### Usuários

- A tela mantém as permissões atuais: somente administradora a acessa e somente contas de recepção podem ser desativadas ou ter senha redefinida.
- Cada conta aparece em um cartão/linha responsiva com nome, usuário, papel, status e ações agrupadas, com melhor leitura em celular.

### Tema escuro

- O cabeçalho recebe um botão para alternar tema claro/escuro.
- A escolha é salva no `localStorage` do navegador, aplicada antes da primeira pintura e não exige alteração de banco nem de conta.
- As cores mantêm contraste adequado para tabelas, badges, campos e ações destrutivas.

## Dados e segurança

- Nenhuma ação do Painel Hoje cria caminhos novos para alterar presença, pagamento ou WhatsApp; ele reutiliza os endpoints protegidos por login e CSRF existentes.
- O painel não expõe telefone, CPF ou outros dados além dos já disponíveis na agenda autenticada.
- Os agendamentos de teste `Guilherme`, `Teste Serie Multipla` e `Paciente Teste QA Convenio` foram removidos da base de produção antes desta implementação; pacientes e agendamentos reais com nome Guilherme foram preservados.

## Validação

- Testes de controller/model validam o recorte do dia e os filtros financeiros, incluindo a preservação de filtros na paginação.
- Testes de view validam as ações do painel, controles de filtro e alternador de tema.
- `npm test`, `npm run lint` e `git diff --check` precisam passar.
