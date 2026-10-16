// test/pagamentoModel.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { pool } from "../src/db/pool.js";
import {
  listarFinanceiro,
  registrarPagamentoBot,
  registrarPagamentoImportado,
  estornarPagamento,
  tentarGerarPagamentoAutomatico,
} from "../src/models/pagamentoModel.js";
import { limiteSeguroListagem, offsetSeguroListagem } from "../src/utils/paginacao.js";
import { buscarPacientePorTelefoneNormalizado } from "../src/models/pacienteModel.js";

const MIGRATION_PATH = new URL(
  "../src/db/migrations/013_financeiro_estorno_append_only.sql",
  import.meta.url
);

function mockarConsultas(t, { bot = [], importados = [] } = {}) {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("agendamentos_importados")) {
      return { rows: importados };
    }
    return { rows: bot };
  });
  return chamadas;
}

test("DDD 55 recebe DDI antes do matching", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [{ id: 41 }] };
  });

  const resultado = await buscarPacientePorTelefoneNormalizado("55 99999-9999");

  assert.deepEqual(chamadas[0].params, ["5555999999999", "55999999999"]);
  assert.deepEqual(resultado, { paciente: { id: 41 } });
});

test("buscarPacientePorTelefoneNormalizado: comprimento impossível retorna motivo sem consultar pacientes", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [{ id: 41 }] };
  });

  const resultado = await buscarPacientePorTelefoneNormalizado("99999-8888");

  assert.deepEqual(resultado, { motivo: "telefone_invalido" });
  assert.equal(chamadas.length, 0);
});

test("buscarPacientePorTelefoneNormalizado: candidatos canônicos em pacientes diferentes retornam ambiguidade", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [
      { id: 41, telefone: "5511999998888" },
      { id: 42, telefone: "11999998888" },
    ],
  }));

  const resultado = await buscarPacientePorTelefoneNormalizado("(11) 99999-8888");

  assert.deepEqual(resultado, { motivo: "telefone_ambiguo" });
});

test("clamps rejeitam decimal e infinito", () => {
  assert.equal(limiteSeguroListagem("1.5"), 50);
  assert.equal(limiteSeguroListagem("Infinity"), 50);
  assert.equal(offsetSeguroListagem("1.5"), 0);
  assert.equal(offsetSeguroListagem("Infinity"), 0);
  assert.equal(limiteSeguroListagem("201"), 200);
  assert.equal(offsetSeguroListagem("1000001"), 1000000);
});

test("listarFinanceiro: combina itens do bot e importados, mais recente primeiro", async (t) => {
  mockarConsultas(t, {
    bot: [{ id: 1, origem: "bot", data: "2026-08-20", hora: "10:00:00", pagamentos: [] }],
    importados: [
      { id: 2, origem: "importado", data: "2026-08-25", hora: "09:00:00", pagamentos: [] },
    ],
  });

  const itens = await listarFinanceiro({});

  assert.deepEqual(
    itens.map((i) => i.origem),
    ["importado", "bot"]
  );
});

test("listarFinanceiro: dentro do mesmo dia, horário da manhã vem antes do da tarde", async (t) => {
  mockarConsultas(t, {
    bot: [
      { id: 1, origem: "bot", data: "2026-08-20", hora: "18:00:00", pagamentos: [] },
      { id: 2, origem: "bot", data: "2026-08-20", hora: "07:30:00", pagamentos: [] },
    ],
    importados: [
      { id: 3, origem: "importado", data: "2026-08-20", hora: "12:00:00", pagamentos: [] },
    ],
  });

  const itens = await listarFinanceiro({});

  assert.deepEqual(
    itens.map((i) => i.id),
    [2, 3, 1]
  );
});

test("listarFinanceiro: cada item carrega seus pagamentos já lançados", async (t) => {
  const pagamentosDoItem = [
    {
      id: 10,
      valor: "150.00",
      forma_pagamento: "pix",
      parcelas: null,
      valor_acrescimo: null,
      status: "pago",
      data: "2026-08-20",
      observacao: null,
      registrado_em: "2026-08-20T10:00:00Z",
    },
  ];
  mockarConsultas(t, {
    bot: [
      { id: 1, origem: "bot", data: "2026-08-20", hora: "10:00:00", pagamentos: pagamentosDoItem },
    ],
  });

  const itens = await listarFinanceiro({});

  assert.deepEqual(itens[0].pagamentos, pagamentosDoItem);
});

test("listarFinanceiro: deriva estornado_por e expõe os vínculos append-only em ambas as fontes", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql) => {
    chamadas.push(sql);
    return { rows: [] };
  });

  await listarFinanceiro({});

  assert.equal(chamadas.length, 2);
  for (const sql of chamadas) {
    assert.match(sql, /'tipo_lancamento', pg\.tipo_lancamento/);
    assert.match(sql, /'pagamento_origem_id', pg\.pagamento_origem_id/);
    assert.match(sql, /'estornado_por', estorno\.id/);
    assert.match(sql, /'registrado_por', pg\.registrado_por/);
    assert.match(sql, /'registrado_por_nome', registrador\.nome/);
    assert.match(sql, /LEFT JOIN pagamentos estorno ON estorno\.pagamento_origem_id = pg\.id/);
    assert.match(sql, /LEFT JOIN usuarios registrador ON registrador\.id = pg\.registrado_por/);
  }
});

test("listarFinanceiro: aplica limite e offset sobre a lista já combinada", async (t) => {
  mockarConsultas(t, {
    bot: [
      { id: 1, data: "2026-08-20", hora: "10:00:00", pagamentos: [] },
      { id: 2, data: "2026-08-21", hora: "10:00:00", pagamentos: [] },
      { id: 3, data: "2026-08-22", hora: "10:00:00", pagamentos: [] },
    ],
  });

  const itens = await listarFinanceiro({ limite: 1, offset: 1 });

  assert.equal(itens.length, 1);
  assert.equal(itens[0].id, 2);
});

test("listarFinanceiro: com data inválida no filtro, ignora e não passa filtro nenhum", async (t) => {
  const chamadas = mockarConsultas(t);

  await listarFinanceiro({ data: "não-é-uma-data" });

  for (const { params } of chamadas) {
    assert.equal(params.at(-1), null);
  }
});

test("listarFinanceiro: com data válida, passa o filtro pras duas queries", async (t) => {
  const chamadas = mockarConsultas(t);

  await listarFinanceiro({ data: "2026-08-25" });

  for (const { params } of chamadas) {
    assert.equal(params[1], "2026-08-25");
  }
});

