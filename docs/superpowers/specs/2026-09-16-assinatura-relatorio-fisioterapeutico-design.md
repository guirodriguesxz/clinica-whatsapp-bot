# Assinatura eletrônica no relatório fisioterapêutico

Data: 2026-09-16

## Contexto e problema

O relatório fisioterapêutico (`relatorioFisioterapeuticoPdfService.js`,
`relatorioFisioterapeuticoDocxService.js`) já termina com uma linha de
assinatura, mas hoje é só texto: o campo "Profissional responsável" do
formulário (`src/views/relatorios/formulario.ejs`) é texto livre digitado a
cada relatório ("Dra. Isabella Silva Reis / Crefito 435050-F"), e o
documento gerado deixa uma linha em branco (`___...___`) para assinatura
física no papel. Isso tem dois problemas: o nome/Crefito pode sair diferente
a cada relatório do mesmo profissional (typo, formatação inconsistente), e o
documento não sai já assinado — precisa ser impresso e assinado à mão depois.

Não existe hoje nenhum cadastro de fisioterapeutas no sistema (só existe
`psicologos`, sem ligação com agendamento ainda) nem qualquer upload de
arquivo pelo dashboard (o único envio de imagem do projeto é o encaminhamento
de foto de guia médica, que vem do paciente via WhatsApp, não do dashboard).

Descartado deliberadamente: assinatura digital com certificado (ICP-Brasil,
Clicksign etc.) — validade jurídica avançada não é necessária para este
documento interno, e o custo/complexidade de integrar um provedor pago não
se justifica aqui. Descartado também: assinatura por canvas (desenhar na
tela) — os fisioterapeutas não têm login no dashboard hoje (só
`administradora`/`recepcao` têm conta), então pedir que desenhem a
assinatura no navegador não é prático; quem cadastra é a administradora, em
nome do profissional, a partir de uma imagem já assinada no papel.

## Escopo

Só o relatório fisioterapêutico. Ficha do paciente (não tem linha de
assinatura hoje) e controle de sessões (rubrica por sessão, física,
presencial, já nem gera PDF — vira texto por WhatsApp) ficam de fora — são
problemas diferentes, não tratados aqui.

## Design

### 1. Cadastro de fisioterapeutas

Nova tabela `fisioterapeutas`, espelhando o padrão de `psicologos`
(`024_psicologos.sql`) com os campos extras necessários para Crefito e
assinatura:

```sql
CREATE TABLE IF NOT EXISTS fisioterapeutas (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  crefito TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  assinatura_imagem BYTEA,
  assinatura_mime TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`crefito` e os campos de assinatura são nullable — o cadastro pode existir
antes de a imagem ser enviada (ver seção de fallback).

Telas, mesma estrutura de `/psicologos` (`dashboardRoutes.js`,
`psicologoController` equivalente):

- `GET /fisioterapeutas` — listagem (nome, Crefito, indicador se tem
  assinatura cadastrada, ativo/inativo).
- `GET /fisioterapeutas/novo` e `POST /fisioterapeutas/novo` — criar
  (nome + Crefito; upload de assinatura opcional já nesse passo).
- `GET /fisioterapeutas/:id/editar` e `POST /fisioterapeutas/:id/editar` —
  editar dados e (re)enviar a imagem de assinatura.
- `POST /fisioterapeutas/:id/desativar` / `POST /fisioterapeutas/:id/reativar`
  — mesmo padrão de soft-disable de `psicologos`.

**Diferença deliberada em relação a `psicologos`**: todas as rotas de
escrita (`novo`, `editar`, `desativar`, `reativar`) exigem
`exigirPapel("administradora")` (mesmo middleware já usado em `/usuarios`),
por ser um cadastro que carrega uma imagem de assinatura de uma pessoa real
— dado mais sensível do que o resto do dashboard, onde qualquer usuário
logado edita livremente. A listagem (`GET /fisioterapeutas`) fica aberta a
qualquer usuário logado, já que o formulário do relatório (passo 3) precisa
ler essa lista para popular o seletor, e recepção sem papel de
administradora também gera relatórios.

### 2. Upload da imagem de assinatura

Primeiro upload de arquivo do dashboard — usa `multer` (nova dependência)
para parsear o `multipart/form-data` nas rotas de criar/editar acima.
Validação no controller: aceita apenas `image/png` e `image/jpeg`, limite de
2MB (assinatura é um arquivo pequeno; o limite existe só para não deixar
alguém subir um arquivo grande por engano). Arquivo fora desse formato ou
tamanho é rejeitado com mensagem de erro no formulário, sem gravar nada.

A imagem fica em `assinatura_imagem BYTEA` / `assinatura_mime TEXT` — não em
disco nem em serviço externo (S3 etc.). É pouco volume (uma imagem pequena
por fisioterapeuta, poucos fisioterapeutas) e o projeto já não tem nenhuma
infraestrutura de arquivo hoje, então introduzir um novo serviço externo só
para isso não se justifica.

Servida de volta via `GET /fisioterapeutas/:id/assinatura` (resposta com o
`Content-Type` de `assinatura_mime` e o binário de `assinatura_imagem`) —
usada para mostrar um preview no formulário de edição e, opcionalmente, um
indicador visual na listagem. Mesma exigência de login das outras rotas de
`/fisioterapeutas` (não fica pública).

### 3. Formulário do relatório

Em `src/views/relatorios/formulario.ejs`, o campo de texto livre
"Profissional responsável" vira um `<select>` populado com os
fisioterapeutas **ativos** (rótulo "Nome — Crefito XXXXX-F", ou só o nome se
o Crefito estiver vazio).

`relatorios_fisioterapeuticos` (migration 039) ganha uma coluna nova:

```sql
ALTER TABLE relatorios_fisioterapeuticos
  ADD COLUMN IF NOT EXISTS fisioterapeuta_id INTEGER REFERENCES fisioterapeutas(id);
