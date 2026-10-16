# Clínica Exemplo Bot — Guia de Operação (para a clínica)

Este documento é para quem usa o sistema no dia a dia, não para quem mexe no código. Se alguma palavra técnica aparecer, ela vem explicada.

> **Desde 01/10/2026:** a agenda fica só no sistema de agenda anterior. O bot não marca, não desmarca e não consulta consultas, e não informa valores: agendamentos, cancelamentos, remarcações, perguntas de particular e de pagamento chegam como aviso no WhatsApp da recepção. As partes deste guia sobre agenda e lembretes no painel do bot não se aplicam mais.

## O que é isso

Um assistente que atende o WhatsApp da clínica automaticamente: tira dúvidas (horário, convênios, endereço), marca e cancela consultas direto no painel da clínica, e chama alguém da equipe quando o assunto foge do que ele sabe resolver.

## Como saber se está tudo funcionando

A forma mais simples: mande uma mensagem de teste pelo WhatsApp para o número da clínica, de outro celular, como se você fosse um paciente. Se o bot responder normalmente em alguns segundos, está tudo certo.

Sinais de que algo está errado:

- O bot não responde nada, mesmo depois de alguns minutos.
- O bot responde sempre com a mesma mensagem genérica de erro ("tivemos um problema técnico...").
- Um paciente avisa que o horário que agendou não apareceu na agenda, ou que apareceu duplicado.

## Onde ver os agendamentos e os pacientes

Use o painel da clínica em `https://SEU-DOMINIO/login`. Cada pessoa da equipe
entra com seu próprio usuário e senha.

No menu, abra **Agendamentos** (ou **Próximos agendamentos**, pra ver o que
vem depois da semana corrente) para consultar a agenda, ou **Pacientes** para
buscar uma ficha e os dados cadastrais. Não use nem compartilhe links
`/admin/...`: eles são reservados para integrações técnicas.

## Ficha do paciente e impressão

No painel (login em `/login`), abra a lista de **Pacientes** e clique no nome
para ver a ficha dele. A ficha mostra os dados cadastrais completos (CPF, RG,
endereço, estado civil, profissão, e-mail, matrícula do convênio, idade), no
mesmo formato do sistema antigo da clínica.

- **Editar dados**: clique em "Editar dados" na própria ficha pra preencher ou
  corrigir qualquer um desses campos. Todos são opcionais — pode ir
  preenchendo aos poucos, sem precisar completar tudo de uma vez. Um campo
  ainda vazio aparece em branco na ficha (não aparece "Não informado" — é
  pensado pra sair assim mesmo na versão impressa).
- **Imprimir ficha**: o botão "Imprimir ficha" abre o preview de impressão do
  navegador (`Ctrl+P`/`Cmd+P`) já mostrando só os dados cadastrais — o
  histórico de agendamentos e o pacote de sessões ficam escondidos
  automaticamente na versão impressa, pra não gastar papel com informação que
  não faz parte da ficha em papel.

## Adicionar/editar respostas do bot (base de conhecimento)

Perguntas frequentes (horário, convênios, endereço, preços etc.) ficam guardadas numa "base de conhecimento". Quem tem papel de administradora consegue gerenciar direto pelo dashboard, em **Base de conhecimento** no menu lateral:

- **Nova entrada**: cadastra uma pergunta e resposta nova, com categoria opcional.
- **Editar**: corrige o texto de uma entrada já existente.
- **Desativar/Reativar**: desativar tira a resposta de circulação (o bot para de usá-la, e ela some da listagem padrão) sem apagar do banco — dá pra reativar depois. Use "Mostrar inativas" pra ver o que já foi desativado.

A rota antiga por `curl` (`POST /admin/base-conhecimento`, autenticada por API key) continua funcionando sem mudanças, caso ainda seja usada por alguma automação externa.

## Avisos de atendimento humano (número interno da recepção)

