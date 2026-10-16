import PDFDocument from "pdfkit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatarDataExtensa } from "../utils/data.js";

const CIDADE_CLINICA = "São Paulo";

// Papel timbrado (logo + especialidades + registro), tirado do modelo físico
// que a clínica já usa — ver docs/superpowers/specs (se houver) ou pedir pro
// usuário se precisar confirmar de novo. LOGO_PATH aponta pro mesmo arquivo
// já usado no dashboard (public/img/logo-clinica-exemplo.png), pra não duplicar
// o asset.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LOGO_PATH = path.join(__dirname, "../../public/img/logo-clinica-exemplo.png");
export const REGISTRO_CLINICA = "DRF 10094-SP";
export const LINHAS_ESPECIALIDADES = [
  "• Fisioterapia Ortopédica • Neurológica",
  "• Reumatológica • Respiratória • Acupuntura",
  "• Estética (Drenagem linfática)",
  "• Psicologia • Fonoaudiologia",
];

/**
 * Parágrafos do corpo do relatório, na ordem em que aparecem no papel —
 * extraída como função pura pelo mesmo motivo de linhasCabecalhoLaudo
 * (laudoPdfService.js) e linhasAnamnesePdf (avaliacaoFisioterapeuticaPdfService.js):
 * pdfkit não permite inspecionar o que já foi escrito antes de doc.end(),
 * então isolar a regra "campo vazio não aparece" deixa isso testável sem
 * gerar PDF de verdade a cada caso.
 */
export function paragrafosRelatorioPdf(dados) {
  return [dados.diagnosticoMotivo, dados.condutaEvolucao, dados.consideracoesFinais].filter(Boolean);
}

/**
 * Gera o PDF do relatório em memória — nunca salvo em disco/banco, mesmo
 * padrão dos Laudos e da Ficha de avaliação. Papel timbrado (logo +
 * especialidades + registro) igual ao modelo físico que a clínica usa,
 * confirmado com o usuário em 2026-09-16.
 */
export function gerarPdfRelatorio(dados) {
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

    doc.fontSize(14).text("Relatório Fisioterapêutico", { align: "center", underline: true });
    doc.moveDown(1.5);

    doc.fontSize(12);
    doc.text(`Paciente: ${dados.pacienteNome}`);
    doc.moveDown();

    for (const paragrafo of paragrafosRelatorioPdf(dados)) {
      doc.text(paragrafo, { align: "justify" });
      doc.moveDown();
    }

    doc.moveDown();
    doc.text("Atenciosamente.");
    doc.moveDown(2);

    doc.text(`${CIDADE_CLINICA}, ${formatarDataExtensa(dados.dataRelatorio)}.`);
    doc.moveDown(3);

    let assinaturaEmbutida = false;
    if (dados.assinaturaImagem) {
      try {
        doc.image(dados.assinaturaImagem, { fit: [180, 70], align: "center" });
        doc.moveDown(0.5);
        assinaturaEmbutida = true;
      } catch {
        // Imagem corrompida/inválida apesar da validação no upload — cai
        // no comportamento de linha em branco em vez de quebrar a geração
        // do relatório inteiro.
      }
    }
    if (!assinaturaEmbutida && dados.profissionalResponsavel) {
      doc.text("_______________________________________", { align: "center" });
    }
    if (dados.profissionalResponsavel) {
      doc.text(dados.profissionalResponsavel, { align: "center" });
    }

    doc.end();
  });
}
