# Deploy na Railway — passo a passo

Guia específico para colocar o Clínica Exemplo Bot no ar usando a [Railway](https://railway.com). Pressupõe que você já fez os passos do `README.md` (Neon configurado com as 3 migrations rodadas, chave da OpenAI em mãos) — aqui o foco é só "onde o servidor roda".

Vamos criar **1 projeto na Railway com 3 serviços dentro dele**:

```
Projeto Railway
├── clinicaexemplo-bot    → o código deste repositório (Node/Express)
├── evolution-api    → a imagem Docker oficial da Evolution API, versão fixa (v2.3.7)
└── Postgres         → banco gerenciado, usado só pela Evolution API
```

Sem Redis: a Evolution usa cache em memória (`CACHE_LOCAL_ENABLED=true`), o que basta pra uma instância só e economiza um serviço.

O banco do **bot** continua sendo o Neon (plano gratuito) — não mexe nisso aqui. Não coloque o banco da Evolution no Neon: ela grava o tempo todo, o banco nunca "dorme" e estoura as horas de processamento do plano gratuito — derrubando junto o banco do bot, que fica no mesmo projeto. O Postgres desta lista é exclusivo da Evolution API (o mesmo papel que `evolution-api/docker-compose.yml` cumpre localmente); vale a pena manter esse banco separado do Neon do bot, já que são dados de natureza diferente (sessão/histórico do WhatsApp vs. pacientes/agendamentos).

> A Railway não executa esse `docker-compose.yml` diretamente — cada serviço dele vira um serviço separado no painel da Railway, configurado manualmente com os mesmos valores. É mais passos, mas cada peça fica independente (dá pra reiniciar/atualizar uma sem mexer nas outras).

## Antes de começar

Tenha em mãos:

- [ ] `DATABASE_URL` do Neon (já usado no seu `.env` local)
- [ ] Chave da OpenAI (`OPENAI_API_KEY`)
- [ ] `WEBHOOK_SECRET`, `ADMIN_API_KEY` e `SESSION_SECRET` gerados (`openssl rand -hex 32` cada um)
- [ ] Número de WhatsApp de atendimento humano (`ATENDENTE_HUMANO_TELEFONE`)
- [ ] O celular com o WhatsApp Business da clínica, pronto para escanear um QR code
- [ ] (Opcional, mas recomendado) DSN de um projeto Node no [sentry.io](https://sentry.io) (`SENTRY_DSN`) — ver README, seção "Observabilidade"

## Passo 1 — Colocar o projeto no GitHub

A Railway faz deploy a partir de um repositório Git. Este projeto já tem um repositório local (`git log` mostra o commit inicial); falta só enviá-lo pro GitHub:

1. Crie um repositório novo em [github.com/new](https://github.com/new) — recomendo **privado**, pois o código pode conter regras de negócio específicas. Não marque nenhuma opção de inicializar com README/gitignore (o projeto já tem os dois).
2. No terminal, dentro da pasta do projeto:
   ```bash
   git remote add origin https://github.com/SEU-USUARIO/clinicaexemplo-bot.git
   git branch -M main
   git push -u origin main
   ```

## Passo 2 — Criar conta na Railway

1. Entre em [railway.com](https://railway.com) e crie conta (login com GitHub é o mais direto, já que você vai conectar o repositório).
2. Não precisa cartão pra começar: a Railway dá **US$5 em créditos por 30 dias** de teste. Depois disso, o uso real é cobrado por segundo de CPU/memória — ver estimativa de custo no fim deste guia.

## Passo 3 — Deploy do bot

1. No painel da Railway: **New Project → Deploy from GitHub repo** → selecione `clinicaexemplo-bot`.
2. A Railway detecta sozinha que é um projeto Node (via `package.json`) e já sobe usando `npm install` + `npm start`. Não precisa mexer em build/start command.
3. Renomeie esse serviço para `bot` (clique no nome do serviço → rename) — ajuda a não confundir com o serviço da Evolution API que vem a seguir.
4. Vá na aba **Variables** desse serviço e adicione, uma por uma, todas as variáveis do seu `.env` (menos `PORT` — a Railway já injeta essa sozinha):
   - `DATABASE_URL`, `DATABASE_SSL`
   - `OPENAI_API_KEY`, `OPENAI_MODEL`
   - `WEBHOOK_SECRET`, `ADMIN_API_KEY`, `ATENDENTE_HUMANO_TELEFONE`
   - `SESSION_SECRET` — **obrigatória**, gere com `openssl rand -hex 32` (mesmo procedimento de `WEBHOOK_SECRET`/`ADMIN_API_KEY`). É o segredo que assina o cookie de sessão do painel administrativo. Sem ela o processo **não sobe**: `src/app.js` lança um erro no boot — e como o bot de WhatsApp roda no mesmo processo, o atendimento inteiro fica fora do ar, não só o dashboard.
   - `LEMBRETE_CONSULTA_ATIVADO=false`, `LEMBRETE_CONSULTA_HORAS_ANTES=24`
   - `SENTRY_DSN` (opcional — sem ela, erros continuam só nos logs da Railway, sem alerta)
   - `NODE_ENV=production` — **obrigatória**, por dois motivos: (1) o cookie de sessão do dashboard só ganha a flag `secure` (trafegar apenas por HTTPS) quando `NODE_ENV=production`; sem ela, o cookie de login da equipe pode sair em texto claro por HTTP; (2) se você configurar `SENTRY_DSN`, é o que faz os eventos chegarem rotulados como "production" em vez de "development" (mesmo rótulo dos seus testes locais), sem misturar os dois.
   - `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME` — **deixe em branco por enquanto**, você vai preencher no Passo 6, depois de criar a Evolution API.

5. Vá em **Settings → Networking → Generate Domain**. A Railway te dá uma URL pública tipo `https://exemplo-bot.up.railway.app` — é essa URL que vai receber o webhook da Evolution API. Guarde ela.

## Passo 4 — Postgres para a Evolution API

Ainda dentro do mesmo projeto Railway:

**New → Database → Add PostgreSQL**. A Railway sobe um Postgres gerenciado e já cria as variáveis de conexão sozinha (não precisa configurar nada).

## Passo 5 — Deploy da Evolution API

1. **New → Empty Service**.
2. Nas configurações desse serviço, em **Source**, escolha **Docker Image** e use `evoapicloud/evolution-api:v2.3.7`. Fixe a versão, nunca `latest`: com `latest`, qualquer reinício pode baixar uma versão nova sozinha e derrubar a conexão do WhatsApp.
3. Renomeie o serviço para `evolution-api`.
4. Na aba **Variables**, adicione (os valores em `${{...}}` a Railway autocompleta pra você — comece a digitar `${{` que ela sugere as variáveis do Postgres/Redis que você criou no Passo 4):
   ```
   AUTHENTICATION_API_KEY=<mesma chave forte que você vai usar em EVOLUTION_API_KEY no bot>
   DATABASE_ENABLED=true
   DATABASE_PROVIDER=postgresql
   DATABASE_CONNECTION_URI=${{Postgres.DATABASE_URL}}
   CACHE_REDIS_ENABLED=false
   CACHE_LOCAL_ENABLED=true
   CONFIG_SESSION_PHONE_CLIENT=Clínica Exemplo Bot
   CONFIG_SESSION_PHONE_NAME=Chrome
   DATABASE_SAVE_DATA_HISTORIC=false
   WEBHOOK_GLOBAL_ENABLED=true
   WEBHOOK_GLOBAL_URL=https://SUA-URL-DO-BOT.up.railway.app/webhook/SEU-WEBHOOK_SECRET
   WEBHOOK_GLOBAL_WEBHOOK_BY_EVENTS=false
   WEBHOOK_BASE64=false
   WEBHOOK_EVENTS_MESSAGES_UPSERT=true
   ```
   E todos os outros `WEBHOOK_EVENTS_*` como `false` (`MESSAGES_SET`, `MESSAGES_UPDATE`, `CHATS_SET`, `CHATS_UPSERT`, `CONTACTS_SET`, `CONTACTS_UPSERT`, `PRESENCE_UPDATE` etc.). Sem isso, logo depois de conectar a Evolution manda o histórico inteiro das conversas pro bot em pacotes de 3–4 MB, que o bot recusa (`PayloadTooLargeError` no Sentry). Pela CLI, defina uma variável por comando — várias `--set` no mesmo comando não funcionaram.
   (O nome `Postgres` no `${{...}}` precisa bater com o nome que cada serviço recebeu no painel — confira na barra lateral do projeto.)
5. Em **Settings → Networking**, confirme que a porta é `8080` (a mesma que aparece no `docker-compose.yml` original) e clique em **Generate Domain** — você vai precisar dessa URL pública para conectar o WhatsApp e configurar o webhook.

## Passo 6 — Conectar o WhatsApp da clínica

1. Abra a URL pública da `evolution-api` (a que você gerou no Passo 5) no navegador. A Evolution API expõe um painel/documentação (Swagger) na própria URL — use a `AUTHENTICATION_API_KEY` que você definiu para autenticar as chamadas.
2. Crie uma instância (dê um nome simples, ex: `clinicaexemplo`) — é esse nome que vai em `EVOLUTION_INSTANCE_NAME`.
3. A criação da instância gera um QR code. Escaneie com o WhatsApp Business da clínica (Configurações → Aparelhos conectados → Conectar um aparelho).
4. O webhook já vem da variável `WEBHOOK_GLOBAL_URL` (Passo 5) — não precisa configurar por instância. Se trocar o `WEBHOOK_SECRET` do bot, troque também a `WEBHOOK_GLOBAL_URL` da Evolution.

## Passo 7 — Fechar o ciclo: apontar o bot para a Evolution API

Volte no serviço `bot` (Passo 3) → **Variables** e preencha o que tinha ficado em branco:

```
EVOLUTION_API_URL=https://SUA-URL-DA-EVOLUTION-API.up.railway.app
EVOLUTION_API_KEY=<a mesma AUTHENTICATION_API_KEY do Passo 5>
EVOLUTION_INSTANCE_NAME=clinicaexemplo
```

Salvar as variáveis já dispara um redeploy automático do serviço.

## Passo 8 — Migrations no Neon

Se ainda não rodou, faça agora (SQL Editor do Neon, na ordem numérica): de `001_init.sql` até `009_usuarios_dashboard.sql`. Detalhes de cada uma no `README.md`, seção "Banco de dados (Neon)".

A `009_usuarios_dashboard.sql` cria a tabela `usuarios` — é ela que guarda o login da equipe no painel administrativo; sem essa migration, o dashboard não funciona.

## Passo 9 — Testar de ponta a ponta

1. `https://SUA-URL-DO-BOT.up.railway.app/health` deve responder `{"status":"ok"}`.
2. Mande uma mensagem de WhatsApp de verdade para o número da clínica e confira se o bot responde.
3. Se algo não funcionar, veja os logs: dentro de cada serviço na Railway, aba **Deployments** → clique no deploy ativo → **Logs**. É o mesmo `console.log`/`console.error` que já existe no código, só que centralizado ali.

## Custos esperados

A conta está no plano **Hobby (US$ 5/mês)**, que já inclui US$ 5 de uso. Entre agosto e setembro de 2026, o projeto com 4 serviços (incluindo um Redis, hoje removido) gastou cerca de US$ 3/mês de uso — então os 3 serviços atuais devem caber nos US$ 5 fixos. O banco do bot no Neon fica no plano gratuito (0,5 GB e 100 horas de processamento por mês por projeto). Recomendo:

1. Conferir o uso no fim do primeiro mês (Railway: Account Settings → Usage; Neon: página do projeto).
2. Configurar um alerta de uso/orçamento no painel da Railway (Account Settings → Usage) pra não ter surpresa na fatura.

## Manutenção no dia a dia

- **Deploy automático**: todo `git push` na branch `main` reimplanta o serviço `bot` sozinho — não precisa fazer nada manual depois do primeiro deploy.
- **Reinício automático**: se o processo cair (a rede de segurança de `uncaughtException`/`unhandledRejection` do `server.js` também derruba o processo de propósito depois de tentar avisar por WhatsApp), a Railway detecta e sobe o serviço de novo sozinha.
- **Logs**: sempre pela aba Deployments → Logs de cada serviço, é a primeira coisa a olhar se algo parecer errado (ver também `OPERACAO.md`).
