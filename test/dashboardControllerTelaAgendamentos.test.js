import { test } from "node:test";
import assert from "node:assert/strict";
import { telaAgendamentos } from "../src/controllers/dashboardController.js";

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

test("telaAgendamentos: repassa os filtros da query string pro modelo", async () => {
  let filtrosRecebidos = null;
  const res = criarRespostaFalsa();

  await telaAgendamentos(
    {
      query: {
        data: "2026-09-10",
        status: "confirmado",
        tipo_atendimento: "psicologia",
        busca: "Ana",
        limite: "20",
        offset: "0",
      },
    },
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
    data: "2026-09-10",
    status: "confirmado",
    tipoAtendimento: "psicologia",
    busca: "Ana",
    periodo: undefined,
    psicologoId: null,
    origem: undefined,
    avaliacao: undefined,
    limite: 20,
    offset: 0,
  });
});

test("telaAgendamentos: renderiza agendamentos/lista com os itens e os filtros recebidos", async () => {
  const res = criarRespostaFalsa();

  await telaAgendamentos({ query: { status: "cancelado" } }, res, {
    listarAgenda: async () => [{ id: 1, origem: "bot" }],
    ...SEM_PSICOLOGOS,
  });

  assert.equal(res.viewRenderizada, "agendamentos/lista");
  assert.equal(res.dadosDaView.itens.length, 1);
  assert.equal(res.dadosDaView.filtros.status, "cancelado");
});

test("telaAgendamentos: ?whatsapp=enviado mostra mensagem de sucesso", async () => {
  const res = criarRespostaFalsa();

  await telaAgendamentos({ query: { whatsapp: "enviado" } }, res, {
    listarAgenda: async () => [],
    ...SEM_PSICOLOGOS,
  });

  assert.match(res.dadosDaView.mensagemWhatsapp, /[Ee]nviad/);
});

test("telaAgendamentos: sem ?whatsapp, não mostra mensagem", async () => {
  const res = criarRespostaFalsa();

  await telaAgendamentos({ query: {} }, res, { listarAgenda: async () => [], ...SEM_PSICOLOGOS });

  assert.equal(res.dadosDaView.mensagemWhatsapp, null);
});

test("telaAgendamentos: repassa o filtro de período pro modelo e pra view", async () => {
  let filtrosRecebidos = null;
  const res = criarRespostaFalsa();

  await telaAgendamentos({ query: { periodo: "tarde" } }, res, {
    listarAgenda: async (filtros) => {
      filtrosRecebidos = filtros;
      return [];
    },
    ...SEM_PSICOLOGOS,
  });

  assert.equal(filtrosRecebidos.periodo, "tarde");
  assert.equal(res.dadosDaView.filtros.periodo, "tarde");
});

test("telaAgendamentos: sem query params, usa offset 0 e limite padrão (50) na view", async () => {
  const res = criarRespostaFalsa();

  await telaAgendamentos({ query: {} }, res, { listarAgenda: async () => [], ...SEM_PSICOLOGOS });

  assert.equal(res.dadosDaView.offsetAtual, 0);
  assert.equal(res.dadosDaView.limiteAtual, 50);
});

test("telaAgendamentos: página cheia (itens.length === limite) marca temProximaPagina true", async () => {
  const res = criarRespostaFalsa();

  await telaAgendamentos({ query: { limite: "1" } }, res, {
    listarAgenda: async () => [{ id: 1, origem: "bot" }],
    ...SEM_PSICOLOGOS,
  });

  assert.equal(res.dadosDaView.temProximaPagina, true);
});

test("telaAgendamentos: página incompleta (itens.length < limite) marca temProximaPagina false", async () => {
  const res = criarRespostaFalsa();

  await telaAgendamentos({ query: { limite: "10" } }, res, {
    listarAgenda: async () => [],
    ...SEM_PSICOLOGOS,
  });

  assert.equal(res.dadosDaView.temProximaPagina, false);
});

