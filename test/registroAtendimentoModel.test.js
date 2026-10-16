import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { listarPresenca, buscarPresencaAtual } from "../src/models/registroAtendimentoModel.js";

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

test("listarPresenca: combina itens do bot e importados, mais recente primeiro", async (t) => {
  mockarConsultas(t, {
    bot: [{ id: 1, origem: "bot", data: "2026-08-20", hora: "10:00:00" }],
    importados: [{ id: 2, origem: "importado", data: "2026-08-25", hora: "09:00:00" }],
  });

  const itens = await listarPresenca({});

  assert.deepEqual(
    itens.map((i) => i.origem),
    ["importado", "bot"]
  );
});

test("listarPresenca: aplica limite e offset sobre a lista já combinada", async (t) => {
  mockarConsultas(t, {
    bot: [
      { id: 1, data: "2026-08-20", hora: "10:00:00" },
      { id: 2, data: "2026-08-21", hora: "10:00:00" },
      { id: 3, data: "2026-08-22", hora: "10:00:00" },
    ],
  });

  const itens = await listarPresenca({ limite: 1, offset: 1 });

  assert.equal(itens.length, 1);
  assert.equal(itens[0].id, 2);
});

test("listarPresenca: por padrão (todos ausente) filtra só pendentes nas duas queries", async (t) => {
  const chamadas = mockarConsultas(t);

  await listarPresenca({});

  assert.equal(chamadas.length, 2);
  for (const { sql } of chamadas) {
    assert.match(sql, /ra\.id IS NULL/);
  }
});

test("listarPresenca: com todos=true não filtra por registro pendente", async (t) => {
  const chamadas = mockarConsultas(t);

  await listarPresenca({ todos: true });

  for (const { sql } of chamadas) {
    assert.doesNotMatch(sql, /ra\.id IS NULL/);
  }
});

test("listarPresenca: janela de busca de cada fonte é offset + limite (não um LIMIT fixo)", async (t) => {
  const chamadas = mockarConsultas(t);

  await listarPresenca({ limite: 20, offset: 150 });

  assert.equal(chamadas.length, 2);
  for (const { params } of chamadas) {
    assert.deepEqual(params, [170]);
  }
});

// Finding 5 do review final: agendamentos_importados ganhou status na
// migration 020 — um importado cancelado pela recepção não pode continuar
// aparecendo na fila de presença.
test("listarPresenca: query de importados exclui cancelado (só confirmado/compareceu/faltou)", async (t) => {
  const chamadas = mockarConsultas(t);

  await listarPresenca({});

  const chamadaImportados = chamadas.find((c) => c.sql.includes("agendamentos_importados"));
  assert.match(chamadaImportados.sql, /ai\.status IN \('confirmado', 'compareceu', 'faltou'\)/);
});

test("listarPresenca: janela é capada em LIMITE_MAXIMO_LISTAGEM (200) mesmo com limite grande", async (t) => {
  const chamadas = mockarConsultas(t);

  await listarPresenca({ limite: 500, offset: 100 });

  for (const { params } of chamadas) {
    assert.deepEqual(params, [300]);
  }
});

test("listarPresenca: limite negativo é elevado a 1 (não vira índice final negativo no slice)", async (t) => {
  mockarConsultas(t, {
    bot: [
      { id: 1, data: "2026-08-20", hora: "10:00:00" },
      { id: 2, data: "2026-08-21", hora: "10:00:00" },
      { id: 3, data: "2026-08-22", hora: "10:00:00" },
    ],
  });

  // Antes da correção, limite: -1 virava Array.slice(0, -1) — removia o
  // último item da lista em vez de devolver uma página vazia/mínima.
  const itens = await listarPresenca({ limite: -1, offset: 0 });

  assert.equal(itens.length, 1);
  assert.equal(itens[0].id, 3);
});

import { registrarPresencaBot, registrarPresencaImportado } from "../src/models/registroAtendimentoModel.js";

