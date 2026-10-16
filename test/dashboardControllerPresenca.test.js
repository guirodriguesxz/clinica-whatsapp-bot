import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import {
  processarPresencaAgendamento,
  processarPresencaImportado,
  processarPresencaLote,
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

function mockarClientTransacional(t, { statusUpdateRowCount = 1, registroRetornado = {} } = {}) {
  const chamadas = [];
  const client = {
    query: async (sql, params) => {
      chamadas.push({ sql, params });
      if (sql.includes("UPDATE agendamentos")) return { rowCount: statusUpdateRowCount };
      if (sql.includes("INSERT INTO registros_atendimento")) return { rows: [registroRetornado] };
      return { rows: [] };
    },
    release: () => {},
  };
  t.mock.method(pool, "connect", async () => client);
  return chamadas;
}

test("processarPresencaAgendamento: presença inválida responde 400 sem consultar o banco", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await processarPresencaAgendamento(
    criarRequisicao({ params: { id: "5" }, body: { presenca: "quaseveio" } }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(consultas.length, 0);
});

test("processarPresencaAgendamento: id não numérico responde 404 sem consultar o banco", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await processarPresencaAgendamento(
    criarRequisicao({ params: { id: "abc" }, body: { presenca: "compareceu" } }),
    res
  );

  assert.equal(res.statusCode, 404);
  assert.equal(consultas.length, 0);
});

test("processarPresencaAgendamento: id parcialmente numérico é rejeitado sem consultar o banco", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await processarPresencaAgendamento(
    criarRequisicao({ params: { id: "1abc" }, body: { presenca: "compareceu" } }),
    res
  );

  assert.equal(res.statusCode, 404);
  assert.equal(consultas.length, 0);
});

test("processarPresencaAgendamento: agendamento inexistente responde 404", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const res = criarRespostaFalsa();

  await processarPresencaAgendamento(
    criarRequisicao({ params: { id: "999" }, body: { presenca: "compareceu" } }),
    res
  );

  assert.equal(res.statusCode, 404);
});

test("processarPresencaAgendamento: caminho feliz redireciona pra /agendamentos", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 5, status: "confirmado", ja_passou: true }],
  }));
  const chamadas = mockarClientTransacional(t, { registroRetornado: { id: 1, presenca: "compareceu" } });
  const res = criarRespostaFalsa();

  await processarPresencaAgendamento(
    criarRequisicao({
      params: { id: "5" },
      body: {
        presenca: "compareceu",
        observacao_sessao: "  Foi bem  ",
        profissional_responsavel: "  Dra. Ana  ",
      },
      usuarioId: 7,
    }),
    res
  );

  assert.equal(res.redirectedTo, "/agendamentos?presenca_msg=Presen%C3%A7a%20registrada.");

  // Verifica que os params foram passados corretamente ao modelo
  const insertChamada = chamadas.find((c) => c.sql.includes("INSERT INTO registros_atendimento"));
  assert.ok(insertChamada, "Deve haver uma chamada INSERT");
  // params: [agendamentoId, presenca, observacaoSessao, profissionalResponsavel, registradoPor]
  assert.equal(insertChamada.params[0], 5, "agendamentoId deve ser 5");
  assert.equal(insertChamada.params[1], "compareceu", "presenca deve ser compareceu");
  assert.equal(insertChamada.params[2], "Foi bem", "observacao_sessao deve ser trimada");
  assert.equal(insertChamada.params[3], "Dra. Ana", "profissional_responsavel deve ser trimado");
  assert.equal(insertChamada.params[4], 7, "registradoPor deve ser usuarioId");
});

test("processarPresencaAgendamento: observacao_sessao whitespace-only vira null", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 5, status: "confirmado", ja_passou: true }],
  }));
  const chamadas = mockarClientTransacional(t, { registroRetornado: { id: 1, presenca: "compareceu" } });
  const res = criarRespostaFalsa();

  await processarPresencaAgendamento(
    criarRequisicao({
      params: { id: "5" },
      body: { presenca: "compareceu", observacao_sessao: "   " },
      usuarioId: 7,
    }),
    res
  );

  assert.equal(res.redirectedTo, "/agendamentos?presenca_msg=Presen%C3%A7a%20registrada.");

  // Verifica que observacao_sessao whitespace-only vira null
  const insertChamada = chamadas.find((c) => c.sql.includes("INSERT INTO registros_atendimento"));
  assert.ok(insertChamada, "Deve haver uma chamada INSERT");
  assert.strictEqual(insertChamada.params[2], null, "observacao_sessao whitespace-only deve virar null");
  assert.strictEqual(insertChamada.params[3], null, "profissional_responsavel ausente deve virar null");
});

