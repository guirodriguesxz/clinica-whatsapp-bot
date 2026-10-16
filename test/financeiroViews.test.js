// test/financeiroViews.test.js
//
// Renderiza as views EJS de /financeiro diretamente (sem passar pelo
// controller/app), pra pegar a classe de bug que fica escondida atrás de
// mocks que só verificam res.dadosDaView: o mesmo valor monetário chega em
// formatos diferentes dependendo da query (number vindo de json_build_object
// na lista, string vindo de coluna NUMERIC direta no relatório), e sem
// formatação consistente a mesma quantia aparece "R$ 150.5" numa tela e
// "R$ 150.00" na outra.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";
import { formatarMoeda } from "../src/utils/dinheiro.js";
import { formatarDataExtensa } from "../src/utils/data.js";
import dashboardRoutes from "../src/routes/dashboardRoutes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.join(__dirname, "..", "src", "views");

function renderizar(viewRelativa, dados) {
  const caminho = path.join(VIEWS_DIR, viewRelativa);
  return ejs.renderFile(caminho, {
    csrfToken: "token-fake",
    formatarMoeda,
    formatarDataExtensa,
    ...dados,
  });
}

test("financeiro/lista: valor de pagamento vindo como number puro (json_build_object) é formatado com 2 casas", async () => {
  const itens = [
    {
      id: 1,
      data: "2026-08-20",
      hora: "10:00:00",
      paciente_nome: "Fulana",
      tipo_atendimento: "fisioterapia",
      origem: "bot",
      pagamentos: [
        {
          id: 10,
          valor: 150.5, // number puro, como json_agg/json_build_object devolve via pg
          forma_pagamento: "pix",
          parcelas: null,
          valor_acrescimo: null,
          status: "pago",
          data: "2026-08-20",
          observacao: null,
        },
      ],
    },
  ];

  const html = await renderizar("financeiro/lista.ejs", {
    itens,
    filtroData: null,
    limiteAtual: 50,
    offsetAtual: 0,
    temProximaPagina: false,
  });

  assert.match(html, /R\$ 150\.50/);
  assert.doesNotMatch(html, /R\$ 150\.5(?!0)/); // não pode aparecer sem o zero à direita
});

test("financeiro oferece somente o relatório mensal aprovado, sem Convênio nem guia", async () => {
  const html = await renderizar("financeiro/lista.ejs", {
    itens: [], filtroData: null, limiteAtual: 50, offsetAtual: 0, temProximaPagina: false,
  });
  assert.match(html, /name="formaPagamento"/);
  assert.doesNotMatch(html, /Gerar guia/);
  assert.match(html, /href="\/financeiro\/relatorio"/);
});

