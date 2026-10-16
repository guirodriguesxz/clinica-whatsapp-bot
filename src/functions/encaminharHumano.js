import { enviarMensagem } from "../services/whatsappService.js";
import { encontrarOuCriarPaciente } from "../models/pacienteModel.js";
import {
  buscarFotoPendente,
  apagarFotoPendente,
  enviarFotoAvulsaParaRecepcao,
} from "../services/encaminhamentoMedicoService.js";
import { criarSugestaoConhecimento } from "../models/sugestaoConhecimentoModel.js";
import { capturarErro, capturarAviso } from "../config/sentry.js";

const TELEFONE_ATENDENTE = process.env.ATENDENTE_HUMANO_TELEFONE;

const INSTRUCAO_FALLBACK =
  "Notificação automática à equipe está indisponível no momento. Peça ao paciente para ligar diretamente para a clínica.";

// Prefixo visual por categoria, pra recepção triar de relance sem precisar
// ler o motivo inteiro de cada encaminhamento (rotina vs. algo mais urgente).
const TAG_POR_CATEGORIA = {
  psicologia: "🧠 PSICOLOGIA",
  convenio: "📄 CONVÊNIO",
  urgente: "⚠️ URGENTE",
  erro_tecnico: "🔧 ERRO TÉCNICO",
  agendamento_fisioterapia: "📅 AGENDAMENTO",
  outro: "❓ OUTRO",
};

// Paciente costuma mandar várias mensagens curtas seguidas e o modelo chama
// encaminhar_humano em cada uma — a equipe recebia o mesmo aviso repetido
// (caso real 2026-10-01: 4 avisos em 1 minuto, 3 como URGENTE, pra uma
// única falta). Dentro dessa janela, um novo encaminhamento do mesmo
// telefone vira só um "complemento", sem a tag de categoria. Fica em
// memória: um restart só faz o próximo aviso sair completo, o que é seguro.
const JANELA_COMPLEMENTO_MS = 30 * 60 * 1000;
const ultimoEncaminhamentoPorTelefone = new Map();

export function limparEncaminhamentosRecentes() {
  ultimoEncaminhamentoPorTelefone.clear();
}

/**
 * Handler da function encaminhar_humano. Notifica a equipe da clínica no
 * WhatsApp interno com o motivo e o contato do paciente. Não depende de
 * banco pra essa notificação principal, por isso ela já sai pronta
 * na etapa 4. Também repassa, se houver, a foto de encaminhamento médico
 * que o paciente tenha mandado antes de ser encaminhado — não faz sentido
 * esperar o timeout do job de expiração já que esse caminho não vai gerar
 * agendamento pelo bot.
 */
export async function encaminharHumano(
  { motivo, categoria },
  { telefone, nomeContato },
  {
    resolverPaciente = encontrarOuCriarPaciente,
    buscarFoto = buscarFotoPendente,
    apagarFoto = apagarFotoPendente,
    enviarFotoAvulsa = enviarFotoAvulsaParaRecepcao,
    criarSugestao = criarSugestaoConhecimento,
    agora = Date.now,
  } = {}
) {
  if (!TELEFONE_ATENDENTE) {
    capturarAviso(
      "[encaminharHumano] ATENDENTE_HUMANO_TELEFONE não configurado — encaminhamento não notificado."
    );
    return { encaminhado: false, instrucao: INSTRUCAO_FALLBACK };
  }

  const tag = TAG_POR_CATEGORIA[categoria] ?? TAG_POR_CATEGORIA.outro;
  const ultimo = ultimoEncaminhamentoPorTelefone.get(telefone);
  const ehComplemento = ultimo !== undefined && agora() - ultimo < JANELA_COMPLEMENTO_MS;
  const texto = ehComplemento
    ? `➕ COMPLEMENTO\nPaciente: *${nomeContato ?? "desconhecido"}* (${telefone})\n${motivo}`
    : `${tag}\nPaciente: *${nomeContato ?? "desconhecido"}* (${telefone})\nMotivo: ${motivo}`;

  try {
    await enviarMensagem(TELEFONE_ATENDENTE, texto);
    ultimoEncaminhamentoPorTelefone.set(telefone, agora());
  } catch (err) {
    // Não deixa a falha do canal de notificação (Evolution API fora do ar,
    // instabilidade de rede etc.) derrubar quem chamou essa function — isso
    // inclui o fallback de "OpenAI sem créditos" do aiService, que já está
    // lidando com uma indisponibilidade e não pode quebrar em cascata.
    capturarErro("[encaminharHumano] Falha ao notificar a equipe por WhatsApp:", err);
    return { encaminhado: false, instrucao: INSTRUCAO_FALLBACK };
  }

  // "outro" é a única categoria que representa de fato uma lacuna na base de
  // conhecimento (as demais — psicologia/convenio/urgente/
  // agendamento_fisioterapia — são encaminhamentos operacionais de rotina,
  // não dúvida sem resposta) — só nesse caso vale a pena registrar a
  // pergunta como candidata a virar entrada nova, pra alguém da equipe
  // revisar depois em /sugestoes-conhecimento. agendamento_fisioterapia foi
  // separado de "outro" porque agendar/cancelar/remarcar Fisioterapia
  // (sempre encaminhado pra equipe, ver systemPrompt.js) estava inundando a
  // tela de sugestões com pedidos rotineiros, não lacunas de conhecimento
  // reais (achado 2026-09-14: 22 sugestões acumuladas, nenhuma era de fato
  // uma pergunta sem resposta).
  if (categoria === "outro" && !ehComplemento) {
    try {
      await criarSugestao({ pergunta: motivo, telefone, nome: nomeContato });
    } catch (err) {
      capturarErro("[encaminharHumano] Falha ao registrar sugestão de conhecimento:", err);
    }
  }

  try {
    const paciente = await resolverPaciente({ nome: nomeContato, telefone });
    const fotoPendente = await buscarFoto(paciente.id);
    if (fotoPendente) {
      const enviado = await enviarFotoAvulsa({
        nomePaciente: fotoPendente.nome,
        telefone: fotoPendente.telefone,
        base64: fotoPendente.base64,
        mimetype: fotoPendente.mimetype,
        legendaPaciente: fotoPendente.legenda_paciente,
      });
      if (enviado) {
        await apagarFoto(paciente.id);
      }
    }
  } catch (err) {
    capturarErro(
      "[encaminharHumano] Falha ao repassar foto de encaminhamento pendente junto com o encaminhamento humano:",
      err
    );
    // Não bloqueia o retorno — a notificação principal já foi enviada; se a
    // foto continuar pendente, o job de expiração (server.js) acaba
    // enviando ela sozinha depois.
  }

  return { encaminhado: true };
}
