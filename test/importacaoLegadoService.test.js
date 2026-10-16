import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath, URL } from "node:url";
import { join } from "node:path";
import {
  parsearArquivoAgenda,
  processarLinha,
  importarDiretorio,
  derivarPrimeiraConsulta,
  derivarPresenca,
} from "../src/services/importacaoLegadoService.js";
import { pool } from "../src/db/pool.js";

const FIXTURE_PATH = fileURLToPath(new URL("./fixtures/agenda-exemplo.xml", import.meta.url));

test("parsearArquivoAgenda pula cabeçalho e slot vazio, extrai linhas reais", async () => {
  const conteudo = await readFile(FIXTURE_PATH, "utf8");
  const linhas = parsearArquivoAgenda(conteudo, "2026-08-26");

  assert.equal(linhas.length, 2, "deve ignorar a linha de cabeçalho e o slot vazio das 07:30");

  const [maria, joao] = linhas;

  assert.deepEqual(maria, {
    data: "2026-08-26",
    hora: "07:00",
    nome: "MARIA DA SILVA",
    telefoneNormalizado: "5511999991111",
    cpf: "111.111.111-11",
    nascimento: "1971-11-20",
    categoria: "Particular",
    atendente: "Carlos",
    tipo: "OK",
    primeiraConsulta: null,
    obs: "MATRICULA 123 - SENHA ABC",
    flagF: "S",
    flagC: null,
    flagE: null,
    chegou: null,
  });

  assert.equal(joao.nome, "JOAO SEM TELEFONE");
  assert.equal(joao.telefoneNormalizado, null, "sem telefone no export → null, não string vazia");
  assert.equal(joao.cpf, null);
  assert.equal(joao.nascimento, null);
});

test("parsearArquivoAgenda completa DDI só quando dá pra saber que só falta o '55'", async () => {
  // Caso real encontrado no export: telefone fixo sem DDD ("2267-6690",
  // 8 dígitos) — não dá pra completar com segurança, tem que ficar como
  // está em vez de arriscar um DDD errado.
  const xml = `<NewDataSet>
  <Table1>
   <Hora>09:00</Hora>
   <Paciente>PACIENTE COM DDD</Paciente>
   <Obs></Obs><CPF></CPF><Nascimento></Nascimento>
   <Telefone>11 98888-7777</Telefone>
   <Categoria></Categoria><Tipo></Tipo><F></F><Atendente></Atendente><C></C><E></E><Chegou></Chegou>
  </Table1>
  <Table1>
   <Hora>09:30</Hora>
   <Paciente>PACIENTE SEM DDD</Paciente>
   <Obs></Obs><CPF></CPF><Nascimento></Nascimento>
   <Telefone>2267-6690</Telefone>
   <Categoria></Categoria><Tipo></Tipo><F></F><Atendente></Atendente><C></C><E></E><Chegou></Chegou>
  </Table1>
</NewDataSet>`;

  const [comDDD, semDDD] = parsearArquivoAgenda(xml, "2026-08-26");

  assert.equal(comDDD.telefoneNormalizado, "5511988887777", "11 dígitos (DDD+número) → completa o 55");
  assert.equal(semDDD.telefoneNormalizado, "22676690", "8 dígitos (sem DDD) → mantém como está, não inventa DDD");
});

test("derivarPrimeiraConsulta: prefixo AVAL antes da barra é avaliação (true)", () => {
  assert.equal(derivarPrimeiraConsulta("AVAL/OK"), true);
  assert.equal(derivarPrimeiraConsulta("aval/ok"), true, "não deve ser sensível a caixa");
});

test("derivarPrimeiraConsulta: prefixo RETORNO antes da barra é retorno (false)", () => {
  assert.equal(derivarPrimeiraConsulta("RETORNO/OK"), false);
});

test("derivarPrimeiraConsulta: valores sem prefixo AVAL/RETORNO reconhecível (ex: só 'OK') ou vazios retornam null", () => {
  assert.equal(derivarPrimeiraConsulta("OK"), null);
  assert.equal(derivarPrimeiraConsulta(""), null);
  assert.equal(derivarPrimeiraConsulta(null), null);
});

