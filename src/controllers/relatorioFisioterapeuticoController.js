// src/controllers/relatorioFisioterapeuticoController.js
import { buscarPacientePorId } from "../models/pacienteModel.js";
import {
  criarRelatorio,
  buscarRelatorioDoPaciente,
  atualizarRelatorio,
  excluirRelatorio,
} from "../models/relatorioFisioterapeuticoModel.js";
import {
  listarFisioterapeutas,
  buscarFisioterapeutaPorId,
  buscarAssinaturaFisioterapeuta,
} from "../models/fisioterapeutaModel.js";
import { gerarPdfRelatorio } from "../services/relatorioFisioterapeuticoPdfService.js";
import { gerarDocxRelatorio } from "../services/relatorioFisioterapeuticoDocxService.js";
import { slugArquivo } from "../utils/slugArquivo.js";
import { idSeguro } from "../utils/paginacao.js";
import { validarData } from "../utils/validacao.js";

function campoOuNulo(valor) {
  const texto = String(valor ?? "").trim();
  return texto || null;
}

function camposConteudoDoBody(body) {
  return {
    diagnosticoMotivo: campoOuNulo(body.diagnostico_motivo),
    condutaEvolucao: campoOuNulo(body.conduta_evolucao),
    consideracoesFinais: campoOuNulo(body.consideracoes_finais),
  };
}

function formatarProfissionalResponsavel(fisioterapeuta) {
  return fisioterapeuta.crefito
    ? `${fisioterapeuta.nome} / Crefito ${fisioterapeuta.crefito}`
    : fisioterapeuta.nome;
}

/**
 * Resolve o fisioterapeuta escolhido no <select> do formulário. Sem
 * seleção válida, devolve os dois campos null — mesmo comportamento de
 * hoje quando o campo (antes texto livre) ficava em branco.
 */
async function resolverFisioterapeuta(body, { buscarFisioterapeuta }) {
  const fisioterapeutaId = idSeguro(body.fisioterapeuta_id);
  if (!fisioterapeutaId) return { fisioterapeutaId: null, profissionalResponsavel: null };

  const fisioterapeuta = await buscarFisioterapeuta(fisioterapeutaId);
  if (!fisioterapeuta || !fisioterapeuta.ativo) {
    return { fisioterapeutaId: null, profissionalResponsavel: null };
  }
  return { fisioterapeutaId: fisioterapeuta.id, profissionalResponsavel: formatarProfissionalResponsavel(fisioterapeuta) };
}

/**
 * Busca a assinatura atual do fisioterapeuta (sempre "ao vivo", nunca
 * guardada no relatório) — mesmo espírito de "documento gerado sob
 * demanda, nunca salvo" que já vale pro relatório inteiro. Sem
 * fisioterapeutaId (relatório legado ou sem seleção), não bate no banco.
 */
async function buscarDadosAssinatura(fisioterapeutaId, { buscarAssinatura = buscarAssinaturaFisioterapeuta } = {}) {
  if (!fisioterapeutaId) return { assinaturaImagem: null, assinaturaMime: null };

  const assinatura = await buscarAssinatura(fisioterapeutaId);
  if (!assinatura) return { assinaturaImagem: null, assinaturaMime: null };
  return { assinaturaImagem: assinatura.assinaturaImagem, assinaturaMime: assinatura.assinaturaMime };
}

