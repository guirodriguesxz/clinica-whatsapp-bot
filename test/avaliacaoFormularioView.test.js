import { test } from "node:test";
import assert from "node:assert/strict";
import ejs from "ejs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VIEWS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/views");

async function renderizar(dados) {
  return ejs.renderFile(path.join(VIEWS_DIR, "avaliacoes/formulario.ejs"), {
    csrfToken: "token-teste",
    paciente: { id: 7, nome: "Ana Silva" },
    avaliacao: null,
    erro: null,
    acaoForm: "/pacientes/7/avaliacoes/nova",
    ...dados,
  });
}

test("formulario: sem avaliacao, todos os campos vêm vazios e não mostra link de PDF", async () => {
  const html = await renderizar({});

  assert.match(html, /name="data_avaliacao"/);
  assert.match(html, /name="esta_gravida"/);
  assert.match(html, /name="possui_marcapasso"/);
  assert.match(html, /name="possui_protese_metalica_implantes"/);
  assert.match(html, /name="possui_doencas_cardiacas"/);
  assert.match(html, /name="possui_hipertensao_arterial"/);
  assert.match(html, /name="possui_diabetes"/);
  assert.match(html, /name="possui_epilepsia"/);
  assert.match(html, /name="possui_historico_cancer"/);
  assert.match(html, /name="medicamentos_continuos_quais"/);
  assert.match(html, /name="cirurgia_qual"/);
  assert.match(html, /name="cirurgia_quando"/);
  assert.match(html, /name="tempo_ultima_cirurgia"/);
  assert.match(html, /name="dor_atual_local"/);
  assert.match(html, /name="dor_atual_intensidade"/);
  assert.match(html, /name="limitacoes_funcionais_quais"/);
  assert.match(html, /name="fisioterapia_anteriormente"/);
  assert.match(html, /name="objetivos_tratamento"/);
  assert.match(html, /name="condutas_propostas"/);
  assert.doesNotMatch(html, /value="null"/);
  assert.doesNotMatch(html, /\/pdf"/);
});

test("formulario: com avaliacao preenchida, campos vêm pré-preenchidos e mostra link de PDF", async () => {
  const html = await renderizar({
    avaliacao: {
      id: 5, dataAvaliacao: "2026-09-01", estaGravida: "Não", possuiDiabetes: "Sim",
      dorAtualLocal: "Lombar", dorAtualIntensidade: "7", objetivosTratamento: "Reduzir dor",
      condutasPropostas: "Fortalecimento",
    },
    acaoForm: "/pacientes/7/avaliacoes/5/editar",
  });

  assert.match(html, /name="data_avaliacao"[^>]*value="2026-09-01"/);
  assert.match(html, /<select name="possui_diabetes">[\s\S]*?<option value="Sim" selected>Sim<\/option>/);
  assert.match(html, />Reduzir dor</);
  assert.match(html, /href="\/pacientes\/7\/avaliacoes\/5\/pdf"/);
});

test("formulario: mostra mensagem de erro quando presente", async () => {
  const html = await renderizar({ erro: "Data da avaliação inválida." });
  assert.match(html, /Data da avaliação inválida\./);
});
