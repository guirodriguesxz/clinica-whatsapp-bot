// Teste isolado (não usa test/setupEnv.js) porque precisa controlar o valor
// bruto de ATENDENTE_HUMANO_TELEFONE *antes* de importar clinica.js — o
// módulo calcula TELEFONES_SEM_ATENDIMENTO_AUTOMATICO uma única vez, na
// primeira importação.
//
// Cobre o bug real: se a env var for digitada no Railway com formatação
// (espaço, traço, parênteses) em vez de só dígitos, a proteção que evita o
// bot tratar a resposta da recepção como paciente novo (ver clinica.js)
// parava de funcionar silenciosamente.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.OPENAI_API_KEY ??= "test-key";
process.env.ATENDENTE_HUMANO_TELEFONE = "+55 (11) 99999-0005";

const { TELEFONES_SEM_ATENDIMENTO_AUTOMATICO } = await import("../src/config/clinica.js");
const { normalizarTelefone } = await import("../src/utils/phone.js");

test("TELEFONES_SEM_ATENDIMENTO_AUTOMATICO normaliza ATENDENTE_HUMANO_TELEFONE mesmo configurado com formatação (espaço/traço/parênteses)", () => {
  const telefoneComoChegaDoWebhook = normalizarTelefone("5511999990005@s.whatsapp.net");
  assert.equal(telefoneComoChegaDoWebhook, "5511999990005");
  assert.ok(TELEFONES_SEM_ATENDIMENTO_AUTOMATICO.includes(telefoneComoChegaDoWebhook));
});