export async function telaNovoRelatorio(
  req, res,
  { buscarPaciente = buscarPacientePorId, listarFisioterapeutas: listar = listarFisioterapeutas } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  if (!pacienteId) return res.status(404).send("Paciente não encontrado.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  const fisioterapeutas = await listar({ apenasAtivos: true });

  res.render("relatorios/formulario", {
    paciente,
    relatorio: null,
    fisioterapeutas,
    erro: null,
    acaoForm: `/pacientes/${pacienteId}/relatorios/novo`,
  });
}

export async function processarNovoRelatorio(
  req, res,
  { buscarPaciente = buscarPacientePorId, criar = criarRelatorio, buscarFisioterapeuta = buscarFisioterapeutaPorId } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  if (!pacienteId) return res.status(404).send("Paciente não encontrado.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  const body = req.body ?? {};
  const dataRelatorio = String(body.data_relatorio ?? "").trim();
  if (!validarData(dataRelatorio)) return res.status(400).send("Data do relatório inválida.");

  const { fisioterapeutaId, profissionalResponsavel } = await resolverFisioterapeuta(body, { buscarFisioterapeuta });

  await criar({
    pacienteId,
    dataRelatorio,
    ...camposConteudoDoBody(body),
    profissionalResponsavel,
    fisioterapeutaId,
    registradoPor: req.usuarioAtual.id,
  });

  res.redirect(`/pacientes/${pacienteId}/ficha`);
}

export async function telaEditarRelatorio(
  req, res,
  {
    buscarPaciente = buscarPacientePorId,
    buscarRelatorio = buscarRelatorioDoPaciente,
    listarFisioterapeutas: listar = listarFisioterapeutas,
    buscarFisioterapeuta = buscarFisioterapeutaPorId,
  } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  const relatorioId = idSeguro(req.params.relatorioId);
  if (!pacienteId || !relatorioId) return res.status(404).send("Relatório não encontrado.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  const relatorio = await buscarRelatorio(relatorioId, pacienteId);
  if (!relatorio) return res.status(404).send("Relatório não encontrado.");

  let fisioterapeutas = await listar({ apenasAtivos: true });
  if (relatorio.fisioterapeutaId && !fisioterapeutas.some((f) => f.id === relatorio.fisioterapeutaId)) {
    const fisioterapeutaInativo = await buscarFisioterapeuta(relatorio.fisioterapeutaId);
    if (fisioterapeutaInativo) fisioterapeutas = [...fisioterapeutas, fisioterapeutaInativo];
  }

  res.render("relatorios/formulario", {
    paciente,
    relatorio,
    fisioterapeutas,
    erro: null,
    acaoForm: `/pacientes/${pacienteId}/relatorios/${relatorioId}/editar`,
  });
}

export async function processarEditarRelatorio(
  req, res,
  {
    buscarRelatorio = buscarRelatorioDoPaciente,
    atualizar = atualizarRelatorio,
    buscarFisioterapeuta = buscarFisioterapeutaPorId,
  } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  const relatorioId = idSeguro(req.params.relatorioId);
  if (!pacienteId || !relatorioId) return res.status(404).send("Relatório não encontrado.");

  const relatorio = await buscarRelatorio(relatorioId, pacienteId);
  if (!relatorio) return res.status(404).send("Relatório não encontrado.");

  const body = req.body ?? {};
  const dataRelatorio = String(body.data_relatorio ?? "").trim();
  if (!validarData(dataRelatorio)) return res.status(400).send("Data do relatório inválida.");

  let { fisioterapeutaId, profissionalResponsavel } = await resolverFisioterapeuta(body, { buscarFisioterapeuta });

  // Relatório antigo (sem fisioterapeuta cadastrado) sendo editado sem
  // trocar a seleção: preserva o texto livre que já tinha, em vez de
  // apagá-lo — ver formulario.ejs (Tarefa 11), que manda esse campo
  // escondido só quando esse caso se aplica.
  if (!fisioterapeutaId && campoOuNulo(body.profissional_responsavel_legado)) {
    profissionalResponsavel = campoOuNulo(body.profissional_responsavel_legado);
  }

  await atualizar(relatorioId, {
    dataRelatorio,
    ...camposConteudoDoBody(body),
    profissionalResponsavel,
    fisioterapeutaId,
  });

  res.redirect(`/pacientes/${pacienteId}/ficha`);
}

export async function gerarPdfRelatorioController(
  req, res,
  {
    buscarPaciente = buscarPacientePorId,
    buscarRelatorio = buscarRelatorioDoPaciente,
    buscarAssinatura = buscarAssinaturaFisioterapeuta,
    gerarPdf = gerarPdfRelatorio,
  } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  const relatorioId = idSeguro(req.params.relatorioId);
  if (!pacienteId || !relatorioId) return res.status(404).send("Relatório não encontrado.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  const relatorio = await buscarRelatorio(relatorioId, pacienteId);
  if (!relatorio) return res.status(404).send("Relatório não encontrado.");

  const dadosAssinatura = await buscarDadosAssinatura(relatorio.fisioterapeutaId, { buscarAssinatura });

  const pdf = await gerarPdf({ pacienteNome: paciente.nome, ...relatorio, ...dadosAssinatura });
  const nomeArquivo = `relatorio-${slugArquivo(paciente.nome)}-${relatorio.dataRelatorio}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo}"`);
  res.send(pdf);
}

export async function gerarDocxRelatorioController(
  req, res,
  {
    buscarPaciente = buscarPacientePorId,
    buscarRelatorio = buscarRelatorioDoPaciente,
    buscarAssinatura = buscarAssinaturaFisioterapeuta,
    gerarDocx = gerarDocxRelatorio,
  } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  const relatorioId = idSeguro(req.params.relatorioId);
  if (!pacienteId || !relatorioId) return res.status(404).send("Relatório não encontrado.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  const relatorio = await buscarRelatorio(relatorioId, pacienteId);
  if (!relatorio) return res.status(404).send("Relatório não encontrado.");

  const dadosAssinatura = await buscarDadosAssinatura(relatorio.fisioterapeutaId, { buscarAssinatura });

  const docx = await gerarDocx({ pacienteNome: paciente.nome, ...relatorio, ...dadosAssinatura });
  const nomeArquivo = `relatorio-${slugArquivo(paciente.nome)}-${relatorio.dataRelatorio}.docx`;
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo}"`);
  res.send(docx);
}

/**
 * Rascunho: gera o arquivo com o que estiver no formulário nesse instante,
 * sem gravar nada — pra baixar e conferir antes de decidir salvar (decisão
 * do usuário, 2026-09-14). Por isso não valida data_relatorio como
 * processarNovoRelatorio faz: um rascunho pode estar incompleto, e
 * formatarDataExtensa já lida bem com data vazia/inválida (vira "").
 */
export async function processarRascunhoRelatorioPdf(
  req, res,
  {
    buscarPaciente = buscarPacientePorId,
    buscarFisioterapeuta = buscarFisioterapeutaPorId,
    buscarAssinatura = buscarAssinaturaFisioterapeuta,
    gerarPdf = gerarPdfRelatorio,
  } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  if (!pacienteId) return res.status(404).send("Paciente não encontrado.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  const body = req.body ?? {};
  const { fisioterapeutaId, profissionalResponsavel } = await resolverFisioterapeuta(body, { buscarFisioterapeuta });
  const dadosAssinatura = await buscarDadosAssinatura(fisioterapeutaId, { buscarAssinatura });

  const pdf = await gerarPdf({
    pacienteNome: paciente.nome,
    dataRelatorio: campoOuNulo(body.data_relatorio),
    ...camposConteudoDoBody(body),
    profissionalResponsavel,
    ...dadosAssinatura,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="rascunho-relatorio-${slugArquivo(paciente.nome)}.pdf"`);
  res.send(pdf);
}

export async function processarRascunhoRelatorioDocx(
  req, res,
  {
    buscarPaciente = buscarPacientePorId,
    buscarFisioterapeuta = buscarFisioterapeutaPorId,
    buscarAssinatura = buscarAssinaturaFisioterapeuta,
    gerarDocx = gerarDocxRelatorio,
  } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  if (!pacienteId) return res.status(404).send("Paciente não encontrado.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  const body = req.body ?? {};
  const { fisioterapeutaId, profissionalResponsavel } = await resolverFisioterapeuta(body, { buscarFisioterapeuta });
  const dadosAssinatura = await buscarDadosAssinatura(fisioterapeutaId, { buscarAssinatura });

  const docx = await gerarDocx({
    pacienteNome: paciente.nome,
    dataRelatorio: campoOuNulo(body.data_relatorio),
    ...camposConteudoDoBody(body),
    profissionalResponsavel,
    ...dadosAssinatura,
  });
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="rascunho-relatorio-${slugArquivo(paciente.nome)}.docx"`
  );
  res.send(docx);
}

export async function processarExcluirRelatorio(req, res, { excluir = excluirRelatorio } = {}) {
  const pacienteId = idSeguro(req.params.id);
  const relatorioId = idSeguro(req.params.relatorioId);
  if (!pacienteId || !relatorioId) return res.status(404).send("Relatório não encontrado.");

  const excluiu = await excluir(relatorioId, pacienteId);
  if (!excluiu) return res.status(404).send("Relatório não encontrado.");

  res.redirect(`/pacientes/${pacienteId}/ficha`);
}