test("parsearArquivoAgenda deriva primeiraConsulta do campo Tipo (AVAL/RETORNO)", async () => {
  const xml = `<NewDataSet>
  <Table1>
   <Hora>09:00</Hora>
   <Paciente>PACIENTE AVALIACAO</Paciente>
   <Obs></Obs><CPF></CPF><Nascimento></Nascimento>
   <Telefone>11988887777</Telefone>
   <Categoria></Categoria><Tipo>AVAL/OK</Tipo><F></F><Atendente></Atendente><C></C><E></E><Chegou></Chegou>
  </Table1>
  <Table1>
   <Hora>09:30</Hora>
   <Paciente>PACIENTE RETORNO</Paciente>
   <Obs></Obs><CPF></CPF><Nascimento></Nascimento>
   <Telefone>11988887778</Telefone>
   <Categoria></Categoria><Tipo>RETORNO/OK</Tipo><F></F><Atendente></Atendente><C></C><E></E><Chegou></Chegou>
  </Table1>
</NewDataSet>`;

  const [avaliacao, retorno] = parsearArquivoAgenda(xml, "2026-08-26");

  assert.equal(avaliacao.primeiraConsulta, true);
  assert.equal(retorno.primeiraConsulta, false);
});

function linhaDeExemplo(sobrescreve = {}) {
  return {
    data: "2026-08-26",
    hora: "07:00",
    nome: "MARIA DA SILVA",
    telefoneNormalizado: "5511999991111",
    cpf: "111.111.111-11",
    nascimento: "1971-11-20",
    categoria: "Particular",
    atendente: "Carlos",
    tipo: "OK",
    primeiraConsulta: null,
    obs: null,
    flagF: "S",
    flagC: null,
    flagE: null,
    chegou: null,
    ...sobrescreve,
  };
}

test("processarLinha: paciente novo, dry-run não grava nada", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("FROM pacientes")) return { rows: [] };
    if (sql.includes("FROM agendamentos_importados")) return { rows: [] };
    return { rows: [] };
  });

  const resultado = await processarLinha(linhaDeExemplo(), { aplicar: false });

  assert.deepEqual(
    resultado.eventos.map((e) => e.tipo),
    ["paciente_novo", "agendamento_novo", "presenca_detectada"]
  );
  assert.ok(
    chamadas.every((c) => c.sql.trim().toUpperCase().startsWith("SELECT")),
    "dry-run não deve executar nenhum INSERT/UPDATE"
  );
});

test("processarLinha: paciente novo, --apply insere paciente e agendamento", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("FROM pacientes WHERE telefone")) return { rows: [] };
    if (sql.includes("SELECT id FROM agendamentos_importados")) return { rows: [] };
    return { rows: [] };
  });

  await processarLinha(linhaDeExemplo(), { aplicar: true });

  const insertPaciente = chamadas.find((c) => c.sql.includes("INSERT INTO pacientes"));
  assert.ok(insertPaciente, "deveria ter inserido o paciente");
  assert.deepEqual(insertPaciente.params, [
    "MARIA DA SILVA",
    "5511999991111",
    "Particular",
    null,
    "111.111.111-11",
    "1971-11-20",
  ]);

  const insertAgendamento = chamadas.find((c) => c.sql.includes("INSERT INTO agendamentos_importados"));
  assert.ok(insertAgendamento, "deveria ter inserido o agendamento");
});

test("processarLinha: paciente existente (mesmo nome) sem CPF/nascimento → atualiza", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("FROM pacientes WHERE telefone")) {
      return { rows: [{ id: 42, nome: "MARIA DA SILVA", cpf: null, data_nascimento: null }] };
    }
    if (sql.includes("SELECT id FROM agendamentos_importados")) return { rows: [] };
    return { rows: [] };
  });

  const resultado = await processarLinha(linhaDeExemplo(), { aplicar: true });

  assert.deepEqual(
    resultado.eventos.map((e) => e.tipo),
    ["paciente_atualizado", "agendamento_novo", "presenca_detectada"]
  );
  const update = chamadas.find((c) => c.sql.includes("UPDATE pacientes"));
  assert.ok(update, "deveria ter atualizado o paciente existente");
  assert.deepEqual(update.params, ["111.111.111-11", "1971-11-20", null, 42]);
});