test("processarPresencaAgendamento: corrida (0 linhas afetadas) responde 409", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 5, status: "confirmado", ja_passou: true }],
  }));
  mockarClientTransacional(t, { statusUpdateRowCount: 0 });
  const res = criarRespostaFalsa();

  await processarPresencaAgendamento(
    criarRequisicao({ params: { id: "5" }, body: { presenca: "compareceu" } }),
    res
  );

  assert.equal(res.statusCode, 409);
});

test("processarPresencaImportado: presença inválida responde 400 sem consultar o banco", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await processarPresencaImportado(
    criarRequisicao({ params: { id: "8" }, body: { presenca: "quaseveio" } }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(consultas.length, 0);
});

test("processarPresencaImportado: id não numérico responde 404 sem consultar o banco", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await processarPresencaImportado(
    criarRequisicao({ params: { id: "abc" }, body: { presenca: "faltou" } }),
    res
  );

  assert.equal(res.statusCode, 404);
  assert.equal(consultas.length, 0);
});

test("processarPresencaImportado: id parcialmente numérico é rejeitado sem consultar o banco", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await processarPresencaImportado(
    criarRequisicao({ params: { id: "1abc" }, body: { presenca: "faltou" } }),
    res
  );

  assert.equal(res.statusCode, 404);
  assert.equal(consultas.length, 0);
});

test("processarPresencaImportado: agendamento importado inexistente responde 404", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const res = criarRespostaFalsa();

  await processarPresencaImportado(
    criarRequisicao({ params: { id: "999" }, body: { presenca: "faltou" } }),
    res
  );

  assert.equal(res.statusCode, 404);
});

test("processarPresencaImportado: agendamento ainda não ocorreu também pode ter presença registrada", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ id: 8, status: "confirmado", ja_passou: false }] }));
  mockarClientTransacional(t, { registroRetornado: { id: 2, presenca: "faltou" } });
  const res = criarRespostaFalsa();

  await processarPresencaImportado(
    criarRequisicao({ params: { id: "8" }, body: { presenca: "faltou" } }),
    res
  );

  assert.equal(res.redirectedTo, "/agendamentos?presenca_msg=Presen%C3%A7a%20registrada.");
});

test("processarPresencaImportado: caminho feliz redireciona pra /agendamentos e passa os params corretos ao modelo", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ id: 8, status: "confirmado", ja_passou: true }] }));
  const chamadas = mockarClientTransacional(t, { registroRetornado: { id: 2, presenca: "faltou" } });
  const res = criarRespostaFalsa();

  await processarPresencaImportado(
    criarRequisicao({
      params: { id: "8" },
      body: {
        presenca: "faltou",
        observacao_sessao: "  Não compareceu  ",
        profissional_responsavel: "  Dr. Carlos  ",
      },
      usuarioId: 9,
    }),
    res
  );

  assert.equal(res.redirectedTo, "/agendamentos?presenca_msg=Presen%C3%A7a%20registrada.");

  const insertChamada = chamadas.find((c) => c.sql.includes("INSERT INTO registros_atendimento"));
  assert.ok(insertChamada, "Deve haver uma chamada INSERT");
  // params: [agendamentoImportadoId, presenca, observacaoSessao, profissionalResponsavel, registradoPor]
  assert.equal(insertChamada.params[0], 8, "agendamentoImportadoId deve ser 8");
  assert.equal(insertChamada.params[1], "faltou", "presenca deve ser faltou");
  assert.equal(insertChamada.params[2], "Não compareceu", "observacao_sessao deve ser trimada");
  assert.equal(insertChamada.params[3], "Dr. Carlos", "profissional_responsavel deve ser trimado");
  assert.equal(insertChamada.params[4], 9, "registradoPor deve ser usuarioId");

  const updateStatusChamada = chamadas.find((c) => c.sql.includes("UPDATE agendamentos_importados"));
  assert.ok(updateStatusChamada, "deve atualizar agendamentos_importados.status");
  assert.deepEqual(updateStatusChamada.params, [8, "faltou"]);
});

test("processarPresencaLote: presença inválida responde 400 sem consultar o banco", async (t) => {
  const consultas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [] };
  });
  const res = criarRespostaFalsa();

  await processarPresencaLote(
    criarRequisicao({ body: { presenca: "quaseveio", itens: ["bot:1"] } }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(consultas.length, 0);
});

