// test/dashboardControllerFinanceiro.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { asyncHandler } from "../src/utils/asyncHandler.js";
import * as dashboardController from "../src/controllers/dashboardController.js";
import {
  telaFinanceiro,
  processarPagamentoAgendamento,
  processarPagamentoImportado,
  processarEstorno,
  criarProcessarEstorno,
} from "../src/controllers/dashboardController.js";

function criarRespostaFalsa() {
  return {
    statusCode: 200,
    corpo: null,
    viewRenderizada: null,
    dadosDaView: null,
    redirectedTo: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(corpo) {
      this.corpo = corpo;
      return this;
    },
    render(view, dados) {
      this.viewRenderizada = view;
      this.dadosDaView = dados;
      return this;
    },
    redirect(url) {
      this.redirectedTo = url;
    },
  };
}

function criarRequisicao({ params = {}, body = {}, query = {}, usuarioId = 7 } = {}) {
  return { params, body, query, usuarioAtual: { id: usuarioId } };
}

const CORPO_VALIDO = {
  valor: "150",
  forma_pagamento: "pix",
  status: "pago",
  data: "2026-08-27",
};

test("telaRelatorioFinanceiro: renderiza somente o relatório mensal aprovado", async (t) => {
  assert.equal(typeof dashboardController.telaRelatorioFinanceiro, "function");

  let chamada = 0;
  t.mock.method(pool, "query", async () => {
    chamada += 1;
    if (chamada <= 2) {
      return { rows: [{ total: "0.00", quantidade: "1", quantidade_estornos: "1" }] };
    }
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await dashboardController.telaRelatorioFinanceiro(
    criarRequisicao({ query: { mes: "2026-08" } }),
    res
  );

  assert.equal(res.viewRenderizada, "financeiro/relatorio");
  assert.equal(res.dadosDaView.relatorio.mes, "2026-08");
  assert.equal(res.dadosDaView.relatorio.totalFaturado.total, "0.00");
});

test("telaRelatorioFinanceiro: repassa plano e sanitiza especialidade inválida pra null", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await dashboardController.telaRelatorioFinanceiro(
    criarRequisicao({ query: { mes: "2026-08", plano: "  Bússola  ", especialidade: "odontologia" } }),
    res
  );

  assert.equal(res.dadosDaView.plano, "Bússola");
  assert.equal(res.dadosDaView.especialidade, null);
  for (const { sql, params } of consultas) {
    assert.match(sql, /ILIKE \$3/);
    assert.equal(params[2], "%Bússola%");
    assert.equal(params[3], null);
  }
});

test("telaRelatorioFinanceiro: repassa dia e turno válidos pro model e sanitiza inválidos pra null", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await dashboardController.telaRelatorioFinanceiro(
    criarRequisicao({ query: { mes: "2026-08", dia: "2026-08-17", turno: "manha" } }),
    res
  );

  assert.equal(res.dadosDaView.dia, "2026-08-17");
  assert.equal(res.dadosDaView.turno, "manha");
  for (const { params } of consultas) {
    assert.equal(params[4], "2026-08-17");
    assert.equal(params[5], "manha");
  }
});

test("telaRelatorioFinanceiro: sanitiza dia/turno inválidos pra null", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await dashboardController.telaRelatorioFinanceiro(
    criarRequisicao({ query: { mes: "2026-08", dia: "2026-02-30", turno: "noite" } }),
    res
  );

  assert.equal(res.dadosDaView.dia, null);
  assert.equal(res.dadosDaView.turno, null);
  for (const { params } of consultas) {
    assert.equal(params[4], null);
    assert.equal(params[5], null);
  }
});

