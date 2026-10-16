import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";
import { formatarDataHora, formatarData } from "../src/utils/data.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function renderizarHeader(dados = {}) {
  return ejs.renderFile(path.join(ROOT, "src/views/partials/header.ejs"), {
    titulo: "Agenda",
    caminhoAtual: "/agendamentos",
    csrfToken: "token-teste",
    usuarioAtual: { nome: "Usuária de teste", papel: "administradora" },
    formatarDataHora,
    ...dados,
  });
}

async function renderizarShell(dados = {}) {
  const contexto = {
    titulo: "Agenda",
    caminhoAtual: "/agendamentos",
    csrfToken: "token-teste",
    usuarioAtual: { nome: "Usuária de teste", papel: "administradora" },
    ...dados,
  };
  const [header, footer] = await Promise.all([
    ejs.renderFile(path.join(ROOT, "src/views/partials/header.ejs"), contexto),
    ejs.renderFile(path.join(ROOT, "src/views/partials/footer.ejs"), contexto),
  ]);

  return `${header}${footer}`;
}

function renderizarListaPacientes(dados = {}) {
  return ejs.renderFile(path.join(ROOT, "src/views/pacientes/lista.ejs"), {
    pacientes: [],
    titulo: "Pacientes",
    caminhoAtual: "/pacientes",
    csrfToken: "token-teste",
    usuarioAtual: { nome: "Usuária de teste", papel: "administradora" },
    formatarDataHora,
    limiteAtual: 50,
    offsetAtual: 0,
    temProximaPagina: false,
    mensagemExclusao: null,
    busca: "",
    avaliacao: "",
    ...dados,
  });
}

function renderizarControleSessoes(dados = {}) {
  return ejs.renderFile(path.join(ROOT, "src/views/pacientes/controle-sessoes.ejs"), {
    paciente: { id: 17, nome: "Paciente de teste" },
    sessoes: Array.from({ length: 10 }, (_, indice) => ({
      numero: indice + 1,
      data: `2026-09-${String(indice + 1).padStart(2, "0")}`,
      hora: "08:00",
      status: "Agendada",
    })),
    titulo: "Controle de sessões",
    caminhoAtual: "/pacientes/17/controle-sessoes",
    csrfToken: "token-teste",
    usuarioAtual: { nome: "Usuária de teste", papel: "administradora" },
    dataAvaliacao: null,
    totalLinhas: 10,
    totalAutomatico: 10,
    formatarDataHora,
    formatarData,
    ...dados,
  });
}

test("shell autenticado expõe navegação lateral e barra contextual", async () => {
  const html = await renderizarHeader();
  assert.match(html, /class="app-shell"/);
  assert.match(html, /class="sidebar"/);
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(html, /href="\/agendamentos" aria-current="page"/);
  assert.match(html, /class="topbar"/);
  assert.match(html, /Usuária de teste/);
  assert.match(html, /name="_csrf" value="token-teste"/);
  assert.match(html, /action="\/logout"/);
  assert.match(html, /href="\/configuracoes\/prestador"/);
});

test("shell autenticado agrupa os links de agenda em dois grupos (Fisioterapia, Psicologia) que abrem/fecham", async () => {
  const html = await renderizarHeader();
  assert.match(html, /<details class="sidebar-group"[^>]*>\s*<summary[^>]*><[\s\S]*?<span>Fisioterapia<\/span>/);
  assert.match(html, /<details class="sidebar-group"[^>]*>\s*<summary[^>]*><[\s\S]*?<span>Psicologia<\/span>/);
  assert.match(html, /href="\/agendamentos"[^>]*>[\s\S]{0,80}?<span>Agendamentos<\/span>/);
  assert.match(html, /href="\/agendamentos\/proximos"[^>]*>[\s\S]{0,80}?<span>Próximos agendamentos<\/span>/);
  assert.match(html, /href="\/psicologia"[^>]*>[\s\S]{0,80}?<span>Agendamentos<\/span>/);
  assert.match(html, /href="\/psicologia\/proximos"[^>]*>[\s\S]{0,80}?<span>Próximos agendamentos<\/span>/);
});

function isolarGrupo(html, rotulo) {
  const blocos = html.split("</details>");
  const bloco = blocos.find((b) => b.includes(`<span>${rotulo}</span>`));
  assert.ok(bloco, `grupo "${rotulo}" não encontrado no menu`);
  return bloco;
}

