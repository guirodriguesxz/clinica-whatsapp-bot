# Redesign visual do dashboard Clínica Exemplo

## Objetivo

Redesenhar todas as telas existentes do dashboard interno da Clínica Exemplo para
oferecer uma interface mais clara, consistente e eficiente para a recepção,
preservando a alta densidade operacional observada no sistema de agenda anterior sem
reproduzir sua aparência antiga.

O redesign é exclusivamente visual e de apresentação. Ele não altera regras de
negócio, rotas, consultas, permissões, banco de dados, bot de WhatsApp,
function-calling ou integração com Google Calendar.

## Referências e princípios

Os registros fotográficos do sistema de agenda anterior são referência privada de fluxo,
densidade e organização espacial. Nenhum dado pessoal exibido nessas imagens
deve ser copiado para código, documentação, mockups, fixtures ou testes.

O sistema antigo contribui com quatro princípios úteis:

1. muitas informações relevantes permanecem visíveis ao mesmo tempo;
2. ações frequentes ficam perto do contexto em que são utilizadas;
3. agenda, paciente e histórico são tratados como áreas operacionais centrais;
4. impressão continua fazendo parte do trabalho da clínica.

O novo dashboard melhora esses princípios com hierarquia visual, espaçamento,
tipografia, estados claros, controles consistentes e adaptação responsiva.

## Direção aprovada

A direção visual aprovada é o **híbrido operacional**:

- navegação lateral compacta e fixa;
- barra superior contextual com título, usuário e ações principais;
- conteúdo central denso, organizado em tabelas e painéis;
- calendário lateral apenas onde acrescenta contexto, especialmente na Agenda;
- identidade visual da Clínica Exemplo já incorporada ao projeto;
- comportamento desktop-first, com uso funcional em celular e tablet.

Essa direção combina a familiaridade operacional do sistema de agenda anterior com uma
interface web contemporânea. O sistema não deve parecer uma cópia do software
antigo nem um painel genérico de startup.

## Estrutura global

### Navegação lateral

A navegação autenticada ocupa uma faixa lateral compacta. Ela contém somente os
módulos já existentes e respeita as permissões atuais:

- Agenda;
- Pacientes;
- Financeiro;
- Usuários, apenas para administradora;
- acesso à troca de senha e encerramento da sessão na área do usuário.

O item ativo deve ser imediatamente reconhecível por contraste, forma e rótulo.
Ícones podem reforçar a leitura, mas ações importantes nunca dependem apenas de
ícones.

### Barra superior contextual

Cada tela possui uma barra superior com:

- título e contexto atual;
- ações primárias da tela;
- identificação concisa do usuário autenticado;
- acesso às ações pessoais e saída.

Ações destrutivas não recebem o mesmo destaque de ações construtivas. Elas
continuam exigindo confirmação explícita.

### Área de conteúdo

O conteúdo usa fundo sálvia muito claro, painéis brancos, bordas discretas e
sombras mínimas. A densidade é obtida com alinhamento e ritmo compacto, não com
texto pequeno demais ou ausência de espaço entre controles.

### Responsividade

O dashboard é otimizado para os computadores da recepção. Em telas menores:

- a navegação pode ser recolhida;
- filtros e ações secundárias podem ser agrupados;
- painéis passam para uma coluna;
- tabelas preservam suas colunas essenciais e admitem rolagem horizontal apenas
  quando a perda de informação seria pior;
- consultas e ações simples continuam utilizáveis.

A versão móvel não precisa reproduzir toda a densidade da experiência desktop.

## Linguagem visual

### Cores

A paleta existente permanece como base:

- verde floresta (`#174d32`) para estrutura, navegação e títulos de maior peso;
- verde folha (`#5f8f3e`) para ações principais e seleção;
- sálvia clara (`#e7efe1`) para superfícies secundárias e realces suaves;
- branco para painéis e áreas de leitura;
- neutros quentes para fundo, bordas e texto auxiliar.

As cores de estado são semânticas e não decorativas:

- verde: concluído, presente ou confirmado;
- âmbar: pendente ou requer atenção;
- vermelho: cancelamento, erro ou ação destrutiva;
- cinza: estado neutro, inativo ou não informado.

