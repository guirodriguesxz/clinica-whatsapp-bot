// test/fichaPacienteView.test.js
//
// Renderiza pacientes/ficha.ejs diretamente (sem controller/app), mesmo
// padrão de test/presencaViews.test.js — pega bug de view que ficaria
// escondido atrás de um mock que só confere res.dadosDaView.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";
import { formatarDataHora, formatarData } from "../src/utils/data.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.join(__dirname, "..", "src", "views");

const PACIENTE = { id: 7, nome: "Ana Silva", telefone: "5511999999999", convenio: "Particular", created_at: "2026-01-01" };
const ADMINISTRADORA = { id: 1, nome: "Ana", papel: "administradora" };
const RECEPCAO = { id: 2, nome: "Amanda", papel: "recepcao" };

function renderizar(dados) {
  const caminho = path.join(VIEWS_DIR, "pacientes", "ficha.ejs");
  return ejs.renderFile(caminho, {
    paciente: PACIENTE,
    historico: [],
    pacotes: [],
    avaliacoes: [],
    relatorios: [],
    idade: null,
    csrfToken: "token-fake",
    usuarioAtual: ADMINISTRADORA,
    formatarDataHora,
    formatarData,
    ...dados,
  });
}

test("ficha: sem pacotes, mostra o formulário de criar pacote e nenhum pacote ativo", async () => {
  const html = await renderizar({ pacotes: [] });

  assert.match(html, /Criar pacote/);
  assert.doesNotMatch(html, /Pacote atual/);
});

test("ficha: pacote ativo mostra contagem de sessões usadas", async () => {
  const html = await renderizar({
    pacotes: [{ id: 10, quantidade_total: 10, cancelado: false, created_at: "2026-09-01", quantidade_usada: 3 }],
  });

  assert.match(html, /Pacote atual/);
  assert.match(html, /3 de 10/);
});

test("ficha: pacote esgotado (usada = total) aparece como esgotado, não como ativo", async () => {
  const html = await renderizar({
    pacotes: [{ id: 10, quantidade_total: 10, cancelado: false, created_at: "2026-09-01", quantidade_usada: 10 }],
  });

  assert.doesNotMatch(html, /Pacote atual/);
  assert.match(html, /esgotado/i);
});

test("ficha: pacote ativo único não aparece duplicado na tabela de histórico", async () => {
  const html = await renderizar({
    pacotes: [{ id: 10, quantidade_total: 10, cancelado: false, created_at: "2026-09-01", quantidade_usada: 3 }],
  });

  // "Histórico de pacotes" é só pra pacotes ANTERIORES — com um único
  // pacote (o atual), não deve haver nenhuma seção de histórico pra
  // duplicar a mesma informação já mostrada no resumo "Pacote atual".
  assert.doesNotMatch(html, /Histórico de pacotes/);
});

test("ficha: histórico de pacotes mostra só os anteriores, sem duplicar o pacote atual", async () => {
  const pacoteAtual = { id: 10, quantidade_total: 10, cancelado: false, created_at: "2026-09-01", quantidade_usada: 3 };
  const pacoteCancelado = { id: 5, quantidade_total: 8, cancelado: true, created_at: "2026-08-01", quantidade_usada: 2 };
  const html = await renderizar({ pacotes: [pacoteAtual, pacoteCancelado] });

  assert.match(html, /Histórico de pacotes/);
  assert.match(html, /2 de 8/);
  const ocorrenciasPacoteAtual = (html.match(/3 de 10/g) || []).length;
  assert.equal(
    ocorrenciasPacoteAtual,
    1,
    "pacote atual deve aparecer só no resumo (Pacote atual), não também na tabela de histórico"
  );
});

test("ficha: botão cancelar pacote aparece pra administradora mas não pra recepção", async () => {
  const pacotes = [{ id: 10, quantidade_total: 10, cancelado: false, created_at: "2026-09-01", quantidade_usada: 3 }];

  const htmlAdministradora = await renderizar({ pacotes, usuarioAtual: ADMINISTRADORA });
  const htmlRecepcao = await renderizar({ pacotes, usuarioAtual: RECEPCAO });

  assert.match(htmlAdministradora, /Cancelar pacote/);
  assert.doesNotMatch(htmlRecepcao, /Cancelar pacote/);
});

