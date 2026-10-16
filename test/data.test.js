// test/data.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatarDataHora,
  formatarData,
  formatarDataExtensa,
  formatarDataComDiaSemana,
} from "../src/utils/data.js";

// O driver pg devolve colunas timestamptz (ex: pacientes.created_at,
// registros_atendimento.registrado_em) como objeto Date do JS. Interpolar
// isso direto numa view EJS chama Date.prototype.toString(), que produz um
// formato em inglês fixo no fuso do servidor (ex: "Thu Aug 27 2026 18:48:07
// GMT-0300 (Horário Padrão de Brasília)"). formatarDataHora precisa
// converter isso pro formato brasileiro DD/MM/AAAA às HH:mm, sempre no fuso
// da clínica (America/Sao_Paulo), independentemente do fuso do servidor.
test("formatarDataHora: Date em UTC vira DD/MM/AAAA às HH:mm no fuso da clínica", () => {
  const data = new Date("2026-08-27T21:48:07.000Z");
  assert.equal(formatarDataHora(data), "27/08/2026 às 18:48");
});

test("formatarDataHora: aceita string ISO também", () => {
  assert.equal(formatarDataHora("2026-08-27T21:48:07.000Z"), "27/08/2026 às 18:48");
});

test("formatarDataHora: null/undefined não quebra, vira string vazia", () => {
  assert.equal(formatarDataHora(null), "");
  assert.equal(formatarDataHora(undefined), "");
});

test("formatarDataHora: valor inválido não quebra, vira string vazia", () => {
  assert.equal(formatarDataHora("não é uma data"), "");
});

test("formatarDataHora: preenche minutos com zero à esquerda", () => {
  const data = new Date("2026-01-05T12:05:00.000Z");
  assert.equal(formatarDataHora(data), "05/01/2026 às 09:05");
});

// pacientes.data_nascimento é DATE — o driver pg devolve isso como string
// "YYYY-MM-DD" pura (ver types.setTypeParser em src/db/pool.js), nunca como
// Date. formatarData não deve aplicar fuso horário (diferente de
// formatarDataHora) — uma data sem hora não tem o que converter, e usar
// .tz() arriscaria deslocar o dia.
test("formatarData: string YYYY-MM-DD vira DD/MM/AAAA", () => {
  assert.equal(formatarData("1956-06-13"), "13/06/1956");
});

test("formatarData: aceita Date também", () => {
  assert.equal(formatarData(new Date("2026-08-27T00:00:00.000Z")), "27/08/2026");
});

test("formatarData: null/undefined não quebra, vira string vazia", () => {
  assert.equal(formatarData(null), "");
  assert.equal(formatarData(undefined), "");
});

test("formatarData: valor inválido não quebra, vira string vazia", () => {
  assert.equal(formatarData("não é uma data"), "");
});

// agendamentos.data/agendamentos_importados.data são DATE — mesma string
// "YYYY-MM-DD" pura de formatarData, sem componente de hora pra converter
// de fuso. formatarDataExtensa só muda o formato de exibição (por extenso,
// em português) — usado na tela /agendamentos a pedido do usuário.
test("formatarDataExtensa: string YYYY-MM-DD vira 'D de MMMM de AAAA' em português", () => {
  assert.equal(formatarDataExtensa("2026-05-28"), "28 de maio de 2026");
});

test("formatarDataExtensa: aceita Date também", () => {
  assert.equal(formatarDataExtensa(new Date("2026-08-27T00:00:00.000Z")), "27 de agosto de 2026");
});

test("formatarDataExtensa: null/undefined não quebra, vira string vazia", () => {
  assert.equal(formatarDataExtensa(null), "");
  assert.equal(formatarDataExtensa(undefined), "");
});

test("formatarDataExtensa: valor inválido não quebra, vira string vazia", () => {
  assert.equal(formatarDataExtensa("não é uma data"), "");
});

test("formatarDataComDiaSemana: string YYYY-MM-DD vira 'Dia-da-semana, D de MMMM' capitalizado", () => {
  assert.equal(formatarDataComDiaSemana("2026-09-10"), "Quinta-feira, 10 de setembro");
});

test("formatarDataComDiaSemana: aceita Date também", () => {
  assert.equal(formatarDataComDiaSemana(new Date("2026-09-11T00:00:00.000Z")), "Sexta-feira, 11 de setembro");
});

test("formatarDataComDiaSemana: null/undefined não quebra, vira string vazia", () => {
  assert.equal(formatarDataComDiaSemana(null), "");
  assert.equal(formatarDataComDiaSemana(undefined), "");
});

test("formatarDataComDiaSemana: valor inválido não quebra, vira string vazia", () => {
  assert.equal(formatarDataComDiaSemana("não é uma data"), "");
});
