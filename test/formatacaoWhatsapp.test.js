import { test } from "node:test";
import assert from "node:assert/strict";
import { formatarParaWhatsapp } from "../src/utils/formatacaoWhatsapp.js";

// Caso real 2026-09-23: o modelo respondeu "**Fisioterapia** ou de
// **Psicologia**" (negrito de Markdown) e o paciente viu os asteriscos
// duplos literalmente — no WhatsApp o negrito é *um* asterisco de cada lado.
test("formatarParaWhatsapp converte negrito de Markdown (**x**) pro do WhatsApp (*x*)", () => {
  assert.equal(
    formatarParaWhatsapp("Você gostaria de agendar **Fisioterapia** ou de **Psicologia**?"),
    "Você gostaria de agendar *Fisioterapia* ou de *Psicologia*?"
  );
});

test("formatarParaWhatsapp mantém negrito que já está no formato do WhatsApp", () => {
  assert.equal(formatarParaWhatsapp("Me fala seu *nome completo*"), "Me fala seu *nome completo*");
});

test("formatarParaWhatsapp não mexe em texto sem formatação nem em texto vazio", () => {
  assert.equal(formatarParaWhatsapp("Anotado, obrigada!"), "Anotado, obrigada!");
  assert.equal(formatarParaWhatsapp(""), "");
});
