import "dotenv/config";
// Precisa ser o primeiro import depois do dotenv: Sentry.init() (dentro deste
// módulo) tem que rodar antes de qualquer outro módulo do projeto, para que
// capturarErro/capturarAviso cheguem ao Sentry mesmo em erros disparados
// durante o carregamento (ex: os avisos de config ausente no import).
import { capturarErro, sentryAtivo, Sentry } from "./src/config/sentry.js";
import cron from "node-cron";
import app from "./src/app.js";
import { pool } from "./src/db/pool.js";
import { enviarMensagem } from "./src/services/whatsappService.js";
import { enviarLembretesPendentes, enviarLembretesTardeDoDia, cronLembreteTarde } from "./src/services/lembreteService.js";
import { CLINICA } from "./src/config/clinica.js";
import { verificarConexaoWhatsapp } from "./src/services/whatsappHealthService.js";
import { verificarCreditosOpenAI } from "./src/services/openaiHealthService.js";
import { enviarFotosPendentesExpiradas } from "./src/services/encaminhamentoMedicoService.js";
import { enviarResumoSemResposta } from "./src/services/semRespostaService.js";

const PORT = process.env.PORT || 3000;
const TELEFONE_ATENDENTE = process.env.ATENDENTE_HUMANO_TELEFONE;

// Diferente do lembrete de consulta, essa checagem não manda nada pro
// paciente — só lê o status da conexão e avisa o número de atendimento se
// ela cair. Por isso já vem ligada por padrão (não depende de revisão de
// texto que vá pro paciente). Só não roda se a Evolution API nem estiver
// configurada (evita erro/ruído em ambiente local sem ela).
const EVOLUTION_CONFIGURADA = Boolean(
  process.env.EVOLUTION_API_URL &&
  process.env.EVOLUTION_API_KEY &&
  process.env.EVOLUTION_INSTANCE_NAME
);
let tarefaChecagemWhatsapp = null;

if (EVOLUTION_CONFIGURADA) {
  // A cada 10 min: rápido o suficiente pra pegar uma desconexão sem demorar
  // horas, sem gerar carga desnecessária na Evolution API.
  tarefaChecagemWhatsapp = cron.schedule("*/10 * * * *", () => {
    verificarConexaoWhatsapp().catch((err) => {
      capturarErro("[server] Falha ao rodar a checagem de conexão do WhatsApp:", err);
    });
  });
}

// Garante que nenhuma foto de encaminhamento médico se perde quando o
// paciente manda a foto mas não chega a agendar nem é encaminhado para
// atendimento humano (ver notificarRecepcaoDoAgendamento em
// criarAgendamento.js e encaminharHumano.js, que consomem a pendência
// antes desse timeout). A cada 15 min, mesma cadência do lembrete.
let tarefaFotosPendentesExpiradas = null;
if (EVOLUTION_CONFIGURADA) {
  tarefaFotosPendentesExpiradas = cron.schedule("*/15 * * * *", () => {
    enviarFotosPendentesExpiradas().catch((err) => {
      capturarErro("[server] Falha ao rodar o job de fotos de encaminhamento pendentes:", err);
    });
  });
}

// Detecta a conta da OpenAI ficar sem créditos mesmo sem nenhum paciente
// conversando no momento (ver openaiHealthService.js). Cada checagem custa
// uma chamada de 1 token de resposta — desprezível mesmo a cada 15 min.
let tarefaChecagemOpenAI = null;
if (process.env.OPENAI_API_KEY) {
  tarefaChecagemOpenAI = cron.schedule("*/15 * * * *", () => {
    verificarCreditosOpenAI().catch((err) => {
      capturarErro("[server] Falha ao rodar a checagem de créditos da OpenAI:", err);
    });
  });
}

// Desligado por padrão: manda mensagem de verdade pra paciente de verdade,
// então só liga depois de revisar o texto em src/services/lembreteService.js
// com a clínica. Ver README (seção "Lembrete automático de consulta").
const LEMBRETE_ATIVADO = process.env.LEMBRETE_CONSULTA_ATIVADO === "true";
let tarefaLembrete = null;

if (LEMBRETE_ATIVADO) {
  // A cada 15 min é granularidade suficiente pra um lembrete de véspera sem
  // gerar carga desnecessária de queries/consultas ao Calendar.
  //
  // Com o espaçamento de ESPERA_ENTRE_LEMBRETES_MS entre cada envio (ver
  // lembreteService.js), uma leva grande de lembretes pode levar mais de 15
  // min pra terminar — esse guard evita que o próximo disparo do cron rode
  // em cima do anterior ainda em andamento (o que reenviaria lembrete
  // duplicado, já que marcarEnviado só acontece depois do envio).
  let lembreteEmAndamento = false;
  tarefaLembrete = cron.schedule("*/15 * * * *", () => {
    if (lembreteEmAndamento) return;
    lembreteEmAndamento = true;
    enviarLembretesPendentes()
      .catch((err) => {
        capturarErro("[server] Falha ao rodar o job de lembrete de consulta:", err);
      })
      .finally(() => {
        lembreteEmAndamento = false;
      });
  });
  console.log("[server] Lembrete automático de consulta ATIVADO.");
}