test("processarLinha: paciente já com CPF e nascimento (mesmo nome) → não sobrescreve", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("FROM pacientes WHERE telefone")) {
      return { rows: [{ id: 42, nome: "MARIA DA SILVA", cpf: "999.999.999-99", data_nascimento: "1990-01-01" }] };
    }
    if (sql.includes("SELECT id FROM agendamentos_importados")) return { rows: [] };
    return { rows: [] };
  });

  const resultado = await processarLinha(linhaDeExemplo(), { aplicar: true });

  assert.deepEqual(
    resultado.eventos.map((e) => e.tipo),
    ["agendamento_novo", "presenca_detectada"],
    "não deve gerar evento paciente_atualizado quando já tem os dois campos"
  );
  assert.ok(
    !chamadas.some((c) => c.sql.includes("UPDATE pacientes")),
    "não deve nem tentar fazer UPDATE"
  );
});

test("processarLinha: mesmo telefone, nome diferente do cadastrado → aviso, não grava CPF/nascimento", async (t) => {
  // Achado real (2026-08-27): telefone pode ser de família — um número já
  // cadastrado pra "PACIENTE EXEMPLO UM" aparecendo numa linha da
  // "PACIENTE EXEMPLO DOIS" não deve escrever o CPF dela no cadastro
  // dele.
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("FROM pacientes WHERE telefone")) {
      return { rows: [{ id: 42, nome: "PACIENTE EXEMPLO UM", cpf: null, data_nascimento: null }] };
    }
    if (sql.includes("SELECT id FROM agendamentos_importados")) return { rows: [] };
    return { rows: [] };
  });

  const resultado = await processarLinha(linhaDeExemplo({ nome: "PACIENTE EXEMPLO DOIS" }), {
    aplicar: true,
  });

  assert.deepEqual(
    resultado.eventos.map((e) => e.tipo),
    ["aviso", "agendamento_novo", "presenca_detectada"]
  );
  assert.equal(
    resultado.eventos[0].motivo,
    'telefone já cadastrado para outro paciente ("PACIENTE EXEMPLO UM") — CPF/nascimento de "PACIENTE EXEMPLO DOIS" não foram gravados, revisar manualmente'
  );
  assert.ok(!chamadas.some((c) => c.sql.includes("UPDATE pacientes") || c.sql.includes("INSERT INTO pacientes")));
});

test("processarLinha: sem telefone → divergência, nenhuma query executada", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [] };
  });

  const resultado = await processarLinha(linhaDeExemplo({ telefoneNormalizado: null }), { aplicar: true });

  assert.deepEqual(resultado.eventos, [
    { tipo: "divergencia", motivo: "sem telefone, não é possível associar a um paciente" },
  ]);
  assert.equal(chamadas.length, 0, "não deve nem consultar o banco quando não há telefone");
});

test("processarLinha: hora em formato inesperado → divergência, linha ignorada", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    return { rows: [] };
  });

  const resultado = await processarLinha(linhaDeExemplo({ hora: "25:99" }), { aplicar: true });

  assert.deepEqual(resultado.eventos, [
    { tipo: "divergencia", motivo: 'hora inválida ("25:99"), linha ignorada' },
  ]);
  assert.equal(chamadas.length, 0, "não deve consultar nem gravar nada com hora inválida");
});

test('processarLinha: convênio "Particular" nunca gera aviso', async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("FROM pacientes")) return { rows: [] };
    if (sql.includes("FROM agendamentos_importados")) return { rows: [] };
    return { rows: [] };
  });

  const resultado = await processarLinha(linhaDeExemplo({ categoria: "Particular" }), { aplicar: false });

  assert.ok(!resultado.eventos.some((e) => e.tipo === "aviso"));
});

test("processarLinha: convênio reconhecido (variação de acento/caixa) não gera aviso", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("FROM pacientes")) return { rows: [] };
    if (sql.includes("FROM agendamentos_importados")) return { rows: [] };
    return { rows: [] };
  });

  // "Norte" (sem acento, sem "Intermed") é como o export costuma
  // vir — precisa bater com "Norte Intermed" da lista oficial.
  const resultado = await processarLinha(linhaDeExemplo({ categoria: "Norte" }), { aplicar: false });

  assert.ok(!resultado.eventos.some((e) => e.tipo === "aviso"));
});

