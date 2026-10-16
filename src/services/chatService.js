import dayjs from "../utils/dayjs.js";
import { gerarResposta } from "./aiService.js";
import { functionHandlers } from "../functions/index.js";
import { enviarMensagem } from "./whatsappService.js";
import { formatarParaWhatsapp } from "../utils/formatacaoWhatsapp.js";
import { buildSystemPrompt } from "../prompts/systemPrompt.js";
import { ehFeriado } from "../utils/feriados.js";
import { CLINICA, TELEFONES_SEM_ATENDIMENTO_AUTOMATICO } from "../config/clinica.js";
import {
  encontrarOuCriarPaciente,
  atualizarEtapaPaciente,
  buscarPacientePorId,
} from "../models/pacienteModel.js";
import {
  registrarMensagem,
  existeMensagemPacienteApos,
  buscarHistoricoRecente,
  buscarTimestampUltimaMensagemEquipe,
} from "../models/conversaModel.js";
import {
  telefoneJaTemConsultaNaClinica,
} from "../models/agendamentoImportadoModel.js";
import { ehMensagemSoConfirmacao, ehSoSaudacao } from "../utils/confirmacao.js";
import { capturarAviso, capturarErro } from "../config/sentry.js";

const REMETENTE_PACIENTE = "paciente";
const REMETENTE_BOT = "bot";
const REMETENTE_EQUIPE = "equipe";

// Espera antes de mandar a resposta da IA pelo WhatsApp de verdade — resposta
// instantânea demais soa robótico. A mensagem já entra no histórico (ver
// abaixo) antes desse atraso, pra uma mensagem seguinte do paciente dentro
// desses 60s continuar vendo o contexto certo, mesmo que o envio real ainda
// não tenha saído.
const ATRASO_RESPOSTA_IA_MS = 60_000;

// Etapa marcada pelo webhookController quando alguém da equipe manda uma
// mensagem manual pro paciente (fromMe) — o bot para de responder
// automaticamente nessa conversa, pra não atropelar quem já está
// atendendo direto pelo WhatsApp. Mas essa pausa não é eterna: ver
// LIMITE_PAUSA_ATENDIMENTO_HUMANO_HORAS abaixo.
export const PAUSADO_ATENDIMENTO_HUMANO = "pausado_atendimento_humano";

// Se a equipe pausar a IA num paciente (mensagem manual) e depois não
// mandar mais nenhuma mensagem manual pra ele por esse tempo, a IA retoma
// sozinha — sem isso, uma única mensagem manual isolada (ex: um "bom dia"
// pontual) deixava o paciente órfão pra sempre caso a equipe não desse
// continuidade (visto no caso real de um paciente, pausado dia 14/09 e
// sem nenhuma resposta, nem da IA nem da equipe, até dias depois).
const LIMITE_PAUSA_ATENDIMENTO_HUMANO_HORAS = 2;

// Mensagens mais antigas que isso não vão como histórico pro modelo — só o
// resumo "paciente recorrente" (montarHistoricoResumo). Conversa antiga
// costuma ser a equipe agendando na mão ("me passa o nome completo..."), e
// como chega pro modelo com role "assistant" o gpt-4o-mini imita esse padrão
// em vez de encaminhar (caso real 2026-10-01: paciente de 22/09 pediu horário
// novo e o bot pediu nome e idade em vez de encaminhar — 0/5 com histórico,
// 3/4 sem).
const JANELA_HISTORICO_MODELO_HORAS = 6;

// Depois que o bot encaminha o paciente pra equipe, por esse tempo ele só
// responde pergunta objetiva sobre a clínica (endereço, convênio, horário de
// funcionamento etc.) e fica em silêncio no resto — a equipe lê tudo direto
// pelo WhatsApp (ver modoPosEncaminhamento em systemPrompt.js). Responder cada detalhe complementar era onde o modelo mais
// errava: repetia "já avisei a equipe" a cada mensagem, ou interpretava
// errado e encaminhava um pedido que o paciente não fez (casos reais
// 2026-10-01: um paciente recebeu 4 "Anotado, já avisei a equipe" seguidos;
// Marta disse "marquei segunda" e o bot avisou que ela ia faltar). Passado
// esse tempo sem resposta da equipe, a IA volta a responder normalmente.
const SILENCIO_APOS_ENCAMINHAR_HORAS = 2;

