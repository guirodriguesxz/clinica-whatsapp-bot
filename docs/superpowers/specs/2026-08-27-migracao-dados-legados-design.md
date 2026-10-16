# Migração de dados legados (sistema de agenda anterior → banco novo)

Status: aprovado — pronto para virar plano de implementação.

Sub-projeto 2 de 5 da arquitetura macro (ver
[2026-08-27-sistema-clinica-arquitetura-macro-design.md](./2026-08-27-sistema-clinica-arquitetura-macro-design.md)).
Depende da Fundação (sub-projeto 1, já mergeado) só pelas colunas/tabelas que
já existiam antes dela; não usa nada do dashboard/`usuarios`. É pré-requisito
dos sub-projetos 3 (Presença/Prontuário) e 4 (Financeiro), que dependem de
pacientes já cadastrados no banco novo.

## Objetivo

Popular o banco do `clinicaexemplo-bot` com os dados reais que hoje só existem no
sistema de agenda anterior, a partir dos exports que a clínica consegue tirar dele, sem
depender de digitação manual e sem duplicar/corromper dado de paciente real.

## Formato real da fonte de dados

A clínica exporta a agenda dia a dia, separada em manhã/tarde:
`Agenda_Manha_DD-MM-YYYY.xml` / `Agenda_Tarde_DD-MM-YYYY.xml` (formato
`NewDataSet`/`Table1` do sistema de agenda anterior). Cada linha tem: `Hora`, `Paciente`,
`Obs` (texto livre — senha/matrícula de convênio, avisos como "NEURO - NAO
AGENDAR AVAL"), `CPF`, `Nascimento`, `Telefone`, `Categoria` (convênio —
`Particular`, `Intermed`, `Mar Azul Saúde`, etc.), `Tipo` (`AVAL` = avaliação, `OK` =
sessão normal), `Atendente`, e as colunas `F`/`C`/`E`/`Chegou` (flags
operacionais do dia — significado exato não confirmado). Decisão: guardar
tudo isso também em `agendamentos_importados`, com o valor bruto exatamente
como veio do export, mesmo sem uso definido ainda — evita perder dado que o
sistema de agenda anterior tem só porque ainda não sabemos pra que serve (ver "Modelo de
dados").

Levantamento feito em cima do export de 25–31/08/2026 (561 linhas): 254 são
slots vazios da grade (sem paciente marcado), 307 são agendamentos reais, e
só 3 têm nome mas nenhum telefone (vão para o relatório de divergência). Mais
histórico pode ficar disponível para exportar no futuro — o script foi
desenhado para ser executado de novo sobre lotes maiores sem duplicar nada já
importado (ver "Idempotência").

Existem também arquivos `.ics` (`Agenda_Manha_25-08-2026.ics` e uma variante
`_30min`) gerados localmente a partir do mesmo XML (não são export do
sistema de agenda anterior — `PRODID: Clínica Exemplo//Importacao Sistema Anterior`) e **já
importados no Google Calendar real da clínica**. Este script não recria
esses eventos: não escreve nada no Google Calendar, só no Postgres (ver
"Isolamento do bot" abaixo).

## Escopo

**Entra:**

- Script `src/db/migrarSistemaAnterior.js`, rodado manualmente (não é rota de
  API), que lê um diretório de arquivos `Agenda_*.xml` e faz upsert
  idempotente em `pacientes` e `agendamentos_importados`.
- Novas colunas `cpf`/`data_nascimento` (nullable) em `pacientes`.
- Novas colunas em `agendamentos_importados` espelhando **todo** campo do
  export que hoje não tem onde ir: `tipo`, `obs`, `flag_f`, `flag_c`,
  `flag_e`, `chegou` — todas `TEXT` nullable, gravadas com o valor bruto
  exatamente como veio do XML (sem interpretar/converter), pra não perder
  nenhum dado do sistema de agenda anterior mesmo sem uso definido ainda.
- Modo dry-run por padrão, com relatório de divergências para revisão humana
  antes de gravar de verdade (flag `--apply`).

**Não entra** (fica para sub-projetos seguintes):

- `pacotes_sessoes` — o export não tem nenhuma informação de pacote de
  sessões (contagem, valor). Fica para o sub-projeto 5 (Agendamento
  avançado), quando existir dado real de pacote para popular — não faz
  sentido criar linhas zeradas agora só para editar depois.
- Qualquer normalização automática de nome de convênio (ex: "Norte" do
  export vs. "Norte Intermed" usado no código do bot) — divergências
  desse tipo são reportadas, não corrigidas sozinhas.
- **Interpretar** o significado de `F`/`C`/`E`/`Chegou`/`Tipo` — o dado é
  guardado bruto (ver acima), mas nenhum código lê essas colunas ainda;
  nomes como `flag_f`/`flag_c`/`flag_e` são propositalmente genéricos até
  alguém confirmar o que cada um significa de verdade.

## Isolamento do bot (restrição obrigatória)

O script só faz `INSERT`/`UPDATE` direto no Postgres via `pool` — nunca
importa nem chama código de `aiService`, `chatService`, rotas de webhook, ou
qualquer coisa do `calendarService` (Google Calendar). O único envio de
mensagem que pode acontecer como consequência indireta é o cron de lembrete
já existente e já agendado (`lembreteService`, migration 006), que por conta
própria pega qualquer linha de `agendamentos_importados` com data futura e
manda lembrete 2h antes — o script não aciona isso diretamente, só deixa a
linha no banco para o cron encontrar na hora certa. Rodar o script nunca liga
nem acorda nenhuma função do bot na hora.

## Modelo de dados

Nova migration `010_migracao_legado.sql`:

```sql
ALTER TABLE pacientes
  ADD COLUMN IF NOT EXISTS cpf TEXT,
  ADD COLUMN IF NOT EXISTS data_nascimento DATE;

-- Campos do export do sistema de agenda anterior sem uso definido ainda — guardados
-- brutos (TEXT, sem conversão) pra não perder dado; ver "Escopo".
ALTER TABLE agendamentos_importados
  ADD COLUMN IF NOT EXISTS tipo TEXT,
  ADD COLUMN IF NOT EXISTS obs TEXT,
  ADD COLUMN IF NOT EXISTS flag_f TEXT,
  ADD COLUMN IF NOT EXISTS flag_c TEXT,
  ADD COLUMN IF NOT EXISTS flag_e TEXT,
  ADD COLUMN IF NOT EXISTS chegou TEXT;

-- Pré-checagem manual antes de aplicar em produção: confirmar que não existe
-- colisão entre agendamentos manuais já existentes antes de criar o índice
-- único abaixo (ver "Idempotência"). Inclui `nome` na chave — achado real
-- durante a implementação (2026-08-27): o mesmo telefone pode ter mais de
-- um paciente (ex: família dividindo número), então telefone+data+hora
-- sozinho colide incorretamente entre duas pessoas reais com horário
-- combinado no mesmo minuto.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agendamentos_importados_unico
  ON agendamentos_importados (
    regexp_replace(telefone, '\D', '', 'g'), data, hora, nome
  );
```

## Fluxo

1. Lê todos os arquivos `Agenda_*.xml` de um diretório (`--dir`, default
   `~/Downloads`).
2. Faz parse de cada `Table1`, ignorando a linha de cabeçalho (`<Hora>Hora</Hora>`)
   e slots vazios (`Paciente` e `Telefone` ambos em branco).
3. Para cada linha real:
   - Normaliza o telefone com `normalizarTelefone` (`src/utils/phone.js`,
     já existente) e completa o DDI ("55") quando o resultado tem 10 ou 11
     dígitos (DDD + número, típico de quem digita o próprio telefone sem o
     código de país) — sem isso, um paciente que já é usuário real do bot
     (telefone salvo com DDI) nunca bateria com o mesmo telefone vindo do
     sistema de agenda anterior, virando um cadastro duplicado. Números mais curtos
     (achado real: telefone fixo sem DDD, ex: "2267-6690") não são
     completados — não dá pra adivinhar o DDD com segurança, então ficam
     como estão (não vão casar com nenhum paciente existente, mas também
     não recebem um DDD errado).
   - **Sem telefone** (nome presente, telefone ausente): vai para a lista de
     divergências, nada é gravado para essa linha.
   - **Com telefone**: busca em `pacientes` pelo telefone normalizado.
     - Não existe → cria (`nome`, `telefone`, `cpf`, `data_nascimento`,
       `convenio` = `Categoria` como veio, sem normalizar).
     - Já existe → atualiza `cpf`/`data_nascimento` **somente se estiverem
       `NULL` hoje** (nunca sobrescreve dado que o paciente já tem).
   - Insere em `agendamentos_importados` (`telefone`, `nome`, `data`, `hora`,
     `tipo_atendimento` = `'fisioterapia'` fixo — sistema de agenda anterior só atende
     Fisioterapia —, `convenio`, `atendente`, e os campos brutos `tipo`,
     `obs`, `flag_f`, `flag_c`, `flag_e`, `chegou` copiados direto do XML)
     apenas se a combinação (telefone normalizado, data, hora, **nome**)
     ainda não existir — `nome` entra na comparação porque o mesmo telefone
     pode pertencer a mais de um paciente (ver "Idempotência").
4. **Dry-run (padrão, sem `--apply`)**: imprime um resumo — quantidade de
   pacientes novos, pacientes que ganhariam CPF/nascimento, agendamentos
   novos, e a lista de divergências (nome + motivo) — sem gravar nada no
   banco.
5. **Com `--apply`**: mesma lógica de decisão, gravando de fato (uma
   transação por arquivo processado), terminando com o mesmo resumo marcado
   como aplicado.

## Idempotência

O índice único em `agendamentos_importados` garante que rodar o script duas
vezes com os mesmos arquivos (ou um lote que se sobrepõe a um já processado)
não duplica agendamento nenhum — a segunda execução simplesmente não insere
de novo o que já está lá. Como a tabela já recebe inserções de
`agendamentoManualService.js` (agendamentos combinados manualmente,
independente desta migração), a migration precisa confirmar antes de criar o
índice que não existe colisão retroativa entre esses registros manuais; se
existir, resolve-se caso a caso antes de aplicar o índice em produção.

**Achado real durante a implementação**: a checagem de colisão no banco de
desenvolvimento encontrou duas linhas com o mesmo telefone/data/hora —
investigação mostrou que eram **dois pacientes reais diferentes** (família
dividindo o mesmo número, cada um com seu próprio evento no Google
Calendar), não uma duplicata de verdade. Por isso a chave de unicidade
inclui `nome` — telefone sozinho não identifica um paciente único. A mesma
checagem/comparação de existência que o serviço faz antes de inserir
(`processarLinha`) também precisa comparar por `nome`, não só
telefone+data+hora, pelo mesmo motivo.

`pacientes.telefone` já é `UNIQUE` desde o schema original — o upsert usa
essa restrição, não precisa de índice novo.

## Divergências e erros

Tudo que cai fora do caminho feliz vira uma linha no relatório, nunca trava o
processamento dos outros registros:

- Sem telefone (nome presente) → "sem telefone, não é possível associar a um
  paciente".
- Data ou hora em formato inesperado → "data/hora inválida, linha ignorada".
- `Categoria` (convênio) com um nome que não bate com nenhum já usado no bot
  → grava como veio, mas entra no relatório como aviso para revisão manual
  (não tenta adivinhar a normalização certa).

## Estrutura de arquivos

```
src/
├── db/
│   ├── migrarSistemaAnterior.js         # novo — script principal (CLI)
│   └── migrations/
│       └── 010_migracao_legado.sql    # novo
└── services/
    └── importacaoLegadoService.js     # novo — parse XML + matching/decisão
```

## Testes

Seguindo o padrão já existente (`node --test`, `test/setupEnv.js`):

- Parser: dado um XML de exemplo pequeno (fixture em `test/fixtures/`),
  extrai as linhas certas, pula cabeçalho/slots vazios, e preserva os campos
  brutos (`tipo`/`obs`/`flag_f`/`flag_c`/`flag_e`/`chegou`) exatamente como
  vieram, sem alterar nem interpretar.
- Lógica de matching/decisão (`importacaoLegadoService`) com o `pool`
  mockado: paciente novo → cria; paciente existente sem CPF → atualiza;
  paciente existente já com CPF → não sobrescreve; linha sem telefone → vai
  para divergências, não chama insert nenhum.
- Idempotência: rodar a função de importação duas vezes sobre o mesmo dado
  mockado — a segunda vez não gera nenhum insert novo de agendamento.

Verificação manual antes de considerar pronto: rodar em dry-run contra os
arquivos reais de 25–31/08/2026, conferir o resumo bate com a contagem
levantada nesta spec (307 agendamentos reais, 3 divergências), só então
rodar com `--apply` contra o banco de desenvolvimento.
