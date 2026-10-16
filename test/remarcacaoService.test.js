import { test } from "node:test";
import assert from "node:assert/strict";
import { remarcarConsulta, remarcarConsultaImportada } from "../src/services/remarcacaoService.js";

const AGENDAMENTO = {
  id: 5,
  paciente_nome: "Ana",
  tipo_atendimento: "fisioterapia",
  paciente_convenio: "Particular",
  paciente_telefone: "11999990000",
  primeira_consulta: true,
  queixa_principal: "Dor no ombro",
};

test("remarcarConsulta: valida disponibilidade antes de gravar", async () => {
  const chamadas = [];

  const resultado = await remarcarConsulta(
    { agendamento: AGENDAMENTO, novaData: "2026-09-10", novaHora: "14:00" },
    {
      validarDisponibilidade: async (args) => chamadas.push(["validar", args]),
      salvarNoBanco: async (args) => {
        chamadas.push(["salvar", args]);
        return { id: 5, data: "2026-09-10", hora: "14:00", tipo_atendimento: "fisioterapia" };
      },
    }
  );

  assert.equal(resultado.data, "2026-09-10");
  assert.deepEqual(chamadas[0], [
    "validar",
    { data: "2026-09-10", hora: "14:00", tipoAtendimento: "fisioterapia" },
  ]);
  assert.deepEqual(chamadas[1], ["salvar", { id: 5, data: "2026-09-10", hora: "14:00" }]);
});

test("remarcarConsulta: erro de validação propaga com o mesmo código, sem tentar gravar no banco", async () => {
  let salvouNoBanco = false;

  await assert.rejects(
    () =>
      remarcarConsulta(
        { agendamento: AGENDAMENTO, novaData: "2026-09-10", novaHora: "14:00" },
        {
          validarDisponibilidade: async () => {
            const erro = new Error("HORARIO_LOTADO");
            erro.codigo = "HORARIO_LOTADO";
            throw erro;
          },
          salvarNoBanco: async () => {
            salvouNoBanco = true;
          },
        }
      ),
    (err) => err.codigo === "HORARIO_LOTADO"
  );
  assert.equal(salvouNoBanco, false);
});

test("remarcarConsulta: falha ao gravar no banco lança FALHA_AO_GRAVAR", async () => {
  await assert.rejects(
    () =>
      remarcarConsulta(
        { agendamento: AGENDAMENTO, novaData: "2026-09-10", novaHora: "14:00" },
        {
          validarDisponibilidade: async () => {},
          salvarNoBanco: async () => {
            throw new Error("conexão caiu");
          },
        }
      ),
    (err) => err.codigo === "FALHA_AO_GRAVAR"
  );
});

const AGENDAMENTO_IMPORTADO = { id: 9, tipo_atendimento: "fisioterapia" };

test("remarcarConsultaImportada: valida disponibilidade antes de gravar", async () => {
  const chamadas = [];

  await remarcarConsultaImportada(
    { agendamento: AGENDAMENTO_IMPORTADO, novaData: "2026-09-15", novaHora: "09:00" },
    {
      validarDisponibilidade: async (args) => chamadas.push(["validar", args]),
      salvarNoBanco: async (args) => (chamadas.push(["salvar", args]), { id: 9, data: "2026-09-15", hora: "09:00" }),
    }
  );

  assert.deepEqual(chamadas[0], [
    "validar",
    { data: "2026-09-15", hora: "09:00", tipoAtendimento: "fisioterapia" },
  ]);
  assert.deepEqual(chamadas[1], ["salvar", { id: 9, data: "2026-09-15", hora: "09:00" }]);
});

test("remarcarConsultaImportada: erro de validação propaga sem chamar salvarNoBanco", async () => {
  let salvou = false;

  await assert.rejects(
    () =>
      remarcarConsultaImportada(
        { agendamento: AGENDAMENTO_IMPORTADO, novaData: "2026-09-15", novaHora: "09:00" },
        {
          validarDisponibilidade: async () => {
            const erro = new Error("HORARIO_LOTADO");
            erro.codigo = "HORARIO_LOTADO";
            throw erro;
          },
          salvarNoBanco: async () => ((salvou = true), {}),
        }
      ),
    (err) => err.codigo === "HORARIO_LOTADO"
  );
  assert.equal(salvou, false);
});

test("remarcarConsultaImportada: retorna o agendamento atualizado", async () => {
  const atualizado = { id: 9, data: "2026-09-15", hora: "09:00" };

  const resultado = await remarcarConsultaImportada(
    { agendamento: AGENDAMENTO_IMPORTADO, novaData: "2026-09-15", novaHora: "09:00" },
    { validarDisponibilidade: async () => {}, salvarNoBanco: async () => atualizado }
  );

  assert.equal(resultado, atualizado);
});

// Finding 3 do review final: remarcarAgendamentoImportado (salvarNoBanco
// padrão) retorna null quando o WHERE status = 'confirmado' não afeta
// nenhuma linha — ex. corrida: a recepção cancelou o mesmo agendamento em
// outra aba entre a checagem do controller e esta gravação. Sem essa
// checagem, o null propagava e o controller redirecionava como se tivesse
// dado certo.
test("remarcarConsultaImportada: salvarNoBanco retornando null (corrida) lança FALHA_AO_GRAVAR", async () => {
  await assert.rejects(
    () =>
      remarcarConsultaImportada(
        { agendamento: AGENDAMENTO_IMPORTADO, novaData: "2026-09-15", novaHora: "09:00" },
        {
          validarDisponibilidade: async () => {},
          salvarNoBanco: async () => null,
        }
      ),
    (err) => err.codigo === "FALHA_AO_GRAVAR"
  );
});

// Finding 4 do review final: sem o try/catch, um erro do Postgres no UPDATE
// de remarcarAgendamentoImportado (ex: colisão com o índice único
// idx_agendamentos_importados_unico) subia cru até o controller, que só sabe
// mapear err.codigo — virava um 500 genérico em vez da mensagem amigável de
// FALHA_AO_GRAVAR que o bot já tem pra esse mesmo tipo de falha.
test("remarcarConsultaImportada: erro do Postgres ao gravar (ex: colisão de índice único) vira FALHA_AO_GRAVAR", async () => {
  await assert.rejects(
    () =>
      remarcarConsultaImportada(
        { agendamento: AGENDAMENTO_IMPORTADO, novaData: "2026-09-15", novaHora: "09:00" },
        {
          validarDisponibilidade: async () => {},
          salvarNoBanco: async () => {
            const erroPg = new Error(
              'duplicate key value violates unique constraint "idx_agendamentos_importados_unico"'
            );
            erroPg.code = "23505";
            throw erroPg;
          },
        }
      ),
    (err) => err.codigo === "FALHA_AO_GRAVAR"
  );
});
