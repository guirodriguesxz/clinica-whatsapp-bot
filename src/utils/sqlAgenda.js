/**
 * Data/hora "agora" no fuso da clínica (America/Sao_Paulo), não o fuso da
 * sessão do Postgres — que não é garantido ser o da clínica (ex: Neon roda
 * em UTC por padrão). `CURRENT_DATE`/`CURRENT_TIME` puros usam o fuso da
 * sessão: entre ~21h e meia-noite (horário de Brasília), quando UTC já
 * virou o dia seguinte, isso faz "hoje" da clínica ser tratado como
 * "ontem" — agendamentos de hoje sumiam da agenda e eram marcados como já
 * passados horas antes de realmente passarem. Usar essas duas constantes
 * em vez de CURRENT_DATE/CURRENT_TIME evita esse desalinhamento.
 */
export const HOJE_SQL = "(now() AT TIME ZONE 'America/Sao_Paulo')::date";
export const AGORA_HORA_SQL = "(now() AT TIME ZONE 'America/Sao_Paulo')::time";

function prefixoAlias(alias) {
  return alias ? `${alias}.` : "";
}

/**
 * Fragmento SQL "já aconteceu" pra uma tabela com colunas data/hora.
 * Compartilhado entre a fila de presença (registroAtendimentoModel) e a
 * agenda unificada (agendamentoModel) — mesma regra, duas listagens
 * diferentes. `alias` é opcional — string vazia/omitida usa `data`/`hora`
 * sem prefixo, pra consultas sem JOIN.
 */
export function jaPassouSql(alias) {
  const p = prefixoAlias(alias);
  return `(${p}data < ${HOJE_SQL} OR (${p}data = ${HOJE_SQL} AND ${p}hora <= ${AGORA_HORA_SQL}))`;
}

/**
 * Fragmento SQL "ainda não passou" (futuro, incluindo o horário exato de
 * agora) — usado pelo bot pra listar/cancelar agendamentos confirmados e
 * futuros do paciente (agendamentoModel.js). Mesmo cuidado de fuso horário
 * de jaPassouSql; não é a negação lógica exata dela (o instante exato
 * `hora = agora` conta nas duas, por design já existente antes desta
 * correção — não alterado aqui).
 */
export function aindaNaoPassouSql(alias) {
  const p = prefixoAlias(alias);
  return `(${p}data > ${HOJE_SQL} OR (${p}data = ${HOJE_SQL} AND ${p}hora >= ${AGORA_HORA_SQL}))`;
}