test("telaRelatorioFinanceiro: divide o total faturado pelo número de fisioterapeutas informado", async (t) => {
  let chamada = 0;
  t.mock.method(pool, "query", async () => {
    chamada += 1;
    if (chamada === 1) return { rows: [{ total: "500.00", quantidade: "5", quantidade_estornos: "0" }] };
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await dashboardController.telaRelatorioFinanceiro(
    criarRequisicao({ query: { mes: "2026-08", porFisioterapeutas: "2" } }),
    res
  );

  assert.equal(res.dadosDaView.porFisioterapeutas, 2);
  assert.equal(res.dadosDaView.valorPorFisioterapeuta, 250);
});

test("telaRelatorioFinanceiro: ignora porFisioterapeutas inválido (zero, negativo ou não numérico) e não divide", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ total: "500.00", quantidade: "5", quantidade_estornos: "0" }],
  }));

  for (const valorInvalido of ["0", "-1", "abc", "1.5", ""]) {
    const res = criarRespostaFalsa();
    await dashboardController.telaRelatorioFinanceiro(
      criarRequisicao({ query: { mes: "2026-08", porFisioterapeutas: valorInvalido } }),
      res
    );
    assert.equal(res.dadosDaView.porFisioterapeutas, null);
    assert.equal(res.dadosDaView.valorPorFisioterapeuta, null);
  }
});

test("processarPagamentoAgendamento: valor inválido responde 400 sem consultar o banco", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await processarPagamentoAgendamento(
    criarRequisicao({ params: { id: "5" }, body: { ...CORPO_VALIDO, valor: "0" } }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(consultas.length, 0);
});

test("processarPagamentoAgendamento: valor com mais de 2 casas decimais é arredondado pra centavos", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("INSERT INTO pagamentos")) return { rows: [{ id: 1 }] };
    return { rows: [{ id: 5, paciente_id: 42 }] };
  });
  const res = criarRespostaFalsa();

  await processarPagamentoAgendamento(
    criarRequisicao({ params: { id: "5" }, body: { ...CORPO_VALIDO, valor: "150.555" } }),
    res
  );

  assert.equal(res.redirectedTo, "/financeiro");
  const insercao = chamadas.find(({ sql }) => sql.includes("INSERT INTO pagamentos"));
  assert.equal(insercao.params[2], 150.56); // valor arredondado pra 2 casas decimais
});

test("processarPagamentoAgendamento: valor em fronteira de arredondamento (1.005) não perde o centavo por erro de ponto flutuante", async (t) => {
  // 1.005 * 100 é 100.49999999999999 em ponto flutuante — Math.round direto
  // no double arredondaria pra baixo (1.00) em vez de pra cima (1.01), um
  // erro de centavo silencioso num valor financeiro (ver arredondarCentavos
  // em dashboardController.js, que arredonda sobre o texto do número em vez
  // do double pra evitar isso em qualquer magnitude).
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("INSERT INTO pagamentos")) return { rows: [{ id: 1 }] };
    return { rows: [{ id: 5, paciente_id: 42 }] };
  });
  const res = criarRespostaFalsa();

  await processarPagamentoAgendamento(
    criarRequisicao({ params: { id: "5" }, body: { ...CORPO_VALIDO, valor: "1.005" } }),
    res
  );

  assert.equal(res.redirectedTo, "/financeiro");
  const insercao = chamadas.find(({ sql }) => sql.includes("INSERT INTO pagamentos"));
  assert.equal(insercao.params[2], 1.01);
});

test("processarPagamentoAgendamento: fronteira de arredondamento também correta em valores maiores (35.855)", async (t) => {
  // Uma compensação fixa (ex: + Number.EPSILON) só resolve o erro de ponto
  // flutuante perto de 1 — em magnitudes maiores a granularidade do double já
  // é maior que o EPSILON, então o mesmo problema reaparece (35.855 * 100
  // arredondaria pra 35.85 em vez de 35.86 sem o arredondamento por texto).
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("INSERT INTO pagamentos")) return { rows: [{ id: 1 }] };
    return { rows: [{ id: 5, paciente_id: 42 }] };
  });
  const res = criarRespostaFalsa();

  await processarPagamentoAgendamento(
    criarRequisicao({ params: { id: "5" }, body: { ...CORPO_VALIDO, valor: "35.855" } }),
    res
  );

  assert.equal(res.redirectedTo, "/financeiro");
  const insercao = chamadas.find(({ sql }) => sql.includes("INSERT INTO pagamentos"));
  assert.equal(insercao.params[2], 35.86);
});