function mockarQuery(t, impl) {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return impl(sql, params);
  });
  return chamadas;
}

function mockarClienteTransacional(t, impl) {
  const chamadas = [];
  let releases = 0;
  const client = {
    query: async (sql, params) => {
      chamadas.push({ sql, params });
      return impl(sql, params);
    },
    release: () => {
      releases += 1;
    },
  };
  t.mock.method(pool, "query", async () => {
    throw new Error("estorno deve usar o cliente transacional de pool.connect()");
  });
  t.mock.method(pool, "connect", async () => client);
  return { chamadas, releases: () => releases };
}

const CAMPOS_BASE = {
  valor: 150,
  formaPagamento: "pix",
  parcelas: null,
  valorAcrescimo: null,
  status: "pago",
  data: "2026-08-27",
  observacao: null,
  registradoPor: 7,
};

test("registrarPagamentoBot: agendamento inexistente retorna motivo nao_encontrado", async (t) => {
  mockarQuery(t, () => ({ rows: [] }));

  const resultado = await registrarPagamentoBot({ agendamentoId: 999, ...CAMPOS_BASE });

  assert.deepEqual(resultado, { motivo: "nao_encontrado" });
});

test("registrarPagamentoBot: caminho feliz insere usando o paciente_id do agendamento", async (t) => {
  const pagamentoEsperado = { id: 1, agendamento_id: 5, paciente_id: 42, valor: "150.00" };
  const chamadas = mockarQuery(t, (sql) => {
    if (sql.includes("INSERT INTO pagamentos")) return { rows: [pagamentoEsperado] };
    return { rows: [{ id: 5, paciente_id: 42 }] };
  });

  const resultado = await registrarPagamentoBot({ agendamentoId: 5, ...CAMPOS_BASE });

  assert.deepEqual(resultado, { pagamento: pagamentoEsperado });
  const insercao = chamadas.find(({ sql }) => sql.includes("INSERT INTO pagamentos"));
  assert.equal(insercao.params[0], 5); // agendamento_id
  assert.equal(insercao.params[1], 42); // paciente_id resolvido
});

test("registrarPagamentoImportado: agendamento importado inexistente retorna motivo nao_encontrado", async (t) => {
  mockarQuery(t, () => ({ rows: [] }));

  const resultado = await registrarPagamentoImportado({
    agendamentoImportadoId: 999,
    ...CAMPOS_BASE,
  });

  assert.deepEqual(resultado, { motivo: "nao_encontrado" });
});

test("registrarPagamentoImportado: sem paciente cadastrado com o telefone retorna motivo paciente_nao_vinculado", async (t) => {
  mockarQuery(t, (sql) => {
    if (sql.includes("FROM agendamentos_importados"))
      return { rows: [{ id: 8, telefone: "5511999998888" }] };
    if (sql.includes("FROM pacientes")) return { rows: [] }; // buscarPacientePorTelefone não acha ninguém
    return { rows: [] };
  });

  const resultado = await registrarPagamentoImportado({
    agendamentoImportadoId: 8,
    ...CAMPOS_BASE,
  });

  assert.deepEqual(resultado, { motivo: "paciente_nao_vinculado" });
});

test("registrarPagamentoImportado: telefone com comprimento impossível retorna motivo específico e não insere", async (t) => {
  const chamadas = mockarQuery(t, (sql) => {
    if (sql.includes("FROM agendamentos_importados")) {
      return { rows: [{ id: 8, telefone: "99999-8888" }] };
    }
    return { rows: [{ id: 55 }] };
  });

  const resultado = await registrarPagamentoImportado({
    agendamentoImportadoId: 8,
    ...CAMPOS_BASE,
  });

  assert.deepEqual(resultado, { motivo: "telefone_invalido" });
  assert.equal(chamadas.some(({ sql }) => sql.includes("FROM pacientes")), false);
  assert.equal(chamadas.some(({ sql }) => sql.includes("INSERT INTO pagamentos")), false);
});

test("registrarPagamentoImportado: candidatos em pacientes diferentes retornam ambiguidade e não inserem", async (t) => {
  const chamadas = mockarQuery(t, (sql) => {
    if (sql.includes("FROM agendamentos_importados")) {
      return { rows: [{ id: 8, telefone: "(11) 99999-8888" }] };
    }
    if (sql.includes("FROM pacientes")) {
      return {
        rows: [
          { id: 55, telefone: "5511999998888" },
          { id: 56, telefone: "11999998888" },
        ],
      };
    }
    return { rows: [{ id: 2 }] };
  });

  const resultado = await registrarPagamentoImportado({
    agendamentoImportadoId: 8,
    ...CAMPOS_BASE,
  });

  assert.deepEqual(resultado, { motivo: "telefone_ambiguo" });
  assert.equal(chamadas.some(({ sql }) => sql.includes("INSERT INTO pagamentos")), false);
});

test("registrarPagamentoImportado: caminho feliz resolve paciente_id pelo telefone e insere", async (t) => {
  const pagamentoEsperado = {
    id: 2,
    agendamento_importado_id: 8,
    paciente_id: 55,
    valor: "150.00",
  };
  const chamadas = mockarQuery(t, (sql) => {
    if (sql.includes("INSERT INTO pagamentos")) return { rows: [pagamentoEsperado] };
    if (sql.includes("FROM agendamentos_importados"))
      return { rows: [{ id: 8, telefone: "5511999998888" }] };
    if (sql.includes("FROM pacientes")) return { rows: [{ id: 55, telefone: "5511999998888" }] };
    return { rows: [] };
  });

  const resultado = await registrarPagamentoImportado({
    agendamentoImportadoId: 8,
    ...CAMPOS_BASE,
  });

  assert.deepEqual(resultado, { pagamento: pagamentoEsperado });
  const insercao = chamadas.find(({ sql }) => sql.includes("INSERT INTO pagamentos"));
  assert.equal(insercao.params[0], 8); // agendamento_importado_id
  assert.equal(insercao.params[1], 55); // paciente_id resolvido via telefone
});

