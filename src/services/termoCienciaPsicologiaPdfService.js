import PDFDocument from "pdfkit";
import { LOGO_PATH, REGISTRO_CLINICA, LINHAS_ESPECIALIDADES } from "./relatorioFisioterapeuticoPdfService.js";

const NOME_CLINICA = "CLÍNICA EXEMPLO FISIOTERAPIA LTDA.";
const TITULO = "TERMO DE CIÊNCIA – ATENDIMENTO DE PSICOLOGIA";

/**
 * Parágrafos das regras do termo, na ordem em que aparecem no papel real
 * da clínica — extraída como função pura pelo mesmo motivo das outras
 * "linhas"/"paragrafos" de PDF do projeto (laudoPdfService,
 * relatorioFisioterapeuticoPdfService): testável sem gerar PDF de verdade.
 */
export function paragrafosTermoCienciaPsicologia() {
  return [
    "Meu atendimento possui dia e horário fixos, sendo alterações solicitadas com antecedência mínima de 7 dias e condicionadas à disponibilidade da agenda.",
    "Cancelamentos ou desmarcações deverão ser comunicados com mínimo de 24 horas de antecedência. Ausências sem essa comunicação serão registradas como falta, observadas as regras do plano de saúde, quando aplicável.",
    "2 faltas consecutivas, sem apresentação de atestado ou justificativa cabível, poderão resultar na liberação do horário fixo e retirada da agenda, ficando eventual retorno condicionado à disponibilidade.",
  ];
}

/**
 * Documento genérico (sem dados de paciente/psicólogo) — a recepção
 * imprime e preenche à mão, igual ao modelo físico que a clínica já usa.
 * Papel timbrado igual ao do relatório fisioterapêutico (logo +
 * especialidades + registro), confirmado com o usuário em 2026-09-17.
 */
export function gerarPdfTermoCienciaPsicologia() {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const topoTimbrado = doc.y;
    doc.image(LOGO_PATH, 50, topoTimbrado, { width: 130 });
    doc.fontSize(8).text(REGISTRO_CLINICA, 50, topoTimbrado + 78);
    doc.fontSize(9);
    let yEspecialidades = topoTimbrado + 5;
    for (const linha of LINHAS_ESPECIALIDADES) {
      doc.text(linha, 210, yEspecialidades);
      yEspecialidades += 13;
    }
    doc.y = Math.max(topoTimbrado + 95, yEspecialidades);
    doc.x = 50;
    doc.moveDown(1.5);

    doc.fontSize(9).text(NOME_CLINICA);
    doc.moveDown(1);
    doc.fontSize(13).text(TITULO, { align: "center", underline: true });
    doc.moveDown(1.5);

    doc.fontSize(11);
    doc.text("Declaro estar ciente de que:");
    doc.moveDown();

    for (const paragrafo of paragrafosTermoCienciaPsicologia()) {
      doc.text(`•  ${paragrafo}`, { align: "justify" });
      doc.moveDown();
    }

    doc.moveDown();
    doc.text("Declaro ter lido, compreendido e estar de acordo com as orientações acima.");
    doc.moveDown(2);

    doc.text("Paciente: _______________________________________________");
    doc.moveDown(1.5);
    doc.text("Data: _____ / _____ / _____");
    doc.moveDown(1.5);
    doc.text("Assinatura: _______________________________________________");

    doc.end();
  });
}
