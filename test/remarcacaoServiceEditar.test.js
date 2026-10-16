import { test } from "node:test";
import assert from "node:assert/strict";
import { editarConsulta, editarConsultaImportada } from "../src/services/remarcacaoService.js";

const AGENDAMENTO = {
  id: 5,
  paciente_id: 20,
  paciente_nome: "Ana",
  paciente_convenio: "Particular",
  paciente_telefone: "5511999990000",
  tipo_atendimento: "fisioterapia",
  data: "2026-09-10",
  // Postgres devolve TIME como "HH:mm:ss" (sem type parser instalado —
  // ver src/db/pool.js e o comentário equivalente em calendarService.js
  // ~linha 88). Mantido assim aqui de propósito pra exercitar a
  // normalização de soTrocouPaciente em remarcacaoService.js.
  hora: "08:00:00",
  primeira_consulta: true,
  queixa_principal: null,
  google_event_id: "evt-antigo",
};

test("editarConsulta: só troca o paciente (data/hora/tipo iguais) — pula validarDisponibilidade e preserva google_event_id", async () => {
  const chamadas = [];
  const resultado = await editarConsulta(
    {
      agendamento: AGENDAMENTO,
      novoPacienteId: 30,
      novaData: AGENDAMENTO.data,
      // Simula o <input type="time"> do formulário, que submete "HH:mm" —
      // sem segundos, diferente do "HH:mm:ss" que agendamento.hora carrega
      // (vindo do Postgres). É essa diferença de formato que faz mesmoSlot
      // precisar normalizar antes de comparar.
      novaHora: "08:00",
      novoTipoAtendimento: AGENDAMENTO.tipo_atendimento,
      usuarioId: 2,
    },
    {
      validarDisponibilidade: async () => {
        throw new Error("não deveria validar — é o mesmo slot que o agendamento já ocupa");
      },
      salvarNoBanco: async (args) => (chamadas.push(["salvarNoBanco", args]), { id: 5, ...args }),
    }
  );

  assert.deepEqual(chamadas.map((c) => c[0]), ["salvarNoBanco"]);
  assert.equal(chamadas[0][1].pacienteId, 30);
  assert.equal(chamadas[0][1].googleEventId, "evt-antigo", "coluna nunca é alterada aqui, só preservada");
  assert.equal(resultado.pacienteId, 30);
});

test("editarConsulta: só troca o paciente — falha ao gravar no banco lança FALHA_AO_GRAVAR", async () => {
  await assert.rejects(
    () =>
      editarConsulta(
        {
          agendamento: AGENDAMENTO,
          novoPacienteId: 30,
          novaData: AGENDAMENTO.data,
          novaHora: "08:00",
          novoTipoAtendimento: AGENDAMENTO.tipo_atendimento,
          usuarioId: 2,
        },
        {
          salvarNoBanco: async () => { throw new Error("conexão caiu"); },
        }
      ),
    (err) => err.codigo === "FALHA_AO_GRAVAR"
  );
});

test("editarConsulta: troca data/hora — valida disponibilidade antes de gravar", async () => {
  const chamadas = [];
  await editarConsulta(
    {
      agendamento: AGENDAMENTO,
      novoPacienteId: AGENDAMENTO.paciente_id,
      novaData: "2026-09-15",
      novaHora: "09:00",
      novoTipoAtendimento: AGENDAMENTO.tipo_atendimento,
      usuarioId: 2,
    },
    {
      validarDisponibilidade: async (args) => chamadas.push(["validar", args]),
      salvarNoBanco: async (args) => (chamadas.push(["salvarNoBanco", args]), { id: 5, ...args }),
    }
  );

  assert.deepEqual(chamadas.map((c) => c[0]), ["validar", "salvarNoBanco"]);
  assert.deepEqual(chamadas[0][1], { data: "2026-09-15", hora: "09:00", tipoAtendimento: "fisioterapia" });
  assert.equal(chamadas[1][1].googleEventId, "evt-antigo", "coluna nunca ganha valor novo");
});

test("editarConsulta: troca só o tipo (data/hora iguais) — também valida disponibilidade (duração muda)", async () => {
  const chamadas = [];
  await editarConsulta(
    {
      agendamento: AGENDAMENTO,
      novoPacienteId: AGENDAMENTO.paciente_id,
      novaData: AGENDAMENTO.data,
      novaHora: "08:00",
      novoTipoAtendimento: "psicologia",
      usuarioId: 2,
    },
    {
      validarDisponibilidade: async (args) => chamadas.push(["validar", args]),
      salvarNoBanco: async (args) => ({ id: 5, ...args }),
    }
  );

  assert.equal(chamadas[0][1].tipoAtendimento, "psicologia");
});