test("registrarPagamentoImportado: telefone importado com pontuação e sem DDI ainda assim acha o paciente (telefone normalizado)", async (t) => {
  // Telefone importado do sistema de agenda anterior pode ter pontuação e/ou não ter o
  // DDI "55", diferente do telefone normalizado (só dígitos + DDI) que o bot
  // grava em pacientes.telefone — buscarPacientePorTelefoneNormalizado
  // precisa comparar só dígitos, com ou sem DDI, pra achar o vínculo.
  const pagamentoEsperado = {
    id: 3,
    agendamento_importado_id: 9,
    paciente_id: 60,
    valor: "150.00",
  };
  const chamadas = mockarQuery(t, (sql, params) => {
    if (sql.includes("INSERT INTO pagamentos")) return { rows: [pagamentoEsperado] };
    if (sql.includes("FROM agendamentos_importados"))
      return { rows: [{ id: 9, telefone: "(11) 99999-8888" }] };
    if (sql.includes("FROM pacientes")) {
      // Busca primeiro pelo formato normalizado com DDI e, em seguida, pelo
      // número sem DDI; o paciente já está normalizado, então o primeiro
      // candidato deve encontrá-lo.
      assert.deepEqual(params, ["5511999998888", "11999998888"]);
      return { rows: [{ id: 60, telefone: "5511999998888" }] };
    }
    return { rows: [] };
  });

  const resultado = await registrarPagamentoImportado({
    agendamentoImportadoId: 9,
    ...CAMPOS_BASE,
  });

  assert.deepEqual(resultado, { pagamento: pagamentoEsperado });
  const insercao = chamadas.find(({ sql }) => sql.includes("INSERT INTO pagamentos"));
  assert.equal(insercao.params[1], 60); // paciente_id resolvido apesar do telefone não normalizado
});

const PAGAMENTO_ORIGINAL = {
  id: 4,
  agendamento_id: 12,
  agendamento_importado_id: null,
  paciente_id: 42,
  valor: "150.00",
  forma_pagamento: "pix",
  parcelas: null,
  valor_acrescimo: null,
  status: "pago",
  data: "2026-08-27",
  observacao: "pagamento original",
  registrado_por: 3,
  registrado_em: "2026-08-27T12:00:00.000Z",
  tipo_lancamento: "pagamento",
  pagamento_origem_id: null,
};

const DADOS_ESTORNO = {
  registradoPor: 7,
  data: "2026-08-29",
  observacao: "solicitado pelo paciente",
};

test("estornarPagamento: insere lançamento compensatório em transação sem alterar ou excluir o original", async (t) => {
  const estornoEsperado = {
    ...PAGAMENTO_ORIGINAL,
    id: 15,
    data: DADOS_ESTORNO.data,
    observacao: DADOS_ESTORNO.observacao,
    registrado_por: DADOS_ESTORNO.registradoPor,
    registrado_em: "2026-08-29T15:00:00.000Z",
    tipo_lancamento: "estorno",
    pagamento_origem_id: PAGAMENTO_ORIGINAL.id,
  };
  const transacao = mockarClienteTransacional(t, (sql) => {
    if (/FOR UPDATE/.test(sql)) return { rows: [PAGAMENTO_ORIGINAL] };
    if (/WHERE pagamento_origem_id = \$1/.test(sql)) return { rows: [] };
    if (/INSERT INTO pagamentos/.test(sql)) return { rows: [estornoEsperado] };
    return { rows: [] };
  });

  const resultado = await estornarPagamento(PAGAMENTO_ORIGINAL.id, DADOS_ESTORNO);

  assert.deepEqual(resultado, { pagamento: estornoEsperado });
  assert.equal(transacao.releases(), 1);
  assert.equal(transacao.chamadas[0].sql, "BEGIN");
  assert.match(transacao.chamadas[1].sql, /SELECT \* FROM pagamentos WHERE id = \$1 FOR UPDATE/);
  assert.deepEqual(transacao.chamadas[1].params, [PAGAMENTO_ORIGINAL.id]);
  assert.match(
    transacao.chamadas[2].sql,
    /SELECT id FROM pagamentos WHERE pagamento_origem_id = \$1/
  );
  assert.deepEqual(transacao.chamadas[2].params, [PAGAMENTO_ORIGINAL.id]);
  const insercao = transacao.chamadas[3];
  assert.match(
    insercao.sql,
    /\(agendamento_id, agendamento_importado_id, paciente_id, valor, forma_pagamento, parcelas, valor_acrescimo, status, data, observacao, registrado_por, tipo_lancamento, pagamento_origem_id\)/s
  );
  assert.deepEqual(insercao.params, [
    PAGAMENTO_ORIGINAL.agendamento_id,
    PAGAMENTO_ORIGINAL.agendamento_importado_id,
    PAGAMENTO_ORIGINAL.paciente_id,
    PAGAMENTO_ORIGINAL.valor,
    PAGAMENTO_ORIGINAL.forma_pagamento,
    PAGAMENTO_ORIGINAL.parcelas,
    PAGAMENTO_ORIGINAL.valor_acrescimo,
    PAGAMENTO_ORIGINAL.status,
    DADOS_ESTORNO.data,
    DADOS_ESTORNO.observacao,
    DADOS_ESTORNO.registradoPor,
    "estorno",
    PAGAMENTO_ORIGINAL.id,
  ]);
  assert.equal(transacao.chamadas[4].sql, "COMMIT");
  const sqlExecutado = transacao.chamadas.map(({ sql }) => sql).join("\n");
  assert.doesNotMatch(sqlExecutado, /UPDATE pagamentos/i);
  assert.doesNotMatch(sqlExecutado, /DELETE FROM pagamentos/i);
});

test("estornarPagamento: pagamento inexistente faz rollback e retorna nao_encontrado", async (t) => {
  const transacao = mockarClienteTransacional(t, (sql) => {
    if (/FOR UPDATE/.test(sql)) return { rows: [] };
    return { rows: [] };
  });

  const resultado = await estornarPagamento(999, DADOS_ESTORNO);

  assert.deepEqual(resultado, { motivo: "nao_encontrado" });
  assert.deepEqual(
    transacao.chamadas.map(({ sql }) => sql),
    ["BEGIN", "SELECT * FROM pagamentos WHERE id = $1 FOR UPDATE", "ROLLBACK"]
  );
  assert.equal(transacao.releases(), 1);
});

test("estornarPagamento: segundo estorno faz rollback e retorna ja_estornado", async (t) => {
  const transacao = mockarClienteTransacional(t, (sql) => {
    if (/FOR UPDATE/.test(sql)) return { rows: [PAGAMENTO_ORIGINAL] };
    if (/WHERE pagamento_origem_id = \$1/.test(sql)) return { rows: [{ id: 15 }] };
    return { rows: [] };
  });

  const resultado = await estornarPagamento(PAGAMENTO_ORIGINAL.id, DADOS_ESTORNO);

  assert.deepEqual(resultado, { motivo: "ja_estornado" });
  assert.equal(transacao.chamadas.at(-1).sql, "ROLLBACK");
  assert.equal(
    transacao.chamadas.some(({ sql }) => /INSERT INTO pagamentos/.test(sql)),
    false
  );
  assert.equal(transacao.releases(), 1);
});

