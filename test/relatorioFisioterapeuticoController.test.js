// test/relatorioFisioterapeuticoController.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  telaNovoRelatorio,
  processarNovoRelatorio,
  telaEditarRelatorio,
  processarEditarRelatorio,
  gerarPdfRelatorioController,
  gerarDocxRelatorioController,
  processarRascunhoRelatorioPdf,
  processarRascunhoRelatorioDocx,
  processarExcluirRelatorio,
} from "../src/controllers/relatorioFisioterapeuticoController.js";

function criarRespostaFalsa() {
  return {
    statusCode: 200,
    corpo: null,
    headers: {},
    redirectedTo: null,
    viewRenderizada: null,
    dadosDaView: null,
    status(code) { this.statusCode = code; return this; },
    send(corpo) { this.corpo = corpo; return this; },
    setHeader(nome, valor) { this.headers[nome] = valor; },
    redirect(url) { this.redirectedTo = url; },
    render(view, dados) { this.viewRenderizada = view; this.dadosDaView = dados; },
  };
}

const PACIENTE = { id: 7, nome: "Ana Silva" };
const RELATORIO = {
  id: 5, pacienteId: 7, dataRelatorio: "2026-09-11",
  diagnosticoMotivo: "Fisioterapia Ortopédica: Fratura 5º dedo mão direita",
  condutaEvolucao: "Ganho de mobilidade e fortalecimento progressivo, sem quadro álgico.",
  consideracoesFinais: "Consolidação parcial, importante continuidade até reavaliação médica.",
  profissionalResponsavel: "Dra. Isabella Silva Reis / Crefito 435050-F",
};
const FISIOTERAPEUTA = { id: 3, nome: "Dra. Isabella Silva Reis", crefito: "435050-F", ativo: true };

test("telaNovoRelatorio: paciente inexistente responde 404", async () => {
  const res = criarRespostaFalsa();
  await telaNovoRelatorio({ params: { id: "7" } }, res, { buscarPaciente: async () => null });
  assert.equal(res.statusCode, 404);
});

test("telaNovoRelatorio: caminho feliz renderiza o formulário sem relatorio", async () => {
  const res = criarRespostaFalsa();
  await telaNovoRelatorio(
    { params: { id: "7" } }, res,
    { buscarPaciente: async () => PACIENTE, listarFisioterapeutas: async () => [] }
  );

  assert.equal(res.viewRenderizada, "relatorios/formulario");
  assert.equal(res.dadosDaView.paciente, PACIENTE);
  assert.equal(res.dadosDaView.relatorio, null);
  assert.equal(res.dadosDaView.acaoForm, "/pacientes/7/relatorios/novo");
});

test("telaNovoRelatorio: caminho feliz passa a lista de fisioterapeutas ativos pra view", async () => {
  const res = criarRespostaFalsa();
  let opcoesRecebidas = null;
  await telaNovoRelatorio(
    { params: { id: "7" } }, res,
    {
      buscarPaciente: async () => PACIENTE,
      listarFisioterapeutas: async (opcoes) => { opcoesRecebidas = opcoes; return [FISIOTERAPEUTA]; },
    }
  );

  assert.deepEqual(opcoesRecebidas, { apenasAtivos: true });
  assert.deepEqual(res.dadosDaView.fisioterapeutas, [FISIOTERAPEUTA]);
});

test("processarNovoRelatorio: data inválida responde 400 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarNovoRelatorio(
    { params: { id: "7" }, body: { data_relatorio: "não-é-data" }, usuarioAtual: { id: 2 } },
    res,
    { buscarPaciente: async () => PACIENTE, criar: async () => { gravou = true; } }
  );

  assert.equal(res.statusCode, 400);
  assert.equal(gravou, false);
});