Todo estado colorido também deve possuir texto legível. Cor nunca é o único
meio de comunicação.

### Tipografia

- Lora é reservada a títulos de página e títulos institucionais importantes;
- Manrope é usada em navegação, tabelas, formulários, botões e textos de apoio;
- dados operacionais priorizam legibilidade, alinhamento e números tabulares
  quando apropriado.

### Controles e feedback

Botões, campos, seletores, badges, alertas e painéis seguem um sistema visual
único. Estados de foco precisam ser visíveis. Mensagens de sucesso ou erro
aparecem próximas à ação que as originou, com linguagem direta.

## Telas

### Agenda unificada

A Agenda mantém a tabela compacta como representação principal. Não será
convertida em grade de calendário.

Estrutura:

- cabeçalho com data e ações disponíveis;
- barra compacta de filtros existentes;
- tabela densa, com agrupamento visual por horário;
- status apresentados por badge e texto;
- ações de cancelar, remarcar e marcar presença ligadas à linha selecionada;
- resumo diário sempre visível com quantidades por estado;
- calendário mensal lateral em telas largas, usado para trocar a data da visão;
- calendário recolhido ou reposicionado em telas menores.

As ações por linha podem ganhar maior visibilidade ao foco, seleção ou passagem
do cursor, mas precisam permanecer acessíveis por teclado e toque. A interface
não pode depender de `hover` para operar.

### Remarcação

A tela de remarcação preserva o fluxo e a validação atuais. A grade de horários
por manhã e tarde continua sendo o controle principal, com seleção clara,
resumo do agendamento original e confirmação do novo horário.

### Lista de pacientes

A busca ocupa posição de destaque. A tabela compacta exibe os dados já
disponíveis — nome, telefone, convênio e data de cadastro — e oferece acesso
claro à ficha. Nenhum novo campo de cadastro faz parte deste redesign.

### Ficha do paciente

A opção aprovada é a **visão geral contínua**, sem dividir o conteúdo atual em
abas.

Estrutura:

- cabeçalho-resumo com identificação e dados já disponíveis;
- ações de voltar, imprimir e abrir o controle de sessões;
- destaque do pacote atual e seu progresso;
- destaque do próximo atendimento quando esse dado já estiver disponível no
  payload atual; caso contrário, ele não será adicionado neste redesign;
- histórico de agendamentos em tabela compacta;
- criação ou cancelamento de pacote conforme regras e permissões existentes;
- histórico de pacotes anteriores sem duplicar o pacote atual.

O redesenho não adiciona edição cadastral nem novos dados clínicos.

### Controle de sessões

A visualização em tela ganha melhor hierarquia e legibilidade. A impressão
continua gerando as duas vias já existentes, com conteúdo e sequência atuais.
Regras específicas de impressão devem impedir que navegação, controles e
elementos decorativos contaminem o documento.

### Financeiro

A listagem continua organizada por atendimento e preserva filtros, paginação,
registro de pagamento e estorno existentes.

Para reduzir o excesso visual:

- pagamentos existentes aparecem resumidos junto ao atendimento;
- detalhes e observações podem ser expandidos;
- o formulário de novo pagamento é aberto como painel contextual da linha;
- o formulário de estorno fica associado ao pagamento elegível;
- ações e campos respeitam exatamente as permissões e validações atuais;
- estornos e lançamentos compensatórios recebem distinção visual clara.

O comportamento sem JavaScript deve permanecer seguro. Se painéis expansíveis
forem implementados com JavaScript, controles críticos precisam continuar
disponíveis ou receber uma alternativa navegável.

### Relatório financeiro

Filtros de mês, plano e especialidade ficam numa barra superior. Totais
faturado e recebido aparecem em cartões discretos, acompanhados das informações
explicativas atuais. As tabelas por atendimento, plano, profissional, forma de
pagamento e status permanecem abaixo.

Não serão adicionados gráficos, exportações ou novas métricas neste redesign.

### Usuários

A lista mantém nome, usuário, papel, status e ações. Criação, redefinição de
senha e desativação recebem formulários ou painéis focados, evitando que todos
os campos de todas as pessoas permaneçam abertos simultaneamente.