test("estornarPagamento: não permite estornar outro estorno", async (t) => {
  const estorno = {
    ...PAGAMENTO_ORIGINAL,
    id: 15,
    tipo_lancamento: "estorno",
    pagamento_origem_id: PAGAMENTO_ORIGINAL.id,
  };
  const transacao = mockarClienteTransacional(t, (sql) => {
    if (/FOR UPDATE/.test(sql)) return { rows: [estorno] };
    return { rows: [] };
  });

  const resultado = await estornarPagamento(estorno.id, DADOS_ESTORNO);

  assert.deepEqual(resultado, { motivo: "nao_estornavel" });
  assert.equal(transacao.chamadas.at(-1).sql, "ROLLBACK");
  assert.equal(
    transacao.chamadas.some(({ sql }) =>
      /pagamento_origem_id = \$1|INSERT INTO pagamentos/.test(sql)
    ),
    false
  );
  assert.equal(transacao.releases(), 1);
});

test("estornarPagamento: corrida no índice único vira ja_estornado depois de rollback", async (t) => {
  const erroUnicidade = Object.assign(new Error("duplicate key"), { code: "23505" });
  const transacao = mockarClienteTransacional(t, (sql) => {
    if (/FOR UPDATE/.test(sql)) return { rows: [PAGAMENTO_ORIGINAL] };
    if (/WHERE pagamento_origem_id = \$1/.test(sql)) return { rows: [] };
    if (/INSERT INTO pagamentos/.test(sql)) throw erroUnicidade;
    return { rows: [] };
  });

  const resultado = await estornarPagamento(PAGAMENTO_ORIGINAL.id, DADOS_ESTORNO);

  assert.deepEqual(resultado, { motivo: "ja_estornado" });
  assert.equal(transacao.chamadas.at(-1).sql, "ROLLBACK");
  assert.equal(
    transacao.chamadas.some(({ sql }) => sql === "COMMIT"),
    false
  );
  assert.equal(transacao.releases(), 1);
});

test("estornarPagamento: erro inesperado faz rollback, libera cliente e propaga a falha", async (t) => {
  const erroEsperado = new Error("falha de escrita");
  const transacao = mockarClienteTransacional(t, (sql) => {
    if (/FOR UPDATE/.test(sql)) return { rows: [PAGAMENTO_ORIGINAL] };
    if (/WHERE pagamento_origem_id = \$1/.test(sql)) return { rows: [] };
    if (/INSERT INTO pagamentos/.test(sql)) throw erroEsperado;
    return { rows: [] };
  });

  await assert.rejects(
    estornarPagamento(PAGAMENTO_ORIGINAL.id, DADOS_ESTORNO),
    (erro) => erro === erroEsperado
  );

  assert.equal(transacao.chamadas.at(-1).sql, "ROLLBACK");
  assert.equal(transacao.releases(), 1);
});

import dayjs from "../src/utils/dayjs.js";
import { buscarRelatorioMensal } from "../src/models/pagamentoModel.js";

test("buscarRelatorioMensal: com mes inválido, usa o mês atual", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push(params);
    return { rows: [] };
  });

  const relatorio = await buscarRelatorioMensal({ mes: "não-é-um-mes" });

  // Mesmo fuso usado por mesSeguro() na implementação — usar new Date()
  // puro (UTC) aqui criaria um teste flaky nas ~3h de virada de mês em que
  // UTC já avançou de dia mas America/Sao_Paulo ainda não (fuso -03:00).
  const mesAtual = dayjs().tz("America/Sao_Paulo").format("YYYY-MM");
  assert.equal(relatorio.mes, mesAtual);
  for (const params of chamadas) {
    assert.equal(params[0], `${mesAtual}-01`);
  }
});

test("buscarRelatorioMensal: com mes fora do intervalo 01-12, usa o mês atual", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push(params);
    return { rows: [] };
  });

  // dayjs sem customParseFormat faz parsing tolerante e "rola" meses
  // inválidos (ex.: "2026-13-01" vira 2027-01-01) em vez de rejeitar —
  // REGEX_MES precisa barrar isso sozinho, sem depender do .isValid().
  const mesAtual = dayjs().tz("America/Sao_Paulo").format("YYYY-MM");

  for (const mesInvalido of ["2026-13", "2026-00"]) {
    const relatorio = await buscarRelatorioMensal({ mes: mesInvalido });
    assert.equal(relatorio.mes, mesAtual);
  }
  for (const params of chamadas) {
    assert.equal(params[0], `${mesAtual}-01`);
  }
});

test("buscarRelatorioMensal: com ano implausível (0000 ou muito distante), usa o mês atual", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push(params);
    return { rows: [] };
  });

  // "0000-01" batia no formato \d{4}-(0[1-9]|1[0-2]) e passava no
  // dayjs().isValid(), mas dayjs trata inicio e fimExclusivo de forma
  // inconsistente pra anos fora do intervalo plausível, gerando datas que o
  // Postgres acaba rejeitando (500 cru). REGEX_MES precisa barrar isso antes
  // de chegar no dayjs, igual já faz pra mês fora de 01-12.
  const mesAtual = dayjs().tz("America/Sao_Paulo").format("YYYY-MM");

  for (const anoImplausivel of ["0000-01", "9999-12"]) {
    const relatorio = await buscarRelatorioMensal({ mes: anoImplausivel });
    assert.equal(relatorio.mes, mesAtual);
  }
  for (const params of chamadas) {
    assert.equal(params[0], `${mesAtual}-01`);
  }
});

test("buscarRelatorioMensal: com mes válido, usa o intervalo certo (início inclusivo, fim exclusivo)", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push(params);
    return { rows: [] };
  });

  await buscarRelatorioMensal({ mes: "2026-02" });

  for (const params of chamadas) {
    assert.equal(params[0], "2026-02-01");
    assert.equal(params[1], "2026-03-01"); // fevereiro tem 28/29 dias — fim exclusivo é sempre "primeiro dia do mês seguinte"
  }
});

