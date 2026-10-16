# Ficha de impressão do paciente (campos cadastrais completos)

Status: aprovado em 2026-09-03.

Motivado por pedido direto do usuário: a clínica quer que a ficha impressa
do paciente siga o mesmo modelo do sistema antigo (sistema de agenda anterior) —
formulário com dados cadastrais completos (CPF, RG, endereço, estado
civil, profissão, e-mail, matrícula do convênio), não só o resumo atual
(nome/telefone/convênio). O usuário mandou uma foto de uma ficha real como
referência de layout — os valores daquela paciente específica não
aparecem em nenhum lugar deste documento nem do código, só a estrutura de
campos.

## Objetivo

A ficha do paciente no dashboard passa a ter uma seção de dados
cadastrais completos, editável pela recepção, organizada em grade de
campos rotulados no mesmo formato do sistema antigo — e é essa seção que
aparece na impressão (`Imprimir ficha`), no lugar do resumo simples de
hoje.

## Escopo

**Entra:**

- Migration 023: novos campos em `pacientes`, todos nullable (preenchidos
  aos poucos pela recepção, não em massa): `rg`, `endereco`, `numero`,
  `bairro`, `cidade`, `uf`, `estado_civil`, `sexo`, `profissao`, `email`,
  `matricula_convenio`. `cep` também é novo (nenhum dos existentes cobre
  isso). `cpf` e `data_nascimento` já existem (migration 010) e passam a
  ser exibidos/editáveis pela primeira vez.
- Tela de edição nova (`GET/POST /pacientes/:id/editar`) com os campos
  acima. Nome, telefone e convênio continuam editáveis onde já estão
  hoje — não duplicados neste formulário. Mesma permissão do resto do
  dashboard: qualquer usuário logado, sem exigir papel de administradora.
- Grade de campos rotulados na ficha (`pacientes/ficha.ejs`), populada com
  os dados do paciente, no formato:

  ```
  Número: <id>              Médico: Ana Exemplo
  Paciente: <nome>
  Nascimento: <data> <idade> anos    Sexo: <sexo>    Entrada: <created_at>
  Endereço: <endereco>, <numero> - <bairro>, <cidade>
  Estado civil: <estado_civil>       Cidade: <cidade>
  UF: <uf>          CEP: <cep>       Telefone: <telefone>
  CPF: <cpf>         RG: <rg>        Profissão: <profissao>
  E-Mail: <email>
  Categoria: <convenio>
  Matrícula: <matricula_convenio>
  ```

  "Médico" é texto fixo ("Ana Exemplo"), não um campo de banco —
  aparece igual em toda ficha impressa, independente do paciente ou do
  tipo de atendimento. "Número" é o `id` do paciente; "Entrada" é
  `created_at`; ambos já existem, só passam a aparecer nesse formato.
  Campo sem valor aparece em branco (sem "Não informado" — isso é pra
  impressão em papel, não pra tela).
- Nova função `formatarData(valor)` em `src/utils/data.js` (só data, sem
  hora — hoje só existe `formatarDataHora`), registrada em
  `app.locals` do mesmo jeito. Cálculo de idade (anos completos a partir
  de `data_nascimento`) feito na view com `dayjs`.
- `atualizarDadosPaciente` (`pacienteModel.js`) ganha os campos novos —
  mesma função, parâmetros adicionais, todos opcionais (só atualiza o que
  vier preenchido, mesmo padrão de `COALESCE` que já usa hoje pra
  nome/convênio).

**Não entra:**

- Importação em massa de dados do sistema antigo — só edição manual pelo
  dashboard, um paciente de cada vez.
- Campos "Pai"/"Mãe" da ficha de referência — não fazem sentido pro
  contexto da clínica (no exemplo, o campo "Pai" continha o nome de um
  plano de saúde, não de uma pessoa — não uma boa referência pra copiar).
- Mudar o conteúdo do histórico de agendamentos ou do pacote de sessões
  na tela — continuam exatamente como estão hoje, visíveis na tela e
  escondidos na impressão (comportamento que já existe via CSS).
- Validação de formato de CPF/CEP/e-mail além do que o navegador já faz
  nativamente (`type="email"`) — são campos cadastrais de texto livre,
  sem regra de negócio em cima deles.
- Qualquer mudança em `agendamentos_importados` ou nos fluxos de bot —
  isso é só cadastro de paciente.

## Fluxo

1. Recepção abre a ficha do paciente (`/pacientes/:id/ficha`, já existe)
   → vê a grade de dados cadastrais (em branco nos campos ainda não
   preenchidos) → clica em "Editar dados" → formulário com os campos
   novos → salva → volta pra ficha, já atualizada.
2. Recepção clica em "Imprimir ficha" (já existe, `window.print()`) → a
   grade de dados cadastrais é o que sai impresso (CSS de impressão já
   esconde histórico/pacote de sessões hoje — sem mudança nesse
   comportamento).

## Estrutura de arquivos

```
src/
├── db/migrations/
│   └── 023_dados_cadastrais_paciente.sql   # nova
├── utils/
│   └── data.js                  # +formatarData
├── models/
│   └── pacienteModel.js         # atualizarDadosPaciente ganha os campos novos
├── controllers/
│   └── dashboardController.js   # +telaEditarPaciente, +processarEditarPaciente
├── routes/
│   └── dashboardRoutes.js       # rotas novas de editar paciente
└── views/
    └── pacientes/
        ├── ficha.ejs             # +grade de dados cadastrais, +link "Editar dados"
        └── editar.ejs            # nova
app.js                            # +app.locals.formatarData
test/
├── migrations.test.js            # +migration 023
├── data.test.js                  # +formatarData
├── fichaPacienteView.test.js     # +campos novos aparecem na ficha renderizada
└── dashboardControllerEditarPaciente.test.js   # nova
```

## Testes

Mesmo padrão do projeto (`node --test`, `pool.query` mockado, views
renderizadas direto com `ejs.renderFile`):

- Migration: colunas nullable conforme especificado.
- `formatarData`: formata `DD/MM/YYYY`, lida com valor ausente/inválido
  (mesmo padrão de `formatarDataHora`).
- `atualizarDadosPaciente`: grava os campos novos quando informados,
  preserva os existentes quando não informados (chamada só com
  nome/convênio, como hoje, não apaga os demais).
- Controller: `telaEditarPaciente`/`processarEditarPaciente` — formulário
  carrega com os dados atuais, salva e redireciona pra ficha, paciente
  inexistente responde 404.
- View: ficha renderizada com paciente contendo os campos novos preenchidos
  mostra cada um deles; com campos em branco, não mostra "Não informado"
  nem quebra a renderização; idade calculada corretamente a partir de
  `data_nascimento`; "Médico: Ana Exemplo" sempre presente.

Verificação manual antes de considerar pronto: editar e imprimir a ficha
de um paciente de teste no dashboard local, contra o banco de dev — nunca
em produção sem autorização, e sem usar dados reais de paciente algum.