As permissões existentes continuam determinando quais telas e ações são
visíveis. Não faz parte deste escopo implementar a futura fase de acesso e
permissões já especificada separadamente.

### Troca de senha e novo usuário

Formulários usam uma coluna, largura controlada, instruções próximas dos campos
e validações com feedback legível. A hierarquia visual deve deixar clara a ação
principal e o caminho de retorno.

### Login

O login usa uma composição limpa com a marca Clínica Exemplo, campos de nome de
usuário e senha, feedback de erro e botão principal. Diferentemente do sistema
antigo, nomes de usuários não são expostos numa lista pública.

### Erros e acesso negado

Páginas de erro mantêm a estrutura visual do dashboard quando há sessão válida
e apresentam mensagem, causa compreensível quando segura e próximo passo. Não
devem revelar detalhes internos.

## Acessibilidade e uso operacional

- contraste de texto e controles deve atender WCAG AA;
- foco de teclado precisa ser visível;
- labels permanecem associados aos campos;
- alvos de toque devem ser confortáveis mesmo com layout denso;
- tabelas preservam cabeçalhos semânticos;
- mensagens não dependem apenas de cor;
- ações reveladas visualmente continuam acessíveis por teclado e toque;
- animações, quando usadas, são breves e respeitam redução de movimento.

## Implementação

O redesign deve aproveitar os templates EJS e a folha de estilos existentes.
Alterações de marcação são permitidas apenas para melhorar estrutura,
semântica, agrupamento e apresentação dos mesmos dados e ações.

Arquivos previstos:

- `public/dashboard.css`;
- `src/views/partials/header.ejs`;
- `src/views/partials/footer.ejs`;
- views existentes de Agenda, Pacientes, Financeiro, Usuários, login e erros;
- testes de views afetados, somente quando precisarem acompanhar marcação ou
  classes novas.

Não fazem parte do escopo:

- controllers, models ou services, salvo ajuste estritamente necessário para
  renderizar um dado que já é fornecido à mesma view;
- novas rotas ou endpoints;
- migrations ou alterações de schema;
- escrita manual no Postgres ou Calendar;
- alterações no bot ou seus fluxos;
- cadastro de psicólogos;
- reativação de Guia/TISS, Estoque, Fornecedores ou Estatísticas;
- push, deploy ou commit sem autorização explícita.

Se durante a implementação surgir necessidade real de alterar regra de negócio,
payload de controller, rota ou integração, o trabalho deve parar para nova
avaliação de escopo e autorização.

## Estratégia de validação

1. Executar testes automatizados existentes e adicionar apenas testes de view
   proporcionais às mudanças estruturais.
2. Executar lint e `git diff --check`.
3. Subir somente `src/app.js` por `_dev_dashboard_only.mjs`, evitando importar
   `server.js` e seus cron jobs reais.
4. Fazer inspeção visual das telas autenticadas em larguras desktop e móvel.
5. Verificar navegação por teclado, foco, contraste e estados de erro/sucesso.
6. Validar impressão da ficha do paciente e do controle de sessões.
7. Confirmar que nenhuma ação de teste escreveu no banco ou Google Calendar;
   inspeção visual deve preferir páginas e fluxos somente leitura.

Testes manuais que criem, remarquem, cancelem, registrem presença, pagamento ou
estorno usam produção e só podem ocorrer com autorização explícita e dados de
teste definidos pelo usuário.

## Critérios de aceite

- todas as telas existentes compartilham a direção híbrida operacional;
- a Agenda mantém a densidade da tabela e melhora hierarquia e leitura;
- a Ficha apresenta seu conteúdo atual em visão geral contínua;
- formulários extensos de Financeiro e Usuários deixam de dominar as tabelas;
- identidade visual da Clínica Exemplo permanece consistente;
- navegação e ações são utilizáveis por mouse, teclado e toque;
- telas de impressão preservam conteúdo e removem elementos de interface;
- nenhuma regra de negócio, integração ou dado de produção é alterado;
- testes, lint e verificação de whitespace passam;
- nenhuma etapa de commit, push ou deploy ocorre sem autorização explícita.