test("processarPagamentoAgendamento: valor de sub-centavo (arredonda pra 0) responde 400 sem gravar", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("INSERT INTO pagamentos")) return { rows: [{ id: 1 }] };
    return { rows: [{ id: 5, paciente_id: 42 }] };
  });
  const res = criarRespostaFalsa();

  await processarPagamentoAgendamento(
    criarRequisicao({ params: { id: "5" }, body: { ...CORPO_VALIDO, valor: "0.004" } }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(
    chamadas.some(({ sql }) => sql.includes("INSERT INTO pagamentos")),
    false
  );
});

test("processarPagamentoAgendamento: valor acima do limite de NUMERIC(10,2) responde 400 sem gravar", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("INSERT INTO pagamentos")) return { rows: [{ id: 1 }] };
    return { rows: [{ id: 5, paciente_id: 42 }] };
  });
  const res = criarRespostaFalsa();

  await processarPagamentoAgendamento(
    criarRequisicao({ params: { id: "5" }, body: { ...CORPO_VALIDO, valor: "100000000" } }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(
    chamadas.some(({ sql }) => sql.includes("INSERT INTO pagamentos")),
    false
  );
});

test("processarPagamentoAgendamento: cartão com valor_acrescimo acima do limite responde 400 sem gravar", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("INSERT INTO pagamentos")) return { rows: [{ id: 1 }] };
    return { rows: [{ id: 5, paciente_id: 42 }] };
  });
  const res = criarRespostaFalsa();

  await processarPagamentoAgendamento(
    criarRequisicao({
      params: { id: "5" },
      body: { ...CORPO_VALIDO, forma_pagamento: "cartao", valor_acrescimo: "100000000" },
    }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(
    chamadas.some(({ sql }) => sql.includes("INSERT INTO pagamentos")),
    false
  );
});

test("processarPagamentoAgendamento: status inválido responde 400 sem gravar", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("INSERT INTO pagamentos")) return { rows: [{ id: 1 }] };
    return { rows: [{ id: 5, paciente_id: 42 }] };
  });
  const res = criarRespostaFalsa();

  await processarPagamentoAgendamento(
    criarRequisicao({ params: { id: "5" }, body: { ...CORPO_VALIDO, status: "cancelado" } }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(
    chamadas.some(({ sql }) => sql.includes("INSERT INTO pagamentos")),
    false
  );
});

test("processarPagamentoAgendamento: data malformada responde 400 sem gravar", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("INSERT INTO pagamentos")) return { rows: [{ id: 1 }] };
    return { rows: [{ id: 5, paciente_id: 42 }] };
  });
  const res = criarRespostaFalsa();

  await processarPagamentoAgendamento(
    criarRequisicao({ params: { id: "5" }, body: { ...CORPO_VALIDO, data: "não é uma data" } }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(
    chamadas.some(({ sql }) => sql.includes("INSERT INTO pagamentos")),
    false
  );
});

test("processarPagamentoAgendamento: forma_pagamento inválida responde 400", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const res = criarRespostaFalsa();

  await processarPagamentoAgendamento(
    criarRequisicao({ params: { id: "5" }, body: { ...CORPO_VALIDO, forma_pagamento: "boleto" } }),
    res
  );

  assert.equal(res.statusCode, 400);
});

test("processarPagamentoAgendamento: id não-numérico responde 404 sem consultar o banco", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await processarPagamentoAgendamento(
    criarRequisicao({ params: { id: "abc" }, body: CORPO_VALIDO }),
    res
  );

  assert.equal(res.statusCode, 404);
  assert.equal(consultas.length, 0);
});