test("ficha apresenta resumo, pacote atual e histórico na mesma visão", async () => {
  const html = await renderizar({
    pacotes: [{ id: 3, quantidade_usada: 6, quantidade_total: 10, cancelado: false }],
  });

  assert.match(html, /class="[^"]*dados-paciente/);
  assert.match(html, /class="[^"]*session-package/);
  assert.match(html, /class="[^"]*progress-meter/);
  assert.match(html, /class="[^"]*patient-history/);
  assert.doesNotMatch(html, /role="tab"/);
});

test("ficha: mostra os dados cadastrais preenchidos", async () => {
  const paciente = {
    ...PACIENTE,
    cpf: "111.111.111-11",
    rg: "22.222.222-2",
    data_nascimento: "1990-05-20",
    sexo: "F",
    endereco: "Rua Teste",
    numero: "123",
    bairro: "Centro",
    cidade: "São Paulo",
    uf: "SP",
    cep: "01000-000",
    estado_civil: "Solteira",
    profissao: "Professora",
    email: "ana@example.com",
    matricula_convenio: "999888777",
    cns: "700123456789012",
  };
  const html = await renderizar({ paciente, idade: 36 });

  assert.match(html, /111\.111\.111-11/);
  assert.match(html, /22\.222\.222-2/);
  assert.match(html, /700123456789012/);
  assert.match(html, /20\/05\/1990/);
  assert.match(html, /36 anos/);
  assert.match(html, /Rua Teste/);
  assert.match(html, /Solteira/);
  assert.match(html, /Professora/);
  assert.match(html, /ana@example\.com/);
  assert.match(html, /999888777/);
  assert.match(html, /Ana Exemplo/);
});

test("ficha: campos cadastrais em branco não mostram 'Não informado'", async () => {
  const html = await renderizar({ paciente: PACIENTE, idade: null });

  assert.doesNotMatch(html, /Não informado/);
});

test("ficha: link para editar dados cadastrais está presente", async () => {
  const html = await renderizar({});
  assert.match(html, /href="\/pacientes\/7\/editar"/);
});

test("ficha: botão excluir paciente aparece pra administradora mesmo com histórico (o banco que bloqueia se precisar), some pra recepção", async () => {
  const semHistorico = await renderizar({ historico: [], pacotes: [], usuarioAtual: ADMINISTRADORA });
  assert.match(semHistorico, /Excluir paciente/);
  assert.match(semHistorico, /action="\/pacientes\/7\/excluir"/);

  const recepcaoSemHistorico = await renderizar({ historico: [], pacotes: [], usuarioAtual: RECEPCAO });
  assert.doesNotMatch(recepcaoSemHistorico, /Excluir paciente/);

  const comHistoricoAgendamento = await renderizar({
    historico: [{ data: "2026-08-20", hora: "10:00", tipo_atendimento: "fisioterapia", status: "confirmado" }],
    pacotes: [],
    usuarioAtual: ADMINISTRADORA,
  });
  assert.match(comHistoricoAgendamento, /Excluir paciente/);

  const comHistoricoPacote = await renderizar({
    historico: [],
    pacotes: [{ id: 10, quantidade_total: 10, cancelado: false, created_at: "2026-09-01", quantidade_usada: 3 }],
    usuarioAtual: ADMINISTRADORA,
  });
  assert.match(comHistoricoPacote, /Excluir paciente/);
});

test("ficha: sem avaliações, mostra mensagem de nenhuma avaliação registrada", async () => {
  const html = await renderizar({ avaliacoes: [] });

  assert.match(html, /Nenhuma avaliação registrada/);
  assert.match(html, /href="\/pacientes\/7\/avaliacoes\/nova"/);
});

test("ficha: com avaliações, lista cada uma com data e link de editar", async () => {
  const html = await renderizar({
    avaliacoes: [{ id: 3, dataAvaliacao: "2026-09-01" }, { id: 1, dataAvaliacao: "2026-01-10" }],
  });

  assert.match(html, /href="\/pacientes\/7\/avaliacoes\/3\/editar"/);
  assert.match(html, /href="\/pacientes\/7\/avaliacoes\/1\/editar"/);
  assert.doesNotMatch(html, /Nenhuma avaliação registrada/);
});
