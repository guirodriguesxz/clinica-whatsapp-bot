import { evolutionApi, evolutionInstance } from "../config/evolutionApi.js";
import { enviarImagem } from "./whatsappService.js";
import { capturarErro, capturarAviso } from "../config/sentry.js";
import { pool } from "../db/pool.js";

const TELEFONE_ATENDENTE = process.env.ATENDENTE_HUMANO_TELEFONE;

// O banco (Neon, plano Free) tem cota de horas de computação por mês e
// hiberna quando fica ocioso — mas o job de fotos expiradas roda a cada 15
// min, 24h por dia, e cada SELECT acordava o banco a noite toda e nos fins
// de semana mesmo com a tabela vazia. Esse estado em memória deixa o job
// pular a consulta quando não pode haver foto pendente. Começa em true
// porque pode ter sobrado pendência de antes de um restart; volta pra true
// sempre que uma foto é gravada (registrarFotoPendente). A versão evita
// perder uma foto gravada enquanto o job checava se a tabela estava vazia.
let podeHaverFotoPendente = true;
let versaoFotoPendente = 0;

function marcarFotoPendente() {
  podeHaverFotoPendente = true;
  versaoFotoPendente += 1;
}

/**
 * Busca a foto de encaminhamento pendente do paciente (se houver), já com
 * nome/telefone do cadastro — usado pela notificação de agendamento
 * (criarAgendamento.js) e pelo encaminhamento humano (encaminharHumano.js)
 * pra decidir se anexam a foto na notificação. Não apaga a pendência — só
 * quem consome com sucesso (enviou a mensagem) deve chamar
 * apagarFotoPendente.
 */
export async function buscarFotoPendente(pacienteId) {
  const { rows } = await pool.query(
    `SELECT ep.paciente_id, ep.base64, ep.mimetype, ep.legenda_paciente, ep.criado_em,
            p.nome, p.telefone
     FROM encaminhamentos_pendentes ep
     JOIN pacientes p ON p.id = ep.paciente_id
     WHERE ep.paciente_id = $1`,
    [pacienteId]
  );
  return rows[0] ?? null;
}

export async function apagarFotoPendente(pacienteId) {
  await pool.query(`DELETE FROM encaminhamentos_pendentes WHERE paciente_id = $1`, [pacienteId]);
}

/**
 * Envia uma foto de encaminhamento pendente sozinha para a recepção, no
 * mesmo formato usado hoje quando não há agendamento pra juntar — usado
 * tanto quando a gravação da pendência falha (fallback imediato) quanto
 * pelo job de expiração (enviarFotosPendentesExpiradas).
 */
export async function enviarFotoAvulsaParaRecepcao({ nomePaciente, telefone, base64, mimetype, legendaPaciente }) {
  if (!TELEFONE_ATENDENTE) {
    capturarAviso(
      "[encaminhamentoMedico] ATENDENTE_HUMANO_TELEFONE não configurado — foto não encaminhada."
    );
    return false;
  }

  const legenda = legendaPaciente ? `\nLegenda do paciente: "${legendaPaciente}"` : "";
  try {
    await enviarImagem(TELEFONE_ATENDENTE, {
      base64,
      mimetype,
      caption: `Foto enviada pelo paciente para conferência (pedido médico, comprovante de pagamento, carteirinha etc.).\nPaciente: *${nomePaciente ?? "desconhecido"}* (${telefone})${legenda}`,
    });
    return true;
  } catch (err) {
    const detalhe = err.response?.status
      ? `${err.message} (status ${err.response.status})`
      : err.message;
    capturarErro("[encaminhamentoMedico] Falha ao encaminhar foto para a equipe:", new Error(detalhe));
    return false;
  }
}

/**
 * Fotos pendentes há mais de 15 minutos sem terem sido consumidas por um
 * agendamento nem por um encaminhamento humano — candidatas ao envio
 * avulso do job de expiração.
 */
export async function buscarFotosPendentesExpiradas() {
  const { rows } = await pool.query(
    `SELECT ep.paciente_id, ep.base64, ep.mimetype, ep.legenda_paciente, ep.criado_em,
            p.nome, p.telefone
     FROM encaminhamentos_pendentes ep
     JOIN pacientes p ON p.id = ep.paciente_id
     WHERE ep.criado_em < now() - interval '15 minutes'
     LIMIT 50`
  );
  return rows;
}

/**
 * Job periódico (chamado pelo cron em server.js a cada 15 min): garante
 * que nenhuma foto de encaminhamento se perde quando o paciente manda a
 * foto mas não chega a agendar nem é encaminhado para atendimento humano.
 * Uma falha isolada numa foto não impede as demais de serem processadas.
 */