test("financeiro/lista: mostra o histórico append-only e não permite um novo estorno", async () => {
  const itens = [
    {
      id: 1,
      data: "2026-08-20",
      hora: "10:00:00",
      paciente_nome: "Fulana",
      tipo_atendimento: "fisioterapia",
      origem: "bot",
      pagamentos: [
        {
          id: 10,
          valor: 150,
          forma_pagamento: "pix",
          parcelas: null,
          valor_acrescimo: null,
          status: "pago",
          data: "2026-08-20",
          observacao: null,
          tipo_lancamento: "pagamento",
          pagamento_origem_id: null,
          estornado_por: 11,
        },
        {
          id: 11,
          valor: 150,
          forma_pagamento: "pix",
          parcelas: null,
          valor_acrescimo: null,
          status: "pago",
          data: "2026-08-21",
          observacao: "Solicitado pelo paciente",
          tipo_lancamento: "estorno",
          pagamento_origem_id: 10,
          estornado_por: null,
          registrado_por: 7,
          registrado_por_nome: "<script>alert('xss')</script>",
        },
      ],
    },
  ];

  const html = await renderizar("financeiro/lista.ejs", {
    itens,
    filtroData: null,
    limiteAtual: 50,
    offsetAtual: 0,
    temProximaPagina: false,
  });

  const formularioEstorno = html.match(
    /<form[\s\S]*?action="\/financeiro\/pagamento\/10\/estornar"[\s\S]*?<\/form>/
  )?.[0];

  assert.equal(formularioEstorno, undefined);
  assert.match(html, /Pagamento estornado/);
  assert.match(html, /Estorno do pagamento #10/);
  assert.match(html, /Estorno registrado por &lt;script&gt;alert\(&#39;xss&#39;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\('xss'\)<\/script>/);
  assert.doesNotMatch(html, /action="\/financeiro\/pagamento\/10\/estornar"/);
  assert.doesNotMatch(html, /action="\/financeiro\/pagamento\/11\/estornar"/);
  assert.doesNotMatch(html, /150\s*-\s*150/);
});

test("financeiro/lista: exibe Estornar somente para o pagamento original ainda elegível", async () => {
  const html = await renderizar("financeiro/lista.ejs", {
    itens: [
      {
        id: 1,
        data: "2026-08-20",
        hora: "10:00:00",
        paciente_nome: "Fulana",
        tipo_atendimento: "fisioterapia",
        origem: "bot",
        pagamentos: [
          {
            id: 31,
            valor: 150,
            forma_pagamento: "pix",
            parcelas: null,
            valor_acrescimo: null,
            status: "pago",
            data: "2026-08-20",
            observacao: null,
            tipo_lancamento: "pagamento",
            pagamento_origem_id: null,
            estornado_por: null,
          },
        ],
      },
    ],
    filtroData: null,
    limiteAtual: 50,
    offsetAtual: 0,
    temProximaPagina: false,
  });

  assert.match(html, /action="\/financeiro\/pagamento\/31\/estornar"/);
  assert.match(html, /<button type="submit">Estornar<\/button>/);
});

test("financeiro/lista: usa painéis <details> nativos para pagamento e estorno, preservando os formulários existentes", async () => {
  const html = await renderizar("financeiro/lista.ejs", {
    itens: [
      {
        id: 1,
        data: "2026-08-20",
        hora: "10:00:00",
        paciente_nome: "Fulana",
        tipo_atendimento: "fisioterapia",
        origem: "bot",
        pagamentos: [
          {
            id: 31,
            valor: 150,
            forma_pagamento: "pix",
            parcelas: null,
            valor_acrescimo: null,
            status: "pago",
            data: "2026-08-20",
            observacao: null,
            tipo_lancamento: "pagamento",
            pagamento_origem_id: null,
            estornado_por: null,
          },
        ],
      },
    ],
    filtroData: null,
    limiteAtual: 50,
    offsetAtual: 0,
    temProximaPagina: false,
  });

  assert.match(html, /<details[^>]*class="[^"]*payment-entry/);
  assert.match(html, /<summary[^>]*>\s*Registrar pagamento\s*<\/summary>/);
  assert.match(html, /<details[^>]*class="[^"]*refund-entry/);
  assert.match(html, /action="\/financeiro\/pagamento\/31\/estornar"/);
  assert.match(html, /action="\/financeiro\/agendamento\/1"/);
});

test("financeiro/relatorio: exibe o total assinado e a contagem de estornos fornecidos pelo backend", async () => {
  const relatorio = {
    mes: "2026-08",
    totalFaturado: { total: "0.00", quantidade: "1", quantidade_estornos: "1" },
    totalRecebido: { total: "0.00", quantidade: "1", quantidade_estornos: "1" },
    porTipoAtendimento: [],
    porFormaPagamento: [],
    porStatus: [],
    porPlano: [],
    porProfissionalPsicologia: [],
    detalhamento: [],
  };

  const html = await renderizar("financeiro/relatorio.ejs", {
    relatorio,
    plano: null,
    especialidade: null,
    dia: null,
    turno: null,
    porFisioterapeutas: null,
    valorPorFisioterapeuta: null,
  });

  assert.match(html, /R\$ 0\.00/);
  assert.match(html, /1 pagamentos/);
  assert.doesNotMatch(html, /1 lançamentos/);
  assert.match(html, /Estornos no período: 1/);
  assert.match(html, /<form method="get" action="\/financeiro\/relatorio">/);
  assert.match(html, /<input type="month" name="mes" value="2026-08" \/>/);
  assert.match(html, /class="[^"]*report-filters/);
  assert.match(html, /class="[^"]*metric-grid/);
  assert.equal((html.match(/class="[^"]*metric-card/g) || []).length, 2);
  assert.doesNotMatch(html, /<canvas|<svg[^>]*class="[^"]*chart/);
});

