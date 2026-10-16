# Agenda unificada (Agendamentos + Presença)

Status: aprovado — pronto para virar plano de implementação.

Não é um novo sub-projeto da arquitetura macro — é uma revisão de
funcionalidade sobre dois sub-projetos já entregues: "Fundação" (tela
`/agendamentos`, hoje só leitura) e "Presença e prontuário leve"
([2026-08-27-presenca-prontuario-design.md](./2026-08-27-presenca-prontuario-design.md),
tela `/presenca`). Motivada por feedback direto do usuário: a tela de
Agendamentos não tem filtro nem nenhuma ação (cancelar, remarcar), e existem
duas telas separadas (Agendamentos e Presença) quando deveria ser uma só.

## Objetivo

Uma única tela `/agendamentos` onde a recepção vê todas as consultas (bot e
importadas do sistema de agenda anterior), filtra por data, status, tipo de atendimento
e paciente/telefone, e age sobre cada linha: cancelar, remarcar ou marcar
presença — sem precisar navegar entre duas telas diferentes.

## Escopo

**Entra:**

- Consolidar `/agendamentos` e `/presenca` numa tela só; `/presenca` (rota
  GET) e o item de menu correspondente são removidos.
- Filtros combináveis: `data` (dia exato), `status`, `tipo_atendimento`,
  `busca` (nome ou telefone do paciente) — todos opcionais, aplicáveis
  simultaneamente.
- Ação **Cancelar** (novo, hoje só existe via bot/WhatsApp).
- Ação **Remarcar** — muda data/hora de uma consulta do bot já marcada,
  reaproveitando a mesma grade de horários que o bot usa para o paciente
  (`listarHorariosDisponiveis`/`criarEventoAgendamento`), para não permitir
  remarcar fora do expediente, no passado, além do limite de 7 dias úteis,
  ou num horário já lotado.
- Ação **Marcar presença** (compareceu/faltou) — já existe hoje em
  `/presenca`, só muda de tela; comportamento e regras de elegibilidade
  inalterados (ver spec de Presença linkada acima).
- Recepção e administradora têm acesso igual a todas as ações desta tela
  (mesmo padrão já usado no resto da agenda).
- Extrair a lógica de remarcação (criar evento novo → gravar no banco → só
  então cancelar o evento antigo, com reversão se o passo do banco falhar)
  para uma função de serviço compartilhada entre o bot
  (`src/functions/remarcarAgendamento.js`) e o novo controller do
  dashboard — hoje essa sequência delicada só existe duplicável dentro da
  function-calling do bot.

**Não entra:**

- Criar um agendamento novo pelo dashboard (só remarcar um já existente).
  Continua sendo o bot quem cria consultas de Fisioterapia; Psicologia
  continua fora de agendamento automático (ver
  [2026-08-29-permissoes-e-agendas-design.md](./2026-08-29-permissoes-e-agendas-design.md),
  ainda bloqueado pela coleta de dados reais na clínica).
- Cancelar ou remarcar um agendamento **importado** (`agendamentos_importados`)
  — essa tabela não tem `status` nem vínculo com o Google Calendar; a linha
  aparece na tela e participa dos filtros, mas só com a ação de marcar
  presença.
- Migration nova — o schema já suporta tudo isso
  (`agendamentos.status` já aceita os 5 valores desde a migration 011;
  `registros_atendimento` já existe). Este sub-projeto é só camada de
  aplicação.
- Fila dedicada de "pendentes de presença" como página/preset separado
  (era o comportamento padrão do `/presenca` antigo). Cada linha elegível
  para presença mostra a ação de marcar diretamente, com ou sem filtro —
  não existe mais uma visão exclusiva para isso.
- Histórico de remarcações (quantas vezes uma consulta já foi remarcada,
  data/hora anterior) — a tela mostra só o estado atual.

## Ações por linha

| Origem | Situação | Ações |
|---|---|---|
| bot | `confirmado`, ainda não passou | Cancelar, Remarcar |
| bot ou importado | já passou, sem registro em `registros_atendimento` | Marcar Atendido / Faltou |
| bot ou importado | já passou, com registro | Corrigir (mesmo formulário, pré-preenchido — já é assim hoje) |
| bot | `cancelado` | Nenhuma — mostra badge "Cancelado" |
| bot | `compareceu`/`faltou` | Mesma linha de "com registro" acima (presença já reflete no status) |
| importado | ainda não passou | Nenhuma ação — só exibição |

"Já passou" usa a mesma checagem de fuso horário que `/presenca` já usa
hoje (`America/Sao_Paulo`, não o fuso da sessão do Postgres).

## Rotas novas

- `POST /agendamentos/:id/cancelar`
- `GET /agendamentos/:id/horarios-remarcacao?data=YYYY-MM-DD` — segundo passo
  do formulário de remarcação, devolve os horários livres daquele dia.
- `POST /agendamentos/:id/remarcar` (`data`, `hora` no corpo)

`GET /presenca` e as duas rotas `POST /presenca/agendamento/:id` /
`POST /presenca/importado/:id` são renomeadas para dentro do namespace de
agendamentos (`POST /agendamentos/bot/:id/presenca` e
`POST /agendamentos/importado/:id/presenca`) — mesmo comportamento, só
muda a URL para refletir que moraram pra a tela unificada.

## Remarcação

Fluxo em duas etapas na mesma página (sem sair da tela de Agendamentos):

1. Clicar em "Remarcar" abre um formulário inline na própria linha, pedindo
   a nova data.