test("em /agendamentos, o grupo Fisioterapia vem aberto e o de Psicologia fechado", async () => {
  const html = await renderizarHeader({ caminhoAtual: "/agendamentos" });
  assert.match(isolarGrupo(html, "Fisioterapia"), /<details class="sidebar-group" open>/);
  assert.doesNotMatch(isolarGrupo(html, "Psicologia"), /<details class="sidebar-group" open>/);
});

test("em /psicologia, o grupo Psicologia vem aberto e o de Fisioterapia fechado", async () => {
  const html = await renderizarHeader({ caminhoAtual: "/psicologia" });
  assert.doesNotMatch(isolarGrupo(html, "Fisioterapia"), /<details class="sidebar-group" open>/);
  assert.match(isolarGrupo(html, "Psicologia"), /<details class="sidebar-group" open>/);
});

test("em /psicologia, só esse link do menu fica marcado como atual (não /psicologia/proximos nem /agendamentos)", async () => {
  const html = await renderizarHeader({ caminhoAtual: "/psicologia" });
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(html, /href="\/psicologia" aria-current="page"/);
});

test("em /psicologia/proximos, só esse link do menu fica marcado como atual", async () => {
  const html = await renderizarHeader({ caminhoAtual: "/psicologia/proximos" });
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(html, /href="\/psicologia\/proximos" aria-current="page"/);
});

test("shell autenticado tem botão Voltar (history.back) na barra contextual", async () => {
  const html = await renderizarHeader();
  assert.match(html, /class="[^"]*topbar-voltar[^"]*"[^>]*onclick="history\.back\(\)"/);
});

test("shell de recepção não exibe administração de usuários", async () => {
  const html = await renderizarHeader({
    usuarioAtual: { nome: "Recepção de teste", papel: "recepcao" },
  });
  assert.doesNotMatch(html, /href="\/usuarios"/);
  assert.doesNotMatch(html, /href="\/configuracoes\/prestador"/);
});

test("shell fecha a estrutura autenticada e mantém login em main simples", async () => {
  const autenticado = await renderizarShell();
  assert.match(autenticado, /<\/main>\s*<\/div>\s*<\/div>\s*<script>[\s\S]*?<\/script>\s*<\/body>/);

  const login = await renderizarShell({ usuarioAtual: null });
  assert.match(login, /<main class="app-main-simple">/);
  assert.doesNotMatch(login, /class="app-shell"/);
  assert.match(login, /<\/main>\s*<script>[\s\S]*?<\/script>\s*<\/body>/);
});

test("lista de pacientes vazia mantém painel e tabela de dados", async () => {
  const html = await renderizarListaPacientes();

  assert.match(html, /class="[^"]*patient-list/);
  assert.match(html, /class="[^"]*data-table/);
});

test("lista de pacientes: campo de busca existe e preserva o termo digitado", async () => {
  const semBusca = await renderizarListaPacientes();
  assert.match(semBusca, /name="busca" value=""/);

  const comBusca = await renderizarListaPacientes({ busca: "11999990000" });
  assert.match(comBusca, /name="busca" value="11999990000"/);
  assert.match(comBusca, />Limpar filtros</);
});

test("lista de pacientes: filtro de avaliação marca a opção selecionada e mostra 'Limpar filtros' mesmo sem busca", async () => {
  const html = await renderizarListaPacientes({ avaliacao: "avaliacao" });

  assert.match(html, /<option value="avaliacao" selected>Avaliação<\/option>/);
  assert.match(html, />Limpar filtros</);
});

test("lista de pacientes: sem offset, não mostra 'Anterior'; com próxima página, mostra 'Próxima'", async () => {
  const primeiraPagina = await renderizarListaPacientes({ offsetAtual: 0, temProximaPagina: true });
  assert.doesNotMatch(primeiraPagina, />Anterior</);
  assert.match(primeiraPagina, /href="\/pacientes\?limite=50&offset=50&busca=&avaliacao=">Próxima/);

  const paginaSeguinte = await renderizarListaPacientes({ offsetAtual: 50, temProximaPagina: false });
  assert.match(paginaSeguinte, /href="\/pacientes\?limite=50&offset=0&busca=&avaliacao=">Anterior/);
  assert.doesNotMatch(paginaSeguinte, />Próxima</);
});

test("controle de sessões mantém uma única via e semântica de impressão", async () => {
  const html = await renderizarControleSessoes();

  assert.match(html, /class="[^"]*session-control/);
  assert.equal((html.match(/class="[^"]*print-copy/g) || []).length, 1);
  assert.equal((html.match(/class="[^"]*print-only/g) || []).length, 1);
  assert.match(html, /class="[^"]*screen-only/);
  assert.match(html, /Controle de Fisioterapia/);
  assert.match(html, /Paciente de teste/);
  assert.match(html, /Assinatura do paciente/);
});

