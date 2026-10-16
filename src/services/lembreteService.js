import dayjs from "../utils/dayjs.js";
import { CLINICA, TELEFONES_SEM_ATENDIMENTO_AUTOMATICO } from "../config/clinica.js";
import { capitalizarNome } from "../utils/nome.js";
import { normalizarTelefone, normalizarTelefoneComDDI } from "../utils/phone.js";
import { enviarMensagem } from "./whatsappService.js";
import {
  buscarAgendamentosConfirmadosSemLembreteVespera,
  marcarLembreteVesperaEnviado,
  buscarAgendamentosConfirmadosTardeSemLembrete,
  marcarLembreteTardeEnviado,
} from "../models/agendamentoModel.js";
import {
  buscarAgendamentosImportadosSemLembreteVespera,
  marcarLembreteImportadoVesperaEnviado,
  buscarAgendamentosImportadosTardeSemLembrete,
  marcarLembreteImportadoTardeEnviado,
} from "../models/agendamentoImportadoModel.js";
import { NOMES_TIPO_ATENDIMENTO } from "../utils/tipoAtendimento.js";
import { capturarErro, capturarAviso } from "../config/sentry.js";

const HORA_VESPERA_PADRAO = 18;
const HORA_TARDE_PADRAO = 12;

// Envia um lembrete de cada vez, com esse intervalo entre eles, em vez de
// disparar todos em sequência imediata — rajadas de mensagens pro WhatsApp
// Business são um gatilho conhecido de restrição/bloqueio da conta.
// Configurável via env (sem precisar mexer em código) caso seja preciso
// espaçar ainda mais no futuro.
function esperaEntreLembretesConfigurada() {
  const valor = Number(process.env.LEMBRETE_INTERVALO_ENVIO_MS);
  return Number.isFinite(valor) && valor >= 0 ? valor : 2 * 60 * 1000;
}

// Se vários envios seguidos falharem, é sinal de algo sistêmico (número
// restrito/desconectado) — não instabilidade pontual. Continuar batendo nos
// próximos candidatos da leva só multiplicaria tentativas contra um número
// já problemático. Os agendamentos não tentados ficam pendentes (não são
// marcados como enviados) e entram de novo no próximo ciclo do cron.
const MAX_FALHAS_CONSECUTIVAS = 3;

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function horaVesperaConfigurada() {
  const valor = Number(process.env.LEMBRETE_CONSULTA_HORA_VESPERA);
  return Number.isFinite(valor) && valor >= 0 && valor <= 23 ? valor : HORA_VESPERA_PADRAO;
}

// Minuto de corte da véspera (0-59, padrão 0). Junto com a hora, permite
// disparar, por exemplo, a partir das 19:30 (HORA_VESPERA=19 + MINUTO=30).
function minutoVesperaConfigurado() {
  const valor = Number(process.env.LEMBRETE_CONSULTA_MINUTO_VESPERA);
  return Number.isInteger(valor) && valor >= 0 && valor <= 59 ? valor : 0;
}

// Trava de teste: se LEMBRETE_SO_TELEFONES estiver preenchida (números
// separados por vírgula), o lembrete só sai para esses telefones — qualquer
// outro agendamento é ignorado e continua pendente. Vazia/ausente = sem
// trava (comportamento normal). Serve pra testar o lembrete em produção com
// poucos números antes de liberar pra toda a agenda.
export function telefonesPermitidosParaLembrete() {
  const bruto = process.env.LEMBRETE_SO_TELEFONES;
  if (!bruto || !bruto.trim()) return null;
  return new Set(
    bruto
      .split(",")
      .map((t) => normalizarTelefoneComDDI(t))
      .filter(Boolean)
  );
}

// Expressão cron do disparo do lembrete de tarde: uma vez por dia, na hora
// configurada (LEMBRETE_TARDE_HORA, padrão 12). Usada em server.js — antes o
// disparo era fixo às 12h, mesmo com a hora da janela configurável.
export function cronLembreteTarde() {
  return `0 ${horaTardeConfigurada()} * * *`;
}

function horaTardeConfigurada() {
  const valor = Number(process.env.LEMBRETE_TARDE_HORA);
  return Number.isFinite(valor) && valor >= 0 && valor <= 23 ? valor : HORA_TARDE_PADRAO;
}