test("processarNovoRelatorio: com fisioterapeuta_id válido, deriva profissionalResponsavel e grava fisioterapeutaId", async () => {
  const res = criarRespostaFalsa();
  let dadosGravados = null;
  await processarNovoRelatorio(
    {
      params: { id: "7" },
      body: {
        data_relatorio: "2026-09-11",
        diagnostico_motivo: "Fratura 5º dedo mão direita",
        fisioterapeuta_id: "3",
      },
      usuarioAtual: { id: 2 },
    },
    res,
    {
      buscarPaciente: async () => PACIENTE,
      buscarFisioterapeuta: async (id) => (id === 3 ? FISIOTERAPEUTA : null),
      criar: async (dados) => { dadosGravados = dados; return 42; },
    }
  );

  assert.equal(dadosGravados.fisioterapeutaId, 3);
  assert.equal(dadosGravados.profissionalResponsavel, "Dra. Isabella Silva Reis / Crefito 435050-F");
});

test("processarNovoRelatorio: sem fisioterapeuta_id, grava fisioterapeutaId e profissionalResponsavel null", async () => {
  const res = criarRespostaFalsa();
  let dadosGravados = null;
  await processarNovoRelatorio(
    { params: { id: "7" }, body: { data_relatorio: "2026-09-11" }, usuarioAtual: { id: 2 } },
    res,
    { buscarPaciente: async () => PACIENTE, criar: async (dados) => { dadosGravados = dados; return 42; } }
  );

  assert.equal(dadosGravados.fisioterapeutaId, null);
  assert.equal(dadosGravados.profissionalResponsavel, null);
});

test("telaEditarRelatorio: relatório inexistente (ou de outro paciente) responde 404", async () => {
  const res = criarRespostaFalsa();
  await telaEditarRelatorio(
    { params: { id: "7", relatorioId: "5" } },
    res,
    { buscarPaciente: async () => PACIENTE, buscarRelatorio: async () => null }
  );

  assert.equal(res.statusCode, 404);
});

test("telaEditarRelatorio: caminho feliz renderiza o formulário pré-preenchido", async () => {
  const res = criarRespostaFalsa();
  await telaEditarRelatorio(
    { params: { id: "7", relatorioId: "5" } },
    res,
    { buscarPaciente: async () => PACIENTE, buscarRelatorio: async () => RELATORIO, listarFisioterapeutas: async () => [] }
  );

  assert.equal(res.viewRenderizada, "relatorios/formulario");
  assert.equal(res.dadosDaView.relatorio, RELATORIO);
  assert.equal(res.dadosDaView.acaoForm, "/pacientes/7/relatorios/5/editar");
});

test("telaEditarRelatorio: fisioterapeuta do relatório inativo (fora da lista de ativos) é buscado e anexado à lista", async () => {
  const res = criarRespostaFalsa();
  const FISIOTERAPEUTA_INATIVO = { ...FISIOTERAPEUTA, id: 9, ativo: false };
  let idBuscado = null;
  await telaEditarRelatorio(
    { params: { id: "7", relatorioId: "5" } },
    res,
    {
      buscarPaciente: async () => PACIENTE,
      buscarRelatorio: async () => ({ ...RELATORIO, fisioterapeutaId: 9 }),
      listarFisioterapeutas: async () => [],
      buscarFisioterapeuta: async (id) => { idBuscado = id; return FISIOTERAPEUTA_INATIVO; },
    }
  );

  assert.equal(idBuscado, 9);
  assert.deepEqual(res.dadosDaView.fisioterapeutas, [FISIOTERAPEUTA_INATIVO]);
});

test("telaEditarRelatorio: fisioterapeuta do relatório já está na lista de ativos, não busca de novo", async () => {
  const res = criarRespostaFalsa();
  let buscouFisioterapeuta = false;
  await telaEditarRelatorio(
    { params: { id: "7", relatorioId: "5" } },
    res,
    {
      buscarPaciente: async () => PACIENTE,
      buscarRelatorio: async () => ({ ...RELATORIO, fisioterapeutaId: 3 }),
      listarFisioterapeutas: async () => [FISIOTERAPEUTA],
      buscarFisioterapeuta: async () => { buscouFisioterapeuta = true; return FISIOTERAPEUTA; },
    }
  );

  assert.equal(buscouFisioterapeuta, false);
  assert.deepEqual(res.dadosDaView.fisioterapeutas, [FISIOTERAPEUTA]);
});

