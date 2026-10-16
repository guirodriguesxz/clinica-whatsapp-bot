import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { parsearArquivoExcel, encontrarCandidatosPaciente, decidirLinha } from "../src/services/importacaoExcelHistoricoService.js";

const CABECALHO_RELATORIO = [
  "NomePaciente",
  "Data",
  "Hora",
  "Tipo visita",
  "Nome convênio",
  "Cadastrou",
  "Confirmou",
  "Ficha",
  "Status Ficha",
];

async function escreverExcelExemplo(caminho, linhas) {
  const workbook = new ExcelJS.Workbook();
  const planilha = workbook.addWorksheet("Relatório");
  planilha.addRow(CABECALHO_RELATORIO);
  for (const linha of linhas) planilha.addRow(linha);
  await workbook.xlsx.writeFile(caminho);
}

test("parsearArquivoExcel extrai linhas reais e mapeia Ficha/Status Ficha", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "importacao-excel-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const caminho = join(dir, "relatorio.xlsx");

  await escreverExcelExemplo(caminho, [
    ["Ana Clara Guabiraba Blumer", "07/07/2026", "09:00", "CP", "Particular", "Fulana", "", "Sim", "agendado e veio"],
    ["Antonia de Lima Gomes Souza", "27/07/2026", "10:30", "F", "Mar Azul Saúde", "Fulana", "", "Não", "agendado e não veio"],
    ["Sem Status", "01/08/2026", "11:00", "CP", "Particular", "Fulana", "", "", ""],
  ]);

  const linhas = await parsearArquivoExcel(caminho);

  assert.equal(linhas.length, 3);
  assert.deepEqual(linhas[0], {
    nome: "Ana Clara Guabiraba Blumer",
    data: "2026-07-07",
    hora: "09:00",
    categoria: "Particular",
    tipo: "CP",
    temFicha: true,
    presenca: "compareceu",
  });
  assert.deepEqual(linhas[1], {
    nome: "Antonia de Lima Gomes Souza",
    data: "2026-07-27",
    hora: "10:30",
    categoria: "Mar Azul Saúde",
    tipo: "F",
    temFicha: false,
    presenca: "faltou",
  });
  assert.equal(linhas[2].temFicha, null);
  assert.equal(linhas[2].presenca, null);
});

test("parsearArquivoExcel ignora linha sem nome de paciente", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "importacao-excel-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const caminho = join(dir, "relatorio.xlsx");

  await escreverExcelExemplo(caminho, [
    ["", "", "", "", "", "", "", "", ""],
    ["Yvone de Fatima de Souza", "01/07/2026", "08:00", "F", "Particular", "Fulana", "", "Sim", "agendado e veio"],
  ]);

  const linhas = await parsearArquivoExcel(caminho);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].nome, "Yvone de Fatima de Souza");
});

test("parsearArquivoExcel lança erro claro se o cabeçalho não bater com o esperado", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "importacao-excel-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const caminho = join(dir, "relatorio-errado.xlsx");

  const workbook = new ExcelJS.Workbook();
  const planilha = workbook.addWorksheet("Relatório");
  planilha.addRow(["Coluna Qualquer"]);
  planilha.addRow(["valor"]);
  await workbook.xlsx.writeFile(caminho);

  await assert.rejects(() => parsearArquivoExcel(caminho), /Coluna "NomePaciente" não encontrada/);
});

// Risco real de trocar a lib: o sistema de agenda anterior pode exportar a coluna Data
// com formatação de data de verdade (célula tipo Date), não só texto
// DD/MM/YYYY — precisa continuar convertendo pro formato YYYY-MM-DD igual ao
// caso de texto (ver converterData em importacaoExcelHistoricoService.js).
test("parsearArquivoExcel converte célula de Data real (não texto) pro formato YYYY-MM-DD", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "importacao-excel-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const caminho = join(dir, "relatorio-data-real.xlsx");

  const workbook = new ExcelJS.Workbook();
  const planilha = workbook.addWorksheet("Relatório");
  planilha.addRow(CABECALHO_RELATORIO);
  const linha = planilha.addRow([
    "Data Real Teste",
    new Date(2026, 6, 7),
    "09:00",
    "CP",
    "Particular",
    "Fulana",
    "",
    "Sim",
    "agendado e veio",
  ]);
  linha.getCell(2).numFmt = "dd/mm/yyyy";
  await workbook.xlsx.writeFile(caminho);

  const linhas = await parsearArquivoExcel(caminho);
  assert.equal(linhas[0].data, "2026-07-07");
});

function linhaValidaExemplo(sobrescreve = {}) {
  return {
    nome: "João da Silva",
    data: "2026-07-07",
    hora: "09:00",
    categoria: "Particular",
    tipo: "CP",
    temFicha: null,
    presenca: null,
    ...sobrescreve,
  };
}