test("processarPagamentoAgendamento: agendamento inexistente responde 404", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const res = criarRespostaFalsa();

  await processarPagamentoAgendamento(
    criarRequisicao({ params: { id: "999" }, body: CORPO_VALIDO }),
    res
  );

  assert.equal(res.statusCode, 404);
});

test("processarPagamentoAgendamento: caminho feliz normaliza parcelas/acréscimo pra null quando forma é pix e redireciona", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("INSERT INTO pagamentos")) return { rows: [{ id: 1 }] };
    return { rows: [{ id: 5, paciente_id: 42 }] };
  });
  const res = criarRespostaFalsa();

  await processarPagamentoAgendamento(
    criarRequisicao({
      params: { id: "5" },
      body: { ...CORPO_VALIDO, parcelas: "3", valor_acrescimo: "10" }, // pix não deveria usar isso
    }),
    res
  );

  assert.equal(res.redirectedTo, "/financeiro");
  const insercao = chamadas.find(({ sql }) => sql.includes("INSERT INTO pagamentos"));
  assert.equal(insercao.params[4], null); // parcelas
  assert.equal(insercao.params[5], null); // valor_acrescimo
});

test("processarPagamentoAgendamento: forma_pagamento convenio normaliza parcelas/acréscimo pra null e redireciona", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("INSERT INTO pagamentos")) return { rows: [{ id: 1 }] };
    return { rows: [{ id: 5, paciente_id: 42 }] };
  });
  const res = criarRespostaFalsa();

  await processarPagamentoAgendamento(
    criarRequisicao({
      params: { id: "5" },
      body: { ...CORPO_VALIDO, forma_pagamento: "convenio", parcelas: "3", valor_acrescimo: "10" },
    }),
    res
  );

  assert.equal(res.redirectedTo, "/financeiro");
  const insercao = chamadas.find(({ sql }) => sql.includes("INSERT INTO pagamentos"));
  assert.equal(insercao.params[4], null); // parcelas
  assert.equal(insercao.params[5], null); // valor_acrescimo
});

test("processarPagamentoAgendamento: cartão com parcelas/acréscimo válidos passa os valores", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("INSERT INTO pagamentos")) return { rows: [{ id: 1 }] };
    return { rows: [{ id: 5, paciente_id: 42 }] };
  });
  const res = criarRespostaFalsa();

  await processarPagamentoAgendamento(
    criarRequisicao({
      params: { id: "5" },
      body: { ...CORPO_VALIDO, forma_pagamento: "cartao", parcelas: "3", valor_acrescimo: "10.50" },
    }),
    res
  );

  const insercao = chamadas.find(({ sql }) => sql.includes("INSERT INTO pagamentos"));
  assert.equal(insercao.params[4], 3);
  assert.equal(insercao.params[5], 10.5);
});

test("processarPagamentoAgendamento: cartão com parcelas inválidas (0) responde 400 sem gravar", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("INSERT INTO pagamentos")) return { rows: [{ id: 1 }] };
    return { rows: [{ id: 5, paciente_id: 42 }] };
  });
  const res = criarRespostaFalsa();

  await processarPagamentoAgendamento(
    criarRequisicao({
      params: { id: "5" },
      body: { ...CORPO_VALIDO, forma_pagamento: "cartao", parcelas: "0" },
    }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(
    chamadas.some(({ sql }) => sql.includes("INSERT INTO pagamentos")),
    false
  );
});

