# Ficha de avaliação fisioterapêutica — design

Data: 2026-09-04
Status: aprovado, pronto pra virar plano de implementação

## Contexto

A Clínica Exemplo usa hoje uma ficha impressa em papel, "Questionário de
Avaliação Fisioterapêutica", preenchida à mão pelo fisioterapeuta na
consulta de avaliação: anamnese (histórico de saúde do paciente), plano
terapêutico (objetivos do tratamento) e condutas propostas. O usuário
mandou uma foto de uma ficha real como referência de layout — só a
estrutura de perguntas/campos foi extraída, nenhum dado da pessoa
específica daquela foto aparece em qualquer lugar deste documento ou do
código.

Diferente da ficha cadastral (dados fixos do paciente, um registro só),
essa ficha é preenchida de novo a cada avaliação — um paciente pode ter
mais de uma ao longo do tempo (reavaliação, novo ciclo de tratamento).

**Decisão de fluxo confirmada com o usuário**: a recepção digita os dados
no sistema depois, a partir do papel já preenchido pelo fisioterapeuta —
não é preenchido digitalmente na hora da consulta.

**Decisão de formato confirmada com o usuário**: todas as perguntas da
ficha (inclusive as que no papel são de sim/não) viram campo de texto
livre simples no formulário — a recepção digita a resposta como está
escrita no papel (ex.: "Não", "Sim", "Não sabe informar"). Sem checkbox,
sem lógica condicional de campo que aparece/some.

## Objetivo

Digitalizar a ficha de avaliação fisioterapêutica: um registro novo por
avaliação, ligado ao paciente, com todos os campos da ficha em papel como
texto livre, mais um plano terapêutico (objetivos + condutas). Histórico
de avaliações visível na ficha do paciente, com opção de gerar PDF de
qualquer uma delas.

## Escopo

**Entra:**

- Migration `033_avaliacoes_fisioterapeuticas.sql`: nova tabela
  `avaliacoes_fisioterapeuticas`, um registro por avaliação, todos os
  campos de conteúdo nullable (só `paciente_id` e `data_avaliacao` são
  obrigatórios — a recepção pode não ter todas as respostas em mãos).
- Seção nova "Avaliações fisioterapêuticas" na ficha do paciente
  (`/pacientes/:id/ficha`): lista as avaliações anteriores (data +
  link), botão "Nova avaliação".
- Formulário novo (`GET/POST /pacientes/:id/avaliacoes/nova`) com um
  campo de texto por pergunta da ficha, na mesma ordem do papel.
- Tela de visualização/edição de uma avaliação existente
  (`GET/POST /pacientes/:id/avaliacoes/:avaliacaoId/editar`) — mesmo
  formulário, pré-preenchido.
- Geração de PDF sob demanda (`GET /pacientes/:id/avaliacoes/:avaliacaoId/pdf`),
  mesmo padrão dos Laudos e do Guia de convênio: função pura de
  montagem + `pdfkit`, sem salvar o PDF em lugar nenhum, sem histórico de
  versão do PDF em si (só do registro que ele representa).
- Permissão: mesmo nível do resto do dashboard — qualquer usuário logado,
  sem exigir papel de administradora.
- Campo ausente no PDF é omitido (sua linha simplesmente não aparece) —
  mesma regra já usada em Laudos/Guia de convênio. Na tela (formulário e
  histórico), campo ausente aparece vazio, não "Não informado" — mesma
  decisão da ficha cadastral.

**Não entra:**

- Nenhuma lógica de negócio em cima das respostas (ex.: alertar se
  "Está grávida?" for preenchido com algo que pareça positivo) — são
  campos de texto livre sem interpretação nenhuma pelo sistema.
- Vínculo com agendamento — confirmado com o usuário que a avaliação é um
  registro independente (paciente + data digitada manualmente), sem
  precisar escolher um agendamento específico da agenda.
- Exclusão de avaliação — sem tela/rota de exclusão nesta primeira
  versão (mesma decisão já usada em outros módulos de registro clínico:
  sem apagar histórico).
- Edição de campos depois de impresso deixar de fazer sentido, aviso de
  "já impresso" ou qualquer controle de versão do conteúdo — o registro é
  sempre editável, o PDF é gerado sempre a partir do estado atual.
- Preenchimento digital pelo fisioterapeuta durante a consulta — fluxo
  confirmado é só recepção digitando depois, a partir do papel.

## Modelo de dados

Nova migration `033_avaliacoes_fisioterapeuticas.sql`:

