// test/dashboardControllerRemarcarAgendamento.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  telaRemarcarAgendamento,
  processarRemarcarAgendamento,
} from "../src/controllers/dashboardController.js";

function criarRespostaFalsa() {
  return {
    statusCode: 200,
    corpo: null,
    redirectedTo: null,
    viewRenderizada: null,
    dadosDaView: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(corpo) {
      this.corpo = corpo;
      return this;
    },
    redirect(url) {
      this.redirectedTo = url;
    },
    render(view, dados) {
      this.viewRenderizada = view;
      this.dadosDaView = dados;
    },
  };
}

const AGENDAMENTO = { id: 5, status: "confirmado", tipo_atendimento: "fisioterapia" };

test("telaRemarcarAgendamento: id não numérico responde 404", async () => {
  const res = criarRespostaFalsa();
  await telaRemarcarAgendamento({ params: { id: "abc" }, query: {} }, res, {
    buscarAgendamentoBot: async () => AGENDAMENTO,
  });
  assert.equal(res.statusCode, 404);
});

test("telaRemarcarAgendamento: agendamento não confirmado responde 404", async () => {
  const res = criarRespostaFalsa();
  await telaRemarcarAgendamento({ params: { id: "5" }, query: {} }, res, {
    buscarAgendamentoBot: async () => ({ ...AGENDAMENTO, status: "cancelado" }),
  });
  assert.equal(res.statusCode, 404);
});

test("telaRemarcarAgendamento: agendamento confirmado mas que já passou responde 404", async () => {
  const res = criarRespostaFalsa();
  await telaRemarcarAgendamento({ params: { id: "5" }, query: {} }, res, {
    buscarAgendamentoBot: async () => ({ ...AGENDAMENTO, ja_passou: true }),
  });
  assert.equal(res.statusCode, 404);
});

test("telaRemarcarAgendamento: sem data escolhida, renderiza sem buscar horários", async () => {
  let buscouHorarios = false;
  const res = criarRespostaFalsa();

  await telaRemarcarAgendamento({ params: { id: "5" }, query: {} }, res, {
    buscarAgendamentoBot: async () => AGENDAMENTO,
    buscarHorarios: async () => ((buscouHorarios = true), []),
  });

  assert.equal(res.viewRenderizada, "agendamentos/remarcar");
  assert.equal(res.dadosDaView.dataEscolhida, null);
  assert.equal(buscouHorarios, false);
});

test("telaRemarcarAgendamento: com data válida, busca horários daquele dia e tipo", async () => {
  const res = criarRespostaFalsa();

  await telaRemarcarAgendamento({ params: { id: "5" }, query: { data: "2026-09-10" } }, res, {
    buscarAgendamentoBot: async () => AGENDAMENTO,
    buscarHorarios: async ({ data, tipoAtendimento, amostrar }) => {
      assert.equal(data, "2026-09-10");
      assert.equal(tipoAtendimento, "fisioterapia");
      assert.equal(amostrar, false);
      return [{ data: "2026-09-10", hora: "09:00", diaSemana: "quinta" }];
    },
  });

  assert.equal(res.dadosDaView.dataEscolhida, "2026-09-10");
  assert.equal(res.dadosDaView.horarios.length, 1);
});

