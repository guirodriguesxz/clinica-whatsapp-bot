# Contexto do projeto — Clínica Exemplo Bot

Projeto de portfólio com **dados 100% fictícios**: um bot de WhatsApp com IA
para agendamento e atendimento de uma clínica de fisioterapia e psicologia, mais
um painel administrativo para a recepção.

## Stack

- Node.js 20+, Express, EJS (painel renderizado no servidor)
- PostgreSQL (`pg`), sessões com `connect-pg-simple`
- OpenAI (function calling) para o assistente; Evolution API para o WhatsApp
- PDFs com `pdfkit`, documentos Word com `docx`, planilhas com `exceljs`
- Testes com o runner nativo (`node --test`), ESLint e Prettier

## Estrutura

- `src/routes`, `src/controllers`, `src/models`: rotas, regras de tela e acesso a dados
- `src/services`: fluxo do chat, lembretes, relatórios, importações, guias TISS
- `src/functions`, `src/prompts`: ferramentas e prompt do assistente de IA
- `src/db/migrations`: migrations SQL numeradas, aplicadas em ordem
- `src/views`, `public`: telas do painel e arquivos estáticos
- `site/`: tema WordPress do site público da clínica
- `docs/superpowers`: especificações e planos de cada funcionalidade

## Como explorar localmente

1. `npm install` e copie `.env.example` para `.env` (ver `README.md`).
2. Aplique as migrations em um Postgres local e crie o primeiro usuário
   (`node src/db/criar-primeiro-usuario.js`).
3. Opcional: `node src/db/seed-demo.js` popula pacientes, agendamentos e
   pagamentos fictícios.
4. `npm run dev` e acesse `http://localhost:3000/login`.

## Convenções

- Migrations só avançam: nunca editar uma já aplicada, criar a seguinte.
- Pagamentos são append-only: estorno gera um lançamento compensatório.
- Toda funcionalidade nova nasce com spec e plano em `docs/superpowers`.
