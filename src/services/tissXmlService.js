// Versão do padrão TISS/ANS que este gerador segue. Ver
// docs/superpowers/specs/2026-09-04-tiss-eletronico-design.md — estrutura
// escrita manualmente por template string, sem validação contra o XSD
// oficial. Sexo/CNS do paciente e CBO do profissional (migration 035) são
// injetados como recebidos do cadastro/config, sem conversão pra um enum
// ANS específico — sem um XML real aceito por operadora pra validar o
// domínio exato, converter seria inventar dado. Caráter do atendimento
// (eletiva/urgência) não persiste em lugar nenhum: é escolhido na hora de
// gerar o lote, na tela /financeiro/tiss.
const VERSAO_TISS = "3.05.00";
const CODIGO_TABELA_TUSS = "22";

function escaparXml(texto) {
  return String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Campo ausente (null/undefined/vazio) é omitido do XML — nunca vira tag
// vazia nem a string "null". Mesma regra de "nunca inventar dado" já usada
// nos serviços de PDF (laudoPdfService.js, guiaConvenioPdfService.js).
function tagOpcional(nome, valor) {
  if (valor === null || valor === undefined || valor === "") return "";
  return `<${nome}>${escaparXml(valor)}</${nome}>`;
}

function montarGuiaSpSadt(guia) {
  return `
        <guiaSP-SADT>
          <cabecalhoGuia>
            <numeroGuiaPrestador>${escaparXml(guia.numeroGuiaPrestador)}</numeroGuiaPrestador>
          </cabecalhoGuia>
          <dadosBeneficiario>
            ${tagOpcional("numeroCarteira", guia.matriculaConvenio)}
            ${tagOpcional("numeroCarteiraCNS", guia.pacienteCns)}
            ${tagOpcional("sexo", guia.pacienteSexo)}
            <nomeBeneficiario>${escaparXml(guia.pacienteNome)}</nomeBeneficiario>
          </dadosBeneficiario>
          <dadosAtendimento>
            <tipoAtendimento>${escaparXml(guia.tipoAtendimento)}</tipoAtendimento>
            <dataAtendimento>${escaparXml(guia.dataAtendimento)}</dataAtendimento>
            ${tagOpcional("caraterAtendimento", guia.caraterAtendimento)}
          </dadosAtendimento>
          <procedimentosExecutados>
            <procedimento>
              <codigoTabela>${CODIGO_TABELA_TUSS}</codigoTabela>
              <codigoProcedimento>${escaparXml(guia.codigoTuss)}</codigoProcedimento>
              ${tagOpcional("descricaoProcedimento", guia.descricaoTuss)}
              <valorProcedimento>${escaparXml(guia.valor)}</valorProcedimento>
              ${
                guia.cboProfissional
                  ? `<dadosExecutante>${tagOpcional("CBO", guia.cboProfissional)}</dadosExecutante>`
                  : ""
              }
            </procedimento>
          </procedimentosExecutados>
          <valorTotal>
            <valorTotalGeral>${escaparXml(guia.valor)}</valorTotalGeral>
          </valorTotal>
        </guiaSP-SADT>`;
}

/**
 * Monta o XML de um lote de guias SP/SADT — função pura, sem I/O, mesmo
 * padrão dos serviços de PDF (recebe dados já resolvidos pelo model,
 * devolve string pronta pra resposta HTTP).
 */
export function gerarXmlLoteTiss({ dadosPrestador, convenio, guias, numeroLote, dataGeracao }) {
  const guiasXml = guias.map(montarGuiaSpSadt).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<mensagemTISS>
  <cabecalho>
    <identificacaoTransacao>
      <tipoTransacao>ENVIO_LOTE_GUIAS</tipoTransacao>
      <dataRegistroTransacao>${escaparXml(dataGeracao)}</dataRegistroTransacao>
    </identificacaoTransacao>
    <origem>
      <identificacaoPrestador>
        ${tagOpcional("CNES", dadosPrestador?.cnes)}
        ${tagOpcional("razaoSocial", dadosPrestador?.razao_social)}
        ${tagOpcional("CNPJ", dadosPrestador?.cnpj)}
        ${tagOpcional("codigoPrestadorNaOperadora", convenio.codigo_prestador_na_operadora)}
      </identificacaoPrestador>
    </origem>
    <destino>
      <nomeOperadora>${escaparXml(convenio.nome)}</nomeOperadora>
      ${tagOpcional("numeroContrato", convenio.numero_contrato)}
    </destino>
    <Padrao>${VERSAO_TISS}</Padrao>
  </cabecalho>
  <prestadorParaOperadora>
    <loteGuias>
      <numeroLote>${escaparXml(numeroLote)}</numeroLote>
      <guiasTISS>${guiasXml}
      </guiasTISS>
    </loteGuias>
  </prestadorParaOperadora>
</mensagemTISS>
`;
}
