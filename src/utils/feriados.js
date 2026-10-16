/**
 * Feriados observados pela clínica (fecha nesses dias, além de sábado e
 * domingo — ver CLINICA.diasFechados). Clínica Exemplo fica na cidade de São
 * Paulo, então consideramos: feriados nacionais, estaduais de SP e
 * municipais da cidade de SP, mais Carnaval (segunda e terça) e Corpus
 * Christi — não são feriado nacional obrigatório, são ponto facultativo,
 * mas a clínica fecha nesses dias na prática, igual à grande maioria do
 * comércio brasileiro.
 */
import dayjs from "./dayjs.js";

// Algoritmo do Domingo de Páscoa (Anonymous Gregorian / Meeus/Jones/Butcher),
// usado pra derivar os feriados móveis (Sexta-feira Santa, Carnaval, Corpus
// Christi), todos calculados a partir da Páscoa.
function calcularPascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return dayjs(`${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`);
}

function feriadosNacionaisFixos(ano) {
  return [
    `${ano}-01-01`, // Confraternização Universal
    `${ano}-04-21`, // Tiradentes
    `${ano}-05-01`, // Dia do Trabalho
    `${ano}-09-07`, // Independência do Brasil
    `${ano}-10-12`, // Nossa Senhora Aparecida
    `${ano}-11-02`, // Finados
    `${ano}-11-15`, // Proclamação da República
    `${ano}-11-20`, // Dia Nacional de Zumbi e da Consciência Negra (Lei 14.759/2023, vale a partir de 2024)
    `${ano}-12-25`, // Natal
  ];
}

// Feriado estadual de São Paulo (estado).
function feriadosEstadoSP(ano) {
  return [`${ano}-07-09`]; // Revolução Constitucionalista de 1932
}

// Feriado municipal da cidade de São Paulo.
function feriadosMunicipioSP(ano) {
  return [`${ano}-01-25`]; // Aniversário da cidade de São Paulo
}

function feriadosMoveis(ano) {
  const pascoa = calcularPascoa(ano);
  return [
    pascoa.subtract(48, "day"), // Carnaval (segunda) — ponto facultativo, clínica fecha
    pascoa.subtract(47, "day"), // Carnaval (terça) — ponto facultativo, clínica fecha
    pascoa.subtract(2, "day"), // Sexta-feira Santa
    pascoa.add(60, "day"), // Corpus Christi — ponto facultativo, clínica fecha
  ].map((d) => d.format("YYYY-MM-DD"));
}

const cache = new Map();

function feriadosDoAno(ano) {
  if (cache.has(ano)) return cache.get(ano);
  const datas = new Set([
    ...feriadosNacionaisFixos(ano),
    ...feriadosEstadoSP(ano),
    ...feriadosMunicipioSP(ano),
    ...feriadosMoveis(ano),
  ]);
  cache.set(ano, datas);
  return datas;
}

export function ehFeriado(diaDayjs) {
  return feriadosDoAno(diaDayjs.year()).has(diaDayjs.format("YYYY-MM-DD"));
}
