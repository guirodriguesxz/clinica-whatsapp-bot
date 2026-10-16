import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizarTelefone, formatarTelefoneExibicao, normalizarTelefoneComDDI } from "../src/utils/phone.js";

test("normalizarTelefone remove o sufixo do JID do WhatsApp", () => {
  assert.equal(normalizarTelefone("5511988887777@s.whatsapp.net"), "5511988887777");
});

test("normalizarTelefone remove caracteres não numéricos", () => {
  assert.equal(normalizarTelefone("+55 (11) 98888-7777"), "5511988887777");
});

test("normalizarTelefone aceita número já limpo", () => {
  assert.equal(normalizarTelefone("5511988887777"), "5511988887777");
});

test("formatarTelefoneExibicao formata celular (9 dígitos) com DDI", () => {
  assert.equal(formatarTelefoneExibicao("5511988887777"), "(11) 98888-7777");
});

test("formatarTelefoneExibicao formata fixo (8 dígitos) com DDI", () => {
  assert.equal(formatarTelefoneExibicao("551133334444"), "(11) 3333-4444");
});

test("formatarTelefoneExibicao cai pro telefone normalizado (só dígitos), não o bruto, quando o formato foge do padrão BR", () => {
  assert.equal(formatarTelefoneExibicao("+44 20 7946 0958"), "442079460958");
});

test("normalizarTelefoneComDDI: 11 dígitos sem DDI ganha o 55 na frente", () => {
  assert.equal(normalizarTelefoneComDDI("11988887777"), "5511988887777");
});

test("normalizarTelefoneComDDI: 10 dígitos (fixo, sem 9) sem DDI ganha o 55 na frente", () => {
  assert.equal(normalizarTelefoneComDDI("1132224444"), "551132224444");
});

test("normalizarTelefoneComDDI: já com DDI 55 (13 dígitos) mantém como está", () => {
  assert.equal(normalizarTelefoneComDDI("5511988887777"), "5511988887777");
});

test("normalizarTelefoneComDDI: aceita pontuação/formatação e limpa antes de validar", () => {
  assert.equal(normalizarTelefoneComDDI("(11) 98888-7777"), "5511988887777");
});

test("normalizarTelefoneComDDI: quantidade de dígitos inválida retorna null", () => {
  assert.equal(normalizarTelefoneComDDI("123"), null);
  assert.equal(normalizarTelefoneComDDI(""), null);
  assert.equal(normalizarTelefoneComDDI(undefined), null);
});
