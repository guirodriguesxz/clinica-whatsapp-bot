import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { gerarPlanilhaRevisao, aplicarPlanilhaRevisada } from "../src/services/planilhaRevisaoService.js";

async function lerPlanilhaComoObjetos(caminho) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(caminho);
  const planilha = workbook.worksheets[0];

  let cabecalho = [];
  const linhas = [];
  planilha.eachRow({ includeEmpty: true }, (row, numeroLinha) => {
    const valores = row.values.slice(1);
    if (numeroLinha === 1) {
      cabecalho = valores.map((v) => String(v ?? ""));
      return;
    }
    const objeto = {};
    cabecalho.forEach((chave, i) => {
      objeto[chave] = valores[i] ?? "";
    });
    linhas.push(objeto);
  });
  return linhas;
}

test("gerarPlanilhaRevisao escreve uma linha por pendência, com candidatos formatados", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "planilha-revisao-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const caminho = join(dir, "revisao.xlsx");

  await gerarPlanilhaRevisao(
    [
      {
        linha: { nome: "Ana Clara", data: "2026-07-07", hora: "09:00", categoria: "Particular", tipo: "CP" },
        candidatos: [
          { id: 1, nome: "Ana Clara", telefone: "5511999990001" },
          { id: 2, nome: "Ana Clara", telefone: "5511999990002" },
        ],
      },
      {
        linha: { nome: "Paciente Novo", data: "2026-07-08", hora: "10:00", categoria: null, tipo: "F" },
        candidatos: [],
      },
    ],
    caminho
  );

  const linhas = await lerPlanilhaComoObjetos(caminho);

  assert.equal(linhas.length, 2);
  assert.equal(linhas[0].Nome, "Ana Clara");
  assert.match(linhas[0].Candidatos, /#1 Ana Clara/);
  assert.match(linhas[0].Candidatos, /#2 Ana Clara/);
  assert.equal(linhas[0].Motivo, "2 pacientes cadastrados com esse nome");
  assert.equal(linhas[1].Motivo, "nenhum paciente cadastrado com esse nome");
  assert.equal(linhas[0].decisao, "");
  assert.equal(linhas[0].telefone_novo, "");
});

async function escreverPlanilhaRevisada(caminho, linhas) {
  const workbook = new ExcelJS.Workbook();
  const planilha = workbook.addWorksheet("Revisão");
  if (linhas.length > 0) {
    planilha.columns = Object.keys(linhas[0]).map((chave) => ({ header: chave, key: chave }));
    planilha.addRows(linhas);
  }
  await workbook.xlsx.writeFile(caminho);
}

test("aplicarPlanilhaRevisada: decisão com ID existente vincula ao paciente já cadastrado", async (t) => {
  const { pool } = await import("../src/db/pool.js");
  const dir = await mkdtemp(join(tmpdir(), "planilha-aplicada-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const caminho = join(dir, "revisao.xlsx");

  await escreverPlanilhaRevisada(caminho, [
    {
      Nome: "Ana Clara",
      Data: "2020-07-07",
      Hora: "09:00",
      Convenio: "Particular",
      "Tipo visita": "CP",
      decisao: "5",
      telefone_novo: "",
      observacao: "",
    },
  ]);

  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("SELECT telefone FROM pacientes")) return { rows: [{ telefone: "5511999990009" }] };
    if (sql.includes("SELECT id FROM agendamentos_importados")) return { rows: [] };
    if (sql.includes("INSERT INTO agendamentos_importados")) return { rows: [{ id: 90 }] };
    return { rows: [] };
  });

  const resultado = await aplicarPlanilhaRevisada(caminho, { aplicar: true, usuarioImportacaoId: 9 });

  assert.deepEqual(resultado.eventos.map((e) => e.tipo), ["agendamento_novo"]);
  const insert = chamadas.find((c) => c.sql.includes("INSERT INTO agendamentos_importados"));
  assert.equal(insert.params[0], "5511999990009");
});