test("processarPresencaLote: sem itens selecionados volta pra mesma página com aviso, em vez de página de erro crua", async () => {
  const res = criarRespostaFalsa();

  await processarPresencaLote(
    criarRequisicao({ body: { presenca: "compareceu", itens: [] } }),
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(
    res.redirectedTo,
    "/agendamentos?presenca_msg=Selecione%20ao%20menos%20um%20agendamento%20antes%20de%20marcar%20presen%C3%A7a."
  );
});

test("processarPresencaLote: itens mal-formados são ignorados, só processa os válidos", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ id: 1, status: "confirmado" }] }));
  mockarClientTransacional(t, { registroRetornado: { id: 1, presenca: "compareceu" } });
  const res = criarRespostaFalsa();

  await processarPresencaLote(
    criarRequisicao({
      body: { presenca: "compareceu", itens: ["bot:1", "outraCoisa:2", "bot:abc", ""] },
    }),
    res
  );

  assert.equal(res.redirectedTo, "/agendamentos?presenca_msg=1%20presen%C3%A7a%20registrada.");
});

test("processarPresencaLote: registra presença de itens bot e importado juntos, redireciona com a contagem de sucesso", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("agendamentos_importados")) return { rows: [{ id: 20, status: "confirmado" }] };
    return { rows: [{ id: 10, status: "confirmado" }] };
  });
  mockarClientTransacional(t, { registroRetornado: { id: 1, presenca: "compareceu" } });
  const res = criarRespostaFalsa();

  await processarPresencaLote(
    criarRequisicao({
      body: { presenca: "compareceu", itens: ["bot:10", "importado:20"] },
      usuarioId: 3,
    }),
    res
  );

  assert.equal(res.redirectedTo, "/agendamentos?presenca_msg=2%20presen%C3%A7as%20registradas.");
});

test("processarPresencaLote: item cancelado no meio do lote não impede os outros, mensagem combina sucesso e falha", async (t) => {
  t.mock.method(pool, "query", async (sql, params) => {
    if (params[0] === 99) return { rows: [{ id: 99, status: "cancelado" }] };
    return { rows: [{ id: params[0], status: "confirmado" }] };
  });
  mockarClientTransacional(t, { registroRetornado: { id: 1, presenca: "compareceu" } });
  const res = criarRespostaFalsa();

  await processarPresencaLote(
    criarRequisicao({ body: { presenca: "compareceu", itens: ["bot:10", "bot:99"] } }),
    res
  );

  assert.equal(
    res.redirectedTo,
    "/agendamentos?presenca_msg=1%20presen%C3%A7a%20registrada%2C%201%20falhou%20(cancelado)."
  );
});

test("processarPresencaLote: retorno_url seguro é preservado no redirect", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ id: 1, status: "confirmado" }] }));
  mockarClientTransacional(t, { registroRetornado: { id: 1, presenca: "compareceu" } });
  const res = criarRespostaFalsa();

  await processarPresencaLote(
    criarRequisicao({
      body: {
        presenca: "compareceu",
        itens: ["bot:1"],
        retorno_url: "/agendamentos?status=confirmado&offset=50",
      },
    }),
    res
  );

  assert.equal(
    res.redirectedTo,
    "/agendamentos?status=confirmado&offset=50&presenca_msg=1%20presen%C3%A7a%20registrada."
  );
});

test("processarPresencaLote: retorno_url fora de /agendamentos é ignorado (evita open redirect)", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ id: 1, status: "confirmado" }] }));
  mockarClientTransacional(t, { registroRetornado: { id: 1, presenca: "compareceu" } });
  const res = criarRespostaFalsa();

  await processarPresencaLote(
    criarRequisicao({
      body: { presenca: "compareceu", itens: ["bot:1"], retorno_url: "//malicioso.com/roubar" },
    }),
    res
  );

  assert.equal(res.redirectedTo, "/agendamentos?presenca_msg=1%20presen%C3%A7a%20registrada.");
});

test("processarPresencaLote: retorno_url = /hoje (marcação em lote na tela 'Hoje') é preservado no redirect", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ id: 1, status: "confirmado" }] }));
  mockarClientTransacional(t, { registroRetornado: { id: 1, presenca: "compareceu" } });
  const res = criarRespostaFalsa();

  await processarPresencaLote(
    criarRequisicao({
      body: { presenca: "compareceu", itens: ["bot:1"], retorno_url: "/hoje" },
    }),
    res
  );

  assert.equal(res.redirectedTo, "/hoje?presenca_msg=1%20presen%C3%A7a%20registrada.");
});