test("financeiro/relatorio: com dia/turno/porFisioterapeutas preenchidos, mostra o card de valor por fisioterapeuta e preserva os filtros", async () => {
  const relatorio = {
    mes: "2026-08",
    totalFaturado: { total: "500.00", quantidade: "5", quantidade_estornos: "0" },
    totalRecebido: { total: "0.00", quantidade: "0", quantidade_estornos: "0" },
    porTipoAtendimento: [],
    porFormaPagamento: [],
    porStatus: [],
    porPlano: [],
    porProfissionalPsicologia: [],
    detalhamento: [],
  };

  const html = await renderizar("financeiro/relatorio.ejs", {
    relatorio,
    plano: "Mar Azul Saúde",
    especialidade: null,
    dia: "2026-08-17",
    turno: "manha",
    porFisioterapeutas: 2,
    valorPorFisioterapeuta: 250,
  });

  assert.match(html, /<input type="date" name="dia" value="2026-08-17" \/>/);
  assert.match(html, /<option value="manha" selected>/);
  assert.match(html, /<input[^>]*name="porFisioterapeutas"[^>]*value="2"/);
  assert.match(html, /Valor por fisioterapeuta/);
  assert.match(html, /R\$ 250\.00/);
  assert.equal((html.match(/class="[^"]*metric-card/g) || []).length, 3);
});

test("financeiro/relatorio: sem porFisioterapeutas informado, não mostra o card de valor por fisioterapeuta", async () => {
  const relatorio = {
    mes: "2026-08",
    totalFaturado: { total: "500.00", quantidade: "5", quantidade_estornos: "0" },
    totalRecebido: { total: "0.00", quantidade: "0", quantidade_estornos: "0" },
    porTipoAtendimento: [],
    porFormaPagamento: [],
    porStatus: [],
    porPlano: [],
    porProfissionalPsicologia: [],
    detalhamento: [],
  };

  const html = await renderizar("financeiro/relatorio.ejs", {
    relatorio,
    plano: null,
    especialidade: null,
    dia: null,
    turno: null,
    porFisioterapeutas: null,
    valorPorFisioterapeuta: null,
  });

  assert.doesNotMatch(html, /Valor por fisioterapeuta/);
  assert.equal((html.match(/class="[^"]*metric-card/g) || []).length, 2);
});

test("financeiro/relatorio: filtro de plano/especialidade preserva os valores selecionados e mostra as quebras novas", async () => {
  const relatorio = {
    mes: "2026-08",
    totalFaturado: { total: "0.00", quantidade: "0", quantidade_estornos: "0" },
    totalRecebido: { total: "0.00", quantidade: "0", quantidade_estornos: "0" },
    porTipoAtendimento: [],
    porFormaPagamento: [],
    porStatus: [],
    porPlano: [{ plano: "Bússola", total: "150.00", quantidade: "3" }],
    porProfissionalPsicologia: [{ profissional: "Dra. Ana", total: "300.00", quantidade: "2" }],
    detalhamento: [],
  };

  const html = await renderizar("financeiro/relatorio.ejs", {
    relatorio,
    plano: "Bússola",
    especialidade: "psicologia",
    dia: null,
    turno: null,
    porFisioterapeutas: null,
    valorPorFisioterapeuta: null,
  });

  assert.match(html, /<input type="text" name="plano" value="Bússola" \/>/);
  assert.match(html, /<option value="psicologia" selected>Psicologia<\/option>/);
  assert.match(html, /Bússola<\/td>\s*<td>R\$ 150\.00<\/td>/);
  assert.match(html, /Dra\. Ana<\/td>\s*<td>R\$ 300\.00<\/td>/);
});

