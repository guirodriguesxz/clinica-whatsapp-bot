// src/services/laudoPdfService.js
import PDFDocument from "pdfkit";
import { formatarMoeda } from "../utils/dinheiro.js";

const NOME_CLINICA = "Clínica Exemplo — Fisioterapia & Psicologia";

/**
 * Decide quais linhas de cabeçalho (Paciente/Data/Profissional) entram no
 * laudo — extraída como função pura, sem tocar em pdfkit, porque pdfkit não
 * expõe um jeito simples de inspecionar o que já foi escrito no documento
 * antes de finalizá-lo (`doc.end()`). Isso deixa a regra "profissional
 * responsável só aparece quando presente" testável direto, sem precisar
 * gerar/ler um PDF de verdade pra cada caso.
 */
export function linhasCabecalhoLaudo({ pacienteNome, data, profissionalResponsavel }) {
  const linhas = [`Paciente: ${pacienteNome}`, `Data do atendimento: ${data}`];
  if (profissionalResponsavel) {
    linhas.push(`Profissional responsável: ${profissionalResponsavel}`);
  }
  return linhas;
}

/**
 * Gera o PDF do laudo em memória — nunca salvo em disco/banco. Layout de
 * texto simples (sem identidade visual), conforme o escopo aprovado no
 * spec deste sub-projeto.
 */
export function gerarPdfLaudo(dados) {
  const { observacaoSessao } = dados;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).text(NOME_CLINICA, { align: "center" });
    doc.moveDown(2);

    doc.fontSize(12);
    for (const linha of linhasCabecalhoLaudo(dados)) {
      doc.text(linha);
    }

    doc.moveDown();
    doc.text(observacaoSessao, { align: "justify" });

    doc.end();
  });
}

/**
 * Mesma técnica de linhasCabecalhoLaudo (função pura testável, separada da
 * renderização) — irmã dedicada à guia de convênio porque os campos são
 * diferentes (convênio/carteirinha/valor em vez de observação de sessão).
 * `numeroCarteirinha`/`profissionalResponsavel` omitidos quando ausentes,
 * mesma regra dos Laudos.
 */
export function linhasCorpoGuiaConvenio({
  convenio,
  numeroCarteirinha,
  tipoAtendimento,
  profissionalResponsavel,
  valor,
}) {
  const linhas = [`Convênio: ${convenio}`];
  if (numeroCarteirinha) {
    linhas.push(`Nº da carteirinha: ${numeroCarteirinha}`);
  }
  linhas.push(`Tipo de atendimento: ${tipoAtendimento}`);
  if (profissionalResponsavel) {
    linhas.push(`Profissional responsável: ${profissionalResponsavel}`);
  }
  linhas.push(`Valor: R$ ${formatarMoeda(valor)}`);
  return linhas;
}

/**
 * Gera o PDF da guia de convênio em memória — nunca salvo em disco/banco,
 * sempre montado do zero a partir do pagamento atual (sem histórico de
 * guias como entidade própria, mesma decisão dos Laudos). Quando o
 * pagamento já foi estornado, estampa "GUIA CANCELADA" em destaque antes do
 * corpo — não bloqueia a geração, só deixa visualmente claro que aquela
 * guia não vale mais (ver spec: reaproveita o status de estorno que o
 * Financeiro já tem, sem fluxo/tabela nova).
 */
export function gerarPdfGuiaConvenio(dados) {
  const { numeroGuia, pacienteNome, data, status } = dados;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).text(NOME_CLINICA, { align: "center" });
    doc.moveDown();
    doc.fontSize(14).text(`Guia de convênio nº ${numeroGuia}`, { align: "center" });

    if (status === "estornado") {
      doc.moveDown();
      doc.fontSize(14).fillColor("red").text("GUIA CANCELADA", { align: "center" });
      doc.fillColor("black");
    }

    doc.moveDown(2);
    doc.fontSize(12);
    doc.text(`Paciente: ${pacienteNome}`);
    doc.text(`Data do atendimento: ${data}`);
    for (const linha of linhasCorpoGuiaConvenio(dados)) {
      doc.text(linha);
    }

    doc.end();
  });
}