test("buscarRelatorioMensal: monta o objeto com totalFaturado, totalRecebido e os 3 breakdowns", async (t) => {
  let chamada = 0;
  t.mock.method(pool, "query", async () => {
    chamada += 1;
    if (chamada === 1)
      return { rows: [{ total: "150.00", quantidade: "2", quantidade_estornos: "1" }] }; // totalFaturado
    if (chamada === 2)
      return { rows: [{ total: "0.00", quantidade: "1", quantidade_estornos: "1" }] }; // totalRecebido
    if (chamada === 3)
      return {
        rows: [
          {
            tipo_atendimento: "fisioterapia",
            total: "150.00",
            quantidade: "2",
            quantidade_estornos: "1",
          },
        ],
      };
    if (chamada === 4)
      return {
        rows: [
          {
            forma_pagamento: "pix",
            total: "150.00",
            quantidade: "2",
            quantidade_estornos: "1",
          },
        ],
      };
    return {
      rows: [{ status: "pago", total: "0.00", quantidade: "1", quantidade_estornos: "1" }],
    };
  });

  const relatorio = await buscarRelatorioMensal({ mes: "2026-08" });

  assert.deepEqual(relatorio.totalFaturado, {
    total: "150.00",
    quantidade: "2",
    quantidade_estornos: "1",
  });
  assert.deepEqual(relatorio.totalRecebido, {
    total: "0.00",
    quantidade: "1",
    quantidade_estornos: "1",
  });
  assert.deepEqual(relatorio.porTipoAtendimento, [
    {
      tipo_atendimento: "fisioterapia",
      total: "150.00",
      quantidade: "2",
      quantidade_estornos: "1",
    },
  ]);
  assert.deepEqual(relatorio.porFormaPagamento, [
    {
      forma_pagamento: "pix",
      total: "150.00",
      quantidade: "2",
      quantidade_estornos: "1",
    },
  ]);
  assert.deepEqual(relatorio.porStatus, [
    { status: "pago", total: "0.00", quantidade: "1", quantidade_estornos: "1" },
  ]);
});

test("buscarRelatorioMensal: usa sinal derivado e conta pagamentos e estornos separadamente", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql) => {
    chamadas.push(sql);
    return { rows: [] };
  });

  await buscarRelatorioMensal({ mes: "2026-08" });

  assert.equal(chamadas.length, 8);
  // porPlano tem estrutura própria (subquery — ver calcularRepasseLinha em
  // pagamentoModel.js) e detalhamento é uma listagem linha a linha (sem
  // SUM/COUNT), então as outras 6 seguem o padrão comum abaixo.
  const chamadasPadrao = chamadas.filter(
    (sql) => !sql.includes("GROUP BY chave_grupo") && !sql.includes("pg.id,")
  );
  assert.equal(chamadasPadrao.length, 6);
  for (const sql of chamadasPadrao) {
    assert.match(
      sql,
      /SUM\(CASE WHEN pg\.tipo_lancamento = 'estorno' THEN -pg\.valor ELSE pg\.valor END\)/
    );
    assert.match(
      sql,
      /COUNT\(\*\) FILTER \(WHERE pg\.tipo_lancamento = 'pagamento'\) AS quantidade/
    );
    assert.match(
      sql,
      /COUNT\(\*\) FILTER \(WHERE pg\.tipo_lancamento = 'estorno'\) AS quantidade_estornos/
    );
    assert.match(sql, /pg\.data >= \$1 AND pg\.data < \$2/);
    assert.doesNotMatch(sql, /status <> 'estornado'/);
  }
  const totalRecebidoSql = chamadas.find((sql) => sql.includes("pg.status = 'pago'"));
  assert.ok(totalRecebidoSql, "esperava uma query filtrando status = 'pago' (totalRecebido)");

  const porPlanoSql = chamadas.find((sql) => sql.includes("GROUP BY chave_grupo"));
  assert.match(porPlanoSql, /pg\.data >= \$1 AND pg\.data < \$2/, "filtro de data continua aplicado, dentro da subquery");
});

test("buscarRelatorioMensal: sem plano/especialidade, não aplica os filtros opcionais", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [] };
  });

  await buscarRelatorioMensal({ mes: "2026-08" });

  for (const { sql, params } of chamadas) {
    assert.match(sql, /\$3::text IS NULL/);
    assert.match(sql, /\$4::text IS NULL/);
    assert.equal(params[2], null);
    assert.equal(params[3], null);
  }
});

test("buscarRelatorioMensal: número de parâmetros bate com o maior placeholder da query (regressão do bug de bind do Postgres)", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [] };
  });

  await buscarRelatorioMensal({ mes: "2026-08" });

  assert.ok(chamadas.length > 0);
  for (const { sql, params } of chamadas) {
    const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    const maiorPlaceholder = placeholders.length ? Math.max(...placeholders) : 0;
    assert.equal(
      params.length,
      maiorPlaceholder,
      `query usa até $${maiorPlaceholder} mas recebeu ${params.length} parâmetros — o Postgres real rejeita isso com "bind message supplies N parameters, but prepared statement requires M"`
    );
  }
});

test("buscarRelatorioMensal: filtra por plano de saúde (convênio) quando informado", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [] };
  });

  await buscarRelatorioMensal({ mes: "2026-08", plano: "Bússola" });

  for (const { sql, params } of chamadas) {
    assert.match(sql, /COALESCE\(ai\.convenio, p\.convenio\) ILIKE \$3/);
    assert.equal(params[2], "%Bússola%");
  }
});

test("buscarRelatorioMensal: escapa % e _ literais no plano antes de envolver com curingas", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [] };
  });

  await buscarRelatorioMensal({ mes: "2026-08", plano: "Bússola_Saúde 100%" });

  assert.equal(chamadas[0].params[2], "%Bússola\\_Saúde 100\\%%");
});

test("buscarRelatorioMensal: filtra por especialidade válida", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [] };
  });

  await buscarRelatorioMensal({ mes: "2026-08", especialidade: "psicologia" });

  for (const { sql, params } of chamadas) {
    assert.match(sql, /COALESCE\(a\.tipo_atendimento, ai\.tipo_atendimento\) = \$4/);
    assert.equal(params[3], "psicologia");
  }
});

test("buscarRelatorioMensal: ignora especialidade inválida em vez de aplicar filtro com valor arbitrário", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [] };
  });

  await buscarRelatorioMensal({ mes: "2026-08", especialidade: "qualquer-coisa; DROP TABLE pacientes" });

  for (const { params } of chamadas) {
    assert.equal(params[3], null);
  }
});

test("buscarRelatorioMensal: filtra por dia específico quando informado", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [] };
  });

  await buscarRelatorioMensal({ mes: "2026-08", dia: "2026-08-17" });

  for (const { sql, params } of chamadas) {
    assert.match(sql, /pg\.data = \$5/);
    assert.equal(params[4], "2026-08-17");
  }
});

test("buscarRelatorioMensal: ignora dia inválido em vez de aplicar filtro com valor arbitrário", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [] };
  });

  await buscarRelatorioMensal({ mes: "2026-08", dia: "2026-02-30" });

  for (const { params } of chamadas) {
    assert.equal(params[4], null);
  }
});