Quando o bot precisa que alguém da equipe assuma a conversa (agendar Psicologia, validar um documento de convênio, uma reclamação, etc.), ele manda um aviso no WhatsApp do número interno de atendimento — não no número da clínica. Cada aviso já vem com uma etiqueta no início, pra dar pra saber do que se trata só de olhar a notificação, sem nem abrir o WhatsApp:

- 🧠 **PSICOLOGIA** — fim normal do fluxo de Psicologia (a clínica ainda não tem agenda automática por psicólogo). É rotina, sem urgência: só confirmar o horário com o profissional escolhido.
- 📄 **CONVÊNIO** — alguma pendência de convênio/encaminhamento médico.
- ⚠️ **URGENTE** — reclamação, emergência ou pedido fora do que o bot sabe resolver sozinho. Merece atenção mais rápida que os outros.
- 🔧 **ERRO TÉCNICO** — o sistema (IA ou automação) teve algum problema, não é sobre o paciente em si. Vale registrar e, se acontecer com frequência, avisar o desenvolvedor.
- ❓ **OUTRO** — não se encaixou nas categorias acima.

**Recomendação (não obrigatório, mas ajuda a não se perder no meio do dia):** depois de atender um paciente a partir de um desses avisos, reaja com 👍 ou ✅ na própria mensagem do aviso. Assim, quem olhar a conversa depois — inclusive outra pessoa da recepção — consegue ver de relance o que já foi resolvido e o que ainda está pendente, sem precisar reler tudo ou perguntar "alguém já viu isso?".

## Lembretes automáticos pausados para os agendamentos importados do sistema antigo

Em 27/08/2026 foram importados para o novo sistema os agendamentos que já existiam no sistema antigo da clínica (sistema de agenda anterior) — pacientes e horários que os pacientes já tinham marcado antes de o bot existir.

Para nenhum desses pacientes receber um lembrete de WhatsApp "do nada" (uma mensagem automática sobre uma consulta que eles marcaram sem saber que o bot existe), os lembretes automáticos da véspera foram **deixados desligados só para esses agendamentos importados**. Consultas marcadas normalmente pelo bot continuam recebendo lembrete da véspera sem nenhuma mudança.

Quando a clínica decidir que está tudo certo e quiser ativar os lembretes também para esses agendamentos importados, peça ao desenvolvedor para rodar o comando abaixo direto no banco de dados (Neon):

```sql
UPDATE agendamentos_importados
SET lembrete_24h_enviado_em = NULL
WHERE data >= CURRENT_DATE
  AND lembrete_24h_enviado_em IS NOT NULL;
```

Isso reativa o lembrete da véspera só para os agendamentos importados que ainda vão acontecer (os que já passaram não são afetados, e os agendamentos feitos direto pelo bot nunca foram tocados por essa pausa).

### Importação do relatório de 3 meses (Excel, 01/07 a 30/09/2026)

Além da importação de 27/08/2026 (exports diários `Agenda_Manha/Tarde`), a clínica também exportou do sistema de agenda anterior um relatório histórico de 3 meses num formato diferente — uma planilha Excel, sem telefone/CPF do paciente. Como não tem telefone pra casar automaticamente com o cadastro, a identificação dos pacientes é feita só pelo nome: quando um nome bate com exatamente um paciente já cadastrado, o vínculo é automático; quando bate com mais de um (homônimos) ou com nenhum, esse caso vai pra uma planilha separada que a recepção preenche antes de a importação seguir. Mesmo procedimento de segurança já usado na importação de 27/08: os lembretes automáticos da véspera ficam desligados só para os agendamentos futuros dessa importação. A reativação usa o mesmo comando SQL já documentado acima (mesma tabela, mesma condição) — não é preciso rodar nada diferente.

### Importação de 14/09/2026 (pendrive) e uma coluna antiga que não é mais usada

Nessa importação (exports `Agenda_Manha/Tarde` de 11/09 e 14/09/2026, trazidos por pendrive), a supressão de lembrete foi feita, por engano, na coluna errada (`lembrete_2h_enviado_em`) — resquício de uma versão antiga do sistema de lembretes (24h + 2h) que já não existe mais no código. **Essa coluna está morta**: nenhuma parte do sistema hoje a lê ou escreve; o único lembrete automático ativo é o de véspera, controlado por `lembrete_24h_enviado_em` (mesma coluna usada no comando SQL de reativação acima).