2. Ao informar a data, um segundo passo busca os horários livres daquele
   dia via `listarHorariosDisponiveis({ data, tipoAtendimento })` (mesma
   função que o bot usa) e mostra como opções — a recepção escolhe uma e
   confirma.

Novo serviço compartilhado (ver "Estrutura de arquivos") encapsula a
sequência seguros-primeiro já usada por `remarcarAgendamento.js`: cria o
evento novo no Calendar, grava a nova data/hora no banco e só então cancela
o evento antigo — se a escrita no banco falhar depois de criar o evento
novo, o evento novo é revertido e a consulta original permanece intacta.
Os erros continuam sinalizados por `err.codigo`
(`FORA_DO_HORARIO_FUNCIONAMENTO`, `DATA_NO_PASSADO`, `FORA_DO_LIMITE_DIAS`,
`HORARIO_LOTADO`) — o bot mapeia pra mensagem de IA (já existe), o
dashboard mapeia pra mensagem de erro simples exibida na página.

`remarcarAgendamento.js` (bot) passa a chamar esse serviço em vez de
reimplementar a sequência — comportamento do bot não muda, é uma extração,
não uma mudança de regra.

## Cancelamento

Ação simples e direta no controller do dashboard (não precisa de serviço
compartilhado — são só duas chamadas, sem a complexidade de ordenação da
remarcação): `cancelarEventoAgendamento(googleEventId)` seguido de
`UPDATE agendamentos SET status = 'cancelado' WHERE id = $1 AND status =
'confirmado'` (o `AND status = 'confirmado'` protege contra cancelar duas
vezes ou cancelar algo já concluído/remarcado por outra aba — 0 linhas
afetadas vira 409, mesmo padrão já usado em `registrarPresencaBot`).

## Filtros e paginação

- `data`: dia exato (`YYYY-MM-DD`, validado com `validarData`); sem esse
  filtro, a tela mostra a partir de hoje em diante por padrão (não o
  histórico inteiro).
- `status`: um dos 5 valores válidos de `agendamentos.status`; aplicado só
  ao lado bot (importados não têm status, ficam de fora quando esse filtro
  está ativo).
- `tipo_atendimento`: `fisioterapia`/`psicologia`, aplicado aos dois lados.
- `busca`: `ILIKE` no nome do paciente OU no telefone (dígitos), aplicado
  aos dois lados.
- Sem filtro de data explícito, ordena por data/hora crescente (mais
  próxima primeiro) — o caso de uso principal é "o que vem por aí". Com
  filtro de data no passado (ex.: revisar presença de ontem), a ordenação
  por data/hora crescente dentro daquele dia continua fazendo sentido.
- Paginação (`limite`/`offset`) no mesmo padrão dos demais listagens do
  dashboard — combinar duas fontes heterogêneas com filtros dinâmicos
  precisa da mesma técnica já usada em `listarPresenca`: buscar até
  `offset + limite` linhas de cada fonte, combinar, ordenar e só então
  paginar em memória.

## Estrutura de arquivos

```
src/
├── services/
│   └── remarcacaoService.js        # novo — extrai a sequência de
│                                    #   remarcarAgendamento.js (bot)
├── functions/
│   └── remarcarAgendamento.js      # alterado — passa a chamar o serviço
├── models/
│   └── agendamentoModel.js         # +listarAgendaUnificada (bot+importado,
│                                    #   filtros, paginação em memória)
├── controllers/
│   └── dashboardController.js      # telaAgendamentos reescrita; novos
│                                    #   processarCancelarAgendamento,
│                                    #   processarRemarcarAgendamento,
│                                    #   +horariosDisponiveisRemarcacao (rota
│                                    #   auxiliar pro segundo passo do form);
│                                    #   telaPresenca/processarPresenca*
│                                    #   viram parte deste controller sem o
│                                    #   GET próprio
├── routes/
│   └── dashboardRoutes.js          # remove GET /presenca e o link de menu;
│                                    #   agendamentos ganha as novas rotas
│                                    #   POST
└── views/
    ├── agendamentos/
    │   └── lista.ejs               # reescrita — filtros, ações por linha
    └── presenca/                   # removida (view movida pra dentro de
                                     #   agendamentos/lista.ejs)
```

`src/views/partials/header.ejs` perde o item de menu "Presença".

## Testes

Mesmo padrão do resto do projeto (`node --test`, `pool.query` mockado, sem
Postgres real):

- Model: `listarAgendaUnificada` — cada filtro isolado e combinado, nas duas
  origens; ordenação; paginação em memória com janela `offset+limite`
  (mesmo padrão de bug já corrigido em `listarPresenca`, ver spec de
  Presença — não repetir o erro do `LIMIT` fixo).
- Serviço de remarcação: os 4 códigos de erro do Calendar propagam
  corretamente; reversão do evento novo quando a escrita no banco falha;
  bot e dashboard usando o mesmo serviço não duplicam a lógica (teste único
  do serviço, cada chamador só testa seu próprio mapeamento de erro/mensagem).
- Controller: cancelar (fluxo feliz, 409 em corrida, 404 id inexistente);
  remarcar (fluxo feliz, cada `codigo` de erro do serviço vira mensagem/
  status HTTP apropriado); presença (comportamento já coberto, só muda de
  rota — reexecutar os testes existentes contra o novo local).
- Sem teste de integração com Postgres/Google Calendar real.

Verificação manual antes de considerar pronto: com dados de teste reais
(um agendamento bot futuro, um passado sem presença, um importado passado
e um importado futuro), exercitar cancelar, remarcar e marcar presença
pelo dashboard rodando localmente contra o Calendar real de teste, e
conferir o resultado direto no banco e no Google Calendar.
