import { CLINICA } from "../config/clinica.js";
import { pool } from "../db/pool.js";
import dayjs from "../utils/dayjs.js";
import { ehFeriado } from "../utils/feriados.js";
import { slotsOcupadosPelaConsulta, horariosVizinhos } from "../utils/gradeConsulta.js";

// Só é possível agendar dentro de 7 dias úteis (seg-sex) a partir de agora —
// sábado e domingo não contam pra essa contagem.
const LIMITE_DIAS_UTEIS_AGENDAMENTO = 7;
const DIAS_BUSCA_QUANDO_SEM_DATA = LIMITE_DIAS_UTEIS_AGENDAMENTO;
const MAX_HORARIOS_RETORNADOS = 6;

function isDiaUtil(diaDayjs) {
  return !CLINICA.diasFechados.includes(diaDayjs.day()) && !ehFeriado(diaDayjs);
}

function adicionarDiasUteis(diaDayjs, quantidade) {
  let cursor = diaDayjs;
  let adicionados = 0;
  while (adicionados < quantidade) {
    cursor = cursor.add(1, "day");
    if (isDiaUtil(cursor)) adicionados++;
  }
  return cursor;
}

function limiteDeAgendamento() {
  return adicionarDiasUteis(dayjs().tz(CLINICA.timezone), LIMITE_DIAS_UTEIS_AGENDAMENTO);
}

function horaParaDayjs(diaDayjs, horaStr) {
  const [hora, minuto] = horaStr.split(":").map(Number);
  return diaDayjs.hour(hora).minute(minuto).second(0).millisecond(0);
}

// A clínica atende em dois períodos por dia (manhã e tarde, com intervalo de
// almoço entre eles) — ver CLINICA.horarioFuncionamento.periodos.
function periodosDoDia(diaDayjs, tipoAtendimento) {
  const configuracao =
    tipoAtendimento === "psicologia"
      ? CLINICA.horarioFuncionamentoPsicologia
      : CLINICA.horarioFuncionamento;
  return configuracao.periodos.map((p) => ({
    inicio: horaParaDayjs(diaDayjs, p.inicio),
    fim: horaParaDayjs(diaDayjs, p.fim),
  }));
}

// Exige que a consulta inteira (início e fim) caiba no período, não só o
// horário de início — senão dá pra agendar algo que invade o almoço ou
// passa do horário de fechamento.
function periodoContendo(inicio, fim, periodos) {
  return periodos.find((p) => !inicio.isBefore(p.inicio) && !fim.isAfter(p.fim));
}

// A clínica atende mais de um paciente em paralelo (mais de um
// profissional/sala) — slots não são exclusivos de um único paciente, mas
// têm uma capacidade máxima (CLINICA.capacidadeMaximaPorHorario). Conta
// tanto os agendamentos confirmados feitos pelo bot quanto os importados do
// sistema de agenda anterior, pra refletir a ocupação real da clínica no horário —
// olhando não só pra `hora` em si, mas pros slots vizinhos que uma consulta
// mais longa que o intervalo da grade (Psicologia) pode invadir.
async function contarPacientesComSobreposicao(data, hora, tipoAtendimento) {
  const vizinhos = horariosVizinhos(hora, slotsOcupadosPelaConsulta(tipoAtendimento));
  const { rows } = await pool.query(
    `SELECT hora, COUNT(*)::int AS total FROM (
       SELECT hora FROM agendamentos
          WHERE status = 'confirmado' AND data = $1 AND hora = ANY($2::time[]) AND tipo_atendimento = $3
       UNION ALL
       SELECT hora FROM agendamentos_importados
          WHERE status <> 'cancelado' AND data = $1 AND hora = ANY($2::time[]) AND tipo_atendimento = $3
     ) t
     GROUP BY hora`,
    [data, vizinhos, tipoAtendimento]
  );
  return rows.reduce((max, row) => Math.max(max, row.total), 0);
}

// Mesma contagem que contarPacientesComSobreposicao, mas pro dia inteiro de uma vez
// (uma query só) — usado ao listar horários livres, pra não disparar uma
// query por slot candidato do dia.
async function buscarOcupacaoDoDia(data, tipoAtendimento) {
  const { rows } = await pool.query(
    `SELECT hora, COUNT(*)::int AS total FROM (
       SELECT hora FROM agendamentos WHERE status = 'confirmado' AND data = $1 AND tipo_atendimento = $2
       UNION ALL
       SELECT hora FROM agendamentos_importados WHERE status <> 'cancelado' AND data = $1 AND tipo_atendimento = $2
     ) t
     GROUP BY hora`,
    [data, tipoAtendimento]
  );
  const ocupacaoPorHorario = {};
  for (const row of rows) {
    // Postgres devolve TIME como "HH:mm:ss" — corta pros mesmos "HH:mm" que
    // o resto do código usa (ver cursor.format("HH:mm") abaixo).
    ocupacaoPorHorario[row.hora.slice(0, 5)] = row.total;
  }
  return ocupacaoPorHorario;
}