// ATENÇÃO: revise esse texto com a clínica antes de ativar
// LEMBRETE_CONSULTA_ATIVADO em produção — é a mensagem que o paciente de
// verdade recebe.
export function montarMensagemLembrete(agendamento) {
  const tipo = NOMES_TIPO_ATENDIMENTO[agendamento.tipo_atendimento] ?? agendamento.tipo_atendimento;
  const hora = String(agendamento.hora).slice(0, 5);

  return (
    `Olá, ${agendamento.paciente_nome}! Sua consulta de ${tipo} na ${CLINICA.nome} é amanhã às ${hora}. ` +
    `Te esperamos!`
  );
}

/**
 * Decide se um agendamento entra na janela de disparo do lembrete de
 * véspera: a consulta é amanhã (em relação a `agora`) e já passou da hora
 * configurada (LEMBRETE_CONSULTA_HORA_VESPERA, padrão 18h). Consultas do
 * mesmo dia nunca entram aqui (não há véspera possível) — por decisão do
 * usuário, esses agendamentos simplesmente não recebem lembrete automático.
 */
export function deveEnviarLembreteVespera(agendamento, agora) {
  const horarioConsulta = dayjs.tz(`${agendamento.data}T${agendamento.hora}`, CLINICA.timezone);
  const amanha = agora.add(1, "day");
  const ehAmanha = horarioConsulta.isSame(amanha, "day");
  const minutosAgora = agora.hour() * 60 + agora.minute();
  const minutosCorte = horaVesperaConfigurada() * 60 + minutoVesperaConfigurado();
  return ehAmanha && minutosAgora >= minutosCorte;
}

// ATENÇÃO: revise esse texto com a clínica antes de ativar
// LEMBRETE_TARDE_ATIVADO em produção — é a mensagem que o paciente de
// verdade recebe.
export function montarMensagemLembreteTarde(agendamento) {
  const tipo = NOMES_TIPO_ATENDIMENTO[agendamento.tipo_atendimento] ?? agendamento.tipo_atendimento;
  const hora = String(agendamento.hora).slice(0, 5);

  return (
    `Olá, ${agendamento.paciente_nome}! Passando pra lembrar que sua consulta de ${tipo} na ${CLINICA.nome} é hoje às ${hora}. ` +
    `Te esperamos!`
  );
}

/**
 * Decide se um agendamento entra na janela de disparo do lembrete de tarde:
 * a consulta é HOJE (em relação a `agora`), à tarde (hora >= 12:00), e já
 * passou da hora configurada de disparo (LEMBRETE_TARDE_HORA, padrão 12h).
 * Diferente do lembrete de véspera, que nunca dispara pra consulta do mesmo
 * dia — este é feito justamente pra cobrir esse caso, pros agendamentos da
 * tarde.
 */
export function deveEnviarLembreteTarde(agendamento, agora) {
  const horarioConsulta = dayjs.tz(`${agendamento.data}T${agendamento.hora}`, CLINICA.timezone);
  const ehHoje = horarioConsulta.isSame(agora, "day");
  return ehHoje && agora.hour() >= horaTardeConfigurada();
}

/**
 * Processa uma lista de candidatos (já normalizados) contra uma janela de
 * disparo — usado tanto pro lembrete de véspera quanto pro de tarde, e tanto
 * pros agendamentos feitos pelo bot quanto pros importados do sistema anterior
 * Office (mesma regra pros quatro casos).
 */
async function processarCandidatos(candidatos, { telefone, nome, marcarEnviado, deveEnviar, montarMensagem }, estadoEnvio) {
  const agora = dayjs().tz(CLINICA.timezone);
  const esperaEntreLembretes = esperaEntreLembretesConfigurada();
  const telefonesPermitidos = telefonesPermitidosParaLembrete();

  for (const agendamento of candidatos) {
    if (estadoEnvio.circuitoAberto) return;
    if (!deveEnviar(agendamento, agora)) continue;

    const telefoneDestino = normalizarTelefone(telefone(agendamento));
    const nomeDestino = capitalizarNome(nome(agendamento));

    // Trava de teste (LEMBRETE_SO_TELEFONES): fora da lista, nada é enviado
    // nem marcado como enviado.
    if (telefonesPermitidos && !telefonesPermitidos.has(telefoneDestino)) continue;

    // Guarda contra dado sujo (ex: agendamento de teste cadastrado com o
    // número da recepção ou o do próprio WhatsApp do bot): nunca manda
    // lembrete de "paciente" pra número interno da equipe, mesmo que a
    // consulta esteja confirmada no banco.
    if (TELEFONES_SEM_ATENDIMENTO_AUTOMATICO.includes(telefoneDestino)) {
      capturarAviso(
        `[lembreteService] Agendamento ${agendamento.id} tem telefone de contato interno (${telefoneDestino}) — lembrete não enviado (provável dado de teste).`
      );
      continue;
    }

    if (estadoEnvio.enviouAlgum) {
      await esperar(esperaEntreLembretes);
    }

    try {
      await enviarMensagem(
        telefoneDestino,
        montarMensagem({ ...agendamento, paciente_nome: nomeDestino })
      );
      await marcarEnviado(agendamento.id);
      estadoEnvio.falhasConsecutivas = 0;
    } catch (err) {
      capturarErro(
        `[lembreteService] Falha ao enviar lembrete do agendamento ${agendamento.id}:`,
        err
      );
      estadoEnvio.falhasConsecutivas += 1;
      if (estadoEnvio.falhasConsecutivas >= MAX_FALHAS_CONSECUTIVAS) {
        estadoEnvio.circuitoAberto = true;
        capturarErro(
          `[lembreteService] ${MAX_FALHAS_CONSECUTIVAS} falhas de envio seguidas — provável restrição/queda do WhatsApp. Interrompendo o restante da leva (fica pendente pro próximo ciclo).`
        );
        return;
      }
    }
    estadoEnvio.enviouAlgum = true;
  }
}

