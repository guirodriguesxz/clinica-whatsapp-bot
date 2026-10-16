import ExcelJS from "exceljs";
import { normalizarTexto } from "./importacaoLegadoService.js";
import { pool } from "../db/pool.js";
import { registrarPresencaImportado } from "../models/registroAtendimentoModel.js";
import { HOJE_SQL } from "../utils/sqlAgenda.js";

const COLUNAS_ESPERADAS = {
  nome: "NomePaciente",
  data: "Data",
  hora: "Hora",
  tipo: "Tipo visita",
  categoria: "Nome convênio",
  ficha: "Ficha",
  statusFicha: "Status Ficha",
};

function mapearIndiceColunas(cabecalho) {
  const indice = {};
  for (const [chave, rotulo] of Object.entries(COLUNAS_ESPERADAS)) {
    const posicao = cabecalho.findIndex(
      (valor) => normalizarTexto(String(valor ?? "")) === normalizarTexto(rotulo)
    );
    if (posicao === -1) {
      throw new Error(`Coluna "${rotulo}" não encontrada no cabeçalho do relatório Excel`);
    }
    indice[chave] = posicao;
  }
  return indice;
}

// A célula de data pode vir como Date real (se o Excel tiver formatação de
// data aplicada) ou como texto "DD/MM/YYYY" (comum quando o arquivo veio de
// conversão PDF→Excel, sem formatação real de célula) — trata os dois.
function converterData(valor) {
  if (valor instanceof Date) {
    const ano = valor.getFullYear();
    const mes = String(valor.getMonth() + 1).padStart(2, "0");
    const dia = String(valor.getDate()).padStart(2, "0");
    return `${ano}-${mes}-${dia}`;
  }
  const texto = String(valor ?? "").trim();
  const match = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, dia, mes, ano] = match;
  return `${ano}-${mes}-${dia}`;
}

function converterHora(valor) {
  if (valor instanceof Date) {
    const horas = String(valor.getHours()).padStart(2, "0");
    const minutos = String(valor.getMinutes()).padStart(2, "0");
    return `${horas}:${minutos}`;
  }
  return String(valor ?? "").trim();
}

function mapearTemFicha(valor) {
  const texto = normalizarTexto(String(valor ?? ""));
  if (texto === "sim") return true;
  if (texto === "nao") return false;
  return null;
}

// Checa "não veio" ANTES de "veio" de propósito — "agendado e não veio"
// contém a substring "veio" também, então a ordem inverte o resultado se
// trocada.
function mapearPresenca(valor) {
  const texto = normalizarTexto(String(valor ?? ""));
  if (texto.includes("nao veio")) return "faltou";
  if (texto.includes("veio")) return "compareceu";
  return null;
}

/**
 * Faz o parse do relatório histórico em Excel (.xlsx) que a clínica
 * conseguiu exportar em vez do XML esperado (ver spec) — sem
 * telefone/CPF/atendente, mas com presença (`Status Ficha`) que o formato
 * XML da migração anterior nunca teve.
 */
export async function parsearArquivoExcel(caminhoArquivo) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(caminhoArquivo);
  const planilha = workbook.worksheets[0];

  const linhasBrutas = [];
  planilha.eachRow({ includeEmpty: true }, (row) => {
    linhasBrutas.push(row.values.slice(1));
  });

  const [cabecalho, ...linhasDados] = linhasBrutas;
  const indice = mapearIndiceColunas(cabecalho);

  return linhasDados
    .filter((linha) => String(linha[indice.nome] ?? "").trim() !== "")
    .map((linha) => ({
      nome: String(linha[indice.nome]).trim(),
      data: converterData(linha[indice.data]),
      hora: converterHora(linha[indice.hora]),
      categoria: String(linha[indice.categoria] ?? "").trim() || null,
      tipo: String(linha[indice.tipo] ?? "").trim() || null,
      temFicha: mapearTemFicha(linha[indice.ficha]),
      presenca: mapearPresenca(linha[indice.statusFicha]),
    }));
}

const REGEX_HORA_VALIDA = /^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;

