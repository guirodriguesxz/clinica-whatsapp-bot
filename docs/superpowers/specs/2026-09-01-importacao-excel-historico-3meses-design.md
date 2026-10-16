# Importação retroativa de agenda via Excel (3 meses, sem telefone)

Status: aprovado — pronto para virar plano de implementação.

Continuação do sub-projeto 2 (ver
[2026-08-27-migracao-dados-legados-design.md](./2026-08-27-migracao-dados-legados-design.md)),
motivada por uma nova visita à clínica: o export XML por período (o que o
`TODO.md` previa como caminho ideal) não estava disponível na tela do
sistema de agenda anterior; a fonte real conseguida foi um relatório diferente,
exportado em PDF e convertido para Excel (.xlsx), cobrindo 01/07/2026 a
30/09/2026 (~165 páginas).

## Objetivo

Importar esse histórico de 3 meses (mais agendamentos futuros já marcados no
sistema antigo) sem duplicar dado, sem criar paciente errado por homônimo, e
sem exigir que a recepção mexa em terminal ou banco — a fonte não tem
telefone, então não dá para reaproveitar o script/serviço de migração
existente como está.

## Formato real da fonte de dados

Uma linha por atendimento, colunas: `NomePaciente`, `Data`, `Hora`, `Tipo
visita`, `Nome convênio`, `Cadastrou`, `Confirmou`, `Ficha`, `Status Ficha`.

- **Sem `Telefone`, `CPF`, `Nascimento` ou `Atendente`** — ausentes desse
  relatório (diferente do formato `Agenda_Manha/Tarde` usado no sub-projeto
  2).
- `Confirmou`: sempre vazio nos dados reais — ignorado.
- `Cadastrou`: nome de quem na recepção cadastrou no sistema de agenda anterior.
  Metadado administrativo do sistema antigo, não dado clínico. Decisão: não
  entra no banco — o Excel original fica arquivado como fonte, e isso já
  satisfaz a necessidade de não perder a informação sem exigir schema novo.
- `Ficha` (`Sim`/`Não`): indica se existe ficha/prontuário para o
  atendimento. Precisa ficar consultável no sistema → nova coluna
  `tem_ficha BOOLEAN` em `agendamentos_importados`.
- `Status Ficha` (`"agendado e veio"` / `"agendado e não veio"`): é
  presença/falta real. Alimenta `registros_atendimento` (sub-projeto 3),
  não `agendamentos_importados`.
- `Tipo visita`: valores como `CP`/`F`/possivelmente `D` — significado
  **não confirmado com a clínica** (evitar repetir o erro de assumir
  "Consulta"/"Fisioterapia" sem checar). Guardado como texto bruto, sem
  nenhuma lógica de negócio ramificando sobre ele — mesma política já usada
  para `tipo`/`obs`/flags no sub-projeto 2. Não bloqueia a importação;
  confirmar com a clínica depois é relevante só para relatórios/exibição,
  não para gravar dado certo ou errado.
- `Nome convênio`: mesmo tratamento de `Categoria` no sub-projeto 2 — grava
  bruto, sem tentar normalizar contra a lista de credenciados.

## Escopo

**Entra:**

- Novo parser `parsearArquivoExcel` (`.xlsx`), isolado do parser XML
  existente, devolvendo o mesmo formato de linha usado por
  `parsearArquivoAgenda` (`telefone`/`cpf`/`atendente` sempre `null`).