function mockarClientTransacional(t, { statusUpdateRowCount = 1, registroRetornado = {} } = {}) {
  const chamadas = [];
  const client = {
    query: async (sql, params) => {
      chamadas.push({ sql, params });
      if (sql.includes("UPDATE agendamentos")) {
        return { rowCount: statusUpdateRowCount };
      }
      if (sql.includes("INSERT INTO registros_atendimento")) {
        return { rows: [registroRetornado] };
      }
      return {};
    },
    release: () => {},
  };
  t.mock.method(pool, "connect", async () => client);
  return chamadas;
}

test("registrarPresencaBot: agendamento inexistente retorna motivo nao_encontrado", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await registrarPresencaBot({
    agendamentoId: 999,
    presenca: "compareceu",
    observacaoSessao: null,
    registradoPor: 1,
  });

  assert.deepEqual(resultado, { motivo: "nao_encontrado" });
});

test("registrarPresencaBot: agendamento cancelado retorna motivo cancelado", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 5, status: "cancelado", ja_passou: true }],
  }));

  const resultado = await registrarPresencaBot({
    agendamentoId: 5,
    presenca: "compareceu",
    observacaoSessao: null,
    registradoPor: 1,
  });

  assert.deepEqual(resultado, { motivo: "cancelado" });
});

test("registrarPresencaBot: agendamento ainda no futuro também pode ter presença registrada", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 5, status: "confirmado", ja_passou: false }],
  }));
  const registroEsperado = { id: 1, agendamento_id: 5, presenca: "compareceu" };
  mockarClientTransacional(t, { registroRetornado: registroEsperado });

  const resultado = await registrarPresencaBot({
    agendamentoId: 5,
    presenca: "compareceu",
    observacaoSessao: null,
    registradoPor: 1,
  });

  assert.deepEqual(resultado, { registro: registroEsperado });
});

test("registrarPresencaBot: caminho feliz atualiza status e grava o registro numa transação", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 5, status: "confirmado", ja_passou: true }],
  }));
  const registroEsperado = { id: 1, agendamento_id: 5, presenca: "compareceu" };
  const chamadas = mockarClientTransacional(t, { registroRetornado: registroEsperado });

  const resultado = await registrarPresencaBot({
    agendamentoId: 5,
    presenca: "compareceu",
    observacaoSessao: "Evoluiu bem",
    profissionalResponsavel: "Dra. Ana",
    registradoPor: 7,
  });

  assert.deepEqual(resultado, { registro: registroEsperado });
  assert.equal(chamadas[0].sql, "BEGIN");
  assert.match(chamadas[1].sql, /UPDATE agendamentos/);
  assert.match(chamadas[2].sql, /INSERT INTO registros_atendimento/);
  assert.equal(chamadas[3].sql, "COMMIT");
  // params: [agendamentoId, presenca, observacaoSessao, profissionalResponsavel, registradoPor]
  assert.deepEqual(chamadas[2].params, [5, "compareceu", "Evoluiu bem", "Dra. Ana", 7, null]);
});

// pacoteExistente simula o que a linha de registros_atendimento JÁ tem
// gravado em pacote_id antes desta chamada (null = sem vínculo prévio, ex:
// primeira marcação de compareceu, ou um compareceu que veio depois de um
// faltou que limpou o vínculo). pacoteEncontrado simula o resultado do
// lookup fresco de pacote ativo (só roda quando pacoteExistente é null —
// ver Finding 1/2 do review final: uma correção com vínculo já existente
// nunca deve refazer esse lookup).
function mockarClientComPacote(
  t,
  { pacoteExistente = null, pacoteEncontrado = null, registroRetornado = {} } = {}
) {
  const chamadas = [];
  const client = {
    query: async (sql, params) => {
      chamadas.push({ sql, params });
      if (sql.includes("UPDATE agendamentos")) {
        return { rowCount: 1 };
      }
      if (sql.includes("SELECT pacote_id FROM registros_atendimento")) {
        return { rows: pacoteExistente ? [{ pacote_id: pacoteExistente }] : [] };
      }
      if (sql.includes("FROM pacotes_sessoes")) {
        return { rows: pacoteEncontrado ? [pacoteEncontrado] : [] };
      }
      if (sql.includes("INSERT INTO registros_atendimento")) {
        return { rows: [registroRetornado] };
      }
      return {};
    },
    release: () => {},
  };
  t.mock.method(pool, "connect", async () => client);
  return chamadas;
}