async function slotsLivresDoDia(diaDayjs, duracaoMinutos, tipoAtendimento) {
  const periodos = periodosDoDia(diaDayjs, tipoAtendimento);
  const capacidadeMaxima = CLINICA.capacidadeMaximaPorHorario?.[tipoAtendimento] ?? Infinity;
  const ocupacaoPorHorario = Number.isFinite(capacidadeMaxima)
    ? await buscarOcupacaoDoDia(diaDayjs.format("YYYY-MM-DD"), tipoAtendimento)
    : null;
  const nSlots = slotsOcupadosPelaConsulta(tipoAtendimento);

  const agora = dayjs().tz(CLINICA.timezone);
  const intervalo = CLINICA.intervaloSlotsMinutos;
  const slots = [];

  for (const periodo of periodos) {
    let cursor = periodo.inicio;
    // A consulta inteira precisa caber no período, não só o horário de
    // início — senão o último horário da manhã invade o almoço (ou o
    // último da tarde passa do fechamento).
    while (!cursor.add(duracaoMinutos, "minute").isAfter(periodo.fim)) {
      const horaFormatada = cursor.format("HH:mm");
      // Olha os slots vizinhos, não só o próprio — um agendamento mais
      // longo que o intervalo da grade (Psicologia) pode já ocupar o slot
      // seguinte ou ter começado no anterior e ainda estar em andamento.
      const ocupacaoMaxima = ocupacaoPorHorario
        ? Math.max(...horariosVizinhos(horaFormatada, nSlots).map((h) => ocupacaoPorHorario[h] ?? 0))
        : 0;
      if (cursor.isAfter(agora) && ocupacaoMaxima < capacidadeMaxima) {
        slots.push(horaFormatada);
      }
      cursor = cursor.add(intervalo, "minute");
    }
  }
  return slots;
}

/**
 * Escolhe `max` itens de `lista` espalhados do início ao fim (não só os
 * primeiros) — assim, quando um período inteiro está livre, a amostra
 * mostra inclusive os horários mais tarde dele, não só os mais cedo.
 */
function amostrarEspacado(lista, max) {
  if (lista.length <= max) return lista;
  if (max <= 1) return [lista[0]];
  const passo = (lista.length - 1) / (max - 1);
  const indices = new Set();
  for (let i = 0; i < max; i++) {
    indices.add(Math.round(i * passo));
  }
  return [...indices].sort((a, b) => a - b).map((i) => lista[i]);
}

/**
 * Quando o paciente pergunta por um dia específico, sugere metade dos
 * horários livres da manhã e metade dos da tarde (arredondando pra cima),
 * espalhados ao longo de cada período — proporcional à disponibilidade real
 * de cada período nesse dia, não um total fixo.
 */
function amostrarMetadeDeCadaPeriodo(horarios) {
  const manha = horarios.filter((h) => h < "12:00");
  const tarde = horarios.filter((h) => h >= "12:00");
  const daManha = amostrarEspacado(manha, Math.ceil(manha.length / 2));
  const daTarde = amostrarEspacado(tarde, Math.ceil(tarde.length / 2));
  return [...daManha, ...daTarde].sort();
}

/**
 * Dado um dia com mais horários livres do que o limite a retornar, garante
 * que a amostra final tenha opções de manhã e de tarde, espalhadas ao longo
 * de cada período (até o fim da tarde, se estiver livre) — não só as
 * primeiras N cronologicamente, que tendem a ser todas de manhã e cedo.
 */
function amostrarManhaETarde(horarios, max) {
  if (horarios.length <= max) return horarios;
  const manha = horarios.filter((h) => h < "12:00");
  const tarde = horarios.filter((h) => h >= "12:00");
  const metade = Math.ceil(max / 2);
  const daManha = amostrarEspacado(manha, Math.min(metade, manha.length));
  const daTarde = amostrarEspacado(tarde, Math.min(max - daManha.length, tarde.length));
  const faltam = max - daManha.length - daTarde.length;
  const restanteManha = manha.filter((h) => !daManha.includes(h));
  const extra = faltam > 0 ? amostrarEspacado(restanteManha, faltam) : [];
  return [...daManha, ...daTarde, ...extra].sort();
}

// O modelo às vezes calcula errado o dia da semana correspondente a uma data
// (ex: chamou 27/08/2026 de "quarta-feira" quando na verdade é quinta) — como
// LLMs não fazem aritmética de calendário de forma confiável. Calculamos aqui
// e mandamos pronto, pra ele só repetir em vez de calcular sozinho.
export function nomeDiaSemana(diaDayjs) {
  const nome = diaDayjs.format("dddd");
  return nome.charAt(0).toUpperCase() + nome.slice(1);
}