- Novo serviço de processamento isolado (não reaproveita nem altera
  `processarLinha` de `importacaoLegadoService.js` — ver "Por que um
  caminho isolado").
- Matching automático só por nome exato normalizado (`normalizarTexto`, já
  existente) contra `pacientes.nome`, só quando o resultado é único e
  inequívoco.
- Planilha de revisão gerada automaticamente para os casos ambíguos ou sem
  match, preenchida pela recepção, aplicada por um segundo script.
- Supressão de lembrete automático para linhas com data futura, aplicada no
  próprio `INSERT` (sem passo pós-hoc).
- Presença (`Status Ficha`) gravada em `registros_atendimento`, atribuída a
  um novo usuário genérico `usuarios` chamado "Importação" (criado via
  `criar-primeiro-usuario.js` já existente, só para rastreabilidade de
  auditoria — não é conta de uso diário).
- Nova coluna `tem_ficha BOOLEAN` (nullable) em `agendamentos_importados`.

**Não entra:**

- Criar paciente novo automaticamente a partir só do nome (sem telefone
  confirmado por um humano).
- Interpretar o significado de `Tipo visita`.
- Gravar `Cadastrou` no banco.
- Tela de dashboard para revisão — decisão explícita por ser importação
  pontual (não recorrente); se um dia isso se repetir, uma tela vale a
  pena, mas não agora.
- Qualquer escrita em Google Calendar ou chamada a `aiService`/
  `chatService`/webhook — mesma restrição de isolamento do sub-projeto 2
  (ver abaixo).

## Isolamento do bot (restrição obrigatória)

Mesma regra do sub-projeto 2: os dois scripts só fazem `INSERT`/`UPDATE`
direto no Postgres via `pool`. O único envio de mensagem que pode acontecer
como consequência indireta é o `lembreteService` (cron já existente)
pegando uma linha futura sem lembrete suprimido — por isso a supressão
acontece no próprio insert, nunca depois.

## Por que um caminho isolado (não reaproveita `processarLinha`)

`processarLinha` (sub-projeto 2) é estruturalmente amarrado a telefone: é a
chave da busca de paciente existente, da checagem de agendamento duplicado,
e do `ON CONFLICT` do insert. Como essa fonte nunca traz telefone, tentar
remendar essa função com condicionais misturaria duas lógicas de matching
fundamentalmente diferentes (uma por telefone, confiável; uma por nome,
sujeita a homônimo) na mesma função, arriscando o fluxo diário que já
funciona em produção. O caminho novo só entra em ação depois que uma linha
já tem telefone resolvido — por match automático de nome ou por decisão
manual da recepção — e a partir daí grava exatamente como o sub-projeto 2
já grava.

## Modelo de dados

Nova migration `015_importacao_excel_ficha.sql` (`014` é a última já
existente em `src/db/migrations/`, conferido em 2026-09-01):

```sql
ALTER TABLE agendamentos_importados
  ADD COLUMN IF NOT EXISTS tem_ficha BOOLEAN;
```

Sem tabela nova para a fila de revisão pendente — por ser importação
pontual, a fila vive só no arquivo da planilha (gerada e depois reaplicada),
não no banco. Se a recorrência mudar no futuro, revisar essa escolha.

Usuário "Importação": criado manualmente via
`node src/db/criar-primeiro-usuario.js "Importação" importacao@clinicaexemplo.local "<senha gerada>"`
antes de rodar a aplicação com `--aplicar` — não faz parte da migration.

## Fluxo

### Script 1 — gerar candidatos e planilha de revisão

`node src/db/importarExcelHistorico.js --arquivo <caminho.xlsx>` (sempre
dry-run nessa etapa, não grava nada):

1. Lê o `.xlsx`, faz parse de cada linha (`parsearArquivoExcel`).
2. Para cada linha:
   - Normaliza `Data`/`Hora`, valida formato (mesma regex de hora do
     sub-projeto 2).
   - Normaliza o nome (`normalizarTexto`) e busca em `pacientes` por nome
     normalizado igual.
   - **Exatamente 1 paciente encontrado** → candidato a auto-vínculo: usa o
     `telefone` desse paciente, mapeia `Status Ficha` → `presenca`
     (`"agendado e veio"` → `compareceu`, `"agendado e não veio"` →
     `faltou`, qualquer outro valor → sem registro de presença), mapeia
     `Ficha` (`Sim`/`Não`) → `tem_ficha` (`true`/`false`/`null`).
   - **0 ou 2+ pacientes encontrados** → vai para a planilha de revisão,
     com a lista de candidatos (id, nome, telefone parcial) quando houver
     mais de um.
3. Gera dois artefatos:
   - Relatório em texto (mesmo formato do sub-projeto 2): quantos
     candidatos a auto-vínculo, quantos foram para revisão, contagem por
     tipo de pendência.
   - Planilha `.xlsx` com uma linha por caso pendente: dados originais +
     candidatos sugeridos + três colunas em branco para a recepção
     preencher: `decisao` (ID de paciente existente, `NOVO` ou `IGNORAR`),
     `telefone_novo` (obrigatório só se `decisao = NOVO`), `observacao`
     (livre).

### Script 2 — aplicar auto-vínculo + planilha revisada

`node src/db/importarExcelHistorico.js --arquivo <caminho.xlsx> --aplicar
[--planilha-revisada <caminho>]`:

1. Repete o processamento do Script 1.
2. Para os candidatos a auto-vínculo (match único), grava de fato: insere
   `agendamentos_importados` (telefone do paciente existente, `nome`,
   `data`, `hora`, `tipo_atendimento = 'fisioterapia'` fixo — mesma decisão
   do sub-projeto 2 —, `convenio` = `Nome convênio` bruto, `tipo` = `Tipo
   visita` bruto, `tem_ficha`), só se a combinação
   (telefone normalizado, data, hora, nome) ainda não existir (reaproveita
   o índice único já criado no sub-projeto 2). Se `data > CURRENT_DATE`,
   grava já com `lembrete_2h_enviado_em = now()`. Se `presenca` foi
   resolvida, grava também `registros_atendimento`
   (`agendamento_importado_id`, `presenca`, `registrado_por` = id do
   usuário "Importação").
3. Se `--planilha-revisada` for passado, lê a planilha preenchida pela
   recepção e aplica cada linha decidida:
   - `decisao` = ID existente → usa telefone desse paciente, mesma lógica
     de insert acima.
   - `decisao` = `NOVO` + `telefone_novo` preenchido → cria o paciente
     (`nome`, `telefone_novo`) e então insere o agendamento, mesma lógica.
   - `decisao` = `NOVO` sem telefone, `IGNORAR`, ou em branco → não grava
     nada; entra no relatório final como "não importado".
4. Termina com um resumo: pacientes novos, agendamentos novos, registros de
   presença novos, linhas não importadas (com motivo).

## Divergências e casos especiais

- Nome sem nenhum match e sem telefone informado na planilha revisada →
  não importado, reportado.
- Nome ambíguo (2+ pacientes) sem decisão clara na planilha → não
  importado, reportado (nunca escolhe um candidato sozinho).
- Hora fora do formato esperado → linha ignorada, reportada (mesma regra
  do sub-projeto 2).
- `Status Ficha` com valor fora dos dois esperados → agendamento é gravado
  normalmente, mas sem registro de presença associado.

## Reativação de lembretes

Documentar em `OPERACAO.md`, mesmo padrão do sub-projeto 2: a supressão é
por linha (`lembrete_2h_enviado_em` preenchido no insert), reversível com o
mesmo tipo de `UPDATE ... SET lembrete_2h_enviado_em = NULL WHERE data >=
CURRENT_DATE AND ...` já documentado — restrito às linhas desta importação
quando chegar a hora de reativar.

## Estrutura de arquivos

```
src/
├── db/
│   ├── importarExcelHistorico.js          # novo — script principal (CLI)
│   └── migrations/
│       └── 015_importacao_excel_ficha.sql # novo
└── services/
    └── importacaoExcelHistoricoService.js # novo — parser + matching/decisão
```

## Testes

Mesmo padrão do sub-projeto 2 (`node --test`, `test/setupEnv.js`):

- Parser: dado um `.xlsx` de exemplo pequeno (fixture), extrai as linhas
  certas e preserva os campos brutos sem interpretar.
- Matching: paciente único → auto-vínculo; zero ou múltiplos → vai para
  revisão, nada é gravado.
- Mapeamento de `Status Ficha` → `presenca` e de `Ficha` → `tem_ficha`,
  incluindo valores fora do esperado (sem registro de presença, sem
  quebrar o insert do agendamento).
- Supressão de lembrete: linha com `data > CURRENT_DATE` grava
  `lembrete_2h_enviado_em` preenchido; linha passada grava `NULL`.
- Planilha revisada: `NOVO` com telefone cria paciente e agendamento;
  `NOVO` sem telefone e `IGNORAR` não gravam nada.
- Idempotência: rodar duas vezes sobre o mesmo `.xlsx` (+ mesma planilha
  revisada) não duplica agendamento nem registro de presença.

Verificação manual antes de considerar pronto: rodar em dry-run (Script 1)
contra o `.xlsx` real, conferir a contagem de auto-vínculo vs. revisão faz
sentido, revisar a planilha gerada, só então rodar `--aplicar` contra o
banco (não existe banco de desenvolvimento separado neste projeto — ver
[[project-clinicaexemplo-bot]]).