// Desligado por padrão: manda mensagem de verdade pra paciente de verdade
// marcado pra HOJE à tarde, então só liga depois de revisar o texto em
// src/services/lembreteService.js (montarMensagemLembreteTarde) com a
// clínica. Cobre o caso que o lembrete de véspera acima não cobre (consulta
// marcada pro mesmo dia nunca recebe lembrete de véspera).
const LEMBRETE_TARDE_ATIVADO = process.env.LEMBRETE_TARDE_ATIVADO === "true";
let tarefaLembreteTarde = null;

if (LEMBRETE_TARDE_ATIVADO) {
  // Horário fixo (LEMBRETE_TARDE_HORA, padrão meio-dia, fuso da clínica) em
  // vez de intervalo — dispara uma vez por dia, não a cada 15 min como os
  // outros jobs. `timezone` é necessário porque o processo roda em UTC
  // (Railway); sem isso, "0 12" dispararia às 12h UTC (9h em Brasília).
  tarefaLembreteTarde = cron.schedule(
    cronLembreteTarde(),
    () => {
      enviarLembretesTardeDoDia().catch((err) => {
        capturarErro("[server] Falha ao rodar o job de lembrete de tarde:", err);
      });
    },
    { timezone: CLINICA.timezone }
  );
  console.log(`[server] Lembrete automático de tarde ATIVADO (cron "${cronLembreteTarde()}").`);
}

// Resumo, só pra recepção (ATENDENTE_HUMANO_TELEFONE), dos pacientes que mandaram
// mensagem e a equipe ainda não respondeu (ver semRespostaService.js). Horários
// fixos em dia útil (9h, 13h e 17h, fuso da clínica — o processo roda em UTC).
// Ligado por padrão porque não escreve pra paciente; desligue com
// ALERTA_SEM_RESPOSTA_ATIVADO=false.
let tarefaSemResposta = null;
if (process.env.ALERTA_SEM_RESPOSTA_ATIVADO !== "false") {
  tarefaSemResposta = cron.schedule(
    "0 9,13,17 * * *",
    () => {
      enviarResumoSemResposta().catch((err) => {
        capturarErro("[server] Falha ao rodar o resumo de pacientes sem resposta:", err);
      });
    },
    { timezone: CLINICA.timezone }
  );
}

/**
 * Rede de segurança final: um erro fora do ciclo de request do Express (ex:
 * numa promise "solta", sem ninguém dando await/catch nela) não passa pelo
 * error handler de src/app.js — sem isso aqui, o processo morre em silêncio
 * (ou fica travado) sem ninguém saber que o bot parou de responder.
 * Best-effort: tenta avisar o telefone da clínica por WhatsApp antes de
 * derrubar o processo (o gerenciador de processo em produção — PM2, Docker
 * restart policy, systemd — deve reiniciá-lo automaticamente).
 */
async function tratarErroFatal(origem, err) {
  capturarErro(`[server] Erro fatal (${origem}), encerrando o processo:`, err);
  if (TELEFONE_ATENDENTE) {
    try {
      await enviarMensagem(
        TELEFONE_ATENDENTE,
        `⚠️ Clínica Exemplo Bot caiu (${origem}) e vai reiniciar. Se o problema persistir, avise o desenvolvedor.`
      );
    } catch (errAviso) {
      capturarErro("[server] Não consegui avisar por WhatsApp sobre o erro fatal:", errAviso);
    }
  }
  // Sentry manda os eventos em background — sem esperar esse flush, o
  // process.exit(1) logo abaixo pode matar o processo antes do erro fatal
  // (o mais importante de todos) sequer sair para o Sentry.
  if (sentryAtivo) {
    await Sentry.flush(2000).catch(() => {});
  }
  process.exit(1);
}

process.on("uncaughtException", (err) => {
  tratarErroFatal("uncaughtException", err);
});
process.on("unhandledRejection", (err) => {
  tratarErroFatal("unhandledRejection", err);
});

const server = app.listen(PORT, () => {
  console.log(`Clínica Exemplo Bot rodando na porta ${PORT}`);
});

// Encerra aceitando requisições em voo e fecha o pool do Postgres antes de
// sair — sem isso, um redeploy/restart mata conexões de banco no meio de
// uma query e derruba requisições que já tinham sido aceitas.
function desligar(sinal) {
  console.log(`[server] ${sinal} recebido, desligando...`);
  tarefaLembrete?.stop();
  tarefaLembreteTarde?.stop();
  tarefaSemResposta?.stop();
  tarefaChecagemWhatsapp?.stop();
  tarefaChecagemOpenAI?.stop();
  tarefaFotosPendentesExpiradas?.stop();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGTERM", () => desligar("SIGTERM"));
process.on("SIGINT", () => desligar("SIGINT"));