test("editarConsulta: erro de validação propaga sem tentar gravar no banco", async () => {
  let salvou = false;
  await assert.rejects(
    () =>
      editarConsulta(
        {
          agendamento: AGENDAMENTO,
          novoPacienteId: AGENDAMENTO.paciente_id,
          novaData: "2026-09-15",
          novaHora: "09:00",
          novoTipoAtendimento: AGENDAMENTO.tipo_atendimento,
          usuarioId: 2,
        },
        {
          validarDisponibilidade: async () => {
            const erro = new Error("HORARIO_LOTADO");
            erro.codigo = "HORARIO_LOTADO";
            throw erro;
          },
          salvarNoBanco: async () => { salvou = true; },
        }
      ),
    (err) => err.codigo === "HORARIO_LOTADO"
  );
  assert.equal(salvou, false);
});

test("editarConsulta: falha ao gravar no banco lança FALHA_AO_GRAVAR", async () => {
  await assert.rejects(
    () =>
      editarConsulta(
        {
          agendamento: AGENDAMENTO,
          novoPacienteId: AGENDAMENTO.paciente_id,
          novaData: "2026-09-15",
          novaHora: "09:00",
          novoTipoAtendimento: AGENDAMENTO.tipo_atendimento,
          usuarioId: 2,
        },
        {
          validarDisponibilidade: async () => {},
          salvarNoBanco: async () => { throw new Error("conexão caiu"); },
        }
      ),
    (err) => err.codigo === "FALHA_AO_GRAVAR"
  );
});

test("editarConsulta: repassa novoPsicologoId pro salvarNoBanco (troca de paciente, mesmo slot)", async () => {
  const chamadas = [];
  await editarConsulta(
    {
      agendamento: AGENDAMENTO,
      novoPacienteId: 30,
      novaData: AGENDAMENTO.data,
      novaHora: "08:00",
      novoTipoAtendimento: AGENDAMENTO.tipo_atendimento,
      novoPsicologoId: 8,
      usuarioId: 2,
    },
    {
      salvarNoBanco: async (args) => (chamadas.push(args), { id: 5, ...args }),
    }
  );

  assert.equal(chamadas[0].psicologoId, 8);
});

test("editarConsulta: repassa novoPsicologoId pro salvarNoBanco (trocando data/hora)", async () => {
  const chamadas = [];
  await editarConsulta(
    {
      agendamento: AGENDAMENTO,
      novoPacienteId: AGENDAMENTO.paciente_id,
      novaData: "2026-09-15",
      novaHora: "09:00",
      novoTipoAtendimento: AGENDAMENTO.tipo_atendimento,
      novoPsicologoId: 8,
      usuarioId: 2,
    },
    {
      validarDisponibilidade: async () => {},
      salvarNoBanco: async (args) => (chamadas.push(args), { id: 5, ...args }),
    }
  );

  assert.equal(chamadas[0].psicologoId, 8);
});

test("editarConsulta: repassa novoFisioterapeutaId pro salvarNoBanco", async () => {
  const chamadas = [];
  await editarConsulta(
    {
      agendamento: AGENDAMENTO,
      novoPacienteId: AGENDAMENTO.paciente_id,
      novaData: AGENDAMENTO.data,
      novaHora: "08:00",
      novoTipoAtendimento: AGENDAMENTO.tipo_atendimento,
      novoFisioterapeutaId: 3,
      usuarioId: 2,
    },
    {
      salvarNoBanco: async (args) => (chamadas.push(args), { id: 5, ...args }),
    }
  );

  assert.equal(chamadas[0].fisioterapeutaId, 3);
});

const AGENDAMENTO_IMPORTADO = {
  id: 9,
  nome: "Carla",
  telefone: "5511977770000",
  tipo_atendimento: "fisioterapia",
  data: "2026-09-10",
  // Mesmo formato "HH:mm:ss" do Postgres que AGENDAMENTO.hora acima.
  hora: "08:00:00",
};

test("editarConsultaImportada: valida disponibilidade e grava nome/telefone/tipo/data/hora novos", async () => {
  const chamadas = [];
  const resultado = await editarConsultaImportada(
    {
      agendamento: AGENDAMENTO_IMPORTADO,
      novoNome: "Carla Souza",
      novoTelefone: "5511977771111",
      novoTipoAtendimento: "psicologia",
      novaData: "2026-09-16",
      novaHora: "10:00",
      usuarioId: 2,
    },
    {
      validarDisponibilidade: async (args) => chamadas.push(["validar", args]),
      salvarNoBanco: async (args) => (chamadas.push(["salvar", args]), { id: 9, ...args }),
    }
  );

  assert.deepEqual(chamadas[0][1], { data: "2026-09-16", hora: "10:00", tipoAtendimento: "psicologia" });
  assert.equal(resultado.nome, "Carla Souza");
});

