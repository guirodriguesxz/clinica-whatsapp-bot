# Presença e prontuário leve

Status: aprovado — pronto para virar plano de implementação.

Sub-projeto 3 de 9 da arquitetura macro (ver
[2026-08-27-sistema-clinica-arquitetura-macro-design.md](./2026-08-27-sistema-clinica-arquitetura-macro-design.md)).
Depende da Fundação (sub-projeto 1, `usuarios`/dashboard, já mergeado) pelo
login/CSRF/layout, e da Migração de dados legados (sub-projeto 2, já
mergeado) pelo volume real de `agendamentos_importados` já populado.

## Objetivo

Dar pra recepção uma tela onde marcar, pra cada agendamento que já passou,
se o paciente compareceu ou faltou, e registrar uma observação curta da
sessão — cobrindo tanto os agendamentos feitos pelo bot quanto os já
migrados do sistema de agenda anterior, numa visão só.

## Escopo

**Entra:**

- Tabela nova `registros_atendimento`, compartilhada entre as duas origens
  de agendamento.
- Tela `/presenca` no dashboard: fila de pendentes (elegíveis sem registro
  ainda) por padrão, com `?todos=1` mostrando também os já registrados para
  revisão/edição.
- Duas rotas de escrita (`POST /presenca/agendamento/:id` e
  `POST /presenca/importado/:id`), cada uma fazendo upsert do registro.
- Pra agendamentos do bot, marcar presença também atualiza
  `agendamentos.status` para `compareceu`/`faltou` (ver "Modelo de dados").

**Não entra** (fora do escopo deste sub-projeto):

- Interpretar/migrar os valores já existentes em `agendamentos_importados.flag_f`
  (57 registros com `S`/`N`) — significado não confirmado com a clínica,
  decisão explícita de não usar esse dado pra pré-preencher nada. Todo
  agendamento importado começa sem registro de presença, mesmo os que já
  têm `flag_f` preenchido.
- Qualquer geração de documento a partir de `observacao_sessao` — isso é o
  sub-projeto 5 (Laudos), que só lê o que este sub-projeto grava.
- Histórico de correções: marcar presença de novo em cima de um registro já
  existente sobrescreve `presenca`/`observacao_sessao`/`registrado_por`/
  `registrado_em` no mesmo lugar — não guarda a versão anterior.

## Modelo de dados

Nova migration `011_presenca_prontuario.sql`:

```sql
CREATE TABLE IF NOT EXISTS registros_atendimento (
  id SERIAL PRIMARY KEY,
  agendamento_id INTEGER REFERENCES agendamentos(id),
  agendamento_importado_id INTEGER REFERENCES agendamentos_importados(id),
  presenca TEXT NOT NULL CHECK (presenca IN ('compareceu', 'faltou')),
  observacao_sessao TEXT,
  registrado_por INTEGER NOT NULL REFERENCES usuarios(id),
  registrado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(agendamento_id, agendamento_importado_id) = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_registros_atendimento_agendamento
  ON registros_atendimento (agendamento_id) WHERE agendamento_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_registros_atendimento_importado
  ON registros_atendimento (agendamento_importado_id) WHERE agendamento_importado_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER TABLE registros_atendimento ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON registros_atendimento FROM anon, authenticated;
  END IF;
END $$;
```

E uma extensão do CHECK existente em `agendamentos.status` (hoje
`confirmado`/`cancelado`/`concluido`) para incluir `compareceu`/`faltou`:

```sql
ALTER TABLE agendamentos DROP CONSTRAINT agendamentos_status_check;
ALTER TABLE agendamentos ADD CONSTRAINT agendamentos_status_check
  CHECK (status IN ('confirmado', 'cancelado', 'concluido', 'compareceu', 'faltou'));
```

`agendamentos_importados` não ganha nenhuma coluna nova — a presença dela
vive inteiramente em `registros_atendimento`.

