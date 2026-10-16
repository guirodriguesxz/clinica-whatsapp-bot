import { inserirEntradaBaseConhecimento } from "../models/baseConhecimentoModel.js";
import { listarAgendamentos } from "../models/agendamentoModel.js";
import { listarPacientes, retomarAtendimentoAutomatico } from "../models/pacienteModel.js";
import { capturarErro } from "../config/sentry.js";
import { idSeguro } from "../utils/paginacao.js";

export async function criarEntradaBaseConhecimento(req, res) {
  const { pergunta, resposta, categoria } = req.body ?? {};

  if (!pergunta || !resposta) {
    return res.status(400).json({ erro: "pergunta e resposta são obrigatórios." });
  }

  try {
    const entrada = await inserirEntradaBaseConhecimento({ pergunta, resposta, categoria });
    res.status(201).json(entrada);
  } catch (err) {
    capturarErro("[adminController] Erro ao inserir na base de conhecimento:", err);
    res.status(500).json({ erro: "Erro interno ao salvar." });
  }
}

export async function obterAgendamentos(req, res) {
  const { status, limite, offset } = req.query;
  const agendamentos = await listarAgendamentos({ status, limite, offset });
  res.json(agendamentos);
}

export async function obterPacientes(req, res) {
  const { limite, offset } = req.query;
  const pacientes = await listarPacientes({ limite, offset });
  res.json(pacientes);
}

/**
 * Desfaz a pausa automática que acontece quando alguém da equipe responde um
 * paciente manualmente pelo número conectado (ver webhookController.js) —
 * volta a deixar o bot responder normalmente naquela conversa.
 */
export async function retomarAtendimento(req, res) {
  const id = idSeguro(req.params.id);
  if (!id) {
    return res
      .status(404)
      .json({ erro: "Paciente não encontrado ou a conversa não está pausada por atendimento humano." });
  }

  const paciente = await retomarAtendimentoAutomatico(id);
  if (!paciente) {
    return res
      .status(404)
      .json({ erro: "Paciente não encontrado ou a conversa não está pausada por atendimento humano." });
  }

  res.json({ ok: true, paciente });
}