function mockarPresencaComAutoPagamento(t, { jaEstavaCompareceu = false, tipoAtendimento = "fisioterapia", pacienteParticular = true, temPacoteAtivo = false, pagamentoJaExiste = false } = {}) {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("SELECT presenca FROM registros_atendimento")) {
      return { rows: jaEstavaCompareceu ? [{ presenca: "compareceu" }] : [] };
    }
    if (
      (sql.includes("FROM agendamentos") && sql.includes("WHERE id")) ||
      (sql.includes("FROM agendamentos_importados") && sql.includes("WHERE id"))
    ) {
      return {
        rows: [
          {
            id: 5,
            status: "confirmado",
            ja_passou: true,
            paciente_id: 42,
            tipo_atendimento: tipoAtendimento,
            primeira_consulta: false,
            telefone: "11999990000",
          },
        ],
      };
    }
    if (sql.includes("tipo_lancamento = 'pagamento'") && sql.includes("agendamento")) {
      return { rows: pagamentoJaExiste ? [{ id: 999 }] : [] };
    }
    if (sql.includes("FROM pacotes_sessoes ps")) {
      return { rows: temPacoteAtivo ? [{ id: 3 }] : [] };
    }
    if (sql.includes("LEFT JOIN convenios c")) {
      return { rows: [{ convenio_id: pacienteParticular ? null : 1, convenio: null, valor_repasse_avaliacao: "45.00", valor_repasse_sessao: "38.00" }] };
    }
    if (sql.includes("INSERT INTO pagamentos")) return { rows: [{ id: 900 }] };
    return { rows: [] };
  });
  mockarClientTransacional(t, { registroRetornado: { id: 1, presenca: "compareceu" } });
  return chamadas;
}

test("processarPresencaAgendamento: primeira marcação de compareceu (fisioterapia particular) gera pagamento automático", async (t) => {
  const chamadas = mockarPresencaComAutoPagamento(t, { jaEstavaCompareceu: false });
  const res = criarRespostaFalsa();

  await processarPresencaAgendamento(
    criarRequisicao({ params: { id: "5" }, body: { presenca: "compareceu" } }),
    res
  );

  assert.equal(res.redirectedTo, "/agendamentos?presenca_msg=Presen%C3%A7a%20registrada.");
  assert.ok(chamadas.some(({ sql }) => sql.includes("INSERT INTO pagamentos")), "deveria ter gerado um pagamento automático");
});

test("processarPresencaAgendamento: corrigir uma linha que já estava compareceu não gera pagamento de novo", async (t) => {
  const chamadas = mockarPresencaComAutoPagamento(t, { jaEstavaCompareceu: true });
  const res = criarRespostaFalsa();

  await processarPresencaAgendamento(
    criarRequisicao({ params: { id: "5" }, body: { presenca: "compareceu", observacao_sessao: "ajuste" } }),
    res
  );

  assert.equal(res.redirectedTo, "/agendamentos?presenca_msg=Presen%C3%A7a%20registrada.");
  assert.ok(!chamadas.some(({ sql }) => sql.includes("INSERT INTO pagamentos")), "correção não deveria gerar pagamento novo");
});

test("processarPresencaAgendamento: marcar faltou não gera pagamento", async (t) => {
  const chamadas = mockarPresencaComAutoPagamento(t, { jaEstavaCompareceu: false });
  const res = criarRespostaFalsa();

  await processarPresencaAgendamento(
    criarRequisicao({ params: { id: "5" }, body: { presenca: "faltou" } }),
    res
  );

  assert.ok(!chamadas.some(({ sql }) => sql.includes("INSERT INTO pagamentos")));
});

test("processarPresencaAgendamento: Psicologia não gera pagamento automático", async (t) => {
  const chamadas = mockarPresencaComAutoPagamento(t, { jaEstavaCompareceu: false, tipoAtendimento: "psicologia" });
  const res = criarRespostaFalsa();

  await processarPresencaAgendamento(
    criarRequisicao({ params: { id: "5" }, body: { presenca: "compareceu" } }),
    res
  );

  assert.ok(!chamadas.some(({ sql }) => sql.includes("INSERT INTO pagamentos")));
});

test("processarPresencaAgendamento: paciente com pacote ativo não gera pagamento novo", async (t) => {
  const chamadas = mockarPresencaComAutoPagamento(t, { jaEstavaCompareceu: false, temPacoteAtivo: true });
  const res = criarRespostaFalsa();

  await processarPresencaAgendamento(
    criarRequisicao({ params: { id: "5" }, body: { presenca: "compareceu" } }),
    res
  );

  assert.ok(!chamadas.some(({ sql }) => sql.includes("INSERT INTO pagamentos")));
});