test("controle de sessões: campo de linhas mostra o valor atual e some o link de 'usar automático' quando igual ao automático", async () => {
  const html = await renderizarControleSessoes({ totalLinhas: 10, totalAutomatico: 10 });

  assert.match(html, /name="linhas"[^>]*value="10"/);
  assert.doesNotMatch(html, /Usar automático/);
});

test("controle de sessões: com linhas personalizadas, mostra link 'usar automático' com o valor calculado", async () => {
  const html = await renderizarControleSessoes({ totalLinhas: 25, totalAutomatico: 10 });

  assert.match(html, /name="linhas"[^>]*value="25"/);
  assert.match(html, /Usar automático \(10\)/);
});

test("controle de sessões: botão 'Enviar por WhatsApp' existe e a mensagem de sucesso aparece com ?whatsapp=enviado", async () => {
  const semMensagem = await renderizarControleSessoes({ mensagemWhatsapp: null });
  assert.match(semMensagem, /action="\/pacientes\/17\/controle-sessoes\/enviar-whatsapp"/);
  assert.match(semMensagem, /Enviar por WhatsApp/);
  assert.doesNotMatch(semMensagem, /class="sucesso/);

  const comMensagem = await renderizarControleSessoes({
    mensagemWhatsapp: "Controle de sessões enviado por WhatsApp.",
  });
  assert.match(comMensagem, /class="sucesso screen-only">Controle de sessões enviado por WhatsApp\./);
});

function renderizarUsuarios(dados = {}) {
  return ejs.renderFile(path.join(ROOT, "src/views/usuarios/lista.ejs"), {
    usuarios: [
      { id: 1, nome: "Ana Admin", nome_usuario: "ana", papel: "administradora", ativo: true },
      { id: 2, nome: "Bia Recepção", nome_usuario: "bia", papel: "recepcao", ativo: true },
    ],
    sucesso: false,
    titulo: "Usuários",
    caminhoAtual: "/usuarios",
    csrfToken: "token-teste",
    usuarioAtual: { id: 1, nome: "Ana Admin", papel: "administradora" },
    ...dados,
  });
}

function renderizarLogin(dados = {}) {
  return ejs.renderFile(path.join(ROOT, "src/views/login.ejs"), {
    erro: null,
    ...dados,
  });
}

function renderizarAcessoNegado(dados = {}) {
  return ejs.renderFile(path.join(ROOT, "src/views/erros/acesso-negado.ejs"), {
    titulo: "Acesso negado",
    caminhoAtual: "/usuarios",
    csrfToken: "token-teste",
    usuarioAtual: { nome: "Colaboradora de teste", papel: "recepcao" },
    ...dados,
  });
}

test("lista de usuários usa painel de ações em details e login/acesso negado não vazam contas", async () => {
  const [usuariosHtml, loginHtml, acessoNegadoHtml] = await Promise.all([
    renderizarUsuarios(),
    renderizarLogin(),
    renderizarAcessoNegado(),
  ]);

  assert.match(usuariosHtml, /class="[^"]*user-list/);
  assert.match(usuariosHtml, /<details[^>]*class="[^"]*user-actions/);
  assert.match(loginHtml, /class="[^"]*login-layout/);
  assert.match(loginHtml, /autocomplete="username"/);
  assert.match(loginHtml, /autocomplete="current-password"/);
  assert.doesNotMatch(loginHtml, /Usuária de teste|Recepção de teste/);
  assert.match(acessoNegadoHtml, /class="[^"]*empty-state/);
});

test("estados semânticos preservam contraste e cor no hover", async () => {
  const css = await readFile(path.join(ROOT, "public/dashboard.css"), "utf8");

  assert.match(css, /--success: #[0-9a-f]{6};/i);
  assert.match(css, /\.badge\.is-success\s*\{\s*color: var\(--success\);\s*\}/);
  assert.match(css, /\.button\.is-success\s*\{[^}]*background: var\(--success\);/);
  assert.match(css, /\.sucesso\s*\{\s*color: var\(--success\);\s*\}/);
  assert.match(css, /\.sidebar a:focus-visible\s*\{[^}]*outline-color: var\(--forest\);/);
  assert.match(css, /\.button\.is-danger:hover:not\(:disabled\)/);
  assert.match(css, /\.button\.is-warning:hover:not\(:disabled\)/);
  assert.match(css, /\.button\.is-success:hover:not\(:disabled\)/);
});
