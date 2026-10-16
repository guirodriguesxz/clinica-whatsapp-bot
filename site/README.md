# Site Clínica Exemplo

Site institucional WordPress isolado do bot existente.

## Pré-requisitos

- Docker com Docker Compose
- Node.js 20 ou superior

## Uso local

```bash
cd site
cp .env.example .env
npm test
npm run bootstrap
```

Site: <http://localhost:8088>  
Painel: <http://localhost:8088/wp-admin>

As credenciais iniciais vêm do arquivo `.env`. Troque a senha antes de usar qualquer cópia fora do computador local e nunca versione o `.env`.

Para parar os contêineres, execute `npm run stop`. Esse comando preserva o banco. O comando `docker compose down -v` apaga todo o conteúdo local do WordPress e deve ser usado somente quando um reset completo for realmente desejado.

## Verificação e pacote

```bash
npm test
npm run smoke
npm run package-theme
```

O pacote instalável é criado em `dist/clinicaexemplo-theme-1.0.0.zip`. O conteúdo inicial e o menu são criados por `scripts/import-content.sh`, que pode ser executado novamente sem duplicar as seis páginas.