test("processarRemarcarAgendamento: data/hora inválida responde 400 sem consultar nada", async () => {
  let consultou = false;
  const res = criarRespostaFalsa();

  await processarRemarcarAgendamento(
    { params: { id: "5" }, body: { data: "10-09-2026", hora: "14:00" } },
    res,
    { buscarAgendamentoBot: async () => ((consultou = true), AGENDAMENTO) }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(consultou, false);
});

test("processarRemarcarAgendamento: agendamento não confirmado responde 404", async () => {
  const res = criarRespostaFalsa();

  await processarRemarcarAgendamento(
    { params: { id: "5" }, body: { data: "2026-09-10", hora: "14:00" } },
    res,
    { buscarAgendamentoBot: async () => ({ ...AGENDAMENTO, status: "cancelado" }) }
  );

  assert.equal(res.statusCode, 404);
});

test("processarRemarcarAgendamento: agendamento confirmado mas que já passou responde 404", async () => {
  const res = criarRespostaFalsa();

  await processarRemarcarAgendamento(
    { params: { id: "5" }, body: { data: "2026-09-10", hora: "14:00" } },
    res,
    { buscarAgendamentoBot: async () => ({ ...AGENDAMENTO, ja_passou: true }) }
  );

  assert.equal(res.statusCode, 404);
});

test("processarRemarcarAgendamento: erro conhecido do serviço vira mensagem 400", async () => {
  const res = criarRespostaFalsa();

  await processarRemarcarAgendamento(
    { params: { id: "5" }, body: { data: "2026-09-10", hora: "14:00" } },
    res,
    {
      buscarAgendamentoBot: async () => AGENDAMENTO,
      executarRemarcacaoBot: async () => {
        const erro = new Error("HORARIO_LOTADO");
        erro.codigo = "HORARIO_LOTADO";
        throw erro;
      },
    }
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.corpo, /lotado/i);
});

test("processarRemarcarAgendamento: erro desconhecido propaga", async () => {
  await assert.rejects(() =>
    processarRemarcarAgendamento(
      { params: { id: "5" }, body: { data: "2026-09-10", hora: "14:00" } },
      criarRespostaFalsa(),
      {
        buscarAgendamentoBot: async () => AGENDAMENTO,
        executarRemarcacaoBot: async () => {
          throw new Error("erro inesperado");
        },
      }
    )
  );
});

test("processarRemarcarAgendamento: caminho feliz chama o serviço e redireciona", async () => {
  const res = criarRespostaFalsa();

  await processarRemarcarAgendamento(
    { params: { id: "5" }, body: { data: "2026-09-10", hora: "14:00" } },
    res,
    {
      buscarAgendamentoBot: async () => AGENDAMENTO,
      executarRemarcacaoBot: async ({ agendamento, novaData, novaHora }) => {
        assert.equal(agendamento.id, 5);
        assert.equal(novaData, "2026-09-10");
        assert.equal(novaHora, "14:00");
        return {};
      },
    }
  );

  assert.equal(res.redirectedTo, "/agendamentos");
});

const AGENDAMENTO_IMPORTADO = { id: 9, status: "confirmado", tipo_atendimento: "fisioterapia" };

test("telaRemarcarAgendamento: origem importado usa buscarAgendamentoImportado", async () => {
  const res = criarRespostaFalsa();

  await telaRemarcarAgendamento({ params: { origem: "importado", id: "9" }, query: {} }, res, {
    buscarAgendamentoImportado: async () => AGENDAMENTO_IMPORTADO,
  });

  assert.equal(res.viewRenderizada, "agendamentos/remarcar");
  assert.equal(res.dadosDaView.agendamento.origem, "importado");
});

test("processarRemarcarAgendamento: origem importado chama executarRemarcacaoImportado", async () => {
  const res = criarRespostaFalsa();
  let chamouBot = false;

  await processarRemarcarAgendamento(
    { params: { origem: "importado", id: "9" }, body: { data: "2026-09-10", hora: "14:00" } },
    res,
    {
      buscarAgendamentoImportado: async () => AGENDAMENTO_IMPORTADO,
      executarRemarcacaoBot: async () => (chamouBot = true),
      executarRemarcacaoImportado: async ({ agendamento, novaData, novaHora }) => {
        assert.equal(agendamento.id, 9);
        assert.equal(novaData, "2026-09-10");
        assert.equal(novaHora, "14:00");
        return {};
      },
    }
  );

  assert.equal(chamouBot, false);
  assert.equal(res.redirectedTo, "/agendamentos");
});

// Finding 7 do review final: um valor de :origem que não seja exatamente
// "bot" ou "importado" (typo, caixa errada, etc.) tinha que 404, não cair
// silenciosamente no branch do bot e arriscar mexer na tabela errada.
test("telaRemarcarAgendamento: origem não reconhecida responde 404 sem consultar nada", async () => {
  let consultou = false;
  const res = criarRespostaFalsa();

  await telaRemarcarAgendamento({ params: { origem: "Importado", id: "9" }, query: {} }, res, {
    buscarAgendamentoBot: async () => ((consultou = true), AGENDAMENTO),
    buscarAgendamentoImportado: async () => ((consultou = true), AGENDAMENTO_IMPORTADO),
  });

  assert.equal(res.statusCode, 404);
  assert.equal(consultou, false);
});

test("processarRemarcarAgendamento: origem não reconhecida responde 404 sem consultar nada", async () => {
  let consultou = false;
  const res = criarRespostaFalsa();

  await processarRemarcarAgendamento(
    { params: { origem: "importados", id: "9" }, body: { data: "2026-09-10", hora: "14:00" } },
    res,
    {
      buscarAgendamentoBot: async () => ((consultou = true), AGENDAMENTO),
      buscarAgendamentoImportado: async () => ((consultou = true), AGENDAMENTO_IMPORTADO),
    }
  );

  assert.equal(res.statusCode, 404);
  assert.equal(consultou, false);
});
