// src/services/relatorioFisioterapeuticoDocxService.js
import { readFileSync } from "node:fs";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  HeadingLevel,
  ImageRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  TableLayoutType,
} from "docx";
import { formatarDataExtensa } from "../utils/data.js";
import { paragrafosRelatorioPdf, LOGO_PATH, REGISTRO_CLINICA, LINHAS_ESPECIALIDADES } from "./relatorioFisioterapeuticoPdfService.js";

const CIDADE_CLINICA = "São Paulo";
const SEM_BORDA = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const CELULA_SEM_BORDA = { top: SEM_BORDA, bottom: SEM_BORDA, left: SEM_BORDA, right: SEM_BORDA };
const TABELA_SEM_BORDA = {
  top: SEM_BORDA,
  bottom: SEM_BORDA,
  left: SEM_BORDA,
  right: SEM_BORDA,
  insideHorizontal: SEM_BORDA,
  insideVertical: SEM_BORDA,
};

/**
 * Word real (.docx), editável — mesmo conteúdo do PDF (gerarPdfRelatorio),
 * pra quem precisa ajustar o texto num editor antes de entregar (decisão do
 * usuário, 2026-09-14). Reaproveita paragrafosRelatorioPdf: mesma regra de
 * "campo vazio não aparece" dos dois formatos, um só lugar pra manter.
 */
export async function gerarDocxRelatorio(dados) {
  // Larguras em DXA (não porcentagem): testado com WidthType.PERCENTAGE e a
  // coluna direita saía com largura ~0 (texto quebrando letra por letra) —
  // só com valor fixo em twips + layout FIXED o Word respeita a largura.
  const timbrado = new Table({
    width: { size: 9350, type: WidthType.DXA },
    columnWidths: [2650, 6700],
    layout: TableLayoutType.FIXED,
    borders: TABELA_SEM_BORDA,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 2650, type: WidthType.DXA },
            borders: CELULA_SEM_BORDA,
            children: [
              new Paragraph({ children: [new ImageRun({ data: readFileSync(LOGO_PATH), transformation: { width: 130, height: 82 }, type: "png" })] }),
              new Paragraph({ children: [new TextRun({ text: REGISTRO_CLINICA, size: 14 })] }),
            ],
          }),
          new TableCell({
            width: { size: 6700, type: WidthType.DXA },
            borders: CELULA_SEM_BORDA,
            children: LINHAS_ESPECIALIDADES.map(
              (linha) => new Paragraph({ children: [new TextRun({ text: linha, size: 16 })] })
            ),
          }),
        ],
      }),
    ],
  });

  const paragrafos = [
    new Paragraph({ text: "" }),
    new Paragraph({
      text: "Relatório Fisioterapêutico",
      heading: HeadingLevel.HEADING_2,
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({ text: "" }),
    new Paragraph({ text: `Paciente: ${dados.pacienteNome}` }),
    new Paragraph({ text: "" }),
  ];

  for (const texto of paragrafosRelatorioPdf(dados)) {
    paragrafos.push(new Paragraph({ text: texto, alignment: AlignmentType.JUSTIFIED }));
    paragrafos.push(new Paragraph({ text: "" }));
  }

  paragrafos.push(new Paragraph({ text: "Atenciosamente." }));
  paragrafos.push(new Paragraph({ text: "" }));
  paragrafos.push(new Paragraph({ text: `${CIDADE_CLINICA}, ${formatarDataExtensa(dados.dataRelatorio)}.` }));
  paragrafos.push(new Paragraph({ text: "" }));
  paragrafos.push(new Paragraph({ text: "" }));

  if (dados.assinaturaImagem) {
    paragrafos.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new ImageRun({
            data: dados.assinaturaImagem,
            transformation: { width: 180, height: 70 },
            type: dados.assinaturaMime === "image/jpeg" ? "jpg" : "png",
          }),
        ],
      })
    );
  } else if (dados.profissionalResponsavel) {
    paragrafos.push(
      new Paragraph({ text: "_______________________________________", alignment: AlignmentType.CENTER })
    );
  }
  if (dados.profissionalResponsavel) {
    paragrafos.push(new Paragraph({ text: dados.profissionalResponsavel, alignment: AlignmentType.CENTER }));
  }

  const documento = new Document({ sections: [{ children: [timbrado, ...paragrafos] }] });
  return Packer.toBuffer(documento);
}