test("processarPagamentoAgendamento: cartão com parcelas acima do teto de negócio (13) responde 400 sem gravar", async (t) => {
  // parcelas é um INTEGER no Postgres — sem teto de negócio, um valor
  // absurdo (ex: 999999999999) estoura a coluna e vira 500 cru em vez de um
  // 400 limpo. 12x é o padrão comum de parcelamento de cartão no Brasil.
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("INSERT INTO pagamentos")) return { rows: [{ id: 1 }] };
    return { rows: [{ id: 5, paciente_id: 42 }] };
  });
  const res = criarRespostaFalsa();

  await processarPagamentoAgendamento(
    criarRequisicao({
      params: { id: "5" },
      body: { ...CORPO_VALIDO, forma_pagamento: "cartao", parcelas: "13" },
    }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(
    chamadas.some(({ sql }) => sql.includes("INSERT INTO pagamentos")),
    false
  );
});

test("processarPagamentoAgendamento: cartão com exatamente 12 parcelas (teto) continua funcionando", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("INSERT INTO pagamentos")) return { rows: [{ id: 1 }] };
    return { rows: [{ id: 5, paciente_id: 42 }] };
  });
  const res = criarRespostaFalsa();

  await processarPagamentoAgendamento(
    criarRequisicao({
      params: { id: "5" },
      body: { ...CORPO_VALIDO, forma_pagamento: "cartao", parcelas: "12" },
    }),
    res
  );

  assert.equal(res.redirectedTo, "/financeiro");
  const insercao = chamadas.find(({ sql }) => sql.includes("INSERT INTO pagamentos"));
  assert.equal(insercao.params[4], 12);
});

test("processarPagamentoAgendamento: cartão com valor_acrescimo inválido (negativo) responde 400", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("INSERT INTO pagamentos")) return { rows: [{ id: 1 }] };
    return { rows: [{ id: 5, paciente_id: 42 }] };
  });
  const res = criarRespostaFalsa();

  await processarPagamentoAgendamento(
    criarRequisicao({
      params: { id: "5" },
      body: { ...CORPO_VALIDO, forma_pagamento: "cartao", valor_acrescimo: "-10" },
    }),
    res
  );

  assert.equal(res.statusCode, 400);
});

test("processarPagamentoAgendamento: cartão sem parcelas/valor_acrescimo (ausentes) continua funcionando", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("INSERT INTO pagamentos")) return { rows: [{ id: 1 }] };
    return { rows: [{ id: 5, paciente_id: 42 }] };
  });
  const res = criarRespostaFalsa();

  await processarPagamentoAgendamento(
    criarRequisicao({
      params: { id: "5" },
      body: { ...CORPO_VALIDO, forma_pagamento: "cartao" },
    }),
    res
  );

  assert.equal(res.redirectedTo, "/financeiro");
  const insercao = chamadas.find(({ sql }) => sql.includes("INSERT INTO pagamentos"));
  assert.equal(insercao.params[4], null); // parcelas
  assert.equal(insercao.params[5], null); // valor_acrescimo
});

test("processarPagamentoImportado: paciente_nao_vinculado responde 400 com mensagem específica", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("FROM agendamentos_importados"))
      return { rows: [{ id: 8, telefone: "5511999998888" }] };
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await processarPagamentoImportado(
    criarRequisicao({ params: { id: "8" }, body: CORPO_VALIDO }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.corpo, /telefone não bate/);
});

test("processarPagamentoImportado: telefone inválido orienta revisão do cadastro", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("FROM agendamentos_importados")) {
      return { rows: [{ id: 8, telefone: "99999-8888" }] };
    }
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await processarPagamentoImportado(
    criarRequisicao({ params: { id: "8" }, body: CORPO_VALIDO }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.corpo, /telefone.*inválido/i);
});

test("processarPagamentoImportado: telefone ambíguo informa múltiplos pacientes", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("FROM agendamentos_importados")) {
      return { rows: [{ id: 8, telefone: "(11) 99999-8888" }] };
    }
    if (sql.includes("FROM pacientes")) {
      return { rows: [{ id: 55 }, { id: 56 }] };
    }
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await processarPagamentoImportado(
    criarRequisicao({ params: { id: "8" }, body: CORPO_VALIDO }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.corpo, /mais de um paciente/i);
});