test("financeiro/relatorio: mostra avaliações/sessões e o repasse calculado por convênio", async () => {
  const relatorio = {
    mes: "2026-08",
    totalFaturado: { total: "0.00", quantidade: "0", quantidade_estornos: "0" },
    totalRecebido: { total: "0.00", quantidade: "0", quantidade_estornos: "0" },
    porTipoAtendimento: [],
    porFormaPagamento: [],
    porStatus: [],
    porPlano: [
      {
        plano: "Mar Azul Saúde", total: "150.00", quantidade: "5",
        quantidade_avaliacao: "1", quantidade_sessao: "4",
        valorRepasse: 20.32, motivoRepasseIndisponivel: null,
      },
      {
        plano: "Bio Vida", total: "50.00", quantidade: "2",
        quantidade_avaliacao: "0", quantidade_sessao: "2",
        valorRepasse: null, motivoRepasseIndisponivel: "nao_configurado",
      },
      {
        plano: "MAR AZUL SP (texto antigo)", total: "30.00", quantidade: "1",
        quantidade_avaliacao: "0", quantidade_sessao: "1",
        valorRepasse: null, motivoRepasseIndisponivel: "nao_identificado",
      },
    ],
    porProfissionalPsicologia: [],
    detalhamento: [],
  };

  const html = await renderizar("financeiro/relatorio.ejs", {
    relatorio,
    plano: null,
    especialidade: null,
    dia: null,
    turno: null,
    porFisioterapeutas: null,
    valorPorFisioterapeuta: null,
  });

  assert.match(html, /Mar Azul Saúde<\/td>[\s\S]*?<td>1<\/td>\s*<td>4<\/td>\s*<td>\s*R\$ 20\.32/);
  assert.match(html, /Bio Vida<\/td>[\s\S]*?convênio sem valores de repasse cadastrados/);
  assert.match(html, /MAR AZUL SP \(texto antigo\)<\/td>[\s\S]*?paciente sem convênio identificado/);
});

test("financeiro/relatorio: sem profissionais de Psicologia no período, mostra aviso em vez de tabela vazia", async () => {
  const relatorio = {
    mes: "2026-08",
    totalFaturado: { total: "0.00", quantidade: "0", quantidade_estornos: "0" },
    totalRecebido: { total: "0.00", quantidade: "0", quantidade_estornos: "0" },
    porTipoAtendimento: [],
    porFormaPagamento: [],
    porStatus: [],
    porPlano: [],
    porProfissionalPsicologia: [],
    detalhamento: [],
  };

  const html = await renderizar("financeiro/relatorio.ejs", {
    relatorio,
    plano: null,
    especialidade: null,
    dia: null,
    turno: null,
    porFisioterapeutas: null,
    valorPorFisioterapeuta: null,
  });

  assert.match(html, /Sem dados de profissional para Psicologia neste período/);
});

test("financeiro/relatorio: detalhamento agrupa por dia e mostra a manhã antes da tarde", async () => {
  const relatorio = {
    mes: "2026-08",
    totalFaturado: { total: "0.00", quantidade: "0", quantidade_estornos: "0" },
    totalRecebido: { total: "0.00", quantidade: "0", quantidade_estornos: "0" },
    porTipoAtendimento: [],
    porFormaPagamento: [],
    porStatus: [],
    porPlano: [],
    porProfissionalPsicologia: [],
    detalhamento: [
      { id: 1, tipo_lancamento: "pagamento", valor: "80", forma_pagamento: "pix", status: "pago", data_pagamento: "2026-08-10", paciente_nome: "Ana", tipo_atendimento: "fisioterapia", hora_atendimento: "07:00:00" },
      { id: 2, tipo_lancamento: "pagamento", valor: "90", forma_pagamento: "pix", status: "pago", data_pagamento: "2026-08-10", paciente_nome: "Caio", tipo_atendimento: "fisioterapia", hora_atendimento: "18:00:00" },
      { id: 3, tipo_lancamento: "estorno", valor: "50", forma_pagamento: "pix", status: "pago", data_pagamento: "2026-08-11", paciente_nome: "Bia", tipo_atendimento: "psicologia", hora_atendimento: "09:00:00" },
    ],
  };

  const html = await renderizar("financeiro/relatorio.ejs", {
    relatorio,
    plano: null,
    especialidade: null,
    dia: null,
    turno: null,
    porFisioterapeutas: null,
    valorPorFisioterapeuta: null,
  });

  assert.match(html, /Detalhamento dos lançamentos/);
  const posicaoManha = html.indexOf("Ana");
  const posicaoTarde = html.indexOf("Caio");
  assert.ok(posicaoManha > 0 && posicaoTarde > posicaoManha, "manhã (Ana) deve vir antes da tarde (Caio) no mesmo dia");
  const posicaoCabecalho10 = html.indexOf("10 de agosto de 2026");
  const posicaoCabecalho11 = html.indexOf("11 de agosto de 2026");
  assert.ok(posicaoCabecalho10 > 0 && posicaoCabecalho10 < posicaoManha, "cabeçalho do dia 10 deve vir antes das linhas do dia 10");
  assert.ok(posicaoCabecalho11 > posicaoTarde, "cabeçalho do dia 11 deve vir depois das linhas do dia 10");
  assert.match(html, /Estorno/);
});

