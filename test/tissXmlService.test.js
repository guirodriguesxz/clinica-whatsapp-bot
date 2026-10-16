import { test } from "node:test";
import assert from "node:assert/strict";
import { gerarXmlLoteTiss } from "../src/services/tissXmlService.js";

const DADOS_PRESTADOR = { cnes: "123456", razao_social: "Clínica Exemplo", cnpj: "00.000.000/0001-00" };
const CONVENIO = { nome: "Mar Azul Saúde", codigo_prestador_na_operadora: "PRESTADOR123", numero_contrato: "CT-001" };
const GUIA = {
  numeroGuiaPrestador: "42",
  pacienteNome: "João da Silva",
  matriculaConvenio: "MAT123",
  tipoAtendimento: "fisioterapia",
  dataAtendimento: "2026-09-10",
  codigoTuss: "10101012",
  descricaoTuss: "Sessão de fisioterapia",
  valor: "80.00",
};

test("gerarXmlLoteTiss: inclui versão do padrão, dados do prestador e do convênio", () => {
  const xml = gerarXmlLoteTiss({ dadosPrestador: DADOS_PRESTADOR, convenio: CONVENIO, guias: [GUIA], numeroLote: "5-2026-09-01-2026-09-30", dataGeracao: "2026-09-04" });

  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<Padrao>3\.05\.00<\/Padrao>/);
  assert.match(xml, /<CNES>123456<\/CNES>/);
  assert.match(xml, /<codigoPrestadorNaOperadora>PRESTADOR123<\/codigoPrestadorNaOperadora>/);
  assert.match(xml, /<numeroContrato>CT-001<\/numeroContrato>/);
  assert.match(xml, /<numeroLote>5-2026-09-01-2026-09-30<\/numeroLote>/);
});

test("gerarXmlLoteTiss: monta uma guiaSP-SADT por guia, com procedimento e valor", () => {
  const xml = gerarXmlLoteTiss({ dadosPrestador: DADOS_PRESTADOR, convenio: CONVENIO, guias: [GUIA], numeroLote: "1", dataGeracao: "2026-09-04" });

  assert.match(xml, /<guiaSP-SADT>/);
  assert.match(xml, /<numeroGuiaPrestador>42<\/numeroGuiaPrestador>/);
  assert.match(xml, /<numeroCarteira>MAT123<\/numeroCarteira>/);
  assert.match(xml, /<nomeBeneficiario>João da Silva<\/nomeBeneficiario>/);
  assert.match(xml, /<codigoProcedimento>10101012<\/codigoProcedimento>/);
  assert.match(xml, /<valorProcedimento>80\.00<\/valorProcedimento>/);
});

test("gerarXmlLoteTiss: campo ausente (matrícula null) é omitido, não vira string vazia nem 'null'", () => {
  const guiaSemMatricula = { ...GUIA, matriculaConvenio: null };
  const xml = gerarXmlLoteTiss({ dadosPrestador: DADOS_PRESTADOR, convenio: CONVENIO, guias: [guiaSemMatricula], numeroLote: "1", dataGeracao: "2026-09-04" });

  assert.doesNotMatch(xml, /<numeroCarteira>/);
  assert.doesNotMatch(xml, /null/);
});

test("gerarXmlLoteTiss: escapa caracteres especiais de XML no nome do paciente", () => {
  const guiaComEspecial = { ...GUIA, pacienteNome: 'Maria & "Ana" <Silva>' };
  const xml = gerarXmlLoteTiss({ dadosPrestador: DADOS_PRESTADOR, convenio: CONVENIO, guias: [guiaComEspecial], numeroLote: "1", dataGeracao: "2026-09-04" });

  assert.doesNotMatch(xml, /<Silva>/);
  assert.match(xml, /&amp;/);
  assert.match(xml, /&lt;Silva&gt;/);
});

test("gerarXmlLoteTiss: duas guias geram duas tags guiaSP-SADT", () => {
  const xml = gerarXmlLoteTiss({ dadosPrestador: DADOS_PRESTADOR, convenio: CONVENIO, guias: [GUIA, { ...GUIA, numeroGuiaPrestador: "43" }], numeroLote: "1", dataGeracao: "2026-09-04" });

  const ocorrencias = xml.match(/<guiaSP-SADT>/g) ?? [];
  assert.equal(ocorrencias.length, 2);
});

test("gerarXmlLoteTiss: inclui CNS, sexo do paciente, caráter do atendimento e CBO do executante quando presentes", () => {
  const guiaCompleta = {
    ...GUIA,
    pacienteCns: "700123456789012",
    pacienteSexo: "F",
    caraterAtendimento: "eletiva",
    cboProfissional: "2236-05",
  };
  const xml = gerarXmlLoteTiss({ dadosPrestador: DADOS_PRESTADOR, convenio: CONVENIO, guias: [guiaCompleta], numeroLote: "1", dataGeracao: "2026-09-04" });

  assert.match(xml, /<numeroCarteiraCNS>700123456789012<\/numeroCarteiraCNS>/);
  assert.match(xml, /<sexo>F<\/sexo>/);
  assert.match(xml, /<caraterAtendimento>eletiva<\/caraterAtendimento>/);
  assert.match(xml, /<dadosExecutante><CBO>2236-05<\/CBO><\/dadosExecutante>/);
});

test("gerarXmlLoteTiss: CNS/sexo/caráter/CBO ausentes não geram tags nem 'null'", () => {
  const xml = gerarXmlLoteTiss({ dadosPrestador: DADOS_PRESTADOR, convenio: CONVENIO, guias: [GUIA], numeroLote: "1", dataGeracao: "2026-09-04" });

  assert.doesNotMatch(xml, /<numeroCarteiraCNS>/);
  assert.doesNotMatch(xml, /<sexo>/);
  assert.doesNotMatch(xml, /<caraterAtendimento>/);
  assert.doesNotMatch(xml, /<dadosExecutante>/);
  assert.doesNotMatch(xml, /null/);
});
