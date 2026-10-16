# Notificação de agendamento para a recepção, com foto de encaminhamento

Status: aprovado em 2026-09-03.

Motivado por pedido direto do usuário: hoje o bot **não avisa a recepção**
quando cria um agendamento — o único aviso que existe hoje é o repasse
imediato e isolado da foto de encaminhamento médico, quando o paciente manda
uma. O usuário quer que, quando o agendamento for criado, a recepção receba
tudo numa mensagem só: a foto do encaminhamento (quando o paciente mandou
uma) junto com os dados do agendamento.

## Objetivo

Ao criar um agendamento pelo bot, a recepção recebe uma notificação no
WhatsApp interno da clínica com os dados do paciente/consulta — e, se o
paciente mandou uma foto de encaminhamento médico pouco antes (mesma
conversa), essa foto vai anexada na mesma mensagem, em vez de chegar
separada e antes, como hoje.

## Escopo

**Entra:**

- Migration 022: tabela `encaminhamentos_pendentes` (`paciente_id` PK,
  `base64`, `mimetype`, `legenda_paciente`, `criado_em`) — no máximo uma
  foto pendente por paciente; uma foto nova substitui a anterior
  (`INSERT ... ON CONFLICT (paciente_id) DO UPDATE`, resetando também
  `criado_em` para o momento da foto nova — senão ela herdaria o relógio da
  pendência antiga e poderia expirar cedo demais no job periódico).
- Receber a foto de encaminhamento passa a **gravar como pendente** em vez
  de repassar na hora para a recepção (mudança em
  `encaminhamentoMedicoService.js` e no ponto que a chama em
  `webhookController.js`, que passa a resolver `pacienteId` via
  `encontrarOuCriarPaciente` para poder gravar a pendência).
- Ao criar um agendamento com sucesso (`criarAgendamento.js`), notifica a
  recepção:
  - Se houver foto pendente do paciente: manda a foto com legenda única
    contendo nome, telefone, data/hora, tipo de atendimento e convênio, e
    apaga a pendência.
  - Se não houver: manda só o texto com os mesmos dados.
- Ao encaminhar para atendimento humano (`encaminharHumano.js`, categorias
  psicologia/convênio/urgente/erro_tecnico/outro): resolve `pacienteId` e,
  se houver foto pendente, manda ela sozinha na hora (mesmo formato de
  hoje) — não espera o timeout, já que esse caminho não vai gerar
  agendamento pelo bot.
- Job periódico novo em `server.js` (cron a cada 15 min, mesmo padrão dos
  jobs de lembrete/checagem de saúde já existentes): varre fotos pendentes
  há mais de 15 minutos sem virar agendamento nem serem flushadas por
  `encaminharHumano`, e manda cada uma sozinha para a recepção — garante
  que nenhuma foto se perde mesmo se a conversa for abandonada.
- Falha ao gravar a foto como pendente (erro de banco) cai de volta pro
  comportamento de hoje: tenta repassar na hora, best-effort, reaproveitando
  a mesma lógica de envio/legenda que o job de expiração usa — nunca perde
  o documento por causa de um problema técnico pontual.
- Falha ao enviar a notificação de agendamento (com ou sem foto) não
  bloqueia a confirmação ao paciente; se havia foto pendente, ela **não é
  apagada** nesse caso, e o job de expiração eventualmente a envia sozinha.

**Não entra:**

- Notificação de agendamento para remarcação ou cancelamento — só a
  criação, conforme pedido.
- Mudar o comportamento do agendamento manual pelo dashboard (a
  funcionalidade que acabou de ir para produção) — essa notificação é
  específica do fluxo do bot no WhatsApp.
- Correlacionar foto e agendamento além do vínculo por paciente (ex.: não
  há um "número de protocolo" ligando uma foto específica a um agendamento
  específico — se o paciente mandar duas fotos e agendar duas vezes rápido,
  a segunda foto é a que fica pendente, mesmo comportamento de "substitui a
  anterior" descrito acima).

## Fluxo

1. Paciente manda foto → bot resolve o paciente (mesmo padrão já usado para
   pausa por atendimento humano) → grava a foto como pendente (substitui
   qualquer pendência anterior do mesmo paciente) → conversa segue
   normalmente com uma nota sintética no histórico ("foto recebida, será
   repassada junto com o agendamento").
2. Paciente confirma um agendamento → `criarAgendamento` grava a consulta
   no banco (fluxo hoje inalterado) → busca foto pendente do paciente →
   monta e envia a notificação combinada (ou só texto) para a recepção →
   apaga a pendência só se o envio teve sucesso.
3. Se em vez de agendar o paciente for encaminhado para atendimento humano
   → `encaminharHumano` notifica a equipe (fluxo hoje inalterado) → busca
   foto pendente do paciente → se houver, manda ela sozinha e apaga a
   pendência.
4. Se nada dos dois acontecer em 15 minutos → job periódico manda a foto
   pendente sozinha para a recepção e apaga a pendência.

## Conteúdo da notificação

```
📅 Novo agendamento
Paciente: <nome> (<telefone formatado>)
<data> às <hora> — Fisioterapia|Psicologia
Convênio: <convênio ou "Particular">
```

Quando há foto anexada, esse texto vira a legenda (`caption`) da mensagem
de imagem — uma mensagem só, como pedido. Sem foto, é uma mensagem de texto
simples com o mesmo conteúdo.

## Estrutura de arquivos

```
src/
├── db/migrations/
│   └── 022_encaminhamentos_pendentes.sql   # nova
├── services/
│   └── encaminhamentoMedicoService.js      # registrarFotoPendente,
│                                              #   consumirFotoPendente,
│                                              #   enviarFotosPendentesExpiradas
│                                              #   (substitui
│                                              #   encaminharFotoEncaminhamento)
├── functions/
│   ├── criarAgendamento.js                 # +notificação de recepção
│   └── encaminharHumano.js                 # +flush de foto pendente
└── controllers/
    └── webhookController.js                # passa a resolver pacienteId
                                               #   e chamar
                                               #   registrarFotoPendente
server.js                                    # +cron de expiração (15 min)
```

## Testes

Mesmo padrão do projeto (`node --test`, `pool.query`/Evolution API
mockados):

- Migration: coluna/tabela conforme especificado.
- `registrarFotoPendente`/`consumirFotoPendente`: grava, substitui pendência
  existente do mesmo paciente, consome e apaga, consumir sem pendência
  retorna null.
- `enviarFotosPendentesExpiradas`: só pega pendências mais antigas que 15
  min, envia e apaga cada uma, erro numa não impede as outras.
- `criarAgendamento`: com foto pendente (envia combinado, apaga
  pendência), sem foto pendente (envia só texto), falha no envio não apaga
  a pendência nem impede a confirmação ao paciente.
- `encaminharHumano`: com foto pendente (flush imediato), sem foto
  pendente (comportamento inalterado).
- `webhookController`/`encaminhamentoMedicoService`: falha ao gravar
  pendência cai para repasse imediato (comportamento de hoje).