test("encontrarCandidatosPaciente compara nome normalizado (acento/caixa)", () => {
  const pacientes = [
    { id: 1, nome: "João da Silva", telefone: "5511999990001" },
    { id: 2, nome: "Maria Souza", telefone: "5511999990002" },
  ];
  assert.deepEqual(encontrarCandidatosPaciente("joao da silva", pacientes), [pacientes[0]]);
  assert.deepEqual(encontrarCandidatosPaciente("Joana Pereira", pacientes), []);
});

test("encontrarCandidatosPaciente retorna todos os homônimos", () => {
  const pacientes = [
    { id: 1, nome: "Ana Clara", telefone: "5511999990001" },
    { id: 2, nome: "ana clara", telefone: "5511999990002" },
  ];
  assert.equal(encontrarCandidatosPaciente("Ana Clara", pacientes).length, 2);
});

test("decidirLinha: nome único → auto_vinculo", () => {
  const pacientes = [{ id: 1, nome: "João da Silva", telefone: "5511999990001" }];
  const decisao = decidirLinha(linhaValidaExemplo(), pacientes);
  assert.equal(decisao.tipo, "auto_vinculo");
  assert.equal(decisao.paciente.id, 1);
});

test("decidirLinha: nome ambíguo → revisao com candidatos", () => {
  const pacientes = [
    { id: 1, nome: "João da Silva", telefone: "5511999990001" },
    { id: 2, nome: "João da Silva", telefone: "5511999990002" },
  ];
  const decisao = decidirLinha(linhaValidaExemplo(), pacientes);
  assert.equal(decisao.tipo, "revisao");
  assert.equal(decisao.candidatos.length, 2);
});

test("decidirLinha: sem match → revisao com lista vazia de candidatos", () => {
  const decisao = decidirLinha(linhaValidaExemplo({ nome: "Ninguém Cadastrado" }), []);
  assert.equal(decisao.tipo, "revisao");
  assert.deepEqual(decisao.candidatos, []);
});

test("decidirLinha: hora inválida → divergência, não chega a comparar nome", () => {
  const decisao = decidirLinha(linhaValidaExemplo({ hora: "25:99" }), []);
  assert.deepEqual(decisao, {
    tipo: "divergencia",
    motivo: 'hora inválida ("25:99")',
    linha: linhaValidaExemplo({ hora: "25:99" }),
  });
});

test("decidirLinha: data ausente/inválida → divergência", () => {
  const decisao = decidirLinha(linhaValidaExemplo({ data: null }), []);
  assert.deepEqual(decisao, {
    tipo: "divergencia",
    motivo: "data inválida",
    linha: linhaValidaExemplo({ data: null }),
  });
});

test("buscarTodosPacientes consulta id/nome/telefone de todos os pacientes", async (t) => {
  const { pool } = await import("../src/db/pool.js");
  const { buscarTodosPacientes } = await import("../src/services/importacaoExcelHistoricoService.js");
  t.mock.method(pool, "query", async (sql) => {
    assert.match(sql, /SELECT id, nome, telefone FROM pacientes/);
    return { rows: [{ id: 1, nome: "João da Silva", telefone: "5511999990001" }] };
  });

  const pacientes = await buscarTodosPacientes();
  assert.deepEqual(pacientes, [{ id: 1, nome: "João da Silva", telefone: "5511999990001" }]);
});

import { aplicarLinhaResolvida } from "../src/services/importacaoExcelHistoricoService.js";

function linhaResolvidaExemplo(sobrescreve = {}) {
  return {
    nome: "Ana Clara Guabiraba Blumer",
    // Data fixa no passado, independente de quando o teste rodar de verdade.
    data: "2020-07-07",
    hora: "09:00",
    categoria: "Particular",
    tipo: "CP",
    temFicha: true,
    presenca: "compareceu",
    ...sobrescreve,
  };
}

test("aplicarLinhaResolvida: linha nova no passado, --aplicar grava agendamento e presença", async (t) => {
  const { pool } = await import("../src/db/pool.js");
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("SELECT id FROM agendamentos_importados")) return { rows: [] };
    if (sql.includes("INSERT INTO agendamentos_importados")) return { rows: [{ id: 77 }] };
    if (sql.includes("SELECT id, status")) return { rows: [{ id: 77, status: "confirmado" }] };
    return { rows: [] };
  });
  t.mock.method(pool, "connect", async () => ({
    query: async (sql, params) => {
      chamadas.push({ sql, params });
      if (sql.includes("UPDATE agendamentos_importados")) return { rowCount: 1 };
      if (sql.includes("INSERT INTO registros_atendimento")) return { rows: [{ id: 1, presenca: "compareceu" }] };
      return {};
    },
    release: () => {},
  }));

  const resultado = await aplicarLinhaResolvida(
    { linha: linhaResolvidaExemplo(), telefone: "5511999990001", usuarioImportacaoId: 9 },
    { aplicar: true }
  );

  assert.deepEqual(
    resultado.eventos.map((e) => e.tipo),
    ["agendamento_novo", "presenca_registrada"]
  );

  const insert = chamadas.find((c) => c.sql.includes("INSERT INTO agendamentos_importados"));
  assert.deepEqual(insert.params, [
    "5511999990001",
    "Ana Clara Guabiraba Blumer",
    "2020-07-07",
    "09:00",
    "Particular",
    "CP",
    true,
  ]);
});

