// test/agendamentosListaView.test.js
//
// Renderiza agendamentos/lista.ejs diretamente (sem controller/app) pra pegar
// bugs de view que ficam escondidos atrás de mocks que só checam
// res.dadosDaView.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";
import { formatarDataHora, formatarDataExtensa, formatarDataComDiaSemana } from "../src/utils/data.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.join(__dirname, "..", "src", "views");

const FILTROS_VAZIOS = { data: "", status: "", tipo_atendimento: "", busca: "", periodo: "", psicologo_id: "", origem: "", avaliacao: "" };

function renderizar(dados) {
  const caminho = path.join(VIEWS_DIR, "agendamentos", "lista.ejs");
  return ejs.renderFile(caminho, {
    csrfToken: "token-fake",
    filtros: FILTROS_VAZIOS,
    psicologos: [],
    tituloAgenda: "Todos os agendamentos",
    tipoFixo: null,
    formatarDataHora,
    formatarDataExtensa,
    formatarDataComDiaSemana,
    limiteAtual: 50,
    offsetAtual: 0,
    temProximaPagina: false,
    mensagemWhatsapp: null,
    mensagemPresenca: null,
    mensagemAgendamento: null,
    usuarioAtual: { nome: "Teste", papel: "recepcao" },
    ...dados,
  });
}

test("agendamentos/lista: barra de presença em lote tem contador de selecionados e checkbox de selecionar todos", async () => {
  const html = await renderizar({
    itens: [
      {
        id: 1, origem: "bot", status: "confirmado", ja_passou: true,
        data: "2026-09-08", hora: "07:00:00", paciente_nome: "Fulana",
        tipo_atendimento: "fisioterapia", presenca: null, observacao_sessao: null,
        profissional_responsavel: null, registrado_por_nome: null, registrado_em: null,
      },
    ],
  });

  assert.match(html, /id="form-presenca-lote"/);
  assert.match(html, /id="selecionar-todos-presenca"/);
  assert.match(html, /id="contador-selecionados-presenca"[^>]*>Nenhum selecionado</);
  assert.match(html, /class="presenca-lote-checkbox"[^>]*form="form-presenca-lote"/);
});

test("agendamentos/lista: usa estrutura operacional compacta e mantém filtros", async () => {
  const html = await renderizar({
    itens: [],
    filtros: { data: "2026-09-02", status: "", tipo_atendimento: "", busca: "" },
  });

  assert.match(html, /class="[^"]*agenda-layout/);
  assert.match(html, /class="[^"]*filter-bar/);
  assert.match(
    html,
    /<aside class="agenda-calendar panel screen-only">[\s\S]*?<form method="get" action="\/agendamentos">[\s\S]*?<input type="date" name="data" value="2026-09-02"/,
  );
  assert.match(html, /class="[^"]*data-table/);
});

test("agendamentos/lista: sem tipoFixo, mostra o filtro 'Tipo' e usa /agendamentos nos links de navegação da lista", async () => {
  const html = await renderizar({ itens: [] });

  assert.match(html, /Tipo\s*<select name="tipo_atendimento">/);
  assert.match(html, /<form class="filter-bar screen-only" method="get" action="\/agendamentos">/);
  assert.match(html, /<a class="button button--quiet" href="\/agendamentos">Limpar filtros<\/a>/);
  assert.match(html, /<a class="button screen-only" href="\/agendamentos\/novo">\+ Novo agendamento<\/a>/);
});

test("agendamentos/lista: com tipoFixo=psicologia, esconde o filtro 'Tipo' e usa /psicologia nos links de navegação da lista", async () => {
  const html = await renderizar({ itens: [], tipoFixo: "psicologia" });

  assert.doesNotMatch(html, /Tipo\s*<select name="tipo_atendimento">/);
  assert.match(html, /<form class="filter-bar screen-only" method="get" action="\/psicologia">/);
  assert.match(html, /<a class="button button--quiet" href="\/psicologia">Limpar filtros<\/a>/);
  assert.match(html, /<a class="button screen-only" href="\/agendamentos\/novo\?tipo_atendimento=psicologia">\+ Novo agendamento<\/a>/);
});

