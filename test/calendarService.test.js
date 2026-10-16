// test/calendarService.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { validarDisponibilidadeAgendamento, listarHorariosDisponiveis } from "../src/services/calendarService.js";
import dayjs from "../src/utils/dayjs.js";
import { CLINICA } from "../src/config/clinica.js";
import { ehFeriado } from "../src/utils/feriados.js";

function proximoDiaUtil(base = dayjs().tz(CLINICA.timezone).add(1, "day")) {
  let d = base;
  while (CLINICA.diasFechados.includes(d.day()) || ehFeriado(d)) d = d.add(1, "day");
  return d;
}

function diaUtilAnterior(base = dayjs().tz(CLINICA.timezone).subtract(1, "day")) {
  let d = base;
  while (CLINICA.diasFechados.includes(d.day()) || ehFeriado(d)) d = d.subtract(1, "day");
  return d;
}

test("validarDisponibilidadeAgendamento: horário dentro do expediente e livre não lança nada", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ total: 0 }] }));

  const dia = proximoDiaUtil().format("YYYY-MM-DD");
  await assert.doesNotReject(() =>
    validarDisponibilidadeAgendamento({ data: dia, hora: "08:00", tipoAtendimento: "fisioterapia" })
  );
});

test("validarDisponibilidadeAgendamento: fora do expediente lança FORA_DO_HORARIO_FUNCIONAMENTO", async () => {
  const dia = proximoDiaUtil().format("YYYY-MM-DD");
  await assert.rejects(
    () => validarDisponibilidadeAgendamento({ data: dia, hora: "05:00", tipoAtendimento: "fisioterapia" }),
    (err) => err.codigo === "FORA_DO_HORARIO_FUNCIONAMENTO"
  );
});

test("validarDisponibilidadeAgendamento: fim de semana lança FORA_DO_HORARIO_FUNCIONAMENTO", async () => {
  let d = dayjs().tz(CLINICA.timezone).add(1, "day");
  while (!CLINICA.diasFechados.includes(d.day())) d = d.add(1, "day");

  await assert.rejects(
    () => validarDisponibilidadeAgendamento({ data: d.format("YYYY-MM-DD"), hora: "08:00", tipoAtendimento: "fisioterapia" }),
    (err) => err.codigo === "FORA_DO_HORARIO_FUNCIONAMENTO"
  );
});

test("validarDisponibilidadeAgendamento: data no passado lança DATA_NO_PASSADO", async () => {
  const ontem = diaUtilAnterior().format("YYYY-MM-DD");
  await assert.rejects(
    () => validarDisponibilidadeAgendamento({ data: ontem, hora: "08:00", tipoAtendimento: "fisioterapia" }),
    (err) => err.codigo === "DATA_NO_PASSADO"
  );
});

test("validarDisponibilidadeAgendamento: além de 7 dias úteis lança FORA_DO_LIMITE_DIAS", async () => {
  const longe = proximoDiaUtil(dayjs().tz(CLINICA.timezone).add(30, "day")).format("YYYY-MM-DD");
  await assert.rejects(
    () => validarDisponibilidadeAgendamento({ data: longe, hora: "08:00", tipoAtendimento: "fisioterapia" }),
    (err) => err.codigo === "FORA_DO_LIMITE_DIAS"
  );
});

test("validarDisponibilidadeAgendamento: ignorarLimiteDias pula a checagem de 7 dias úteis (só pra série manual)", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  const longe = proximoDiaUtil(dayjs().tz(CLINICA.timezone).add(60, "day")).format("YYYY-MM-DD");

  await assert.doesNotReject(() =>
    validarDisponibilidadeAgendamento({
      data: longe,
      hora: "08:00",
      tipoAtendimento: "fisioterapia",
      ignorarLimiteDias: true,
    })
  );
});

test("validarDisponibilidadeAgendamento: ignorarLimiteDias não afeta as outras checagens (fora do expediente ainda rejeita)", async () => {
  const dia = proximoDiaUtil().format("YYYY-MM-DD");
  await assert.rejects(
    () =>
      validarDisponibilidadeAgendamento({
        data: dia,
        hora: "05:00",
        tipoAtendimento: "fisioterapia",
        ignorarLimiteDias: true,
      }),
    (err) => err.codigo === "FORA_DO_HORARIO_FUNCIONAMENTO"
  );
});

test("validarDisponibilidadeAgendamento: capacidade lotada lança HORARIO_LOTADO", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ total: 7 }] }));

  const dia = proximoDiaUtil().format("YYYY-MM-DD");
  await assert.rejects(
    () => validarDisponibilidadeAgendamento({ data: dia, hora: "08:00", tipoAtendimento: "fisioterapia" }),
    (err) => err.codigo === "HORARIO_LOTADO"
  );
});

test("validarDisponibilidadeAgendamento: psicologia agora tem capacidade 1 por horário e lança HORARIO_LOTADO quando ocupado", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ total: 1 }] }));

  const dia = proximoDiaUtil().format("YYYY-MM-DD");
  await assert.rejects(
    () => validarDisponibilidadeAgendamento({ data: dia, hora: "08:00", tipoAtendimento: "psicologia" }),
    (err) => err.codigo === "HORARIO_LOTADO"
  );
});

