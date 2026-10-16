// src/db/importarExcelHistorico.js
// Importa o relatório histórico de 3 meses do sistema de agenda anterior (Excel .xlsx,
// sem telefone/CPF/atendente — ver spec
// docs/superpowers/specs/2026-09-01-importacao-excel-historico-3meses-design.md).
// Só faz INSERT/UPDATE/SELECT direto via pool — nunca chama aiService/
// chatService/webhook/calendarService.
//
// Script 1 (gerar planilha de revisão pra quem não tem match único de nome,
// sempre dry-run):
//   node src/db/importarExcelHistorico.js --arquivo <relatorio.xlsx>
//
// Script 2 (aplicar de verdade — auto-vínculo, e opcionalmente a planilha
// já revisada pela recepção):
//   node src/db/importarExcelHistorico.js --arquivo <relatorio.xlsx> --aplicar
//     [--planilha-revisada <revisao-preenchida.xlsx>]

import "dotenv/config";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parsearArquivoExcel,
  buscarTodosPacientes,
  decidirLinha,
  aplicarLinhaResolvida,
} from "../services/importacaoExcelHistoricoService.js";
import { gerarPlanilhaRevisao, aplicarPlanilhaRevisada } from "../services/planilhaRevisaoService.js";
import { buscarUsuarioPorNomeUsuario } from "../models/usuarioModel.js";
import { pool } from "./pool.js";

// Login por nome de usuário (não e-mail) desde a feature de acesso e
// permissões — o usuário genérico "Importação" precisa existir com esse
// nome de usuário antes de rodar com --aplicar (ver checklist do Task 8).
const NOME_USUARIO_IMPORTACAO = "importacao";

const args = process.argv.slice(2);
const aplicar = args.includes("--aplicar");
const indiceArquivo = args.indexOf("--arquivo");
const arquivo = indiceArquivo !== -1 ? args[indiceArquivo + 1] : null;
const indicePlanilha = args.indexOf("--planilha-revisada");
const planilhaRevisada = indicePlanilha !== -1 ? args[indicePlanilha + 1] : null;

if (!arquivo) {
  console.error(
    "Uso: node src/db/importarExcelHistorico.js --arquivo <relatorio.xlsx> [--aplicar] [--planilha-revisada <arquivo>]"
  );
  process.exit(1);
}

let usuarioImportacaoId = null;
if (aplicar) {
  const usuario = await buscarUsuarioPorNomeUsuario(NOME_USUARIO_IMPORTACAO);
  if (!usuario) {
    console.error(
      `Usuário genérico "${NOME_USUARIO_IMPORTACAO}" não encontrado. Crie antes com:\n` +
        `node src/db/criar-primeiro-usuario.js "Importação" ${NOME_USUARIO_IMPORTACAO}\n` +
        `(papel e senha são pedidos interativamente pelo próprio script)`
    );
    process.exit(1);
  }
  usuarioImportacaoId = usuario.id;
}

const linhas = await parsearArquivoExcel(arquivo);
const pacientes = await buscarTodosPacientes();

const relatorio = {
  agendamentosNovos: 0,
  agendamentosJaExistentes: 0,
  presencasRegistradas: 0,
  presencasNaoRegistradas: [],
  divergencias: [],
  pendentesRevisao: [],
};

for (const linha of linhas) {
  const decisao = decidirLinha(linha, pacientes);

  if (decisao.tipo === "divergencia") {
    relatorio.divergencias.push({ nome: linha.nome, motivo: decisao.motivo });
    continue;
  }

  if (decisao.tipo === "revisao") {
    relatorio.pendentesRevisao.push({ linha: decisao.linha, candidatos: decisao.candidatos });
    continue;
  }

  const { eventos } = await aplicarLinhaResolvida(
    { linha: decisao.linha, telefone: decisao.paciente.telefone, usuarioImportacaoId },
    { aplicar }
  );
  for (const evento of eventos) {
    if (evento.tipo === "agendamento_novo") relatorio.agendamentosNovos++;
    else if (evento.tipo === "agendamento_ja_existe") relatorio.agendamentosJaExistentes++;
    else if (evento.tipo === "presenca_registrada") relatorio.presencasRegistradas++;
    else if (evento.tipo === "presenca_nao_registrada") {
      relatorio.presencasNaoRegistradas.push({ nome: decisao.linha.nome, motivo: evento.motivo });
    }
  }
}

const caminhoPlanilhaPendente = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "planilha-revisao-pendente.xlsx"
);

if (relatorio.pendentesRevisao.length > 0) {
  // decidirLinha() não sabe nada sobre uma planilha-revisada já aplicada —
  // homônimos/nomes sem match continuam aparecendo aqui em toda execução,
  // então uma segunda rodada (--aplicar --planilha-revisada apontando pro
  // MESMO arquivo que acabou de ser gerado e preenchido pela recepção)
  // sempre teria pendências de novo. Gerar de novo nesse caso apagaria as
  // decisões que acabaram de ser lidas por aplicarPlanilhaRevisada logo
  // abaixo, silenciosamente. Só pula a escrita quando é exatamente esse
  // arquivo — outra planilha de saída não tem esse risco.
  if (planilhaRevisada && resolve(planilhaRevisada) === resolve(caminhoPlanilhaPendente)) {
    console.log(
      `Aviso: ainda há ${relatorio.pendentesRevisao.length} pendência(s) de revisão, mas a planilha não foi regravada porque o caminho de saída é o mesmo arquivo passado em --planilha-revisada — regravar apagaria as decisões que acabaram de ser lidas.`
    );
  } else {
    await gerarPlanilhaRevisao(relatorio.pendentesRevisao, caminhoPlanilhaPendente);
    console.log(`Planilha de revisão gerada em: ${caminhoPlanilhaPendente}`);
  }
}

let resultadoPlanilhaAplicada = null;
if (aplicar && planilhaRevisada) {
  resultadoPlanilhaAplicada = await aplicarPlanilhaRevisada(planilhaRevisada, { aplicar, usuarioImportacaoId });
}

console.log(
  aplicar ? "=== IMPORTAÇÃO APLICADA ===" : "=== DRY-RUN (nada foi gravado — use --aplicar pra gravar de verdade) ==="
);
console.log(`Arquivo: ${arquivo}`);
console.log(`Agendamentos novos (auto-vínculo): ${relatorio.agendamentosNovos}`);
console.log(`Agendamentos já existentes: ${relatorio.agendamentosJaExistentes}`);
console.log(`Registros de presença gravados: ${relatorio.presencasRegistradas}`);
console.log(`Registros de presença NÃO gravados: ${relatorio.presencasNaoRegistradas.length}`);
for (const naoRegistrada of relatorio.presencasNaoRegistradas) {
  console.log(`  - ${naoRegistrada.nome}: ${naoRegistrada.motivo}`);
}
console.log(`Divergências (data/hora inválida): ${relatorio.divergencias.length}`);
for (const divergencia of relatorio.divergencias) {
  console.log(`  - ${divergencia.nome}: ${divergencia.motivo}`);
}
console.log(`Pendentes de revisão manual: ${relatorio.pendentesRevisao.length}`);
if (resultadoPlanilhaAplicada) {
  console.log(`--- Planilha revisada aplicada ---`);
  console.log(`Eventos: ${resultadoPlanilhaAplicada.eventos.length}`);
  console.log(`Não importadas: ${resultadoPlanilhaAplicada.naoImportadas.length}`);
  for (const naoImportada of resultadoPlanilhaAplicada.naoImportadas) {
    console.log(`  - ${naoImportada.nome}: ${naoImportada.motivo}`);
  }
}

await pool.end();
