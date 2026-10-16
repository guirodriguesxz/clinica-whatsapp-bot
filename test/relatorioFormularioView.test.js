import { test } from "node:test";
import assert from "node:assert/strict";
import ejs from "ejs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VIEWS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/views");

async function renderizar(dados) {
  return ejs.renderFile(path.join(VIEWS_DIR, "relatorios/formulario.ejs"), {
    csrfToken: "token-teste",
    paciente: { id: 7, nome: "Ana Silva" },
    relatorio: null,
    fisioterapeutas: [],
    erro: null,
    acaoForm: "/pacientes/7/relatorios/novo",
    ...dados,
  });
}

test("formulario: sem relatorio, todos os campos vêm vazios, sem link de PDF/Word salvos e sem botão de excluir", async () => {
  const html = await renderizar({});

  assert.match(html, /name="data_relatorio"/);
  assert.match(html, /name="fisioterapeuta_id"/);
  assert.match(html, /name="diagnostico_motivo"/);
  assert.match(html, /name="conduta_evolucao"/);
  assert.match(html, /name="consideracoes_finais"/);
  assert.doesNotMatch(html, /value="null"/);
  assert.doesNotMatch(html, /href="\/pacientes\/7\/relatorios\/\d+\/(pdf|docx)"/);
  assert.doesNotMatch(html, /Excluir relatório/);
  // Rascunho (PDF/Word) fica disponível mesmo sem relatório salvo ainda.
  assert.match(html, /formaction="\/pacientes\/7\/relatorios\/rascunho\/pdf"/);
  assert.match(html, /formaction="\/pacientes\/7\/relatorios\/rascunho\/docx"/);
});

test("formulario: com relatorio preenchido, campos vêm pré-preenchidos, fisioterapeuta selecionado e mostra link de PDF e Word", async () => {
  const html = await renderizar({
    relatorio: {
      id: 5, dataRelatorio: "2026-09-11",
      diagnosticoMotivo: "Fratura 5º dedo mão direita",
      condutaEvolucao: "Ganho de mobilidade progressivo",
      consideracoesFinais: "Consolidação parcial",
      profissionalResponsavel: "Dra. Isabella Silva Reis / Crefito 435050-F",
      fisioterapeutaId: 3,
    },
    fisioterapeutas: [{ id: 3, nome: "Dra. Isabella Silva Reis", crefito: "435050-F" }],
    acaoForm: "/pacientes/7/relatorios/5/editar",
  });

  assert.match(html, /name="data_relatorio"[^>]*value="2026-09-11"/);
  assert.match(html, /<option value="3" selected>/);
  assert.match(html, />Ganho de mobilidade progressivo</);
  assert.match(html, /href="\/pacientes\/7\/relatorios\/5\/pdf"/);
  assert.match(html, /href="\/pacientes\/7\/relatorios\/5\/docx"/);
});

test("formulario: com relatorio, mas sem usuarioAtual na view (renderização fora do dashboard logado), não quebra e não mostra excluir", async () => {
  const html = await renderizar({
    relatorio: { id: 5, dataRelatorio: "2026-09-11" },
    acaoForm: "/pacientes/7/relatorios/5/editar",
  });

  assert.doesNotMatch(html, /Excluir relatório/);
});

test("formulario: com relatorio e usuarioAtual administradora, mostra o botão de excluir", async () => {
  const html = await renderizar({
    relatorio: { id: 5, dataRelatorio: "2026-09-11" },
    acaoForm: "/pacientes/7/relatorios/5/editar",
    usuarioAtual: { papel: "administradora" },
  });

  assert.match(html, /Excluir relatório/);
  assert.match(html, /action="\/pacientes\/7\/relatorios\/5\/excluir"/);
});

test("formulario: com relatorio e usuarioAtual recepção, não mostra o botão de excluir", async () => {
  const html = await renderizar({
    relatorio: { id: 5, dataRelatorio: "2026-09-11" },
    acaoForm: "/pacientes/7/relatorios/5/editar",
    usuarioAtual: { papel: "recepcao" },
  });

  assert.doesNotMatch(html, /Excluir relatório/);
});

test("formulario: mostra mensagem de erro quando presente", async () => {
  const html = await renderizar({ erro: "Data do relatório inválida." });
  assert.match(html, /Data do relatório inválida\./);
});

test("formulario: fisioterapeuta com ativo:false na lista mostra sufixo (inativo) na option", async () => {
  const html = await renderizar({
    relatorio: {
      id: 5, dataRelatorio: "2026-09-11",
      fisioterapeutaId: 9,
    },
    fisioterapeutas: [{ id: 9, nome: "Dr. Fora do Time", crefito: null, ativo: false }],
    acaoForm: "/pacientes/7/relatorios/5/editar",
  });

  assert.match(html, /<option value="9" selected>Dr\. Fora do Time \(inativo\)<\/option>/);
});

test("formulario: relatorio legado (profissionalResponsavel em texto, sem fisioterapeutaId) mostra aviso e campo oculto de preservação", async () => {
  const html = await renderizar({
    relatorio: {
      id: 5, dataRelatorio: "2026-09-11",
      profissionalResponsavel: "Dr. Antigo / Crefito 111111-F",
      fisioterapeutaId: null,
    },
    acaoForm: "/pacientes/7/relatorios/5/editar",
  });

  assert.match(html, /Dr\. Antigo \/ Crefito 111111-F/);
  assert.match(html, /name="profissional_responsavel_legado" value="Dr\. Antigo \/ Crefito 111111-F"/);
});

test("formulario: relatorio novo (fisioterapeutaId null, sem texto legado) não mostra aviso nem campo oculto", async () => {
  const html = await renderizar({ relatorio: null });

  assert.doesNotMatch(html, /profissional_responsavel_legado/);
});