/**
 * Lista horários livres. Se `data` for informada, verifica só aquele dia
 * (retorna vazio se cair em fim de semana). Se não, faz uma busca "rolante"
 * a partir de amanhã pelos próximos dias úteis até juntar algumas opções.
 */
export async function listarHorariosDisponiveis({ data, tipoAtendimento, amostrar = true }) {
  const duracao = CLINICA.duracaoConsultaMinutos[tipoAtendimento] ?? 50;
  const resultado = [];

  if (data) {
    const dia = dayjs.tz(data, CLINICA.timezone);
    if (!isDiaUtil(dia) || dia.isAfter(limiteDeAgendamento(), "day")) return [];
    // Dia específico: retorna metade de cada período (não o corte fixo de
    // MAX_HORARIOS_RETORNADOS usado na busca "rolante" abaixo) — exceto
    // quando amostrar: false (dashboard de remarcação, que precisa ver
    // todos os horários livres do dia, não a amostra pensada pro bot não
    // sobrecarregar o paciente no WhatsApp).
    const slotsLivres = await slotsLivresDoDia(dia, duracao, tipoAtendimento);
    const horarios = amostrar ? amostrarMetadeDeCadaPeriodo(slotsLivres) : slotsLivres;
    const diaSemana = nomeDiaSemana(dia);
    return horarios.map((hora) => ({ data, diaSemana, hora }));
  } else {
    let cursor = dayjs().tz(CLINICA.timezone).add(1, "day");
    let diasChecados = 0;
    while (
      diasChecados < DIAS_BUSCA_QUANDO_SEM_DATA &&
      resultado.length < MAX_HORARIOS_RETORNADOS
    ) {
      if (isDiaUtil(cursor)) {
        const horarios = amostrarManhaETarde(
          await slotsLivresDoDia(cursor, duracao, tipoAtendimento),
          4
        );
        const diaSemana = nomeDiaSemana(cursor);
        resultado.push(
          ...horarios.map((hora) => ({ data: cursor.format("YYYY-MM-DD"), diaSemana, hora }))
        );
        diasChecados++;
      }
      cursor = cursor.add(1, "day");
    }
  }

  return resultado.slice(0, MAX_HORARIOS_RETORNADOS);
}

/**
 * Mesma checagem de horário/capacidade usada por criar_agendamento e
 * remarcar_agendamento (bot e dashboard) — nunca dependeu do Google Calendar,
 * é inteiramente baseada no Postgres (agendamentos + agendamentos_importados).
 */
export async function validarDisponibilidadeAgendamento({
  data,
  hora,
  tipoAtendimento,
  ignorarLimiteDias = false,
}) {
  const duracao = CLINICA.duracaoConsultaMinutos[tipoAtendimento] ?? 50;
  const inicio = dayjs.tz(`${data}T${hora}`, CLINICA.timezone);
  const fim = inicio.add(duracao, "minute");

  // listarHorariosDisponiveis só filtra esses casos ao *sugerir* horário —
  // aqui é a checagem que realmente impede a criação/remarcação fora do
  // expediente, mesmo que o modelo chame criar_agendamento direto sem
  // antes checar disponibilidade.
  const periodo = periodoContendo(inicio, fim, periodosDoDia(inicio, tipoAtendimento));
  if (!isDiaUtil(inicio) || !periodo) {
    const erro = new Error("FORA_DO_HORARIO_FUNCIONAMENTO");
    erro.codigo = "FORA_DO_HORARIO_FUNCIONAMENTO";
    throw erro;
  }

  const agora = dayjs().tz(CLINICA.timezone);
  if (inicio.isBefore(agora)) {
    const erro = new Error("DATA_NO_PASSADO");
    erro.codigo = "DATA_NO_PASSADO";
    throw erro;
  }

  // ignorarLimiteDias existe só pra série recorrente criada manualmente
  // pelo dashboard (ver criarSerieAgendamentos) — o limite de 7 dias úteis
  // existe pra impedir o BOT de marcar peculiar longe demais sem contexto
  // humano; numa série, é a recepção decidindo conscientemente o dia da
  // semana e a quantidade de sessões, então não faz sentido aplicar aqui.
  if (!ignorarLimiteDias && inicio.isAfter(limiteDeAgendamento(), "day")) {
    const erro = new Error("FORA_DO_LIMITE_DIAS");
    erro.codigo = "FORA_DO_LIMITE_DIAS";
    throw erro;
  }

  const capacidadeMaxima = CLINICA.capacidadeMaximaPorHorario?.[tipoAtendimento] ?? Infinity;
  if (Number.isFinite(capacidadeMaxima)) {
    const ocupacaoAtual = await contarPacientesComSobreposicao(data, hora, tipoAtendimento);
    if (ocupacaoAtual >= capacidadeMaxima) {
      const erro = new Error("HORARIO_LOTADO");
      erro.codigo = "HORARIO_LOTADO";
      throw erro;
    }
  }
}