test("processarPagamentoImportado: valor inválido responde 400 sem consultar o banco (validarCamposPagamento roda pro importado também)", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await processarPagamentoImportado(
    criarRequisicao({ params: { id: "8" }, body: { ...CORPO_VALIDO, valor: "0" } }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(consultas.length, 0);
});

test("processarPagamentoImportado: forma_pagamento inválida responde 400 sem consultar o banco", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await processarPagamentoImportado(
    criarRequisicao({ params: { id: "8" }, body: { ...CORPO_VALIDO, forma_pagamento: "boleto" } }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(consultas.length, 0);
});

test("processarPagamentoImportado: caminho feliz redireciona pra /financeiro", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("INSERT INTO pagamentos")) return { rows: [{ id: 2 }] };
    if (sql.includes("FROM agendamentos_importados"))
      return { rows: [{ id: 8, telefone: "5511999998888" }] };
    if (sql.includes("FROM pacientes")) return { rows: [{ id: 55 }] };
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await processarPagamentoImportado(
    criarRequisicao({ params: { id: "8" }, body: CORPO_VALIDO }),
    res
  );

  assert.equal(res.redirectedTo, "/financeiro");
});

for (const id of ["abc", "1abc", "1.9", "1e2", "Infinity", "9007199254740992"]) {
  test(`processarEstorno: id inválido ${id} responde 404 sem consultar o banco`, async (t) => {
    // Mudando a validação para parseInt permissivo, este caso aceita um ID
    // malformado e chega ao model.
    const consultas = [];
    t.mock.method(pool, "query", async (sql, params) => {
      consultas.push({ sql, params });
      return { rows: [] };
    });
    const res = criarRespostaFalsa();

    await processarEstorno(criarRequisicao({ params: { id } }), res);

    assert.equal(res.statusCode, 404);
    assert.equal(consultas.length, 0);
  });
}