test("aplicarPlanilhaRevisada: decisão NOVO com telefone cria paciente e agendamento", async (t) => {
  const { pool } = await import("../src/db/pool.js");
  const dir = await mkdtemp(join(tmpdir(), "planilha-aplicada-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const caminho = join(dir, "revisao.xlsx");

  await escreverPlanilhaRevisada(caminho, [
    {
      Nome: "Paciente Novo De Verdade",
      Data: "2020-07-07",
      Hora: "09:00",
      Convenio: "Particular",
      "Tipo visita": "CP",
      decisao: "NOVO",
      telefone_novo: "11988887777",
      observacao: "",
    },
  ]);

  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("SELECT * FROM pacientes WHERE telefone")) return { rows: [] };
    if (sql.includes("INSERT INTO pacientes")) {
      return { rows: [{ id: 200, nome: "Paciente Novo De Verdade", telefone: "11988887777" }] };
    }
    if (sql.includes("SELECT id FROM agendamentos_importados")) return { rows: [] };
    if (sql.includes("INSERT INTO agendamentos_importados")) return { rows: [{ id: 91 }] };
    return { rows: [] };
  });

  const resultado = await aplicarPlanilhaRevisada(caminho, { aplicar: true, usuarioImportacaoId: 9 });

  assert.deepEqual(resultado.eventos.map((e) => e.tipo), ["agendamento_novo"]);
  const insertPaciente = chamadas.find((c) => c.sql.includes("INSERT INTO pacientes"));
  assert.ok(insertPaciente, "deveria ter criado o paciente novo");
  // completarDDI: "11988887777" (11 dígitos, sem DDI) precisa virar
  // "5511988887777" — sem isso, o mesmo paciente falando pelo WhatsApp
  // depois (telefone sempre normalizado com DDI) criaria um segundo
  // cadastro duplicado em vez de casar com este.
  assert.equal(insertPaciente.params[1], "5511988887777");
});

test("aplicarPlanilhaRevisada: NOVO sem telefone não grava nada, entra em naoImportadas", async (t) => {
  const { pool } = await import("../src/db/pool.js");
  const dir = await mkdtemp(join(tmpdir(), "planilha-aplicada-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const caminho = join(dir, "revisao.xlsx");

  await escreverPlanilhaRevisada(caminho, [
    { Nome: "Sem Telefone", Data: "2020-07-07", Hora: "09:00", Convenio: "", "Tipo visita": "", decisao: "NOVO", telefone_novo: "", observacao: "" },
  ]);

  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [] };
  });

  const resultado = await aplicarPlanilhaRevisada(caminho, { aplicar: true, usuarioImportacaoId: 9 });

  assert.equal(chamadas.length, 0);
  assert.deepEqual(resultado.naoImportadas, [{ nome: "Sem Telefone", motivo: "NOVO sem telefone informado" }]);
});

test("aplicarPlanilhaRevisada: decisão em branco ou IGNORAR não grava nada", async (t) => {
  const { pool } = await import("../src/db/pool.js");
  const dir = await mkdtemp(join(tmpdir(), "planilha-aplicada-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const caminho = join(dir, "revisao.xlsx");

  await escreverPlanilhaRevisada(caminho, [
    { Nome: "Ignorado", Data: "2020-07-07", Hora: "09:00", Convenio: "", "Tipo visita": "", decisao: "IGNORAR", telefone_novo: "", observacao: "" },
    { Nome: "Em Branco", Data: "2020-07-07", Hora: "09:00", Convenio: "", "Tipo visita": "", decisao: "", telefone_novo: "", observacao: "" },
  ]);

  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [] };
  });

  const resultado = await aplicarPlanilhaRevisada(caminho, { aplicar: true, usuarioImportacaoId: 9 });

  assert.equal(chamadas.length, 0);
  assert.equal(resultado.naoImportadas.length, 2);
});
