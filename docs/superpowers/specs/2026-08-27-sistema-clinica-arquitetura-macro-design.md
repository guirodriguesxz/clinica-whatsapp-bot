# Sistema de gestão da Clínica Exemplo — arquitetura macro

Status: aprovado (visão macro) — cada sub-projeto abaixo terá seu próprio spec de detalhe.

## Contexto e objetivo

O `clinicaexemplo-bot` hoje é um MVP de agendamento via WhatsApp (IA + function calling)
para Fisioterapia, com Postgres + Google Calendar. A clínica quer evoluir esse
sistema para substituir por completo o software legado (sistema de agenda anterior),
cobrindo também Psicologia, controle de presença/prontuário leve, financeiro,
migração dos dados legados, relatório de atendimento (laudo), faturamento
TISS, controle de estoque/fornecedores/centro de custo e estatísticas/
relatórios — um "sistema de agenda anterior melhorado", rodando em Railway.

**Escopo deliberadamente menor que o sistema de agenda anterior original**: o
sistema de agenda anterior (IATI) é um sistema médico genérico com dezenas de módulos
(receituário com dosagem de medicamento, banco de imagens de exame, CID,
etc.) — em 2026-08-27, avaliado módulo a módulo com o operador, a maioria
não se aplica a uma clínica de fisioterapia/psicologia (que não prescreve
medicamento controlado nem guarda exame de imagem próprio) e foi
deliberadamente deixada de fora. Ver "Sequenciamento aprovado" para o que
efetivamente entra.

Decisão confirmada: o Google Calendar **não** é removido — continua recebendo
os agendamentos como espelho visual (write-through, um sentido: Postgres →
Calendar), exatamente como funciona hoje para Fisioterapia. Postgres continua
sendo a única fonte de validação.

## Decisão de arquitetura

**Um único backend Express** (extensão do `clinicaexemplo-bot` atual) expõe o
webhook do WhatsApp/IA e também as telas administrativas novas — **dashboard
server-rendered** (EJS + sessão via cookie, guardada no próprio Postgres),
no mesmo serviço, sem frontend separado. Decisão revista em 2026-08-27 depois
de confirmar os requisitos reais do painel: uso só no desktop da recepção,
login simples usuário/senha, sem separação de papéis (todo mundo vê tudo).
Um SPA separado (React/Vite) traria CORS, sessão entre origens diferentes e
um build pipeline extra — complexidade sem benefício real para uma ferramenta
interna deste porte.

Alternativas descartadas:
- **Dois backends separados** (bot + admin) com pacote de banco compartilhado
  via monorepo — mais isolamento de falha, mas complexidade de infraestrutura
  desproporcional ao porte da clínica. Pode ser revisitado se o sistema
  crescer.
- **Frontend SPA separado** (React/Vite, segundo serviço Railway) — cogitado
  inicialmente na visão macro, descartado depois de confirmar que o painel é
  só desktop, sem papéis de acesso, com login simples: não compensa o CORS e
  o build extra.

```
WhatsApp paciente                    Recepção/Financeiro/Admin (staff)
      │                                        │
      ▼                                        ▼
Evolution API ──webhook──▶       clinicaexemplo-bot (Express, já existe)
                                        │              │
                                        │              │ HTML (EJS) +
                                        │              │ sessão via cookie
                    ┌───────────────────┘              │
                    ▼                                  ▼
              aiService/functions              Rotas do dashboard
              (IA, já existe)                  (financeiro, presença,
                    │                            pacotes, importação)
                    ▼                                  │
              ┌─────────────────────────────────────────┘
              ▼
         Postgres (fonte da verdade)
              │
              ▼ (write-through, um sentido)
        Google Calendar (espelho visual)
```

## Modelo de dados compartilhado

Tabelas existentes (não alteradas na sua essência): `pacientes`,
`agendamentos`, `agendamentos_importados`, `conversas`, `base_conhecimento`,
`webhook_mensagens_processadas`.

Novas tabelas/colunas necessárias para sustentar os módulos:

- `usuarios` — login individual de cada pessoa da equipe (sem papéis/permissões
  diferenciadas — todo mundo vê e faz tudo; o login existe para registrar quem
  fez cada ação, não para restringir acesso). Substitui a API key única
  (`ADMIN_API_KEY`) usada hoje pelas rotas `/admin`.
- `profissionais` — quem atende (nome, tipo_atendimento). Não existe hoje;
  pré-requisito para horário fixo semanal de Psicologia.
- `horarios_fixos` — profissional_id, dia_semana, hora_início/fim (agenda
  recorrente da Psicologia).
- `pacotes_sessoes` — paciente_id, tipo_atendimento, quantidade_total,
  quantidade_utilizada, valor, status.
- `agendamentos` ganha: `pacote_id` (nullable), `status` ampliado
  (compareceu/faltou, além de confirmado/cancelado/concluído),
  `observacao_sessao` (prontuário leve).
- `pagamentos` — paciente_id, agendamento_id ou pacote_id (nullable), valor,
  forma_pagamento, status, data.
- `laudos` — agendamento_id ou paciente_id, modelo/template usado, conteúdo,
  status de envio, destinatário (e-mail) — versão "relatório de evolução de
  fisioterapia", não laudo médico tradicional.