test("processarEstorno: data inválida responde 400 sem consultar o banco", async (t) => {
  // Sem a validação no controller, a data inválida é enviada ao model de
  // estorno e pode acabar persistida como auditoria inconsistente.
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await processarEstorno(
    criarRequisicao({ params: { id: "3" }, body: { data: "2026-02-30", observacao: "teste" } }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(consultas.length, 0);
});

test("processarEstorno: pagamento inexistente responde 404", async () => {
  const res = criarRespostaFalsa();

  await criarProcessarEstorno(async () => ({ motivo: "nao_encontrado" }))(
    criarRequisicao({ params: { id: "999" }, body: { data: "2026-08-28" } }),
    res
  );

  assert.equal(res.statusCode, 404);
});

test("processarEstorno: pagamento já estornado responde 400", async () => {
  const res = criarRespostaFalsa();

  await criarProcessarEstorno(async () => ({ motivo: "ja_estornado" }))(
    criarRequisicao({ params: { id: "3" }, body: { data: "2026-08-28" } }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.corpo, /já está estornado/);
});

test("processarEstorno: lançamento compensatório não pode ser estornado", async () => {
  const res = criarRespostaFalsa();

  await criarProcessarEstorno(async () => ({ motivo: "nao_estornavel" }))(
    criarRequisicao({ params: { id: "11" }, body: { data: "2026-08-28" } }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.corpo, /já está estornado/);
});

test("processarEstorno: caminho feliz encaminha auditoria normalizada ao model", async () => {
  const chamadas = [];
  const estornar = async (...args) => {
    chamadas.push(args);
    return { pagamento: { id: 4, status: "estornado" } };
  };
  const res = criarRespostaFalsa();

  await criarProcessarEstorno(estornar)(
    criarRequisicao({
      params: { id: "4" },
      body: { data: "2026-08-28", observacao: "  Lançamento duplicado  " },
      usuarioId: 19,
    }),
    res
  );

  assert.equal(res.redirectedTo, "/financeiro");
  assert.deepEqual(chamadas, [
    [
      4,
      {
        registradoPor: 19,
        data: "2026-08-28",
        observacao: "Lançamento duplicado",
      },
    ],
  ]);
});

test("processarEstorno: funciona quando chamado pelo asyncHandler com next do Express", async (t) => {
  const pagamentoOriginal = {
    id: 4,
    agendamento_id: 12,
    agendamento_importado_id: null,
    paciente_id: 19,
    valor: "150.00",
    forma_pagamento: "pix",
    parcelas: null,
    valor_acrescimo: null,
    status: "pago",
    tipo_lancamento: "pagamento",
  };
  const client = {
    async query(sql) {
      if (sql.includes("FOR UPDATE")) return { rows: [pagamentoOriginal] };
      if (sql.includes("pagamento_origem_id = $1")) return { rows: [] };
      if (sql.includes("INSERT INTO pagamentos")) return { rows: [{ id: 20 }] };
      return { rows: [] };
    },
    release() {},
  };
  t.mock.method(pool, "connect", async () => client);

  const req = criarRequisicao({
    params: { id: "4" },
    body: { data: "2026-08-28", observacao: "Duplicado" },
    usuarioId: 19,
  });
  const res = criarRespostaFalsa();
  let resolverResposta;
  const respostaConcluida = new Promise((resolve) => {
    resolverResposta = resolve;
  });
  res.redirect = (url) => {
    res.redirectedTo = url;
    resolverResposta();
  };
  const erros = [];

  asyncHandler(processarEstorno)(req, res, (erro) => {
    erros.push(erro);
    resolverResposta();
  });
  await respostaConcluida;

  assert.deepEqual(erros, []);
  assert.equal(res.redirectedTo, "/financeiro");
});

test("telaFinanceiro: renderiza financeiro/lista com os itens combinados", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("agendamentos_importados")) return { rows: [] };
    return {
      rows: [{ id: 1, origem: "bot", data: "2026-08-20", hora: "10:00:00", pagamentos: [] }],
    };
  });
  const res = criarRespostaFalsa();

  await telaFinanceiro(criarRequisicao({ query: {} }), res);

  assert.equal(res.viewRenderizada, "financeiro/lista");
  assert.equal(res.dadosDaView.itens.length, 1);
});

test("telaFinanceiro: sem query params, usa offset 0 e limite padrão (50) na view", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const res = criarRespostaFalsa();

  await telaFinanceiro(criarRequisicao({ query: {} }), res);

  assert.equal(res.dadosDaView.offsetAtual, 0);
  assert.equal(res.dadosDaView.limiteAtual, 50);
});

test("telaFinanceiro: repassa limite/offset da query pro model (não usa direto os padrões)", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await telaFinanceiro(criarRequisicao({ query: { limite: "10", offset: "20" } }), res);

  assert.equal(res.dadosDaView.limiteAtual, 10);
  assert.equal(res.dadosDaView.offsetAtual, 20);
  for (const { params } of chamadas) {
    assert.equal(params[0], 30); // janela = offset + limite (mesma janela usada pelo model)
  }
});

test("telaFinanceiro: página cheia (itens.length === limite) marca temProximaPagina true", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("agendamentos_importados")) return { rows: [] };
    return { rows: [{ id: 1, data: "2026-08-20", hora: "10:00:00", pagamentos: [] }] };
  });
  const res = criarRespostaFalsa();

  await telaFinanceiro(criarRequisicao({ query: { limite: "1" } }), res);

  assert.equal(res.dadosDaView.itens.length, 1);
  assert.equal(res.dadosDaView.temProximaPagina, true);
});

test("telaFinanceiro: página incompleta (itens.length < limite) marca temProximaPagina false", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const res = criarRespostaFalsa();

  await telaFinanceiro(criarRequisicao({ query: { limite: "10" } }), res);

  assert.equal(res.dadosDaView.itens.length, 0);
  assert.equal(res.dadosDaView.temProximaPagina, false);
});
