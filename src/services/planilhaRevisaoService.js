import ExcelJS from "exceljs";
import { formatarTelefoneExibicao, normalizarTelefone } from "../utils/phone.js";
import { pool } from "../db/pool.js";
import { encontrarOuCriarPaciente } from "../models/pacienteModel.js";
import { aplicarLinhaResolvida } from "./importacaoExcelHistoricoService.js";
import { completarDDI } from "./importacaoLegadoService.js";

/**
 * Gera a planilha que a recepção preenche pra resolver os casos que o
 * matching automático (por nome exato) não conseguiu decidir sozinho —
 * nunca escolhe um candidato por conta própria (ver spec "Escopo").
 */
const CABECALHO_REVISAO = [
  "Nome",
  "Data",
  "Hora",
  "Convenio",
  "Tipo visita",
  "Motivo",
  "Candidatos",
  "decisao",
  "telefone_novo",
  "observacao",
];

export async function gerarPlanilhaRevisao(pendencias, caminhoSaida) {
  const linhas = pendencias.map(({ linha, candidatos = [], motivo }) => ({
    Nome: linha.nome,
    Data: linha.data ?? "",
    Hora: linha.hora ?? "",
    Convenio: linha.categoria ?? "",
    "Tipo visita": linha.tipo ?? "",
    Motivo:
      motivo ??
      (candidatos.length === 0
        ? "nenhum paciente cadastrado com esse nome"
        : `${candidatos.length} pacientes cadastrados com esse nome`),
    Candidatos: candidatos
      .map((c) => `#${c.id} ${c.nome} (${formatarTelefoneExibicao(c.telefone)})`)
      .join(" | "),
    decisao: "",
    telefone_novo: "",
    observacao: "",
  }));

  const workbook = new ExcelJS.Workbook();
  const planilha = workbook.addWorksheet("Revisão");
  planilha.columns = CABECALHO_REVISAO.map((chave) => ({ header: chave, key: chave }));
  planilha.addRows(linhas);
  await workbook.xlsx.writeFile(caminhoSaida);
}

/**
 * Lê a planilha de revisão já preenchida pela recepção e aplica cada
 * decisão. Nunca cria paciente sem telefone informado manualmente —
 * `pacientes.telefone` é `NOT NULL UNIQUE`, essa fonte de dados não traz
 * telefone nenhum (ver spec "Modelo de dados").
 */
function linhasComoObjetos(planilha) {
  let cabecalho = [];
  const linhas = [];
  planilha.eachRow({ includeEmpty: true }, (row, numeroLinha) => {
    const valores = row.values.slice(1);
    if (numeroLinha === 1) {
      cabecalho = valores.map((valor) => String(valor ?? ""));
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

export async function aplicarPlanilhaRevisada(caminhoPlanilha, { aplicar, usuarioImportacaoId }) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(caminhoPlanilha);
  const linhasPlanilha = linhasComoObjetos(workbook.worksheets[0]);

  const eventos = [];
  const naoImportadas = [];

  for (const linhaPlanilha of linhasPlanilha) {
    const decisao = String(linhaPlanilha.decisao ?? "").trim();
    const linha = {
      nome: String(linhaPlanilha.Nome ?? "").trim(),
      data: String(linhaPlanilha.Data ?? "").trim(),
      hora: String(linhaPlanilha.Hora ?? "").trim(),
      categoria: String(linhaPlanilha.Convenio ?? "").trim() || null,
      tipo: String(linhaPlanilha["Tipo visita"] ?? "").trim() || null,
      temFicha: null,
      presenca: null,
    };

    if (!decisao || decisao.toUpperCase() === "IGNORAR") {
      naoImportadas.push({ nome: linha.nome, motivo: "sem decisão da recepção" });
      continue;
    }

    let telefone;
    if (decisao.toUpperCase() === "NOVO") {
      // completarDDI (mesma usada em importacaoLegadoService.js) evita criar
      // um paciente sem "55" — sem isso, o mesmo paciente falando pelo
      // WhatsApp depois (telefone normalizado sempre com DDI) criaria um
      // segundo cadastro duplicado, já que buscarPacientePorTelefone compara
      // string exata.
      const telefoneNovo = completarDDI(normalizarTelefone(String(linhaPlanilha.telefone_novo ?? "")));
      if (!telefoneNovo) {
        naoImportadas.push({ nome: linha.nome, motivo: "NOVO sem telefone informado" });
        continue;
      }
      telefone = telefoneNovo;
      if (aplicar) {
        await encontrarOuCriarPaciente({ nome: linha.nome, telefone, convenio: linha.categoria });
      }
    } else {
      const idPaciente = Number(decisao);
      if (!Number.isInteger(idPaciente)) {
        naoImportadas.push({ nome: linha.nome, motivo: `decisão inválida ("${decisao}")` });
        continue;
      }
      const { rows } = await pool.query("SELECT telefone FROM pacientes WHERE id = $1", [idPaciente]);
      if (!rows[0]) {
        naoImportadas.push({ nome: linha.nome, motivo: `paciente #${idPaciente} não encontrado` });
        continue;
      }
      telefone = rows[0].telefone;
    }

    const resultado = await aplicarLinhaResolvida({ linha, telefone, usuarioImportacaoId }, { aplicar });
    eventos.push(...resultado.eventos);
  }

  return { eventos, naoImportadas };
}