test("agendamentos/lista: rótulo do filtro deixa claro que 'Todos' não inclui cancelado", async () => {
  const html = await renderizar({ itens: [] });

  assert.match(html, /<option value="">Todos \(exceto cancelados\)<\/option>/);
});

test("agendamentos/lista: marca o início e a continuação de atendimentos no mesmo horário", async () => {
  const itens = [
    { id: 1, origem: "importado", status: null, ja_passou: false, data: "2026-09-02", hora: "09:00", paciente_nome: "Ana", paciente_telefone: "11", tipo_atendimento: "fisioterapia" },
    { id: 2, origem: "importado", status: null, ja_passou: false, data: "2026-09-02", hora: "09:00", paciente_nome: "Bia", paciente_telefone: "22", tipo_atendimento: "fisioterapia" },
    { id: 3, origem: "importado", status: null, ja_passou: false, data: "2026-09-02", hora: "10:00", paciente_nome: "Caio", paciente_telefone: "33", tipo_atendimento: "psicologia" },
  ];

  const html = await renderizar({ itens });

  assert.match(html, /class="appointment-row is-upcoming is-slot-start is-manha status-"[^>]*>[\s\S]*?Ana/);
  assert.match(html, /class="appointment-row is-upcoming is-slot-continuation is-manha status-"[^>]*>[\s\S]*?Bia/);
  assert.match(html, /class="appointment-row is-upcoming is-slot-start is-manha status-"[^>]*>[\s\S]*?Caio/);
});

test("agendamentos/lista: item já passado sem observacao_sessao não mostra o link 'Gerar laudo'", async () => {
  const html = await renderizar({
    itens: [
      {
        id: 1,
        origem: "bot",
        status: "confirmado",
        ja_passou: true,
        data: "2026-08-20",
        hora: "10:00:00",
        paciente_nome: "Fulana",
        tipo_atendimento: "fisioterapia",
        presenca: null,
        observacao_sessao: null,
        profissional_responsavel: null,
        registrado_por_nome: null,
        registrado_em: null,
      },
    ],
  });

  assert.doesNotMatch(html, /Gerar laudo/);
  assert.match(html, /name="presenca"/);
  assert.match(html, />Registrar</);
  assert.match(html, /class="[^"]*attendance-panel/);
});