test("registrarPresencaBot: fisioterapia com pacote ativo vincula pacote_id automaticamente", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 5, status: "confirmado", ja_passou: true, paciente_id: 42, tipo_atendimento: "fisioterapia" }],
  }));
  const registroEsperado = { id: 1, agendamento_id: 5, presenca: "compareceu", pacote_id: 9 };
  const chamadas = mockarClientComPacote(t, {
    pacoteEncontrado: { id: 9 },
    registroRetornado: registroEsperado,
  });

  const resultado = await registrarPresencaBot({
    agendamentoId: 5,
    presenca: "compareceu",
    observacaoSessao: null,
    profissionalResponsavel: null,
    registradoPor: 7,
  });

  assert.deepEqual(resultado, { registro: registroEsperado });
  const buscaPacote = chamadas.find((c) => c.sql.includes("FROM pacotes_sessoes"));
  assert.ok(buscaPacote, "deve consultar o pacote ativo do paciente");
  assert.deepEqual(buscaPacote.params, [42]);
  const insertChamada = chamadas.find((c) => c.sql.includes("INSERT INTO registros_atendimento"));
  assert.equal(insertChamada.params[5], 9, "pacote_id deve ser o pacote encontrado");
});

test("registrarPresencaBot: fisioterapia sem pacote ativo grava pacote_id null", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 5, status: "confirmado", ja_passou: true, paciente_id: 42, tipo_atendimento: "fisioterapia" }],
  }));
  const chamadas = mockarClientComPacote(t, { pacoteEncontrado: null, registroRetornado: { id: 1 } });

  await registrarPresencaBot({
    agendamentoId: 5,
    presenca: "compareceu",
    observacaoSessao: null,
    registradoPor: 7,
  });

  const insertChamada = chamadas.find((c) => c.sql.includes("INSERT INTO registros_atendimento"));
  assert.equal(insertChamada.params[5], null);
});

test("registrarPresencaBot: marcar faltou não busca pacote e limpa pacote_id (corrige um compareceu anterior)", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 5, status: "compareceu", ja_passou: true, paciente_id: 42, tipo_atendimento: "fisioterapia" }],
  }));
  const chamadas = mockarClientComPacote(t, { pacoteEncontrado: { id: 9 }, registroRetornado: { id: 1 } });

  await registrarPresencaBot({
    agendamentoId: 5,
    presenca: "faltou",
    observacaoSessao: null,
    registradoPor: 7,
  });

  const buscaPacote = chamadas.find((c) => c.sql.includes("FROM pacotes_sessoes"));
  assert.equal(buscaPacote, undefined, "não deve consultar pacote quando presença é faltou");
  const insertChamada = chamadas.find((c) => c.sql.includes("INSERT INTO registros_atendimento"));
  assert.equal(insertChamada.params[5], null, "pacote_id deve voltar a null");
});

test("registrarPresencaBot: lookup fresco de pacote ativo adquire advisory lock escopado no paciente antes de buscar", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 5, status: "confirmado", ja_passou: true, paciente_id: 42, tipo_atendimento: "fisioterapia" }],
  }));
  const chamadas = mockarClientComPacote(t, {
    pacoteEncontrado: { id: 9 },
    registroRetornado: { id: 1, pacote_id: 9 },
  });

  await registrarPresencaBot({
    agendamentoId: 5,
    presenca: "compareceu",
    observacaoSessao: null,
    registradoPor: 7,
  });

  const indiceLock = chamadas.findIndex((c) => /pg_advisory_xact_lock/.test(c.sql));
  const indiceBusca = chamadas.findIndex((c) => c.sql.includes("FROM pacotes_sessoes"));
  assert.notEqual(indiceLock, -1, "deve adquirir advisory lock antes do lookup fresco de pacote ativo");
  assert.deepEqual(chamadas[indiceLock].params, [42], "lock deve ser escopado no paciente_id, não no pacote");
  assert.ok(indiceLock < indiceBusca, "lock deve ser adquirido antes da busca de pacote ativo");
});

