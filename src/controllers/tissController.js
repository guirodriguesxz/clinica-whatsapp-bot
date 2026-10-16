// src/controllers/tissController.js
import { listarConvenios, buscarConvenioPorId } from "../models/convenioModel.js";
import { buscarDadosPrestador } from "../models/dadosPrestadorModel.js";
import {
  buscarGuiasConvenioPeriodo,
  classificarGuias,
  motivosBloqueioLote,
} from "../models/tissLoteModel.js";
import { gerarXmlLoteTiss } from "../services/tissXmlService.js";
import { slugArquivo } from "../utils/slugArquivo.js";
import { idSeguro } from "../utils/paginacao.js";
import { validarData } from "../utils/validacao.js";
import dayjs from "../utils/dayjs.js";

const CARATERES_ATENDIMENTO_VALIDOS = ["eletiva", "urgencia"];
const CARATER_ATENDIMENTO_PADRAO = "eletiva";

function parametrosPeriodo(query) {
  const convenioId = idSeguro(query.convenioId);
  const inicio = validarData(query.inicio) ? query.inicio : null;
  const fim = validarData(query.fim) ? query.fim : null;
  const carater = CARATERES_ATENDIMENTO_VALIDOS.includes(query.carater)
    ? query.carater
    : CARATER_ATENDIMENTO_PADRAO;
  return { convenioId, inicio, fim, carater };
}

// Um CBO só por especialidade (config da clínica, não por profissional
// cadastrado — ver decisão em docs/superpowers/specs, migration 035).
function resolverCbo(dadosPrestador, tipoAtendimento) {
  if (tipoAtendimento === "fisioterapia") return dadosPrestador?.cbo_fisioterapia ?? null;
  if (tipoAtendimento === "psicologia") return dadosPrestador?.cbo_psicologia ?? null;
  return null;
}

export async function telaTiss(
  req,
  res,
  {
    listarConvenios: listar = listarConvenios,
    buscarConvenio = buscarConvenioPorId,
    buscarPrestador = buscarDadosPrestador,
    buscarGuias = buscarGuiasConvenioPeriodo,
  } = {}
) {
  const convenios = await listar({ apenasAtivos: true });
  const { convenioId, inicio, fim, carater } = parametrosPeriodo(req.query ?? {});

  if (!convenioId || !inicio || !fim) {
    return res.render("financeiro/tiss", {
      convenios,
      convenioId: req.query?.convenioId ?? "",
      inicio: req.query?.inicio ?? "",
      fim: req.query?.fim ?? "",
      carater,
      preview: null,
    });
  }

  const convenio = await buscarConvenio(convenioId);
  if (!convenio) return res.status(404).send("Convênio não encontrado.");

  const [dadosPrestador, linhas] = await Promise.all([
    buscarPrestador(),
    buscarGuias({ convenioId, inicio, fim }),
  ]);

  const { prontas, incompletas } = classificarGuias(linhas);
  const motivosBloqueio = motivosBloqueioLote({ dadosPrestador, convenio });

  res.render("financeiro/tiss", {
    convenios,
    convenioId: String(convenioId),
    inicio,
    fim,
    carater,
    preview: { convenio, prontas, incompletas, motivosBloqueio },
  });
}

export async function gerarLoteTiss(
  req,
  res,
  {
    buscarConvenio = buscarConvenioPorId,
    buscarPrestador = buscarDadosPrestador,
    buscarGuias = buscarGuiasConvenioPeriodo,
    gerarXml = gerarXmlLoteTiss,
  } = {}
) {
  const { convenioId, inicio, fim, carater } = parametrosPeriodo(req.query ?? {});
  if (!convenioId || !inicio || !fim) {
    return res.status(400).send("Parâmetros inválidos.");
  }

  const convenio = await buscarConvenio(convenioId);
  if (!convenio) return res.status(404).send("Convênio não encontrado.");

  const [dadosPrestador, linhas] = await Promise.all([
    buscarPrestador(),
    buscarGuias({ convenioId, inicio, fim }),
  ]);

  const motivosBloqueio = motivosBloqueioLote({ dadosPrestador, convenio });
  if (motivosBloqueio.length > 0) {
    return res.status(400).send("Dados do prestador/convênio incompletos para gerar o lote.");
  }

  const { prontas } = classificarGuias(linhas);
  if (prontas.length === 0) {
    return res.status(400).send("Nenhuma guia pronta no período selecionado.");
  }

  const guias = prontas.map((linha) => ({
    numeroGuiaPrestador: String(linha.pagamento_id),
    pacienteNome: linha.paciente_nome,
    matriculaConvenio: linha.matricula_convenio,
    pacienteSexo: linha.sexo,
    pacienteCns: linha.cns,
    tipoAtendimento: linha.tipo_atendimento,
    dataAtendimento: linha.data_atendimento,
    caraterAtendimento: carater,
    codigoTuss: linha.codigo_tuss,
    descricaoTuss: linha.descricao_tuss,
    valor: linha.valor,
    cboProfissional: resolverCbo(dadosPrestador, linha.tipo_atendimento),
  }));

  const xml = gerarXml({
    dadosPrestador,
    convenio,
    guias,
    numeroLote: `${convenioId}-${inicio}-${fim}`,
    dataGeracao: dayjs().format("YYYY-MM-DD"),
  });

  const nomeArquivo = `tiss-lote-${slugArquivo(convenio.nome)}-${inicio}-${fim}.xml`;
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo}"`);
  res.send(xml);
}