test("agendamentos/lista: item já passado ou com status final não mostra 'Gerenciar' (Remarcar/Confirmar/Cancelar), mas 'Editar' continua disponível", async () => {
  const itemBase = {
    id: 1,
    origem: "bot",
    data: "2026-08-20",
    hora: "10:00:00",
    paciente_nome: "Fulana",
    tipo_atendimento: "fisioterapia",
    presenca: null,
    observacao_sessao: null,
    profissional_responsavel: null,
    registrado_por_nome: null,
    registrado_em: null,
  };

  const htmlJaPassou = await renderizar({ itens: [{ ...itemBase, status: "confirmado", ja_passou: true }] });
  assert.doesNotMatch(htmlJaPassou, />Gerenciar</);
  assert.doesNotMatch(htmlJaPassou, /\/remarcar">Remarcar</);
  assert.match(htmlJaPassou, /href="\/agendamentos\/bot\/1\/editar">Editar</);

  const htmlCompareceu = await renderizar({ itens: [{ ...itemBase, status: "compareceu", ja_passou: false }] });
  assert.doesNotMatch(htmlCompareceu, />Gerenciar</);
  assert.match(htmlCompareceu, /href="\/agendamentos\/bot\/1\/editar">Editar</);
});

test("agendamentos/lista: agendamento confirmado e futuro continua mostrando 'Gerenciar' com Remarcar+Editar", async () => {
  const html = await renderizar({
    itens: [
      {
        id: 2,
        origem: "bot",
        status: "confirmado",
        ja_passou: false,
        data: "2026-09-20",
        hora: "10:00:00",
        paciente_nome: "Fulana",
        tipo_atendimento: "fisioterapia",
        presenca: null,
        observacao_sessao: null,
        profissional_responsavel: null,
        registrado_por_nome: null,
        registrado_em: null,
      },
    ],
  });

  assert.match(html, />Gerenciar</);
  assert.match(html, /href="\/agendamentos\/bot\/2\/remarcar">Remarcar</);
  assert.match(html, /href="\/agendamentos\/bot\/2\/editar">Editar</);
});

test("agendamentos/lista: item bot com observacao_sessao preenchida mostra o link 'Gerar laudo' apontando pra origem bot", async () => {
  const html = await renderizar({
    itens: [
      {
        id: 5,
        origem: "bot",
        status: "compareceu",
        ja_passou: true,
        data: "2026-08-20",
        hora: "10:00:00",
        paciente_nome: "Fulana",
        tipo_atendimento: "fisioterapia",
        presenca: "compareceu",
        observacao_sessao: "Evoluiu bem",
        profissional_responsavel: "Dra. Ana",
        registrado_por_nome: "Recepção",
        registrado_em: "2026-08-20T10:00:00Z",
      },
    ],
  });

  assert.match(html, /href="\/agendamentos\/bot\/5\/laudo"/);
  assert.match(html, /Gerar laudo/);
});

test("agendamentos/lista: item importado com observação aponta o link de laudo pra origem importado", async () => {
  const html = await renderizar({
    itens: [
      {
        id: 8,
        origem: "importado",
        status: null,
        ja_passou: true,
        data: "2026-08-20",
        hora: "10:00:00",
        paciente_nome: "Ciclano",
        tipo_atendimento: "fisioterapia",
        presenca: "compareceu",
        observacao_sessao: "Sessão concluída",
        profissional_responsavel: null,
        registrado_por_nome: "Recepção",
        registrado_em: "2026-08-20T10:00:00Z",
      },
    ],
  });

  assert.match(html, /href="\/agendamentos\/importado\/8\/laudo"/);
});

test("agendamentos/lista: campo profissional_responsavel é pré-preenchido no formulário de correção", async () => {
  const html = await renderizar({
    itens: [
      {
        id: 5,
        origem: "bot",
        status: "compareceu",
        ja_passou: true,
        data: "2026-08-20",
        hora: "10:00:00",
        paciente_nome: "Fulana",
        tipo_atendimento: "fisioterapia",
        presenca: "compareceu",
        observacao_sessao: "Evoluiu bem",
        profissional_responsavel: "Dra. Ana",
        registrado_por_nome: "Recepção",
        registrado_em: "2026-08-20T10:00:00Z",
      },
    ],
  });

  assert.match(html, /name="profissional_responsavel"[^>]*value="Dra\. Ana"/);
  assert.match(html, /checked/);
  assert.match(html, />Corrigir</);
  assert.match(html, /Registrado por Recepção em/);
});

test("agendamentos/lista: bot confirmado e futuro mostra ações de remarcar/cancelar e também presença", async () => {
  const html = await renderizar({
    itens: [
      {
        id: 2,
        origem: "bot",
        status: "confirmado",
        ja_passou: false,
        data: "2026-09-10",
        hora: "10:00:00",
        paciente_nome: "Fulana",
        tipo_atendimento: "fisioterapia",
        presenca: null,
        observacao_sessao: null,
        profissional_responsavel: null,
        registrado_por_nome: null,
        registrado_em: null,
      },
    ],
  });

  assert.match(html, /href="\/agendamentos\/bot\/2\/remarcar"/);
  assert.match(html, /action="\/agendamentos\/bot\/2\/cancelar"/);
  assert.match(html, /action="\/agendamentos\/bot\/2\/confirmar-whatsapp"/);
  assert.match(html, /Enviar confirmação/);
  assert.match(html, /action="\/agendamentos\/bot\/2\/presenca"/);
  assert.match(html, /name="presenca"/);
  assert.match(html, /class="[^"]*row-actions/);
});