// Só o prompt não bastou: em produção (2026-10-02, dois pacientes) o modelo
// ignorou o MODO PÓS-ENCAMINHAMENTO e seguiu mandando "Anotado! Já avisei a
// equipe..." a cada mensagem. Nesse modo, o código descarta qualquer resposta
// que fale da equipe/encaminhamento ou que encaminhe de novo — resposta
// objetiva sobre a clínica (endereço, convênio...) não cita a equipe e passa.
const RESPOSTA_SOBRE_ENCAMINHAMENTO = /\bequipe\b|\bavisei\b|encaminh|anotado/i;

// Nesse modo, só pergunta (com "?") pode receber resposta: o filtro acima não
// pegava conversa fiada ("tudo bem também" → "Perfeito! Se precisar de algo
// mais...") e a recepção, já respondendo, via o bot se metendo (caso real
// 2026-10-05, Ingrid). Também não há mais confirmação de complemento — a
// recepção reclamou dela em duas conversas no mesmo dia em que entrou.

// Paciente da casa não responde de novo "Fisioterapia ou Psicologia?" nem a
// idade. Só a regra no prompt não bastou: com ela já em produção, o
// gpt-4o-mini perguntou o tipo pra Bia (47 mensagens anteriores, 2026-10-05)
// — reproduzido na API, 6 de 8 respostas perguntavam. Quando isso acontece, o
// código pede a resposta de novo, uma vez, com o aviso abaixo no prompt.
// Resposta que pede o nome é o caso "pra outra pessoa" (filho, mãe), em que
// perguntar a idade é o certo.
const PERGUNTA_TIPO_OU_IDADE =
  /fisioterapia ou psicologia|psicologia ou fisioterapia|\bidade\b|quantos anos/i;

export function precisaRefazerRespostaRecorrente({ recorrente, textoResposta, functionsChamadas }) {
  return (
    recorrente &&
    !functionsChamadas.includes("encaminhar_humano") &&
    PERGUNTA_TIPO_OU_IDADE.test(textoResposta || "") &&
    !/\bnome\b/i.test(textoResposta)
  );
}

// A regra "nunca informe valores" está no prompt, mas em produção (2026-10-06,
// Everton, paciente de convênio) o modelo despejou "R$ 70" e "R$ 600" da base
// de conhecimento. Valor em R$ na resposta nunca vai pro paciente: o código pede
// de novo uma vez e, se vazar de novo, encaminha pra equipe com texto fixo.
const VALOR_EM_REAIS = /R\$\s*\d/i;

export function respostaVazaValores(textoResposta) {
  return VALOR_EM_REAIS.test(textoResposta || "");
}

export const AVISO_SEM_VALORES = `

CORREÇÃO OBRIGATÓRIA: sua resposta anterior citou valores em R$. NUNCA informe valores, preços, pacotes ou formas de pagamento. Responda sem nenhum valor e, se o paciente perguntou isso, chame encaminhar_humano avisando que ele quer saber sobre valores/condições.`;

// Paciente que manda várias mensagens seguidas ("Oiee", "boa tarde", "td bem?",
// "não vou conseguir ir") recebia uma resposta pra cada saudação — e como o
// aviso de falta sai na hora e a saudação só após os 60s, a saudação chegava
// DEPOIS dele, fora de ordem (casos reais 2026-10-07, pacientes 461 e 281).
// No envio atrasado, saudação solta não sai se já chegou mensagem mais nova.
const PALAVRAS_DE_SAUDACAO = new Set([
  "oi", "oii", "oiii", "oie", "oiee", "oiiee", "ola", "olaa", "opa", "bom", "boa", "dia", "diaa",
  "tarde", "noite", "tudo", "td", "bem", "certo", "tranquilo", "e", "ai", "voce", "vc", "como",
  "vai", "esta", "ta", "na", "paz", "de", "deus",
]);

