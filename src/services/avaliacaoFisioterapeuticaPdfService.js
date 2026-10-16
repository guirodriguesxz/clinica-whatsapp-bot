import PDFDocument from "pdfkit";

const NOME_CLINICA = "Clínica Exemplo — Fisioterapia & Psicologia";

const PERGUNTAS_ANAMNESE = [
  { campo: "estaGravida", rotulo: "Está grávida?" },
  { campo: "possuiMarcapasso", rotulo: "Possui marcapasso?" },
  { campo: "possuiProteseMetalicaImplantes", rotulo: "Possui prótese metálica ou implantes?" },
  { campo: "possuiDoencasCardiacas", rotulo: "Possui doenças cardíacas?" },
  { campo: "possuiHipertensaoArterial", rotulo: "Possui hipertensão arterial?" },
  { campo: "possuiDiabetes", rotulo: "Possui diabetes?" },
  { campo: "possuiEpilepsia", rotulo: "Possui epilepsia?" },
  { campo: "possuiHistoricoCancer", rotulo: "Possui histórico de câncer?" },
  { campo: "medicamentosContinuosQuais", rotulo: "Faz uso de medicamentos contínuos? Quais?" },
  { campo: "cirurgiaQual", rotulo: "Já realizou cirurgia? Qual?" },
  { campo: "cirurgiaQuando", rotulo: "Quando?" },
  { campo: "tempoUltimaCirurgia", rotulo: "Quanto tempo da última cirurgia?" },
  { campo: "dorAtualLocal", rotulo: "Sente dor atualmente? Local" },
  { campo: "dorAtualIntensidade", rotulo: "Intensidade da dor (0-10)" },
  { campo: "limitacoesFuncionaisQuais", rotulo: "Apresenta limitações funcionais? Quais?" },
  { campo: "fisioterapiaAnteriormente", rotulo: "Já realizou fisioterapia anteriormente?" },
];

/**
 * Linhas da anamnese pro PDF — extraída como função pura, mesmo motivo de
 * linhasCabecalhoLaudo em laudoPdfService.js: pdfkit não permite
 * inspecionar o que já foi escrito antes de doc.end(), então isolar a
 * regra "campo vazio não aparece" deixa isso testável sem gerar PDF de
 * verdade a cada caso.
 */
export function linhasAnamnesePdf(dados) {
  return PERGUNTAS_ANAMNESE
    .filter(({ campo }) => dados[campo])
    .map(({ campo, rotulo }) => `${rotulo} ${dados[campo]}`);
}

const CAMPOS_PLANO_TERAPEUTICO = [
  { campo: "objetivosTratamento", rotulo: "Objetivos do tratamento:" },
  { campo: "condutasPropostas", rotulo: "Condutas propostas:" },
];

/**
 * Linhas do plano terapêutico pro PDF — mesma regra e mesmo motivo de
 * linhasAnamnesePdf acima: campo vazio não aparece, e isolar isso numa
 * função pura deixa testável sem gerar PDF de verdade.
 */
export function linhasPlanoTerapeuticoPdf(dados) {
  return CAMPOS_PLANO_TERAPEUTICO
    .filter(({ campo }) => dados[campo])
    .map(({ campo, rotulo }) => `${rotulo} ${dados[campo]}`);
}

/**
 * Gera o PDF da avaliação em memória — nunca salvo em disco/banco, mesmo
 * padrão dos Laudos e do Guia de convênio. Sem identidade visual.
 */
export function gerarPdfAvaliacao(dados) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).text(NOME_CLINICA, { align: "center" });
    doc.moveDown(2);

    doc.fontSize(12);
    doc.text(`Paciente: ${dados.pacienteNome}`);
    doc.text(`Data da avaliação: ${dados.dataAvaliacao}`);
    doc.moveDown();

    doc.fontSize(14).text("Anamnese", { underline: true });
    doc.fontSize(12);
    for (const linha of linhasAnamnesePdf(dados)) {
      doc.text(linha);
    }
    doc.moveDown();

    doc.fontSize(14).text("Plano terapêutico", { underline: true });
    doc.fontSize(12);
    for (const linha of linhasPlanoTerapeuticoPdf(dados)) {
      doc.text(linha);
    }

    doc.end();
  });
}