test("validarDisponibilidadeAgendamento: psicologia livre (capacidade 1, ocupação 0) não lança nada", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ total: 0 }] }));

  const dia = proximoDiaUtil().format("YYYY-MM-DD");
  await assert.doesNotReject(() =>
    validarDisponibilidadeAgendamento({ data: dia, hora: "08:00", tipoAtendimento: "psicologia" })
  );
});

test("validarDisponibilidadeAgendamento: a query de capacidade exclui importados cancelados", async (t) => {
  let sqlCapturado = null;
  t.mock.method(pool, "query", async (sql) => {
    sqlCapturado = sql;
    return { rows: [{ total: 0 }] };
  });

  const dia = proximoDiaUtil().format("YYYY-MM-DD");
  await validarDisponibilidadeAgendamento({ data: dia, hora: "08:00", tipoAtendimento: "fisioterapia" });

  assert.match(sqlCapturado, /agendamentos_importados/);
  assert.match(sqlCapturado, /status <> 'cancelado'/);
});

test("validarDisponibilidadeAgendamento: psicologia usa seu próprio horário de funcionamento, sem o intervalo de almoço da Fisioterapia", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ total: 0 }] }));

  const dia = proximoDiaUtil().format("YYYY-MM-DD");
  // 12:00 cai no intervalo de almoço da Fisioterapia (11:30-13:00) mas está
  // dentro do expediente único da Psicologia (08:00-18:40) — antes desta
  // tarefa, isso lançava FORA_DO_HORARIO_FUNCIONAMENTO por engano.
  await assert.doesNotReject(() =>
    validarDisponibilidadeAgendamento({ data: dia, hora: "12:00", tipoAtendimento: "psicologia" })
  );
});

test("validarDisponibilidadeAgendamento: fisioterapia continua rejeitando o horário de almoço (comportamento inalterado)", async () => {
  const dia = proximoDiaUtil().format("YYYY-MM-DD");
  await assert.rejects(
    () => validarDisponibilidadeAgendamento({ data: dia, hora: "12:00", tipoAtendimento: "fisioterapia" }),
    (err) => err.codigo === "FORA_DO_HORARIO_FUNCIONAMENTO"
  );
});

test("validarDisponibilidadeAgendamento: psicologia bloqueia quando o slot anterior (30min antes) já está ocupado", async (t) => {
  t.mock.method(pool, "query", async (sql, params) => {
    const horariosVizinhos = params[1];
    if (horariosVizinhos.includes("08:00")) return { rows: [{ hora: "08:00", total: 1 }] };
    return { rows: [] };
  });

  const dia = proximoDiaUtil().format("YYYY-MM-DD");
  // Consulta de 40min "ocupa" o slot escolhido + o seguinte (30+30) — um
  // agendamento existente às 08:00 ainda estaria em andamento às 08:30.
  await assert.rejects(
    () => validarDisponibilidadeAgendamento({ data: dia, hora: "08:30", tipoAtendimento: "psicologia" }),
    (err) => err.codigo === "HORARIO_LOTADO"
  );
});

test("validarDisponibilidadeAgendamento: psicologia bloqueia quando o slot seguinte (30min depois) já está ocupado", async (t) => {
  t.mock.method(pool, "query", async (sql, params) => {
    const horariosVizinhos = params[1];
    if (horariosVizinhos.includes("08:30")) return { rows: [{ hora: "08:30", total: 1 }] };
    return { rows: [] };
  });

  const dia = proximoDiaUtil().format("YYYY-MM-DD");
  // Um novo agendamento às 08:00 (40min) invadiria o slot de 08:30, já
  // ocupado por outro paciente.
  await assert.rejects(
    () => validarDisponibilidadeAgendamento({ data: dia, hora: "08:00", tipoAtendimento: "psicologia" }),
    (err) => err.codigo === "HORARIO_LOTADO"
  );
});

test("validarDisponibilidadeAgendamento: psicologia livre quando nenhum slot vizinho (nem o próprio) está ocupado", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));

  const dia = proximoDiaUtil().format("YYYY-MM-DD");
  await assert.doesNotReject(() =>
    validarDisponibilidadeAgendamento({ data: dia, hora: "09:00", tipoAtendimento: "psicologia" })
  );
});

test("validarDisponibilidadeAgendamento: fisioterapia só verifica o próprio slot (nSlots=1, comportamento inalterado)", async (t) => {
  let horariosCapturados = null;
  t.mock.method(pool, "query", async (sql, params) => {
    horariosCapturados = params[1];
    return { rows: [] };
  });

  const dia = proximoDiaUtil().format("YYYY-MM-DD");
  await validarDisponibilidadeAgendamento({ data: dia, hora: "08:00", tipoAtendimento: "fisioterapia" });

  assert.deepEqual(horariosCapturados, ["08:00"]);
});

test("listarHorariosDisponiveis: psicologia não sugere um slot cujo vizinho já está ocupado", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [{ hora: "08:00:00", total: 1 }] }));

  const dia = proximoDiaUtil().format("YYYY-MM-DD");
  const horarios = await listarHorariosDisponiveis({
    data: dia,
    tipoAtendimento: "psicologia",
    amostrar: false,
  });
  const horas = horarios.map((h) => h.hora);

  // Ocupado às 08:00 (40min, ocupa 08:00+08:30) — nem 08:00 nem 08:30 podem
  // ser sugeridos; 09:00 continua livre.
  assert.ok(!horas.includes("08:00"));
  assert.ok(!horas.includes("08:30"));
  assert.ok(horas.includes("09:00"));
});