export function ehSaudacaoSimples(texto) {
  const tokens = String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return tokens.length > 0 && tokens.length <= 8 && tokens.every((t) => PALAVRAS_DE_SAUDACAO.has(t));
}

const MENSAGEM_VALORES_ENCAMINHADO =
  "Anotado! Já avisei a equipe, que vai te passar essas informações por aqui.";

export const AVISO_PACIENTE_RECORRENTE = `

CORREÇÃO OBRIGATÓRIA: este paciente JÁ É da clínica. Não pergunte se é Fisioterapia ou Psicologia nem a idade dele. Se o pedido for pra ele mesmo, chame encaminhar_humano AGORA com o que ele pediu (dia, horário, tipo se ele disse) e responda curto que a equipe vai confirmar. Se o pedido for pra outra pessoa, pergunte o nome completo e a idade dessa pessoa.`;

// A OpenAI pode, em casos raros, devolver uma resposta final sem tool_calls
// e com content vazio/em branco. Sem esse fallback, o paciente simplesmente
// não recebia nenhuma mensagem de volta — e ninguém ficava sabendo.
const MENSAGEM_RESPOSTA_VAZIA =
  "Desculpe, não consegui processar sua mensagem agora. Pode tentar reformular?";

// Texto exato que o modelo devolve (ver systemPrompt.js) quando a mensagem
// do paciente é só uma confirmação/agradecimento que não precisa de
// resposta — o bot registra a mensagem do paciente mas não manda nada de
// volta.
const MARCADOR_SEM_RESPOSTA = "SEM_RESPOSTA_NECESSARIA";

// Deriva a próxima etapa a partir de quais functions o modelo executou neste
// turno — é determinístico (não depende do modelo "declarar" o estado dele),
// o que é justamente por que optamos pelo modelo híbrido de controle de fluxo.
// checar_disponibilidade/criar_agendamento/cancelar_agendamento/
// remarcar_agendamento não são mais oferecidas ao modelo (ver
// src/functions/schemas.js) — só encaminhar_humano continua mudando etapa.
const PROXIMA_ETAPA_POR_FUNCTION = {
  encaminhar_humano: "encaminhado_humano",
};

function montarHistoricoResumo(historico) {
  if (!historico.length) return null;
  const ultima = dayjs(historico[historico.length - 1].timestamp)
    .tz(CLINICA.timezone)
    .format("DD/MM/YYYY HH:mm");
  return `Paciente recorrente, com ${historico.length} mensagem(ns) registrada(s) anteriormente (última em ${ultima}).`;
}

function mapearParaMensagensOpenAI(historico) {
  return historico.map((h) => ({
    role: h.remetente === REMETENTE_PACIENTE ? "user" : "assistant",
    content: h.mensagem,
  }));
}

function proximaEtapa(functionsChamadas) {
  for (let i = functionsChamadas.length - 1; i >= 0; i--) {
    const etapa = PROXIMA_ETAPA_POR_FUNCTION[functionsChamadas[i]];
    if (etapa) return etapa;
  }
  return null;
}

// Objeto (não função solta) pra os testes conseguirem fixar o expediente
// com t.mock.method, sem depender da hora em que a suíte roda.
export const expediente = {
  estaAberto: () => {
    const agora = dayjs().tz(CLINICA.timezone);
    if (CLINICA.diasFechados.includes(agora.day()) || ehFeriado(agora)) return false;
    const hhmm = agora.format("HH:mm");
    const { inicio, fim } = CLINICA.horarioRespostaBot;
    return hhmm >= inicio && hhmm < fim;
  },
};