test("agendamentos/lista: ?whatsapp=enviado mostra mensagem de sucesso", async () => {
  const html = await renderizar({ itens: [], mensagemWhatsapp: "Confirmação enviada por WhatsApp." });
  assert.match(html, /class="sucesso">Confirmação enviada por WhatsApp\./);
});

test("agendamentos/lista: bot com criado_por_usuario_id mostra Origem 'Manual', não 'Bot'", async () => {
  const html = await renderizar({
    itens: [
      {
        id: 11,
        origem: "bot",
        criado_por_usuario_id: 3,
        status: "confirmado",
        ja_passou: false,
        data: "2026-09-10",
        hora: "10:00:00",
        paciente_nome: "Fulana",
        tipo_atendimento: "psicologia",
        presenca: null,
        observacao_sessao: null,
        profissional_responsavel: null,
        registrado_por_nome: null,
        registrado_em: null,
      },
    ],
  });

  assert.match(html, /<td>Manual<\/td>/);
  assert.doesNotMatch(html, /<td>Bot<\/td>/);
});

test("agendamentos/lista: bot sem criado_por_usuario_id continua mostrando Origem 'Bot'", async () => {
  const html = await renderizar({
    itens: [
      {
        id: 12,
        origem: "bot",
        criado_por_usuario_id: null,
        status: "confirmado",
        ja_passou: false,
        data: "2026-09-10",
        hora: "10:00:00",
        paciente_nome: "Fulana",
        tipo_atendimento: "fisioterapia",
        presenca: null,
        observacao_sessao: null,
        profissional_responsavel: null,
        registrado_por_nome: null,
        registrado_em: null,
      },
    ],
  });

  assert.match(html, /<td>Bot<\/td>/);
});

test("agendamentos/lista: bot cancelado não mostra nenhuma ação", async () => {
  const html = await renderizar({
    itens: [
      {
        id: 3,
        origem: "bot",
        status: "cancelado",
        ja_passou: false,
        data: "2026-09-10",
        hora: "10:00:00",
        paciente_nome: "Fulana",
        tipo_atendimento: "fisioterapia",
        presenca: null,
        observacao_sessao: null,
        profissional_responsavel: null,
        registrado_por_nome: null,
        registrado_em: null,
      },
    ],
  });

  assert.doesNotMatch(html, /remarcar/);
  assert.doesNotMatch(html, /\/cancelar/);
  assert.doesNotMatch(html, /type="radio" name="presenca"/);
});

test("agendamentos/lista: importado confirmado e futuro mostra ações de remarcar/cancelar e também presença", async () => {
  const html = await renderizar({
    itens: [
      {
        id: 9,
        origem: "importado",
        status: "confirmado",
        ja_passou: false,
        data: "2026-09-10",
        hora: "10:00:00",
        paciente_nome: "Ciclano",
        tipo_atendimento: "fisioterapia",
        presenca: null,
        observacao_sessao: null,
        profissional_responsavel: null,
        registrado_por_nome: null,
        registrado_em: null,
      },
    ],
  });

  assert.match(html, /href="\/agendamentos\/importado\/9\/remarcar"/);
  assert.match(html, /action="\/agendamentos\/importado\/9\/cancelar"/);
  assert.match(html, /action="\/agendamentos\/importado\/9\/presenca"/);
  assert.match(html, /name="presenca"/);
});