test("processarEditarRelatorio: relatório inexistente responde 404 sem gravar", async () => {
  const res = criarRespostaFalsa();
  let gravou = false;
  await processarEditarRelatorio(
    { params: { id: "7", relatorioId: "5" }, body: { data_relatorio: "2026-09-11" } },
    res,
    { buscarRelatorio: async () => null, atualizar: async () => { gravou = true; } }
  );

  assert.equal(res.statusCode, 404);
  assert.equal(gravou, false);
});

test("processarEditarRelatorio: caminho feliz grava e redireciona pra ficha", async () => {
  const res = criarRespostaFalsa();
  let idAtualizado = null;
  let dadosAtualizados = null;
  await processarEditarRelatorio(
    {
      params: { id: "7", relatorioId: "5" },
      body: { data_relatorio: "2026-09-12", consideracoes_finais: "Alta parcial" },
    },
    res,
    {
      buscarRelatorio: async () => RELATORIO,
      atualizar: async (id, dados) => { idAtualizado = id; dadosAtualizados = dados; },
    }
  );

  assert.equal(idAtualizado, 5);
  assert.equal(dadosAtualizados.dataRelatorio, "2026-09-12");
  assert.equal(dadosAtualizados.consideracoesFinais, "Alta parcial");
  assert.equal(res.redirectedTo, "/pacientes/7/ficha");
});

test("processarEditarRelatorio: com fisioterapeuta_id válido, deriva e grava normalmente", async () => {
  const res = criarRespostaFalsa();
  let dadosAtualizados = null;
  await processarEditarRelatorio(
    { params: { id: "7", relatorioId: "5" }, body: { data_relatorio: "2026-09-12", fisioterapeuta_id: "3" } },
    res,
    {
      buscarRelatorio: async () => RELATORIO,
      buscarFisioterapeuta: async (id) => (id === 3 ? FISIOTERAPEUTA : null),
      atualizar: async (id, dados) => { dadosAtualizados = dados; },
    }
  );

  assert.equal(dadosAtualizados.fisioterapeutaId, 3);
  assert.equal(dadosAtualizados.profissionalResponsavel, "Dra. Isabella Silva Reis / Crefito 435050-F");
});

test("processarEditarRelatorio: relatório legado (sem fisioterapeuta_id) com campo legado no body preserva o texto antigo", async () => {
  const res = criarRespostaFalsa();
  let dadosAtualizados = null;
  await processarEditarRelatorio(
    {
      params: { id: "7", relatorioId: "5" },
      body: {
        data_relatorio: "2026-09-12",
        profissional_responsavel_legado: "Dr. Antigo / Crefito 111111-F",
      },
    },
    res,
    {
      buscarRelatorio: async () => RELATORIO,
      atualizar: async (id, dados) => { dadosAtualizados = dados; },
    }
  );

  assert.equal(dadosAtualizados.fisioterapeutaId, null);
  assert.equal(dadosAtualizados.profissionalResponsavel, "Dr. Antigo / Crefito 111111-F");
});

test("gerarPdfRelatorioController: relatório inexistente responde 404", async () => {
  const res = criarRespostaFalsa();
  await gerarPdfRelatorioController(
    { params: { id: "7", relatorioId: "5" } },
    res,
    { buscarPaciente: async () => PACIENTE, buscarRelatorio: async () => null }
  );

  assert.equal(res.statusCode, 404);
});

