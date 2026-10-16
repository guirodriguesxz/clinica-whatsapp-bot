// src/controllers/avaliacaoFisioterapeuticaController.js
import { buscarPacientePorId } from "../models/pacienteModel.js";
import {
  criarAvaliacao,
  buscarAvaliacaoDoPaciente,
  atualizarAvaliacao,
} from "../models/avaliacaoFisioterapeuticaModel.js";
import { gerarPdfAvaliacao } from "../services/avaliacaoFisioterapeuticaPdfService.js";
import { slugArquivo } from "../utils/slugArquivo.js";
import { idSeguro } from "../utils/paginacao.js";
import { validarData } from "../utils/validacao.js";

function campoOuNulo(valor) {
  const texto = String(valor ?? "").trim();
  return texto || null;
}

function camposConteudoDoBody(body) {
  return {
    estaGravida: campoOuNulo(body.esta_gravida),
    possuiMarcapasso: campoOuNulo(body.possui_marcapasso),
    possuiProteseMetalicaImplantes: campoOuNulo(body.possui_protese_metalica_implantes),
    possuiDoencasCardiacas: campoOuNulo(body.possui_doencas_cardiacas),
    possuiHipertensaoArterial: campoOuNulo(body.possui_hipertensao_arterial),
    possuiDiabetes: campoOuNulo(body.possui_diabetes),
    possuiEpilepsia: campoOuNulo(body.possui_epilepsia),
    possuiHistoricoCancer: campoOuNulo(body.possui_historico_cancer),
    medicamentosContinuosQuais: campoOuNulo(body.medicamentos_continuos_quais),
    cirurgiaQual: campoOuNulo(body.cirurgia_qual),
    cirurgiaQuando: campoOuNulo(body.cirurgia_quando),
    tempoUltimaCirurgia: campoOuNulo(body.tempo_ultima_cirurgia),
    dorAtualLocal: campoOuNulo(body.dor_atual_local),
    dorAtualIntensidade: campoOuNulo(body.dor_atual_intensidade),
    limitacoesFuncionaisQuais: campoOuNulo(body.limitacoes_funcionais_quais),
    fisioterapiaAnteriormente: campoOuNulo(body.fisioterapia_anteriormente),
    objetivosTratamento: campoOuNulo(body.objetivos_tratamento),
    condutasPropostas: campoOuNulo(body.condutas_propostas),
  };
}

export async function telaNovaAvaliacao(req, res, { buscarPaciente = buscarPacientePorId } = {}) {
  const pacienteId = idSeguro(req.params.id);
  if (!pacienteId) return res.status(404).send("Paciente não encontrado.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  res.render("avaliacoes/formulario", {
    paciente,
    avaliacao: null,
    erro: null,
    acaoForm: `/pacientes/${pacienteId}/avaliacoes/nova`,
  });
}

export async function processarNovaAvaliacao(
  req,
  res,
  { buscarPaciente = buscarPacientePorId, criar = criarAvaliacao } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  if (!pacienteId) return res.status(404).send("Paciente não encontrado.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  const body = req.body ?? {};
  const dataAvaliacao = String(body.data_avaliacao ?? "").trim();
  if (!validarData(dataAvaliacao)) return res.status(400).send("Data da avaliação inválida.");

  await criar({
    pacienteId,
    dataAvaliacao,
    ...camposConteudoDoBody(body),
    registradoPor: req.usuarioAtual.id,
  });

  res.redirect(`/pacientes/${pacienteId}/ficha`);
}

export async function telaEditarAvaliacao(
  req,
  res,
  { buscarPaciente = buscarPacientePorId, buscarAvaliacao = buscarAvaliacaoDoPaciente } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  const avaliacaoId = idSeguro(req.params.avaliacaoId);
  if (!pacienteId || !avaliacaoId) return res.status(404).send("Avaliação não encontrada.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  const avaliacao = await buscarAvaliacao(avaliacaoId, pacienteId);
  if (!avaliacao) return res.status(404).send("Avaliação não encontrada.");

  res.render("avaliacoes/formulario", {
    paciente,
    avaliacao,
    erro: null,
    acaoForm: `/pacientes/${pacienteId}/avaliacoes/${avaliacaoId}/editar`,
  });
}

export async function processarEditarAvaliacao(
  req,
  res,
  { buscarAvaliacao = buscarAvaliacaoDoPaciente, atualizar = atualizarAvaliacao } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  const avaliacaoId = idSeguro(req.params.avaliacaoId);
  if (!pacienteId || !avaliacaoId) return res.status(404).send("Avaliação não encontrada.");

  const avaliacao = await buscarAvaliacao(avaliacaoId, pacienteId);
  if (!avaliacao) return res.status(404).send("Avaliação não encontrada.");

  const body = req.body ?? {};
  const dataAvaliacao = String(body.data_avaliacao ?? "").trim();
  if (!validarData(dataAvaliacao)) return res.status(400).send("Data da avaliação inválida.");

  await atualizar(avaliacaoId, {
    dataAvaliacao,
    ...camposConteudoDoBody(body),
  });

  res.redirect(`/pacientes/${pacienteId}/ficha`);
}

export async function gerarPdfAvaliacaoController(
  req,
  res,
  {
    buscarPaciente = buscarPacientePorId,
    buscarAvaliacao = buscarAvaliacaoDoPaciente,
    gerarPdf = gerarPdfAvaliacao,
  } = {}
) {
  const pacienteId = idSeguro(req.params.id);
  const avaliacaoId = idSeguro(req.params.avaliacaoId);
  if (!pacienteId || !avaliacaoId) return res.status(404).send("Avaliação não encontrada.");

  const paciente = await buscarPaciente(pacienteId);
  if (!paciente) return res.status(404).send("Paciente não encontrado.");

  const avaliacao = await buscarAvaliacao(avaliacaoId, pacienteId);
  if (!avaliacao) return res.status(404).send("Avaliação não encontrada.");

  const pdf = await gerarPdf({ pacienteNome: paciente.nome, ...avaliacao });
  const nomeArquivo = `avaliacao-${slugArquivo(paciente.nome)}-${avaliacao.dataAvaliacao}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo}"`);
  res.send(pdf);
}
