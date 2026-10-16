import { test } from "node:test";
import assert from "node:assert/strict";
import { telaProximosAgendamentos } from "../src/controllers/dashboardController.js";
import dayjs from "../src/utils/dayjs.js";

const HOJE_FIXO = dayjs.tz("2026-09-10T10:00:00", "America/Sao_Paulo");

function criarRespostaFalsa() {
  return {
    viewRenderizada: null,
    dadosDaView: null,
    render(view, dados) {
      this.viewRenderizada = view;
      this.dadosDaView = dados;
    },
  };
}

const SEM_PSICOLOGOS = { listarPsicologos: async () => [] };

test("telaProximosAgendamentos: renderiza agendamentos/proximos com os itens", async () => {
  const res = criarRespostaFalsa();

  await telaProximosAgendamentos({ query: {} }, res, {
    listarAgenda: async () => [{ id: 1, origem: "bot", data: "2026-09-20", hora: "08:00:00" }],
    ...SEM_PSICOLOGOS,
    agora: HOJE_FIXO,
  });

  assert.equal(res.viewRenderizada, "agendamentos/proximos");
  assert.equal(res.dadosDaView.itens.length, 1);
});

test("telaProximosAgendamentos: descarta agendamentos de menos de 7 dias (já visíveis em /agendamentos)", async () => {
  const res = criarRespostaFalsa();

  await telaProximosAgendamentos({ query: {} }, res, {
    listarAgenda: async () => [
      { id: 1, origem: "bot", data: "2026-09-10", hora: "08:00:00" }, // hoje
      { id: 2, origem: "bot", data: "2026-09-16", hora: "08:00:00" }, // 6 dias — ainda dentro da semana corrente
      { id: 3, origem: "bot", data: "2026-09-17", hora: "08:00:00" }, // exatamente 7 dias — entra
      { id: 4, origem: "bot", data: "2026-09-20", hora: "08:00:00" }, // bem mais à frente — entra
    ],
    ...SEM_PSICOLOGOS,
    agora: HOJE_FIXO,
  });

  assert.deepEqual(
    res.dadosDaView.itens.map((i) => i.id),
    [3, 4]
  );
});

test("telaProximosAgendamentos: busca com limite fixo (janela ampla) e offset 0, ignorando data da query", async () => {
  let filtrosRecebidos = null;
  const res = criarRespostaFalsa();

  await telaProximosAgendamentos(
    { query: { data: "2026-09-10", status: "confirmado", tipo_atendimento: "psicologia", busca: "Ana", periodo: "tarde" } },
    res,
    {
      listarAgenda: async (filtros) => {
        filtrosRecebidos = filtros;
        return [];
      },
      ...SEM_PSICOLOGOS,
    }
  );

  assert.deepEqual(filtrosRecebidos, {
    status: "confirmado",
    tipoAtendimento: "psicologia",
    busca: "Ana",
    periodo: "tarde",
    psicologoId: null,
    origem: undefined,
    avaliacao: undefined,
    limite: 200,
    offset: 0,
  });
});

test("telaProximosAgendamentos: com tipoAtendimentoFixo, ignora tipo_atendimento da query e força o valor travado", async () => {
  let filtrosRecebidos = null;
  const res = criarRespostaFalsa();

  await telaProximosAgendamentos(
    { query: { tipo_atendimento: "psicologia" } },
    res,
    {
      listarAgenda: async (filtros) => {
        filtrosRecebidos = filtros;
        return [];
      },
      ...SEM_PSICOLOGOS,
      tipoAtendimentoFixo: "fisioterapia",
      agora: HOJE_FIXO,
    }
  );

  assert.equal(filtrosRecebidos.tipoAtendimento, "fisioterapia");
  assert.equal(res.dadosDaView.filtros.tipo_atendimento, "fisioterapia");
});

