// test/pagamentoModelGuiaConvenio.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { buscarDadosGuiaConvenio } from "../src/models/pagamentoModel.js";

test("buscarDadosGuiaConvenio: pagamento inexistente retorna motivo nao_encontrado", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await buscarDadosGuiaConvenio(999);

  assert.deepEqual(resultado, { motivo: "nao_encontrado" });
});

test("buscarDadosGuiaConvenio: caminho feliz (origem bot) usa convênio/carteirinha do paciente", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        id: 10,
        valor: "150.00",
        status: "pago",
        data: "2026-08-20",
        forma_pagamento: "convenio",
        paciente_nome: "Maria",
        convenio: "Vale Saúde",
        numero_carteirinha: "123456",
        tipo_atendimento: "fisioterapia",
        profissional_responsavel: "Dra. Ana",
      },
    ],
  }));

  const resultado = await buscarDadosGuiaConvenio(10);

  assert.deepEqual(resultado, {
    dados: {
      numeroGuia: 10,
      pacienteNome: "Maria",
      convenio: "Vale Saúde",
      numeroCarteirinha: "123456",
      tipoAtendimento: "fisioterapia",
      data: "2026-08-20",
      valor: "150.00",
      profissionalResponsavel: "Dra. Ana",
      status: "pago",
      formaPagamento: "convenio",
    },
  });
});

test("buscarDadosGuiaConvenio: sem numero_carteirinha/profissional_responsavel, ficam null", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        id: 11,
        valor: "150.00",
        status: "pago",
        data: "2026-08-20",
        forma_pagamento: "convenio",
        paciente_nome: "Maria",
        convenio: "Vale Saúde",
        numero_carteirinha: null,
        tipo_atendimento: "fisioterapia",
        profissional_responsavel: null,
      },
    ],
  }));

  const resultado = await buscarDadosGuiaConvenio(11);

  assert.equal(resultado.dados.numeroCarteirinha, null);
  assert.equal(resultado.dados.profissionalResponsavel, null);
});

test("buscarDadosGuiaConvenio: pagamento estornado é retornado normalmente, com status pro controller/PDF decidirem o carimbo", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        id: 12,
        valor: "150.00",
        status: "estornado",
        data: "2026-08-20",
        forma_pagamento: "convenio",
        paciente_nome: "Maria",
        convenio: "Vale Saúde",
        numero_carteirinha: "123456",
        tipo_atendimento: "fisioterapia",
        profissional_responsavel: null,
      },
    ],
  }));

  const resultado = await buscarDadosGuiaConvenio(12);

  assert.equal(resultado.dados.status, "estornado");
});

test("buscarDadosGuiaConvenio: pagamento pix/cartão também é retornado (controller decide se bloqueia)", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        id: 13,
        valor: "150.00",
        status: "pago",
        data: "2026-08-20",
        forma_pagamento: "pix",
        paciente_nome: "Maria",
        convenio: null,
        numero_carteirinha: null,
        tipo_atendimento: "fisioterapia",
        profissional_responsavel: null,
      },
    ],
  }));

  const resultado = await buscarDadosGuiaConvenio(13);

  assert.equal(resultado.dados.formaPagamento, "pix");
});