```

Nullable e sem retroatividade — relatórios já existentes continuam com
`fisioterapeuta_id` NULL. A coluna `profissional_responsavel` (texto)
continua existindo e sendo gravada normalmente, só que agora seu valor é
derivado do fisioterapeuta selecionado (nome + Crefito formatado) no
momento da criação, em vez de digitado à mão — mantém o PDF/DOCX
funcionando exatamente como já funciona hoje (ele já lê
`profissionalResponsavel` como texto), sem precisar mexer no serviço de
geração para ler o nome.

### 4. Geração do PDF/DOCX

`gerarPdfRelatorio` (`relatorioFisioterapeuticoPdfService.js`) e
`gerarDocxRelatorio` (`relatorioFisioterapeuticoDocxService.js`) passam a
receber também `dados.assinaturaImagem`/`dados.assinaturaMime` (buscados via
`fisioterapeuta_id` na hora de montar os `dados` no controller, não guardados
na tabela de relatórios — sempre a assinatura *atual* do cadastro, mesmo
padrão de "documento gerado sob demanda, nunca salvo" que já vale para o
relatório inteiro).

- **Com assinatura cadastrada**: no lugar da linha em branco
  `_______________________________________`, embute a imagem centralizada
  (PDF: `doc.image(buffer, { align: "center", width: ... })` do pdfkit;
  DOCX: `ImageRun` dentro do `Paragraph` do pacote `docx`), com
  `profissionalResponsavel` (nome + Crefito) centralizado logo abaixo, como
  já é hoje.
- **Sem assinatura cadastrada ainda** (fisioterapeuta cadastrado mas ainda
  sem imagem enviada): mantém o comportamento atual inalterado — linha em
  branco para assinar no papel. Ninguém fica bloqueado de gerar relatório
  enquanto o cadastro de assinatura não estiver completo.

### 5. Dado histórico

Relatórios gerados antes dessa mudança têm `profissional_responsavel` como
texto solto e `fisioterapeuta_id` NULL — continuam sendo exibidos/reimpressos
exatamente como hoje (linha em branco), sem necessidade de backfill.

## Testes

Seguir o padrão já usado nos módulos irmãos (`psicologos`,
`relatorioFisioterapeuticoPdfService`/`DocxService`):

- Model/controller de `fisioterapeutas`: CRUD, validação de papel
  administradora nas rotas de escrita, validação de tipo/tamanho de imagem.
- `paragrafosRelatorioPdf`/geração de PDF e DOCX: caso com assinatura
  (imagem embutida) e caso sem (fallback pra linha em branco), sem gerar
  arquivo de verdade onde já existe função pura pra testar (mesmo padrão do
  arquivo atual).
- Formulário do relatório: seletor populado só com fisioterapeutas ativos.

## Fora de escopo (explicitamente adiado)

- Ficha do paciente e controle de sessões (rubrica por sessão) — problemas
  diferentes, não tratados aqui.
- Autoatendimento do fisioterapeuta (login próprio, canvas de assinatura) —
  só relevante se um dia a clínica decidir dar login individual aos
  fisioterapeutas.
- Versionamento/histórico de assinatura (o que acontece se o fisioterapeuta
  trocar a assinatura e um relatório antigo for reimpresso) — como o
  documento já é gerado sob demanda e nunca salvo, a reimpressão sempre usa
  a assinatura atual do cadastro; isso é uma continuação do comportamento já
  existente (o nome/Crefito também podiam mudar e afetar reimpressão, antes
  desta mudança), não uma regressão nova.