test("gerarPdfRelatorioController: caminho feliz responde PDF com Content-Disposition correto", async () => {
  const res = criarRespostaFalsa();
  let dadosPassadosPraPdf = null;
  await gerarPdfRelatorioController(
    { params: { id: "7", relatorioId: "5" } },
    res,
    {
      buscarPaciente: async () => PACIENTE,
      buscarRelatorio: async () => RELATORIO,
      gerarPdf: (dados) => { dadosPassadosPraPdf = dados; return Promise.resolve(Buffer.from("PDF-FAKE")); },
    }
  );

  assert.equal(res.corpo.toString(), "PDF-FAKE");
  assert.equal(res.headers["Content-Type"], "application/pdf");
  assert.match(res.headers["Content-Disposition"], /attachment; filename="relatorio-ana-silva-2026-09-11\.pdf"/);
  assert.equal(dadosPassadosPraPdf.pacienteNome, "Ana Silva");
  assert.equal(dadosPassadosPraPdf.dataRelatorio, "2026-09-11");
});

test("gerarPdfRelatorioController: relatório com fisioterapeutaId busca e passa a assinatura pro gerarPdf", async () => {
  const res = criarRespostaFalsa();
  let dadosPassadosPraPdf = null;
  await gerarPdfRelatorioController(
    { params: { id: "7", relatorioId: "5" } },
    res,
    {
      buscarPaciente: async () => PACIENTE,
      buscarRelatorio: async () => ({ ...RELATORIO, fisioterapeutaId: 3 }),
      buscarAssinatura: async (id) => (id === 3 ? { assinaturaImagem: Buffer.from("img"), assinaturaMime: "image/png" } : null),
      gerarPdf: (dados) => { dadosPassadosPraPdf = dados; return Promise.resolve(Buffer.from("PDF-FAKE")); },
    }
  );

  assert.deepEqual(dadosPassadosPraPdf.assinaturaImagem, Buffer.from("img"));
  assert.equal(dadosPassadosPraPdf.assinaturaMime, "image/png");
});

test("gerarPdfRelatorioController: relatório sem fisioterapeutaId (legado) não busca assinatura", async () => {
  const res = criarRespostaFalsa();
  let buscouAssinatura = false;
  let dadosPassadosPraPdf = null;
  await gerarPdfRelatorioController(
    { params: { id: "7", relatorioId: "5" } },
    res,
    {
      buscarPaciente: async () => PACIENTE,
      buscarRelatorio: async () => RELATORIO,
      buscarAssinatura: async () => { buscouAssinatura = true; return null; },
      gerarPdf: (dados) => { dadosPassadosPraPdf = dados; return Promise.resolve(Buffer.from("PDF-FAKE")); },
    }
  );

  assert.equal(buscouAssinatura, false);
  assert.equal(dadosPassadosPraPdf.assinaturaImagem, null);
});

test("gerarDocxRelatorioController: relatório inexistente responde 404", async () => {
  const res = criarRespostaFalsa();
  await gerarDocxRelatorioController(
    { params: { id: "7", relatorioId: "5" } },
    res,
    { buscarPaciente: async () => PACIENTE, buscarRelatorio: async () => null }
  );

  assert.equal(res.statusCode, 404);
});

