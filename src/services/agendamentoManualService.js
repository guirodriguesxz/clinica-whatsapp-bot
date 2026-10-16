import { pool } from "../db/pool.js";
import { registrarMensagem, buscarHistoricoRecente } from "../models/conversaModel.js";
import { detectarAgendamentoCombinado } from "./detectorAgendamentoManualService.js";
import { buscarAgendamentosImportadosConfirmadosFuturos } from "../models/agendamentoImportadoModel.js";
import { cancelarAgendamentoImportado, remarcarAgendamentoImportado } from "../models/agendamentoModel.js";
import { capturarAviso } from "../config/sentry.js";
import dayjs from "../utils/dayjs.js";
import { CLINICA } from "../config/clinica.js";

const REMETENTE_EQUIPE = "equipe";
export const AGENDA_DETECCAO_ATIVA = false;

/**
 * Registra o agendamento combinado manualmente pela equipe numa conversa
 * pausada — sem checar expediente/capacidade (a equipe já sabe o que está
 * fazendo, diferente do bot). Idempotente: não duplica se já existir um
 * registro pro mesmo telefone/data/hora.
 */
export async function criarAgendamentoManual(
  { telefone, nomePaciente, data, hora, tipoAtendimento },
  { query = pool.query.bind(pool) } = {}
) {
  const { rows: existentes } = await query(
    `SELECT id FROM agendamentos_importados WHERE telefone = $1 AND data = $2 AND hora = $3`,
    [telefone, data, hora]
  );
  if (existentes.length > 0) return;

  await query(
    `INSERT INTO agendamentos_importados (telefone, nome, data, hora, tipo_atendimento, atendente)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [telefone, nomePaciente ?? "Paciente", data, hora, tipoAtendimento, "Equipe (WhatsApp)"]
  );
}

/**
 * Cancela o agendamento importado combinado manualmente pela equipe — só age
 * quando há exatamente UMA consulta confirmada e futura pra esse telefone;
 * nenhuma ou mais de uma é ambíguo demais pra arriscar cancelar a errada (a
 * equipe resolve manualmente pelo dashboard nesses casos).
 */
export async function cancelarAgendamentoManual(
  { telefone },
  {
    buscarConfirmados = buscarAgendamentosImportadosConfirmadosFuturos,
    cancelar = cancelarAgendamentoImportado,
  } = {}
) {
  const confirmados = await buscarConfirmados(telefone);
  if (confirmados.length !== 1) return;
  await cancelar(confirmados[0].id);
}

/**
 * Remarca o agendamento importado combinado manualmente pela equipe pra
 * nova data/hora — mesma proteção de ambiguidade de cancelarAgendamentoManual.
 */
export async function remarcarAgendamentoManual(
  { telefone, data, hora },
  {
    buscarConfirmados = buscarAgendamentosImportadosConfirmadosFuturos,
    remarcar = remarcarAgendamentoImportado,
  } = {}
) {
  const confirmados = await buscarConfirmados(telefone);
  if (confirmados.length !== 1) return;
  await remarcar({ id: confirmados[0].id, data, hora });
}

/**
 * Chamado pelo webhookController toda vez que a equipe manda uma mensagem
 * manual numa conversa pausada. Registra a mensagem pro histórico e, em
 * seguida, roda uma checagem via IA pra ver se alguma ação de agendamento
 * (criar, cancelar, remarcar) ficou combinada nessa troca — se sim, aplica
 * no sistema sozinho, sem avisar o paciente (a equipe já está conversando
 * direto com ele).
 */
export async function processarMensagemManualEquipe(
  { pacienteId, telefone, texto, nomePaciente },
  {
    criarAgendamento = criarAgendamentoManual,
    cancelarAgendamento = cancelarAgendamentoManual,
    remarcarAgendamento = remarcarAgendamentoManual,
    deteccaoAtiva = AGENDA_DETECCAO_ATIVA,
  } = {}
) {
  await registrarMensagem({ pacienteId, mensagem: texto, remetente: REMETENTE_EQUIPE });

  // Detecção de agendamento combinado pela equipe DESLIGADA (2026-10-01):
  // a clínica parou de manter a agenda no sistema do bot (agenda fica só no
  // sistema anterior). Com AGENDA_DETECCAO_ATIVA=false a mensagem só vai pro histórico.
  if (!deteccaoAtiva) return;

  try {
    const historico = await buscarHistoricoRecente(pacienteId);
    const agora = dayjs().tz(CLINICA.timezone);
    const dataAtual = agora.format("YYYY-MM-DD");
    const diaSemanaAtual = agora.format("dddd");
    const resultado = await detectarAgendamentoCombinado({ historico, dataAtual, diaSemanaAtual });

    if (resultado.acao === "criar") {
      await criarAgendamento({
        telefone,
        // O nome que a equipe escreveu na conversa ganha do nome do contato
        // do WhatsApp: quem manda mensagem nem sempre é quem vai ser
        // atendido (visto na prática: contato "Sr Luiz" agendando a sessão
        // da paciente Ana, que entrou na agenda como "Paciente").
        nomePaciente: resultado.nomePaciente ?? nomePaciente,
        data: resultado.data,
        hora: resultado.hora,
        tipoAtendimento: resultado.tipoAtendimento,
      });
    } else if (resultado.acao === "cancelar") {
      await cancelarAgendamento({ telefone });
    } else if (resultado.acao === "remarcar") {
      await remarcarAgendamento({ telefone, data: resultado.data, hora: resultado.hora });
    }
  } catch (err) {
    capturarAviso("[agendamentoManualService] Falha ao processar detecção de agendamento manual:", err);
  }
}