test("buscarRelatorioMensal: filtra por turno manhã (antes das 13h)", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [] };
  });

  await buscarRelatorioMensal({ mes: "2026-08", turno: "manha" });

  for (const { sql, params } of chamadas) {
    assert.match(sql, /COALESCE\(a\.hora, ai\.hora\) < TIME '13:00'/);
    assert.equal(params[5], "manha");
  }
});

test("buscarRelatorioMensal: filtra por turno tarde (13h em diante)", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [] };
  });

  await buscarRelatorioMensal({ mes: "2026-08", turno: "tarde" });

  for (const { sql, params } of chamadas) {
    assert.match(sql, /COALESCE\(a\.hora, ai\.hora\) >= TIME '13:00'/);
    assert.equal(params[5], "tarde");
  }
});

test("buscarRelatorioMensal: ignora turno inválido em vez de aplicar filtro com valor arbitrário", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [] };
  });

  await buscarRelatorioMensal({ mes: "2026-08", turno: "noite" });

  for (const { params } of chamadas) {
    assert.equal(params[5], null);
  }
});

test("buscarRelatorioMensal: inclui as quebras por plano e por profissional de Psicologia", async (t) => {
  const linhasPorPlano = [{
    plano: "Particular", total: "150.00", quantidade: "3",
    quantidade_avaliacao: "0", quantidade_sessao: "3",
    convenio_identificado: false, valor_repasse_avaliacao: null, valor_repasse_sessao: null,
  }];
  const linhasPorProfissional = [{ profissional: "Dra. Ana", total: "300.00", quantidade: "2" }];
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("GROUP BY chave_grupo")) {
      return { rows: linhasPorPlano };
    }
    if (sql.includes("GROUP BY ai.atendente")) {
      return { rows: linhasPorProfissional };
    }
    return { rows: [] };
  });

  const relatorio = await buscarRelatorioMensal({ mes: "2026-08" });

  assert.deepEqual(relatorio.porPlano, [
    { ...linhasPorPlano[0], valorRepasse: null, motivoRepasseIndisponivel: "nao_identificado" },
  ]);
  assert.deepEqual(relatorio.porProfissionalPsicologia, linhasPorProfissional);
});

function mockarQueryComPorPlano(t, linhaPorPlano) {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("GROUP BY chave_grupo")) return { rows: [linhaPorPlano] };
    return { rows: [] };
  });
}

test("buscarRelatorioMensal: repasse calculado quando convênio identificado com valores cadastrados", async (t) => {
  mockarQueryComPorPlano(t, {
    plano: "Mar Azul Saúde", total: "100.00", quantidade: "5",
    quantidade_avaliacao: "1", quantidade_sessao: "4",
    convenio_identificado: true, valor_repasse_avaliacao: "5.60", valor_repasse_sessao: "3.68",
  });

  const relatorio = await buscarRelatorioMensal({ mes: "2026-08" });

  // 1 avaliação * 5.60 + 4 sessões * 3.68 = 5.60 + 14.72 = 20.32
  assert.equal(relatorio.porPlano[0].valorRepasse, 20.32);
  assert.equal(relatorio.porPlano[0].motivoRepasseIndisponivel, null);
});

test("buscarRelatorioMensal: repasse nulo (não configurado) quando convênio identificado mas sem valores de repasse", async (t) => {
  mockarQueryComPorPlano(t, {
    plano: "Mar Azul Saúde", total: "100.00", quantidade: "5",
    quantidade_avaliacao: "1", quantidade_sessao: "4",
    convenio_identificado: true, valor_repasse_avaliacao: null, valor_repasse_sessao: null,
  });

  const relatorio = await buscarRelatorioMensal({ mes: "2026-08" });

  assert.equal(relatorio.porPlano[0].valorRepasse, null);
  assert.equal(relatorio.porPlano[0].motivoRepasseIndisponivel, "nao_configurado");
});

test("buscarRelatorioMensal: convênio com só o valor de sessão cadastrado calcula normalmente quando não houve avaliação no mês", async (t) => {
  mockarQueryComPorPlano(t, {
    plano: "Bom Porto Saúde", total: "35.00", quantidade: "5",
    quantidade_avaliacao: "0", quantidade_sessao: "5",
    convenio_identificado: true, valor_repasse_avaliacao: null, valor_repasse_sessao: "7.00",
  });

  const relatorio = await buscarRelatorioMensal({ mes: "2026-08" });

  assert.equal(relatorio.porPlano[0].valorRepasse, 35);
  assert.equal(relatorio.porPlano[0].motivoRepasseIndisponivel, null);
});

test("buscarRelatorioMensal: convênio com só o valor de sessão cadastrado fica não configurado se houve avaliação no mês", async (t) => {
  mockarQueryComPorPlano(t, {
    plano: "Bom Porto Saúde", total: "42.00", quantidade: "6",
    quantidade_avaliacao: "1", quantidade_sessao: "5",
    convenio_identificado: true, valor_repasse_avaliacao: null, valor_repasse_sessao: "7.00",
  });

  const relatorio = await buscarRelatorioMensal({ mes: "2026-08" });

  assert.equal(relatorio.porPlano[0].valorRepasse, null);
  assert.equal(relatorio.porPlano[0].motivoRepasseIndisponivel, "nao_configurado");
});

test("buscarRelatorioMensal: repasse nulo (não identificado) quando paciente sem convenio_id", async (t) => {
  mockarQueryComPorPlano(t, {
    plano: "MAR AZUL SP (texto antigo)", total: "100.00", quantidade: "5",
    quantidade_avaliacao: "0", quantidade_sessao: "5",
    convenio_identificado: false, valor_repasse_avaliacao: null, valor_repasse_sessao: null,
  });

  const relatorio = await buscarRelatorioMensal({ mes: "2026-08" });

  assert.equal(relatorio.porPlano[0].valorRepasse, null);
  assert.equal(relatorio.porPlano[0].motivoRepasseIndisponivel, "nao_identificado");
});

test("buscarRelatorioMensal: SQL de porPlano conta sessão pra tudo que não é primeira_consulta=true (cobre importado, sem essa coluna)", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql) => {
    chamadas.push(sql);
    return { rows: [] };
  });

  await buscarRelatorioMensal({ mes: "2026-08" });

  const sqlPorPlano = chamadas.find((sql) => sql.includes("GROUP BY chave_grupo"));
  assert.match(sqlPorPlano, /primeira_consulta IS NOT TRUE/);
  assert.match(sqlPorPlano, /primeira_consulta IS TRUE/);
  assert.match(sqlPorPlano, /LEFT JOIN convenios c ON c\.id = p\.convenio_id/);
});