test("editarConsultaImportada: data/hora/tipo iguais (só corrige nome/telefone) — pula validarDisponibilidade", async () => {
  const chamadas = [];
  const resultado = await editarConsultaImportada(
    {
      agendamento: AGENDAMENTO_IMPORTADO,
      novoNome: "Carla Souza",
      novoTelefone: AGENDAMENTO_IMPORTADO.telefone,
      novoTipoAtendimento: AGENDAMENTO_IMPORTADO.tipo_atendimento,
      novaData: AGENDAMENTO_IMPORTADO.data,
      // Simula o <input type="time"> do formulário ("HH:mm"), enquanto
      // agendamento.hora vem do Postgres como "HH:mm:ss" — mesmo cenário de
      // editarConsulta acima. Sem a normalização, isso seria tratado como
      // "mudou de horário" e validarDisponibilidade se autobloquearia
      // contando o próprio registro (ainda confirmado) nesse slot.
      novaHora: "08:00",
      usuarioId: 2,
    },
    {
      validarDisponibilidade: async (args) => { chamadas.push(["validar", args]); },
      salvarNoBanco: async (args) => (chamadas.push(["salvar", args]), { id: 9, ...args }),
    }
  );

  assert.deepEqual(
    chamadas.map((c) => c[0]),
    ["salvar"],
    "não deveria chamar validarDisponibilidade quando data/hora/tipo não mudam"
  );
  assert.equal(resultado.nome, "Carla Souza");
});

test("editarConsultaImportada: hora muda de verdade — chama validarDisponibilidade", async () => {
  const chamadas = [];
  await editarConsultaImportada(
    {
      agendamento: AGENDAMENTO_IMPORTADO,
      novoNome: AGENDAMENTO_IMPORTADO.nome,
      novoTelefone: AGENDAMENTO_IMPORTADO.telefone,
      novoTipoAtendimento: AGENDAMENTO_IMPORTADO.tipo_atendimento,
      novaData: AGENDAMENTO_IMPORTADO.data,
      novaHora: "09:00",
      usuarioId: 2,
    },
    {
      validarDisponibilidade: async (args) => { chamadas.push(["validar", args]); },
      salvarNoBanco: async (args) => (chamadas.push(["salvar", args]), { id: 9, ...args }),
    }
  );

  assert.deepEqual(chamadas.map((c) => c[0]), ["validar", "salvar"]);
});

test("editarConsultaImportada: repassa novoPsicologoId pro salvarNoBanco", async () => {
  const chamadas = [];
  await editarConsultaImportada(
    {
      agendamento: AGENDAMENTO_IMPORTADO,
      novoNome: AGENDAMENTO_IMPORTADO.nome,
      novoTelefone: AGENDAMENTO_IMPORTADO.telefone,
      novoTipoAtendimento: AGENDAMENTO_IMPORTADO.tipo_atendimento,
      novaData: AGENDAMENTO_IMPORTADO.data,
      novaHora: "08:00",
      novoPsicologoId: 4,
      usuarioId: 2,
    },
    {
      salvarNoBanco: async (args) => (chamadas.push(args), { id: 9, ...args }),
    }
  );

  assert.equal(chamadas[0].psicologoId, 4);
});

test("editarConsultaImportada: repassa novoFisioterapeutaId pro salvarNoBanco", async () => {
  const chamadas = [];
  await editarConsultaImportada(
    {
      agendamento: AGENDAMENTO_IMPORTADO,
      novoNome: AGENDAMENTO_IMPORTADO.nome,
      novoTelefone: AGENDAMENTO_IMPORTADO.telefone,
      novoTipoAtendimento: AGENDAMENTO_IMPORTADO.tipo_atendimento,
      novaData: AGENDAMENTO_IMPORTADO.data,
      novaHora: "08:00",
      novoFisioterapeutaId: 6,
      usuarioId: 2,
    },
    {
      salvarNoBanco: async (args) => (chamadas.push(args), { id: 9, ...args }),
    }
  );

  assert.equal(chamadas[0].fisioterapeutaId, 6);
});

test("editarConsultaImportada: 0 linhas afetadas (corrida) lança FALHA_AO_GRAVAR", async () => {
  await assert.rejects(
    () =>
      editarConsultaImportada(
        {
          agendamento: AGENDAMENTO_IMPORTADO,
          novoNome: "Carla",
          novoTelefone: AGENDAMENTO_IMPORTADO.telefone,
          novoTipoAtendimento: "fisioterapia",
          novaData: "2026-09-16",
          novaHora: "10:00",
          usuarioId: 2,
        },
        { validarDisponibilidade: async () => {}, salvarNoBanco: async () => null }
      ),
    (err) => err.codigo === "FALHA_AO_GRAVAR"
  );
});