test("processarLinha: convênio truncado no export (só a primeira palavra) não gera aviso", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("FROM pacientes")) return { rows: [] };
    if (sql.includes("FROM agendamentos_importados")) return { rows: [] };
    return { rows: [] };
  });

  // Caso real do export: "Santa Luz" (duas palavras, sem acento)
  // precisa bater com "Santa Luz Saúde" da lista oficial — a
  // comparação por primeira palavra tem que rodar dos DOIS lados (export
  // truncado E nome oficial truncado), não só de um.
  const resultado = await processarLinha(linhaDeExemplo({ categoria: "Santa Luz" }), { aplicar: false });

  assert.ok(!resultado.eventos.some((e) => e.tipo === "aviso"));
});

test("processarLinha: convênio não reconhecido → aviso, mas grava normalmente", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("FROM pacientes")) return { rows: [] };
    if (sql.includes("FROM agendamentos_importados")) return { rows: [] };
    return { rows: [] };
  });

  const resultado = await processarLinha(linhaDeExemplo({ categoria: "Convenio Que Nao Existe" }), {
    aplicar: true,
  });

  assert.deepEqual(
    resultado.eventos.map((e) => e.tipo),
    ["aviso", "paciente_novo", "agendamento_novo", "presenca_detectada"]
  );
  assert.equal(
    resultado.eventos[0].motivo,
    'convênio "Convenio Que Nao Existe" não bate com nenhum convênio credenciado conhecido — revisar manualmente'
  );
  assert.ok(chamadas.some((c) => c.sql.includes("INSERT INTO pacientes")), "aviso não deve bloquear a gravação");
});

// Achado real em produção (2026-09-17): o import nunca ligava o paciente a um
// convenio_id — nem paciente novo, nem (pior ainda) paciente já cadastrado —
// então nada que depende de convenio_id (repasse, pagamento automático)
// funcionava pra quem veio do sistema de agenda anterior. Os quatro testes abaixo
// cobrem essa correção.
test("processarLinha: paciente novo com convênio que bate (exato, após normalizar) com um convênio ativo grava convenio_id", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("FROM pacientes WHERE telefone")) return { rows: [] };
    if (sql.includes("FROM agendamentos_importados")) return { rows: [] };
    if (sql.includes("FROM convenios")) return { rows: [{ id: 4, nome: "Mar Azul Saúde" }, { id: 13, nome: "Santa Luz" }] };
    return { rows: [] };
  });

  await processarLinha(linhaDeExemplo({ categoria: "Mar Azul Saúde" }), { aplicar: true });

  const insertPaciente = chamadas.find((c) => c.sql.includes("INSERT INTO pacientes"));
  assert.equal(insertPaciente.params[2], "Mar Azul Saúde");
  assert.equal(insertPaciente.params[3], 4, "convenio_id deveria ser o id de Mar Azul Saúde");
});

test("processarLinha: paciente novo com convênio truncado/sem acento (ex: 'Santa Luz') bate com o nome oficial e grava convenio_id", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("FROM pacientes WHERE telefone")) return { rows: [] };
    if (sql.includes("FROM agendamentos_importados")) return { rows: [] };
    if (sql.includes("FROM convenios")) return { rows: [{ id: 13, nome: "Santa Luz" }] };
    return { rows: [] };
  });

  await processarLinha(linhaDeExemplo({ categoria: "Santa Luz" }), { aplicar: true });

  const insertPaciente = chamadas.find((c) => c.sql.includes("INSERT INTO pacientes"));
  assert.equal(insertPaciente.params[3], 13);
});