test("telaAgendamentos: repassa psicologo_id da query pro modelo e pra view", async () => {
  let filtrosRecebidos = null;
  const res = criarRespostaFalsa();

  await telaAgendamentos({ query: { psicologo_id: "3" } }, res, {
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

test("telaAgendamentos: com data + psicóloga filtradas, título de impressão vira 'Agenda: <nome>'", async () => {
  const res = criarRespostaFalsa();

  await telaAgendamentos({ query: { data: "2026-09-10", psicologo_id: "3" } }, res, {
    listarAgenda: async () => [],
    listarPsicologos: async () => [{ id: 3, nome: "Dra. Ana" }],
  });

  assert.match(res.dadosDaView.tituloAgenda, /^Agenda: Dra\. Ana/);
});

test("telaAgendamentos: só com data (sem psicóloga), título continua 'Agenda de <data>'", async () => {
  const res = criarRespostaFalsa();

  await telaAgendamentos({ query: { data: "2026-09-10" } }, res, {
    listarAgenda: async () => [],
    ...SEM_PSICOLOGOS,
  });

  assert.match(res.dadosDaView.tituloAgenda, /^Agenda de /);
});

test("telaAgendamentos: sem data, título é 'Todos os agendamentos'", async () => {
  const res = criarRespostaFalsa();

  await telaAgendamentos({ query: {} }, res, { listarAgenda: async () => [], ...SEM_PSICOLOGOS });

  assert.equal(res.dadosDaView.tituloAgenda, "Todos os agendamentos");
});

test("telaAgendamentos: repassa o filtro de origem pro modelo e pra view", async () => {
  let filtrosRecebidos = null;
  const res = criarRespostaFalsa();

  await telaAgendamentos({ query: { origem: "manual" } }, res, {
    listarAgenda: async (filtros) => {
      filtrosRecebidos = filtros;
      return [];
    },
    ...SEM_PSICOLOGOS,
  });

  assert.equal(filtrosRecebidos.origem, "manual");
  assert.equal(res.dadosDaView.filtros.origem, "manual");
});

test("telaAgendamentos: com tipoAtendimentoFixo, ignora tipo_atendimento da query e força o valor travado", async () => {
  let filtrosRecebidos = null;
  const res = criarRespostaFalsa();

  await telaAgendamentos(
    { query: { tipo_atendimento: "psicologia" } },
    res,
    {
      listarAgenda: async (filtros) => {
        filtrosRecebidos = filtros;
        return [];
      },
      ...SEM_PSICOLOGOS,
      tipoAtendimentoFixo: "fisioterapia",
    }
  );

  assert.equal(filtrosRecebidos.tipoAtendimento, "fisioterapia");
  assert.equal(res.dadosDaView.filtros.tipo_atendimento, "fisioterapia");
});

test("telaAgendamentos: com tipoAtendimentoFixo, repassa tipoFixo=true pra view", async () => {
  const res = criarRespostaFalsa();

  await telaAgendamentos({ query: {} }, res, {
    listarAgenda: async () => [],
    ...SEM_PSICOLOGOS,
    tipoAtendimentoFixo: "psicologia",
  });

  assert.equal(res.dadosDaView.tipoFixo, "psicologia");
});

test("telaAgendamentos: sem tipoAtendimentoFixo, tipoFixo na view é null", async () => {
  const res = criarRespostaFalsa();

  await telaAgendamentos({ query: {} }, res, { listarAgenda: async () => [], ...SEM_PSICOLOGOS });

  assert.equal(res.dadosDaView.tipoFixo, null);
});

test("telaAgendamentos: repassa o filtro de avaliação pro modelo e pra view", async () => {
  let filtrosRecebidos = null;
  const res = criarRespostaFalsa();

  await telaAgendamentos({ query: { avaliacao: "avaliacao" } }, res, {
    listarAgenda: async (filtros) => {
      filtrosRecebidos = filtros;
      return [];
    },
    ...SEM_PSICOLOGOS,
  });

  assert.equal(filtrosRecebidos.avaliacao, "avaliacao");
  assert.equal(res.dadosDaView.filtros.avaliacao, "avaliacao");
});