// Finding 1 (crítico) do review final: reproduz exatamente o cenário do
// bug — uma correção (ex: ajustar a observação) num registro que JÁ está
// marcado compareceu e JÁ está vinculado a um pacote que agora está cheio
// (10/10, sendo esta uma das 10 sessões contadas). O lookup fresco, se
// rodasse, veria "10 < 10 = falso" e não acharia nenhum pacote ativo
// (pacoteEncontrado: null simula exatamente isso) — o que desvincularia
// (ou pior, relincaria a outro pacote) essa sessão corretamente contada.
test("registrarPresencaBot: correção de compareceu com pacote já vinculado preserva o vínculo mesmo com o pacote cheio agora", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 5, status: "compareceu", ja_passou: true, paciente_id: 42, tipo_atendimento: "fisioterapia" }],
  }));
  const chamadas = mockarClientComPacote(t, {
    pacoteExistente: 9,
    pacoteEncontrado: null,
    registroRetornado: { id: 1, pacote_id: 9 },
  });

  const resultado = await registrarPresencaBot({
    agendamentoId: 5,
    presenca: "compareceu",
    observacaoSessao: "corrigindo só a observação, presença não muda",
    registradoPor: 7,
  });

  assert.deepEqual(resultado, { registro: { id: 1, pacote_id: 9 } });
  const buscaPacoteFresco = chamadas.find((c) => c.sql.includes("FROM pacotes_sessoes"));
  assert.equal(
    buscaPacoteFresco,
    undefined,
    "não deve refazer o lookup de pacote ativo quando a linha já tem vínculo"
  );
  const lockChamada = chamadas.find((c) => /pg_advisory_xact_lock/.test(c.sql));
  assert.equal(
    lockChamada,
    undefined,
    "não deve adquirir o lock quando nenhum recompute é necessário"
  );
  const insertChamada = chamadas.find((c) => c.sql.includes("INSERT INTO registros_atendimento"));
  assert.equal(
    insertChamada.params[5],
    9,
    "pacote_id deve permanecer o vínculo já existente, não null nem outro pacote"
  );
});

test("registrarPresencaBot: compareceu -> faltou -> compareceu de novo refaz o lookup (vínculo foi limpo no meio)", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 5, status: "confirmado", ja_passou: true, paciente_id: 42, tipo_atendimento: "fisioterapia" }],
  }));

  // Passo 1: primeira marcação de compareceu, sem vínculo prévio — faz o
  // lookup e acha o pacote 9.
  mockarClientComPacote(t, {
    pacoteExistente: null,
    pacoteEncontrado: { id: 9 },
    registroRetornado: { id: 1, pacote_id: 9 },
  });
  const passo1 = await registrarPresencaBot({
    agendamentoId: 5,
    presenca: "compareceu",
    observacaoSessao: null,
    registradoPor: 7,
  });
  assert.equal(passo1.registro.pacote_id, 9);

  // Passo 2: corrige pra faltou — limpa o vínculo (comportamento já
  // existente, preservado por esta mudança).
  mockarClientComPacote(t, {
    pacoteExistente: 9,
    pacoteEncontrado: { id: 9 },
    registroRetornado: { id: 1, pacote_id: null },
  });
  const passo2 = await registrarPresencaBot({
    agendamentoId: 5,
    presenca: "faltou",
    observacaoSessao: null,
    registradoPor: 7,
  });
  assert.equal(passo2.registro.pacote_id, null);

  // Passo 3: marca compareceu de novo — não há vínculo existente (foi
  // limpo no passo 2), então deve refazer o lookup do zero. Simula que,
  // nesse momento, o pacote ativo é outro (ex: o 9 esgotou nesse
  // meio-tempo e um pacote novo foi criado) — só pra deixar claro que o
  // valor final vem de um lookup novo, não de um valor "lembrado".
  const chamadasPasso3 = mockarClientComPacote(t, {
    pacoteExistente: null,
    pacoteEncontrado: { id: 11 },
    registroRetornado: { id: 1, pacote_id: 11 },
  });
  const passo3 = await registrarPresencaBot({
    agendamentoId: 5,
    presenca: "compareceu",
    observacaoSessao: null,
    registradoPor: 7,
  });

  assert.equal(
    passo3.registro.pacote_id,
    11,
    "após o vínculo ser limpo pelo faltou, deve refazer o lookup e pegar o pacote ativo atual"
  );
  const buscaPacoteFresco = chamadasPasso3.find((c) => c.sql.includes("FROM pacotes_sessoes"));
  assert.ok(buscaPacoteFresco, "deve refazer o lookup quando não há vínculo existente");
  const lockChamada = chamadasPasso3.find((c) => /pg_advisory_xact_lock/.test(c.sql));
  assert.ok(lockChamada, "deve adquirir o lock advisory antes do lookup fresco");
});