test("processarLinha: paciente existente sem convenio_id, cpf e nascimento já preenchidos — mesmo assim atualiza convenio_id quando o convênio bate", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("FROM pacientes WHERE telefone")) {
      return { rows: [{ id: 42, nome: "MARIA DA SILVA", cpf: "111.111.111-11", data_nascimento: "1971-11-20", convenio_id: null }] };
    }
    if (sql.includes("FROM agendamentos_importados")) return { rows: [] };
    if (sql.includes("FROM convenios")) return { rows: [{ id: 4, nome: "Mar Azul Saúde" }] };
    return { rows: [] };
  });

  const resultado = await processarLinha(linhaDeExemplo({ categoria: "Mar Azul Saúde" }), { aplicar: true });

  assert.ok(resultado.eventos.some((e) => e.tipo === "paciente_atualizado"));
  const update = chamadas.find((c) => c.sql.includes("UPDATE pacientes"));
  assert.ok(update, "deveria atualizar mesmo com cpf/nascimento já preenchidos, só por causa do convenio_id");
  assert.deepEqual(update.params, ["111.111.111-11", "1971-11-20", 4, 42]);
});

test("processarLinha: paciente existente já com convenio_id não é sobrescrito, mesmo que a categoria da linha seja outra", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("FROM pacientes WHERE telefone")) {
      return { rows: [{ id: 42, nome: "MARIA DA SILVA", cpf: "111.111.111-11", data_nascimento: "1971-11-20", convenio_id: 4 }] };
    }
    if (sql.includes("FROM agendamentos_importados")) return { rows: [] };
    return { rows: [] };
  });

  const resultado = await processarLinha(linhaDeExemplo({ categoria: "Sami" }), { aplicar: true });

  assert.ok(
    !resultado.eventos.some((e) => e.tipo === "paciente_atualizado"),
    "cpf/nascimento já preenchidos e convenio_id já setado — não deveria atualizar nada"
  );
  assert.ok(!chamadas.some((c) => c.sql.includes("FROM convenios")), "nem deveria consultar convenios, já que convenio_id já está setado");
  assert.ok(!chamadas.some((c) => c.sql.includes("UPDATE pacientes")));
});

test("processarLinha: rodar duas vezes com o mesmo estado não duplica agendamento", async (t) => {
  const tabelaAgendamentos = []; // simula o estado do banco entre as duas chamadas
  t.mock.method(pool, "query", async (sql, params) => {
    if (sql.includes("FROM pacientes WHERE telefone")) {
      return { rows: [{ id: 42, nome: "MARIA DA SILVA", cpf: "111.111.111-11", data_nascimento: "1971-11-20" }] };
    }
    if (sql.includes("SELECT id FROM agendamentos_importados")) {
      const [telefone, data, hora, nome] = params;
      const existente = tabelaAgendamentos.find(
        (a) => a.telefone === telefone && a.data === data && a.hora === hora && a.nome === nome
      );
      return { rows: existente ? [{ id: existente.id }] : [] };
    }
    if (sql.includes("INSERT INTO agendamentos_importados")) {
      const [telefone, nome, data, hora] = params;
      tabelaAgendamentos.push({ id: tabelaAgendamentos.length + 1, telefone, nome, data, hora });
      return { rows: [] };
    }
    if (sql.includes("UPDATE agendamentos_importados SET status")) return { rows: [{ id: params[0] }] };
    if (sql.includes("INSERT INTO registros_atendimento")) return { rows: [] };
    return { rows: [] };
  });

  const linha = linhaDeExemplo();
  const primeira = await processarLinha(linha, { aplicar: true, usuarioPresencaId: 5 });
  const segunda = await processarLinha(linha, { aplicar: true, usuarioPresencaId: 5 });

  assert.deepEqual(
    primeira.eventos.map((e) => e.tipo),
    ["agendamento_novo", "presenca_detectada"]
  );
  assert.deepEqual(
    segunda.eventos.map((e) => e.tipo),
    ["agendamento_ja_existe", "presenca_detectada", "presenca_registrada"],
    "segunda execução com o mesmo dado não deve gerar agendamento_novo de novo, mas deve marcar presença pro agendamento já existente"
  );
  assert.equal(tabelaAgendamentos.length, 1, "só deve existir um agendamento na tabela simulada");
});