export async function buscarTodosPacientes() {
  const { rows } = await pool.query("SELECT id, nome, telefone FROM pacientes");
  return rows;
}

export function encontrarCandidatosPaciente(nomeBuscado, pacientes) {
  const alvo = normalizarTexto(nomeBuscado);
  return pacientes.filter((paciente) => normalizarTexto(paciente.nome) === alvo);
}

function validarLinha(linha) {
  if (!linha.data) return "data inválida";
  if (!REGEX_HORA_VALIDA.test(linha.hora)) return `hora inválida ("${linha.hora}")`;
  return null;
}

/**
 * Decide o destino de uma linha: vínculo automático (nome bate com
 * exatamente um paciente já cadastrado), revisão manual (zero ou mais de
 * um candidato — nunca escolhe sozinho, ver spec "Escopo"), ou divergência
 * (data/hora inválida, nem chega a comparar nome).
 */
export function decidirLinha(linha, pacientes) {
  const erroValidacao = validarLinha(linha);
  if (erroValidacao) {
    return { tipo: "divergencia", motivo: erroValidacao, linha };
  }

  const candidatos = encontrarCandidatosPaciente(linha.nome, pacientes);
  if (candidatos.length === 1) {
    return { tipo: "auto_vinculo", paciente: candidatos[0], linha };
  }
  return { tipo: "revisao", candidatos, linha };
}

/**
 * Grava (ou confirma que já existe) o agendamento importado, e registra
 * presença quando `linha.presenca` está resolvida. A supressão de lembrete
 * pra data futura acontece dentro do próprio INSERT (`CASE WHEN`), nunca
 * como passo separado depois — decisão da spec, pra não depender de
 * comparar timestamp e arriscar esquecer o passo.
 */
export async function aplicarLinhaResolvida({ linha, telefone, usuarioImportacaoId }, { aplicar }) {
  const eventos = [];

  const { rows: existentes } = await pool.query(
    // Compara telefone normalizado (regexp_replace), igual ao índice único
    // idx_agendamentos_importados_unico (migration 010) e o ON CONFLICT do
    // INSERT logo abaixo — comparar string exata aqui deixaria passar um
    // "duplicado" que na verdade já existe só com formatação diferente,
    // caindo no ON CONFLICT DO NOTHING sem gerar id e perdendo o registro de
    // presença silenciosamente.
    `SELECT id FROM agendamentos_importados
     WHERE regexp_replace(telefone, '\\D', '', 'g') = regexp_replace($1, '\\D', '', 'g')
       AND data = $2 AND hora = $3 AND nome = $4`,
    [telefone, linha.data, linha.hora, linha.nome]
  );

  let agendamentoImportadoId = existentes[0]?.id ?? null;

  if (agendamentoImportadoId) {
    eventos.push({ tipo: "agendamento_ja_existe" });
  } else {
    eventos.push({ tipo: "agendamento_novo" });
    if (aplicar) {
      const { rows } = await pool.query(
        `INSERT INTO agendamentos_importados
           (telefone, nome, data, hora, tipo_atendimento, convenio, tipo, tem_ficha, lembrete_24h_enviado_em)
         VALUES ($1, $2, $3, $4, 'fisioterapia', $5, $6, $7,
           CASE WHEN $3::date > ${HOJE_SQL} THEN now() ELSE NULL END)
         ON CONFLICT (regexp_replace(telefone, '\\D', '', 'g'), data, hora, nome) DO NOTHING
         RETURNING id`,
        [telefone, linha.nome, linha.data, linha.hora, linha.categoria, linha.tipo, linha.temFicha]
      );
      agendamentoImportadoId = rows[0]?.id ?? null;
    }
  }

  if (aplicar && agendamentoImportadoId && linha.presenca) {
    const resultado = await registrarPresencaImportado({
      agendamentoImportadoId,
      presenca: linha.presenca,
      observacaoSessao: null,
      registradoPor: usuarioImportacaoId,
    });
    eventos.push(
      resultado.registro
        ? { tipo: "presenca_registrada" }
        : { tipo: "presenca_nao_registrada", motivo: resultado.motivo }
    );
  }

  return { eventos };
}