/**
 * Roda periodicamente (ver server.js, só se LEMBRETE_CONSULTA_ATIVADO=true).
 * Cada agendamento (feito pelo bot ou importado do sistema de agenda anterior) recebe
 * um único lembrete, na véspera da consulta, a partir da hora configurada
 * (padrão 18h, LEMBRETE_CONSULTA_HORA_VESPERA).
 */
export async function enviarLembretesPendentes() {
  const [candidatosBot, candidatosImportados] = await Promise.all([
    buscarAgendamentosConfirmadosSemLembreteVespera(),
    buscarAgendamentosImportadosSemLembreteVespera(),
  ]);

  // Estado compartilhado entre as duas listas: garante os 2 min de intervalo
  // também entre o último lembrete de um grupo e o primeiro do outro.
  const estadoEnvio = { enviouAlgum: false, falhasConsecutivas: 0, circuitoAberto: false };

  await processarCandidatos(
    candidatosBot,
    {
      telefone: (a) => a.paciente_telefone,
      nome: (a) => a.paciente_nome,
      marcarEnviado: marcarLembreteVesperaEnviado,
      deveEnviar: deveEnviarLembreteVespera,
      montarMensagem: montarMensagemLembrete,
    },
    estadoEnvio
  );

  await processarCandidatos(
    candidatosImportados,
    {
      telefone: (a) => a.telefone,
      nome: (a) => a.nome,
      marcarEnviado: marcarLembreteImportadoVesperaEnviado,
      deveEnviar: deveEnviarLembreteVespera,
      montarMensagem: montarMensagemLembrete,
    },
    estadoEnvio
  );
}

/**
 * Roda periodicamente (ver server.js, só se LEMBRETE_TARDE_ATIVADO=true —
 * desligado por padrão, recurso novo). Cada agendamento de HOJE à tarde
 * (feito pelo bot ou importado do sistema de agenda anterior) recebe um único lembrete,
 * a partir da hora configurada (padrão 12h, LEMBRETE_TARDE_HORA) — cobre
 * justamente o caso que o lembrete de véspera não cobre (consulta marcada
 * pro mesmo dia).
 */
export async function enviarLembretesTardeDoDia() {
  const [candidatosBot, candidatosImportados] = await Promise.all([
    buscarAgendamentosConfirmadosTardeSemLembrete(),
    buscarAgendamentosImportadosTardeSemLembrete(),
  ]);

  const estadoEnvio = { enviouAlgum: false, falhasConsecutivas: 0, circuitoAberto: false };

  await processarCandidatos(
    candidatosBot,
    {
      telefone: (a) => a.paciente_telefone,
      nome: (a) => a.paciente_nome,
      marcarEnviado: marcarLembreteTardeEnviado,
      deveEnviar: deveEnviarLembreteTarde,
      montarMensagem: montarMensagemLembreteTarde,
    },
    estadoEnvio
  );

  await processarCandidatos(
    candidatosImportados,
    {
      telefone: (a) => a.telefone,
      nome: (a) => a.nome,
      marcarEnviado: marcarLembreteImportadoTardeEnviado,
      deveEnviar: deveEnviarLembreteTarde,
      montarMensagem: montarMensagemLembreteTarde,
    },
    estadoEnvio
  );
}