- `guias_tiss` — agendamento_id, paciente_id, convênio, número da guia,
  status (pendente/enviada/paga/glosada), dados exigidos pelo padrão TISS da
  ANS. Schema detalhado só no design do sub-projeto correspondente — depende
  de confirmar com a contabilidade da clínica se o faturamento TISS direto é
  realmente necessário (ver nota em "Sequenciamento aprovado").
- `materiais`, `fornecedores`, `centros_custo` — controle de estoque de
  consumíveis, básico (sem NF-e/fiscal).
- Estatísticas/relatórios não precisam de tabela nova — são consultas
  agregadas sobre `agendamentos`/`pagamentos`/`pacotes_sessoes` já existentes.

## Responsabilidade de cada módulo

- **Fundação** (pré-requisito dos demais): `usuarios`/autenticação (login
  simples, sem papéis) + esqueleto do dashboard server-rendered.
- **Módulo 1 — Agendamento/WhatsApp (IA)**: estende o fluxo de IA existente
  para consultar `pacotes_sessoes` (fisioterapia debita sessão do pacote
  ativo) e `profissionais`/`horarios_fixos` (psicologia passa a ter
  agendamento automatizado real, hoje é só encaminhamento humano). Maior
  risco — mexe no bot já em produção.
- **Módulo 2 — Presença/Prontuário leve**: tela no dashboard para marcar
  status de cada `agendamento` passado + observação curta. CRUD puro, sem IA.
- **Módulo 3 — Financeiro**: CRUD de `pagamentos` vinculados a agendamento
  avulso ou pacote, + relatórios agregados por mês/tipo/forma de pagamento.
- **Módulo 4 — Migração de dados**: script Node standalone (não é rota da
  API, roda uma vez) que lê export do sistema de agenda anterior/planilha, faz upsert
  idempotente em `pacientes`/`agendamentos_importados` (guardando também as
  colunas do export sem uso definido ainda, em vez de descartar), reaproveitando
  a normalização de telefone já existente (`utils/phone.js`), com relatório de
  divergências para revisão humana antes de confirmar. `pacotes_sessoes`
  ficou fora desta migração — o export não tem dado de pacote nenhum (ver
  spec do sub-projeto).
- **Módulo 5 — Laudos/relatório de atendimento**: gera um documento por
  atendimento (modelo fixo, não por especialidade como no sistema de agenda anterior
  original), a partir do que já estiver em `observacao_sessao` (Módulo 2),
  com envio por e-mail. Depende do Prontuário leve existir.
- **Módulo 6 — Faturamento TISS**: geração das guias TISS padrão ANS para
  cobrança de convênio. **Antes de implementar**: confirmar com a
  contabilidade/administração da clínica se ela realmente fatura convênio
  direto nesse formato — é processo regulado, várias clínicas pequenas não
  fazem TISS próprio e são reembolsadas por outro canal. Depende do
  Financeiro (Módulo 3) existir.
- **Módulo 7 — Estoque/fornecedores/centro de custo**: CRUD básico de
  materiais consumíveis, fornecedores e centros de custo — sem integração
  fiscal/NF-e. Independente dos demais, mas sequenciado depois do Financeiro
  por afinidade (centro de custo se relaciona com despesas).
- **Módulo 8 — Estatísticas/relatórios**: gráficos e exportação (Excel/HTML)
  sobre consultas, convênios, atendimentos, pagamentos — consultas agregadas
  sobre dado que os módulos anteriores já geraram. Só faz sentido depois de
  existir volume real de dado para relatar.

## Sequenciamento aprovado

1. ~~Fundação~~ — `usuarios`/autenticação + esqueleto do dashboard. **Concluído.**
2. Migração de dados — popula o schema novo com dados reais.
3. Presença/Prontuário — baixo risco, valor imediato para a recepção.
4. Financeiro — depende de pacientes/pacotes já migrados.
5. Laudos/relatório de atendimento — depende do Prontuário (passo 3).
6. Faturamento TISS — depende do Financeiro (passo 4); confirmar necessidade
   real antes de iniciar (ver Módulo 6).
7. Estoque/fornecedores/centro de custo — independente, encaixado aqui por
   afinidade com Financeiro.
8. Estatísticas/relatórios — por último dos módulos de gestão, precisa de
   dado real acumulado nos passos anteriores.
9. Agendamento avançado (pacotes + Psicologia automatizada) — mantém-se por
   último de todos, por mexer no fluxo de IA que já atende pacientes reais.

Decisão de 2026-08-27: dos módulos do sistema de agenda anterior original avaliados
módulo a módulo com o operador, **Receituário, Banco de imagens e CID
ficaram de fora** — não se aplicam a uma clínica de fisioterapia/psicologia
(não prescreve medicamento controlado, não guarda exame de imagem próprio).
Backup automatizado explícito também foi considerado, mas fica coberto hoje
pelo backup gerenciado do Neon — não vira sub-projeto próprio a menos que
surja necessidade concreta.

## Em aberto (decidido no design detalhado de cada sub-projeto)

- Módulo 1: um Google Calendar por profissional de Psicologia, ou um único
  calendar compartilhado.
- Módulo 5 (Laudos): o projeto não tem nenhum serviço de e-mail hoje (só
  WhatsApp) — enviar laudo por e-mail exige escolher e configurar um
  provedor (ex: Resend, SES) como dependência nova; decidir no design
  detalhado desse sub-projeto.