test("registrarPresencaBot: psicologia nunca busca nem vincula pacote", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 6, status: "confirmado", ja_passou: true, paciente_id: 42, tipo_atendimento: "psicologia" }],
  }));
  const chamadas = mockarClientComPacote(t, { pacoteEncontrado: { id: 9 }, registroRetornado: { id: 2 } });

  await registrarPresencaBot({
    agendamentoId: 6,
    presenca: "compareceu",
    observacaoSessao: null,
    registradoPor: 7,
  });

  const buscaPacote = chamadas.find((c) => c.sql.includes("FROM pacotes_sessoes"));
  assert.equal(buscaPacote, undefined);
});

test("registrarPresencaBot: UPDATE afetando 0 linhas (corrida) retorna motivo conflito e faz ROLLBACK", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 5, status: "confirmado", ja_passou: true }],
  }));
  const chamadas = mockarClientTransacional(t, { statusUpdateRowCount: 0 });

  const resultado = await registrarPresencaBot({
    agendamentoId: 5,
    presenca: "compareceu",
    observacaoSessao: null,
    registradoPor: 7,
  });

  assert.deepEqual(resultado, { motivo: "conflito" });
  assert.equal(chamadas.at(-1).sql, "ROLLBACK");
});

test("registrarPresencaBot: erro no meio da transação propaga, faz ROLLBACK e libera o client", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 5, status: "confirmado", ja_passou: true }],
  }));

  const chamadas = [];
  let releaseChamado = false;
  const erroSimulado = new Error("falha simulada no INSERT");
  const client = {
    query: async (sql, params) => {
      chamadas.push({ sql, params });
      if (sql.includes("UPDATE agendamentos")) {
        return { rowCount: 1 };
      }
      if (sql.includes("INSERT INTO registros_atendimento")) {
        throw erroSimulado;
      }
      return {};
    },
    release: () => {
      releaseChamado = true;
    },
  };
  t.mock.method(pool, "connect", async () => client);

  await assert.rejects(
    () =>
      registrarPresencaBot({
        agendamentoId: 5,
        presenca: "compareceu",
        observacaoSessao: null,
        registradoPor: 7,
      }),
    erroSimulado
  );

  assert.equal(chamadas.at(-1).sql, "ROLLBACK");
  assert.equal(releaseChamado, true, "client.release() deve ser chamado mesmo em caso de erro");
});

test("registrarPresencaImportado: agendamento inexistente retorna motivo nao_encontrado", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await registrarPresencaImportado({
    agendamentoImportadoId: 999,
    presenca: "faltou",
    observacaoSessao: null,
    registradoPor: 1,
  });

  assert.deepEqual(resultado, { motivo: "nao_encontrado" });
});

// Finding 6 do review final: agendamentos_importados ganhou status na
// migration 020 — cancelado pela recepção não pode voltar a ser marcado
// compareceu/faltou.
test("registrarPresencaImportado: agendamento cancelado retorna motivo cancelado", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 8, status: "cancelado", ja_passou: true }],
  }));

  const resultado = await registrarPresencaImportado({
    agendamentoImportadoId: 8,
    presenca: "faltou",
    observacaoSessao: null,
    registradoPor: 1,
  });

  assert.deepEqual(resultado, { motivo: "cancelado" });
});

