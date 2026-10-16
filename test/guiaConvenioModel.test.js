// test/guiaConvenioModel.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { buscarDadosGuiaConvenio } from "../src/models/guiaConvenioModel.js";

test("buscarDadosGuiaConvenio: pagamento inexistente retorna motivo nao_encontrado", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await buscarDadosGuiaConvenio(999);

  assert.deepEqual(resultado, { motivo: "nao_encontrado" });
});

test("buscarDadosGuiaConvenio: linha do próprio estorno retorna motivo eh_estorno, sem expor os dados", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        id: 42,
        valor: "150.00",
        tipo_lancamento: "estorno",
        paciente_nome: "Maria",
        convenio: "Vale Saúde",
        matricula_convenio: "12345",
        tipo_atendimento: "fisioterapia",
        data_atendimento: "2026-08-20",
        profissional_responsavel: null,
        estornado_por: null,
      },
    ],
  }));

  const resultado = await buscarDadosGuiaConvenio(42);

  assert.deepEqual(resultado, { motivo: "eh_estorno" });
});

test("buscarDadosGuiaConvenio: caminho feliz com todos os campos presentes", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return {
      rows: [
        {
          id: 7,
          valor: "300.00",
          tipo_lancamento: "pagamento",
          paciente_nome: "Maria",
          convenio: "Vale Saúde",
          matricula_convenio: "12345",
          tipo_atendimento: "fisioterapia",
          data_atendimento: "2026-08-20",
          profissional_responsavel: "Dra. Ana",
          estornado_por: null,
        },
      ],
    };
  });

  const resultado = await buscarDadosGuiaConvenio(7);

  assert.deepEqual(resultado, {
    dados: {
      pacienteNome: "Maria",
      convenio: "Vale Saúde",
      matriculaConvenio: "12345",
      tipoAtendimento: "fisioterapia",
      dataAtendimento: "2026-08-20",
      valor: "300.00",
      profissionalResponsavel: "Dra. Ana",
      numeroGuia: 7,
      cancelada: false,
    },
  });
  assert.deepEqual(chamadas[0].params, [7]);
});

test("buscarDadosGuiaConvenio: campos opcionais ausentes ficam null (convenio, matricula, profissional)", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        id: 8,
        valor: "150.00",
        tipo_lancamento: "pagamento",
        paciente_nome: "João",
        convenio: null,
        matricula_convenio: null,
        tipo_atendimento: "psicologia",
        data_atendimento: "2026-08-21",
        profissional_responsavel: null,
        estornado_por: null,
      },
    ],
  }));

  const resultado = await buscarDadosGuiaConvenio(8);

  assert.equal(resultado.dados.convenio, null);
  assert.equal(resultado.dados.matriculaConvenio, null);
  assert.equal(resultado.dados.profissionalResponsavel, null);
});

test("buscarDadosGuiaConvenio: pagamento com estorno vinculado marca cancelada true", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      {
        id: 9,
        valor: "150.00",
        tipo_lancamento: "pagamento",
        paciente_nome: "João",
        convenio: "Bússola Saúde",
        matricula_convenio: null,
        tipo_atendimento: "psicologia",
        data_atendimento: "2026-08-21",
        profissional_responsavel: null,
        estornado_por: 15,
      },
    ],
  }));

  const resultado = await buscarDadosGuiaConvenio(9);

  assert.equal(resultado.dados.cancelada, true);
});
