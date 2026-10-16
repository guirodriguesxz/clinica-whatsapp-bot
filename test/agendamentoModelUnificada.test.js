import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import {
  listarAgendaUnificada,
  buscarAgendamentoComPacientePorId,
  cancelarAgendamentoConfirmado,
  cancelarAgendamentoImportado,
  remarcarAgendamentoImportado,
  buscarAgendamentoImportadoPorId,
  buscarAgendamentoConfirmadoDoPacienteNaData,
} from "../src/models/agendamentoModel.js";

function mockarQuery(t, { bot = [], importado = [] } = {}) {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("agendamentos_importados")) return { rows: importado };
    return { rows: bot };
  });
  return chamadas;
}

test("listarAgendaUnificada: sem filtros, busca as duas origens e ordena por data/hora crescente", async (t) => {
  const chamadas = mockarQuery(t, {
    bot: [{ id: 1, origem: "bot", data: "2026-09-05", hora: "09:00:00" }],
    importado: [{ id: 2, origem: "importado", data: "2026-09-03", hora: "08:00:00" }],
  });

  const resultado = await listarAgendaUnificada({});

  assert.equal(chamadas.length, 2, "deve consultar as duas origens");
  assert.deepEqual(
    resultado.map((r) => r.id),
    [2, 1],
    "importado (03/09) deve vir antes do bot (05/09)"
  );
});

test("listarAgendaUnificada: a query da origem bot seleciona criado_por_usuario_id (traceabilidade manual vs. bot)", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({});

  const botChamada = chamadas.find((c) => !c.sql.includes("agendamentos_importados"));
  assert.match(botChamada.sql, /a\.criado_por_usuario_id/);
});

test("listarAgendaUnificada: a query da origem importado seleciona o campo atendente (pra impressão da agenda no formato antigo)", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({});

  const importadaChamada = chamadas.find((c) => c.sql.includes("agendamentos_importados"));
  assert.match(importadaChamada.sql, /ai\.atendente/);
});

test("listarAgendaUnificada: a query da origem importado traz o convênio (texto do import, com fallback pro convênio do paciente vinculado)", async (t) => {
  // Achado real (2026-09-17): essa coluna vinha hardcoded NULL::text, então
  // agendamento importado nunca mostrava convênio nenhum na Agenda (tela ou
  // impressão), mesmo quando ai.convenio ou o paciente já tinham o dado.
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({});

  const importadaChamada = chamadas.find((c) => c.sql.includes("agendamentos_importados"));
  assert.match(importadaChamada.sql, /COALESCE\(ai\.convenio, p\.convenio\) AS paciente_convenio/);
  assert.doesNotMatch(importadaChamada.sql, /NULL::text AS paciente_convenio/);
});

test("listarAgendaUnificada: a query da origem importado resolve paciente_id casando telefone com a tabela pacientes (pro botão de imprimir ficha)", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({});

  const importadaChamada = chamadas.find((c) => c.sql.includes("agendamentos_importados"));
  assert.match(importadaChamada.sql, /LEFT JOIN pacientes p ON/);
  assert.match(importadaChamada.sql, /p\.id AS paciente_id/);
  assert.match(importadaChamada.sql, /regexp_replace\(p\.telefone, '\\D', '', 'g'\) = regexp_replace\(ai\.telefone, '\\D', '', 'g'\)/);
});

test("listarAgendaUnificada: sem filtro de origem, consulta as duas origens normalmente", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({});

  assert.equal(chamadas.length, 2);
});

test("listarAgendaUnificada: origem 'importado' nem chega a consultar agendamentos (tabela bot)", async (t) => {
  const chamadas = mockarQuery(t, { importado: [{ id: 9, origem: "importado", data: "2026-09-05", hora: "09:00:00" }] });

  const resultado = await listarAgendaUnificada({ origem: "importado" });

  assert.equal(chamadas.length, 1, "só a query de agendamentos_importados deve rodar");
  assert.match(chamadas[0].sql, /agendamentos_importados/);
  assert.deepEqual(resultado.map((r) => r.id), [9]);
});

test("listarAgendaUnificada: origem 'bot' nem chega a consultar agendamentos_importados, e filtra criado_por_usuario_id IS NULL", async (t) => {
  const chamadas = mockarQuery(t, { bot: [{ id: 7, origem: "bot", data: "2026-09-05", hora: "09:00:00" }] });

  const resultado = await listarAgendaUnificada({ origem: "bot" });

  assert.equal(chamadas.length, 1, "só a query de agendamentos (bot) deve rodar");
  assert.doesNotMatch(chamadas[0].sql, /agendamentos_importados/);
  assert.equal(chamadas[0].params.at(-2), "bot");
  assert.deepEqual(resultado.map((r) => r.id), [7]);
});

