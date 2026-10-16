import { test } from "node:test";
import assert from "node:assert/strict";
import { remarcarAgendamento } from "../src/functions/remarcarAgendamento.js";

const AGENDAMENTO = {
  id: 5,
  data: "2026-09-05",
  hora: "10:00:00",
  paciente_nome: "Ana",
  tipo_atendimento: "fisioterapia",
};

test("remarcarAgendamento: formato de data inválido não consulta nada", async () => {
  let consultou = false;
  const resultado = await remarcarAgendamento(
    { agendamento_id: 1, nova_data: "05/09/2026", nova_hora: "10:00" },
    { pacienteId: 1, telefone: "5511999990000" },
    { buscarAgendamento: async () => ((consultou = true), null) }
  );

  assert.equal(resultado.sucesso, false);
  assert.match(resultado.motivo, /Formato de data inválido/);
  assert.equal(consultou, false);
});

test("remarcarAgendamento: formato de hora inválido não consulta nada", async () => {
  let consultou = false;
  const resultado = await remarcarAgendamento(
    { agendamento_id: 1, nova_data: "2026-09-05", nova_hora: "25:99" },
    { pacienteId: 1, telefone: "5511999990000" },
    { buscarAgendamento: async () => ((consultou = true), null) }
  );

  assert.equal(resultado.sucesso, false);
  assert.match(resultado.motivo, /Formato de hora inválido/);
  assert.equal(consultou, false);
});

test("remarcarAgendamento: agendamento não encontrado e sem importado dá mensagem genérica", async () => {
  const resultado = await remarcarAgendamento(
    { agendamento_id: 1, nova_data: "2026-09-05", nova_hora: "10:00" },
    { pacienteId: 1, telefone: "5511999990000" },
    {
      buscarAgendamento: async () => null,
      buscarAgendamentoImportado: async () => null,
    }
  );

  assert.equal(resultado.sucesso, false);
  assert.match(resultado.motivo, /Não encontrei esse agendamento/);
});

test("remarcarAgendamento: agendamento não encontrado mas existe importado orienta a falar com a recepção", async () => {
  const resultado = await remarcarAgendamento(
    { agendamento_id: 1, nova_data: "2026-09-05", nova_hora: "10:00" },
    { pacienteId: 1, telefone: "5511999990000" },
    {
      buscarAgendamento: async () => null,
      buscarAgendamentoImportado: async () => ({ nome: "Ana" }),
    }
  );

  assert.equal(resultado.sucesso, false);
  assert.match(resultado.motivo, /recepção da clínica/);
});

test("remarcarAgendamento: nova data/hora igual à atual é rejeitada sem chamar o serviço", async () => {
  let servicoChamado = false;
  const resultado = await remarcarAgendamento(
    { agendamento_id: 5, nova_data: "2026-09-05", nova_hora: "10:00" },
    { pacienteId: 1, telefone: "5511999990000" },
    {
      buscarAgendamento: async () => AGENDAMENTO,
      executarRemarcacao: async () => ((servicoChamado = true), {}),
    }
  );

  assert.equal(resultado.sucesso, false);
  assert.match(resultado.motivo, /igual à consulta já marcada/);
  assert.equal(servicoChamado, false);
});

test("remarcarAgendamento: caminho feliz chama o serviço e devolve os dados formatados", async () => {
  const resultado = await remarcarAgendamento(
    { agendamento_id: 5, nova_data: "2026-09-10", nova_hora: "14:00" },
    { pacienteId: 1, telefone: "5511999990000" },
    {
      buscarAgendamento: async () => AGENDAMENTO,
      executarRemarcacao: async ({ agendamento, novaData, novaHora }) => {
        assert.equal(agendamento.id, 5);
        assert.equal(novaData, "2026-09-10");
        assert.equal(novaHora, "14:00");
        return { data: "2026-09-10", hora: "14:00", tipo_atendimento: "fisioterapia" };
      },
    }
  );

  assert.equal(resultado.sucesso, true);
  assert.equal(resultado.data_anterior, "2026-09-05");
  assert.equal(resultado.hora_anterior, "10:00:00");
  assert.equal(resultado.data, "2026-09-10");
  assert.ok(resultado.diaSemana, "deve calcular o dia da semana da nova data");
});

test("remarcarAgendamento: erro conhecido do serviço vira mensagem amigável pro paciente", async () => {
  const resultado = await remarcarAgendamento(
    { agendamento_id: 5, nova_data: "2026-09-10", nova_hora: "14:00" },
    { pacienteId: 1, telefone: "5511999990000" },
    {
      buscarAgendamento: async () => AGENDAMENTO,
      executarRemarcacao: async () => {
        const erro = new Error("HORARIO_LOTADO");
        erro.codigo = "HORARIO_LOTADO";
        throw erro;
      },
    }
  );

  assert.equal(resultado.sucesso, false);
  assert.match(resultado.motivo, /número máximo de pacientes/);
});

test("remarcarAgendamento: erro desconhecido do serviço propaga (não é engolido)", async () => {
  await assert.rejects(() =>
    remarcarAgendamento(
      { agendamento_id: 5, nova_data: "2026-09-10", nova_hora: "14:00" },
      { pacienteId: 1, telefone: "5511999990000" },
      {
        buscarAgendamento: async () => AGENDAMENTO,
        executarRemarcacao: async () => {
          throw new Error("erro inesperado de banco");
        },
      }
    )
  );
});