test("agendamentos/lista: importado cancelado mostra badge Cancelado e nenhuma ação", async () => {
  const html = await renderizar({
    itens: [
      {
        id: 10,
        origem: "importado",
        status: "cancelado",
        ja_passou: false,
        data: "2026-09-10",
        hora: "10:00:00",
        paciente_nome: "Ciclano",
        tipo_atendimento: "fisioterapia",
        presenca: null,
        observacao_sessao: null,
        profissional_responsavel: null,
        registrado_por_nome: null,
        registrado_em: null,
      },
    ],
  });

  assert.match(html, /badge-estornado is-danger">\s*Cancelado/);
  assert.doesNotMatch(html, /\/remarcar/);
  assert.doesNotMatch(html, /\/cancelar/);
});

test("agendamentos/lista: marca linha antes do meio-dia como 'is-manha'", async () => {
  const html = await renderizar({
    itens: [
      {
        id: 20,
        origem: "importado",
        status: "confirmado",
        ja_passou: false,
        data: "2026-09-10",
        hora: "11:59:00",
        paciente_nome: "Manhã",
        tipo_atendimento: "fisioterapia",
      },
    ],
  });

  assert.match(html, /class="appointment-row[^"]*\bis-manha\b[^"]*"[^>]*>[\s\S]*?Manhã/);
});

test("agendamentos/lista: marca linha a partir do meio-dia como 'is-tarde'", async () => {
  const html = await renderizar({
    itens: [
      {
        id: 21,
        origem: "importado",
        status: "confirmado",
        ja_passou: false,
        data: "2026-09-10",
        hora: "12:00:00",
        paciente_nome: "Tarde",
        tipo_atendimento: "fisioterapia",
      },
    ],
  });

  assert.match(html, /class="appointment-row[^"]*\bis-tarde\b[^"]*"[^>]*>[\s\S]*?Tarde/);
});

test("agendamentos/lista: lista sem filtro de data agrupa por dia (com dia da semana) e por período (Manhã/Tarde)", async () => {
  const html = await renderizar({
    itens: [
      { id: 40, origem: "bot", status: "confirmado", ja_passou: false, data: "2026-09-10", hora: "08:00:00", paciente_nome: "Ana", tipo_atendimento: "fisioterapia" },
      { id: 41, origem: "bot", status: "confirmado", ja_passou: false, data: "2026-09-10", hora: "14:00:00", paciente_nome: "Bruno", tipo_atendimento: "fisioterapia" },
      { id: 42, origem: "bot", status: "confirmado", ja_passou: false, data: "2026-09-11", hora: "09:00:00", paciente_nome: "Carla", tipo_atendimento: "fisioterapia" },
    ],
  });

  // Um cabeçalho de dia por dia distinto (não um por linha).
  assert.equal((html.match(/class="agenda-day-header/g) ?? []).length, 2);
  assert.match(html, /agenda-day-header[^>]*>[\s\S]*?Quinta-feira, 10 de setembro/);
  assert.match(html, /agenda-day-header[^>]*>[\s\S]*?Sexta-feira, 11 de setembro/);

  // Dois períodos no dia 10 (manhã + tarde), um só no dia 11 (manhã).
  assert.equal((html.match(/class="agenda-period-header/g) ?? []).length, 3);

  // Ordem: dia 10 → cabeçalho do dia, Manhã, Ana, Tarde, Bruno, depois dia 11 → cabeçalho do dia, Manhã, Carla.
  const ordem = [
    ...html.matchAll(
      /class="agenda-(?:day|period)-header[^"]*"><td[^>]*>([^<]+)<|<strong>(Ana|Bruno|Carla)<\/strong>/g
    ),
  ].map((m) => (m[1] ?? m[2]).trim());
  assert.deepEqual(ordem, [
    "Quinta-feira, 10 de setembro",
    "Manhã",
    "Ana",
    "Tarde",
    "Bruno",
    "Sexta-feira, 11 de setembro",
    "Manhã",
    "Carla",
  ]);
});

test("agendamentos/lista: cabeçalhos de agrupamento são screen-only (não aparecem na impressão)", async () => {
  const html = await renderizar({
    itens: [
      { id: 43, origem: "bot", status: "confirmado", ja_passou: false, data: "2026-09-10", hora: "08:00:00", paciente_nome: "Ana", tipo_atendimento: "fisioterapia" },
    ],
  });

  assert.match(html, /class="agenda-day-header screen-only"/);
  assert.match(html, /class="agenda-period-header screen-only"/);
});

test("agendamentos/lista: cada linha carrega a classe status-<status> pra colorir por presença", async () => {
  const html = await renderizar({
    itens: [
      { id: 30, origem: "bot", status: "compareceu", ja_passou: true, data: "2026-09-10", hora: "08:00:00", paciente_nome: "Vitoria", tipo_atendimento: "fisioterapia" },
      { id: 31, origem: "bot", status: "faltou", ja_passou: true, data: "2026-09-10", hora: "09:00:00", paciente_nome: "Beatriz", tipo_atendimento: "fisioterapia" },
      { id: 32, origem: "bot", status: "cancelado", ja_passou: false, data: "2026-09-10", hora: "10:00:00", paciente_nome: "Caio", tipo_atendimento: "fisioterapia" },
      { id: 33, origem: "bot", status: "confirmado", ja_passou: false, data: "2026-09-10", hora: "11:00:00", paciente_nome: "Duda", tipo_atendimento: "fisioterapia" },
    ],
  });

  assert.match(html, /class="appointment-row[^"]*\bstatus-compareceu\b[^"]*"[^>]*>[\s\S]*?Vitoria/);
  assert.match(html, /class="appointment-row[^"]*\bstatus-faltou\b[^"]*"[^>]*>[\s\S]*?Beatriz/);
  assert.match(html, /class="appointment-row[^"]*\bstatus-cancelado\b[^"]*"[^>]*>[\s\S]*?Caio/);
  assert.match(html, /class="appointment-row[^"]*\bstatus-confirmado\b[^"]*"[^>]*>[\s\S]*?Duda/);
});

test("agendamentos/lista: botões de imprimir manhã/tarde só aparecem com um dia selecionado", async () => {
  const semData = await renderizar({ itens: [] });
  assert.doesNotMatch(semData, /Imprimir manhã/);
  assert.doesNotMatch(semData, /Imprimir tarde/);

  const comData = await renderizar({
    itens: [],
    filtros: { data: "2026-09-10", status: "", tipo_atendimento: "", busca: "" },
  });
  assert.match(comData, /Imprimir manhã/);
  assert.match(comData, /Imprimir tarde/);
});

test("agendamentos/lista: tabela de impressão só tem Hora, Paciente, Telefone, Categoria, Tipo e OK ou Falta", async () => {
  const html = await renderizar({ itens: [] });

  assert.match(html, /<table class="agenda-print-table print-only">/);
  const cabecalho = html.match(/<table class="agenda-print-table print-only">[\s\S]*?<\/thead>/)[0];
  assert.match(cabecalho, /<th>Hora<\/th>/);
  assert.match(cabecalho, /<th>Paciente<\/th>/);
  assert.match(cabecalho, /<th>Telefone<\/th>/);
  assert.match(cabecalho, /<th>Categoria<\/th>/);
  assert.match(cabecalho, /<th>Tipo<\/th>/);
  assert.match(cabecalho, /<th>OK ou Falta<\/th>/);
  assert.doesNotMatch(cabecalho, /<th>F<\/th>/);
  assert.doesNotMatch(cabecalho, /<th>Atendente<\/th>/);
  assert.doesNotMatch(cabecalho, /<th>C<\/th>/);
  assert.doesNotMatch(cabecalho, /<th>Chegou<\/th>/);
});

test("agendamentos/lista: tabela de impressão mostra Categoria (fisio/psico) e Tipo (convênio ou Particular)", async () => {
  const html = await renderizar({
    itens: [
      { id: 1, origem: "importado", status: "confirmado", ja_passou: false, data: "2026-09-16", hora: "09:00:00", paciente_nome: "Ana", paciente_telefone: "11999999999", paciente_convenio: "Mar Azul Saúde", tipo_atendimento: "psicologia", primeira_consulta: true },
      { id: 2, origem: "bot", status: "confirmado", ja_passou: false, data: "2026-09-16", hora: "14:00:00", paciente_nome: "Bruno", paciente_telefone: "11988888888", paciente_convenio: null, tipo_atendimento: "fisioterapia", primeira_consulta: false },
    ],
  });

  const tabelaImpressao = html.match(/<table class="agenda-print-table print-only">[\s\S]*?<\/table>/)[0];
  assert.match(tabelaImpressao, /<td>Ana<\/td>[\s\S]*?<td>Psicologia<\/td>[\s\S]*?<td>Mar Azul Saúde<\/td>/);
  assert.match(tabelaImpressao, /<td>Bruno<\/td>[\s\S]*?<td>Fisioterapia<\/td>[\s\S]*?<td>Particular<\/td>/);
});

test("agendamentos/lista: linhas da tabela de impressão têm is-manha/is-tarde pro filtro de período funcionar na impressão", async () => {
  const html = await renderizar({
    itens: [
      { id: 1, origem: "bot", status: "confirmado", ja_passou: false, data: "2026-09-16", hora: "09:00:00", paciente_nome: "Ana", paciente_telefone: "1", paciente_convenio: null, tipo_atendimento: "fisioterapia", primeira_consulta: null, atendente: null },
      { id: 2, origem: "bot", status: "confirmado", ja_passou: false, data: "2026-09-16", hora: "14:00:00", paciente_nome: "Bruno", paciente_telefone: "2", paciente_convenio: null, tipo_atendimento: "fisioterapia", primeira_consulta: null, atendente: null },
    ],
  });

  const tabelaImpressao = html.match(/<table class="agenda-print-table print-only">[\s\S]*?<\/table>/)[0];
  assert.match(tabelaImpressao, /<tr class="is-manha">[\s\S]*?Ana/);
  assert.match(tabelaImpressao, /<tr class="is-tarde">[\s\S]*?Bruno/);
});

test("agendamentos/lista: elementos que atrapalham a impressão ficam marcados screen-only", async () => {
  const html = await renderizar({
    itens: [
      {
        id: 22,
        origem: "importado",
        status: "confirmado",
        ja_passou: false,
        data: "2026-09-10",
        hora: "09:00:00",
        paciente_nome: "Fulano",
        tipo_atendimento: "fisioterapia",
      },
    ],
  });

  assert.match(html, /class="filter-bar screen-only"/);
  assert.match(html, /class="[^"]*screen-only[^"]*"[^>]*>\+ Novo agendamento/);
  assert.match(html, /<aside class="agenda-calendar panel screen-only">/);
  assert.match(html, /<th class="screen-only">Ações<\/th>/);
});

test("agendamentos/lista: coluna Hora não mostra segundos", async () => {
  const html = await renderizar({
    itens: [
      {
        id: 30,
        origem: "importado",
        status: "confirmado",
        ja_passou: false,
        data: "2026-09-10",
        hora: "09:05:00",
        paciente_nome: "Fulano",
        tipo_atendimento: "fisioterapia",
      },
    ],
  });

  assert.match(html, /<td class="appointment-time">09:05<\/td>/);
  assert.doesNotMatch(html, /09:05:00/);
});

test("agendamentos/lista: filtro de período marca a opção selecionada", async () => {
  const html = await renderizar({
    itens: [],
    filtros: { data: "", status: "", tipo_atendimento: "", busca: "", periodo: "tarde" },
  });

  assert.match(html, /<option value="tarde" selected>Tarde<\/option>/);
});

test("agendamentos/lista: filtro de origem marca a opção selecionada e mantém o filtro entre páginas", async () => {
  const html = await renderizar({
    itens: [],
    filtros: { ...FILTROS_VAZIOS, origem: "manual" },
  });

  assert.match(html, /<option value="manual" selected>Manual<\/option>/);
  assert.match(html, /name="origem" value="manual"/);
});

test("agendamentos/lista: filtro de avaliação marca a opção selecionada e mantém o filtro entre páginas", async () => {
  const html = await renderizar({
    itens: [],
    filtros: { ...FILTROS_VAZIOS, avaliacao: "avaliacao" },
  });

  assert.match(html, /<option value="avaliacao" selected>Avaliação<\/option>/);
  assert.match(html, /name="avaliacao" value="avaliacao"/);
});

test("agendamentos/lista: coluna Convênio mostra o valor do paciente ou travessão quando não tem", async () => {
  const html = await renderizar({
    itens: [
      {
        id: 40, origem: "importado", status: "confirmado", ja_passou: false,
        data: "2026-09-10", hora: "09:00:00", paciente_nome: "Com convênio",
        paciente_convenio: "Mar Azul Saúde", tipo_atendimento: "fisioterapia",
      },
      {
        id: 41, origem: "importado", status: "confirmado", ja_passou: false,
        data: "2026-09-10", hora: "10:00:00", paciente_nome: "Sem convênio",
        paciente_convenio: null, tipo_atendimento: "fisioterapia",
      },
    ],
  });

  assert.match(html, /<td>Mar Azul Saúde<\/td>/);
  assert.match(html, /<td>—<\/td>/);
});

test("agendamentos/lista: filtro Psicóloga lista as psicólogas e marca a selecionada", async () => {
  const html = await renderizar({
    psicologos: [{ id: 1, nome: "Dra. Ana" }, { id: 2, nome: "Dra. Bia" }],
    filtros: { ...FILTROS_VAZIOS, psicologo_id: "2" },
    itens: [],
  });

  assert.match(html, /<option value="1" >Dra\. Ana<\/option>/);
  assert.match(html, /<option value="2" selected>Dra\. Bia<\/option>/);
});

test("agendamentos/lista: título da agenda vem do controller (tituloAgenda)", async () => {
  const html = await renderizar({ itens: [], tituloAgenda: "Agenda: Dra. Ana — 10 de setembro de 2026" });
  assert.match(html, /Agenda: Dra\. Ana — 10 de setembro de 2026/);
});

test("agendamentos/lista: sem offset, não mostra link 'Anterior' (só desabilitado); com próxima página, mostra 'Próxima'", async () => {
  const primeiraPagina = await renderizar({ itens: [], offsetAtual: 0, temProximaPagina: true });
  assert.doesNotMatch(primeiraPagina, /<a[^>]*>← Anterior<\/a>/);
  assert.match(primeiraPagina, /aria-disabled="true">← Anterior<\/span>/);
  assert.match(primeiraPagina, /offset=50[^"]*">Próxima/);
  assert.match(primeiraPagina, /Página 1/);

  const paginaSeguinte = await renderizar({ itens: [], offsetAtual: 50, temProximaPagina: false });
  assert.match(paginaSeguinte, /offset=0[^"]*">← Anterior/);
  assert.doesNotMatch(paginaSeguinte, /<a[^>]*>Próxima →<\/a>/);
  assert.match(paginaSeguinte, /aria-disabled="true">Próxima →<\/span>/);
  assert.match(paginaSeguinte, /Página 2/);
});

test("agendamentos/lista: título traz rótulos de Manhã/Tarde escondidos, revelados só na impressão via classe do body", async () => {
  const html = await renderizar({ itens: [] });

  assert.match(html, /<span class="print-periodo-label-manha">— Manhã<\/span><span class="print-periodo-label-tarde">— Tarde<\/span><\/h1>/);
});

test("agendamentos/lista: botão 'Excluir' só aparece pra administradora", async () => {
  const itemBase = {
    id: 1,
    origem: "bot",
    status: "confirmado",
    ja_passou: false,
    data: "2026-09-20",
    hora: "10:00:00",
    paciente_nome: "Fulana",
    tipo_atendimento: "fisioterapia",
    presenca: null,
    observacao_sessao: null,
    profissional_responsavel: null,
    registrado_por_nome: null,
    registrado_em: null,
  };

  const htmlRecepcao = await renderizar({
    itens: [itemBase],
    usuarioAtual: { nome: "Recepcionista", papel: "recepcao" },
  });
  assert.doesNotMatch(htmlRecepcao, /\/agendamentos\/bot\/1\/excluir/);

  const htmlAdmin = await renderizar({
    itens: [itemBase],
    usuarioAtual: { nome: "Admin", papel: "administradora" },
  });
  assert.match(htmlAdmin, /action="\/agendamentos\/bot\/1\/excluir"/);
  assert.match(htmlAdmin, />Excluir</);
});

test("agendamentos/lista: mensagemAgendamento aparece como aviso de sucesso", async () => {
  const html = await renderizar({ itens: [], mensagemAgendamento: "Agendamento excluído." });
  assert.match(html, /class="sucesso">Agendamento excluído\./);
});