test("buscarRelatorioMensal: detalhamento ordena por data do lançamento e, dentro do dia, pela hora do atendimento (manhã primeiro)", async (t) => {
  let sqlDetalhamento = null;
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("pg.id,")) {
      sqlDetalhamento = sql;
      return {
        rows: [
          { id: 2, tipo_lancamento: "pagamento", valor: "80.00", forma_pagamento: "pix", status: "pago", data_pagamento: "2026-08-10", paciente_nome: "Ana", tipo_atendimento: "fisioterapia", hora_atendimento: "07:00:00" },
          { id: 3, tipo_lancamento: "pagamento", valor: "80.00", forma_pagamento: "pix", status: "pago", data_pagamento: "2026-08-10", paciente_nome: "Caio", tipo_atendimento: "fisioterapia", hora_atendimento: "18:00:00" },
        ],
      };
    }
    return { rows: [] };
  });

  const relatorio = await buscarRelatorioMensal({ mes: "2026-08" });

  assert.match(sqlDetalhamento, /ORDER BY pg\.data ASC, COALESCE\(a\.hora, ai\.hora\) ASC/);
  assert.deepEqual(
    relatorio.detalhamento.map((l) => l.id),
    [2, 3]
  );
});

test("migration 013: prepara lançamentos de estorno append-only", async () => {
  const sql = await readFile(MIGRATION_PATH, "utf8");

  assert.match(sql, /ATENÇÃO:.*produção/s);
  assert.match(sql, /auditoria somente(?:\s|--)+leitura/s);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS tipo_lancamento TEXT NOT NULL DEFAULT 'pagamento'/);
  assert.match(
    sql,
    /ADD COLUMN IF NOT EXISTS pagamento_origem_id INTEGER REFERENCES pagamentos\(id\)/
  );
  assert.match(
    sql,
    /ADD CONSTRAINT pagamentos_tipo_lancamento_check\s+CHECK \(tipo_lancamento IN \('pagamento', 'estorno'\)\)/s
  );
  assert.match(
    sql,
    /ADD CONSTRAINT pagamentos_estorno_origem_check\s+CHECK \(\s+\(tipo_lancamento = 'pagamento' AND pagamento_origem_id IS NULL\)\s+OR\s+\(tipo_lancamento = 'estorno' AND pagamento_origem_id IS NOT NULL\)\s+\)/s
  );
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_pagamentos_estorno_unico/);
  assert.match(sql, /WHERE pagamento_origem_id IS NOT NULL/);
  assert.match(
    sql,
    /IF EXISTS[\s\S]+FROM pagamentos[\s\S]+status = 'estornado'[\s\S]+RAISE EXCEPTION/i,
    "a migration deve abortar antes de classificar estornos legados como pagamentos"
  );
});

test("listarFinanceiro: filtros vinculados a parâmetros e origem não consulta a outra fonte", async (t) => {
  const chamadas = mockarConsultas(t);
  await listarFinanceiro({ busca: "Ana", inicio: "2026-09-01", fim: "2026-09-30", status: "pago", formaPagamento: "pix", origem: "bot" });
  assert.equal(chamadas.length, 1);
  assert.deepEqual(chamadas[0].params.slice(2), ["2026-09-01", "2026-09-30", "Ana", "pago", "pix"]);
  assert.match(chamadas[0].sql, /EXISTS/);
  assert.match(chamadas[0].sql, /filtro.agendamento_id = a.id/);
});

test("listarFinanceiro: filtros inválidos não viram SQL executável", async (t) => {
  const chamadas = mockarConsultas(t);
  await listarFinanceiro({ status: "inventado", inicio: "2026-02-30", origem: "outra", formaPagamento: "dinheiro" });
  assert.equal(chamadas.length, 2);
  assert.deepEqual(chamadas[0].params.slice(2), [null, null, null, null, null]);
});

function mockarQueryAutoPagamento(t, { agendamento = null, importado = null, pagamentoExistente = false, temPacoteAtivo = false, paciente = null, pagamentoInserido = { id: 1 } } = {}) {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("FROM agendamentos WHERE id")) return { rows: agendamento ? [agendamento] : [] };
    if (sql.includes("FROM agendamentos_importados WHERE id")) return { rows: importado ? [importado] : [] };
    if (sql.includes("regexp_replace(telefone")) {
      return { rows: paciente ? [paciente] : [] };
    }
    if (sql.includes("tipo_lancamento = 'pagamento'") && sql.includes("agendamento_id = $1")) {
      return { rows: pagamentoExistente ? [{ id: 999 }] : [] };
    }
    if (sql.includes("FROM pacotes_sessoes ps WHERE ps.paciente_id")) {
      return { rows: temPacoteAtivo ? [{ id: 5 }] : [] };
    }
    if (sql.includes("FROM pacientes p") && sql.includes("LEFT JOIN convenios c")) {
      return { rows: paciente ? [paciente] : [] };
    }
    if (sql.includes("SELECT id, paciente_id FROM agendamentos WHERE id")) {
      return { rows: agendamento ? [{ id: agendamento.id ?? 5, paciente_id: agendamento.paciente_id }] : [] };
    }
    if (sql.includes("SELECT id, telefone FROM agendamentos_importados WHERE id")) {
      return { rows: importado ? [{ id: importado.id ?? 20, telefone: importado.telefone }] : [] };
    }
    if (sql.includes("INSERT INTO pagamentos")) return { rows: [pagamentoInserido] };
    return { rows: [] };
  });
  return chamadas;
}

test("tentarGerarPagamentoAutomatico: Psicologia nunca gera pagamento (sem preço fixo)", async (t) => {
  mockarQueryAutoPagamento(t, {
    agendamento: { paciente_id: 7, tipo_atendimento: "psicologia", primeira_consulta: false },
  });

  const resultado = await tentarGerarPagamentoAutomatico({ origem: "bot", agendamentoId: 5, registradoPor: 1 });

  assert.deepEqual(resultado, { motivo: "nao_fisioterapia" });
});

test("tentarGerarPagamentoAutomatico: paciente com pacote ativo não gera pagamento novo", async (t) => {
  mockarQueryAutoPagamento(t, {
    agendamento: { paciente_id: 7, tipo_atendimento: "fisioterapia", primeira_consulta: false },
    temPacoteAtivo: true,
  });

  const resultado = await tentarGerarPagamentoAutomatico({ origem: "bot", agendamentoId: 5, registradoPor: 1 });

  assert.deepEqual(resultado, { motivo: "coberto_por_pacote" });
});