```sql
CREATE TABLE IF NOT EXISTS avaliacoes_fisioterapeuticas (
  id SERIAL PRIMARY KEY,
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id),
  data_avaliacao DATE NOT NULL,

  -- Anamnese (todas as perguntas da ficha em papel, texto livre)
  esta_gravida TEXT,
  possui_marcapasso TEXT,
  possui_protese_metalica_implantes TEXT,
  possui_doencas_cardiacas TEXT,
  possui_hipertensao_arterial TEXT,
  possui_diabetes TEXT,
  possui_epilepsia TEXT,
  possui_historico_cancer TEXT,
  medicamentos_continuos_quais TEXT,
  cirurgia_qual TEXT,
  cirurgia_quando TEXT,
  tempo_ultima_cirurgia TEXT,
  dor_atual_local TEXT,
  dor_atual_intensidade TEXT,
  limitacoes_funcionais_quais TEXT,
  fisioterapia_anteriormente TEXT,

  -- Plano terapêutico
  objetivos_tratamento TEXT,
  condutas_propostas TEXT,

  registrado_por INTEGER NOT NULL REFERENCES usuarios(id),
  registrado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_avaliacoes_fisioterapeuticas_paciente
  ON avaliacoes_fisioterapeuticas (paciente_id, data_avaliacao DESC);
```

`dor_atual_intensidade` é `TEXT`, não `INTEGER` — decisão do usuário de
manter tudo como texto livre simples, sem validação de formato.

## Estrutura de arquivos

```
src/
├── db/migrations/
│   └── 033_avaliacoes_fisioterapeuticas.sql   # nova
├── models/
│   └── avaliacaoFisioterapeuticaModel.js       # nova
├── services/
│   └── avaliacaoFisioterapeuticaPdfService.js  # nova
├── controllers/
│   └── avaliacaoFisioterapeuticaController.js  # nova
├── routes/
│   └── dashboardRoutes.js                       # +rotas novas
└── views/
    ├── pacientes/
    │   └── ficha.ejs                            # +seção "Avaliações fisioterapêuticas"
    └── avaliacoes/
        └── formulario.ejs                        # nova (usada por nova e editar)
test/
├── migrations.test.js                            # +migration 033
├── avaliacaoFisioterapeuticaModel.test.js        # nova
├── avaliacaoFisioterapeuticaPdfService.test.js   # nova
├── avaliacaoFisioterapeuticaController.test.js   # nova
├── avaliacaoFormularioView.test.js               # nova
└── fichaPacienteView.test.js                     # +seção de avaliações
```

## Fluxo

1. Recepção abre a ficha do paciente → vê a lista de avaliações
   anteriores (vazia se for a primeira) → clica em "Nova avaliação".
2. Formulário com um campo de texto por pergunta da ficha em papel, na
   mesma ordem, mais data da avaliação. Salva → volta pra ficha do
   paciente, avaliação nova aparece na lista.
3. Clique numa avaliação da lista abre a tela de edição/visualização
   (mesmo formulário, pré-preenchido) — pode corrigir qualquer campo.
4. Botão "Gerar PDF" nessa tela baixa o PDF daquela avaliação específica,
   montado a partir do estado atual do registro.

## Testes

Mesmo padrão do projeto (`node --test`, `pool.query` mockado, views
renderizadas direto com `ejs.renderFile`):

- Migration: tabela criada com as colunas certas, `paciente_id`/
  `data_avaliacao` `NOT NULL`, resto nullable.
- Model: criar avaliação grava todos os campos informados; listar
  avaliações do paciente retorna em ordem decrescente de data; buscar por
  id retorna null quando não existe ou pertence a outro paciente.
- PDF service: linhas de cabeçalho/anamnese condicionais (campo vazio não
  aparece), mesmo padrão de teste de `linhasCabecalhoLaudo`.
- Controller: formulário novo/editar carrega e salva corretamente,
  avaliação/paciente inexistente responde 404, avaliação de outro
  paciente também responde 404 (evita adivinhar id e editar avaliação de
  paciente errado).
- View: formulário renderiza os 18 campos de conteúdo + data; ficha do
  paciente mostra a lista de avaliações (vazia e populada) e o botão
  "Nova avaliação".

Verificação manual antes de considerar pronto: criar, editar e gerar PDF
de uma avaliação de um paciente de teste no dashboard local, contra o
banco de dev — nunca em produção sem autorização, e sem usar dados reais
de paciente algum.