test("listarAgendaUnificada: origem 'manual' nem chega a consultar agendamentos_importados, e filtra criado_por_usuario_id IS NOT NULL", async (t) => {
  const chamadas = mockarQuery(t, { bot: [{ id: 8, origem: "bot", data: "2026-09-05", hora: "09:00:00" }] });

  const resultado = await listarAgendaUnificada({ origem: "manual" });

  assert.equal(chamadas.length, 1, "só a query de agendamentos (bot) deve rodar");
  assert.equal(chamadas[0].params.at(-2), "manual");
  assert.deepEqual(resultado.map((r) => r.id), [8]);
});

test("listarAgendaUnificada: origem inválida é ignorada (tratada como sem filtro)", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({ origem: "outra-coisa" });

  assert.equal(chamadas.length, 2);
  for (const { params } of chamadas) {
    if (params.length === 10) assert.equal(params.at(-2), null);
  }
});

test("listarAgendaUnificada: avaliacao='avaliacao' consulta as duas origens, filtrando primeira_consulta = true em cada uma", async (t) => {
  const chamadas = mockarQuery(t, {
    bot: [{ id: 11, origem: "bot", data: "2026-09-05", hora: "09:00:00" }],
    importado: [{ id: 21, origem: "importado", data: "2026-09-06", hora: "09:00:00" }],
  });

  const resultado = await listarAgendaUnificada({ avaliacao: "avaliacao" });

  assert.equal(chamadas.length, 2, "as duas origens devem rodar");
  for (const { params } of chamadas) {
    assert.equal(params.at(-1), true);
  }
  assert.deepEqual(
    resultado.map((r) => r.id),
    [11, 21]
  );
});

test("listarAgendaUnificada: avaliacao='retorno' filtra primeira_consulta = false nas duas origens", async (t) => {
  const chamadas = mockarQuery(t, { bot: [{ id: 12, origem: "bot", data: "2026-09-05", hora: "09:00:00" }] });

  await listarAgendaUnificada({ avaliacao: "retorno" });

  assert.equal(chamadas.length, 2);
  for (const { params } of chamadas) {
    assert.equal(params.at(-1), false);
  }
});

test("listarAgendaUnificada: sem filtro de avaliacao, consulta as duas origens normalmente", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({});

  assert.equal(chamadas.length, 2);
});

test("listarAgendaUnificada: valor inválido de avaliacao é ignorado (tratado como sem filtro)", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({ avaliacao: "outra-coisa" });

  assert.equal(chamadas.length, 2);
});

test("listarAgendaUnificada: sem filtro de data, aplica data >= hoje nas duas origens", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({});

  for (const { sql, params } of chamadas) {
    assert.equal(params[1], null, "parâmetro de data deve ser null (sem filtro explícito)");
    assert.match(sql, /data >= \(now\(\) AT TIME ZONE 'America\/Sao_Paulo'\)::date/);
  }
});

test("listarAgendaUnificada: filtro de data explícito ignora a regra 'a partir de hoje'", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({ data: "2026-08-20" });

  for (const { params } of chamadas) {
    assert.equal(params[1], "2026-08-20");
  }
});

test("listarAgendaUnificada: data inválida é ignorada (tratada como sem filtro)", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({ data: "20-08-2026" });

  assert.equal(chamadas[0].params[1], null);
});

test("listarAgendaUnificada: filtro de status consulta as duas origens", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({ status: "cancelado" });

  assert.equal(chamadas.length, 2, "deve consultar bot e importados mesmo com status definido");
  const botChamada = chamadas.find((c) => !c.sql.includes("agendamentos_importados"));
  const importadoChamada = chamadas.find((c) => c.sql.includes("agendamentos_importados"));
  assert.equal(botChamada.params[2], "cancelado");
  assert.equal(importadoChamada.params[2], "cancelado");
});

test("listarAgendaUnificada: sem filtro de status, a query exclui cancelado (visão padrão limpa)", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({});

  const botChamada = chamadas.find((c) => !c.sql.includes("agendamentos_importados"));
  const importadoChamada = chamadas.find((c) => c.sql.includes("agendamentos_importados"));
  // A prova real está no parâmetro (null = sem filtro) — o texto da cláusula
  // só confirma que ela existe, não que o parâmetro certo chega até ela.
  assert.equal(botChamada.params[2], null, "sem filtro, o parâmetro de status deve ser null");
  assert.equal(importadoChamada.params[2], null, "sem filtro, o parâmetro de status deve ser null");
  assert.match(botChamada.sql, /\$3::text IS NULL AND a\.status <> 'cancelado'/);
  assert.match(importadoChamada.sql, /\$3::text IS NULL AND ai\.status <> 'cancelado'/);
});

