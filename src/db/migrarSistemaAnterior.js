// src/db/migrarSistemaAnterior.js
// Migra dados legados do sistema de agenda anterior (exports Agenda_Manha/Tarde_DD-MM-YYYY.xml)
// pra pacientes/agendamentos_importados. Só faz INSERT/UPDATE direto via
// pool — nunca chama aiService/chatService/webhook/calendarService (ver
// spec, "Isolamento do bot").
//
// Uso: node src/db/migrarSistemaAnterior.js [--dir CAMINHO] [--apply]
// Sem --apply: dry-run, só mostra o relatório, nada é gravado.

import "dotenv/config";
import { importarDiretorio } from "../services/importacaoLegadoService.js";
import { pool } from "./pool.js";

const args = process.argv.slice(2);
const aplicar = args.includes("--apply");
const indiceDir = args.indexOf("--dir");
const diretorio = indiceDir !== -1 ? args[indiceDir + 1] : `${process.env.HOME}/Downloads`;

// Quando o campo Tipo do sistema de agenda anterior traz o sufixo "OK" (compareceu), a
// importação registra a presença automaticamente em registros_atendimento —
// exige um usuário do dashboard pra atribuir o registro (registrado_por é
// NOT NULL). Bruno (id 5) é o usuário usado pra isso desde 2026-09-11
// (decisão do Guilherme). Override via --usuario-presenca-id se precisar.
const indiceUsuarioPresenca = args.indexOf("--usuario-presenca-id");
const usuarioPresencaId =
  indiceUsuarioPresenca !== -1 ? Number(args[indiceUsuarioPresenca + 1]) : 5;

const relatorio = await importarDiretorio(diretorio, { aplicar, usuarioPresencaId });

console.log(
  aplicar ? "=== IMPORTAÇÃO APLICADA ===" : "=== DRY-RUN (nada foi gravado — use --apply pra gravar de verdade) ==="
);
console.log(`Diretório: ${diretorio}`);
console.log(`Pacientes novos: ${relatorio.pacientesNovos}`);
console.log(`Pacientes atualizados (CPF/nascimento preenchido): ${relatorio.pacientesAtualizados}`);
console.log(`Agendamentos novos: ${relatorio.agendamentosNovos}`);
console.log(`Agendamentos já existentes (ignorados): ${relatorio.agendamentosJaExistentes}`);
console.log(`Presenças com Tipo "OK" no export (compareceu): ${relatorio.presencasDetectadas}`);
console.log(`Presenças efetivamente registradas: ${relatorio.presencasRegistradas}`);
console.log(`Divergências (não gravadas): ${relatorio.divergencias.length}`);
for (const divergencia of relatorio.divergencias) {
  console.log(`  - ${divergencia.nome} (${divergencia.arquivo}): ${divergencia.motivo}`);
}
console.log(`Avisos (gravadas, mas revisar): ${relatorio.avisos.length}`);
for (const aviso of relatorio.avisos) {
  console.log(`  - ${aviso.nome} (${aviso.arquivo}): ${aviso.motivo}`);
}

await pool.end();
