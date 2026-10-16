// src/utils/periodoEstatisticas.js
import dayjs from "./dayjs.js";
import { validarData } from "./validacao.js";

export const PERIODOS_VALIDOS = ["hoje", "semana", "mes", "ano", "custom"];

/**
 * Resolve os parâmetros de período da query string de /estatisticas pra um
 * intervalo de datas seguro de usar num filtro `data >= dataInicio AND data
 * <= dataFim` (ambos inclusivos). Qualquer coisa inválida — periodo fora do
 * enum, ausente, ou "custom" com datas ausentes/malformadas/invertidas —
 * cai no default "mes" (mês corrente inteiro), sem tela de erro, mesmo
 * espírito de mesSeguro()/validarData() já usados no resto do projeto.
 */
export function resolverPeriodo({ periodo, inicio, fim } = {}) {
  const hoje = dayjs().tz("America/Sao_Paulo");

  if (periodo === "custom") {
    if (validarData(inicio) && validarData(fim) && inicio <= fim) {
      return { periodo: "custom", dataInicio: inicio, dataFim: fim };
    }
    return resolverPeriodo({ periodo: "mes" });
  }

  if (periodo === "hoje") {
    const data = hoje.format("YYYY-MM-DD");
    return { periodo: "hoje", dataInicio: data, dataFim: data };
  }

  if (periodo === "semana") {
    return {
      periodo: "semana",
      dataInicio: hoje.startOf("isoWeek").format("YYYY-MM-DD"),
      dataFim: hoje.endOf("isoWeek").format("YYYY-MM-DD"),
    };
  }

  if (periodo === "ano") {
    return {
      periodo: "ano",
      dataInicio: hoje.startOf("year").format("YYYY-MM-DD"),
      dataFim: hoje.endOf("year").format("YYYY-MM-DD"),
    };
  }

  return {
    periodo: "mes",
    dataInicio: hoje.startOf("month").format("YYYY-MM-DD"),
    dataFim: hoje.endOf("month").format("YYYY-MM-DD"),
  };
}