test("listarAgendaUnificada: filtro explícito por status=cancelado ainda funciona (não exclui)", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({ status: "cancelado" });

  const botChamada = chamadas.find((c) => !c.sql.includes("agendamentos_importados"));
  const importadoChamada = chamadas.find((c) => c.sql.includes("agendamentos_importados"));
  assert.equal(botChamada.params[2], "cancelado");
  assert.equal(importadoChamada.params[2], "cancelado");
  assert.match(botChamada.sql, /\$3::text IS NOT NULL AND a\.status = \$3/);
});

test("listarAgendaUnificada: filtro explícito por status=confirmado não deixa cancelado passar", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({ status: "confirmado" });

  const botChamada = chamadas.find((c) => !c.sql.includes("agendamentos_importados"));
  const importadoChamada = chamadas.find((c) => c.sql.includes("agendamentos_importados"));
  assert.equal(botChamada.params[2], "confirmado");
  assert.equal(importadoChamada.params[2], "confirmado");
});

test("listarAgendaUnificada: status inválido é ignorado e as duas origens são consultadas", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({ status: "inventado" });

  assert.equal(chamadas.length, 2);
});

test("listarAgendaUnificada: filtro de tipo de atendimento aplica nas duas origens", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({ tipoAtendimento: "psicologia" });

  const botChamada = chamadas.find((c) => !c.sql.includes("agendamentos_importados"));
  const importadoChamada = chamadas.find((c) => c.sql.includes("agendamentos_importados"));
  assert.equal(botChamada.params[3], "psicologia");
  assert.equal(importadoChamada.params[3], "psicologia");
});

test("listarAgendaUnificada: filtro de período (manha/tarde) aplica nas duas origens", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({ periodo: "manha" });

  const botChamada = chamadas.find((c) => !c.sql.includes("agendamentos_importados"));
  const importadoChamada = chamadas.find((c) => c.sql.includes("agendamentos_importados"));
  assert.equal(botChamada.params[6], "manha");
  assert.equal(importadoChamada.params[6], "manha");
  assert.match(botChamada.sql, /hora < '12:00:00'/);
});

test("listarAgendaUnificada: período inválido é ignorado (tratado como sem filtro)", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({ periodo: "noite" });

  const botChamada = chamadas.find((c) => !c.sql.includes("agendamentos_importados"));
  assert.equal(botChamada.params[6], null);
});

test("listarAgendaUnificada: filtro por psicólogo aplica nas duas origens", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({ psicologoId: "3" });

  const botChamada = chamadas.find((c) => !c.sql.includes("agendamentos_importados"));
  const importadoChamada = chamadas.find((c) => c.sql.includes("agendamentos_importados"));
  assert.equal(botChamada.params[7], 3);
  assert.equal(importadoChamada.params[7], 3);
  assert.match(botChamada.sql, /a\.psicologo_id = \$8/);
});

test("listarAgendaUnificada: sem filtro de psicólogo, o parâmetro vai null", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({});

  assert.equal(chamadas[0].params[7], null);
});

test("listarAgendaUnificada: psicologoId inválido (não numérico) é ignorado", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({ psicologoId: "abc" });

  assert.equal(chamadas[0].params[7], null);
});

test("listarAgendaUnificada: busca por nome não aplica filtro de telefone (evita casar tudo)", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({ busca: "Maria" });

  const botChamada = chamadas.find((c) => !c.sql.includes("agendamentos_importados"));
  assert.equal(botChamada.params[4], "Maria");
  assert.equal(botChamada.params[5], null, "sem dígitos na busca, o parâmetro de telefone deve ser null");
});

test("listarAgendaUnificada: busca por telefone extrai só os dígitos", async (t) => {
  const chamadas = mockarQuery(t);

  await listarAgendaUnificada({ busca: "(11) 99999-0000" });

  const botChamada = chamadas.find((c) => !c.sql.includes("agendamentos_importados"));
  assert.equal(botChamada.params[5], "11999990000");
});

test("listarAgendaUnificada: pagina em memória buscando a janela offset+limite de cada origem", async (t) => {
  const chamadas = mockarQuery(t, {
    bot: Array.from({ length: 3 }, (_, i) => ({
      id: i,
      origem: "bot",
      data: "2026-09-05",
      hora: `0${i}:00:00`,
    })),
    importado: [],
  });

  const resultado = await listarAgendaUnificada({ limite: 2, offset: 1 });

  const botChamada = chamadas.find((c) => !c.sql.includes("agendamentos_importados"));
  assert.equal(botChamada.params[0], 3, "LIMIT deve ser offset(1) + limite(2) = 3");
  assert.equal(resultado.length, 2, "resultado final deve respeitar o limite pedido, não a janela interna");
});