test("registrarPresencaImportado: agendamento ainda no futuro também pode ter presença registrada", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 8, status: "confirmado", ja_passou: false }],
  }));
  const registroEsperado = { id: 2, agendamento_importado_id: 8, presenca: "faltou" };
  mockarClientTransacional(t, { registroRetornado: registroEsperado });

  const resultado = await registrarPresencaImportado({
    agendamentoImportadoId: 8,
    presenca: "faltou",
    observacaoSessao: null,
    registradoPor: 1,
  });

  assert.deepEqual(resultado, { registro: registroEsperado });
});

test("registrarPresencaImportado: caminho feliz atualiza status de agendamentos_importados e grava o registro numa transação", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 8, status: "confirmado", ja_passou: true }],
  }));
  const registroEsperado = { id: 2, agendamento_importado_id: 8, presenca: "faltou" };
  const chamadas = mockarClientTransacional(t, { registroRetornado: registroEsperado });

  const resultado = await registrarPresencaImportado({
    agendamentoImportadoId: 8,
    presenca: "faltou",
    observacaoSessao: null,
    profissionalResponsavel: null,
    registradoPor: 7,
  });

  assert.deepEqual(resultado, { registro: registroEsperado });
  assert.equal(chamadas[0].sql, "BEGIN");
  assert.match(chamadas[1].sql, /UPDATE agendamentos_importados SET status/);
  assert.deepEqual(chamadas[1].params, [8, "faltou"]);
  assert.match(chamadas[2].sql, /INSERT INTO registros_atendimento/);
  assert.equal(chamadas[3].sql, "COMMIT");
  // params: [agendamentoImportadoId, presenca, observacaoSessao, profissionalResponsavel, registradoPor]
  assert.deepEqual(chamadas[2].params, [8, "faltou", null, null, 7]);
});

// UPDATE afetando 0 linhas simula a corrida: o agendamento foi cancelado
// entre a pré-checagem (buscarImportadoParaPresenca) e o UPDATE dentro da
// transação — o WHERE status <> 'cancelado' protege contra sobrescrever o
// cancelamento de volta pra compareceu/faltou.
test("registrarPresencaImportado: UPDATE afetando 0 linhas (corrida) retorna motivo conflito, faz ROLLBACK e não sobrescreve o status", async (t) => {
  t.mock.method(pool, "query", async () => ({
    rows: [{ id: 8, status: "confirmado", ja_passou: true }],
  }));
  const chamadas = mockarClientTransacional(t, { statusUpdateRowCount: 0 });

  const resultado = await registrarPresencaImportado({
    agendamentoImportadoId: 8,
    presenca: "compareceu",
    observacaoSessao: null,
    registradoPor: 7,
  });

  assert.deepEqual(resultado, { motivo: "conflito" });
  assert.equal(chamadas.at(-1).sql, "ROLLBACK");
  assert.ok(
    !chamadas.some((c) => c.sql.includes("INSERT INTO registros_atendimento")),
    "não deve gravar registro de presença quando o UPDATE de status não afetou nenhuma linha"
  );
});

test("buscarPresencaAtual: devolve a presença gravada pra um agendamento do bot", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [{ presenca: "compareceu" }] };
  });

  const resultado = await buscarPresencaAtual({ agendamentoId: 5 });

  assert.equal(resultado, "compareceu");
  assert.deepEqual(chamadas[0].params, [5, null]);
});

test("buscarPresencaAtual: devolve a presença gravada pra um agendamento importado", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ presenca: "faltou" }] }));

  const resultado = await buscarPresencaAtual({ agendamentoImportadoId: 9 });

  assert.equal(resultado, "faltou");
});

test("buscarPresencaAtual: sem registro ainda, devolve null", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await buscarPresencaAtual({ agendamentoId: 5 });

  assert.equal(resultado, null);
});