test("tentarGerarPagamentoAutomatico: já existe pagamento pro agendamento, não duplica", async (t) => {
  mockarQueryAutoPagamento(t, {
    agendamento: { paciente_id: 7, tipo_atendimento: "fisioterapia", primeira_consulta: false },
    pagamentoExistente: true,
  });

  const resultado = await tentarGerarPagamentoAutomatico({ origem: "bot", agendamentoId: 5, registradoPor: 1 });

  assert.deepEqual(resultado, { motivo: "pagamento_ja_existe" });
});

test("tentarGerarPagamentoAutomatico: particular sessão avulsa gera pagamento de R$70, pix, pago", async (t) => {
  // convenio: "Particular" é o valor real que o cadastro grava (não null) —
  // achado testando no navegador: a checagem original tratava isso como
  // "convênio em texto livre" e nunca gerava pagamento nenhum.
  const chamadas = mockarQueryAutoPagamento(t, {
    agendamento: { paciente_id: 7, tipo_atendimento: "fisioterapia", primeira_consulta: false },
    paciente: { convenio_id: null, convenio: "Particular" },
  });

  const resultado = await tentarGerarPagamentoAutomatico({ origem: "bot", agendamentoId: 5, registradoPor: 1 });

  assert.ok(resultado.pagamento);
  const insercao = chamadas.find(({ sql }) => sql.includes("INSERT INTO pagamentos"));
  assert.equal(insercao.params[2], 70);
  assert.equal(insercao.params[3], "pix");
  assert.equal(insercao.params[6], "pago");
});

test("tentarGerarPagamentoAutomatico: sem dataPagamento, usa a data de hoje; com dataPagamento, usa a data informada (backfill)", async (t) => {
  const chamadas = mockarQueryAutoPagamento(t, {
    agendamento: { paciente_id: 7, tipo_atendimento: "fisioterapia", primeira_consulta: false },
    paciente: { convenio_id: null, convenio: "Particular" },
  });

  await tentarGerarPagamentoAutomatico({
    origem: "bot",
    agendamentoId: 5,
    registradoPor: 1,
    dataPagamento: "2026-08-01",
  });

  const insercao = chamadas.find(({ sql }) => sql.includes("INSERT INTO pagamentos"));
  assert.equal(insercao.params[7], "2026-08-01");
});

test("tentarGerarPagamentoAutomatico: particular avaliação (primeira_consulta) gera pagamento de R$40", async (t) => {
  const chamadas = mockarQueryAutoPagamento(t, {
    agendamento: { paciente_id: 7, tipo_atendimento: "fisioterapia", primeira_consulta: true },
    paciente: { convenio_id: null, convenio: null },
  });

  await tentarGerarPagamentoAutomatico({ origem: "bot", agendamentoId: 5, registradoPor: 1 });

  const insercao = chamadas.find(({ sql }) => sql.includes("INSERT INTO pagamentos"));
  assert.equal(insercao.params[2], 40);
});

test("tentarGerarPagamentoAutomatico: convênio com valor de repasse cadastrado gera pagamento aguardando_reembolso", async (t) => {
  const chamadas = mockarQueryAutoPagamento(t, {
    agendamento: { paciente_id: 7, tipo_atendimento: "fisioterapia", primeira_consulta: false },
    paciente: {
      convenio_id: 3,
      convenio: null,
      valor_repasse_avaliacao: "45.00",
      valor_repasse_sessao: "38.50",
    },
  });

  const resultado = await tentarGerarPagamentoAutomatico({ origem: "bot", agendamentoId: 5, registradoPor: 1 });

  assert.ok(resultado.pagamento);
  const insercao = chamadas.find(({ sql }) => sql.includes("INSERT INTO pagamentos"));
  assert.equal(insercao.params[2], 38.5);
  assert.equal(insercao.params[3], "convenio");
  assert.equal(insercao.params[6], "aguardando_reembolso");
});

test("tentarGerarPagamentoAutomatico: convênio identificado mas sem valor cadastrado não gera pagamento", async (t) => {
  mockarQueryAutoPagamento(t, {
    agendamento: { paciente_id: 7, tipo_atendimento: "fisioterapia", primeira_consulta: false },
    paciente: { convenio_id: 3, convenio: null, valor_repasse_avaliacao: null, valor_repasse_sessao: null },
  });

  const resultado = await tentarGerarPagamentoAutomatico({ origem: "bot", agendamentoId: 5, registradoPor: 1 });

  assert.deepEqual(resultado, { motivo: "sem_valor_configuravel" });
});

test("tentarGerarPagamentoAutomatico: paciente só com convênio em texto livre (sem convenio_id) não gera pagamento", async (t) => {
  mockarQueryAutoPagamento(t, {
    agendamento: { paciente_id: 7, tipo_atendimento: "fisioterapia", primeira_consulta: false },
    paciente: { convenio_id: null, convenio: "Mar Azul Saúde (texto livre, não migrado)" },
  });

  const resultado = await tentarGerarPagamentoAutomatico({ origem: "bot", agendamentoId: 5, registradoPor: 1 });

  assert.deepEqual(resultado, { motivo: "sem_valor_configuravel" });
});

test("tentarGerarPagamentoAutomatico: importado sempre conta como sessão (nunca avaliação) e resolve paciente pelo telefone", async (t) => {
  const chamadas = mockarQueryAutoPagamento(t, {
    importado: { id: 20, telefone: "11999990000", tipo_atendimento: "fisioterapia" },
    paciente: { id: 7, convenio_id: null, convenio: null },
  });

  const resultado = await tentarGerarPagamentoAutomatico({
    origem: "importado",
    agendamentoImportadoId: 20,
    registradoPor: 1,
  });

  assert.ok(resultado.pagamento);
  const insercao = chamadas.find(({ sql }) => sql.includes("INSERT INTO pagamentos"));
  assert.equal(insercao.params[2], 70);
});

test("tentarGerarPagamentoAutomatico: paciente não identificado (importado sem match de telefone) não gera pagamento", async (t) => {
  mockarQueryAutoPagamento(t, {
    importado: { id: 20, telefone: "11999990000", tipo_atendimento: "fisioterapia" },
    paciente: null,
  });

  const resultado = await tentarGerarPagamentoAutomatico({
    origem: "importado",
    agendamentoImportadoId: 20,
    registradoPor: 1,
  });

  assert.deepEqual(resultado, { motivo: "paciente_nao_identificado" });
});