Na prática isso não teve nenhuma consequência: todos os agendamentos dessa importação são de 11/09 (já passado) ou 14/09 (mesmo dia da importação), e o lembrete de véspera **nunca dispara para consulta do mesmo dia** (regra do próprio sistema, ver acima) — então nenhum desses agendamentos corria risco de gerar um lembrete automático de qualquer forma, suprimido ou não. Nada precisou ser reativado.

**Para quem for fazer uma importação futura**: se algum dia entrar um lote com agendamentos para o dia seguinte (não o mesmo dia da importação), lembre de suprimir/reativar pela coluna certa, `lembrete_24h_enviado_em` (mesmo comando SQL documentado acima) — não pela antiga `lembrete_2h_enviado_em`, que não faz mais nada.

## Se algo der errado

1. **Bot não responde**: confirme primeiro se não é problema do próprio WhatsApp (ex: o número da clínica foi desconectado do celular/chip usado). Se o WhatsApp estiver normal e o bot não responder, avise o desenvolvedor — ele consegue ver os logs do servidor e identificar o problema rapidamente.
2. **Conta da OpenAI sem créditos**: quando isso acontece, o bot **não trava o paciente** — ele avisa automaticamente que o atendimento automático está indisponível no momento e encaminha para a equipe (mesma notificação por WhatsApp de um encaminhamento humano normal), pra ninguém ficar sem conseguir agendar. Além disso, o sistema confere sozinho a cada 15 minutos se a conta ainda tem saldo, e manda um aviso pro número de atendimento assim que detectar que acabou — mesmo que nenhum paciente tenha mandado mensagem ainda. Peça para quem cuida da conta conferir em [platform.openai.com/settings/organization/billing](https://platform.openai.com/settings/organization/billing) se há saldo disponível. Depois de adicionar créditos, o bot volta a responder normalmente em poucos minutos, sem precisar reiniciar nada.
3. **Bot respondeu, mas a consulta não apareceu no painel**: normalmente o próprio bot já avisa o paciente que houve um problema técnico e pede para tentar de novo. Se acontecer com frequência, avise o desenvolvedor.
4. **Paciente reclama de algo que o bot disse errado**: guarde o print da conversa (ou o número do paciente e o horário aproximado) e avise o desenvolvedor — ajuda a ajustar as instruções do bot.
5. **Emergência com paciente**: o bot é instruído a sempre encaminhar emergências para o número de atendimento humano configurado, nunca tentar resolver sozinho. Se isso não acontecer, é uma prioridade avisar o desenvolvedor.

## O que NUNCA fazer

- **Não compartilhe** chaves técnicas, incluindo o arquivo `.env`, a chave administrativa, a chave da OpenAI e a senha do banco de dados. Para o dia a dia, use sempre o dashboard com login individual.
- **Não envie** links de `/admin/...` para a equipe ou pacientes. Essas rotas são exclusivas de integrações técnicas e não aceitam credenciais na URL.
- **Não edite** as configurações do Neon (banco de dados) ou Evolution API sem confirmar com o desenvolvedor — mudanças ali podem tirar o bot do ar.

## Sobre dados de pacientes (privacidade)

O bot processa informações de saúde dos pacientes (por exemplo, a queixa principal relatada antes da primeira consulta de fisioterapia) usando um serviço de inteligência artificial de terceiros (OpenAI). Antes de colocar o sistema em uso real com pacientes, vale conversar com um advogado/contador sobre o que precisa ser informado aos pacientes (aviso de privacidade) e se há alguma exigência específica da LGPD para o setor de saúde que a clínica precise cumprir. Isso não é uma questão técnica — é uma decisão da clínica.

## Contato

Dúvidas técnicas ou problemas no sistema: **[preencher com o contato do desenvolvedor]**.
