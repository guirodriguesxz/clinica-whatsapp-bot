// src/services/laudoPdfService.js
import PDFDocument from "pdfkit";

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