export async function processarMensagemRecebida({ telefone, texto, nomeContato }) {
  // Contatos internos da equipe (ver TELEFONES_SEM_ATENDIMENTO_AUTOMATICO)
  // nunca recebem resposta automática, mande mensagem por onde mandar —
  // nem chega a criar/tocar o registro de paciente.
  if (TELEFONES_SEM_ATENDIMENTO_AUTOMATICO.includes(telefone)) return;

  const paciente = await encontrarOuCriarPaciente({ nome: nomeContato, telefone });

  // Fora do expediente o bot fica calado: a mensagem de ausência do WhatsApp
  // Business já avisa o horário e pede as informações, e o paciente recebia
  // ela e a resposta da IA em seguida (decisão da clínica, 2026-10-02). Só
  // registra pro histórico — a equipe responde quando abrir.
  if (!expediente.estaAberto()) {
    await registrarMensagem({
      pacienteId: paciente.id,
      mensagem: texto,
      remetente: REMETENTE_PACIENTE,
    });
    return;
  }

  if (paciente.etapa_atual === PAUSADO_ATENDIMENTO_HUMANO) {
    const ultimaMensagemEquipe = await buscarTimestampUltimaMensagemEquipe(paciente.id);
    const horasDesdeUltimaMensagemEquipe = ultimaMensagemEquipe
      ? dayjs().diff(dayjs(ultimaMensagemEquipe), "hour", true)
      : Infinity;
    // Paciente respondendo a uma pergunta da equipe ("convênio ou
    // particular?") continua com a equipe, por mais que tenha demorado pra
    // responder (caso real 2026-10-05, uma paciente: a recepção perguntou às 07:26,
    // ela respondeu às 10:12 e o bot assumiu a conversa no lugar da equipe).
    const [ultimaMensagem] = await buscarHistoricoRecente(paciente.id, 1);
    const respondendoPerguntaDaEquipe =
      ultimaMensagem?.remetente === REMETENTE_EQUIPE && ultimaMensagem.mensagem.includes("?");
    const pausaExpirou =
      horasDesdeUltimaMensagemEquipe >= LIMITE_PAUSA_ATENDIMENTO_HUMANO_HORAS &&
      !respondendoPerguntaDaEquipe;

    if (!pausaExpirou) {
      // Alguém da equipe atendeu essa conversa manualmente há pouco tempo
      // — só registra a mensagem do paciente pro histórico, sem gerar nem
      // enviar nenhuma resposta automática.
      await registrarMensagem({
        pacienteId: paciente.id,
        mensagem: texto,
        remetente: REMETENTE_PACIENTE,
      });
      return;
    }

    // Já faz tempo que a equipe não manda nada manual pra esse paciente —
    // a pausa esfriou, a IA retoma sozinha a partir daqui (segue o fluxo
    // normal abaixo, sem `return`).
    await atualizarEtapaPaciente(paciente.id, null);
    paciente.etapa_atual = null;
  }

  const historico = await buscarHistoricoRecente(paciente.id);
  const ehPrimeiraMensagem = historico.length === 0;

  let modoPosEncaminhamento = false;
  if (paciente.etapa_atual === "encaminhado_humano") {
    const ultimaDoBot = historico.findLast((h) => h.remetente === REMETENTE_BOT);
    const horasDesdeEncaminhar = ultimaDoBot
      ? dayjs().diff(dayjs(ultimaDoBot.timestamp), "hour", true)
      : Infinity;
    modoPosEncaminhamento = horasDesdeEncaminhar < SILENCIO_APOS_ENCAMINHAR_HORAS;
  }

  await registrarMensagem({
    pacienteId: paciente.id,
    mensagem: texto,
    remetente: REMETENTE_PACIENTE,
  });

  // Confirmação/despedida pura (ex: "ok", "confirmado", "até lá", "👍"), sem
  // pergunta nem pedido novo — não precisa de resposta nenhuma, nem a
  // mensagem de boas-vindas/início mesmo que seja a primeira mensagem dessa
  // conversa (ex: paciente importado respondendo a um lembrete). Checagem
  // determinística em código, não depende do modelo interpretar certo — ver
  // ehMensagemSoConfirmacao.
  if (ehMensagemSoConfirmacao(texto)) {
    return;
  }


  // O texto fixo de boas-vindas (que termina perguntando se é
  // Fisioterapia ou Psicologia) só vai pra quem é contato NOVO de verdade e
  // SÓ cumprimentou ("Boa tarde", "Olá, tudo bem?") — sem chamar a IA. Se a
  // primeira mensagem já traz uma pergunta ou pedido, quem responde é a IA
  // (que se apresenta em uma frase e responde o que foi perguntado — ver
  // systemPrompt.js): mandar o texto fixo nesse caso ignorava a pergunta
  // (casos reais 2026-09-22: "vocês têm fisioterapeuta que atende em casa?",
  // "vocês fazem fisioterapia perineal?", "psicoterapia infantil pra 5
  // anos?" — todos receberam só as boas-vindas e a equipe teve que responder).
  //
  // Também não recebe o texto fixo quem já tem consulta marcada (ex:
  // respondendo a um lembrete) nem quem já teve consulta na clínica mas nunca
  // tinha escrito por este WhatsApp — a IA responde direto, tratando como
  // paciente da casa.
  const soCumprimentou = ehSoSaudacao(texto);
  let jaEPacienteDaClinica = false;
  if (ehPrimeiraMensagem) {
    try {
      jaEPacienteDaClinica = await telefoneJaTemConsultaNaClinica(telefone);
    } catch (err) {
      capturarAviso("[chatService] Falha ao checar se o telefone já é paciente da clínica:", err);
    }
  }

  // Contato novo que só cumprimentou: a saudação automática do WhatsApp
  // Business já dá as boas-vindas e pergunta "Como podemos ajudar?" — o bot
  // mandava as dele também e o paciente recebia duas seguidas (pedido da
  // clínica em 2026-10-02: desligar as boas-vindas do bot). Só registra e
  // espera o paciente dizer o que precisa (a mensagem já foi registrada lá
  // em cima — registrar de novo aqui gravava a saudação duplicada, caso real
  // 2026-10-05: "Bom dia" aparecia duas vezes na conversa).
  if (ehPrimeiraMensagem && !jaEPacienteDaClinica && soCumprimentou) {
    return;
  }

  const historicoResumo = montarHistoricoResumo(historico);

  const systemPrompt = buildSystemPrompt({
    nomeContato,
    historicoResumo,
    etapaAtual: paciente.etapa_atual,
    jaEPacienteDaClinica,
    modoPosEncaminhamento,
  });

  const historicoModelo = mapearParaMensagensOpenAI(
    historico.filter(
      (h) => dayjs().diff(dayjs(h.timestamp), "hour", true) < JANELA_HISTORICO_MODELO_HORAS
    )
  );
  const contextoFunctions = { telefone, nomeContato, pacienteId: paciente.id };
  let { textoResposta, functionsChamadas } = await gerarResposta({
    systemPrompt,
    historico: historicoModelo,
    mensagemUsuario: texto,
    context: contextoFunctions,
  });

  const recorrente = Boolean(historicoResumo) || jaEPacienteDaClinica;
  if (precisaRefazerRespostaRecorrente({ recorrente, textoResposta, functionsChamadas })) {
    ({ textoResposta, functionsChamadas } = await gerarResposta({
      systemPrompt: systemPrompt + AVISO_PACIENTE_RECORRENTE,
      historico: historicoModelo,
      mensagemUsuario: texto,
      context: contextoFunctions,
    }));
  }

  if (respostaVazaValores(textoResposta)) {
    ({ textoResposta, functionsChamadas } = await gerarResposta({
      systemPrompt: systemPrompt + AVISO_SEM_VALORES,
      historico: historicoModelo,
      mensagemUsuario: texto,
      context: contextoFunctions,
    }));
    if (respostaVazaValores(textoResposta)) {
      capturarAviso(`[chatService] Resposta com valores em R$ bloqueada para paciente ${paciente.id}.`);
      if (!functionsChamadas.includes("encaminhar_humano")) {
        await functionHandlers.encaminhar_humano(
          {
            motivo: "Paciente perguntou sobre valores/condições; o bot tentou informar valores e foi bloqueado.",
            categoria: "outro",
          },
          contextoFunctions
        );
        functionsChamadas = [...functionsChamadas, "encaminhar_humano"];
      }
      textoResposta = MENSAGEM_VALORES_ENCAMINHADO;
    }
  }

  if (!textoResposta) {
    capturarAviso(
      `[chatService] Modelo devolveu resposta vazia sem tool_calls para paciente ${paciente.id}.`
    );
  }

  // O modelo usa esse texto exato pra indicar que a mensagem do paciente foi
  // só uma confirmação/agradecimento (ex: "ok", "confirmado" em resposta a
  // um lembrete) que não precisa de resposta nenhuma — ver systemPrompt.js.
  const semRespostaNecessaria =
    textoResposta?.trim() === MARCADOR_SEM_RESPOSTA ||
    (modoPosEncaminhamento &&
      (functionsChamadas.includes("encaminhar_humano") ||
        !textoResposta ||
        RESPOSTA_SOBRE_ENCAMINHAMENTO.test(textoResposta) ||
        !texto.includes("?")));

  // Resposta que acompanha um encaminhamento sai na hora: a equipe é avisada
  // no mesmo instante e começa a responder; com os 60s de atraso, o "já
  // avisei a equipe" chegava ao paciente por cima da recepção (caso real
  // 2026-10-05, Maria Exemplo: bot 11:55:32, recepção 11:55:54).
  if (!semRespostaNecessaria) {
    const textoParaEnviar = formatarParaWhatsapp(textoResposta || MENSAGEM_RESPOSTA_VAZIA);
    const idRespostaBot = await registrarMensagem({
      pacienteId: paciente.id,
      mensagem: textoParaEnviar,
      remetente: REMETENTE_BOT,
    });
    // Não aguarda o atraso aqui de propósito: travar a função (e o comLock
    // que a envolve, ver webhookController.js) por 60s bloquearia qualquer
    // outra mensagem desse mesmo paciente nesse meio tempo, além de segurar
    // uma conexão do pool do Postgres à toa (comLock usa
    // pg_advisory_xact_lock). O envio real roda em segundo plano.
    setTimeout(async () => {
      try {
        // A pausa por atendimento humano (ver início da função) só foi
        // checada antes de gerar essa resposta — se a equipe respondeu
        // manualmente pelo WhatsApp durante os 60s de espera, o paciente já
        // foi atendido e essa mensagem da IA chegaria atrasada, atropelando
        // quem já respondeu (caso real: um paciente, 23/09/2026). Reconfere
        // o estado atual do paciente antes de mandar de verdade.
        const pacienteAtual = await buscarPacientePorId(paciente.id);
        if (pacienteAtual?.etapa_atual === PAUSADO_ATENDIMENTO_HUMANO) return;
        if (
          idRespostaBot &&
          ehSaudacaoSimples(texto) &&
          (await existeMensagemPacienteApos(paciente.id, idRespostaBot))
        ) {
          return;
        }
        await enviarMensagem(telefone, textoParaEnviar);
      } catch (err) {
        capturarErro(
          `[chatService] Falha ao enviar (atrasada) a resposta da IA para o paciente ${paciente.id}:`,
          err
        );
      }
    }, functionsChamadas.includes("encaminhar_humano") ? 0 : ATRASO_RESPOSTA_IA_MS);
  }

  // Se isso falhar (ex: soluço no Postgres), o paciente ainda vai receber a
  // resposta real (o envio atrasado acima já está agendado) — não
  // deixamos essa falha subir e acionar o fallback de "erro técnico" do
  // webhookController por cima de uma resposta que já chegou certinho.
  const etapa = proximaEtapa(functionsChamadas);
  if (etapa) {
    try {
      await atualizarEtapaPaciente(paciente.id, etapa);
    } catch (err) {
      capturarErro(
        `[chatService] Falha ao atualizar etapa do paciente ${paciente.id} para "${etapa}":`,
        err
      );
    }
  }
}
