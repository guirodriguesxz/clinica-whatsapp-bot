// test/estatisticasView.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";
import { formatarMoeda } from "../src/utils/dinheiro.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.join(__dirname, "..", "src", "views");

function renderizar(dados) {
  const caminho = path.join(VIEWS_DIR, "estatisticas", "lista.ejs");
  return ejs.renderFile(caminho, { csrfToken: "token-fake", formatarMoeda, ...dados });
}

const ESTATISTICAS_VAZIAS = {
  faturamento: { total: 0, recebido: 0, pendente: 0, porEspecialidade: [] },
  atendimentos: { total: 0, porEspecialidade: [], porProfissional: [] },
  repassePorConvenio: [],
};

test("estatisticas/lista: renderiza sem erro com dados vazios", async () => {
  const html = await renderizar({
    periodoResolvido: { periodo: "mes", dataInicio: "2026-02-01", dataFim: "2026-02-28" },
    estatisticas: ESTATISTICAS_VAZIAS,
    inicioQuery: "",
    fimQuery: "",
    presets: ["hoje", "semana", "mes", "ano"],
  });

  assert.match(html, /Estatísticas/);
  assert.match(html, /R\$ 0\.00/);
});

test("estatisticas/lista: renderiza os totais e as tabelas com dados populados", async () => {
  const html = await renderizar({
    periodoResolvido: { periodo: "ano", dataInicio: "2026-01-01", dataFim: "2026-12-31" },
    estatisticas: {
      faturamento: {
        total: 450.5,
        recebido: 300,
        pendente: 150.5,
        porEspecialidade: [
          { tipo_atendimento: "fisioterapia", total: "300.00", recebido: "300.00", pendente: "0.00" },
          { tipo_atendimento: "psicologia", total: "150.50", recebido: "0.00", pendente: "150.50" },
        ],
      },
      atendimentos: {
        total: 12,
        porEspecialidade: [
          { tipo_atendimento: "fisioterapia", quantidade: "9" },
          { tipo_atendimento: "psicologia", quantidade: "3" },
        ],
        porProfissional: [
          { profissional: "Dra. Ana", quantidade: "3" },
          { profissional: "Não informado", quantidade: "9" },
        ],
      },
      repassePorConvenio: [
        {
          plano: "Mar Azul Saúde",
          total: "300.00",
          quantidade: 4,
          quantidade_avaliacao: 1,
          quantidade_sessao: 3,
          valorRepasse: 220,
          motivoRepasseIndisponivel: null,
        },
        {
          plano: "Bússola Saúde",
          total: "80.00",
          quantidade: 1,
          quantidade_avaliacao: 0,
          quantidade_sessao: 1,
          valorRepasse: null,
          motivoRepasseIndisponivel: "nao_configurado",
        },
      ],
    },
    inicioQuery: "",
    fimQuery: "",
    presets: ["hoje", "semana", "mes", "ano"],
  });

  assert.match(html, /R\$ 450\.50/);
  assert.match(html, /Dra\. Ana/);
  assert.match(html, /Não informado/);
  assert.match(html, /Mar Azul Saúde/);
  assert.match(html, /R\$ 220\.00/);
  assert.match(html, /Bússola Saúde/);
  assert.match(html, /convênio sem valores de repasse cadastrados/);
});

test("estatisticas/lista: preset ativo (periodo) fica marcado com is-active", async () => {
  const html = await renderizar({
    periodoResolvido: { periodo: "semana", dataInicio: "2026-02-02", dataFim: "2026-02-08" },
    estatisticas: ESTATISTICAS_VAZIAS,
    inicioQuery: "",
    fimQuery: "",
    presets: ["hoje", "semana", "mes", "ano"],
  });

  assert.match(html, /class="button is-active"[^>]*href="\/estatisticas\?periodo=semana"/);
});