test("aplicarLinhaResolvida: data futura preenche lembrete_24h_enviado_em no próprio insert", async (t) => {
  const { pool } = await import("../src/db/pool.js");
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("SELECT id FROM agendamentos_importados")) return { rows: [] };
    if (sql.includes("INSERT INTO agendamentos_importados")) return { rows: [{ id: 78 }] };
    return { rows: [] };
  });

  await aplicarLinhaResolvida(
    { linha: linhaResolvidaExemplo({ data: "2099-01-01", presenca: null }), telefone: "5511999990001", usuarioImportacaoId: 9 },
    { aplicar: true }
  );

  const insert = chamadas.find((c) => c.sql.includes("INSERT INTO agendamentos_importados"));
  assert.ok(
    insert.sql.includes(
      "CASE WHEN $3::date > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN now() ELSE NULL END"
    ),
    "a supressão de lembrete precisa acontecer no próprio INSERT, sem passo separado (ver spec)"
  );
});

test("aplicarLinhaResolvida: dry-run não grava nada", async (t) => {
  const { pool } = await import("../src/db/pool.js");
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("SELECT id FROM agendamentos_importados")) return { rows: [] };
    return { rows: [] };
  });

  const resultado = await aplicarLinhaResolvida(
    { linha: linhaResolvidaExemplo(), telefone: "5511999990001", usuarioImportacaoId: 9 },
    { aplicar: false }
  );

  assert.deepEqual(resultado.eventos.map((e) => e.tipo), ["agendamento_novo"]);
  assert.ok(chamadas.every((c) => c.sql.trim().toUpperCase().startsWith("SELECT")));
});

test("aplicarLinhaResolvida: agendamento já existe → não insere de novo, mas ainda registra presença", async (t) => {
  const { pool } = await import("../src/db/pool.js");
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("SELECT id FROM agendamentos_importados")) return { rows: [{ id: 55 }] };
    if (sql.includes("SELECT id, status")) return { rows: [{ id: 55, status: "confirmado" }] };
    return { rows: [] };
  });
  t.mock.method(pool, "connect", async () => ({
    query: async (sql, params) => {
      chamadas.push({ sql, params });
      if (sql.includes("UPDATE agendamentos_importados")) return { rowCount: 1 };
      if (sql.includes("INSERT INTO registros_atendimento")) return { rows: [{ id: 2, presenca: "compareceu" }] };
      return {};
    },
    release: () => {},
  }));

  const resultado = await aplicarLinhaResolvida(
    { linha: linhaResolvidaExemplo(), telefone: "5511999990001", usuarioImportacaoId: 9 },
    { aplicar: true }
  );

  assert.deepEqual(resultado.eventos.map((e) => e.tipo), ["agendamento_ja_existe", "presenca_registrada"]);
  assert.ok(!chamadas.some((c) => c.sql.includes("INSERT INTO agendamentos_importados")));
});

test("aplicarLinhaResolvida: verificação de duplicidade normaliza telefone igual ao índice único", async (t) => {
  const { pool } = await import("../src/db/pool.js");
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("SELECT id FROM agendamentos_importados")) return { rows: [] };
    if (sql.includes("INSERT INTO agendamentos_importados")) return { rows: [{ id: 77 }] };
    return { rows: [] };
  });

  await aplicarLinhaResolvida(
    { linha: linhaResolvidaExemplo(), telefone: "5511999990001", usuarioImportacaoId: 9 },
    { aplicar: true }
  );

  const consultaDuplicidade = chamadas.find((c) => c.sql.includes("SELECT id FROM agendamentos_importados"));
  // Precisa comparar por regexp_replace dos dois lados, igual ao índice único
  // idx_agendamentos_importados_unico (migration 010) e ao ON CONFLICT do
  // INSERT — comparar string exata deixaria passar um "duplicado" que só
  // difere em formatação, caindo no ON CONFLICT DO NOTHING sem gerar id e
  // perdendo o registro de presença silenciosamente.
  assert.match(
    consultaDuplicidade.sql,
    /regexp_replace\(telefone, '\\D', '', 'g'\) = regexp_replace\(\$1, '\\D', '', 'g'\)/
  );
});

test("aplicarLinhaResolvida: sem presença informada não chama registrarPresencaImportado", async (t) => {
  const { pool } = await import("../src/db/pool.js");
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("SELECT id FROM agendamentos_importados")) return { rows: [] };
    if (sql.includes("INSERT INTO agendamentos_importados")) return { rows: [{ id: 80 }] };
    return { rows: [] };
  });

  const resultado = await aplicarLinhaResolvida(
    { linha: linhaResolvidaExemplo({ presenca: null }), telefone: "5511999990001", usuarioImportacaoId: 9 },
    { aplicar: true }
  );

  assert.deepEqual(resultado.eventos.map((e) => e.tipo), ["agendamento_novo"]);
  assert.ok(!chamadas.some((c) => c.sql.includes("INSERT INTO registros_atendimento")));
});