test("buscarAgendamentoComPacientePorId: junta dados do paciente", async (t) => {
  t.mock.method(pool, "query", async (sql, params) => {
    assert.equal(params[0], 5);
    return { rows: [{ id: 5, paciente_nome: "Ana", paciente_telefone: "11999990000" }] };
  });

  const resultado = await buscarAgendamentoComPacientePorId(5);

  assert.equal(resultado.paciente_nome, "Ana");
});

test("buscarAgendamentoComPacientePorId: retorna null quando não existe", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await buscarAgendamentoComPacientePorId(999);

  assert.equal(resultado, null);
});

test("cancelarAgendamentoConfirmado: só cancela se o status atual for confirmado", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [{ id: 5, status: "cancelado" }] };
  });

  await cancelarAgendamentoConfirmado(5);

  assert.match(chamadas[0].sql, /AND status = 'confirmado'/);
  assert.deepEqual(chamadas[0].params, [5]);
});

test("cancelarAgendamentoConfirmado: retorna null quando 0 linhas afetadas (corrida)", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await cancelarAgendamentoConfirmado(5);

  assert.equal(resultado, null);
});

test("cancelarAgendamentoImportado: só cancela se o status atual for confirmado", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [{ id: 9, status: "cancelado" }] };
  });

  const resultado = await cancelarAgendamentoImportado(9);

  assert.match(chamadas[0].sql, /UPDATE agendamentos_importados SET status = 'cancelado'/);
  assert.match(chamadas[0].sql, /AND status = 'confirmado'/);
  assert.deepEqual(chamadas[0].params, [9]);
  assert.equal(resultado.status, "cancelado");
});

test("cancelarAgendamentoImportado: 0 linhas afetadas retorna null (corrida)", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await cancelarAgendamentoImportado(9);

  assert.equal(resultado, null);
});

test("remarcarAgendamentoImportado: grava nova data/hora só se confirmado", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [{ id: 9, data: "2026-09-15", hora: "09:00:00" }] };
  });

  const resultado = await remarcarAgendamentoImportado({ id: 9, data: "2026-09-15", hora: "09:00" });

  assert.match(chamadas[0].sql, /UPDATE agendamentos_importados SET data = \$2, hora = \$3/);
  assert.match(chamadas[0].sql, /AND status = 'confirmado'/);
  assert.deepEqual(chamadas[0].params, [9, "2026-09-15", "09:00"]);
  assert.equal(resultado.data, "2026-09-15");
});

test("remarcarAgendamentoImportado: 0 linhas afetadas retorna null", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await remarcarAgendamentoImportado({ id: 9, data: "2026-09-15", hora: "09:00" });

  assert.equal(resultado, null);
});

test("buscarAgendamentoImportadoPorId: retorna paciente_nome/paciente_telefone no mesmo formato do bot", async (t) => {
  t.mock.method(pool, "query", async (sql, params) => {
    assert.equal(params[0], 9);
    return {
      rows: [
        {
          id: 9,
          nome: "Ciclano",
          telefone: "11999990000",
          data: "2026-09-15",
          hora: "09:00:00",
          tipo_atendimento: "fisioterapia",
          status: "confirmado",
          ja_passou: false,
        },
      ],
    };
  });

  const resultado = await buscarAgendamentoImportadoPorId(9);

  assert.equal(resultado.paciente_nome, "Ciclano");
  assert.equal(resultado.paciente_telefone, "11999990000");
  assert.equal(resultado.ja_passou, false);
});

test("buscarAgendamentoImportadoPorId: retorna null quando não existe", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await buscarAgendamentoImportadoPorId(999);

  assert.equal(resultado, null);
});

test("buscarAgendamentoConfirmadoDoPacienteNaData: acha agendamento confirmado do paciente nessa data", async (t) => {
  let paramsRecebidos = null;
  t.mock.method(pool, "query", async (sql, params) => {
    paramsRecebidos = params;
    return { rows: [{ id: 42, data: "2026-09-11", hora: "17:00:00", tipo_atendimento: "fisioterapia" }] };
  });

  const resultado = await buscarAgendamentoConfirmadoDoPacienteNaData(5, "2026-09-11");

  assert.deepEqual(paramsRecebidos, [5, "2026-09-11"]);
  assert.equal(resultado.id, 42);
});

test("buscarAgendamentoConfirmadoDoPacienteNaData: sem agendamento confirmado nessa data, retorna null", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const resultado = await buscarAgendamentoConfirmadoDoPacienteNaData(5, "2026-09-11");

  assert.equal(resultado, null);
});

test("buscarAgendamentoConfirmadoDoPacienteNaData: filtra por status = 'confirmado'", async (t) => {
  let sqlRecebido = null;
  t.mock.method(pool, "query", async (sql) => {
    sqlRecebido = sql;
    return { rows: [] };
  });

  await buscarAgendamentoConfirmadoDoPacienteNaData(5, "2026-09-11");

  assert.match(sqlRecebido, /status = 'confirmado'/);
});
