// src/services/guiaConvenioPdfService.js
import PDFDocument from "pdfkit";

const NOME_CLINICA = "Clínica Exemplo — Fisioterapia & Psicologia";

/**
 * Linhas de cabeçalho da guia de convênio — função pura, mesmo motivo de
 * linhasCabecalhoLaudo em laudoPdfService.js: pdfkit não expõe um jeito
 * simples de inspecionar o que já foi escrito antes de doc.end(), então
 * extrair isso deixa a regra "campo ausente só não aparece" testável sem
 * gerar/ler um PDF de verdade a cada caso.
 */
export function linhasGuiaConvenio(dados) {
  const {
    pacienteNome,
    convenio,
    matriculaConvenio,
    tipoAtendimento,
    dataAtendimento,
    valor,
    profissionalResponsavel,
    numeroGuia,
  } = dados;

  const linhas = [`Guia nº ${numeroGuia}`, `Paciente: ${pacienteNome}`];
  if (convenio) linhas.push(`Convênio: ${convenio}`);
  if (matriculaConvenio) linhas.push(`Matrícula: ${matriculaConvenio}`);
  linhas.push(`Tipo de atendimento: ${tipoAtendimento}`);
  linhas.push(`Data do atendimento: ${dataAtendimento}`);
  linhas.push(`Valor: R$ ${valor}`);
  if (profissionalResponsavel) linhas.push(`Profissional responsável: ${profissionalResponsavel}`);

  return linhas;
}

/**
 * Gera o PDF da guia em memória — nunca salvo em disco/banco, mesma
 * decisão dos Laudos. Estampa "GUIA CANCELADA" com destaque quando o
 * pagamento já tem um estorno vinculado — sem bloquear a geração.
 *
 * Tamanho A6 (recibo/comprovante) em vez do A4 herdado do laudo — a guia
 * é curta por natureza (uma dúzia de linhas) e é impressa/entregue como
 * comprovante avulso, não como documento de página cheia.
 */
export function gerarPdfGuiaConvenio(dados) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A6", margin: 28 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc
      .rect(10, 10, doc.page.width - 20, doc.page.height - 20)
      .lineWidth(0.75)
      .strokeColor("#999999")
      .stroke();

    doc.font("Helvetica-Bold").fontSize(11).fillColor("black").text(NOME_CLINICA, { align: "center" });
    doc.moveDown(0.5);
    doc
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .lineWidth(0.5)
      .strokeColor("#333333")
      .stroke();
    doc.moveDown(0.75);

    if (dados.cancelada) {
      doc.font("Helvetica-Bold").fontSize(11).fillColor("red").text("GUIA CANCELADA", { align: "center" });
      doc.fillColor("black");
      doc.moveDown(0.5);
    }

    doc.font("Helvetica").fontSize(9);
    for (const linha of linhasGuiaConvenio(dados)) {
      doc.text(linha);
      doc.moveDown(0.3);
    }

    doc.end();
  });
}