test("telaProximosAgendamentos: com tipoAtendimentoFixo, repassa tipoFixo pra view", async () => {
  const res = criarRespostaFalsa();

  await telaProximosAgendamentos({ query: {} }, res, {
    listarAgenda: async () => [],
    ...SEM_PSICOLOGOS,
    tipoAtendimentoFixo: "psicologia",
    agora: HOJE_FIXO,
  });

  assert.equal(res.dadosDaView.tipoFixo, "psicologia");
});

test("telaProximosAgendamentos: sem tipoAtendimentoFixo, tipoFixo na view é null", async () => {
  const res = criarRespostaFalsa();

  await telaProximosAgendamentos({ query: {} }, res, {
    listarAgenda: async () => [],
    ...SEM_PSICOLOGOS,
    agora: HOJE_FIXO,
  });

  assert.equal(res.dadosDaView.tipoFixo, null);
});

test("telaProximosAgendamentos: repassa psicologo_id da query pro modelo e pra view", async () => {
  let filtrosRecebidos = null;
  const res = criarRespostaFalsa();

  await telaProximosAgendamentos({ query: { psicologo_id: "3" } }, res, {
    listarAgenda: async (filtros) => {
      filtrosRecebidos = filtros;
      return [];
    },
    listarPsicologos: async () => [{ id: 3, nome: "Dra. Ana" }],
  });

  assert.equal(filtrosRecebidos.psicologoId, 3);
  assert.equal(res.dadosDaView.filtros.psicologo_id, "3");
  assert.deepEqual(res.dadosDaView.psicologos, [{ id: 3, nome: "Dra. Ana" }]);
});

test("telaProximosAgendamentos: ?whatsapp=enviado mostra mensagem de sucesso", async () => {
  const res = criarRespostaFalsa();

  await telaProximosAgendamentos({ query: { whatsapp: "enviado" } }, res, {
    listarAgenda: async () => [],
    ...SEM_PSICOLOGOS,
  });

  assert.match(res.dadosDaView.mensagemWhatsapp, /[Ee]nviad/);
});

test("telaProximosAgendamentos: sem ?whatsapp, não mostra mensagem", async () => {
  const res = criarRespostaFalsa();

  await telaProximosAgendamentos({ query: {} }, res, { listarAgenda: async () => [], ...SEM_PSICOLOGOS });

  assert.equal(res.dadosDaView.mensagemWhatsapp, null);
});

test("telaProximosAgendamentos: ?presenca_msg mostra a mensagem (truncada em 300 caracteres)", async () => {
  const res = criarRespostaFalsa();

  await telaProximosAgendamentos({ query: { presenca_msg: "Presença registrada." } }, res, {
    listarAgenda: async () => [],
    ...SEM_PSICOLOGOS,
  });

  assert.equal(res.dadosDaView.mensagemPresenca, "Presença registrada.");
});

test("telaProximosAgendamentos: repassa o filtro de origem pro modelo e pra view", async () => {
  let filtrosRecebidos = null;
  const res = criarRespostaFalsa();

  await telaProximosAgendamentos({ query: { origem: "bot" } }, res, {
    listarAgenda: async (filtros) => {
      filtrosRecebidos = filtros;
      return [];
    },
    ...SEM_PSICOLOGOS,
  });

  assert.equal(filtrosRecebidos.origem, "bot");
  assert.equal(res.dadosDaView.filtros.origem, "bot");
});

test("telaProximosAgendamentos: repassa o filtro de avaliação pro modelo e pra view", async () => {
  let filtrosRecebidos = null;
  const res = criarRespostaFalsa();

  await telaProximosAgendamentos({ query: { avaliacao: "retorno" } }, res, {
    listarAgenda: async (filtros) => {
      filtrosRecebidos = filtros;
      return [];
    },
    ...SEM_PSICOLOGOS,
  });

  assert.equal(filtrosRecebidos.avaliacao, "retorno");
  assert.equal(res.dadosDaView.filtros.avaliacao, "retorno");
});