test("gerarDocxRelatorioController: caminho feliz responde .docx com Content-Disposition correto", async () => {
  const res = criarRespostaFalsa();
  let dadosPassadosPraDocx = null;
  await gerarDocxRelatorioController(
    { params: { id: "7", relatorioId: "5" } },
    res,
    {
      buscarPaciente: async () => PACIENTE,
      buscarRelatorio: async () => RELATORIO,
      gerarDocx: (dados) => { dadosPassadosPraDocx = dados; return Promise.resolve(Buffer.from("DOCX-FAKE")); },
    }
  );

  assert.equal(res.corpo.toString(), "DOCX-FAKE");
  assert.equal(
    res.headers["Content-Type"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
  assert.match(res.headers["Content-Disposition"], /attachment; filename="relatorio-ana-silva-2026-09-11\.docx"/);
  assert.equal(dadosPassadosPraDocx.pacienteNome, "Ana Silva");
});

test("gerarDocxRelatorioController: relatório com fisioterapeutaId busca e passa a assinatura pro gerarDocx", async () => {
  const res = criarRespostaFalsa();
  let dadosPassadosPraDocx = null;
  await gerarDocxRelatorioController(
    { params: { id: "7", relatorioId: "5" } },
    res,
    {
      buscarPaciente: async () => PACIENTE,
      buscarRelatorio: async () => ({ ...RELATORIO, fisioterapeutaId: 3 }),
      buscarAssinatura: async (id) => (id === 3 ? { assinaturaImagem: Buffer.from("img"), assinaturaMime: "image/png" } : null),
      gerarDocx: (dados) => { dadosPassadosPraDocx = dados; return Promise.resolve(Buffer.from("DOCX-FAKE")); },
    }
  );

  assert.deepEqual(dadosPassadosPraDocx.assinaturaImagem, Buffer.from("img"));
  assert.equal(dadosPassadosPraDocx.assinaturaMime, "image/png");
});

test("gerarDocxRelatorioController: relatório sem fisioterapeutaId (legado) não busca assinatura", async () => {
  const res = criarRespostaFalsa();
  let buscouAssinatura = false;
  let dadosPassadosPraDocx = null;
  await gerarDocxRelatorioController(
    { params: { id: "7", relatorioId: "5" } },
    res,
    {
      buscarPaciente: async () => PACIENTE,
      buscarRelatorio: async () => RELATORIO,
      buscarAssinatura: async () => { buscouAssinatura = true; return null; },
      gerarDocx: (dados) => { dadosPassadosPraDocx = dados; return Promise.resolve(Buffer.from("DOCX-FAKE")); },
    }
  );

  assert.equal(buscouAssinatura, false);
  assert.equal(dadosPassadosPraDocx.assinaturaImagem, null);
});

test("processarRascunhoRelatorioPdf: paciente inexistente responde 404", async () => {
  const res = criarRespostaFalsa();
  await processarRascunhoRelatorioPdf(
    { params: { id: "7" }, body: {} },
    res,
    { buscarPaciente: async () => null }
  );

  assert.equal(res.statusCode, 404);
});

test("processarRascunhoRelatorioPdf: gera o PDF com o que estiver no body, mesmo incompleto, sem gravar nada", async () => {
  const res = criarRespostaFalsa();
  let dadosPassadosPraPdf = null;
  await processarRascunhoRelatorioPdf(
    { params: { id: "7" }, body: { diagnostico_motivo: "Fratura", data_relatorio: "" } },
    res,
    {
      buscarPaciente: async () => PACIENTE,
      gerarPdf: (dados) => { dadosPassadosPraPdf = dados; return Promise.resolve(Buffer.from("PDF-RASCUNHO")); },
    }
  );

  assert.equal(res.corpo.toString(), "PDF-RASCUNHO");
  assert.equal(res.headers["Content-Type"], "application/pdf");
  assert.match(res.headers["Content-Disposition"], /attachment; filename="rascunho-relatorio-ana-silva\.pdf"/);
  assert.equal(dadosPassadosPraPdf.diagnosticoMotivo, "Fratura");
  assert.equal(dadosPassadosPraPdf.dataRelatorio, null, "campo vazio deve virar null, não string vazia");
});

test("processarRascunhoRelatorioPdf: com fisioterapeuta_id, resolve texto e assinatura juntos", async () => {
  const res = criarRespostaFalsa();
  let dadosPassadosPraPdf = null;
  await processarRascunhoRelatorioPdf(
    { params: { id: "7" }, body: { fisioterapeuta_id: "3" } },
    res,
    {
      buscarPaciente: async () => PACIENTE,
      buscarFisioterapeuta: async (id) => (id === 3 ? FISIOTERAPEUTA : null),
      buscarAssinatura: async (id) => (id === 3 ? { assinaturaImagem: Buffer.from("img"), assinaturaMime: "image/png" } : null),
      gerarPdf: (dados) => { dadosPassadosPraPdf = dados; return Promise.resolve(Buffer.from("PDF-RASCUNHO")); },
    }
  );

  assert.equal(dadosPassadosPraPdf.profissionalResponsavel, "Dra. Isabella Silva Reis / Crefito 435050-F");
  assert.deepEqual(dadosPassadosPraPdf.assinaturaImagem, Buffer.from("img"));
});

test("processarRascunhoRelatorioDocx: gera o .docx com o que estiver no body, sem gravar nada", async () => {
  const res = criarRespostaFalsa();
  let dadosPassadosPraDocx = null;
  await processarRascunhoRelatorioDocx(
    { params: { id: "7" }, body: { conduta_evolucao: "Evoluindo bem" } },
    res,
    {
      buscarPaciente: async () => PACIENTE,
      gerarDocx: (dados) => { dadosPassadosPraDocx = dados; return Promise.resolve(Buffer.from("DOCX-RASCUNHO")); },
    }
  );

  assert.equal(res.corpo.toString(), "DOCX-RASCUNHO");
  assert.equal(
    res.headers["Content-Type"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
  assert.match(res.headers["Content-Disposition"], /attachment; filename="rascunho-relatorio-ana-silva\.docx"/);
  assert.equal(dadosPassadosPraDocx.condutaEvolucao, "Evoluindo bem");
});

test("processarRascunhoRelatorioDocx: com fisioterapeuta_id, resolve texto e assinatura juntos", async () => {
  const res = criarRespostaFalsa();
  let dadosPassadosPraDocx = null;
  await processarRascunhoRelatorioDocx(
    { params: { id: "7" }, body: { fisioterapeuta_id: "3" } },
    res,
    {
      buscarPaciente: async () => PACIENTE,
      buscarFisioterapeuta: async (id) => (id === 3 ? FISIOTERAPEUTA : null),
      buscarAssinatura: async (id) => (id === 3 ? { assinaturaImagem: Buffer.from("img"), assinaturaMime: "image/png" } : null),
      gerarDocx: (dados) => { dadosPassadosPraDocx = dados; return Promise.resolve(Buffer.from("DOCX-RASCUNHO")); },
    }
  );

  assert.equal(dadosPassadosPraDocx.profissionalResponsavel, "Dra. Isabella Silva Reis / Crefito 435050-F");
  assert.deepEqual(dadosPassadosPraDocx.assinaturaImagem, Buffer.from("img"));
});

test("processarExcluirRelatorio: id inválido responde 404", async () => {
  const res = criarRespostaFalsa();
  await processarExcluirRelatorio({ params: { id: "7", relatorioId: "abc" } }, res);

  assert.equal(res.statusCode, 404);
});

test("processarExcluirRelatorio: relatório inexistente (ou de outro paciente) responde 404", async () => {
  const res = criarRespostaFalsa();
  await processarExcluirRelatorio(
    { params: { id: "7", relatorioId: "5" } },
    res,
    { excluir: async () => false }
  );

  assert.equal(res.statusCode, 404);
});

test("processarExcluirRelatorio: caminho feliz exclui e redireciona pra ficha", async () => {
  const res = criarRespostaFalsa();
  let idsRecebidos = null;
  await processarExcluirRelatorio(
    { params: { id: "7", relatorioId: "5" } },
    res,
    { excluir: async (relatorioId, pacienteId) => { idsRecebidos = { relatorioId, pacienteId }; return true; } }
  );

  assert.deepEqual(idsRecebidos, { relatorioId: 5, pacienteId: 7 });
  assert.equal(res.redirectedTo, "/pacientes/7/ficha");
});
