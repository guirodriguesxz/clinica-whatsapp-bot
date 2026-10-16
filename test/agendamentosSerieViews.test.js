// test/agendamentosSerieViews.test.js
//
// Renderiza agendamentos/novo.ejs e agendamentos/serie-resultado.ejs
// diretamente (sem controller/app) — mesmo padrão de
// agendamentosListaView.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";
import { formatarData } from "../src/utils/data.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.join(__dirname, "..", "src", "views");

function renderizarNovo(dados = {}) {
  return ejs.renderFile(path.join(VIEWS_DIR, "agendamentos", "novo.ejs"), {
    csrfToken: "token-fake",
    psicologos: [],
    fisioterapeutas: [],
    convenios: [],
    tipoAtendimentoInicial: null,
    voltarPara: "/agendamentos",
    ...dados,
  });
}

function renderizarSerieResultado(dados) {
  return ejs.renderFile(path.join(VIEWS_DIR, "agendamentos", "serie-resultado.ejs"), {
    csrfToken: "token-fake",
    formatarData,
    ...dados,
  });
}

test("agendamentos/novo: tem o checkbox 'Repetir semanalmente' e o campo de quantidade começa escondido", async () => {
  const html = await renderizarNovo();

  assert.match(html, /name="repetir_semanalmente"/);
  assert.match(html, /<label id="quantidade-sessoes-label" hidden>/);
  assert.match(html, /name="quantidade_sessoes"[^>]*min="2"[^>]*max="52"/);
});

test("agendamentos/novo: tem o botão de adicionar datas avulsas (alternativa à repetição semanal)", async () => {
  const html = await renderizarNovo();

  assert.match(html, /id="adicionar-data-avulsa"/);
  assert.match(html, /id="datas-avulsas-lista"/);
});

test("agendamentos/novo: select de convênio do paciente novo lista os convênios recebidos", async () => {
  const html = await renderizarNovo({ convenios: [{ id: 1, nome: "Mar Azul Saúde" }] });

  assert.match(html, /name="paciente_novo_convenio_id"/);
  assert.match(html, /<option value="1">Mar Azul Saúde<\/option>/);
});

test("agendamentos/novo: sem tipoAtendimentoInicial, link 'Voltar' vai pra /agendamentos e nenhuma opção do tipo vem pré-selecionada", async () => {
  const html = await renderizarNovo();

  assert.match(html, /href="\/agendamentos">Voltar<\/a>/);
  assert.doesNotMatch(html, /<option value="psicologia" selected/);
  assert.doesNotMatch(html, /<option value="fisioterapia" selected/);
});

test("agendamentos/novo: com tipoAtendimentoInicial=psicologia, pré-seleciona psicologia e volta pra /psicologia", async () => {
  const html = await renderizarNovo({ tipoAtendimentoInicial: "psicologia", voltarPara: "/psicologia" });

  assert.match(html, /href="\/psicologia">Voltar<\/a>/);
  assert.match(html, /<option value="psicologia" selected>Psicologia<\/option>/);
});

test("agendamentos/serie-resultado: mostra o resumo e cada sessão criada/pulada", async () => {
  const html = await renderizarSerieResultado({
    paciente: { id: 20, nome: "Ana" },
    tipoAtendimento: "fisioterapia",
    resultados: [
      { data: "2026-09-10", hora: "08:00", criado: true, id: 101 },
      { data: "2026-09-17", hora: "08:00", criado: false, motivo: "Esse horário já está lotado — escolha outro." },
    ],
  });

  assert.match(html, /1 de 2 sessão\(ões\) criada\(s\)/);
  assert.match(html, /<span class="badge is-success">Criada<\/span>/);
  assert.match(html, /Pulada — Esse horário já está lotado/);
});

test("agendamentos/serie-resultado: sessão criada tem botão 'Enviar confirmação'; sessão pulada não tem", async () => {
  const html = await renderizarSerieResultado({
    paciente: { id: 20, nome: "Ana" },
    tipoAtendimento: "fisioterapia",
    resultados: [
      { data: "2026-09-10", hora: "08:00", criado: true, id: 101 },
      { data: "2026-09-17", hora: "08:00", criado: false, motivo: "Esse horário já está lotado — escolha outro." },
    ],
  });

  assert.match(html, /action="\/agendamentos\/bot\/101\/confirmar-whatsapp"/);
  assert.equal((html.match(/Enviar confirmação/g) ?? []).length, 1);
});