test("processarLinha: duas pessoas diferentes no mesmo telefone/data/hora não colidem no agendamento", async (t) => {
  // Achado real (2026-08-27): família dividindo telefone, dois pacientes
  // agendados no mesmo horário — nome precisa entrar na chave de
  // agendamentos_importados, senão o segundo paciente seria incorretamente
  // tratado como "já existe" e nunca gravado. `pacientes` já é coberto
  // pelo teste de aviso da Task 4 — aqui o mock devolve o PACIENTE EXEMPLO UM já
  // cadastrada pra isolar só o comportamento de agendamentos_importados.
  const tabelaAgendamentos = [];
  t.mock.method(pool, "query", async (sql, params) => {
    if (sql.includes("FROM pacientes WHERE telefone")) {
      return { rows: [{ id: 42, nome: "PACIENTE EXEMPLO UM", cpf: "111.111.111-11", data_nascimento: "1980-01-01" }] };
    }
    if (sql.includes("SELECT id FROM agendamentos_importados")) {
      const [telefone, data, hora, nome] = params;
      const existente = tabelaAgendamentos.find(
        (a) => a.telefone === telefone && a.data === data && a.hora === hora && a.nome === nome
      );
      return { rows: existente ? [{ id: existente.id }] : [] };
    }
    if (sql.includes("INSERT INTO agendamentos_importados")) {
      const [telefone, nome, data, hora] = params;
      tabelaAgendamentos.push({ id: tabelaAgendamentos.length + 1, telefone, nome, data, hora });
      return { rows: [] };
    }
    return { rows: [] };
  });

  const linha1 = linhaDeExemplo({ nome: "PACIENTE EXEMPLO UM", telefoneNormalizado: "5511999990003" });
  const linha2 = linhaDeExemplo({ nome: "PACIENTE EXEMPLO DOIS", telefoneNormalizado: "5511999990003" });

  const resultado1 = await processarLinha(linha1, { aplicar: true });
  const resultado2 = await processarLinha(linha2, { aplicar: true });

  assert.deepEqual(resultado1.eventos.map((e) => e.tipo), ["agendamento_novo", "presenca_detectada"]);
  assert.deepEqual(
    resultado2.eventos.map((e) => e.tipo),
    ["aviso", "agendamento_novo", "presenca_detectada"],
    "segunda pessoa no mesmo telefone/data/hora deve gravar o agendamento normalmente, não ser tratada como duplicata"
  );
  assert.equal(tabelaAgendamentos.length, 2, "as duas pessoas devem ter uma linha de agendamento cada");
});

test("importarDiretorio lê Agenda_*.xml do diretório e agrega o relatório", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "importacao-legado-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  await writeFile(join(dir, "Agenda_Manha_26-08-2026.xml"), await readFile(FIXTURE_PATH, "utf8"));
  await writeFile(join(dir, "nao_e_agenda.xml"), "<NewDataSet></NewDataSet>");

  t.mock.method(pool, "query", async (sql, _params) => {
    if (sql.includes("FROM pacientes WHERE telefone")) return { rows: [] };
    if (sql.includes("SELECT id FROM agendamentos_importados")) return { rows: [] };
    return { rows: [] };
  });

  const relatorio = await importarDiretorio(dir, { aplicar: false });

  assert.equal(relatorio.pacientesNovos, 1);
  assert.equal(relatorio.agendamentosNovos, 1);
  assert.equal(relatorio.agendamentosJaExistentes, 0);
  assert.deepEqual(relatorio.divergencias, [
    {
      nome: "JOAO SEM TELEFONE",
      arquivo: "Agenda_Manha_26-08-2026.xml",
      motivo: "sem telefone, não é possível associar a um paciente",
    },
  ]);
  assert.deepEqual(relatorio.avisos, [], "MARIA DA SILVA usa convênio Particular, não deveria gerar aviso");
  assert.equal(relatorio.presencasDetectadas, 1, "MARIA DA SILVA tem tipo OK no fixture");
  assert.equal(relatorio.presencasRegistradas, 0, "dry-run não grava presença, mesmo com tipo OK");
});

test("derivarPresenca: só reconhece sufixo OK (com ou sem prefixo de tipo de consulta)", () => {
  assert.equal(derivarPresenca("OK"), "compareceu");
  assert.equal(derivarPresenca("AVAL/OK"), "compareceu");
  assert.equal(derivarPresenca("RETORNO/OK"), "compareceu");
  assert.equal(derivarPresenca("AVAL"), null, "sem sufixo OK, ainda não compareceu");
  assert.equal(derivarPresenca(""), null);
  assert.equal(derivarPresenca(null), null);
});