O `CHECK (num_nonnulls(...) = 1)` garante que cada registro aponta pra
exatamente uma origem. Os dois índices únicos parciais garantem no máximo
um registro por agendamento (de cada origem) — o upsert usa
`ON CONFLICT (agendamento_id) DO UPDATE` / `ON CONFLICT (agendamento_importado_id) DO UPDATE`
contra eles.

## Regras de elegibilidade (fila de pendentes)

**Do bot** (`agendamentos`): `status = 'confirmado'` E `(data, hora)` já
passou (fuso da clínica) E não existe registro em `registros_atendimento`
para esse `agendamento_id`. Um agendamento `cancelado` nunca entra na fila.
Um já marcado (`status` em `compareceu`/`faltou`) também não — foi tratado.

**Do importado** (`agendamentos_importados`): `data` já passou E não existe
registro em `registros_atendimento` para esse `agendamento_importado_id`.
Não existe conceito de cancelamento nessa tabela, então todo histórico
passado sem registro é candidato.

Tentar marcar presença fora dessas condições (agendamento ainda no futuro,
já cancelado, ou id inexistente) retorna erro (404 pra id inexistente, 400
com mensagem clara pros outros casos) — a escrita não acontece.

## Fluxo de marcação

1. Recepção abre `/presenca` — vê a lista combinada (bot + importados),
   ordenada por data/hora mais recente primeiro, paginada
   (`limite`/`offset`, mesmo padrão de `/agendamentos`/`/pacientes`).
2. Pra cada linha pendente: nome do paciente, tipo de atendimento, data/hora,
   origem (bot ou importado, só informativo), e um formulário inline
   (`compareceu` / `faltou` + campo de observação opcional).
3. `POST` bate na rota correspondente à origem, dentro de uma transação:
   - **Bot**: `UPDATE agendamentos SET status = $presenca WHERE id = $id
     AND status = 'confirmado'` (o `AND status = 'confirmado'` reforça a
     regra de elegibilidade contra corrida — se outra aba já marcou
     entretanto, este `UPDATE` afeta 0 linhas e a rota responde 409) +
     upsert em `registros_atendimento`.
   - **Importado**: só o upsert em `registros_atendimento` (não há status
     pra atualizar na tabela importada).
4. Com `?todos=1`, a mesma tela também lista os já registrados — cada linha
   mostra presença + observação + quem registrou + quando, com o mesmo
   formulário pré-preenchido pra corrigir (reenviar sobrescreve, ver
   "Escopo").

## Estrutura de arquivos

```
src/
├── db/
│   └── migrations/
│       └── 011_presenca_prontuario.sql   # novo
├── models/
│   └── registroAtendimentoModel.js       # novo — elegíveis, upsert
├── controllers/
│   └── dashboardController.js            # +telaPresenca, +processarPresenca
├── routes/
│   └── dashboardRoutes.js                # +GET/POST /presenca...
└── views/
    └── presenca/
        └── lista.ejs                     # novo
```

## Testes

Seguindo o padrão já existente (`node --test`, `pool.query` mockado via
`t.mock.method`, sem Postgres real — ver `dashboardController.test.js`):

- Model: query de elegíveis exclui corretamente cancelados, já-marcados e
  agendamentos futuros, nas duas origens; upsert gera `INSERT` quando não
  existe registro e `UPDATE` (via `ON CONFLICT`) quando já existe.
- Controller: fluxo feliz de marcar presença nas duas origens (incluindo a
  dupla escrita transacional no caso bot); rejeição de `presenca` fora de
  `compareceu`/`faltou`; 404 pra id inexistente; 400 pra agendamento
  futuro/cancelado; 409 quando o `UPDATE` condicional do bot afeta 0 linhas
  (corrida).
- Sem teste de integração com Postgres real — mesmo padrão dos demais
  sub-projetos deste repo.

Verificação manual antes de considerar pronto: com dados de teste reais
(bot + importados, incluindo um cancelado e um futuro pra confirmar que
ficam fora da fila), marcar presença nos dois fluxos pelo dashboard rodando
localmente e conferir o `status`/`registros_atendimento` resultante direto
no banco.