export async function enviarFotosPendentesExpiradas() {
  if (!podeHaverFotoPendente) return;

  const pendentes = await buscarFotosPendentesExpiradas();
  for (const pendente of pendentes) {
    try {
      const enviado = await enviarFotoAvulsaParaRecepcao({
        nomePaciente: pendente.nome,
        telefone: pendente.telefone,
        base64: pendente.base64,
        mimetype: pendente.mimetype,
        legendaPaciente: pendente.legenda_paciente,
      });
      if (enviado) {
        await apagarFotoPendente(pendente.paciente_id);
      }
    } catch (err) {
      capturarErro("[encaminhamentoMedico] Falha ao processar foto pendente expirada:", err);
    }
  }

  // Só desliga a flag se a tabela ficou vazia E nenhuma foto nova foi
  // gravada durante a checagem. Se ainda houver pendência (ainda não
  // expirou, ou o envio falhou), a flag continua true e o job tenta de novo.
  const versaoAntes = versaoFotoPendente;
  const { rows } = await pool.query(`SELECT 1 FROM encaminhamentos_pendentes LIMIT 1`);
  if (!rows.length && versaoFotoPendente === versaoAntes) {
    podeHaverFotoPendente = false;
  }
}

const LEGENDA_PACIENTE_MAX_CHARS = 300;

// Remove quebras de linha e marcação do WhatsApp (*negrito*, _itálico_,
// ~tachado~, `código`) do texto que o paciente escreveu — evita que uma
// legenda maliciosa ou só muito longa (WhatsApp aceita até ~1024
// caracteres de legenda) quebre o envio da notificação combinada pra
// recepção ou finja um bloco de mensagem que não é dela.
function sanitizarLegendaPaciente(legenda) {
  if (!legenda) return null;
  const limpa = legenda.replace(/[\r\n*_~`]/g, " ").trim();
  return limpa ? limpa.slice(0, LEGENDA_PACIENTE_MAX_CHARS) : null;
}

async function baixarFotoEncaminhamento({ messageKey, imageMessage }) {
  const { data } = await evolutionApi.post(`/chat/getBase64FromMediaMessage/${evolutionInstance}`, {
    message: { key: messageKey },
  });

  const base64 = data?.base64;
  if (!base64) {
    throw new Error("Evolution API não retornou base64 da imagem.");
  }

  return {
    base64,
    mimetype: imageMessage?.mimetype,
    legendaPaciente: sanitizarLegendaPaciente(imageMessage?.caption),
  };
}

/**
 * Grava (ou substitui) a foto de encaminhamento pendente do paciente — no
 * máximo uma por paciente; uma foto nova substitui qualquer pendência
 * anterior, inclusive resetando criado_em (senão a foto nova herdaria o
 * relógio da antiga e poderia expirar cedo demais no job periódico).
 */
export async function registrarFotoPendente({ pacienteId, base64, mimetype, legendaPaciente }) {
  await pool.query(
    `INSERT INTO encaminhamentos_pendentes (paciente_id, base64, mimetype, legenda_paciente, criado_em)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (paciente_id) DO UPDATE
     SET base64 = EXCLUDED.base64, mimetype = EXCLUDED.mimetype,
         legenda_paciente = EXCLUDED.legenda_paciente, criado_em = now()`,
    [pacienteId, base64, mimetype ?? null, legendaPaciente ?? null]
  );
  marcarFotoPendente();
}

/**
 * Handler do fluxo de recebimento da foto de encaminhamento (chamado por
 * webhookController.js): baixa a foto e tenta gravá-la como pendente, pra
 * juntar depois com a notificação de agendamento (criarAgendamento.js) ou
 * de encaminhamento humano (encaminharHumano.js). Se não conseguir gravar
 * (erro de banco), cai pro repasse imediato de hoje — nunca perde o
 * documento por causa de um problema técnico pontual. Retorna um status
 * pro controller decidir a mensagem certa pro paciente.
 * @returns {Promise<"pendente"|"encaminhado"|"falhou">}
 */
export async function processarFotoEncaminhamento({ messageKey, imageMessage, pacienteId, nomePaciente, telefone }) {
  let foto;
  try {
    foto = await baixarFotoEncaminhamento({ messageKey, imageMessage });
  } catch (err) {
    capturarErro("[encaminhamentoMedico] Falha ao baixar a foto de encaminhamento:", err);
    return "falhou";
  }

  // Se já havia uma foto pendente desse paciente (ex: documento com mais de
  // uma página, mandado em mensagens separadas), repassa ela sozinha ANTES
  // de substituir — senão a foto anterior seria apagada sem nunca chegar à
  // recepção.
  try {
    const fotoAnterior = await buscarFotoPendente(pacienteId);
    if (fotoAnterior) {
      await enviarFotoAvulsaParaRecepcao({
        nomePaciente: fotoAnterior.nome,
        telefone: fotoAnterior.telefone,
        base64: fotoAnterior.base64,
        mimetype: fotoAnterior.mimetype,
        legendaPaciente: fotoAnterior.legenda_paciente,
      });
    }
  } catch (err) {
    capturarErro(
      "[encaminhamentoMedico] Falha ao verificar/repassar foto pendente anterior antes de substituir:",
      err
    );
    // Segue mesmo assim — a foto nova ainda precisa ser registrada.
  }

  try {
    await registrarFotoPendente({ pacienteId, ...foto });
    return "pendente";
  } catch (err) {
    capturarErro(
      "[encaminhamentoMedico] Falha ao gravar a foto como pendente — tentando repasse imediato:",
      err
    );
    const enviado = await enviarFotoAvulsaParaRecepcao({ nomePaciente, telefone, ...foto });
    return enviado ? "encaminhado" : "falhou";
  }
}