test("processarLinha: agendamento já existente com tipo OK → marca presença compareceu", async (t) => {
  const chamadas = [];
  t.mock.method(pool, "query", async (sql, params) => {
    chamadas.push({ sql, params });
    if (sql.includes("FROM pacientes WHERE telefone")) {
      return { rows: [{ id: 42, nome: "MARIA DA SILVA", cpf: "111.111.111-11", data_nascimento: "1971-11-20" }] };
    }
    if (sql.includes("SELECT id FROM agendamentos_importados")) return { rows: [{ id: 7 }] };
    if (sql.includes("UPDATE agendamentos_importados SET status")) return { rows: [{ id: 7 }] };
    if (sql.includes("INSERT INTO registros_atendimento")) return { rows: [] };
    return { rows: [] };
  });

  const resultado = await processarLinha(linhaDeExemplo(), { aplicar: true, usuarioPresencaId: 5 });

  assert.deepEqual(
    resultado.eventos.map((e) => e.tipo),
    ["agendamento_ja_existe", "presenca_detectada", "presenca_registrada"]
  );
  const update = chamadas.find((c) => c.sql.includes("UPDATE agendamentos_importados SET status"));
  assert.deepEqual(update.params, [7, "compareceu"]);
  const insertPresenca = chamadas.find((c) => c.sql.includes("INSERT INTO registros_atendimento"));
  assert.deepEqual(insertPresenca.params, [7, "compareceu", 5]);
});

test("processarLinha: tipo OK mas agendamento cancelado → presença não registrada, aviso", async (t) => {
  t.mock.method(pool, "query", async (sql, params) => {
    if (sql.includes("FROM pacientes WHERE telefone")) {
      return { rows: [{ id: 42, nome: "MARIA DA SILVA", cpf: "111.111.111-11", data_nascimento: "1971-11-20" }] };
    }
    if (sql.includes("SELECT id FROM agendamentos_importados")) return { rows: [{ id: 7 }] };
    if (sql.includes("UPDATE agendamentos_importados SET status")) return { rows: [] }; // cancelado, WHERE não bate
    return { rows: [] };
  });

  const resultado = await processarLinha(linhaDeExemplo(), { aplicar: true, usuarioPresencaId: 5 });

  assert.deepEqual(
    resultado.eventos.map((e) => e.tipo),
    ["agendamento_ja_existe", "presenca_detectada", "aviso"]
  );
  assert.equal(
    resultado.eventos[2].motivo,
    'presença "compareceu" não registrada (agendamento cancelado ou não encontrado)'
  );
});

test('processarLinha: tipo sem sufixo OK não gera evento de presença', async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("FROM pacientes")) return { rows: [] };
    if (sql.includes("FROM agendamentos_importados")) return { rows: [] };
    return { rows: [] };
  });

  const resultado = await processarLinha(linhaDeExemplo({ tipo: "AVAL" }), { aplicar: true });

  assert.ok(!resultado.eventos.some((e) => e.tipo.startsWith("presenca")));
});

test("importarDiretorio não grava agenda de fim de semana e reporta como divergência", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "importacao-legado-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  await writeFile(join(dir, "Agenda_Manha_19-09-2026.xml"), await readFile(FIXTURE_PATH, "utf8"));

  const consultas = [];
  t.mock.method(pool, "query", async (sql) => {
    consultas.push(sql);
    return { rows: [] };
  });

  const relatorio = await importarDiretorio(dir, { aplicar: true });

  assert.equal(consultas.length, 0, "nada deve ser consultado nem gravado para arquivo de sábado");
  assert.equal(relatorio.agendamentosNovos, 0);
  assert.ok(relatorio.divergencias.length > 0);
  for (const divergencia of relatorio.divergencias) {
    assert.equal(divergencia.arquivo, "Agenda_Manha_19-09-2026.xml");
    assert.match(divergencia.motivo, /sábado \(19\/09\/2026\)/);
  }
});