test("financeiro/relatorio: sem lançamentos no período, mostra aviso em vez de tabela vazia", async () => {
  const relatorio = {
    mes: "2026-08",
    totalFaturado: { total: "0.00", quantidade: "0", quantidade_estornos: "0" },
    totalRecebido: { total: "0.00", quantidade: "0", quantidade_estornos: "0" },
    porTipoAtendimento: [],
    porFormaPagamento: [],
    porStatus: [],
    porPlano: [],
    porProfissionalPsicologia: [],
    detalhamento: [],
  };

  const html = await renderizar("financeiro/relatorio.ejs", {
    relatorio,
    plano: null,
    especialidade: null,
    dia: null,
    turno: null,
    porFisioterapeutas: null,
    valorPorFisioterapeuta: null,
  });

  assert.match(html, /Nenhum lançamento no período/);
});

test("financeiro/lista: mostra 'Gerar guia' numa entrada de pagamento com forma_pagamento convenio", async () => {
  const itens = [
    {
      id: 1,
      data: "2026-08-20",
      hora: "10:00:00",
      paciente_nome: "Fulana",
      tipo_atendimento: "fisioterapia",
      origem: "bot",
      pagamentos: [
        {
          id: 10,
          valor: 300,
          forma_pagamento: "convenio",
          parcelas: null,
          valor_acrescimo: null,
          status: "pago",
          data: "2026-08-20",
          observacao: null,
          tipo_lancamento: "pagamento",
        },
      ],
    },
  ];

  const html = await renderizar("financeiro/lista.ejs", {
    itens,
    filtroData: null,
    limiteAtual: 50,
    offsetAtual: 0,
    temProximaPagina: false,
  });

  assert.match(html, /href="\/financeiro\/pagamento\/10\/guia"/);
  assert.match(html, /Gerar guia/);
});

test("financeiro/lista: não mostra 'Gerar guia' numa entrada pix/cartão, nem na linha do próprio estorno", async () => {
  const itens = [
    {
      id: 1,
      data: "2026-08-20",
      hora: "10:00:00",
      paciente_nome: "Fulana",
      tipo_atendimento: "fisioterapia",
      origem: "bot",
      pagamentos: [
        {
          id: 11,
          valor: 150,
          forma_pagamento: "pix",
          parcelas: null,
          valor_acrescimo: null,
          status: "pago",
          data: "2026-08-20",
          observacao: null,
          tipo_lancamento: "pagamento",
        },
        {
          id: 12,
          valor: 300,
          forma_pagamento: "convenio",
          parcelas: null,
          valor_acrescimo: null,
          status: "pago",
          data: "2026-08-20",
          observacao: null,
          tipo_lancamento: "estorno",
          pagamento_origem_id: 10,
        },
      ],
    },
  ];

  const html = await renderizar("financeiro/lista.ejs", {
    itens,
    filtroData: null,
    limiteAtual: 50,
    offsetAtual: 0,
    temProximaPagina: false,
  });

  assert.ok(!html.includes("Gerar guia"));
});

test("financeiro/lista: formulário 'Registrar pagamento' tem a opção Convênio", async () => {
  const html = await renderizar("financeiro/lista.ejs", {
    itens: [
      {
        id: 1,
        data: "2026-08-20",
        hora: "10:00:00",
        paciente_nome: "Fulana",
        tipo_atendimento: "fisioterapia",
        origem: "bot",
        pagamentos: [],
      },
    ],
    filtroData: null,
    limiteAtual: 50,
    offsetAtual: 0,
    temProximaPagina: false,
  });

  assert.match(html, /<option value="convenio">Convênio<\/option>/);
});

test("dashboard não registra rotas dos módulos extras", () => {
  const rotas = dashboardRoutes.stack
    .filter((layer) => layer.route)
    .map((layer) => layer.route.path);

  for (const rotaExtra of ["/estoque", "/fornecedores", "/centros-custo"]) {
    assert.equal(rotas.includes(rotaExtra), false);
  }

  assert.equal(rotas.includes("/financeiro/relatorio"), true);
  assert.equal(rotas.includes("/estatisticas"), true);
  assert.equal(rotas.includes("/financeiro/pagamento/:id/guia"), true);
});
