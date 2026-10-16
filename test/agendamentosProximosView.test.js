// test/agendamentosProximosView.test.js
//
// Renderiza agendamentos/proximos.ejs diretamente (sem controller/app) —
// mesma técnica de agendamentosListaView.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";
import { formatarDataHora, formatarDataExtensa, formatarDataComDiaSemana } from "../src/utils/data.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.join(__dirname, "..", "src", "views");

const FILTROS_VAZIOS = { status: "", tipo_atendimento: "", busca: "", periodo: "", psicologo_id: "", origem: "", avaliacao: "" };

function renderizar(dados) {
  const caminho = path.join(VIEWS_DIR, "agendamentos", "proximos.ejs");
  return ejs.renderFile(caminho, {
    csrfToken: "token-fake",
    filtros: FILTROS_VAZIOS,
    psicologos: [],
    itens: [],
    tipoFixo: null,
    formatarDataHora,
    formatarDataExtensa,
    formatarDataComDiaSemana,
    mensagemWhatsapp: null,
    mensagemPresenca: null,
    ...dados,
  });
}

test("agendamentos/proximos: sem filtro de data, agrupa itens por dia e período", async () => {
  const html = await renderizar({
    itens: [
      { id: 1, origem: "bot", status: "confirmado", ja_passou: false, data: "2026-09-10", hora: "08:00:00", paciente_nome: "Ana", tipo_atendimento: "fisioterapia" },
      { id: 2, origem: "bot", status: "confirmado", ja_passou: false, data: "2026-09-11", hora: "14:00:00", paciente_nome: "Bruno", tipo_atendimento: "fisioterapia" },
    ],
  });

  assert.match(html, /agenda-day-header[^>]*>[\s\S]*?Quinta-feira, 10 de setembro/);
  assert.match(html, /agenda-day-header[^>]*>[\s\S]*?Sexta-feira, 11 de setembro/);
  assert.equal((html.match(/class="agenda-day-header/g) ?? []).length, 2);
});

test("agendamentos/proximos: não tem filtro de data nem calendário 'Ver dia' (tela é sempre 'hoje pra frente')", async () => {
  const html = await renderizar({ itens: [] });

  assert.doesNotMatch(html, /name="data"/);
  assert.doesNotMatch(html, /Ver dia/);
});

test("agendamentos/proximos: não tem paginação (janela ampla numa página só)", async () => {
  const html = await renderizar({ itens: [] });

  assert.doesNotMatch(html, /class="paginacao/);
});

test("agendamentos/proximos: item com paciente_id mostra o botão de imprimir ficha", async () => {
  const html = await renderizar({
    itens: [
      { id: 1, origem: "bot", status: "confirmado", ja_passou: false, data: "2026-09-20", hora: "08:00:00", paciente_id: 42, paciente_nome: "Ana", tipo_atendimento: "fisioterapia" },
    ],
  });

  assert.match(html, /href="\/pacientes\/42\/ficha\?imprimir=1"[^>]*target="_blank"[^>]*>🖨️ Ficha</);
});

test("agendamentos/proximos: item importado (sem paciente_id) não mostra o botão de imprimir ficha", async () => {
  const html = await renderizar({
    itens: [
      { id: 1, origem: "importado", status: "confirmado", ja_passou: false, data: "2026-09-20", hora: "08:00:00", paciente_id: null, paciente_nome: "Ana", tipo_atendimento: "fisioterapia" },
    ],
  });

  assert.doesNotMatch(html, /🖨️ Ficha/);
});

test("agendamentos/proximos: sem tipoFixo, mostra o filtro 'Tipo' e usa /agendamentos/proximos nos links de navegação", async () => {
  const html = await renderizar({ itens: [] });

  assert.match(html, /Tipo\s*<select name="tipo_atendimento">/);
  assert.match(html, /<form class="filter-bar screen-only" method="get" action="\/agendamentos\/proximos">/);
  assert.match(html, /<a class="button button--quiet" href="\/agendamentos\/proximos">Limpar filtros<\/a>/);
  assert.match(html, /<a class="button screen-only" href="\/agendamentos\/novo">\+ Novo agendamento<\/a>/);
});

test("agendamentos/proximos: com tipoFixo=psicologia, esconde o filtro 'Tipo' e usa /psicologia/proximos nos links de navegação", async () => {
  const html = await renderizar({ itens: [], tipoFixo: "psicologia" });

  assert.doesNotMatch(html, /Tipo\s*<select name="tipo_atendimento">/);
  assert.match(html, /<form class="filter-bar screen-only" method="get" action="\/psicologia\/proximos">/);
  assert.match(html, /<a class="button button--quiet" href="\/psicologia\/proximos">Limpar filtros<\/a>/);
  assert.match(html, /<a class="button screen-only" href="\/agendamentos\/novo\?tipo_atendimento=psicologia">\+ Novo agendamento<\/a>/);
});

test("agendamentos/proximos: mantém os filtros de status/tipo/período/psicóloga/busca apontando pra própria rota", async () => {
  const html = await renderizar({
    filtros: { status: "confirmado", tipo_atendimento: "psicologia", busca: "Ana", periodo: "tarde", psicologo_id: "" },
  });

  assert.match(html, /<form class="filter-bar screen-only" method="get" action="\/agendamentos\/proximos">/);
  assert.match(html, /<option value="confirmado" selected>Confirmado<\/option>/);
});

test("agendamentos/proximos: filtro de origem marca a opção selecionada", async () => {
  const html = await renderizar({ filtros: { ...FILTROS_VAZIOS, origem: "importado" } });

  assert.match(html, /<option value="importado" selected>Importado<\/option>/);
});

test("agendamentos/proximos: filtro de avaliação marca a opção selecionada", async () => {
  const html = await renderizar({ filtros: { ...FILTROS_VAZIOS, avaliacao: "retorno" } });

  assert.match(html, /<option value="retorno" selected>Retorno<\/option>/);
});

test("agendamentos/proximos: ?whatsapp=enviado mostra mensagem de sucesso vinda do controller", async () => {
  const html = await renderizar({ mensagemWhatsapp: "Confirmação enviada por WhatsApp." });

  assert.match(html, /<p class="sucesso">Confirmação enviada por WhatsApp\.<\/p>/);
});

test("agendamentos/proximos: formulário de confirmar por WhatsApp manda retorno=proximos", async () => {
  const html = await renderizar({
    itens: [
      { id: 5, origem: "bot", status: "confirmado", ja_passou: false, data: "2026-09-10", hora: "08:00:00", paciente_nome: "Ana", tipo_atendimento: "fisioterapia" },
    ],
  });

  assert.match(
    html,
    /confirmar-whatsapp">[\s\S]*?<input type="hidden" name="retorno" value="proximos" \/>/
  );
});
